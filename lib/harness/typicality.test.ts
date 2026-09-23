import { describe, expect, it } from 'vitest';
import { loadCanonicalRun } from '@/fixtures';
import type { Run, RunSummary } from '@/lib/schema/run';
import { isTypical, outcomeOf } from './typicality';

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

/** A run where model-a escaped in `a` actions and model-b in `b` (null = did not escape). */
function run(a: number | null, b: number | null): Run {
  return { ...base, summaries: [summary('model-a', a), summary('model-b', b)] };
}

const A = run(10, null);
const B = run(null, 12);
const TIE = run(11, 11);
const NONE = run(null, null);

describe('outcomeOf', () => {
  it('names the only escaper', () => {
    expect(outcomeOf(A)).toEqual({ kind: 'winner', competitorId: 'model-a' });
  });

  it('picks the fewer actions when both escape', () => {
    expect(outcomeOf(run(13, 9))).toEqual({ kind: 'winner', competitorId: 'model-b' });
  });

  it('calls equal action counts a tie, whatever the milliseconds', () => {
    expect(outcomeOf(TIE)).toEqual({ kind: 'tie' });
  });

  it('says none when nobody escaped', () => {
    expect(outcomeOf(NONE)).toEqual({ kind: 'none' });
  });

  it('reads the golden run as model-a winning', () => {
    expect(outcomeOf(base)).toEqual({ kind: 'winner', competitorId: 'model-a' });
  });
});

describe('isTypical', () => {
  it('is null with no repeats', () => {
    expect(isTypical(A, [])).toBeNull();
  });

  it('is true when the repeats agree with the hero', () => {
    expect(isTypical(A, [A, A, run(9, 14)])).toBe(true);
  });

  it('is false when the hero is the odd one out', () => {
    expect(isTypical(A, [B, B, A])).toBe(false);
  });

  it('counts either side of a tied mode as typical', () => {
    expect(isTypical(A, [A, B])).toBe(true);
    expect(isTypical(B, [A, B])).toBe(true);
    expect(isTypical(NONE, [A, B])).toBe(false);
  });

  it('treats tie and none as outcomes in their own right', () => {
    expect(isTypical(TIE, [TIE, TIE, A])).toBe(true);
    expect(isTypical(NONE, [A, A, NONE])).toBe(false);
  });
});
