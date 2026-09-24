/**
 * The substrate spike report — TICKET-7 (#8).
 *
 * Run with:
 *   node --import tsx scripts/spike-report.mts [--out runs/spike]
 *
 * Reads everything `scripts/spike-substrate.mts` wrote under `--out`, applies
 * the decision rule and the quota extrapolation from `lib/spike`, writes
 * `<out>/report.json`, and prints markdown ready to paste into
 * `docs/decisions/substrate.md`. Offline: no key, no provider, no quota.
 *
 * Aggregates only — no room, clue, answer or intent is read or printed. An
 * unreadable file stops the report and names itself, rather than letting a rate
 * be computed over a sample that quietly shrank.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { SpikeReportError, buildReport } from '../lib/spike';

const USAGE = 'usage: node --import tsx scripts/spike-report.mts [--out runs/spike]';

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({ options: { out: { type: 'string', default: join('runs', 'spike') } } });
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`, 2);
}
const out = parsed.values.out!;
if (!existsSync(out)) fail(`no spike results at ${out} — run scripts/spike-substrate.mts first\n${USAGE}`, 2);

try {
  const report = buildReport(out);
  const { markdown, ...data } = report;
  writeFileSync(join(out, 'report.json'), `${JSON.stringify(data, null, 2)}\n`);
  console.log(markdown);
  console.log('');
  console.log(`adopted   ${report.decision.adopted ?? 'none — the fallback branch fires'}`);
  console.log(`wrote     ${join(out, 'report.json')}`);
} catch (error) {
  if (error instanceof SpikeReportError) fail(error.message, 1);
  throw error;
}
