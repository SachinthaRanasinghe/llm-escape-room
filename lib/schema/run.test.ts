import { describe, expect, it } from 'vitest';
import { RUN_VERSION } from './version';
import {
  CompetitorSchema,
  END_REASONS,
  RunError,
  RunSchema,
  RunSummarySchema,
  parseRun,
  type Run,
  type RunSummary,
} from './run';

const escaped: RunSummary = {
  competitorId: 'model-a',
  escaped: true,
  escapeActionCount: 14,
  escapeMs: 41_200,
  puzzlesSolved: 3,
  failedAttempts: 1,
  invalidActions: 0,
  tokens: { prompt: 9_400, completion: 620 },
  costUsd: 0,
  endedBecause: 'escaped',
};

const stalled: RunSummary = {
  competitorId: 'model-b',
  escaped: false,
  escapeActionCount: null,
  escapeMs: null,
  puzzlesSolved: 1,
  failedAttempts: 4,
  invalidActions: 3,
  tokens: { prompt: 12_800, completion: 910 },
  costUsd: 0,
  endedBecause: 'budget_actions',
};

const run: Run = {
  runVersion: RUN_VERSION,
  runId: 'run-1',
  roomId: 'test-room',
  competitors: [
    { id: 'model-a', provider: 'groq', modelId: 'model-a-id', params: { temperature: 0, topP: null } },
    { id: 'model-b', provider: 'groq', modelId: 'model-b-id', params: { temperature: 0, topP: null } },
  ],
  budget: { maxActions: 40, maxTokens: 60_000, maxWallClockMs: 300_000 },
  startedAt: '2026-09-22T10:00:00.000Z',
  summaries: [escaped, stalled],
  typicalOfRepeats: null,
};

describe('RunSchema', () => {
  it('accepts a complete run', () => {
    expect(RunSchema.parse(run)).toEqual(run);
  });

  it('rejects a future run version LOUDLY', () => {
    expect(RunSchema.safeParse({ ...run, runVersion: RUN_VERSION + 1 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(RunSchema.safeParse({ ...run, winner: 'model-a' }).success).toBe(false);
  });

  it('requires at least two competitors — it is a duel', () => {
    expect(RunSchema.safeParse({ ...run, competitors: [run.competitors[0]] }).success).toBe(false);
  });

  it('requires a positive budget on every axis', () => {
    expect(RunSchema.safeParse({ ...run, budget: { ...run.budget, maxActions: 0 } }).success).toBe(false);
    expect(RunSchema.safeParse({ ...run, budget: { ...run.budget, maxTokens: -1 } }).success).toBe(false);
  });

  it('keeps typicalOfRepeats as an explicit null rather than an absent key', () => {
    const { typicalOfRepeats: _t, ...without } = run;
    expect(RunSchema.safeParse(without).success).toBe(false);
    expect(RunSchema.safeParse({ ...run, typicalOfRepeats: true }).success).toBe(true);
  });
});

describe('RunSummarySchema', () => {
  it('accepts an escape', () => {
    expect(RunSummarySchema.parse(escaped)).toEqual(escaped);
  });

  it('treats budget exhaustion as a recorded outcome, not an error', () => {
    expect(RunSummarySchema.parse(stalled)).toEqual(stalled);
    expect(stalled.endedBecause).toBe('budget_actions');
    expect(stalled.escaped).toBe(false);
  });

  it('accepts every end reason', () => {
    for (const endedBecause of END_REASONS) {
      expect(RunSummarySchema.safeParse({ ...stalled, endedBecause }).success).toBe(true);
    }
  });

  it('requires escape timings to be present as null when there was no escape', () => {
    const { escapeMs: _m, ...without } = stalled;
    expect(RunSummarySchema.safeParse(without).success).toBe(false);
  });

  it('counts invalid actions separately from failed attempts', () => {
    // They mean different things: a failed attempt used the interface correctly
    // and got the answer wrong; an invalid action did not use it correctly.
    expect(stalled.failedAttempts).toBe(4);
    expect(stalled.invalidActions).toBe(3);
  });

  it('rejects negative counts and negative cost', () => {
    expect(RunSummarySchema.safeParse({ ...escaped, puzzlesSolved: -1 }).success).toBe(false);
    expect(RunSummarySchema.safeParse({ ...escaped, costUsd: -0.01 }).success).toBe(false);
  });
});

describe('CompetitorSchema', () => {
  it('records provider defaults as explicit nulls so a rerun is reproducible', () => {
    const c = { id: 'm', provider: 'gemini', modelId: 'x', params: { temperature: null, topP: null } };
    expect(CompetitorSchema.parse(c)).toEqual(c);
  });

  it('rejects an unknown provider', () => {
    const c = { id: 'm', provider: 'openai', modelId: 'x', params: { temperature: null, topP: null } };
    expect(CompetitorSchema.safeParse(c).success).toBe(false);
  });
});

describe('parseRun', () => {
  it('throws RunError naming the expected version', () => {
    try {
      parseRun({ ...run, runVersion: 99 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RunError);
      expect((error as RunError).message).toContain(`runVersion ${RUN_VERSION}`);
    }
  });
});
