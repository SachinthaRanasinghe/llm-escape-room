import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Telemetry's boundary sweep — TICKET-11 (#11), counterpart to
 * `lib/replay/boundary.test.ts`.
 *
 * Telemetry is the one thing on the published page allowed to reach the
 * network. So what it may reach, and from where, is pinned from the source on
 * disk (a file added next month is swept the day it lands):
 *
 *   1. `process.env` only in `lib/telemetry/config.ts`.
 *   2. `fetch(` and URLs only in `umami.ts` and `readout.ts`, and the Umami
 *      hosts are named only in `umami.ts`.
 *   3. No provider, simulator, artifact, harness, generator or fixture import.
 *   4. `components/telemetry` imports only the client-safe files — never the
 *      barrel, `config` or `readout`.
 *   5. No visitor id, no storage, no cookie, no clock: nothing that could tell
 *      one viewer from another, and still only the player's rAF for time.
 *
 * `testing.ts` is excluded by name: test support.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SWEPT = ['lib/telemetry', 'components/telemetry'];

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

const ENV_READ = /\bprocess\.env\b/;
const NETWORK = /\bfetch\s*\(|https?:\/\//;
const UMAMI_HOST = /cloud\.umami\.is|api\.umami\.is/;
const FORBIDDEN_IMPORT = /from\s+['"]@\/(lib\/(providers|sim|artifact|harness|generator)|fixtures)\b/;
const IDENTIFYING: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /\bdocument\.cookie\b/, why: 'a cookie' },
  { pattern: /\blocalStorage\b/, why: 'storage' },
  { pattern: /\bsessionStorage\b/, why: 'storage' },
  { pattern: /\bindexedDB\b/, why: 'storage' },
  { pattern: /\bsendBeacon\b/, why: 'a second transport' },
  { pattern: /\bMath\.random\b/, why: 'randomness — the stuff visitor ids are made of' },
  { pattern: /\bcrypto\.randomUUID\b/, why: 'a visitor id' },
  { pattern: /\bDate\.now\b/, why: 'a clock read' },
  { pattern: /\bperformance\.now\b/, why: 'a clock read' },
];
/** Anything `components/telemetry` may not import from `lib/telemetry`. */
const CLIENT_UNSAFE = /from\s+['"]@\/lib\/telemetry(\/(config|readout|index|funnel))?['"]/;
const CONFIG_TYPE_IMPORT = /import\s+type\s[^;]*from\s+['"]@\/lib\/telemetry\/config['"]/;

const pathsWhere = (pattern: RegExp) => sources.filter((s) => pattern.test(s.text)).map((s) => s.path);

describe('the sweep sees telemetry', () => {
  it('reads the files this ticket created', () => {
    // Guards the guard: a walk that matched nothing would pass everything.
    expect(sources.length).toBeGreaterThanOrEqual(7);
    const paths = sources.map((s) => s.path);
    for (const file of ['lib/telemetry/umami.ts', 'lib/telemetry/config.ts', 'components/telemetry/TrackedReplay.tsx']) {
      expect(paths).toContain(file);
    }
    expect(paths).not.toContain('lib/telemetry/testing.ts');
  });
});

describe('telemetry reaches for exactly what it needs', () => {
  it('reads the environment only in config.ts', () => {
    expect(pathsWhere(ENV_READ)).toEqual(['lib/telemetry/config.ts']);
  });

  it('touches the network only in umami.ts and readout.ts', () => {
    expect(pathsWhere(NETWORK)).toEqual(['lib/telemetry/readout.ts', 'lib/telemetry/umami.ts']);
  });

  it('names the Umami hosts only in umami.ts', () => {
    expect(pathsWhere(UMAMI_HOST)).toEqual(['lib/telemetry/umami.ts']);
  });

  it('imports no provider, simulator, artifact, harness, generator or fixture', () => {
    expect(pathsWhere(FORBIDDEN_IMPORT)).toEqual([]);
  });

  for (const { path, text } of sources) {
    it(`${path} can tell no viewer from another`, () => {
      for (const { pattern, why } of IDENTIFYING) {
        expect(pattern.test(text), `${path} contains ${why} (${pattern})`).toBe(false);
      }
    });
  }
});

describe('the client imports only client-safe telemetry', () => {
  for (const { path, text } of sources.filter((s) => s.path.startsWith('components/telemetry/'))) {
    it(`${path} imports neither the barrel, config (by value) nor the readout`, () => {
      const withoutTypeImport = text.replace(CONFIG_TYPE_IMPORT, '');
      expect(CLIENT_UNSAFE.test(withoutTypeImport), `${path} imports client-unsafe telemetry`).toBe(false);
    });

    it(`${path} is a client module`, () => {
      expect(text.trimStart().startsWith("'use client';")).toBe(true);
    });
  }
});

describe('the positive control', () => {
  it('would catch each forbidden thing if it were planted', () => {
    expect(ENV_READ.test('const x = process.env.X;')).toBe(true);
    expect(NETWORK.test('await fetch(u)')).toBe(true);
    expect(NETWORK.test('"https://example.com"')).toBe(true);
    expect(UMAMI_HOST.test('api.umami.is')).toBe(true);
    for (const module of ['@/lib/providers', '@/lib/sim', '@/lib/artifact', '@/lib/harness/duel', '@/lib/generator', '@/fixtures']) {
      expect(FORBIDDEN_IMPORT.test(`import { x } from '${module}';`), module).toBe(true);
    }
    const planted = 'document.cookie; localStorage; sessionStorage; indexedDB; navigator.sendBeacon(); Math.random(); crypto.randomUUID(); Date.now(); performance.now();';
    expect(IDENTIFYING.filter(({ pattern }) => pattern.test(planted))).toHaveLength(IDENTIFYING.length);
  });

  it('tells a type import of config from a value import', () => {
    const typeOnly = `import type { TelemetryConfig } from '@/lib/telemetry/config';`;
    const value = `import { readTelemetryConfig } from '@/lib/telemetry/config';`;
    expect(CLIENT_UNSAFE.test(typeOnly.replace(CONFIG_TYPE_IMPORT, ''))).toBe(false);
    expect(CLIENT_UNSAFE.test(value.replace(CONFIG_TYPE_IMPORT, ''))).toBe(true);
    expect(CLIENT_UNSAFE.test(`import { x } from '@/lib/telemetry';`)).toBe(true);
    expect(CLIENT_UNSAFE.test(`import { x } from '@/lib/telemetry/readout';`)).toBe(true);
    expect(CLIENT_UNSAFE.test(`import { x } from '@/lib/telemetry/tracker';`)).toBe(false);
  });
});
