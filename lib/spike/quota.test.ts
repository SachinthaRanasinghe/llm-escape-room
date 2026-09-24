import { describe, expect, it } from 'vitest';
import { FREE_TIER_LIMITS, estimateMatchup, planCuts, type Limits, type Measured } from './quota';

const BIG = 'groq/openai/gpt-oss-120b';
const SMALL = 'groq/openai/gpt-oss-20b';
const GEN = 'gemini/gemini-flash-latest';

/** Roughly what the golden log implies: ~24k tokens and ~14 calls per competitor per duel. */
const measured: Measured = {
  duel: { [BIG]: { calls: 14, tokens: 24_000 }, [SMALL]: { calls: 14, tokens: 24_000 } },
  generation: { modelKey: GEN, callsPerRoom: 2, tokensPerRoom: 6_000, attemptsPerRoom: 2 },
  chainLength: 3,
};

/** Gemini with numbers, for the cases that need a definite verdict. */
const known: Record<string, Limits> = {
  ...FREE_TIER_LIMITS,
  [GEN]: { rpm: 10, rpd: 250, tpm: 250_000, tpd: 1_000_000, source: 'test', readOn: 'test' },
};

describe('estimateMatchup', () => {
  it('counts one generation plus hero and repeats, per model', () => {
    const e = estimateMatchup(measured, { repeats: 3, maxAttempts: 5, chainLength: 3 }, known);
    expect(e.perModel[BIG]).toMatchObject({ calls: 56, tokens: 96_000, fits: true });
    expect(e.perModel[GEN]).toMatchObject({ calls: 2, tokens: 6_000, fits: true });
    expect(e.fits).toBe(true);
  });

  it('reports the minimum wall clock a duel needs under TPM', () => {
    const e = estimateMatchup(measured, { repeats: 0, maxAttempts: 5, chainLength: 3 }, known);
    // 24k tokens at 8k per minute.
    expect(e.perModel[BIG]!.minDuelSeconds).toBe(180);
    expect(e.perModel[GEN]!.minDuelSeconds).toBeNull();
  });

  it('does not fit a whole spike’s worth of duels in one day', () => {
    const e = estimateMatchup(measured, { repeats: 59, maxAttempts: 5, chainLength: 3 }, known);
    expect(e.perModel[BIG]!.fits).toBe(false);
    expect(e.fits).toBe(false);
  });

  it('says unknown, never true, when a limit is not published', () => {
    const e = estimateMatchup(measured, { repeats: 3, maxAttempts: 5, chainLength: 3 });
    expect(e.perModel[GEN]!.fits).toBe('unknown');
    expect(e.fits).toBe('unknown');
  });

  it('scales duel cost with chain length and generation cost with the attempt cap', () => {
    const e = estimateMatchup(measured, { repeats: 0, maxAttempts: 1, chainLength: 2 }, known);
    expect(e.perModel[BIG]!.tokens).toBe(16_000);
    expect(e.perModel[GEN]!.tokens).toBe(3_000);
  });
});

describe('planCuts', () => {
  it('cuts nothing when the full matchup fits', () => {
    expect(planCuts(measured, known).cuts).toEqual([]);
  });

  it('cuts repeats before retries, and retries before chain length', () => {
    const heavy: Measured = { ...measured, duel: { [BIG]: { calls: 14, tokens: 110_000 }, [SMALL]: { calls: 14, tokens: 110_000 } } };
    const plan = planCuts(heavy, known);
    // Two duels are 220k, over 200k TPD; the hero alone is 110k.
    expect(plan.cuts).toEqual(['repeats → 2', 'repeats → 1', 'repeats → 0']);
    expect(plan.chosen.fits).toBe(true);
  });

  it('reaches chain length only after repeats and retries are exhausted', () => {
    const huge: Measured = { ...measured, duel: { [BIG]: { calls: 14, tokens: 250_000 }, [SMALL]: { calls: 14, tokens: 250_000 } } };
    const plan = planCuts(huge, known);
    expect(plan.cuts).toEqual([
      'repeats → 2',
      'repeats → 1',
      'repeats → 0',
      'generation retries → 3',
      'generation retries → 2',
      'chain length → 2',
    ]);
    expect(plan.chosen.fits).toBe(true);
  });

  it('stops at unknown instead of cutting for a limit nobody published', () => {
    const plan = planCuts(measured);
    expect(plan.cuts).toEqual([]);
    expect(plan.chosen.fits).toBe('unknown');
  });
});
