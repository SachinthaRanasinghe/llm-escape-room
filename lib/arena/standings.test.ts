import { describe, expect, it } from 'vitest';
import type { Competitor } from '@/lib/schema/run';
import { PLAYER_IDS } from './schema';
import { coresAfter, partialStandings, winnersOf } from './standings';

const players: Competitor[] = PLAYER_IDS.map((id) => ({ id, provider: 'groq', modelId: 'openai/gpt-oss-20b', params: { temperature: null, topP: null } }));

describe('winnersOf', () => {
  it('names the single leader', () => {
    expect(winnersOf({ 'player-a': 1, 'player-b': 3, 'player-c': 0 })).toEqual({ outcome: 'win', winners: ['player-b'] });
  });

  it('calls a shared top count a tie, whatever the other stats say', () => {
    expect(winnersOf({ 'player-a': 2, 'player-b': 2, 'player-c': 1 })).toEqual({ outcome: 'tie', winners: ['player-a', 'player-b'] });
  });
});

describe('partialStandings', () => {
  it('a match stopped before any turn shows the opening', () => {
    expect(coresAfter([])).toEqual({ cores: { 'player-a': 1, 'player-b': 1, 'player-c': 1 }, centre: 2 });
    const standings = partialStandings([], players);
    expect(standings.map((s) => s.cores)).toEqual([1, 1, 1]);
    expect(standings.every((s) => s.costUsd === 0 && s.invalid === 0 && s.eliminatedInRound === null)).toBe(true);
  });
});
