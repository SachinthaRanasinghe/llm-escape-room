import { z } from 'zod';
import { TELEMETRY_EVENTS, type TelemetryEvent } from './events';
import type { EventCounts } from './funnel';
import { runPath, UMAMI_API_BASE } from './umami';

/**
 * Reading the counts back — TICKET-11 (#11). A small client for the Umami Cloud
 * read API, used only by `scripts/watch-through.mts`. SCRIPT-SIDE ONLY: it takes
 * the API key as an argument, like the provider adapters, and never reads the
 * environment itself.
 *
 *   GET {UMAMI_API_BASE}/websites/:id/metrics?type=event&startAt&endAt&path=/run/<id>
 *   → [{ x: eventName, y: count }]
 *
 * Errors name a reason and a status, never the key and never the response body.
 */

export const TELEMETRY_READ_ERROR_REASONS = ['http', 'shape'] as const;
export type TelemetryReadErrorReason = (typeof TELEMETRY_READ_ERROR_REASONS)[number];

export class TelemetryReadError extends Error {
  readonly reason: TelemetryReadErrorReason;
  readonly status: number;

  constructor(reason: TelemetryReadErrorReason, status: number) {
    super(`telemetry read: ${reason} (status ${status})`);
    this.name = 'TelemetryReadError';
    this.reason = reason;
    this.status = status;
  }
}

export interface ReadQuery {
  readonly apiKey: string;
  readonly websiteId: string;
  readonly runId: string;
  readonly startAt: number;
  readonly endAt: number;
}

export interface ReadDeps {
  readonly fetch: typeof fetch;
}

const DEFAULT_READ_DEPS: ReadDeps = { fetch: (...args) => globalThis.fetch(...args) };

const MetricsSchema = z.array(z.object({ x: z.string(), y: z.number() }));

export async function fetchRunEventCounts(query: ReadQuery, deps: ReadDeps = DEFAULT_READ_DEPS): Promise<EventCounts> {
  const params = new URLSearchParams({
    type: 'event',
    startAt: String(query.startAt),
    endAt: String(query.endAt),
    path: runPath(query.runId),
  });
  const url = `${UMAMI_API_BASE}/websites/${encodeURIComponent(query.websiteId)}/metrics?${params}`;
  const response = await deps.fetch(url, { headers: { Authorization: `Bearer ${query.apiKey}`, Accept: 'application/json' } });
  if (!response.ok) throw new TelemetryReadError('http', response.status);

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new TelemetryReadError('shape', response.status);
  }
  const rows = MetricsSchema.safeParse(json);
  if (!rows.success) throw new TelemetryReadError('shape', response.status);

  const known = new Set<string>(TELEMETRY_EVENTS);
  const counts: EventCounts = {};
  for (const { x, y } of rows.data) {
    if (known.has(x)) counts[x as TelemetryEvent] = y;
  }
  return counts;
}
