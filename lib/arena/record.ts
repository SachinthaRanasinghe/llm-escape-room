import type { ProviderTurn } from '@/lib/providers';
import { describeRejection } from '@/lib/harness/record';
import type { AnswerResult, ArenaSnapshot, DecideResult } from './engine';
import { ArenaEventSchema, PLAYER_IDS, type ArenaEvent, type PlayerId } from './schema';

/**
 * The one place a turn becomes an `ArenaEvent` — the arena's `lib/harness/record.ts`.
 *
 * Field by field, never by spreading: a `ProviderTurn` carries Gemini's opaque
 * `native` data and a `Question` carries its answer key, and neither belongs in
 * the record. A malformed call gets the harness's own `rejected` block — what
 * the model sent, cut short, and an intent only if the model wrote one.
 */

export interface ArenaEventContext {
  readonly matchId: string;
  readonly seq: number;
  readonly round: number;
  readonly playerId: PlayerId;
  /** ISO 8601, stamped by the match clock when the turn resolved. */
  readonly at: string;
}

export interface Phase<R> {
  readonly turn: ProviderTurn;
  readonly result: R;
}

function targetOf(decision: DecideResult): PlayerId | null {
  const action = decision.action;
  if (action === null || action.name !== 'steal') return null;
  return PLAYER_IDS.find((id) => id === action.targetId) ?? null;
}

export function buildArenaEvent(
  context: ArenaEventContext,
  decide: Phase<DecideResult>,
  answer: Phase<AnswerResult> | null,
  after: ArenaSnapshot,
): ArenaEvent {
  const outcome = decide.result.outcome ?? answer?.result.outcome;
  if (outcome === undefined) throw new Error(`${context.playerId}: a turn with a question needs its answer before it is recorded`);
  const turns = answer === null ? [decide.turn] : [decide.turn, answer.turn];

  return ArenaEventSchema.parse({
    matchId: context.matchId,
    seq: context.seq,
    round: context.round,
    playerId: context.playerId,
    decision: {
      action: decide.result.action,
      ...(decide.result.action === null ? { rejected: describeRejection(decide.turn) } : {}),
      verdict: decide.result.verdict,
    },
    question:
      decide.result.question === null
        ? null
        : { id: decide.result.question.id, category: decide.result.question.category, tier: decide.result.question.tier },
    answer:
      answer === null
        ? null
        : {
            given: answer.result.given,
            ...(answer.result.given === null ? { rejected: describeRejection(answer.turn) } : {}),
            verdict: answer.result.verdict,
            expected: answer.result.expected,
          },
    outcome,
    targetId: targetOf(decide.result),
    eliminated: answer?.result.eliminated ?? null,
    cores: { ...after.cores },
    centre: after.centre,
    latencyMs: Math.round(turns.reduce((sum, t) => sum + t.latencyMs, 0)),
    tokens: {
      prompt: turns.reduce((sum, t) => sum + t.tokens.prompt, 0),
      completion: turns.reduce((sum, t) => sum + t.tokens.completion, 0),
    },
    at: context.at,
  });
}
