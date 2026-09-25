/**
 * Read watch-through back from Umami — TICKET-11 (#11).
 *
 * Run with:
 *   node --env-file-if-exists=.env --import tsx scripts/watch-through.mts [--id <runId>] [--since YYYY-MM-DD]
 *
 * Needs `UMAMI_API_KEY` (an Umami Cloud API key) and `UMAMI_WEBSITE_ID`. This is
 * the harness side, where reading the environment is right; the key never
 * reaches `lib/` or the page (`lib/providers/secrets.test.ts`).
 *
 * For every published run (or just `--id`), prints the funnel the PRD's demand
 * half is judged on: opens → still watching at 30 s → watched to the end, plus
 * skips, and whether watch-through clears "≥ 50% of opens". Runs are queried one
 * at a time: the API allows 50 calls every 15 seconds.
 *
 * Prints ids and counts only — never the key, never the website id.
 */
import { parseArgs } from 'node:util';

import { listArtifactIds } from '../lib/artifact';
import { fetchRunEventCounts, TelemetryReadError } from '../lib/telemetry/readout';
import { summariseFunnel, WATCH_THROUGH_TARGET, type Funnel } from '../lib/telemetry/funnel';

const USAGE =
  'usage: node --env-file-if-exists=.env --import tsx scripts/watch-through.mts [--id <runId>] [--since YYYY-MM-DD]';

const DEFAULT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is not set`, 2);
  return value;
}

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

function row(id: string, f: Funnel): string {
  const verdict = f.meetsTarget === null ? '—' : f.meetsTarget ? '✓' : '✗';
  return [
    id.padEnd(24),
    String(f.opens).padStart(6),
    `${f.t30} (${percent(f.survival30)})`.padStart(14),
    `${f.complete} (${percent(f.watchThrough)})`.padStart(16),
    String(f.skip).padStart(6),
    verdict.padStart(8),
  ].join('  ');
}

const { values } = (() => {
  try {
    return parseArgs({ options: { id: { type: 'string' }, since: { type: 'string' } }, strict: true });
  } catch (error) {
    return fail(`${(error as Error).message}\n${USAGE}`, 2);
  }
})();

const apiKey = requireEnv('UMAMI_API_KEY');
const websiteId = requireEnv('UMAMI_WEBSITE_ID');

const endAt = Date.now();
const startAt = values.since === undefined ? endAt - DEFAULT_WINDOW_MS : Date.parse(values.since);
if (Number.isNaN(startAt)) fail(`--since is not a date\n${USAGE}`, 2);

const ids = values.id === undefined ? listArtifactIds() : [values.id];
if (ids.length === 0) fail('no published runs', 1);

console.log(`watch-through since ${new Date(startAt).toISOString().slice(0, 10)} · target ≥ ${WATCH_THROUGH_TARGET * 100}% of opens`);
console.log(['run'.padEnd(24), 'opens'.padStart(6), 't30'.padStart(14), 'complete'.padStart(16), 'skip'.padStart(6), 'target'.padStart(8)].join('  '));
for (const runId of ids) {
  try {
    const counts = await fetchRunEventCounts({ apiKey, websiteId, runId, startAt, endAt });
    console.log(row(runId, summariseFunnel(counts)));
  } catch (error) {
    if (error instanceof TelemetryReadError) fail(`${runId}: ${error.message}`, 1);
    throw error;
  }
}
