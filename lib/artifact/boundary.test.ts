import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The artifact's boundary sweep — its counterpart to `lib/replay/boundary.test.ts`.
 *
 * Asserted from the source on disk, so a file added next month is swept the day
 * it lands:
 *
 *   1. `lib/artifact` reads recorded data. It never imports a provider, reads
 *      the environment or reaches the network — and never re-runs anything:
 *      no simulator, no harness, no generator.
 *   2. `lib/artifact/replay.ts` never names the live renderer. A published run
 *      plays its own frozen snapshot (`freeze.test.ts` proves it behaviourally;
 *      this proves it structurally).
 *   3. Nothing the client ships — `components/`, `lib/replay/` — imports
 *      `lib/artifact`. The loader runs on the server at build time and hands the
 *      player plain props.
 *
 * `testing.ts` is excluded by name: test support.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    if (!/\.tsx?$/.test(path) || /\.test\.tsx?$/.test(path) || path.endsWith('testing.ts')) return [];
    return [path];
  });
}

function read(dir: string) {
  return walk(join(ROOT, dir))
    .sort()
    .map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
}

const artifactSources = read('lib/artifact');
const clientSources = [...read('components'), ...read('lib/replay')];

const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /from\s+['"](@\/lib\/providers|(\.\.\/)+providers)/, why: 'a provider import' },
  { pattern: /\bprocess\.env\b/, why: 'an environment read' },
  { pattern: /\bfetch\s*\(/, why: 'a network call' },
  { pattern: /from\s+['"]node:https?['"]/, why: 'a network client' },
  { pattern: /from\s+['"](@\/lib\/(sim|harness|generator)|(\.\.\/)+(sim|harness|generator))\b/, why: 'a re-run' },
];

const LIVE_RENDERER = /\b(CURRENT_RENDERER|DEFAULT_TIMING|BEAT_MS|INTRO_MS|OUTRO_MS|LANE_OFFSET_MS|RENDERER_VERSION)\b/;
const ARTIFACT_IMPORT = /from\s+['"](@\/lib\/artifact|(\.\.\/)+artifact)\b/;

describe('the sweep sees the artifact', () => {
  it('reads the files this ticket created', () => {
    const paths = artifactSources.map((s) => s.path);
    for (const file of ['lib/artifact/publish.ts', 'lib/artifact/replay.ts', 'lib/artifact/schema.ts']) {
      expect(paths).toContain(file);
    }
    expect(paths).not.toContain('lib/artifact/testing.ts');
    expect(clientSources.length).toBeGreaterThanOrEqual(12);
  });
});

describe('the artifact reads recorded data and nothing else', () => {
  for (const { path, text } of artifactSources) {
    it(`${path} has no provider, env, network or re-run`, () => {
      for (const { pattern, why } of FORBIDDEN) {
        expect(pattern.test(text), `${path} contains ${why} (${pattern})`).toBe(false);
      }
    });
  }

  it('replay.ts never names the live renderer', () => {
    const replay = artifactSources.find((s) => s.path === 'lib/artifact/replay.ts')!;
    const code = replay.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(LIVE_RENDERER.exec(code)?.[0]).toBeUndefined();
  });
});

describe('the client never loads an artifact itself', () => {
  for (const { path, text } of clientSources) {
    it(`${path} does not import lib/artifact`, () => {
      expect(ARTIFACT_IMPORT.test(text)).toBe(false);
    });
  }
});

describe('the positive control', () => {
  it('would catch each forbidden thing if it were planted', () => {
    const planted = [
      "import { createAdapter } from '@/lib/providers';",
      'const k = process.env.X;',
      'await fetch(url);',
      "import https from 'node:https';",
      "import { runDuel } from '@/lib/harness';",
    ].join('\n');
    expect(FORBIDDEN.filter(({ pattern }) => pattern.test(planted))).toHaveLength(FORBIDDEN.length);
    expect(LIVE_RENDERER.test('return CURRENT_RENDERER;')).toBe(true);
    expect(ARTIFACT_IMPORT.test("import { loadArtifact } from '@/lib/artifact';")).toBe(true);
    expect(ARTIFACT_IMPORT.test("import { x } from '@/lib/artifactual';")).toBe(false);
  });
});
