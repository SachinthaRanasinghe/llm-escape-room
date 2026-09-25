import type { Run } from '@/lib/schema/run';

/**
 * Was the published run typical of its silent repeats? — TICKET-6 (#7); moved
 * here in TICKET-10 (#10) so `lib/artifact` can reach it without importing the
 * harness. `lib/harness/typicality.ts` re-exports it: there is ONE definition of
 * "outcome" and "typical", and the page that discloses variance uses the same
 * one the harness judged it with.
 *
 * `architecture.md` → Other calls · publication unit: one hero run is published,
 * the same room is replayed headless a few times, and the comparison states
 * whether the published outcome was typical.
 *
 * ── The outcome is who won, judged by actions ──────────────────────────────
 * A run's outcome is its winner — the competitor that escaped in the fewest
 * actions — or a tie, or nobody. Actions, not milliseconds: `escapeMs` is summed
 * provider latency, which the replay shows as think-time but which depends on
 * the serving stack as much as the model. Action count is what the product ranks
 * on.
 *
 * ── Typical means "in the mode" ────────────────────────────────────────────
 * The hero is typical when its outcome is the most common one among the
 * repeats. When two outcomes tie for most common, either counts as typical:
 * with three repeats a 1–1–1 split is common, and calling every hero atypical
 * there would claim more certainty than three samples hold.
 *
 * ── Tallies ────────────────────────────────────────────────────────────────
 * The published artifact carries repeat OUTCOME COUNTS, not repeat runs
 * (TICKET-10). `typicalOf` judges from such a tally; `isTypical` is defined
 * through it, so the two can never disagree.
 */

export type Outcome =
  | { readonly kind: 'winner'; readonly competitorId: string }
  | { readonly kind: 'tie' }
  | { readonly kind: 'none' };

export interface OutcomeCount {
  readonly outcome: Outcome;
  readonly count: number;
}

export function outcomeOf(run: Run): Outcome {
  const escaped = run.summaries.filter((s) => s.escaped && s.escapeActionCount !== null);
  if (escaped.length === 0) return { kind: 'none' };
  const best = Math.min(...escaped.map((s) => s.escapeActionCount!));
  const winners = escaped.filter((s) => s.escapeActionCount === best);
  return winners.length === 1 ? { kind: 'winner', competitorId: winners[0]!.competitorId } : { kind: 'tie' };
}

/** `winner:<id>` | `tie` | `none` — stable, so tallies and comparisons can key on it. */
export function outcomeKey(outcome: Outcome): string {
  return outcome.kind === 'winner' ? `winner:${outcome.competitorId}` : outcome.kind;
}

/** Repeat outcomes, counted. Ordered by count descending, then key, so a published tally is deterministic. */
export function tallyOutcomes(runs: readonly Run[]): OutcomeCount[] {
  const counts = new Map<string, OutcomeCount>();
  for (const run of runs) {
    const outcome = outcomeOf(run);
    const key = outcomeKey(outcome);
    counts.set(key, { outcome, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return [...counts.entries()]
    .sort(([ka, a], [kb, b]) => b.count - a.count || (ka < kb ? -1 : ka > kb ? 1 : 0))
    .map(([, entry]) => entry);
}

/** `null` when the tally is empty — absence is a value, as in `Run.typicalOfRepeats`. */
export function typicalOf(hero: Outcome, tally: readonly OutcomeCount[]): boolean | null {
  if (tally.length === 0) return null;
  const top = Math.max(...tally.map((t) => t.count));
  const key = outcomeKey(hero);
  return tally.some((t) => outcomeKey(t.outcome) === key && t.count === top);
}

export function isTypical(hero: Run, repeats: readonly Run[]): boolean | null {
  return typicalOf(outcomeOf(hero), tallyOutcomes(repeats));
}
