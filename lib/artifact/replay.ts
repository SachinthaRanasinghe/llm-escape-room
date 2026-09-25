import {
  buildReplay,
  planBeats,
  rendererMajor,
  SUPPORTED_RENDERER_MAJORS,
  type BeatPlan,
  type RendererSnapshot,
  type ReplayData,
} from '@/lib/replay';
import { ArtifactError, type PublishedArtifact } from './schema';

/**
 * A published artifact → what the player needs. TICKET-9 (#9).
 *
 * ── Only the artifact's own renderer, never the live one ───────────────────
 * The whole point of the manifest is that a published run does not change when
 * the renderer does. So everything the player gets — timing, camera, colours,
 * proportions, the plan — comes out of `artifact.manifest`. This module must
 * never import the live renderer snapshot or the default timing;
 * `lib/artifact/boundary.test.ts` checks the source, and
 * `freeze.test.ts` swaps the live renderer out from under it and checks nothing
 * moves. The only thing taken from the live code is WHICH renderer majors it can
 * still draw.
 *
 * ── Refuse rather than drift ───────────────────────────────────────────────
 * A renderer major this build cannot draw is `unsupported_renderer`. A plan that
 * no longer follows from the frozen timing — a hand-edited file, or a change to
 * `planBeats`'s arithmetic that would silently re-pace every published run — is
 * `plan_drift`. Both fail the build of `/run/[id]`, which is where to find out.
 * Neither ever falls back to the live renderer.
 */

export interface FrozenReplay {
  readonly data: ReplayData;
  readonly renderer: RendererSnapshot;
  readonly plan: BeatPlan;
}

export function replayFromArtifact(artifact: PublishedArtifact): FrozenReplay {
  const { manifest } = artifact;

  const major = rendererMajor(manifest.rendererVersion);
  if (major === null || !SUPPORTED_RENDERER_MAJORS.includes(major)) {
    throw new ArtifactError(
      'unsupported_renderer',
      `${manifest.rendererVersion}; this build draws major ${SUPPORTED_RENDERER_MAJORS.join(', ')}`,
    );
  }

  const data = buildReplay({ log: artifact.log, run: artifact.run, layout: manifest.layout });

  // Key order is fixed by construction in `planBeats` and by the schema's parse order.
  const derived = planBeats(data, manifest.timing);
  if (JSON.stringify(derived) !== JSON.stringify(manifest.beatPlan)) {
    throw new ArtifactError('plan_drift', `${artifact.id}: the frozen beat plan no longer follows from its timing`);
  }

  return {
    data,
    renderer: {
      rendererVersion: manifest.rendererVersion,
      timing: manifest.timing,
      camera: manifest.camera,
      assets: manifest.assets,
      geometry: manifest.geometry,
    },
    plan: manifest.beatPlan,
  };
}
