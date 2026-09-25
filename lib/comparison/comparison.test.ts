import { describe, expect, it } from 'vitest';
import { loadCanonicalRun } from '@/fixtures';
import { findLeaks } from '@/lib/artifact/scan';
import type { Run, RunSummary } from '@/lib/schema/run';
import { buildComparison, ESCAPE_TIME_NOTE, formatCost, LIMITATION, type ComparisonInput } from './comparison';
import { outcomeOf, tallyOutcomes, typicalOf } from './outcome';

const canonical = loadCanonicalRun();
const NO_REPEATS = { completed: 0, dropped: 0, outcomes: [] };
const ACTIONS = { 'model-a': 13, 'model-b': 14 };

function input(partial: Partial<ComparisonInput> = {}): ComparisonInput {
  return { run: canonical, repeats: NO_REPEATS, actionsTaken: ACTIONS, puzzleCount: 3, ...partial };
}

function summary(competitorId: string, actions: number | null): RunSummary {
  const escaped = actions !== null;
  return {
    competitorId,
    escaped,
    escapeActionCount: actions,
    escapeMs: escaped ? 20_000 : null,
    puzzlesSolved: escaped ? 3 : 1,
    failedAttempts: 0,
    invalidActions: 0,
    tokens: { prompt: 1, completion: 1 },
    costUsd: 0,
    endedBecause: escaped ? 'escaped' : 'budget_actions',
  };
}

/** A run where model-a escaped in `a` actions and model-b in `b` (null = did not). */
function run(a: number | null, b: number | null): Run {
  return { ...canonical, summaries: [summary('model-a', a), summary('model-b', b)], typicalOfRepeats: null };
}

const A = run(10, null);
const B = run(null, 12);
const TIE = run(11, 11);
const NONE = run(null, null);

/** The canonical hero (model-a won) published with these repeats, verdict set consistently. */
function withRepeats(repeats: Run[], dropped = 0): ComparisonInput {
  const outcomes = tallyOutcomes(repeats);
  return input({
    run: { ...canonical, typicalOfRepeats: typicalOf(outcomeOf(canonical), outcomes) },
    repeats: { completed: repeats.length, dropped, outcomes },
  });
}

describe('the canonical run', () => {
  const data = buildComparison(input());
  const [a, b] = data.rows;

  it('lays out model-a, the winner', () => {
    expect(a).toEqual({
      competitorId: 'model-a',
      label: 'competitor-a',
      provider: 'groq',
      escaped: true,
      isWinner: true,
      result: 'Escaped in 13 actions',
      escapeTime: '25.4 s',
      actions: '13 / 14',
      puzzles: '3 of 3',
      failedAttempts: 0,
      invalidActions: 0,
      tokens: '22,151',
      tokensDetail: '21,580 in · 571 out',
      cost: '$0.00',
    });
  });

  it('lays out model-b, who ran out of actions — actions come from the log, not the null escape count', () => {
    expect(b).toMatchObject({
      isWinner: false,
      escaped: false,
      result: 'Out of actions',
      escapeTime: '—',
      actions: '14 / 14',
      puzzles: '2 of 3',
      failedAttempts: 2,
      invalidActions: 1,
      tokens: '24,846',
      tokensDetail: '24,220 in · 626 out',
    });
  });

  it('heads it with the winner, judged by actions', () => {
    expect(data.headline).toBe('competitor-a wins — escaped in 13 actions');
  });

  it('says plainly that it was not checked for luck', () => {
    expect(data.variance).toEqual({
      kind: 'unrepeated',
      title: 'Not checked for luck',
      body: 'This room has not been re-run yet, so there is no telling whether this result is typical. Treat it as one sample.',
    });
  });

  it('states the nondeterminism limitation and what escape time measures', () => {
    expect(data.limitation).toBe(LIMITATION);
    expect(data.limitation).toMatch(/^Models are nondeterministic\./);
    expect(data.limitation).toContain('one run is one sample, not a verdict');
    expect(data.escapeTimeNote).toBe(ESCAPE_TIME_NOTE);
    expect(data.escapeTimeNote).toContain('The winner is decided by actions.');
  });

  it('is plain JSON — it crosses from a server page to a client component', () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('carries nothing shaped like a URL or a key', () => {
    expect(findLeaks(JSON.stringify(data))).toEqual([]);
  });
});

describe('the variance statement, every branch', () => {
  it('typical, with its counts', () => {
    expect(buildComparison(withRepeats([A, A, B])).variance).toEqual({
      kind: 'typical',
      title: 'Typical of its silent repeats',
      body: 'The same room was re-run 3 more times without being shown, and competitor-a won in 2 of 3.',
    });
  });

  it('typical in a split admits it is not a clear pattern', () => {
    expect(buildComparison(withRepeats([A, B])).variance.body).toBe(
      'The same room was re-run 2 more times without being shown, and competitor-a won in 1 of 2. ' +
        'competitor-b won just as often, so this is not a clear pattern.',
    );
    expect(buildComparison(withRepeats([A, B, NONE])).variance.body).toBe(
      'The same room was re-run 3 more times without being shown, and competitor-a won in 1 of 3. ' +
        'Other outcomes came up just as often, so this is not a clear pattern.',
    );
    expect(buildComparison(withRepeats([A, NONE])).variance.body).toBe(
      'The same room was re-run 2 more times without being shown, and competitor-a won in 1 of 2. ' +
        'Neither escaped just as often, so this is not a clear pattern.',
    );
  });

  it('atypical, naming what usually happens — even when the hero outcome never recurred', () => {
    expect(buildComparison(withRepeats([B, B, B])).variance).toEqual({
      kind: 'atypical',
      title: 'Not typical of its silent repeats',
      body: 'The same room was re-run 3 more times without being shown. competitor-a won in 0 of 3; competitor-b won in 3 of 3.',
    });
    expect(buildComparison(withRepeats([A, TIE, TIE])).variance.body).toBe(
      'The same room was re-run 3 more times without being shown. competitor-a won in 1 of 3; they tied in 2 of 3.',
    );
  });

  it('singular: one repeat, one dropped', () => {
    expect(buildComparison(withRepeats([A], 1)).variance.body).toBe(
      'The same room was re-run 1 more time without being shown, and competitor-a won in 1 of 1. ' +
        '1 more re-run stopped on a provider error and is not counted.',
    );
  });

  it('plural dropped repeats are counted, not explained', () => {
    expect(buildComparison(withRepeats([B, B], 2)).variance.body).toBe(
      'The same room was re-run 2 more times without being shown. competitor-a won in 0 of 2; competitor-b won in 2 of 2. ' +
        '2 more re-runs stopped on a provider error and are not counted.',
    );
  });

  it('every repeat dropped is still "not checked"', () => {
    expect(buildComparison(input({ repeats: { completed: 0, dropped: 3, outcomes: [] } })).variance).toEqual({
      kind: 'all_dropped',
      title: 'Not checked for luck',
      body:
        'All 3 silent re-runs of this room stopped on a provider error, so there is no telling whether this result is ' +
        'typical. Treat it as one sample.',
    });
    expect(buildComparison(input({ repeats: { completed: 0, dropped: 1, outcomes: [] } })).variance.body).toMatch(
      /^All 1 silent re-run of this room/,
    );
  });

  it('refuses to print a statement the verdict contradicts', () => {
    const outcomes = tallyOutcomes([B, B]);
    const lying = input({ run: { ...canonical, typicalOfRepeats: true }, repeats: { completed: 2, dropped: 0, outcomes } });
    expect(() => buildComparison(lying)).toThrow(RangeError);
    const typicalOfNothing = input({ run: { ...canonical, typicalOfRepeats: true } });
    expect(() => buildComparison(typicalOfNothing)).toThrow(RangeError);
  });
});

describe('headlines', () => {
  it('a tie', () => {
    expect(buildComparison(input({ run: TIE, actionsTaken: { 'model-a': 11, 'model-b': 11 } })).headline).toBe(
      'A tie — both escaped in 11 actions',
    );
    expect(buildComparison(input({ run: TIE })).rows.every((r) => !r.isWinner)).toBe(true);
  });

  it('nobody escaped', () => {
    expect(buildComparison(input({ run: NONE })).headline).toBe('Neither model escaped');
  });

  it('the winner is by actions, not by escape time', () => {
    const slowButFewer: Run = {
      ...run(9, 12),
      summaries: [{ ...summary('model-a', 9), escapeMs: 90_000 }, { ...summary('model-b', 12), escapeMs: 10_000 }],
    };
    const data = buildComparison(input({ run: slowButFewer }));
    expect(data.rows.find((r) => r.isWinner)?.competitorId).toBe('model-a');
  });
});

describe('formatCost', () => {
  it('shows free as free, and never rounds a real cost down to zero', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.001)).toBe('<$0.01');
    expect(formatCost(0.123)).toBe('$0.12');
    expect(formatCost(2)).toBe('$2.00');
  });
});
