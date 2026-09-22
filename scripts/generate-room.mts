/**
 * Opt-in live generation: one certified room from a real model — TICKET-5 (#6).
 *
 * Run with:
 *   node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed <seed>
 *     [--strategy symbolic] [--provider groq|gemini] [--model <id>] [--max-attempts 5] [--out runs/rooms]
 *
 * Writes `<out>/<roomId>.json` (the certified `RoomSpec`) and
 * `<out>/<roomId>.generation.json` (every attempt, answer-free). On a tripped cap
 * or a provider failure only the record is written, and the exit code is 1.
 * `runs/` is gitignored: generated rooms are run artifacts, not fixtures.
 *
 * NOT part of validation and never collected by vitest. It spends free-tier
 * quota. The room's contents — its answers — are never printed.
 *
 * `--seed` is required and has no default: a room is reproducible only from a
 * seed somebody chose on purpose. Model choice is TICKET-7's; the defaults are
 * `smoke-providers.mts`'s.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { GenerationAbortedError, generateRoom, resolveStrategy, type GenerationRecord } from '../lib/generator';
import { ProviderError, createGenerationClient, readProviderKey } from '../lib/providers';
import { ProviderSchema, type Provider } from '../lib/schema/run';

const DEFAULT_MODELS: Record<Provider, string> = { groq: 'llama-3.3-70b-versatile', gemini: 'gemini-flash-latest' };

const USAGE =
  'usage: node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed <seed> ' +
  '[--strategy symbolic] [--provider groq|gemini] [--model <id>] [--max-attempts 5] [--out runs/rooms]';

const { values } = parseArgs({
  options: {
    seed: { type: 'string' },
    strategy: { type: 'string', default: 'symbolic' },
    provider: { type: 'string', default: 'groq' },
    model: { type: 'string' },
    'max-attempts': { type: 'string', default: '5' },
    out: { type: 'string', default: join('runs', 'rooms') },
  },
});

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

if (values.seed === undefined || values.seed.trim().length === 0) fail(USAGE, 2);
const provider = ProviderSchema.safeParse(values.provider);
if (!provider.success) fail(`unknown provider "${values.provider}"\n${USAGE}`, 2);
const maxAttempts = Number(values['max-attempts']);
if (!Number.isInteger(maxAttempts) || maxAttempts < 1) fail(`--max-attempts must be a positive integer\n${USAGE}`, 2);

let strategy;
try {
  strategy = resolveStrategy(values.strategy!);
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`, 2);
}

const seed = values.seed.trim();
const out = values.out!;
const model = { provider: provider.data, modelId: values.model ?? DEFAULT_MODELS[provider.data], params: { temperature: null, topP: null } };

function write(name: string, value: unknown): string {
  mkdirSync(out, { recursive: true });
  const path = join(out, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

/** Counts and codes only — the record is answer-free, and so is this. */
function summarise(record: GenerationRecord): void {
  console.log(`room      ${record.roomId}  (${record.strategy}, ${record.provider}/${record.modelId})`);
  for (const attempt of record.attempts) {
    const codes = attempt.rejections.map((r) => r.code).join(', ');
    console.log(`attempt ${attempt.index}  ${attempt.outcome}${codes ? `  [${codes}]` : ''}`);
  }
  const t = record.totals;
  console.log(
    `totals    ${t.attempts} attempt(s), ${t.providerCalls} call(s), ${t.promptTokens}+${t.completionTokens} tokens, ${t.latencyMs} ms`,
  );
  if (record.fingerprint !== null) {
    const f = record.fingerprint;
    console.log(`structure ${f.structureHash}  ${f.chainLength} links, ${f.answerShapes.join(' → ')}, ${f.intendedActions} actions`);
  }
}

try {
  const client = createGenerationClient(model, readProviderKey(model.provider));
  const result = await generateRoom({ client, strategy, seed, maxAttempts });
  const recordPath = write(`${result.record.roomId}.generation.json`, result.record);
  summarise(result.record);
  if (result.ok) {
    console.log(`wrote     ${write(`${result.spec.roomId}.json`, result.spec)}`);
    console.log(`wrote     ${recordPath}`);
  } else {
    console.log(`wrote     ${recordPath}`);
    fail(`no room certified within ${maxAttempts} attempt(s)`, 1);
  }
} catch (error) {
  if (error instanceof GenerationAbortedError) {
    summarise(error.record);
    console.log(`wrote     ${write(`${error.record.roomId}.generation.json`, error.record)}`);
    fail(error.message, 1);
  }
  if (error instanceof ProviderError) fail(error.message, 1);
  throw error;
}
