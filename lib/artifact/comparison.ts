import { buildComparison, type ComparisonData } from '@/lib/comparison';
import type { PublishedArtifact } from './schema';

/**
 * A published artifact → the post-run comparison. TICKET-10 (#10).
 *
 * The counterpart of `replayFromArtifact`: the `/run/[id]` server page calls it
 * at build time and hands the player the result as plain strings. It reads only
 * the artifact — the run, its repeat counts, the log and the public layout —
 * never the room, the fixtures or the live renderer.
 *
 * Actions taken are counted off the log: every event is one attempted action,
 * invalid ones included (`architecture.md` → *Invalid actions* consume a turn).
 * A competitor that ran out of actions has no `escapeActionCount`, so the log is
 * the only place its count lives.
 */
export function comparisonFromArtifact(artifact: PublishedArtifact): ComparisonData {
  const actionsTaken: Record<string, number> = {};
  for (const event of artifact.log) {
    actionsTaken[event.competitorId] = (actionsTaken[event.competitorId] ?? 0) + 1;
  }
  return buildComparison({
    run: artifact.run,
    repeats: artifact.repeats,
    actionsTaken,
    puzzleCount: Object.keys(artifact.manifest.layout.puzzleTargets).length,
  });
}
