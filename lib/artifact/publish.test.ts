import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom } from '@/fixtures';
import { buildReplay, buildSceneLayout, CURRENT_RENDERER, planBeats, ReplayError } from '@/lib/replay';
import { event, runFixture } from '@/lib/replay/testing';
import { buildArtifact } from './publish';
import { ArtifactError, ArtifactSchemaError } from './schema';
import { canonicalInput, canonicalSecrets, repeatOf, withRepeats } from './testing';

describe('buildArtifact on the canonical run', () => {
  const input = canonicalInput();
  const artifact = buildArtifact(input);

  it('has exactly the envelope fields — no room, nothing else', () => {
    expect(Object.keys(artifact).sort()).toEqual([
      'artifactVersion',
      'id',
      'log',
      'manifest',
      'publishedAt',
      'repeats',
      'run',
    ]);
    expect(Object.keys(artifact.manifest).sort()).toEqual([
      'assets',
      'beatPlan',
      'camera',
      'geometry',
      'layout',
      'rendererVersion',
      'timing',
    ]);
  });

  it('freezes the renderer it was given', () => {
    const { manifest } = artifact;
    expect(manifest.rendererVersion).toBe(CURRENT_RENDERER.rendererVersion);
    expect(manifest.timing).toEqual(CURRENT_RENDERER.timing);
    expect(manifest.camera).toEqual(CURRENT_RENDERER.camera);
    expect(manifest.assets).toEqual(CURRENT_RENDERER.assets);
    expect(manifest.geometry).toEqual(CURRENT_RENDERER.geometry);
  });

  it('freezes the beat plan and the public layout', () => {
    const layout = buildSceneLayout(input.room);
    expect(artifact.manifest.layout).toEqual(layout);
    const data = buildReplay({ log: input.log, run: input.run, layout });
    expect(artifact.manifest.beatPlan).toEqual(planBeats(data, CURRENT_RENDERER.timing));
    expect(artifact.manifest.beatPlan.totalMs).toBe(79_500);
  });

  it('carries the log and run record untouched', () => {
    expect(artifact.log).toEqual(input.log);
    expect(artifact.run).toEqual(input.run);
  });

  it("never carries the room's answers, codes, clues or descriptions in the manifest", () => {
    // The log legitimately holds what the models typed — a correct code a model
    // entered is what it did, not a leak. The renderer's half must hold nothing.
    const manifest = JSON.stringify(artifact.manifest);
    for (const secret of canonicalSecrets()) expect(manifest, secret).not.toContain(secret);
  });
});

describe('buildArtifact refuses', () => {
  it('a room that is not the run’s', () => {
    const room = { ...loadCanonicalRoom(), roomId: 'another-room' };
    const error = (() => {
      try {
        buildArtifact(canonicalInput({ room }));
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ArtifactError);
    expect((error as ArtifactError).reason).toBe('room_mismatch');
  });

  it('a log with a gap', () => {
    const log = loadCanonicalLog().filter((e) => !(e.competitorId === 'model-a' && e.seq === 3));
    expect(() => buildArtifact(canonicalInput({ log }))).toThrow(ReplayError);
  });

  it('anything key-shaped, even in a model-written intent — and names only the kind', () => {
    const key = `gsk_${'a'.repeat(24)}`;
    const run = { ...runFixture(['a', 'b']), roomId: loadCanonicalRoom().roomId };
    const log = [
      event({ competitorId: 'a', action: { name: 'look', intent: `try ${key}` } }),
      event({ competitorId: 'b' }),
    ];
    try {
      buildArtifact(canonicalInput({ run, log }));
      expect.unreachable('a leak was published');
    } catch (e) {
      expect(e).toBeInstanceOf(ArtifactError);
      expect((e as ArtifactError).reason).toBe('leak');
      expect((e as ArtifactError).message).not.toContain(key);
    }
  });

  it('an id that is not a slug', () => {
    expect(() => buildArtifact(canonicalInput({ id: '../escape' }))).toThrow(ArtifactSchemaError);
  });
});

describe('the repeats block', () => {
  it('publishes counts only — no repeat run, and no reason a repeat was dropped', () => {
    const hero = canonicalInput().run;
    const artifact = buildArtifact(canonicalInput(withRepeats([repeatOf(hero, 1, 10, null)], 2)));
    expect(artifact.repeats).toEqual({
      completed: 1,
      dropped: 2,
      outcomes: [{ outcome: { kind: 'winner', competitorId: 'model-a' }, count: 1 }],
    });
    const text = JSON.stringify(artifact);
    expect(text).not.toContain(`${hero.runId}-r1`);
    expect(text).not.toContain('"reason"');
  });
});
