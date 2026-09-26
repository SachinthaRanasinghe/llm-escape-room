import { describe, expect, it } from 'vitest';
import { findLeaks } from '@/lib/artifact/scan';
import { buildStoppedComparison, type StoppedLane } from './stopped';

const lane = (competitorId: string, label: string, provider: StoppedLane['provider'], actions: number): StoppedLane => ({
  competitorId,
  label,
  provider,
  actions,
  puzzlesSolved: 1,
  failedAttempts: 2,
  invalidActions: 1,
  tokens: { prompt: 12_000, completion: 400 },
  costUsd: 0,
});

const lanes = [lane('model-a', 'openai/gpt-oss-20b', 'groq', 10), lane('model-b', 'gemini-3-flash-preview', 'gemini', 6)];
const base = { lanes, maxActions: 14, puzzleCount: 3, savedTo: 'runs/race-x' };

describe('buildStoppedComparison', () => {
  it('fills the finished race table from the partial log, with no winner', () => {
    const data = buildStoppedComparison({ ...base, failedCompetitorId: 'model-b', status: 429 });
    expect(data.rows.map((r) => r.isWinner)).toEqual([false, false]);
    expect(data.rows[0]).toMatchObject({
      result: 'Stopped after 10 actions with the other side',
      actions: '10 / 14',
      puzzles: '1 of 3',
      escapeTime: '—',
      tokens: '12,400',
      cost: '$0.00',
    });
    expect(data.rows[1]!.result).toBe('Provider error after 6 actions');
    expect(data.headline).toBe("Race stopped early — gemini-3-flash-preview's provider failed");
  });

  it('says why there is no result, where the moves are, and what to do about a quota', () => {
    const { variance } = buildStoppedComparison({ ...base, failedCompetitorId: 'model-b', status: 429 });
    expect(variance.kind).toBe('stopped');
    expect(variance.body).toContain('Google Gemini refused further requests');
    expect(variance.body).toContain('no winner and cannot be published');
    expect(variance.body).toContain('runs/race-x');
    expect(variance.body).toContain('each model has its own free limit');
  });

  it('words a server failure and a cancel without blaming a quota', () => {
    expect(buildStoppedComparison({ ...base, failedCompetitorId: 'model-a', status: 503 }).variance.body).toContain(
      'Groq kept failing on its side (HTTP 503)',
    );
    const cancelled = buildStoppedComparison({ ...base, failedCompetitorId: null, status: null });
    expect(cancelled.headline).toBe('Race stopped — no result');
    expect(cancelled.variance.body).not.toContain('limit');
  });

  it('writes nothing the artifact leak scan would refuse', () => {
    const data = buildStoppedComparison({ ...base, failedCompetitorId: 'model-b', status: 429 });
    expect(findLeaks(JSON.stringify(data))).toEqual([]);
  });
});
