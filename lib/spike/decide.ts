import type { GenerationRecord } from '@/lib/generator';
import type { Run } from '@/lib/schema/run';
import { DIVERGENCE_REASONS, divergenceOf, type DivergenceReason } from './divergence';

/**
 * Per-strategy results and the adoption rule — TICKET-7 (#8).
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * `architecture.md` → Spikes · 1: "adopt the kind that diverges on ≥60% of
 * instances while both models stay inside the action budget". A strategy CLEARS
 * when its divergence rate over eligible instances is at least
 * `ADOPTION_THRESHOLD`, with at least `MIN_ELIGIBLE` of them — the ticket asks
 * for ~20 instances, and a rate over fewer than 15 is too thin to lock a one-way
 * door on. If several clear, the highest rate wins; ties go to the cheaper one
 * to generate (higher acceptance), then alphabetically, so the result never
 * depends on directory order.
 *
 * `adopted: null` is a RESULT, not an error: it is the PRD's format-failure
 * branch firing, which the ticket counts as a successful outcome.
 *
 * ── What is NOT an instance ────────────────────────────────────────────────
 * A room whose generation cap tripped never reached a duel. It is reported —
 * it burned quota, and the acceptance rate is part of the cost — but it is not
 * a divergence sample. An aborted duel (a provider died) is counted and shown,
 * and excluded from `eligible`, because it says nothing about either model.
 */

export const ADOPTION_THRESHOLD = 0.6;
export const MIN_ELIGIBLE = 15;

/** One seed of one strategy, as the runner left it on disk. */
export interface SpikeInstance {
  readonly strategy: string;
  readonly index: number;
  /** `null` only if generation never finished (the provider died mid-generation). */
  readonly generation: GenerationRecord | null;
  /** `null` when there was no duel: no certified room, or the duel aborted. */
  readonly run: Run | null;
  /** Actions each competitor actually took, counted from the event log. `null` with no run. */
  readonly actions: Readonly<Record<string, number>> | null;
  /** Real provider calls per competitor in the duel, retries included. `null` with no run. */
  readonly providerCalls: Readonly<Record<string, number>> | null;
  /** Why the duel did not finish, when it did not. */
  readonly aborted: string | null;
}

export interface CompetitorStats {
  readonly modelKey: string;
  /** Escapes over completed duels. */
  readonly escapeRate: number | null;
  readonly medianEscapeActions: number | null;
  readonly p90EscapeActions: number | null;
  /** Invalid actions over actions taken, across every completed duel. */
  readonly invalidPerAction: number | null;
  readonly failedPerAction: number | null;
  readonly meanPromptTokens: number | null;
  readonly meanCompletionTokens: number | null;
  readonly meanProviderCalls: number | null;
}

export interface StrategySummary {
  readonly strategy: string;
  readonly planned: number;
  readonly certified: number;
  readonly capTripped: number;
  readonly duels: number;
  readonly aborted: number;
  readonly eligible: number;
  readonly diverged: number;
  /** `diverged / eligible`; `null` when nothing was eligible. */
  readonly divergenceRate: number | null;
  readonly reasons: Readonly<Record<DivergenceReason, number>>;
  readonly competitors: Readonly<Record<string, CompetitorStats>>;
  readonly generation: {
    readonly modelKey: string | null;
    /** Certified rooms over finished generations. */
    readonly acceptanceRate: number | null;
    readonly medianAttemptsToAccept: number | null;
    /** Every generation's calls and tokens, divided by the rooms they produced — the true cost of a room. */
    readonly callsPerCertifiedRoom: number | null;
    readonly tokensPerCertifiedRoom: number | null;
  };
  readonly meanChainLength: number | null;
}

export interface Decision {
  readonly adopted: string | null;
  readonly clears: Readonly<Record<string, boolean>>;
  readonly reasons: readonly string[];
}

export function modelKeyOf(model: { readonly provider: string; readonly modelId: string }): string {
  return `${model.provider}/${model.modelId}`;
}

export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}

/** Nearest-rank percentile. Small samples, so no interpolation to pretend at precision. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1]!;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((t, v) => t + v, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function summariseStrategy(strategy: string, instances: readonly SpikeInstance[]): StrategySummary {
  const generations = instances.flatMap((i) => (i.generation === null ? [] : [i.generation]));
  const certifiedRecords = generations.filter((g) => g.accepted);
  const runs = instances.flatMap((i) => (i.run === null ? [] : [i]));

  const reasons = Object.fromEntries(DIVERGENCE_REASONS.map((r) => [r, 0])) as Record<DivergenceReason, number>;
  let eligible = 0;
  let diverged = 0;
  for (const { run } of runs) {
    const verdict = divergenceOf(run!);
    reasons[verdict.reason] += 1;
    if (verdict.eligible) eligible += 1;
    if (verdict.diverged) diverged += 1;
  }

  const competitorIds = [...new Set(runs.flatMap(({ run }) => run!.competitors.map((c) => c.id)))].sort();
  const competitors: Record<string, CompetitorStats> = {};
  for (const id of competitorIds) {
    const rows = runs.map((instance) => {
      const run = instance.run!;
      return {
        summary: run.summaries.find((s) => s.competitorId === id)!,
        competitor: run.competitors.find((c) => c.id === id)!,
        actions: instance.actions?.[id] ?? 0,
        calls: instance.providerCalls?.[id] ?? null,
      };
    });
    const escapes = rows.filter((r) => r.summary.escaped).map((r) => r.summary.escapeActionCount!);
    const actions = rows.reduce((t, r) => t + r.actions, 0);
    const calls = rows.flatMap((r) => (r.calls === null ? [] : [r.calls]));
    competitors[id] = {
      modelKey: modelKeyOf(rows[0]!.competitor),
      escapeRate: ratio(escapes.length, rows.length),
      medianEscapeActions: median(escapes),
      p90EscapeActions: percentile(escapes, 0.9),
      invalidPerAction: ratio(rows.reduce((t, r) => t + r.summary.invalidActions, 0), actions),
      failedPerAction: ratio(rows.reduce((t, r) => t + r.summary.failedAttempts, 0), actions),
      meanPromptTokens: mean(rows.map((r) => r.summary.tokens.prompt)),
      meanCompletionTokens: mean(rows.map((r) => r.summary.tokens.completion)),
      meanProviderCalls: mean(calls),
    };
  }

  const genCalls = generations.reduce((t, g) => t + g.totals.providerCalls, 0);
  const genTokens = generations.reduce((t, g) => t + g.totals.promptTokens + g.totals.completionTokens, 0);

  return {
    strategy,
    planned: instances.length,
    certified: certifiedRecords.length,
    capTripped: generations.length - certifiedRecords.length,
    duels: runs.length,
    aborted: instances.filter((i) => i.aborted !== null).length,
    eligible,
    diverged,
    divergenceRate: ratio(diverged, eligible),
    reasons,
    competitors,
    generation: {
      modelKey: generations[0] === undefined ? null : modelKeyOf(generations[0]),
      acceptanceRate: ratio(certifiedRecords.length, generations.length),
      medianAttemptsToAccept: median(certifiedRecords.map((g) => g.totals.attempts)),
      callsPerCertifiedRoom: ratio(genCalls, certifiedRecords.length),
      tokensPerCertifiedRoom: ratio(genTokens, certifiedRecords.length),
    },
    meanChainLength: mean(certifiedRecords.map((g) => g.fingerprint!.chainLength)),
  };
}

export function decide(summaries: readonly StrategySummary[]): Decision {
  const clears: Record<string, boolean> = {};
  const reasons: string[] = [];
  for (const s of summaries) {
    const rate = s.divergenceRate;
    const ok = rate !== null && rate >= ADOPTION_THRESHOLD && s.eligible >= MIN_ELIGIBLE;
    clears[s.strategy] = ok;
    const shown = rate === null ? 'n/a' : `${Math.round(rate * 100)}%`;
    if (s.eligible < MIN_ELIGIBLE) {
      reasons.push(`${s.strategy}: ${s.eligible} eligible instance(s), below the ${MIN_ELIGIBLE} needed to call it (rate ${shown})`);
    } else {
      reasons.push(`${s.strategy}: diverged on ${s.diverged}/${s.eligible} = ${shown} — ${ok ? 'clears' : 'below'} ${ADOPTION_THRESHOLD * 100}%`);
    }
  }

  const winners = summaries
    .filter((s) => clears[s.strategy])
    .sort(
      (a, b) =>
        b.divergenceRate! - a.divergenceRate! ||
        (b.generation.acceptanceRate ?? 0) - (a.generation.acceptanceRate ?? 0) ||
        a.strategy.localeCompare(b.strategy),
    );
  const adopted = winners[0]?.strategy ?? null;
  reasons.push(
    adopted === null
      ? 'no strategy clears: the fallback branch fires — target difficulty near the models’ ceiling before anything else'
      : `adopt ${adopted}`,
  );
  return { adopted, clears, reasons };
}
