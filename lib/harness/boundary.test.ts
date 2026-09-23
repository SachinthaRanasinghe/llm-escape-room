import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The harness's boundary sweep — its counterpart to `lib/generator/boundary.test.ts`.
 *
 * The harness drives models, but never DIRECTLY: it holds `ProviderAdapter`s it
 * was handed and a clock it was handed. Everything that touches a network, a key
 * or the real time lives on the far side of those, in `scripts/run.mts`. That is
 * asserted from the source on disk, so a file added next month is covered the
 * day it lands.
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
  { pattern: /\bMath\.random\b/, why: 'unseeded randomness' },
  { pattern: /\bDate\.now\b/, why: 'a clock read — the clock is HarnessDeps.now' },
  { pattern: /\bperformance\.now\b/, why: 'a clock read — think-time is the adapter latency' },
];

/**
 * A VALUE import from the providers. Types are free; the one value allowed is
 * `ProviderError`, from `types.ts`, which holds no transport — `competitor.ts`
 * needs the class for `instanceof`.
 */
const PROVIDER_VALUE_IMPORT = /import\s+(?!type\b)[^;]*?from\s+['"]@\/lib\/providers(?!\/types['"])[^'"]*['"]/;

/** The harness passes a room to the simulator and never reads it. */
const ROOM_VALUE_IMPORT = /import\s+(?!type\b)[^;]*?from\s+['"]@\/lib\/schema\/room['"]/;

describe('the sweep sees the harness', () => {
  it('reads the files this ticket created', () => {
    // Guards the guard: a walk that matched nothing would pass everything.
    expect(sources.length).toBeGreaterThanOrEqual(8);
    expect(sources.map((s) => s.path)).toContain('duel.ts');
    expect(sources.map((s) => s.path)).toContain('testing.ts');
  });
});

describe('the harness reaches for nothing it was not handed', () => {
  for (const { path, text } of sources) {
    it(`${path} has no network, env, clock or randomness`, () => {
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(text), `${path} contains ${why} (${pattern})`).toBe(false);
      }
    });

    it(`${path} imports providers by type only and never reads the room`, () => {
      expect(PROVIDER_VALUE_IMPORT.test(text), `${path} value-imports a provider module`).toBe(false);
      expect(ROOM_VALUE_IMPORT.test(text), `${path} value-imports the room schema`).toBe(false);
    });
  }
});

describe('the positive control', () => {
  it('would catch each forbidden thing if it were planted', () => {
    const planted =
      'const k = process.env.X; await fetch("https://example.com"); Math.random(); Date.now(); performance.now();';
    expect(FORBIDDEN.filter(({ pattern }) => pattern.test(planted)).length).toBeGreaterThanOrEqual(6);
    expect(PROVIDER_VALUE_IMPORT.test(`import { createAdapter } from '@/lib/providers';`)).toBe(true);
    expect(PROVIDER_VALUE_IMPORT.test(`import { readProviderKey } from '@/lib/providers/env';`)).toBe(true);
    expect(PROVIDER_VALUE_IMPORT.test(`import type { ProviderAdapter } from '@/lib/providers';`)).toBe(false);
    expect(PROVIDER_VALUE_IMPORT.test(`import { ProviderError } from '@/lib/providers/types';`)).toBe(false);
    expect(ROOM_VALUE_IMPORT.test(`import { parseRoomSpec } from '@/lib/schema/room';`)).toBe(true);
    expect(ROOM_VALUE_IMPORT.test(`import type { RoomSpec } from '@/lib/schema/room';`)).toBe(false);
  });
});
