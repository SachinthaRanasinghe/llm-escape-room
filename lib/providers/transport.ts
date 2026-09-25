import type { Provider } from '@/lib/schema/run';
import { ProviderError } from './types';

/**
 * One POST, with retries, timing and redaction. The only place either adapter
 * touches the network.
 *
 * ── Only the successful attempt is timed ───────────────────────────────────
 * `latencyMs` becomes `Event.latencyMs`, which the replay shows as the model's
 * think-time. A 429 followed by a backoff sleep is the provider's queue, not the
 * model hesitating, and letting it through would make whichever model happened
 * to hit a rate limit look slow. So the clock is read around the attempt that
 * succeeded and nothing else.
 *
 * ── The clock is injected ──────────────────────────────────────────────────
 * Same discipline as `lib/sim/budget.ts`: nothing here reads a global clock or
 * sleeps for real unless the caller let it. Tests drive retries in no time and
 * assert exact latencies.
 *
 * ── Nothing secret leaves in an error ──────────────────────────────────────
 * A `ProviderError` message is assembled from provider, status and attempt count,
 * plus at most a short excerpt of the provider's own error text with every
 * header value scrubbed out of it — providers have been known to echo a bad key
 * back. The URL is never quoted and the request is never attached.
 */

export interface TransportDeps {
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /**
   * How hard to retry throttling. Absent means `DEFAULT_RETRY`. Carried on the
   * deps so a caller that expects to live against a per-minute limit — the
   * TICKET-7 (#8) spike, whose duels outrun Groq's 8K tokens per minute — can
   * wait the window out instead of aborting a duel half played.
   */
  readonly retry?: RetryPolicy;
}

export const DEFAULT_DEPS: TransportDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 20_000 };

/** Throttling and transient server trouble. Anything else is an answer, not a hiccup. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export interface PostResult {
  readonly status: number;
  readonly json: unknown;
  readonly latencyMs: number;
  readonly attempts: number;
}

/** Replace every occurrence of each secret with `***`. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join('***');
  }
  return out;
}

/** The provider's own error message, if its body has one — both providers use `{ error: { message } }`. */
export function errorExcerpt(json: unknown, secrets: readonly string[]): string {
  const message = (json as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof message !== 'string') return '';
  return redact(message, secrets).slice(0, 200);
}

/** `retry-after` is either delta-seconds or an HTTP date. `null` when absent or unreadable. */
export function retryAfterMs(header: string | null, nowMs: number): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

export async function postJson(
  provider: Provider,
  url: string,
  headers: Readonly<Record<string, string>>,
  body: unknown,
  deps: TransportDeps = DEFAULT_DEPS,
  retry: RetryPolicy = deps.retry ?? DEFAULT_RETRY,
): Promise<PostResult> {
  const secrets = Object.values(headers).flatMap((value) => [value, value.replace(/^Bearer\s+/i, '')]);
  const payload = JSON.stringify(body);
  let lastStatus: number | null = null;
  let lastDetail = 'no response';

  for (let attempt = 1; attempt <= retry.maxRetries + 1; attempt += 1) {
    let wait: number | null = null;
    try {
      const started = deps.now();
      const response = await deps.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: payload,
      });
      const text = await response.text();
      let json: unknown = null;
      try {
        json = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const latencyMs = Math.round(deps.now() - started);

      if (!RETRYABLE.has(response.status)) {
        // 2xx, and every 4xx that is not throttling: the provider module decides
        // whether it is the model's failure (a turn) or a real error (a throw).
        return { status: response.status, json, latencyMs, attempts: attempt };
      }

      lastStatus = response.status;
      lastDetail = errorExcerpt(json, secrets) || `HTTP ${response.status}`;
      wait = retryAfterMs(response.headers.get('retry-after'), Date.now());
    } catch (error) {
      // A thrown fetch — DNS, reset, timeout. Transient by assumption. The
      // message is redacted because some runtimes quote the request in it.
      lastStatus = null;
      lastDetail = redact(error instanceof Error ? error.message : String(error), secrets).slice(0, 200);
    }

    if (attempt <= retry.maxRetries) {
      const backoff = retry.baseDelayMs * 2 ** (attempt - 1);
      await deps.sleep(Math.min(retry.maxDelayMs, wait ?? backoff));
    }
  }

  throw new ProviderError(provider, lastStatus, retry.maxRetries + 1, `gave up: ${lastDetail}`);
}
