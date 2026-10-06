import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The arena's boundary sweep — `lib/harness/boundary.test.ts`, for the arena.
 *
 * The arena drives models, but never directly: it holds adapters and a clock it
 * was handed. It reads no key, calls no network, draws no unseeded randomness and
 * reads no clock of its own. From the providers it may take types, the
 * `ProviderError` class, and the tool-spec builder — nothing with a transport.
 * Asserted from the source on disk, so a file added later is covered the day it
 * lands.
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
  { pattern: /from\s+['"]node:/, why: 'a Node built-in — the arena is pure' },
  { pattern: /\bMath\.random\b/, why: 'unseeded randomness — questions are drawn through lib/rng' },
  { pattern: /\bDate\.now\b/, why: 'a clock read — the clock is HarnessDeps.now' },
  { pattern: /\bperformance\.now\b/, why: 'a clock read — think-time is the adapter latency' },
  { pattern: /\beval\s*\(|new Function\b/, why: 'evaluating code — only the bank test runs snippets' },
  { pattern: /from\s+['"]@\/(lib\/race|lib\/sim|lib\/schema\/room|fixtures)/, why: 'the escape room or the race module' },
];

const PROVIDER_IMPORT = /^import\s+(type\s+)?\{[^}]*\}\s+from\s+['"]@\/lib\/providers(\/[\w-]+)?['"];?$/gm;
const ALLOWED_VALUE_PROVIDER_MODULES = new Set(['/types', '/vocabulary']);

describe('the arena boundary', () => {
  it('sees its own sources', () => {
    expect(sources.map((s) => s.path)).toEqual(expect.arrayContaining(['engine.ts', 'match.ts', 'questions/bank.ts']));
  });

  it.each(FORBIDDEN.map((f) => [f.why, f.pattern] as const))('holds no %s', (_, pattern) => {
    expect(sources.filter((s) => pattern.test(s.text)).map((s) => s.path)).toEqual([]);
  });

  it('takes only types, ProviderError and the tool-spec builder from the providers', () => {
    const offending: string[] = [];
    for (const source of sources) {
      for (const match of source.text.matchAll(PROVIDER_IMPORT)) {
        const typeOnly = match[1] !== undefined;
        const module = match[2] ?? '';
        if (!typeOnly && !ALLOWED_VALUE_PROVIDER_MODULES.has(module)) offending.push(`${source.path}: ${match[0]}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('keeps the engine free of providers altogether', () => {
    for (const path of ['engine.ts', 'observation.ts', 'prompt.ts', 'schema.ts', 'standings.ts', 'questions/bank.ts', 'questions/grade.ts', 'questions/deck.ts']) {
      expect(sources.find((s) => s.path === path)!.text, path).not.toMatch(/@\/lib\/providers/);
    }
  });
});
