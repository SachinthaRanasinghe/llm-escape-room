import { costOf, type PriceTable } from '@/lib/harness/pricing';
import type { Competitor } from '@/lib/schema/run';
import {
  ArenaResultSchema,
  PLAYER_IDS,
  TOTAL_CORES,
  type ArenaEndReason,
  type ArenaEvent,
  type ArenaResult,
  type ArenaStanding,
  type PlayerId,
} from './schema';

/**
 * Who won, and how each player did — the one definition, read off the event log.
 *
 * Standings are derived from the events rather than from the engine's counters
 * so a match a provider stopped part-way gets the same numbers from the same
 * code (`partialStandings`). Most cores wins; a shared top count is a tie, and no
 * stat — accuracy, think-time — ever breaks it.
 */

const OPENING: Readonly<Record<PlayerId, number>> = { 'player-a': 1, 'player-b': 1, 'player-c': 1 };
export const OPENING_CENTRE = TOTAL_CORES - PLAYER_IDS.length;

export function winnersOf(cores: Readonly<Record<PlayerId, number>>): { outcome: 'win' | 'tie'; winners: PlayerId[] } {
  const top = Math.max(...PLAYER_IDS.map((id) => cores[id]));
  const winners = PLAYER_IDS.filter((id) => cores[id] === top);
  return { outcome: winners.length === 1 ? 'win' : 'tie', winners };
}

/** Holdings after the last recorded turn — the opening if none was played. */
export function coresAfter(events: readonly ArenaEvent[]): { cores: Record<PlayerId, number>; centre: number } {
  const last = events.at(-1);
  return last === undefined ? { cores: { ...OPENING }, centre: OPENING_CENTRE } : { cores: { ...last.cores }, centre: last.centre };
}

export function standingsFrom(events: readonly ArenaEvent[], players: readonly Competitor[], prices?: PriceTable): ArenaStanding[] {
  const { cores } = coresAfter(events);
  return PLAYER_IDS.map((playerId, index) => {
    const mine = events.filter((e) => e.playerId === playerId);
    const tokens = {
      prompt: mine.reduce((s, e) => s + e.tokens.prompt, 0),
      completion: mine.reduce((s, e) => s + e.tokens.completion, 0),
    };
    const competitor = players[index];
    return {
      playerId,
      cores: cores[playerId],
      eliminatedInRound: events.find((e) => e.eliminated === playerId)?.round ?? null,
      claims: mine.filter((e) => e.outcome === 'claimed').length,
      steals: mine.filter((e) => e.outcome === 'stole').length,
      passes: mine.filter((e) => e.outcome === 'passed').length,
      correct: mine.filter((e) => e.answer?.verdict.code === 'ok').length,
      wrong: mine.filter((e) => e.answer?.verdict.code === 'wrong_answer').length,
      invalid:
        mine.filter((e) => e.decision.verdict.code === 'malformed' || e.decision.verdict.code === 'not_permitted').length +
        mine.filter((e) => e.answer?.verdict.code === 'malformed').length,
      tokens,
      latencyMs: mine.reduce((s, e) => s + e.latencyMs, 0),
      costUsd: competitor === undefined ? 0 : costOf(competitor, tokens, prices).usd,
    };
  });
}

export interface ResultInput {
  readonly matchId: string;
  readonly seed: string;
  readonly players: readonly Competitor[];
  readonly maxRounds: number;
  readonly endedBecause: ArenaEndReason;
  readonly events: readonly ArenaEvent[];
  readonly prices?: PriceTable;
}

export function buildArenaResult({ matchId, seed, players, maxRounds, endedBecause, events, prices }: ResultInput): ArenaResult {
  const standings = standingsFrom(events, players, prices);
  const { outcome, winners } = winnersOf(coresAfter(events).cores);
  return ArenaResultSchema.parse({
    matchId,
    seed,
    players,
    maxRounds,
    roundsPlayed: endedBecause === 'round_cap' ? maxRounds : (events.at(-1)?.round ?? 0),
    endedBecause,
    outcome,
    winners,
    standings,
  });
}

/** The standings of a match stopped part-way. No winner is named: the match did not finish. */
export function partialStandings(events: readonly ArenaEvent[], players: readonly Competitor[], prices?: PriceTable): ArenaStanding[] {
  return standingsFrom(events, players, prices);
}
