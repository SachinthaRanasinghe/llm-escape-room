import type { ProviderTurn } from '@/lib/providers';
import { EventSchema, RAW_EXCERPT_MAX, type Event, type Rejected } from '@/lib/schema/event';
import { LOG_VERSION } from '@/lib/schema/version';
import type { ApplyResult } from '@/lib/sim';

/**
 * The one place a turn becomes an `Event` — TICKET-6 (#7).
 *
 * ── Field by field, never by spreading ─────────────────────────────────────
 * A `ProviderTurn` carries `toolCall.native` — Gemini's `thoughtSignature`,
 * opaque provider data that must round-trip to the provider and must never be
 * published. Spreading the turn into an event would carry it along the day
 * someone loosens the schema. So every field is named below, the same
 * discipline `lib/sim/observation.ts` uses for secrets.
 *
 * ── The model's words, or nothing ──────────────────────────────────────────
 * On a malformed turn the event gets `action: null` and a `rejected` block.
 * `rejected.raw` is what the model sent, cut short. `rejected.intent` is lifted
 * only when the model's own payload carried an intent the schema would accept,
 * untouched. The harness never writes an intent for a model: the PRD names
 * summarising the model as a misrepresentation risk.
 */

export interface EventContext {
  readonly runId: string;
  readonly competitorId: string;
  readonly seq: number;
  /** ISO 8601, stamped by the harness clock after the turn resolved. */
  readonly at: string;
}

const ELLIPSIS = '…';

function excerpt(text: string): string {
  return text.length <= RAW_EXCERPT_MAX ? text : `${text.slice(0, RAW_EXCERPT_MAX - ELLIPSIS.length)}${ELLIPSIS}`;
}

/** `JSON.stringify` can throw (cycles, BigInt) or return `undefined`; neither may stop a run. */
function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** An intent the model actually wrote, if its payload has one the schema would take as-is. */
function liftIntent(rawAction: unknown): string | null {
  if (typeof rawAction !== 'object' || rawAction === null || Array.isArray(rawAction)) return null;
  const intent = (rawAction as Record<string, unknown>).intent;
  return typeof intent === 'string' && intent.length >= 1 && intent.length <= 280 ? intent : null;
}

export function describeRejection(turn: ProviderTurn): Rejected {
  return {
    kind: turn.anomaly ?? 'invalid_arguments',
    raw: excerpt(turn.rawAction === null ? (turn.text ?? '') : stringify(turn.rawAction)),
    intent: liftIntent(turn.rawAction),
  };
}

export function buildEvent(context: EventContext, turn: ProviderTurn, result: ApplyResult): Event {
  return EventSchema.parse({
    logVersion: LOG_VERSION,
    runId: context.runId,
    competitorId: context.competitorId,
    seq: context.seq,
    action: result.action,
    ...(result.action === null ? { rejected: describeRejection(turn) } : {}),
    verdict: result.verdict,
    // The schema wants an integer; a high-resolution timer delta is fractional.
    latencyMs: Math.round(turn.latencyMs),
    tokens: { prompt: turn.tokens.prompt, completion: turn.tokens.completion },
    at: context.at,
  });
}
