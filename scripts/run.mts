/**
 * Opt-in live duel: one published run plus silent repeats — TICKET-6 (#7).
 *
 * Run with:
 *   node --env-file-if-exists=.env --import tsx scripts/run.mts
 *     [--room <path>] [--a groq:<model>] [--b groq:<model>] [--repeats 3] [--run-id <id>]
 *     [--max-actions 14] [--max-tokens 60000] [--max-ms 300000] [--out runs]
 *
 * `--room` defaults to the canonical fixture, so no generator is needed; any
 * `runs/rooms/<id>.json` from `generate-room.mts` works too. The room is
 * certified by the solver before a single model call is made.
 *
 * Writes, under `<out>/<runId>/`:
 *   run.json, events.json                      the published run
 *   repeats/<id>.run.json, <id>.events.json    each silent repeat
 *   matchup.json                               ids, dropped repeats, provider calls
 * If the published run's provider dies, only `events.partial.json` is written and
 * the exit code is 1. `runs/` is gitignored: these are run artifacts, not fixtures.
 *
 * NOT part of validation and never collected by vitest. It spends free-tier
 * quota. The room's contents — its answers — are never printed.
 *
 * Reading the environment and the real clock here is correct: `scripts/` is the
 * harness side, and `lib/harness` takes both as arguments. The defaults are the
 * TICKET-7 (#8) spike pair — two models on one free provider, per
 * `architecture.md` → First matchup. The earlier Llama pair is gone from Groq's
 * free tier (`llama-3.1-8b-instant` was shut down on 2026-08-16).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { loadCanonicalRoom } from '../fixtures';
import {
  DEFAULT_BUDGET,
  DEFAULT_REPEATS,
  DuelAbortedError,
  runMatchup,
  type DuelResult,
} from '../lib/harness';
import { ProviderError, createAdapter, readProviderKey, type ProviderAdapter } from '../lib/providers';
import { parseRoomSpec, type RoomSpec } from '../lib/schema/room';
import { ProviderSchema, type Competitor } from '../lib/schema/run';
import { verifySpec } from '../lib/solver';

const USAGE =
  'usage: node --env-file-if-exists=.env --import tsx scripts/run.mts [--room <path>] ' +
  '[--a <provider>:<model>] [--b <provider>:<model>] [--repeats 3] [--run-id <id>] ' +
  '[--max-actions 14] [--max-tokens 60000] [--max-ms 300000] [--out runs]';

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      room: { type: 'string' },
      a: { type: 'string', default: 'groq:openai/gpt-oss-120b' },
      b: { type: 'string', default: 'groq:openai/gpt-oss-20b' },
      repeats: { type: 'string', default: String(DEFAULT_REPEATS) },
      'run-id': { type: 'string' },
      'max-actions': { type: 'string', default: String(DEFAULT_BUDGET.maxActions) },
      'max-tokens': { type: 'string', default: String(DEFAULT_BUDGET.maxTokens) },
      'max-ms': { type: 'string', default: String(DEFAULT_BUDGET.maxWallClockMs) },
      out: { type: 'string', default: 'runs' },
    },
  });
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`, 2);
}
const { values } = parsed;

function count(flag: string, raw: string, min: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) fail(`--${flag} must be an integer >= ${min}\n${USAGE}`, 2);
  return value;
}

function competitor(id: string, flag: string, raw: string): Competitor {
  const at = raw.indexOf(':');
  const provider = ProviderSchema.safeParse(raw.slice(0, at));
  const modelId = raw.slice(at + 1).trim();
  if (at < 1 || !provider.success || modelId.length === 0) {
    fail(`--${flag} must be <provider>:<model> with provider groq, gemini or openrouter, received "${raw}"\n${USAGE}`, 2);
  }
  return { id, provider: provider.data, modelId, params: { temperature: null, topP: null } };
}

const repeats = count('repeats', values.repeats!, 0);
const budget = {
  maxActions: count('max-actions', values['max-actions']!, 1),
  maxTokens: count('max-tokens', values['max-tokens']!, 1),
  maxWallClockMs: count('max-ms', values['max-ms']!, 1),
};
const competitors = [competitor('model-a', 'a', values.a!), competitor('model-b', 'b', values.b!)];

let spec: RoomSpec;
try {
  spec = values.room === undefined ? loadCanonicalRoom() : parseRoomSpec(JSON.parse(readFileSync(values.room, 'utf8')));
} catch (error) {
  fail(`could not read a room from ${values.room}: ${(error as Error).message.split('\n')[0]}`, 2);
}

// Codes only: a rejection's message can quote an answer.
const certified = verifySpec(spec);
if (!certified.ok) fail(`room ${spec.roomId} is not certified: ${certified.rejections.map((r) => r.code).join(', ')}`, 2);

const runId = values['run-id'] ?? `run-${spec.roomId}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const dir = join(values.out!, runId);

function write(path: string, value: unknown): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

/** Counts only — no intents, no verdict prose, nothing from the room. */
function report(label: string, result: DuelResult): void {
  console.log(`${label}  ${result.run.runId}`);
  for (const [index, s] of result.run.summaries.entries()) {
    const c = result.run.competitors[index]!;
    const actions = result.events.filter((e) => e.competitorId === s.competitorId).length;
    console.log(
      `  ${s.competitorId} ${c.provider}/${c.modelId}  ${s.escaped ? 'ESCAPED' : 'stuck'} (${s.endedBecause})  ` +
        `${actions} actions, ${s.puzzlesSolved} puzzles, ${s.failedAttempts} failed, ${s.invalidActions} invalid, ` +
        `${s.tokens.prompt}+${s.tokens.completion} tokens, $${s.costUsd}`,
    );
  }
}

let adapters: Record<string, ProviderAdapter>;
try {
  adapters = Object.fromEntries(competitors.map((c) => [c.id, createAdapter(c, readProviderKey(c.provider))]));
} catch (error) {
  if (error instanceof ProviderError) fail(error.message, 1);
  throw error;
}

try {
  const result = await runMatchup({
    runId,
    spec,
    competitors,
    adapters,
    budget,
    repeats,
    deps: { now: () => Date.now() },
    onProgress: (message) => console.log(`...       ${message}`),
  });

  write(join(dir, 'run.json'), result.hero.run);
  write(join(dir, 'events.json'), result.hero.events);
  for (const repeat of result.repeats) {
    write(join(dir, 'repeats', `${repeat.run.runId}.run.json`), repeat.run);
    write(join(dir, 'repeats', `${repeat.run.runId}.events.json`), repeat.events);
  }
  write(join(dir, 'matchup.json'), {
    heroRunId: result.hero.run.runId,
    repeatRunIds: result.repeats.map((r) => r.run.runId),
    dropped: result.dropped,
    providerCalls: result.providerCalls,
  });

  report('hero   ', result.hero);
  for (const repeat of result.repeats) report('repeat ', repeat);
  const unpriced = [...new Set([result.hero, ...result.repeats].flatMap((r) => r.unpriced))];
  console.log(`typical   ${result.hero.run.typicalOfRepeats} (${result.repeats.length} repeat(s), ${result.dropped.length} dropped)`);
  console.log(`calls     ${result.providerCalls} provider call(s)`);
  if (unpriced.length > 0) console.log(`warning   no price for ${unpriced.join(', ')} — costUsd is a $0 guess`);
  console.log(`wrote     ${dir}`);
} catch (error) {
  if (error instanceof DuelAbortedError) {
    console.log(`wrote     ${write(join(dir, 'events.partial.json'), error.events)}`);
    fail(`${error.message} — nothing published (${error.providerCalls} provider call(s) spent)`, 1);
  }
  if (error instanceof ProviderError) fail(error.message, 1);
  throw error;
}
