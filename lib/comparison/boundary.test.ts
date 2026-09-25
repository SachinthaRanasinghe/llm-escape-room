import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The comparison's boundary sweep — TICKET-10 (#10), mirroring
 * `lib/replay/boundary.test.ts`.
 *
 * `lib/comparison` decides what "won" and "typical" mean and writes every
 * sentence the results show; `components/comparison` lays them out in the
 * viewer's browser. Both must be pure and one-way. Asserted from the source on
 * disk, so a file added next month is swept the day it lands:
 *
 *   1. No network, environment, filesystem, randomness or clock.
 *   2. No fixtures, providers, simulator, harness, generator or artifact loader:
 *      the comparison judges recorded data, it never re-runs or reads files.
 *   3. Every component under `components/comparison` is a client component and
 *      takes `lib/comparison` as TYPES only — the server page computed the data.
 *
 * `*.test.ts` and `testing.ts` are excluded.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SWEPT = ['lib/comparison', 'components/comparison'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path) || path.endsWith('testing.ts')) return [];
    return [path];
  });
}

const sources = SWEPT.flatMap((dir) => walk(join(ROOT, dir)))
  .sort()
  .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bprocess\.env\b/, why: 'an environment read' },
  { pattern: /\bfetch\s*\(/, why: 'a network call' },
  { pattern: /https?:\/\//, why: 'an endpoint' },
  { pattern: /from\s+['"]node:/, why: 'a node built-in (filesystem, network)' },
  { pattern: /\bMath\.random\b/, why: 'randomness' },
  { pattern: /\bDate\.now\b/, why: 'a clock read' },
  { pattern: /\bperformance\.now\b/, why: 'a clock read' },
  { pattern: /from\s+['"]@\/fixtures/, why: 'a fixture import' },
  {
    pattern: /from\s+['"](@\/lib\/(providers|sim|harness|generator|artifact)|(\.\.\/)+(providers|sim|harness|generator|artifact))\b/,
    why: 'a provider, re-run or artifact-loader import',
  },
];

const COMPARISON_VALUE_IMPORT = /import\s+(?!type\b)[^;]*?from\s+['"]@\/lib\/comparison[^'"]*['"]/;

describe('the sweep sees the comparison', () => {
  it('reads the files this ticket created', () => {
    const paths = sources.map((s) => s.path);
    for (const file of ['lib/comparison/outcome.ts', 'lib/comparison/comparison.ts', 'components/comparison/Comparison.tsx']) {
      expect(paths).toContain(file);
    }
  });
});

describe('the comparison reaches for nothing', () => {
  for (const { path, text } of sources) {
    it(`${path} is pure`, () => {
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(text), `${path} contains ${why} (${pattern})`).toBe(false);
      }
    });
  }
});

describe('the results component only lays out what the server computed', () => {
  for (const { path, text } of sources.filter((s) => s.path.startsWith('components/comparison/') && s.path.endsWith('.tsx'))) {
    it(`${path} is a client component taking lib/comparison as types only`, () => {
      expect(text.trimStart().startsWith("'use client';")).toBe(true);
      expect(COMPARISON_VALUE_IMPORT.test(text)).toBe(false);
    });
  }
});
