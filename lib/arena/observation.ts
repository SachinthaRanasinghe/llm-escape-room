import type { Question } from './questions/types';
import type { PlayerId, QuestionCategory, QuestionTier } from './schema';

/**
 * What one player may know — the arena's secrecy boundary, as
 * `lib/sim/observation.ts` is the room's.
 *
 * Built field by field from the engine's state, never by spreading it: the
 * pending question carries its answer key, and a spread would carry the key
 * into the prompt the day someone adds a field. The question's text is here only
 * for the player who must answer it.
 */

export interface PlayerView {
  readonly id: PlayerId;
  readonly cores: number;
  readonly eliminated: boolean;
}

export interface PendingView {
  readonly action: 'claim' | 'steal';
  readonly targetId: PlayerId | null;
  readonly question: { readonly id: string; readonly category: QuestionCategory; readonly tier: QuestionTier; readonly prompt: string };
}

export interface ArenaObservation {
  readonly you: PlayerId;
  readonly round: number;
  readonly maxRounds: number;
  readonly centre: number;
  /** In `PLAYER_IDS` order. */
  readonly players: readonly PlayerView[];
  /** Set only for the player whose question is waiting for an answer. */
  readonly pending: PendingView | null;
}

export interface ObservedState {
  readonly round: number;
  readonly maxRounds: number;
  readonly centre: number;
  readonly cores: Readonly<Record<PlayerId, number>>;
  readonly eliminated: Readonly<Record<PlayerId, number | null>>;
  readonly pending: { readonly playerId: PlayerId; readonly action: 'claim' | 'steal'; readonly targetId: PlayerId | null; readonly question: Question } | null;
}

export function observe(state: ObservedState, you: PlayerId, order: readonly PlayerId[]): ArenaObservation {
  const pending = state.pending !== null && state.pending.playerId === you ? state.pending : null;
  return {
    you,
    round: state.round,
    maxRounds: state.maxRounds,
    centre: state.centre,
    players: order.map((id) => ({ id, cores: state.cores[id], eliminated: state.eliminated[id] !== null })),
    pending:
      pending === null
        ? null
        : {
            action: pending.action,
            targetId: pending.targetId,
            question: {
              id: pending.question.id,
              category: pending.question.category,
              tier: pending.question.tier,
              prompt: pending.question.prompt,
            },
          },
  };
}
