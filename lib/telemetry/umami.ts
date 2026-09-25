import type { TelemetryConfig } from './config';
import type { TelemetryEvent } from './events';

/**
 * Umami Cloud — TICKET-11 (#11). The only file that names the telemetry host,
 * and one of two (with `readout.ts`) that may call `fetch`
 * (`lib/telemetry/boundary.test.ts`). `docs/decisions/telemetry.md` records why
 * Umami, and why no tracker script.
 *
 * ── Four fields, by construction ───────────────────────────────────────────
 * The page does not load Umami's `script.js`, which would send referrer,
 * screen, language and title on its own. It posts a payload built field by
 * field here: the website id, the hostname, the run's path and the event name.
 * `url` is built from the run id, never read from `location`, so no query
 * string or fragment can leave the page. No cookie, no visitor id, no storage.
 *
 * ── Fire and forget ────────────────────────────────────────────────────────
 * The transport returns nothing, never throws, never retries and never logs.
 * `keepalive` lets a beacon started just before the tab closes still land.
 */

export const UMAMI_SEND_URL = 'https://cloud.umami.is/api/send';
export const UMAMI_API_BASE = 'https://api.umami.is/v1';

/** The whole of what a beacon says. `umami.test.ts` and the e2e spec pin it. */
export const UMAMI_PAYLOAD_KEYS = ['website', 'hostname', 'url', 'name'] as const;

export interface TelemetryPage {
  readonly hostname: string;
  readonly runId: string;
}

export interface UmamiEventBody {
  readonly type: 'event';
  readonly payload: {
    readonly website: string;
    readonly hostname: string;
    readonly url: string;
    readonly name: TelemetryEvent;
  };
}

export function runPath(runId: string): string {
  return `/run/${runId}`;
}

export function buildUmamiPayload(config: TelemetryConfig, event: TelemetryEvent, page: TelemetryPage): UmamiEventBody {
  return {
    type: 'event',
    payload: { website: config.websiteId, hostname: page.hostname, url: runPath(page.runId), name: event },
  };
}

export interface SendDeps {
  readonly fetch: typeof fetch;
}

// Bound lazily, so importing this module never captures a missing or unbound `fetch`.
const DEFAULT_SEND_DEPS: SendDeps = { fetch: (...args) => globalThis.fetch(...args) };

export function createUmamiTransport(
  config: TelemetryConfig,
  page: TelemetryPage,
  deps: SendDeps = DEFAULT_SEND_DEPS,
): (event: TelemetryEvent) => void {
  return (event) => {
    deps
      .fetch(UMAMI_SEND_URL, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildUmamiPayload(config, event, page)),
      })
      .catch(() => {
        // A lost beacon is a lost count, never a broken replay.
      });
  };
}
