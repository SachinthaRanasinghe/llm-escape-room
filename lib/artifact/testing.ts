import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { isTypical } from '@/lib/comparison/outcome';
import { CURRENT_RENDERER } from '@/lib/replay';
import type { Run, RunSummary } from '@/lib/schema/run';
import { CANONICAL_PUBLISHED_AT, type BuildArtifactInput } from './publish';

/**
 * Test support for the artifact — not exported from `index.ts`, like
 * `lib/replay/testing.ts`.
 */

export function canonicalInput(partial: Partial<BuildArtifactInput> = {}): BuildArtifactInput {
  return {
    id: 'canonical',
    run: loadCanonicalRun(),
    log: loadCanonicalLog(),
    room: loadCanonicalRoom(),
    repeats: { runs: [], dropped: 0 },
    renderer: CURRENT_RENDERER,
    publishedAt: CANONICAL_PUBLISHED_AT,
    ...partial,
  };
}

/** Everything in the canonical room a viewer must not be handed by the renderer: answers, codes, clue text. */
export function canonicalSecrets(): string[] {
  const room = loadCanonicalRoom();
  return [
    ...room.puzzles.filter((p) => p.kind !== 'key').map((p) => p.answer),
    ...room.objects.flatMap((o) => (o.lock?.opensWith === 'code' ? [o.lock.code] : [])),
    ...room.objects.flatMap((o) => (o.clueText === null ? [] : [o.clueText])),
    ...room.objects.map((o) => o.description),
  ];
}

/** A canonical-run summary where the competitor escaped in `actions` actions, or did not (`null`). */
export function summaryOf(competitorId: string, actions: number | null): RunSummary {
  const escaped = actions !== null;
  return {
    competitorId,
    escaped,
    escapeActionCount: actions,
    escapeMs: escaped ? 20_000 : null,
    puzzlesSolved: escaped ? 3 : 1,
    failedAttempts: 0,
    invalidActions: 0,
    tokens: { prompt: 1, completion: 1 },
    costUsd: 0,
    endedBecause: escaped ? 'escaped' : 'budget_actions',
  };
}

/** Silent repeat `index` of `hero`, where model-a escaped in `a` actions and model-b in `b` (`null` = did not). */
export function repeatOf(hero: Run, index: number, a: number | null, b: number | null): Run {
  return {
    ...hero,
    runId: `${hero.runId}-r${index}`,
    summaries: [summaryOf('model-a', a), summaryOf('model-b', b)],
    typicalOfRepeats: null,
  };
}

/**
 * `BuildArtifactInput` overrides for the canonical run published with these
 * repeats — the hero's `typicalOfRepeats` set the way `runMatchup` sets it, so a
 * fixture is consistent by construction.
 */
export function withRepeats(repeats: readonly Run[], dropped = 0): Partial<BuildArtifactInput> {
  const hero = loadCanonicalRun();
  return {
    run: { ...hero, typicalOfRepeats: isTypical(hero, repeats) },
    repeats: { runs: repeats, dropped },
  };
}
