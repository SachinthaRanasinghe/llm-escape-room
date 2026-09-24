import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The spike analysis' boundary sweep — mirrors `lib/generator/boundary.test.ts`.
 *
 * `lib/spike` decides whether a one-way door gets locked, so it must be a pure
 * function of the files on disk: no network, no key, no clock, no randomness,
 * and no provider. Asserted from the source, so a file added later is covered.
 *
 * ── Two narrow exemptions, each with its reason ────────────────────────────
 * - `quota.ts` may contain URLs: they are the SOURCES of the limits table —
 *   data a reader checks, never an endpoint anything calls.
 * - `report.ts` may import `node:fs`: reading the runner's files is its job.
 *   Nothing else here touches the disk.
 */

const DIR = dirname(fileURLToPath(import.meta.url));

const sources = readdirSync(DIR)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .sort()
  .map((name) => ({ path: name, text: readFileSync(join(DIR, name), 'utf8') }));

const FORBIDDEN: readonly { pattern: RegExp; why: string; exempt?: string }[] = [
  { pattern: /\bprocess\.env\b/, why: 'an environment read' },
  { pattern: /\bfetch\s*\(/, why: 'a network call' },
  { pattern: /https?:\/\//, why: 'an endpoint', exempt: 'quota.ts' },
  { pattern: /from\s+['"]node:https?['"]/, why: 'a network client' },
  { pattern: /from\s+['"]node:fs['"]/, why: 'a disk read', exempt: 'report.ts' },
  { pattern: /\bMath\.random\b/, why: 'unseeded randomness' },
  { pattern: /\bDate\.now\b|new Date\(\)/, why: 'a clock read' },
];

/** Any value import from the providers — the spike needs none, not even `ProviderError`. */
const PROVIDER_VALUE_IMPORT = /import\s+(?!type\b)[^;]*?from\s+['"]@\/lib\/providers[^'"]*['"]/;

describe('the sweep sees the spike module', () => {
  it('reads the files this ticket created', () => {
    expect(sources.map((s) => s.path)).toEqual(
      expect.arrayContaining(['decide.ts', 'divergence.ts', 'index.ts', 'quota.ts', 'report.ts']),
    );
  });
});

describe('the spike analysis reaches for nothing but its inputs', () => {
  for (const { path, text } of sources) {
    it(`${path} has no network, env, clock or randomness`, () => {
      for (const { pattern, why, exempt } of FORBIDDEN) {
        if (exempt === path) continue;
        expect(pattern.test(text), `${path} contains ${why} (${pattern})`).toBe(false);
      }
    });

    it(`${path} imports no provider value`, () => {
      expect(PROVIDER_VALUE_IMPORT.test(text), `${path} value-imports a provider module`).toBe(false);
    });
  }
});

describe('the positive control', () => {
  it('would catch each forbidden thing if it were planted', () => {
    const planted =
      'import { readFileSync } from "node:fs"; const k = process.env.X; await fetch("https://x.io"); Math.random(); Date.now();';
    expect(FORBIDDEN.filter(({ pattern }) => pattern.test(planted)).length).toBeGreaterThanOrEqual(6);
    expect(PROVIDER_VALUE_IMPORT.test(`import { ProviderError } from '@/lib/providers/types';`)).toBe(true);
    expect(PROVIDER_VALUE_IMPORT.test(`import type { Provider } from '@/lib/providers';`)).toBe(false);
  });
});
