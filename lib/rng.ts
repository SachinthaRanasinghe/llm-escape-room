/**
 * Seeded, deterministic pseudo-randomness.
 *
 * `architecture.md` promises that `(seed, specVersion, competitor set)`
 * reproduces a room exactly — the models, not the room, supply the
 * nondeterminism. That promise is only as strong as this file, so it has no
 * dependency: `seedrandom` and `pure-rand` would both do the job, but a
 * reproducibility guarantee with an upstream is a guarantee someone else can
 * change. Twenty lines we own cannot drift.
 *
 * `lib/rng.test.ts` hard-codes the first twenty outputs of a known seed. That is
 * deliberate: it turns "we use a seeded RNG" into "this exact sequence, forever,
 * or the build fails". If you change the algorithm below, that test SHOULD break
 * — and every committed fixture generated from a seed has to be regenerated.
 */

/**
 * cyrb128 — hashes a string seed into the four 32-bit words mulberry32 needs.
 * A string seed (rather than a number) is what makes a run's provenance
 * legible: `room-2026-09-22-a` beats `1849302716` in a filename.
 */
function cyrb128(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** mulberry32 — small, fast, and stable across engines because it is all `Math.imul` and shifts. */
function mulberry32(a: number): () => number {
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] — INCLUSIVE at both ends. */
  int(min: number, max: number): number;
  /** One item, uniformly. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /** A new shuffled array; the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * Two generators created from the same seed are independent and produce
 * identical sequences. There is no module-level state, so a generator cannot be
 * perturbed by anything else in the process — which matters because a run and
 * its silent repeats may be generated in the same Node process.
 */
export function createRng(seed: string): Rng {
  const [a] = cyrb128(seed);
  const next = mulberry32(a);

  function int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError(`rng.int expects integer bounds, received ${min}..${max}`);
    }
    if (max < min) {
      throw new RangeError(`rng.int expects max >= min, received ${min}..${max}`);
    }
    return min + Math.floor(next() * (max - min + 1));
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('rng.pick expects a non-empty array');
    }
    return items[int(0, items.length - 1)]!;
  }

  function shuffle<T>(items: readonly T[]): T[] {
    // Fisher-Yates. NEVER `sort(() => rng.next() - 0.5)`: that is biased, and its
    // result depends on the engine's sort implementation, which would silently
    // break reproducibility across Node versions.
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  return { next, int, pick, shuffle };
}
