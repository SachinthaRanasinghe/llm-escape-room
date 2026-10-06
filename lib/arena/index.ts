/**
 * The Energy Cores arena — `docs/decisions/arena.md`.
 *
 * A three-player game beside the escape room, on the same provider adapters.
 * What `lib/race/arena.ts` and `scripts/arena.mts` import:
 *
 *   const adapters = { 'player-a': createAdapter(a, readProviderKey(a.provider)), … };
 *   const { result, events } = await runMatch({ matchId, players: [a, b, c], adapters, deps: { now: realClock } });
 *
 * `testing.ts` is deliberately not exported, as in `lib/harness`.
 */
export { runMatch, MatchAbortedError, DEFAULT_ROUNDS, DEFAULT_MATCH_WALL_CLOCK_MS } from './match';
export type { MatchOptions, MatchResult, ArenaEventObserver, ThinkingObserver } from './match';
export { createArena, turnOrder, ArenaError } from './engine';
export type { Arena, ArenaSnapshot, DecideResult, AnswerResult, PlayerTally } from './engine';
export { buildArenaResult, coresAfter, partialStandings, standingsFrom, winnersOf, OPENING_CENTRE } from './standings';
export { arenaSystemPrompt, publicTurn } from './prompt';
export { ANSWER_TOOLS, DECISION_TOOLS } from './tools';
export {
  ARENA_END_REASONS,
  ARENA_VERDICT_CODES,
  ArenaActionSchema,
  ArenaAnswerSchema,
  ArenaEventSchema,
  ArenaResultSchema,
  ArenaSchemaError,
  PLAYER_IDS,
  QUESTION_CATEGORIES,
  QUESTION_TIERS,
  TOTAL_CORES,
  TURN_OUTCOMES,
  parseArenaEvent,
  parseArenaResult,
} from './schema';
export type {
  ArenaAction,
  ArenaAnswer,
  ArenaEndReason,
  ArenaEvent,
  ArenaResult,
  ArenaStanding,
  ArenaVerdict,
  PlayerId,
  QuestionCategory,
  QuestionTier,
  TurnOutcome,
} from './schema';
export { BANK } from './questions/bank';
export { gradeAnswer } from './questions/grade';
export type { Question, AnswerKey } from './questions/types';

import { BANK } from './questions/bank';

/** A question's text, for showing a viewer what was asked. Never its key. */
export function questionText(id: string): string | null {
  return BANK.find((q) => q.id === id)?.prompt ?? null;
}
