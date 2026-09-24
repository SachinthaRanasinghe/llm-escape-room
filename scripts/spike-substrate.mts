/**
 * The substrate divergence spike, live and resumable — TICKET-7 (#8).
 *
 * Run with (and re-run with the SAME command until it reports nothing left):
 *   node --env-file-if-exists=.env --import tsx scripts/spike-substrate.mts
 *     [--strategies symbolic,spatial,mixed] [--instances 20]
 *     [--gen gemini:gemini-flash-latest] [--a groq:openai/gpt-oss-120b] [--b groq:openai/gpt-oss-20b]
 *     [--max-attempts 5] [--max-actions 14] [--max-tokens 60000] [--max-ms 300000]
 *     [--pace-ms 0] [--out runs/spike]
 *
 * For each strategy and each index i, the seed is `spike-<strategy>-<i>`: a
 * room is generated (by `--gen`), certified by the solver, and played ONCE by
 * `--a` against `--b` — no silent repeats, which the decision rule does not use
 * and the quota cannot afford. Files land in `<out>/<strategy>/<i>/`; the layout
 * is documented in `lib/spike/report.ts`, and `scripts/spike-report.mts` reads it.
 *
 * ── It will take days, and that is expected ────────────────────────────────
 * Groq's free plan gives each model 200K tokens a day, and one 14-action duel
 * spends ~24K per competitor: about 8 duels per model per day, so the full
 * 3 × 20 spike needs about a week of re-runs. When the provider gives up (daily
 * quota, or retries exhausted) the run stops, records what it spent in
 * `partial.json`, and exits 1; the next run retries that same instance, reusing
 * its certified room rather than generating a new one.
 *
 * Instances are interleaved — index 1 of every strategy, then index 2 … — so a
 * day cut short by quota leaves the strategies with equal sample sizes rather
 * than 20 / 20 / 3.
 *
 * NOT part of validation and never collected by vitest. It spends free-tier
 * quota. The room's contents — its answers, clues and the models' intents — are
 * never printed. `runs/` is gitignored.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { GenerationAbortedError, generateRoom, resolveStrategy, STRATEGIES, type GeneratorStrategy } from '../lib/generator';
import { DEFAULT_BUDGET, DuelAbortedError, runDuel } from '../lib/harness';
import {
  ProviderError,
  createAdapter,
  createGenerationClient,
  readProviderKey,
  type GenerationClient,
  type ProviderAdapter,
} from '../lib/providers';
import { parseRoomSpec, type RoomSpec } from '../lib/schema/room';
import { ProviderSchema, type Competitor } from '../lib/schema/run';
import { verifySpec } from '../lib/solver';
import { divergenceOf } from '../lib/spike';

const USAGE =
  'usage: node --env-file-if-exists=.env --import tsx scripts/spike-substrate.mts ' +
  '[--strategies symbolic,spatial,mixed] [--instances 20] [--gen <provider>:<model>] ' +
  '[--a <provider>:<model>] [--b <provider>:<model>] [--max-attempts 5] ' +
  '[--max-actions 14] [--max-tokens 60000] [--max-ms 300000] [--pace-ms 0] [--out runs/spike]';

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      strategies: { type: 'string', default: 'symbolic,spatial,mixed' },
      instances: { type: 'string', default: '20' },
      gen: { type: 'string', default: 'gemini:gemini-flash-latest' },
      a: { type: 'string', default: 'groq:openai/gpt-oss-120b' },
      b: { type: 'string', default: 'groq:openai/gpt-oss-20b' },
      'max-attempts': { type: 'string', default: '5' },
      'max-actions': { type: 'string', default: String(DEFAULT_BUDGET.maxActions) },
      'max-tokens': { type: 'string', default: String(DEFAULT_BUDGET.maxTokens) },
      'max-ms': { type: 'string', default: String(DEFAULT_BUDGET.maxWallClockMs) },
      'pace-ms': { type: 'string', default: '0' },
      out: { type: 'string', default: join('runs', 'spike') },
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

function model(id: string, flag: string, raw: string): Competitor {
  const at = raw.indexOf(':');
  const provider = ProviderSchema.safeParse(raw.slice(0, at));
  const modelId = raw.slice(at + 1).trim();
  if (at < 1 || !provider.success || modelId.length === 0) {
    fail(`--${flag} must be <provider>:<model> with provider groq or gemini, received "${raw}"\n${USAGE}`, 2);
  }
  return { id, provider: provider.data, modelId, params: { temperature: null, topP: null } };
}

const names = values.strategies!.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
const strategies: GeneratorStrategy[] = [];
for (const name of names) {
  try {
    strategies.push(resolveStrategy(name));
  } catch (error) {
    fail(`${(error as Error).message}\n${USAGE}`, 2);
  }
}
if (strategies.length === 0) fail(`--strategies is empty — known: ${Object.keys(STRATEGIES).sort().join(', ')}`, 2);

const instances = count('instances', values.instances!, 1);
const maxAttempts = count('max-attempts', values['max-attempts']!, 1);
const paceMs = count('pace-ms', values['pace-ms']!, 0);
const budget = {
  maxActions: count('max-actions', values['max-actions']!, 1),
  maxTokens: count('max-tokens', values['max-tokens']!, 1),
  maxWallClockMs: count('max-ms', values['max-ms']!, 1),
};
const generator = model('generator', 'gen', values.gen!);
const competitors = [model('model-a', 'a', values.a!), model('model-b', 'b', values.b!)];
const out = values.out!;

/* ── Files ─────────────────────────────────────────────────────────────── */

function dirOf(strategy: string, index: number): string {
  return join(out, strategy, String(index));
}

function write(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

type State = 'done' | 'needs-duel' | 'needs-generation';

function stateOf(dir: string): State {
  if (existsSync(join(dir, 'run.json')) || existsSync(join(dir, 'aborted.json'))) return 'done';
  if (existsSync(join(dir, 'generation.json'))) {
    const record = readJson(join(dir, 'generation.json')) as { accepted?: boolean };
    // A tripped cap is a result — it is done — not a failure to retry.
    return record.accepted === true ? 'needs-duel' : 'done';
  }
  return 'needs-generation';
}

/* ── Plan ──────────────────────────────────────────────────────────────── */

const plan: { strategy: GeneratorStrategy; index: number }[] = [];
for (let index = 1; index <= instances; index++) {
  for (const strategy of strategies) plan.push({ strategy, index });
}
const remaining = plan.filter(({ strategy, index }) => stateOf(dirOf(strategy.name, index)) !== 'done');
console.log(
  `spike     ${strategies.map((s) => s.name).join(', ')} × ${instances}  ` +
    `(${plan.length - remaining.length} done, ${remaining.length} to go)  ` +
    `gen ${generator.provider}/${generator.modelId}  ` +
    `duel ${competitors.map((c) => `${c.provider}/${c.modelId}`).join(' vs ')}`,
);
if (remaining.length === 0) {
  console.log('nothing left — run scripts/spike-report.mts');
  process.exit(0);
}

let client: GenerationClient;
let adapters: Record<string, ProviderAdapter>;
try {
  client = createGenerationClient(generator, readProviderKey(generator.provider));
  adapters = Object.fromEntries(competitors.map((c) => [c.id, createAdapter(c, readProviderKey(c.provider))]));
} catch (error) {
  if (error instanceof ProviderError) fail(error.message, 1);
  throw error;
}

function stopForQuota(dir: string, stage: string, providerCalls: number, message: string, done: number): never {
  write(join(dir, 'partial.json'), { stage, providerCalls });
  fail(
    `${message}\nquota or provider failure during ${stage} — re-run the same command to resume ` +
      `(${done} finished this run, ${remaining.length - done} to go)`,
    1,
  );
}

/* ── Run ───────────────────────────────────────────────────────────────── */

let done = 0;
let aborted = 0;
for (const { strategy, index } of remaining) {
  const dir = dirOf(strategy.name, index);
  const seed = `spike-${strategy.name}-${index}`;
  const label = `${strategy.name} #${index}`.padEnd(14);

  let spec: RoomSpec;
  let genNote: string;
  if (stateOf(dir) === 'needs-generation') {
    try {
      const result = await generateRoom({ client, strategy, seed, maxAttempts, roomId: seed });
      write(join(dir, 'generation.json'), result.record);
      if (!result.ok) {
        console.log(`${label} gen ${result.record.totals.attempts} attempt(s) ✗  cap tripped — counted, no duel`);
        done++;
        continue;
      }
      write(join(dir, 'room.json'), result.spec);
      spec = result.spec;
      genNote = `gen ${result.record.totals.attempts} attempt(s) ✓`;
    } catch (error) {
      if (error instanceof GenerationAbortedError) {
        stopForQuota(dir, 'generation', error.record.totals.providerCalls, error.message, done);
      }
      if (error instanceof ProviderError) stopForQuota(dir, 'generation', 0, error.message, done);
      throw error;
    }
  } else {
    spec = parseRoomSpec(readJson(join(dir, 'room.json')));
    genNote = 'gen (reused) ✓';
  }

  // Codes only: a rejection message can quote an answer.
  const certified = verifySpec(spec);
  if (!certified.ok) {
    write(join(dir, 'aborted.json'), { reason: `room not certified: ${certified.rejections.map((r) => r.code).join(', ')}` });
    console.log(`${label} ${genNote}  ABORTED: room.json no longer certifies`);
    aborted++;
    done++;
    continue;
  }

  if (paceMs > 0 && done > 0) await new Promise((resolve) => setTimeout(resolve, paceMs));

  try {
    const result = await runDuel({ runId: seed, spec, competitors, adapters, budget, deps: { now: () => Date.now() } });
    write(join(dir, 'run.json'), result.run);
    write(join(dir, 'events.json'), result.events);
    write(join(dir, 'calls.json'), { providerCalls: result.providerCalls });

    const verdict = divergenceOf(result.run);
    const who = result.run.summaries
      .map((s) => {
        const actions = result.events.filter((e) => e.competitorId === s.competitorId).length;
        return `${s.competitorId} ${s.escaped ? 'ESCAPED' : 'stuck'} ${actions}`;
      })
      .join(' / ');
    console.log(`${label} ${genNote}  duel: ${who} → ${verdict.diverged ? 'diverged' : 'same'} (${verdict.reason})`);
    done++;
  } catch (error) {
    if (error instanceof DuelAbortedError) stopForQuota(dir, 'duel', error.providerCalls, error.message, done);
    if (error instanceof ProviderError) stopForQuota(dir, 'duel', 0, error.message, done);
    // Not a provider: a bug. Record it so the report counts it, and say so loudly.
    write(join(dir, 'aborted.json'), { reason: (error as Error).message.split('\n')[0] });
    console.error(`${label} ${genNote}  ABORTED: ${(error as Error).message.split('\n')[0]}`);
    aborted++;
    done++;
  }
}

console.log(`finished  ${done} instance(s) this run${aborted > 0 ? `, ${aborted} ABORTED — investigate before trusting the report` : ''}`);
console.log('next      node --import tsx scripts/spike-report.mts');
process.exit(aborted > 0 ? 1 : 0);
