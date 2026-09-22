import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The generator's boundary sweep — its counterpart to `lib/solver/purity.test.ts`.
 *
 * The generator talks to a model, but never DIRECTLY: it holds a
 * `GenerationClient` it was handed, and everything that touches a network, a
 * key or a clock lives on the far side of that type. That is asserted from the
 * source on disk, so a file added next month is covered the day it lands.
 */

const DIR = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

const sources = walk(DIR)
  .sort()
  .map((path) => ({ path: relative(DIR, path), text: readFileSync(path, 'utf8') }));

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bprocess\.env\b/, why: 'an environment read — keys are read only in lib/providers/env.ts' },
  { pattern: /\bfetch\s*\(/, why: 'a network call' },
  { pattern: /https?:\/\//, why: 'an endpoint' },
  { pattern: /from\s+['"]node:https?['"]/, why: 'a network client' },
  { pattern: /\bMath\.random\b/, why: 'unseeded randomness — briefs must come from the seed' },
  { pattern: /\bDate\.now\b/, why: 'a clock read — latency comes from the client' },
];

/**
 * A VALUE import from the providers. Types are free; the one value allowed is
 * `ProviderError`, from `types.ts`, which holds no transport — `generate.ts`
 * needs the class for `instanceof`.
 */
const PROVIDER_VALUE_IMPORT = /import\s+(?!type\b)[^;]*?from\s+['"]@\/lib\/providers(?!\/types['"])[^'"]*['"]/;

describe('the sweep sees the generator', () => {
  it('reads the files this ticket created', () => {
    // Guards the guard: a walk that matched nothing would pass everything.
    expect(sources.length).toBeGreaterThanOrEqual(8);
    expect(sources.map((s) => s.path)).toContain('generate.ts');
    expect(sources.map((s) => s.path)).toContain(join('strategies', 'symbolic.ts'));
  });
});

describe('the generator reaches for nothing outside its client', () => {
  for (const { path, text } of sources) {
    it(`${path} has no network, env, clock or randomness`, () => {
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(text), `${path} contains ${why} (${pattern})`).toBe(false);
      }
    });

    it(`${path} imports providers by type only`, () => {
      expect(PROVIDER_VALUE_IMPORT.test(text), `${path} value-imports a provider module`).toBe(false);
    });
  }
});

describe('the positive control', () => {
  it('would catch each forbidden thing if it were planted', () => {
    const planted = 'const k = process.env.X; await fetch("https://example.com"); Math.random(); Date.now();';
    expect(FORBIDDEN.filter(({ pattern }) => pattern.test(planted)).length).toBeGreaterThanOrEqual(5);
    expect(PROVIDER_VALUE_IMPORT.test(`import { createGenerationClient } from '@/lib/providers';`)).toBe(true);
    expect(PROVIDER_VALUE_IMPORT.test(`import { postJson } from '@/lib/providers/transport';`)).toBe(true);
    expect(PROVIDER_VALUE_IMPORT.test(`import type { GenerationClient } from '@/lib/providers';`)).toBe(false);
    expect(PROVIDER_VALUE_IMPORT.test(`import { ProviderError } from '@/lib/providers/types';`)).toBe(false);
  });
});
