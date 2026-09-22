import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/rng';
import { MUTATORS, buildValidRoom, roomFromSeed } from './fuzz';
import { codesOf, verifySpec } from './index';

/**
 * The property tests.
 *
 * Every seed is FIXED and named in the assertion message. A property test that
 * reports "expected true, got false" without saying which seed produced it is
 * not reproducible, and an irreproducible failure is one somebody silently
 * reruns until it passes.
 */

const SEEDS = Array.from({ length: 200 }, (_, i) => `seed-${i}`);

describe('property 1 — every generated room certifies', () => {
  it('accepts all 200 seeded rooms', () => {
    for (const seed of SEEDS) {
      const spec = roomFromSeed(seed);
      const result = verifySpec(spec);
      expect(result.ok ? [] : codesOf(result.rejections), `seed ${seed}`).toEqual([]);
    }
  });

  it('reports the length it built, for every chain length', () => {
    for (const chainLength of [1, 2, 3, 4]) {
      const spec = buildValidRoom(createRng(`len-${chainLength}`), { chainLength });
      const result = verifySpec(spec);
      if (!result.ok) throw new Error(`chainLength ${chainLength}: ${codesOf(result.rejections).join(',')}`);
      expect(result.report.intendedActions, `chainLength ${chainLength}`).toBe(chainLength * 2);
      expect(result.report.minActions, `chainLength ${chainLength}`).toBe(chainLength * 2);
    }
  });
});

describe('property 2 — every mutator is caught, by its own code', () => {
  for (const mutator of MUTATORS) {
    it(`${mutator.name} → ${mutator.expect}`, () => {
      for (const seed of SEEDS.slice(0, 50)) {
        const rng = createRng(seed);
        const chainLength = Math.max(mutator.minChainLength, rng.int(1, 4));
        const original = buildValidRoom(rng, { chainLength });
        const mutated = mutator.apply(rng, original);

        const result = verifySpec(mutated);
        expect(result.ok, `${mutator.name} seed ${seed}: expected rejection`).toBe(false);
        if (result.ok) continue;
        expect(codesOf(result.rejections), `${mutator.name} seed ${seed}`).toContain(mutator.expect);
      }
    });
  }

  it('leaves the original room untouched', () => {
    for (const mutator of MUTATORS) {
      const rng = createRng('mutation-purity');
      const original = buildValidRoom(rng, { chainLength: Math.max(mutator.minChainLength, 3) });
      const before = JSON.stringify(original);
      mutator.apply(rng, original);
      expect(JSON.stringify(original), mutator.name).toBe(before);
    }
  });
});

describe('property 3 — verification is deterministic', () => {
  it('gives an identical result for the same spec twice', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const spec = roomFromSeed(seed);
      expect(JSON.stringify(verifySpec(spec)), `seed ${seed}`).toBe(JSON.stringify(verifySpec(spec)));
    }
  });

  it('builds an identical room for the same seed twice', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      expect(JSON.stringify(roomFromSeed(seed)), `seed ${seed}`).toBe(JSON.stringify(roomFromSeed(seed)));
    }
  });

  it('builds different rooms for different seeds', () => {
    const rooms = new Set(SEEDS.map((seed) => JSON.stringify(roomFromSeed(seed))));
    expect(rooms.size).toBeGreaterThan(1);
  });
});

describe('property 4 — verification does not mutate its argument', () => {
  it('leaves every seeded spec byte-identical', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const spec = roomFromSeed(seed);
      const before = JSON.stringify(spec);
      verifySpec(spec);
      expect(JSON.stringify(spec), `seed ${seed}`).toBe(before);
    }
  });
});

describe('property 5 — verification never throws', () => {
  it('survives every seeded room and every mutation of it', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const rng = createRng(seed);
      const spec = buildValidRoom(rng, { chainLength: 4 });
      expect(() => verifySpec(spec), `seed ${seed}`).not.toThrow();
      for (const mutator of MUTATORS) {
        expect(() => verifySpec(mutator.apply(rng, spec)), `${mutator.name} seed ${seed}`).not.toThrow();
      }
    }
  });
});
