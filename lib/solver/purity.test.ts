import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { verifyRoom, verifySpec } from './index';
import { roomFromSeed } from './fuzz';

/**
 * The adversarial sweep — this module's counterpart to `lib/sim/secrecy.test.ts`.
 *
 * TICKET-3 says "No LLM, no network — pure functions", and that is the kind of
 * claim that stays true right up until somebody adds a convenient call. So it is
 * asserted structurally rather than trusted: the directory is READ FROM DISK and
 * every source file swept, so a file added next month is covered the day it
 * lands. A hard-coded list would let exactly one new file escape silently —
 * the same failure mode `observation.ts` warns about with object spreads.
 */

const SOLVER_DIR = dirname(fileURLToPath(import.meta.url));

/** Source files only: the tests legitimately import node:fs, which is what this file is doing. */
function sourceFiles(): string[] {
  return readdirSync(SOLVER_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bfetch\s*\(/, why: 'a network call' },
  { pattern: /\bXMLHttpRequest\b/, why: 'a network call' },
  { pattern: /from\s+['"]node:https?['"]/, why: 'a network client' },
  { pattern: /require\(['"]node:?https?['"]\)/, why: 'a network client' },
  { pattern: /https?:\/\/(?!\s)/, why: 'an endpoint' },
  { pattern: /\bprocess\.env\b/, why: 'an environment read, which is where provider keys live' },
  { pattern: /['"]@\/lib\/providers/, why: 'a provider adapter import' },
  { pattern: /\bMath\.random\b/, why: 'unseeded randomness, which would break reproducibility' },
  { pattern: /\bDate\.now\b/, why: 'a clock read, which would make verification machine-dependent' },
];

describe('the solver source is pure', () => {
  it('sweeps at least the files this ticket created', () => {
    // Guards the guard: a glob that silently matched nothing would pass every
    // assertion below.
    expect(sourceFiles().length).toBeGreaterThanOrEqual(8);
    expect(sourceFiles()).toContain('verify.ts');
  });

  for (const file of sourceFiles()) {
    it(`${file} reaches for nothing outside itself`, () => {
      const source = readFileSync(join(SOLVER_DIR, file), 'utf8');
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(source), `${file} contains ${why} (${pattern})`).toBe(false);
      }
    });
  }

  it('imports nothing but schema, sim and rng', () => {
    const allowed = /^(@\/lib\/(schema|sim|rng)|\.\/|zod)/;
    for (const file of sourceFiles()) {
      const source = readFileSync(join(SOLVER_DIR, file), 'utf8');
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const specifier of imports) {
        expect(allowed.test(specifier), `${file} imports ${specifier}`).toBe(true);
      }
    }
  });
});

describe('the solver runs with the network torn out', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('certifies the canonical room while fetch throws', () => {
    globalThis.fetch = (() => {
      throw new Error('the solver must not reach the network');
    }) as typeof fetch;

    expect(verifyRoom(loadCanonicalRoom()).ok).toBe(true);
  });

  it('verifies a seeded room while fetch throws', () => {
    globalThis.fetch = (() => {
      throw new Error('the solver must not reach the network');
    }) as typeof fetch;

    expect(verifySpec(roomFromSeed('purity')).ok).toBe(true);
  });
});

describe('the positive control', () => {
  it('would catch a forbidden pattern if one were present', () => {
    // Proves the sweep measures something. Without this the test file could
    // pass by having broken regexes.
    const planted = 'const r = await fetch("https://example.com");';
    const hits = FORBIDDEN.filter(({ pattern }) => pattern.test(planted));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
