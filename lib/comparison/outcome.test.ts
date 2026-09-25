import { describe, expect, it } from 'vitest';
import { loadCanonicalRun } from '@/fixtures';
import type { Run, RunSummary } from '@/lib/schema/run';
import { isTypical, outcomeKey, outcomeOf, tallyOutcomes, typicalOf, type Outcome } from './outcome';

const base = loadCanonicalRun();

function summary(competitorId: string, escapeActionCount: number | null): RunSummary {
  const escaped = escapeActionCount !== null;
  return {
    competitorId,
    escaped,
    escapeActionCount,
    escapeMs: escaped ? 20_000 : null,
    puzzlesSolved: escaped ? 3 : 1,
    failedAttempts: 0,
    invalidActions: 0,
    tokens: { prompt: 1, completion: 1 },
    costUsd: 0,
    endedBecause: escaped ? 'escaped' : 'budget_actions',
  };
}

function run(a: number | null, b: number | null): Run {
  return { ...base, summaries: [summary('model-a', a), summary('model-b', b)] };
}

const A = run(10, null);
const B = run(null, 12);
const TIE = run(11, 11);
const NONE = run(null, null);

const WIN_A: Outcome = { kind: 'winner', competitorId: 'model-a' };
const WIN_B: Outcome = { kind: 'winner', competitorId: 'model-b' };

describe('outcomeKey', () => {
  it('is stable for each kind', () => {
    expect(outcomeKey(WIN_A)).toBe('winner:model-a');
    expect(outcomeKey({ kind: 'tie' })).toBe('tie');
    expect(outcomeKey({ kind: 'none' })).toBe('none');
  });
});

describe('tallyOutcomes', () => {
  it('is empty for no repeats', () => {
    expect(tallyOutcomes([])).toEqual([]);
  });

  it('counts, most common first', () => {
    expect(tallyOutcomes([B, A, A])).toEqual([
      { outcome: WIN_A, count: 2 },
      { outcome: WIN_B, count: 1 },
    ]);
  });

  it('breaks count ties by key, so the order does not depend on run order', () => {
    expect(tallyOutcomes([B, A])).toEqual(tallyOutcomes([A, B]));
    expect(tallyOutcomes([B, A])[0]!.outcome).toEqual(WIN_A);
  });

  it('counts ties and no-escapes as outcomes of their own', () => {
    expect(tallyOutcomes([NONE, TIE, NONE])).toEqual([
      { outcome: { kind: 'none' }, count: 2 },
      { outcome: { kind: 'tie' }, count: 1 },
    ]);
  });
});

describe('typicalOf agrees with isTypical', () => {
  const cases: [string, Run, Run[]][] = [
    ['no repeats', A, []],
    ['in the mode', A, [A, A, B]],
    ['out of the mode', B, [A, A, B]],
    ['a 1–1–1 split', A, [A, B, TIE]],
    ['absent from the repeats', NONE, [A, A]],
    ['a tie hero in a tie mode', TIE, [TIE, A]],
  ];
  for (const [name, hero, repeats] of cases) {
    it(name, () => {
      expect(typicalOf(outcomeOf(hero), tallyOutcomes(repeats))).toBe(isTypical(hero, repeats));
    });
  }

  it('gives the expected verdicts', () => {
    expect(typicalOf(WIN_A, [])).toBeNull();
    expect(isTypical(A, [A, B, TIE])).toBe(true);
    expect(isTypical(B, [A, A, B])).toBe(false);
  });
});
