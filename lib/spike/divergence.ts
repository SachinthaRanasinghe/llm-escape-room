import type { Run, RunSummary } from '@/lib/schema/run';

/**
 * Did the two models diverge on this room? — TICKET-7 (#8).
 *
 * The PRD's leading metric: "runs where the two models' outcomes differ
 * meaningfully (one fails, or escape times differ by >25%)", with ≥60% as the
 * bar. This file turns that sentence into a function, so the spike's verdict is
 * code with tests rather than a judgement made over a spreadsheet.
 *
 * ── "Escape time" is ACTIONS, never milliseconds ───────────────────────────
 * The same call `lib/harness/typicality.ts` makes, for the same reason:
 * `escapeMs` is summed provider latency, which depends on the serving stack as
 * much as the model. Two models on one provider but different sizes would
 * "diverge" on milliseconds from hardware alone. Action count is what the
 * product ranks on and what a viewer sees as beats.
 *
 * ── Eligible means the ACTION budget decided it ────────────────────────────
 * The ticket's rule reads "diverges … with both models inside the action
 * budget". A competitor that ran out of TOKENS or WALL CLOCK was stopped by
 * something other than play, so the instance says nothing about the substrate
 * and is excluded. Running out of actions is a legitimate result — it is how a
 * model fails to escape — so `budget_actions` stays eligible.
 */

/** Both escaped, and the slower took more than this multiple of the faster's actions. */
export const DIVERGENCE_GAP = 1.25;

export const DIVERGENCE_REASONS = ['one_escaped', 'action_gap', 'same', 'neither_escaped', 'ineligible'] as const;
export type DivergenceReason = (typeof DIVERGENCE_REASONS)[number];

export interface InstanceVerdict {
  readonly eligible: boolean;
  readonly diverged: boolean;
  readonly reason: DivergenceReason;
}

function stoppedByPlay(summary: RunSummary): boolean {
  return summary.endedBecause === 'escaped' || summary.endedBecause === 'budget_actions';
}

export function divergenceOf(run: Run): InstanceVerdict {
  if (run.summaries.length !== 2) {
    throw new RangeError(`divergenceOf: a duel has two competitors, run ${run.runId} has ${run.summaries.length}`);
  }
  const [a, b] = run.summaries as [RunSummary, RunSummary];

  if (!stoppedByPlay(a) || !stoppedByPlay(b)) return { eligible: false, diverged: false, reason: 'ineligible' };
  if (a.escaped !== b.escaped) return { eligible: true, diverged: true, reason: 'one_escaped' };
  if (!a.escaped) return { eligible: true, diverged: false, reason: 'neither_escaped' };

  const fast = Math.min(a.escapeActionCount!, b.escapeActionCount!);
  const slow = Math.max(a.escapeActionCount!, b.escapeActionCount!);
  // Strictly greater: the PRD says ">25%", so exactly 1.25× is not a divergence.
  return slow > DIVERGENCE_GAP * fast
    ? { eligible: true, diverged: true, reason: 'action_gap' }
    : { eligible: true, diverged: false, reason: 'same' };
}
