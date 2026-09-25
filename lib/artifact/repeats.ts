import { outcomeKey, outcomeOf, tallyOutcomes, typicalOf } from '@/lib/comparison/outcome';
import type { Run } from '@/lib/schema/run';
import { ArtifactError, type PublishedArtifact, type RepeatRecord } from './schema';

/**
 * The counts behind "was this run typical?" — TICKET-10 (#10).
 *
 * ── Derived, never copied ──────────────────────────────────────────────────
 * `buildRepeatRecord` counts outcomes from the repeat runs themselves, with the
 * same `outcomeOf` the harness judged `typicalOfRepeats` by. Nobody types a tally.
 *
 * ── Refused when it contradicts the verdict ────────────────────────────────
 * The worst thing the run page could do is print "Typical — competitor-b won in
 * 1 of 3" beside a table saying competitor-a won most. So `checkRepeats` refuses
 * any artifact whose block disagrees with itself or with `run.typicalOfRepeats`,
 * and it runs twice: when an artifact is built, and when one is loaded — a
 * hand-edited file fails the build, the same stance as `plan_drift`.
 *
 * Imports `lib/comparison`, never `lib/harness`: the artifact reads recorded
 * data and never reaches anything that re-runs (`boundary.test.ts`).
 */

export interface RepeatInput {
  /** The silent repeats that finished. */
  readonly runs: readonly Run[];
  /** How many stopped on a provider failure. `scripts/publish.mts` reads `matchup.json`'s `dropped.length`. */
  readonly dropped: number;
}

function competitorIds(run: Run): string {
  return run.competitors
    .map((c) => c.id)
    .sort()
    .join(',');
}

export function buildRepeatRecord(hero: Run, { runs, dropped }: RepeatInput): RepeatRecord {
  if (!Number.isInteger(dropped) || dropped < 0) {
    throw new ArtifactError('repeats_mismatch', `dropped must be a non-negative integer, received ${dropped}`);
  }
  const heroIds = competitorIds(hero);
  for (const repeat of runs) {
    if (repeat.runId === hero.runId) {
      throw new ArtifactError('repeats_mismatch', `repeat ${repeat.runId} has the hero's run id`);
    }
    if (repeat.roomId !== hero.roomId) {
      throw new ArtifactError('repeats_mismatch', `repeat ${repeat.runId} played room ${repeat.roomId}, hero ${hero.roomId}`);
    }
    if (competitorIds(repeat) !== heroIds) {
      throw new ArtifactError('repeats_mismatch', `repeat ${repeat.runId} competitors ${competitorIds(repeat)}, hero ${heroIds}`);
    }
  }
  return { completed: runs.length, dropped, outcomes: tallyOutcomes(runs) };
}

export function checkRepeats({ id, run, repeats }: Pick<PublishedArtifact, 'id' | 'run' | 'repeats'>): void {
  const refuse = (detail: string): never => {
    throw new ArtifactError('repeats_mismatch', `${id}: ${detail}`);
  };

  const sum = repeats.outcomes.reduce((total, o) => total + o.count, 0);
  if (sum !== repeats.completed) refuse(`outcome counts sum to ${sum}, completed is ${repeats.completed}`);

  const ids = new Set(run.competitors.map((c) => c.id));
  const keys = new Set<string>();
  for (const { outcome } of repeats.outcomes) {
    if (outcome.kind === 'winner' && !ids.has(outcome.competitorId)) refuse(`unknown winner ${outcome.competitorId}`);
    const key = outcomeKey(outcome);
    if (keys.has(key)) refuse(`outcome ${key} is counted twice`);
    keys.add(key);
  }

  const verdict = typicalOf(outcomeOf(run), repeats.outcomes);
  if (verdict !== run.typicalOfRepeats) {
    refuse(`the tally says typical=${verdict}, the run says typicalOfRepeats=${run.typicalOfRepeats}`);
  }
}
