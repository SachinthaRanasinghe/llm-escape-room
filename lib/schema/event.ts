import { z } from 'zod';
import { LOG_VERSION, LogVersionSchema, SchemaError } from './version';
import { ActionSchema, VerdictSchema } from './action';

/**
 * One attempted action, as recorded. The event log is the run.
 *
 * `architecture.md` chose a SEMANTIC log over a render-level one: entries say
 * what happened in room terms, and the renderer interprets them. That is what
 * lets the visuals be rebuilt later without invalidating a published run, and
 * what makes a log readable by a human arguing about a result.
 *
 * ── No pacing in here ──────────────────────────────────────────────────────
 * There is deliberately NO beat index, no camera, no position, no screen
 * duration. The log records `latencyMs` — what the model actually took — and the
 * renderer derives beat timing at replay time from its own tuning. The frozen
 * beat plan for a PUBLISHED run lives in the render manifest (TICKET-9, #9), not
 * here.
 *
 * The reason is concrete: pacing will be retuned while the replay is being
 * designed. If beats lived in the log, every retune would rewrite history and old
 * runs would replay wrong — which is precisely what the render manifest exists to
 * prevent. Resist adding a `beat` field; it belongs to #9.
 *
 * ── Intent lives on the action ─────────────────────────────────────────────
 * `intent` is a required field of every `Action`, so it is NOT repeated at the
 * event level. Storing it twice would let the two copies disagree, and the whole
 * value of an in-band intent is that it cannot drift from the action it explains.
 * Read it as `event.action.intent`.
 */
export const EventSchema = z.strictObject({
  logVersion: LogVersionSchema,
  runId: z.string().min(1),
  competitorId: z.string().min(1),
  /** 0-based, contiguous per competitor. See `assertContiguousSeq`. */
  seq: z.number().int().nonnegative(),
  action: ActionSchema,
  verdict: VerdictSchema,
  /**
   * Real wall-clock time the model took to produce this action, in milliseconds.
   * Displayed as a stat beside the character rather than used as screen duration,
   * so hesitation stays legible without watch length swinging with provider
   * latency.
   */
  latencyMs: z.number().int().nonnegative(),
  tokens: z.strictObject({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
  }),
  /** ISO 8601. When this action was resolved. */
  at: z.iso.datetime(),
});

export type Event = z.infer<typeof EventSchema>;

/**
 * An ordered log. Parsing checks shape only — that each entry is a well-formed
 * event — not that the sequence is coherent. Coherence is `assertContiguousSeq`,
 * kept separate for the same reason the room schema does no referential checking:
 * a caller may legitimately hold a partial log mid-run.
 */
export const EventLogSchema = z.array(EventSchema);
export type EventLog = z.infer<typeof EventLogSchema>;

export class EventLogError extends SchemaError {}

export function parseEventLog(raw: unknown): EventLog {
  const result = EventLogSchema.safeParse(raw);
  if (!result.success) {
    throw new EventLogError(`invalid event log (expected logVersion ${LOG_VERSION})`, result.error.issues);
  }
  return result.data;
}

/**
 * Every competitor's events must run 0, 1, 2… with no gaps and no repeats.
 *
 * A gap means an action went unrecorded, which would make the published action
 * count wrong — and the action count is how escape time is measured. Returns the
 * offending competitor ids rather than throwing, so a caller can report all of
 * them at once.
 */
export function findSeqBreaks(events: readonly Event[]): string[] {
  const bySeq = new Map<string, number[]>();
  for (const event of events) {
    const list = bySeq.get(event.competitorId) ?? [];
    list.push(event.seq);
    bySeq.set(event.competitorId, list);
  }

  const broken: string[] = [];
  for (const [competitorId, seqs] of bySeq) {
    const sorted = [...seqs].sort((a, b) => a - b);
    const contiguous = sorted.every((value, index) => value === index);
    if (!contiguous) broken.push(competitorId);
  }
  return broken;
}
