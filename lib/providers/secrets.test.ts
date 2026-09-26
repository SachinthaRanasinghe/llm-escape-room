import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGroqAdapter } from './groq';
import { createGeminiAdapter } from './gemini';
import { createOpenRouterAdapter } from './openrouter';
import { readProviderKey } from './env';
import { createGenerationClient } from './generation';
import { ProviderError, type TurnRequest } from './types';
import { geminiFunctionCallResponse, groqToolCallResponse, testDeps } from './testing';

/**
 * THE SECRETS SWEEP — "a test asserts no key or endpoint can reach a published
 * artifact" (TICKET-4).
 *
 * Asserted structurally, the way `lib/solver/purity.test.ts` does: source READ
 * FROM DISK, so a file added next month is swept the day it lands.
 *
 *   1. Only `lib/providers/env.ts` reads `process.env`.
 *   2. Nothing on the artifact side — schema, sim, solver, fixtures, app — can
 *      import the providers at all.
 *   3. The endpoints are named only in the two adapters.
 *   4. The committed JSON — fixtures and published artifacts — contains no URL
 *      and nothing shaped like a key.
 *   5. What an adapter returns, and what it throws, carries neither.
 *
 * `scripts/`, `next.config.ts` and `vitest.config.mts` are outside the sweep on
 * purpose: `scripts/` is the harness side, where reading the environment is
 * exactly right.
 *
 * TICKET-8 (#5) added the replay — `lib/replay` and `components` — to both
 * lists: it is the code that actually ships to a viewer's browser. TICKET-9 (#9)
 * added `lib/artifact/` to ARTIFACT_SIDE and `published/` — the artifacts a
 * `/run/<id>` URL actually serves — to the JSON scan.
 *
 * TICKET-11 (#11) adds the one other env read, `lib/telemetry/config.ts`: the
 * Umami website id — a public identifier, not a key — read at build time by the
 * `/run/[id]` server page. The Umami API key is read only in
 * `scripts/watch-through.mts`. `lib/telemetry` joins ARTIFACT_SIDE, so
 * telemetry can never import a provider.
 *
 * The local race page adds OpenRouter and `lib/race` — the harness run from a
 * web request. It may be imported only by the `/race` server page and the
 * `app/api/` route handlers; the browser gets `lib/race/wire.ts`, which is types
 * only. So the published `/run/<id>` page and the player still cannot reach a
 * provider, even through the race module.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SWEPT_DIRS = ['lib', 'app', 'components', 'fixtures'];
const ARTIFACT_SIDE = ['lib/schema', 'lib/sim', 'lib/solver', 'lib/replay', 'lib/artifact', 'lib/comparison', 'lib/telemetry', 'components', 'fixtures', 'app'];

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

const sources = SWEPT_DIRS.flatMap((dir) =>
  walk(join(ROOT, dir), (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)),
).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));

const ENV_READ = /\bprocess\.env\b/;
const PROVIDER_IMPORT = /from\s+['"](@\/lib\/providers|(\.\.\/)+providers)/;
const ENDPOINT = /api\.groq\.com|generativelanguage\.googleapis\.com|openrouter\.ai/;
const KEY_SHAPED = [/\bgsk_[A-Za-z0-9]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bAQ\.[0-9A-Za-z_-]{30,}/, /\bsk-or-v1-[0-9a-f]{20,}/];

/** Any import of the race module; `lib/race/wire` is matched separately. */
const RACE_IMPORT = /from\s+['"](@\/lib\/race|(\.\.\/)+race)(\/index)?['"]/;
/** Who may hold the race module: the server page that gates `/race`, and the route handlers. */
const RACE_HOLDERS = /^app\/(race\/page\.tsx|api\/)/;

describe('the sweep sees the codebase', () => {
  it('reads a realistic number of files, including the one allowed env read', () => {
    // Guards the guard: a walk that silently matched nothing would pass everything.
    expect(sources.length).toBeGreaterThanOrEqual(30);
    expect(sources.map((s) => s.path)).toContain('lib/providers/env.ts');
  });
});

describe('secrets stay on the harness side', () => {
  it('reads process.env only in lib/providers/env.ts and lib/telemetry/config.ts', () => {
    const readers = sources.filter((s) => ENV_READ.test(s.text)).map((s) => s.path).sort();
    expect(readers).toEqual(['lib/providers/env.ts', 'lib/telemetry/config.ts']);
  });

  it('never lets the artifact side import a provider', () => {
    const offenders = sources
      .filter((s) => ARTIFACT_SIDE.some((dir) => s.path.startsWith(`${dir}/`)))
      .filter((s) => PROVIDER_IMPORT.test(s.text))
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it('names the endpoints only in the adapters', () => {
    const namers = sources.filter((s) => ENDPOINT.test(s.text)).map((s) => s.path).sort();
    expect(namers).toEqual(['lib/providers/gemini.ts', 'lib/providers/groq.ts', 'lib/providers/openrouter.ts']);
  });

  it('lets only the /race server page and the API routes import the race module', () => {
    const holders = sources.filter((s) => RACE_IMPORT.test(s.text) && !s.path.startsWith('lib/race/')).map((s) => s.path);
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.filter((path) => !RACE_HOLDERS.test(path))).toEqual([]);
  });

  it('gives the browser only types from the race module', () => {
    const wire = sources.find((s) => s.path === 'lib/race/wire.ts');
    expect(wire).toBeDefined();
    const imports = wire!.text.match(/^import\b.*$/gm) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line, 'lib/race/wire.ts must import types only').toMatch(/^import type /);
    expect(/^export (const|function|class|let)/m.test(wire!.text), 'lib/race/wire.ts must export types only').toBe(false);
  });

  it.each(['fixtures', 'published'])('commits no URL and nothing key-shaped in %s JSON', (dir) => {
    const json = walk(join(ROOT, dir), (path) => path.endsWith('.json'));
    expect(json.length).toBeGreaterThan(0);
    for (const path of json) {
      const text = readFileSync(path, 'utf8');
      expect(/https?:\/\//.test(text), `${path} contains a URL`).toBe(false);
      expect(ENDPOINT.test(text), `${path} names an endpoint`).toBe(false);
      for (const pattern of KEY_SHAPED) expect(pattern.test(text), `${path} contains ${pattern}`).toBe(false);
    }
  });
});

describe('adapter output carries no key and no endpoint', () => {
  const GROQ_KEY = 'gsk_TEST_SECRET_abcdefghijklmnopqrstuvwxyz';
  const GEMINI_KEY = 'AIzaTEST_SECRET_abcdefghijklmnopqrstuvwxyz012';
  const OPENROUTER_KEY = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`;
  const request: TurnRequest = { system: 's', transcript: [{ kind: 'user', text: 'You see a desk.' }] };
  const params = { temperature: null, topP: null };

  function clean(text: string): void {
    for (const secret of [GROQ_KEY, GEMINI_KEY, OPENROUTER_KEY, 'api.groq.com', 'googleapis.com', 'openrouter.ai']) {
      expect(text).not.toContain(secret);
    }
  }

  it('on success', async () => {
    const groq = createGroqAdapter({
      apiKey: GROQ_KEY,
      modelId: 'm',
      params,
      deps: testDeps([{ status: 200, body: groqToolCallResponse([{ name: 'look', arguments: '{"intent":"x"}' }]) }]).deps,
    });
    const gemini = createGeminiAdapter({
      apiKey: GEMINI_KEY,
      modelId: 'm',
      params,
      deps: testDeps([{ status: 200, body: geminiFunctionCallResponse([{ functionCall: { name: 'look', args: { intent: 'x' } } }]) }]).deps,
    });
    const openrouter = createOpenRouterAdapter({
      apiKey: OPENROUTER_KEY,
      modelId: 'm:free',
      params,
      deps: testDeps([{ status: 200, body: groqToolCallResponse([{ name: 'look', arguments: '{"intent":"x"}' }]) }]).deps,
    });
    clean(JSON.stringify(await groq.act(request)));
    clean(JSON.stringify(await gemini.act(request)));
    clean(JSON.stringify(await openrouter.act(request)));
  });

  it('on a refused key that the provider echoes back', async () => {
    const groq = createGroqAdapter({
      apiKey: GROQ_KEY,
      modelId: 'm',
      params,
      deps: testDeps([{ status: 401, body: { error: { message: `Invalid API Key: ${GROQ_KEY}` } } }]).deps,
    });
    const gemini = createGeminiAdapter({
      apiKey: GEMINI_KEY,
      modelId: 'm',
      params,
      deps: testDeps([{ status: 400, body: { error: { message: `API key not valid ${GEMINI_KEY}` } } }]).deps,
    });
    const openrouter = createOpenRouterAdapter({
      apiKey: OPENROUTER_KEY,
      modelId: 'm:free',
      params,
      deps: testDeps([{ status: 401, body: { error: { message: `No auth credentials found ${OPENROUTER_KEY}`, code: 401 } } }]).deps,
    });
    const upstream = createOpenRouterAdapter({
      apiKey: OPENROUTER_KEY,
      modelId: 'm:free',
      params,
      deps: testDeps([{ status: 200, body: { error: { message: `Provider returned error for ${OPENROUTER_KEY}`, code: 502 } } }]).deps,
    });
    for (const adapter of [groq, gemini, openrouter, upstream]) {
      const error = await adapter.act(request).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      clean(String(error));
      clean(JSON.stringify(error));
      clean((error as Error).stack ?? '');
    }
  });

  it('generation client output and errors carry no key or endpoint', async () => {
    const ok = [
      createGenerationClient({ provider: 'groq', modelId: 'm', params }, GROQ_KEY, testDeps([
        { status: 200, body: groqToolCallResponse([], undefined, '{"a":1}') },
      ]).deps),
      createGenerationClient({ provider: 'gemini', modelId: 'm', params }, GEMINI_KEY, testDeps([
        { status: 200, body: geminiFunctionCallResponse([{ text: '{"a":1}' }]) },
      ]).deps),
    ];
    for (const client of ok) clean(JSON.stringify(await client.complete({ system: 's', prompt: 'JSON' })));

    const refused = [
      createGenerationClient({ provider: 'groq', modelId: 'm', params }, GROQ_KEY, testDeps([
        { status: 401, body: { error: { message: `Invalid API Key: ${GROQ_KEY}` } } },
      ]).deps),
      createGenerationClient({ provider: 'gemini', modelId: 'm', params }, GEMINI_KEY, testDeps([
        { status: 400, body: { error: { message: `API key not valid ${GEMINI_KEY}` } } },
      ]).deps),
    ];
    for (const client of refused) {
      const error = await client.complete({ system: 's', prompt: 'JSON' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      clean(String(error));
      clean(JSON.stringify(error));
      clean((error as Error).stack ?? '');
    }
  });

  it('readProviderKey names the variable, never a value', () => {
    expect(readProviderKey('groq', { GROQ_API_KEY: ` ${GROQ_KEY} ` })).toBe(GROQ_KEY);
    expect(() => readProviderKey('gemini', {})).toThrow(/GEMINI_API_KEY is not set/);
    expect(() => readProviderKey('groq', { GROQ_API_KEY: '   ' })).toThrow(ProviderError);
    expect(() => readProviderKey('openrouter', {})).toThrow(/OPENROUTER_API_KEY is not set/);
  });
});

describe('the positive control', () => {
  it('would catch each forbidden thing if it were planted', () => {
    const planted = 'import { x } from "@/lib/providers";\nconst k = process.env.GROQ_API_KEY; fetch("https://api.groq.com");';
    expect(ENV_READ.test(planted)).toBe(true);
    expect(PROVIDER_IMPORT.test(planted)).toBe(true);
    expect(ENDPOINT.test(planted)).toBe(true);
    expect(KEY_SHAPED[0]!.test('{"k":"gsk_abcdefghijklmnopqrstuvwxyz"}')).toBe(true);
    expect(KEY_SHAPED[1]!.test('{"k":"AIzaSyA1234567890abcdefghijklmnopqrstu"}')).toBe(true);
    expect(PROVIDER_IMPORT.test('import { y } from "../providers/groq";')).toBe(true);
    expect(ENDPOINT.test('fetch("https://openrouter.ai/api/v1/chat/completions")')).toBe(true);
    expect(KEY_SHAPED[2]!.test(`{"k":"AQ.${'Ab8_-'.repeat(8)}"}`)).toBe(true);
    expect(KEY_SHAPED[3]!.test(`{"k":"sk-or-v1-${'0f'.repeat(32)}"}`)).toBe(true);
    expect(RACE_IMPORT.test(`import { runRace } from '@/lib/race';`)).toBe(true);
    expect(RACE_IMPORT.test(`import type { RaceMessage } from '@/lib/race/wire';`)).toBe(false);
    expect(RACE_HOLDERS.test('app/api/race/route.ts')).toBe(true);
    expect(RACE_HOLDERS.test('components/race/RaceLab.tsx')).toBe(false);
    expect(RACE_HOLDERS.test('app/run/[id]/page.tsx')).toBe(false);
  });
});
