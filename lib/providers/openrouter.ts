import { compileGroqJsonRequest, compileGroqRequest, decodeGroqJsonResponse, decodeGroqResponse, type DecodedJson } from './groq';
import { DEFAULT_DEPS, DEFAULT_RETRY, errorExcerpt, postJson, type PostResult, type TransportDeps } from './transport';
import type { DecodeContext, DecodedTurn } from './turn';
import { ProviderError, type AdapterOptions, type JsonRequest, type ProviderAdapter } from './types';

/**
 * The OpenRouter adapter — one key, most of the free open-weight models.
 *
 * OpenRouter speaks the same OpenAI chat-completions dialect as Groq, so this
 * file compiles and decodes through `groq.ts` and adds nothing a model can see:
 * the request body is byte-for-byte what `compileGroqRequest` builds — the same
 * tools, the same `tool_choice: "required"`, the same `parallel_tool_calls:
 * false`. `equivalence.test.ts` pins that, so OpenRouter inherits Groq's proof
 * against Gemini rather than needing one of its own.
 *
 * ── What is OpenRouter's own ───────────────────────────────────────────────
 * The endpoint, and one failure shape: a 200 that carries an `error` — the
 * upstream model host failed after OpenRouter accepted the request. That is the
 * serving stack's failure, not the model's, so it throws `ProviderError` like
 * any other transport failure rather than costing the model a turn.
 *
 * A transient upstream failure — "service temporarily overloaded", an upstream
 * 429 or 5xx — can arrive inside a 200, where the shared transport, which
 * retries on HTTP status, cannot see it. `postWithUpstreamRetry` retries those
 * with the same policy and backoff, and counts every attempt, so a brief
 * overload does not end a race. Only the successful attempt is timed, as always.
 *
 * `parallel_tool_calls` is not honoured by every upstream. A model that makes
 * two calls anyway is scored `multiple_tool_calls` by the shared decoder — the
 * same rule, and the same turn charged, as on Groq and Gemini.
 */

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** The live model list — public, no key. Read by `catalogue.ts`, which names no host itself. */
export const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

export const compileOpenRouterRequest = compileGroqRequest;
export const compileOpenRouterJsonRequest = compileGroqJsonRequest;

interface OpenRouterBody {
  error?: { message?: string; code?: unknown };
  choices?: { error?: { message?: string }; finish_reason?: string }[];
}

/** A 2xx whose body says the upstream failed. The message is redacted and clipped by `errorExcerpt`. */
function upstreamFailure(status: number, json: unknown, secrets: readonly string[], attempts: number): ProviderError | null {
  if (status < 200 || status >= 300) return null;
  const body = (json ?? {}) as OpenRouterBody;
  const choiceError = body.choices?.[0]?.error;
  if (body.error === undefined && choiceError === undefined) return null;
  const detail = errorExcerpt(body.error !== undefined ? body : { error: choiceError }, secrets) || 'upstream error';
  return new ProviderError('openrouter', status, attempts, detail);
}

/** Statuses the transport already retried; a failure with one of these has used its retries. */
const TRANSPORT_RETRIED = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Whether a response's error is the upstream being briefly unavailable, not a refusal. */
export function isTransientUpstream(status: number, json: unknown): boolean {
  if (TRANSPORT_RETRIED.has(status)) return false;
  const body = (json ?? {}) as OpenRouterBody;
  const error = body.error ?? body.choices?.[0]?.error;
  if (error === undefined) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number' && TRANSIENT_CODES.has(code)) return true;
  return /overloaded|temporarily|try again|rate.?limit/i.test(String(error.message ?? ''));
}

async function postWithUpstreamRetry(
  headers: Readonly<Record<string, string>>,
  body: unknown,
  deps: TransportDeps,
): Promise<PostResult> {
  const retry = deps.retry ?? DEFAULT_RETRY;
  let attempts = 0;
  for (let round = 1; ; round += 1) {
    const result = await postJson('openrouter', OPENROUTER_ENDPOINT, headers, body, deps);
    attempts += result.attempts;
    if (!isTransientUpstream(result.status, result.json) || round > retry.maxRetries) return { ...result, attempts };
    await deps.sleep(Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** (round - 1)));
  }
}

export function decodeOpenRouterResponse(status: number, json: unknown, context: DecodeContext): DecodedTurn {
  const failure = upstreamFailure(status, json, context.secrets ?? [], context.attempts ?? 1);
  if (failure !== null) throw failure;
  return decodeGroqResponse(status, json, { ...context, provider: 'openrouter' });
}

export function decodeOpenRouterJsonResponse(
  status: number,
  json: unknown,
  { secrets = [], attempts = 1 }: Pick<DecodeContext, 'secrets' | 'attempts'>,
): DecodedJson {
  const failure = upstreamFailure(status, json, secrets, attempts);
  if (failure !== null) throw failure;
  return decodeGroqJsonResponse(status, json, { secrets, attempts, provider: 'openrouter' });
}

export function createOpenRouterAdapter({ apiKey, modelId, params, deps = DEFAULT_DEPS }: AdapterOptions): ProviderAdapter {
  let calls = 0;
  return {
    provider: 'openrouter',
    modelId,
    async act(request) {
      const index = calls++;
      const headers = { authorization: `Bearer ${apiKey}` };
      const body = compileOpenRouterRequest(request, { modelId, params });
      const result = await postWithUpstreamRetry(headers, body, deps);
      const decoded = decodeOpenRouterResponse(result.status, result.json, {
        callIndex: index,
        secrets: [apiKey],
        attempts: result.attempts,
      });
      return { ...decoded, latencyMs: result.latencyMs, attempts: result.attempts };
    },
  };
}

/** For `generation.ts`: one JSON document, through the same endpoint. */
export async function completeOpenRouterJson(
  apiKey: string,
  modelId: string,
  params: AdapterOptions['params'],
  request: JsonRequest,
  deps = DEFAULT_DEPS,
) {
  const headers = { authorization: `Bearer ${apiKey}` };
  const body = compileOpenRouterJsonRequest(request, { modelId, params });
  const result = await postWithUpstreamRetry(headers, body, deps);
  const decoded = decodeOpenRouterJsonResponse(result.status, result.json, { secrets: [apiKey], attempts: result.attempts });
  return { ...decoded, latencyMs: result.latencyMs, attempts: result.attempts };
}
