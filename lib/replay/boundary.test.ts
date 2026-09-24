import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The replay's boundary sweep — its counterpart to `lib/harness/boundary.test.ts`.
 *
 * `lib/replay` and `components/scene` are the code that ships to a viewer's
 * browser. `architecture.md` makes the replay one-way: it reads an artifact and
 * cannot reach a provider even in principle. And the room it draws must never
 * arrive as a `RoomSpec`, which carries every answer — the server page projects
 * it into a `SceneLayout` and hands over only that.
 *
 * So, asserted from the source on disk (a file added next month is swept the
 * day it lands):
 *
 *   1. No network, no environment, no randomness, no clock but the one rAF
 *      timestamp in `usePlayback.ts`. A replay must look the same every time.
 *   2. No import of the fixtures — only `app/replay/page.tsx`, a server
 *      component, may read them.
 *   3. No VALUE import of the room schema (types are free), the providers, or the
 *      simulator: the replay reads the log, it never re-simulates.
 *   4. Every component under `components/scene` is a client component.
 *
 * `testing.ts` is excluded by name: it is a test helper that value-imports the
 * schemas so its builders cannot drift from them.
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..', '..');
const SWEPT = ['lib/replay', 'components/scene'];

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
  { pattern: /from\s+['"]node:https?['"]/, why: 'a network client' },
  { pattern: /\bMath\.random\b/, why: 'randomness — a replay must look the same every time' },
  { pattern: /\bDate\.now\b/, why: 'a clock read — the only clock is the rAF timestamp in usePlayback' },
  { pattern: /\bperformance\.now\b/, why: 'a clock read — the only clock is the rAF timestamp in usePlayback' },
  { pattern: /from\s+['"]@\/fixtures/, why: 'a fixture import — only the server page reads the fixtures' },
  { pattern: /from\s+['"](@\/lib\/providers|(\.\.\/)+providers)/, why: 'a provider import' },
  { pattern: /from\s+['"](@\/lib\/sim|(\.\.\/)+sim)\b/, why: 'a simulator import — the replay never re-simulates' },
];

/** A VALUE import of the room schema. `import type` is fine: types carry no answers. */
const ROOM_VALUE_IMPORT = /import\s+(?!type\b)[^;]*?from\s+['"]@\/lib\/schema\/room['"]/;

describe('the sweep sees the replay', () => {
  it('reads the files this ticket created', () => {
    // Guards the guard: a walk that matched nothing would pass everything.
    expect(sources.length).toBeGreaterThanOrEqual(12);
    const paths = sources.map((s) => s.path);
    for (const file of [
      'lib/replay/beats.ts',
      'lib/replay/layout.ts',
      'components/scene/ReplayPlayer.tsx',
      'components/scene/usePlayback.ts',
    ]) {
      expect(paths).toContain(file);
    }
    expect(paths).not.toContain('lib/replay/testing.ts');
  });
});

describe('the replay reaches for nothing', () => {
  for (const { path, text } of sources) {
    it(`${path} has no network, env, clock, randomness, fixtures, providers or simulator`, () => {
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(text), `${path} contains ${why} (${pattern})`).toBe(false);
      }
    });

    it(`${path} imports the room schema by type only`, () => {
      expect(ROOM_VALUE_IMPORT.test(text), `${path} value-imports the room schema`).toBe(false);
    });
  }
});

describe('every scene module is a client module', () => {
  for (const { path, text } of sources.filter((s) => s.path.startsWith('components/scene/') && /\.tsx?$/.test(s.path))) {
    it(`${path} starts with 'use client'`, () => {
      expect(text.trimStart().startsWith("'use client';")).toBe(true);
    });
  }
});

describe('the positive control', () => {
  it('would catch each forbidden thing if it were planted', () => {
    const planted = [
      'const k = process.env.X;',
      'await fetch("https://example.com");',
      "import http from 'node:http';",
      'Math.random(); Date.now(); performance.now();',
      "import { loadCanonicalRoom } from '@/fixtures';",
      "import { createAdapter } from '@/lib/providers';",
      "import { VERDICT_TALLY } from '@/lib/sim/simulator';",
    ].join('\n');
    expect(FORBIDDEN.filter(({ pattern }) => pattern.test(planted))).toHaveLength(FORBIDDEN.length);
    expect(ROOM_VALUE_IMPORT.test(`import { parseRoomSpec } from '@/lib/schema/room';`)).toBe(true);
    expect(ROOM_VALUE_IMPORT.test(`import type { RoomSpec } from '@/lib/schema/room';`)).toBe(false);
  });

  it('does not mistake the word "simulator" in prose for an import', () => {
    const sim = FORBIDDEN.find((f) => f.why.startsWith('a simulator'))!;
    expect(sim.pattern.test('// the simulator already decided')).toBe(false);
    expect(sim.pattern.test(`import { x } from '@/lib/simple';`)).toBe(false);
  });
});
