import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/rng';
import { ANSWER_DOMAINS, DIFFICULTY_RANGES, bandFor, verifySpec } from '@/lib/solver';
import { buildValidRoom } from '@/lib/solver/fuzz';
import { proposalFromSpec } from '../testing';
import { MAX_CHAIN_LENGTH, chainLengthsFor, createSymbolicStrategy } from './symbolic';
import { resolveStrategy, STRATEGIES } from './index';

const symbolic = createSymbolicStrategy();
const seeds = Array.from({ length: 30 }, (_, i) => `symbolic-${i}`);

describe('symbolic brief', () => {
  it('is deterministic per seed', () => {
    for (const seed of seeds.slice(0, 5)) {
      expect(symbolic.brief(createRng(seed))).toEqual(symbolic.brief(createRng(seed)));
    }
  });

  it('varies across seeds', () => {
    const briefs = new Set(seeds.slice(0, 20).map((seed) => JSON.stringify(symbolic.brief(createRng(seed)))));
    expect(briefs.size).toBeGreaterThanOrEqual(3);
  });

  it('always picks a chain whose two-actions-per-link length fits the band, within the cap', () => {
    for (const seed of seeds) {
      const brief = symbolic.brief(createRng(seed));
      const { min, max } = DIFFICULTY_RANGES[brief.band];
      expect(2 * brief.chainLength).toBeGreaterThanOrEqual(min);
      expect(2 * brief.chainLength).toBeLessThanOrEqual(max);
      expect(brief.chainLength).toBeLessThanOrEqual(MAX_CHAIN_LENGTH);
      expect(brief.codeWidths).toHaveLength(brief.chainLength - 1);
      expect(Object.keys(ANSWER_DOMAINS)).toContain(brief.finalAnswerDomain);
    }
  });

  it('serves easy and standard, and refuses hard with a reason', () => {
    expect(chainLengthsFor('easy')).toEqual([1, 2]);
    expect(chainLengthsFor('standard')).toEqual([3, 4]);
    expect(() => createSymbolicStrategy({ band: 'hard' }).brief(createRng('x'))).toThrow(/hard.*chain cap/);
  });
});

describe('symbolic prompt', () => {
  const brief = symbolic.brief(createRng('prompt'));
  const prompt = symbolic.prompt(brief, null);

  it('names every word of the final domain, the chain length and each code width', () => {
    for (const word of ANSWER_DOMAINS[brief.finalAnswerDomain]!) expect(prompt).toContain(word);
    expect(prompt).toContain(`Exactly ${brief.chainLength} puzzles`);
    for (const width of brief.codeWidths) expect(prompt).toContain(`${width}-digit code`);
    expect(prompt).toContain(brief.themeHint);
  });

  it('says JSON, which Groq JSON mode requires', () => {
    expect(prompt).toMatch(/JSON/);
    expect(symbolic.system()).toMatch(/JSON/);
  });

  it('is byte-identical for the same seed on the first attempt', () => {
    expect(symbolic.prompt(symbolic.brief(createRng('prompt')), null)).toBe(prompt);
  });

  it('appends feedback only when there is some', () => {
    expect(prompt).not.toMatch(/rejected/);
    const withFeedback = symbolic.prompt(brief, { lines: ['chain_broken: p2 is on the floor'] });
    expect(withFeedback.startsWith(prompt)).toBe(true);
    expect(withFeedback).toContain('- chain_broken: p2 is on the floor');
    expect(symbolic.prompt(brief, { lines: [] })).toBe(prompt);
  });
});

describe('symbolic narrowing accepts every room of the shape its prompt asks for', () => {
  for (const seed of seeds) {
    it(seed, () => {
      const brief = symbolic.brief(createRng(seed));
      const room = buildValidRoom(createRng(`${seed}/room`), { chainLength: brief.chainLength });
      // The fuzz room derives its band from its own length; stamp that, or an
      // out-of-band rejection would be noise here.
      const band = bandFor(2 * brief.chainLength)!;
      const narrowed = symbolic.narrow(proposalFromSpec(room), { seed, roomId: `symbolic-${seed}`, band });
      if (!narrowed.ok) throw new Error(narrowed.issues.join('; '));
      expect(verifySpec(narrowed.spec).ok).toBe(true);
    });
  }
});

describe('registry', () => {
  it('resolves symbolic and refuses an unknown name with the known list', () => {
    expect(resolveStrategy('symbolic')).toBe(STRATEGIES.symbolic);
    expect(() => resolveStrategy('spatial')).toThrow(/unknown strategy "spatial" — known: symbolic/);
    expect(() => resolveStrategy('toString')).toThrow(/unknown strategy/);
  });
});
