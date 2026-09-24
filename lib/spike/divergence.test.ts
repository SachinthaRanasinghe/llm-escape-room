import { describe, expect, it } from 'vitest';
import { loadCanonicalRun } from '@/fixtures';
import type { EndReason, Run, RunSummary } from '@/lib/schema/run';
import { divergenceOf } from './divergence';

const base = loadCanonicalRun();

function summary(competitorId: string, escapeActionCount: number | null, endedBecause?: EndReason): RunSummary {
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
    endedBecause: endedBecause ?? (escaped ? 'escaped' : 'budget_actions'),
  };
}

function run(a: number | null, b: number | null, endB?: EndReason): Run {
  return { ...base, summaries: [summary('model-a', a), summary('model-b', b, endB)] };
}

describe('divergenceOf', () => {
  it('reads the golden run as one escaper — model-a out in 13, model-b stuck', () => {
    expect(divergenceOf(base)).toEqual({ eligible: true, diverged: true, reason: 'one_escaped' });
  });

  it('calls one escaper a divergence whichever side escaped', () => {
    expect(divergenceOf(run(null, 9)).reason).toBe('one_escaped');
  });

  it('calls a gap above 25% a divergence', () => {
    expect(divergenceOf(run(8, 11))).toEqual({ eligible: true, diverged: true, reason: 'action_gap' });
  });

  it('does not call exactly 25% a divergence — the PRD says more than', () => {
    expect(divergenceOf(run(8, 10))).toEqual({ eligible: true, diverged: false, reason: 'same' });
  });

  it('calls both stuck no divergence, but eligible', () => {
    expect(divergenceOf(run(null, null))).toEqual({ eligible: true, diverged: false, reason: 'neither_escaped' });
  });

  it('excludes a run a token or time budget stopped — not play', () => {
    expect(divergenceOf(run(9, null, 'budget_tokens')).reason).toBe('ineligible');
    expect(divergenceOf(run(9, null, 'budget_time'))).toEqual({ eligible: false, diverged: false, reason: 'ineligible' });
  });

  it('refuses a run that is not a duel', () => {
    expect(() => divergenceOf({ ...base, summaries: [summary('model-a', 3)] })).toThrow(RangeError);
  });
});
