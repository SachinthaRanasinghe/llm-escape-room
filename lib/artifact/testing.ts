import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { CURRENT_RENDERER } from '@/lib/replay';
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
