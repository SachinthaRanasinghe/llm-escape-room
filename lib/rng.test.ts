import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

/**
 * The first twenty outputs of a known seed, captured when the algorithm was
 * written. This is a characterisation test and it is load-bearing: the
 * reproducibility guarantee in `architecture.md` says a seed reproduces a room
 * exactly, forever. If a change to `lib/rng.ts` breaks this test, that is the
 * test doing its job — and every fixture generated from a seed must be
 * regenerated before the change lands.
 */
const GOLDEN_SEED = 'canonical-room-v0';
const GOLDEN_SEQUENCE = [
  0.8626534005161375, 0.0011693534906953573, 0.8425028033088893, 0.40144722047261894,
  0.3266437193378806, 0.020196873228996992, 0.04014673293568194, 0.6331608591135591,
  0.13090894650667906, 0.09341152268461883, 0.7270614448934793, 0.4612204364966601,
  0.5650162303354591, 0.40123604075051844, 0.9189505733083934, 0.8763443732168525,
  0.4730174420401454, 0.9450421794317663, 0.005295769311487675, 0.2823736334685236,
];

describe('createRng', () => {
  it('reproduces the golden sequence for a known seed', () => {
    const rng = createRng(GOLDEN_SEED);
    const actual = Array.from({ length: GOLDEN_SEQUENCE.length }, () => rng.next());
    expect(actual).toEqual(GOLDEN_SEQUENCE);
  });

  it('gives two generators from the same seed identical, independent streams', () => {
    const a = createRng('same');
    const b = createRng('same');
    // Drain `a` first: if there were shared module state, `b` would continue
    // `a`'s stream rather than restart it.
    const fromA = Array.from({ length: 10 }, () => a.next());
    const fromB = Array.from({ length: 10 }, () => b.next());
    expect(fromB).toEqual(fromA);
  });

  it('diverges for different seeds', () => {
    const a = Array.from({ length: 10 }, createRng('seed-a').next);
    const b = Array.from({ length: 10 }, createRng('seed-b').next);
    expect(a).not.toEqual(b);
  });

  it('stays in [0, 1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('rng.int', () => {
  it('is inclusive at both ends', () => {
    const rng = createRng('int-bounds');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('handles a single-value range', () => {
    expect(createRng('single').int(7, 7)).toBe(7);
  });

  it('rejects an inverted range', () => {
    expect(() => createRng('bad').int(5, 1)).toThrow(RangeError);
  });

  it('rejects non-integer bounds', () => {
    expect(() => createRng('bad').int(0.5, 3)).toThrow(RangeError);
  });
});

describe('rng.pick', () => {
  it('returns a member of the array', () => {
    const items = ['a', 'b', 'c'] as const;
    const rng = createRng('pick');
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
  });

  it('throws on an empty array rather than returning undefined', () => {
    expect(() => createRng('empty').pick([])).toThrow(RangeError);
  });
});

describe('rng.shuffle', () => {
  it('returns a permutation of the input', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = createRng('shuffle').shuffle(items);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(items);
  });

  it('does not mutate the input', () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    createRng('no-mutate').shuffle(items);
    expect(items).toEqual(copy);
  });

  it('is deterministic for a given seed', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(createRng('det').shuffle(items)).toEqual(createRng('det').shuffle(items));
  });

  it('actually reorders a large enough input', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(createRng('reorder').shuffle(items)).not.toEqual(items);
  });

  it('handles empty and single-element arrays', () => {
    const rng = createRng('edge');
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['only'])).toEqual(['only']);
  });
});
