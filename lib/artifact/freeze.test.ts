import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_RENDERER, type RendererSnapshot } from '@/lib/replay';
import { buildArtifact } from './publish';
import { replayFromArtifact } from './replay';
import { ArtifactError } from './schema';
import { loadArtifact } from './store';
import { canonicalInput } from './testing';

/**
 * THE RENDERER-BUMP TEST — "a published run must replay identically after the
 * renderer changes" (TICKET-9, #9).
 *
 * The renderer is changed by MOCKING it, not by editing the constants in a
 * test: this must hold on every future commit, including the one that really
 * retunes the renderer, and it must show that the loader cannot reach the live
 * renderer at all — not merely that two builds happen to agree today.
 *
 * So: play the committed `published/canonical.json`; swap the live renderer for
 * a bumped one (new version, timing, camera, colours); re-import the loader
 * fresh under the swap; play the same file again. Nothing may move. The positive
 * control proves the swap really reached the renderer, so the equality is not
 * passing vacuously.
 */

const BUMPED: RendererSnapshot = {
  ...CURRENT_RENDERER,
  rendererVersion: 'replay-v2.1',
  timing: { ...CURRENT_RENDERER.timing, beatMs: 4000, laneOffsetMs: 0, walkFraction: 0.4 },
  camera: { ...CURRENT_RENDERER.camera, fov: 55, position: [0, 7, 8] },
  assets: { ...CURRENT_RENDERER.assets, laneColours: ['#ff0000', '#00ff00'] },
  geometry: { ...CURRENT_RENDERER.geometry, wallHeight: 2.4 },
};

/** The canonical run's published length. A literal, so it pins the pacing independently of any constant. */
const PUBLISHED_TOTAL_MS = 79_500;

async function underBumpedRenderer(supportedMajors: readonly number[] = [2]) {
  vi.resetModules();
  vi.doMock('@/lib/replay/beats', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/replay/beats')>()),
    BEAT_MS: BUMPED.timing.beatMs,
    LANE_OFFSET_MS: BUMPED.timing.laneOffsetMs,
    WALK_FRACTION: BUMPED.timing.walkFraction,
    DEFAULT_TIMING: BUMPED.timing,
    RENDERER_VERSION: BUMPED.rendererVersion,
  }));
  vi.doMock('@/lib/replay/renderer', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/replay/renderer')>()),
    CURRENT_RENDERER: BUMPED,
    SUPPORTED_RENDERER_MAJORS: supportedMajors,
  }));
  const artifact = await import('@/lib/artifact');
  const replay = await import('@/lib/replay');
  return { ...artifact, live: replay.CURRENT_RENDERER };
}

afterEach(() => {
  vi.doUnmock('@/lib/replay/beats');
  vi.doUnmock('@/lib/replay/renderer');
  vi.resetModules();
});

describe('a published run after a renderer bump', () => {
  it('the bump is real — publishing today under it would freeze something different', () => {
    const committed = loadArtifact('canonical').manifest;
    const bumped = buildArtifact(canonicalInput({ renderer: BUMPED })).manifest;
    expect(bumped.rendererVersion).not.toBe(committed.rendererVersion);
    expect(bumped.beatPlan.totalMs).not.toBe(committed.beatPlan.totalMs);
    expect(bumped.camera.fov).not.toBe(committed.camera.fov);
    expect(bumped.assets.laneColours).not.toEqual(committed.assets.laneColours);
  });

  it('replays identically: same data, same frozen renderer, same plan', async () => {
    const before = replayFromArtifact(loadArtifact('canonical'));
    expect(before.plan.totalMs).toBe(PUBLISHED_TOTAL_MS);

    const bumped = await underBumpedRenderer();
    const after = bumped.replayFromArtifact(bumped.loadArtifact('canonical'));

    expect(after).toEqual(before);
    expect(after.plan.totalMs).toBe(PUBLISHED_TOTAL_MS);
    expect(after.renderer.rendererVersion).toBe('replay-v2.0');
  });

  it('positive control: the swap really reached the live renderer', async () => {
    const bumped = await underBumpedRenderer();
    expect(bumped.live).toEqual(BUMPED);
    const fresh = bumped.buildArtifact(canonicalInput({ renderer: bumped.live }));
    expect(fresh.manifest.beatPlan.totalMs).not.toBe(PUBLISHED_TOTAL_MS);
    expect(bumped.replayFromArtifact(fresh).plan.beatMs).toBe(BUMPED.timing.beatMs);
  });

  it('a MAJOR bump refuses the old artifact rather than drawing it wrong', async () => {
    const bumped = await underBumpedRenderer([3]);
    try {
      bumped.replayFromArtifact(bumped.loadArtifact('canonical'));
      expect.unreachable('a renderer that cannot draw major 2 played a major-2 artifact');
    } catch (error) {
      // Compared by name: `resetModules` gives the fresh import its own ArtifactError class.
      expect((error as Error).name).toBe(ArtifactError.name);
      expect((error as ArtifactError).reason).toBe('unsupported_renderer');
    }
  });
});
