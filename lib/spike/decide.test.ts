import { describe, expect, it } from 'vitest';
import { MIN_ELIGIBLE, decide, percentile, summariseStrategy, type SpikeInstance } from './decide';
import { acceptedRecord, duel, instance, trippedRecord } from './testing';

const ok = await acceptedRecord();
const tripped = await trippedRecord();

/** `diverged` of `total` duels diverge (one escaper); the rest are a same-count tie. */
function instances(strategy: string, total: number, diverged: number): SpikeInstance[] {
  return Array.from({ length: total }, (_, i) => instance(strategy, i + 1, ok, i < diverged ? duel(9, null) : duel(10, 10)));
}

describe('summariseStrategy', () => {
  it('counts duels, eligibility and divergence by reason', () => {
    const s = summariseStrategy('symbolic', instances('symbolic', 20, 13));
    expect(s).toMatchObject({ planned: 20, certified: 20, duels: 20, eligible: 20, diverged: 13 });
    expect(s.divergenceRate).toBeCloseTo(0.65);
    expect(s.reasons.one_escaped).toBe(13);
    expect(s.reasons.same).toBe(7);
  });

  it('reports a tripped generation as a cost, never as a divergence sample', () => {
    const s = summariseStrategy('symbolic', [...instances('symbolic', 2, 1), instance('symbolic', 3, tripped, null)]);
    expect(s.planned).toBe(3);
    expect(s.capTripped).toBe(1);
    expect(s.duels).toBe(2);
    expect(s.generation.acceptanceRate).toBeCloseTo(2 / 3);
    // Three generations' calls (1 + 1 + 2) over the two rooms they produced.
    expect(s.generation.callsPerCertifiedRoom).toBe(2);
  });

  it('counts an aborted duel but keeps it out of eligible', () => {
    const aborted: SpikeInstance = { ...instance('symbolic', 9, ok, null), aborted: 'groq gave up: 429' };
    const s = summariseStrategy('symbolic', [aborted, ...instances('symbolic', 1, 1)]);
    expect(s.aborted).toBe(1);
    expect(s.eligible).toBe(1);
  });

  it('reports per-competitor escape rate, percentiles and per-action rates', () => {
    const s = summariseStrategy('symbolic', instances('symbolic', 4, 2));
    const a = s.competitors['model-a']!;
    expect(a.escapeRate).toBe(1);
    expect(a.medianEscapeActions).toBe(9);
    expect(s.competitors['model-b']!.escapeRate).toBe(0.5);
    // 1 invalid per duel over 10 actions per duel.
    expect(a.invalidPerAction).toBeCloseTo(0.1);
    expect(a.modelKey).toMatch(/^groq\//);
  });
});

describe('decide', () => {
  it('adopts the strategy that clears 60%', () => {
    const d = decide([
      summariseStrategy('symbolic', instances('symbolic', 20, 10)),
      summariseStrategy('spatial', instances('spatial', 20, 13)),
    ]);
    expect(d.adopted).toBe('spatial');
    expect(d.clears).toEqual({ symbolic: false, spatial: true });
  });

  it('counts exactly 60% as clearing', () => {
    expect(decide([summariseStrategy('mixed', instances('mixed', 20, 12))]).adopted).toBe('mixed');
  });

  it(`refuses to call a strategy on fewer than ${MIN_ELIGIBLE} eligible instances, however high its rate`, () => {
    const d = decide([summariseStrategy('spatial', instances('spatial', MIN_ELIGIBLE - 1, MIN_ELIGIBLE - 1))]);
    expect(d.adopted).toBeNull();
    expect(d.reasons[0]).toMatch(/below the 15 needed/);
  });

  it('breaks a rate tie on acceptance, then on name', () => {
    const cheap = summariseStrategy('spatial', instances('spatial', 20, 14));
    const dear = summariseStrategy('mixed', [...instances('mixed', 20, 14), instance('mixed', 21, tripped, null)]);
    expect(decide([dear, cheap]).adopted).toBe('spatial');
    expect(decide([summariseStrategy('b', instances('b', 20, 14)), summariseStrategy('a', instances('a', 20, 14))]).adopted).toBe('a');
  });

  it('returns null — the fallback branch — when nothing clears, and says so', () => {
    const d = decide([summariseStrategy('symbolic', instances('symbolic', 20, 5))]);
    expect(d.adopted).toBeNull();
    expect(d.reasons.at(-1)).toMatch(/fallback/);
  });
});

describe('percentile', () => {
  it('is nearest-rank, and null on nothing', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([], 0.5)).toBeNull();
  });
});
