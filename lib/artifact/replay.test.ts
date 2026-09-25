import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { buildReplay, buildSceneLayout, CURRENT_RENDERER } from '@/lib/replay';
import { buildArtifact } from './publish';
import { replayFromArtifact } from './replay';
import { ArtifactError, type PublishedArtifact } from './schema';
import { canonicalInput } from './testing';

const artifact = buildArtifact(canonicalInput());

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ArtifactError ? e.reason : `not an ArtifactError: ${String(e)}`;
  }
  return undefined;
}

describe('replayFromArtifact', () => {
  it('plays exactly what /replay plays for the same run, today', () => {
    const { data, renderer, plan } = replayFromArtifact(artifact);
    expect(data).toEqual(
      buildReplay({ log: loadCanonicalLog(), run: loadCanonicalRun(), layout: buildSceneLayout(loadCanonicalRoom()) }),
    );
    expect(renderer).toEqual(CURRENT_RENDERER);
    expect(plan).toEqual(artifact.manifest.beatPlan);
  });

  it('returns plain JSON — it crosses into a client component as props', () => {
    const result = replayFromArtifact(artifact);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('refuses a renderer major this build cannot draw', () => {
    const future: PublishedArtifact = { ...artifact, manifest: { ...artifact.manifest, rendererVersion: 'replay-v9.0' } };
    expect(reasonOf(() => replayFromArtifact(future))).toBe('unsupported_renderer');
  });

  it('refuses a beat plan that no longer follows from its timing', () => {
    const tampered: PublishedArtifact = {
      ...artifact,
      manifest: { ...artifact.manifest, beatPlan: { ...artifact.manifest.beatPlan, totalMs: 60_000 } },
    };
    expect(reasonOf(() => replayFromArtifact(tampered))).toBe('plan_drift');
  });

  it('plays the frozen timing, not the default', () => {
    const slow = { ...CURRENT_RENDERER, timing: { ...CURRENT_RENDERER.timing, beatMs: 6000 } };
    const frozen = replayFromArtifact(buildArtifact(canonicalInput({ renderer: slow })));
    expect(frozen.plan.beatMs).toBe(6000);
    expect(frozen.renderer.timing.beatMs).toBe(6000);
  });
});
