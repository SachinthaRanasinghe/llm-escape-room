import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseGenerationRecord } from '@/lib/generator';
import { parseEventLog } from '@/lib/schema/event';
import { parseRun } from '@/lib/schema/run';
import {
  ADOPTION_THRESHOLD,
  MIN_ELIGIBLE,
  decide,
  modelKeyOf,
  summariseStrategy,
  type Decision,
  type SpikeInstance,
  type StrategySummary,
} from './decide';
import { FREE_TIER_LIMITS, planCuts, type CutPlan, type Limits, type Measured } from './quota';

/**
 * The spike report, from the files the runner left — TICKET-7 (#8).
 *
 * `scripts/spike-report.mts` is a thin wrapper around `buildReport`; the logic
 * lives here so it is tested against a directory tree rather than trusted.
 *
 * ── The layout `scripts/spike-substrate.mts` writes ────────────────────────
 *   <dir>/<strategy>/<index>/
 *     generation.json   GenerationRecord — once generation finished, accepted or not
 *     room.json         the certified RoomSpec (read by the runner only; never here)
 *     run.json          Run            ┐
 *     events.json       EventLog       ├ once the duel finished
 *     calls.json        { providerCalls: Record<competitorId, number> }
 *     partial.json      a provider died; the instance is PENDING and the runner retries it
 *     aborted.json      { reason } — a permanent abort, counted as such
 *
 * ── Aggregates only ────────────────────────────────────────────────────────
 * `room.json` is never opened here, and nothing below reads an intent, a verdict
 * message or a clue. The markdown is pasted into a committed decision record;
 * it must carry numbers, not rooms.
 *
 * ── An unreadable file stops the report ────────────────────────────────────
 * A report computed around a file it could not parse would state a rate over a
 * sample it silently shrank. Every bad path is collected and thrown together.
 */

export interface SpikeReport {
  readonly strategies: readonly StrategySummary[];
  readonly decision: Decision;
  /** Instances started but not finished — a provider failure the runner will retry. */
  readonly pending: Readonly<Record<string, number>>;
  readonly quota: {
    /** The strategy whose numbers were extrapolated, or `all` when none was adopted. */
    readonly measuredFrom: string;
    readonly measured: Measured | null;
    readonly plan: CutPlan | null;
    readonly limits: Readonly<Record<string, Limits>>;
  };
  readonly markdown: string;
}

export class SpikeReportError extends Error {
  readonly paths: readonly string[];

  constructor(paths: readonly string[]) {
    super(`unreadable spike files — fix or remove them, then re-run:\n${paths.map((p) => `  ${p}`).join('\n')}`);
    this.name = new.target.name;
    this.paths = paths;
  }
}

function dirs(path: string): string[] {
  return readdirSync(path).filter((name) => statSync(join(path, name)).isDirectory());
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadInstances(dir: string): { instances: SpikeInstance[]; pending: Record<string, number> } {
  const instances: SpikeInstance[] = [];
  const pending: Record<string, number> = {};
  const bad: string[] = [];

  for (const strategy of dirs(dir).sort()) {
    const indexes = dirs(join(dir, strategy))
      .filter((name) => /^\d+$/.test(name))
      .sort((a, b) => Number(a) - Number(b));
    for (const name of indexes) {
      const at = join(dir, strategy, name);
      const has = (file: string) => existsSync(join(at, file));
      const read = <T>(file: string, parse: (raw: unknown) => T): T | null => {
        if (!has(file)) return null;
        try {
          return parse(readJson(join(at, file)));
        } catch {
          bad.push(join(at, file));
          return null;
        }
      };

      const aborted = read('aborted.json', (raw) => String((raw as { reason?: unknown }).reason ?? 'aborted'));
      const generation = read('generation.json', parseGenerationRecord);
      const run = read('run.json', parseRun);
      const events = read('events.json', parseEventLog);
      const calls = read('calls.json', (raw) => (raw as { providerCalls: Record<string, number> }).providerCalls);

      const finished = aborted !== null || (generation !== null && (!generation.accepted || run !== null));
      if (!finished) {
        pending[strategy] = (pending[strategy] ?? 0) + 1;
        continue;
      }

      const actions =
        run === null || events === null
          ? null
          : Object.fromEntries(run.competitors.map((c) => [c.id, events.filter((e) => e.competitorId === c.id).length]));
      instances.push({ strategy, index: Number(name), generation, run, actions, providerCalls: calls, aborted });
    }
  }

  if (bad.length > 0) throw new SpikeReportError(bad);
  return { instances, pending };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((t, v) => t + v, 0) / values.length;
}

/** Per-duel and per-room means over `instances`, in the shape `quota.ts` extrapolates from. */
export function measure(instances: readonly SpikeInstance[]): Measured | null {
  const duels = instances.filter((i) => i.run !== null);
  const generations = instances.flatMap((i) => (i.generation === null ? [] : [i.generation]));
  const certified = generations.filter((g) => g.accepted);
  if (duels.length === 0 || certified.length === 0) return null;

  const perModel = new Map<string, { calls: number[]; tokens: number[] }>();
  for (const { run, providerCalls } of duels) {
    for (const competitor of run!.competitors) {
      const key = modelKeyOf(competitor);
      const s = run!.summaries.find((x) => x.competitorId === competitor.id)!;
      const row = perModel.get(key) ?? { calls: [], tokens: [] };
      row.tokens.push(s.tokens.prompt + s.tokens.completion);
      row.calls.push(providerCalls?.[competitor.id] ?? 0);
      perModel.set(key, row);
    }
  }

  return {
    duel: Object.fromEntries([...perModel].map(([key, r]) => [key, { calls: mean(r.calls), tokens: mean(r.tokens) }])),
    generation: {
      modelKey: modelKeyOf(generations[0]!),
      callsPerRoom: generations.reduce((t, g) => t + g.totals.providerCalls, 0) / certified.length,
      tokensPerRoom: generations.reduce((t, g) => t + g.totals.promptTokens + g.totals.completionTokens, 0) / certified.length,
      attemptsPerRoom: generations.reduce((t, g) => t + g.totals.attempts, 0) / certified.length,
    },
    chainLength: mean(certified.map((g) => g.fingerprint!.chainLength)),
  };
}

export function buildReport(dir: string, limits: Readonly<Record<string, Limits>> = FREE_TIER_LIMITS): SpikeReport {
  const { instances, pending } = loadInstances(dir);
  const byStrategy = new Map<string, SpikeInstance[]>();
  for (const i of instances) byStrategy.set(i.strategy, [...(byStrategy.get(i.strategy) ?? []), i]);

  const strategies = [...byStrategy].map(([name, list]) => summariseStrategy(name, list));
  const decision = decide(strategies);

  const measuredFrom = decision.adopted ?? 'all';
  const measured = measure(decision.adopted === null ? instances : byStrategy.get(decision.adopted)!);
  const plan = measured === null ? null : planCuts(measured, limits);

  const report = { strategies, decision, pending, quota: { measuredFrom, measured, plan, limits } };
  return { ...report, markdown: renderMarkdown(report) };
}

/* ── Markdown ───────────────────────────────────────────────────────────── */

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function num(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits);
}

function fitText(fit: boolean | 'unknown'): string {
  return fit === 'unknown' ? 'unknown' : fit ? 'yes' : 'no';
}

export function renderMarkdown(report: Omit<SpikeReport, 'markdown'>): string {
  const lines: string[] = [];
  const ids = [...new Set(report.strategies.flatMap((s) => Object.keys(s.competitors)))].sort();

  lines.push('### Results', '');
  lines.push(
    `| strategy | planned | certified | duels | aborted | eligible | diverged | rate | ${ids.map((id) => `${id} escape`).join(' | ')} | median escape actions (${ids.join(' / ')}) | invalid per action (${ids.join(' / ')}) | gen acceptance | gen attempts (median) |`,
  );
  lines.push(`|${' --- |'.repeat(12 + ids.length)}`);
  for (const s of report.strategies) {
    const per = (f: (id: string) => string) => ids.map(f).join(' / ');
    lines.push(
      `| ${s.strategy} | ${s.planned} | ${s.certified} | ${s.duels} | ${s.aborted} | ${s.eligible} | ${s.diverged} | ${pct(s.divergenceRate)} | ` +
        `${ids.map((id) => pct(s.competitors[id]?.escapeRate ?? null)).join(' | ')} | ` +
        `${per((id) => num(s.competitors[id]?.medianEscapeActions ?? null))} | ` +
        `${per((id) => num(s.competitors[id]?.invalidPerAction ?? null, 2))} | ` +
        `${pct(s.generation.acceptanceRate)} | ${num(s.generation.medianAttemptsToAccept)} |`,
    );
  }
  const pendingTotal = Object.values(report.pending).reduce((t, n) => t + n, 0);
  if (pendingTotal > 0) lines.push('', `Pending (started, not finished): ${JSON.stringify(report.pending)}.`);

  lines.push('', '### Decision', '');
  lines.push(`Rule: adopt at ≥${ADOPTION_THRESHOLD * 100}% divergence over ≥${MIN_ELIGIBLE} eligible instances.`, '');
  for (const reason of report.decision.reasons) lines.push(`- ${reason}`);

  lines.push('', '### Quota', '');
  const { plan, measured } = report.quota;
  if (plan === null || measured === null) {
    lines.push('Not enough finished duels to extrapolate.');
    return lines.join('\n');
  }
  lines.push(`Measured from: ${report.quota.measuredFrom} (mean chain length ${measured.chainLength.toFixed(1)}).`, '');
  const show = (title: string, e: CutPlan['start']) => {
    lines.push(
      `${title}: repeats ${e.config.repeats}, max attempts ${e.config.maxAttempts}, chain length ${e.config.chainLength} → fits: **${fitText(e.fits)}**`,
      '',
      '| model | calls | tokens | RPD | TPD | fits | min duel wall clock |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const [key, u] of Object.entries(e.perModel)) {
      const l = report.quota.limits[key];
      lines.push(
        `| ${key} | ${u.calls} | ${u.tokens} | ${l?.rpd ?? 'unknown'} | ${l?.tpd ?? 'unknown'} | ${fitText(u.fits)} | ${u.minDuelSeconds === null ? '—' : `${u.minDuelSeconds}s`} |`,
      );
    }
    lines.push('');
  };
  show('Full matchup', plan.start);
  if (plan.cuts.length > 0) {
    lines.push(`Cuts applied, in order: ${plan.cuts.join(', ')}.`, '');
    show('After cuts', plan.chosen);
  }
  return lines.join('\n');
}
