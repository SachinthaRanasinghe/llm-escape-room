import { TELEMETRY_EVENTS, type TelemetryEvent } from './events';

/**
 * The watch-through funnel — TICKET-11 (#11). Event counts in, the PRD's two
 * demand numbers out: 30-second survival and watch-through, both as a share of
 * opens. Pure; `scripts/watch-through.mts` prints it.
 *
 * A rate is `null` when there were no opens — never `NaN`, and never 0, which
 * would read as "everyone left".
 */

/** `llm-escape-room.prd.md` → Success metrics · Watch-through: "≥ 50% of opens". Inclusive. */
export const WATCH_THROUGH_TARGET = 0.5;

export type EventCounts = Partial<Record<TelemetryEvent, number>>;

export interface Funnel {
  readonly opens: number;
  readonly t30: number;
  readonly complete: number;
  readonly skip: number;
  readonly survival30: number | null;
  readonly watchThrough: number | null;
  readonly meetsTarget: boolean | null;
}

export function summariseFunnel(counts: Readonly<Record<string, number | undefined>>): Funnel {
  const known = new Set<string>(TELEMETRY_EVENTS);
  const count = (event: TelemetryEvent): number => (known.has(event) ? (counts[event] ?? 0) : 0);
  const opens = count('run-open');
  const t30 = count('run-t30');
  const complete = count('run-complete');
  const watchThrough = opens === 0 ? null : complete / opens;
  return {
    opens,
    t30,
    complete,
    skip: count('run-skip'),
    survival30: opens === 0 ? null : t30 / opens,
    watchThrough,
    meetsTarget: watchThrough === null ? null : watchThrough >= WATCH_THROUGH_TARGET,
  };
}
