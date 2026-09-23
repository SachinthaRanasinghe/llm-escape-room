import type { Run } from '@/lib/schema/run';

/**
 * Was the published run typical of its silent repeats? — TICKET-6 (#7).
 *
 * `architecture.md` → Other calls · publication unit: one hero run is published,
 * the same room is replayed headless a few times, and the comparison states
 * whether the published outcome was typical. This file decides what "outcome"
 * and "typical" mean, so TICKET-10 (#10) can disclose it without redefining it.
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
 */

export type Outcome =
  | { readonly kind: 'winner'; readonly competitorId: string }
  | { readonly kind: 'tie' }
  | { readonly kind: 'none' };

export function outcomeOf(run: Run): Outcome {
  const escaped = run.summaries.filter((s) => s.escaped && s.escapeActionCount !== null);
  if (escaped.length === 0) return { kind: 'none' };
  const best = Math.min(...escaped.map((s) => s.escapeActionCount!));
  const winners = escaped.filter((s) => s.escapeActionCount === best);
  return winners.length === 1 ? { kind: 'winner', competitorId: winners[0]!.competitorId } : { kind: 'tie' };
}

function keyOf(outcome: Outcome): string {
  return outcome.kind === 'winner' ? `winner:${outcome.competitorId}` : outcome.kind;
}

/** `null` when there are no repeats to compare against — absence is a value, as in `Run.typicalOfRepeats`. */
export function isTypical(hero: Run, repeats: readonly Run[]): boolean | null {
  if (repeats.length === 0) return null;
  const counts = new Map<string, number>();
  for (const repeat of repeats) {
    const key = keyOf(outcomeOf(repeat));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = Math.max(...counts.values());
  return counts.get(keyOf(outcomeOf(hero))) === top;
}
