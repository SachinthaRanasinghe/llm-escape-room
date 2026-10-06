/**
 * Opt-in live Energy Cores match — `docs/decisions/arena.md`.
 *
 * Run with:
 *   node --env-file-if-exists=.env --import tsx scripts/arena.mts
 *     [--a groq:<model>] [--b groq:<model>] [--c gemini:<model>] [--rounds 10] [--match-id <id>] [--out runs]
 *
 * Prints each turn as it resolves — who acted, what kind of question, whether
 * the answer was right — then the standings. Writes `arena.json` and
 * `events.json` under `<out>/<matchId>/`; if a provider dies, only
 * `events.partial.json` and exit code 1.
 *
 * NOT part of validation and never collected by vitest. It spends free-tier
 * quota: up to two calls per player per round. Reading the environment and the
 * real clock here is correct: `scripts/` is the harness side.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { DEFAULT_ROUNDS, MatchAbortedError, PLAYER_IDS, runMatch, type ArenaEvent } from '../lib/arena';
import { ProviderError, createAdapter, readProviderKey } from '../lib/providers';
import { ProviderSchema, type Competitor } from '../lib/schema/run';

const USAGE =
  'usage: node --env-file-if-exists=.env --import tsx scripts/arena.mts ' +
  '[--a <provider>:<model>] [--b <provider>:<model>] [--c <provider>:<model>] [--rounds 10] [--match-id <id>] [--out runs]';

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      a: { type: 'string', default: 'groq:openai/gpt-oss-120b' },
      b: { type: 'string', default: 'groq:openai/gpt-oss-20b' },
      c: { type: 'string', default: 'gemini:gemini-flash-latest' },
      rounds: { type: 'string', default: String(DEFAULT_ROUNDS) },
      'match-id': { type: 'string' },
      out: { type: 'string', default: 'runs' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`, 2);
}
const { values } = parsed;
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const rounds = Number(values.rounds);
if (!Number.isInteger(rounds) || rounds < 1) fail(`--rounds must be a positive integer\n${USAGE}`, 2);

function competitor(id: string, flag: string, spec: string): Competitor {
  const at = spec.indexOf(':');
  const provider = ProviderSchema.safeParse(spec.slice(0, at));
  if (at < 1 || !provider.success || spec.length === at + 1) fail(`--${flag} must be <provider>:<model>, e.g. groq:openai/gpt-oss-20b\n${USAGE}`, 2);
  return { id, provider: provider.data, modelId: spec.slice(at + 1), params: { temperature: null, topP: null } };
}

const players = PLAYER_IDS.map((id, i) => competitor(id, ['a', 'b', 'c'][i]!, [values.a!, values.b!, values.c!][i]!));
const matchId = values['match-id'] ?? `arena-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const dir = join(values.out!, matchId);

function write(name: string, value: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function line(event: ArenaEvent): string {
  const who = `${event.playerId} (${players[PLAYER_IDS.indexOf(event.playerId)]!.modelId})`;
  const action = event.decision.action;
  const what = action === null || !event.decision.verdict.ok ? 'invalid move' : action.name === 'steal' ? `steal from ${action.targetId}` : action.name;
  const question = event.question === null ? '' : ` [${event.question.tier} ${event.question.category}: ${event.answer?.verdict.code === 'ok' ? 'right' : 'wrong'}]`;
  const board = PLAYER_IDS.map((id) => `${id.slice(-1)}=${event.cores[id]}`).join(' ');
  return `r${event.round} ${who}: ${what}${question} → ${event.outcome}${event.eliminated ? `, ${event.eliminated} eliminated` : ''}  | ${board} centre=${event.centre}`;
}

console.log(`match ${matchId}: ${players.map((p) => `${p.id}=${p.provider}:${p.modelId}`).join(', ')}, ${rounds} rounds`);
try {
  const adapters = Object.fromEntries(players.map((p) => [p.id, createAdapter(p, readProviderKey(p.provider))]));
  const { result, events, providerCalls } = await runMatch({
    matchId,
    players,
    adapters,
    maxRounds: rounds,
    deps: { now: () => Date.now() },
    onEvent: (event) => console.log(line(event)),
  });
  write('arena.json', result);
  write('events.json', events);
  console.log(`\nended: ${result.endedBecause} after ${result.roundsPlayed} round(s) — ${result.outcome === 'win' ? `winner ${result.winners[0]}` : `tie between ${result.winners.join(', ')}`}`);
  for (const s of result.standings) {
    console.log(`  ${s.playerId}: ${s.cores} cores, ${s.correct} right / ${s.wrong} wrong / ${s.invalid} invalid, ${s.latencyMs} ms thinking`);
  }
  console.log(`provider calls: ${JSON.stringify(providerCalls)}\nwrote ${dir}`);
} catch (error) {
  if (error instanceof MatchAbortedError) {
    write('events.partial.json', error.events);
    fail(`${error.message}\nwrote ${join(dir, 'events.partial.json')}`, 1);
  }
  if (error instanceof ProviderError) fail(error.message, 1);
  throw error;
}
