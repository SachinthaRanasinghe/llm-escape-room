import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import type { Outcome } from '@/lib/comparison';
import type { BeatPlan, RendererSnapshot, SceneLayout } from '@/lib/replay';
import { buildArtifact } from './publish';
import {
  ArtifactSchemaError,
  BeatPlanSchema,
  OutcomeSchema,
  parseArtifact,
  RenderManifestSchema,
  SceneLayoutSchema,
} from './schema';
import { canonicalInput, repeatOf, withRepeats } from './testing';

// With one repeat, so the repeats block has an outcome to plant a key inside.
const valid = buildArtifact(canonicalInput(withRepeats([repeatOf(canonicalInput().run, 1, 10, null)])));

/** A deep copy with `edit` applied — the valid artifact is never mutated. */
function variant(edit: (raw: Record<string, any>) => void): unknown {
  const raw = structuredClone(valid) as Record<string, any>;
  edit(raw);
  return raw;
}

describe('the artifact schema', () => {
  it('accepts a real artifact, and round-trips it through JSON', () => {
    expect(parseArtifact(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it('refuses an unknown key at every level — nothing rides along unlisted', () => {
    const planted = [
      (r: Record<string, any>) => (r.room = {}),
      (r: Record<string, any>) => (r.manifest.apiKey = 'x'),
      (r: Record<string, any>) => (r.manifest.camera.endpoint = 'x'),
      (r: Record<string, any>) => (r.manifest.assets.scene.extra = '#000000'),
      (r: Record<string, any>) => (r.manifest.layout.objects[0].answer = '4471'),
      (r: Record<string, any>) => (r.manifest.beatPlan.extra = 1),
      (r: Record<string, any>) => (r.repeats.reasons = ['provider said no']),
      (r: Record<string, any>) => (r.repeats.outcomes[0].outcome.runId = 'x'),
    ];
    for (const plant of planted) {
      expect(() => parseArtifact(variant(plant)), plant.toString()).toThrow(ArtifactSchemaError);
    }
  });

  it('refuses a future envelope version loudly', () => {
    expect(() => parseArtifact(variant((r) => (r.artifactVersion = 1)))).toThrow(/artifactVersion 0/);
  });

  it('refuses an id that could escape the directory or collide', () => {
    for (const id of ['../x', 'Canonical', 'a/b', '', '-lead', 'a'.repeat(65), 'a.json']) {
      expect(() => parseArtifact(variant((r) => (r.id = id))), id).toThrow(ArtifactSchemaError);
    }
    expect(() => parseArtifact(variant((r) => (r.id = 'a'.repeat(64))))).not.toThrow();
  });

  it('refuses a renderer version not shaped replay-v<major>.<minor>', () => {
    for (const version of ['v0.1', 'replay-v0', 'replay-0.1']) {
      expect(() => parseArtifact(variant((r) => (r.manifest.rendererVersion = version))), version).toThrow(
        ArtifactSchemaError,
      );
    }
  });

  it('refuses a colour that is not a hex colour', () => {
    expect(() => parseArtifact(variant((r) => (r.manifest.assets.laneColours = ['red'])))).toThrow(ArtifactSchemaError);
  });
});

describe('the schemas stay in step with what the player consumes', () => {
  it('matches the replay types', () => {
    expectTypeOf<z.infer<typeof SceneLayoutSchema>>().toExtend<SceneLayout>();
    expectTypeOf<z.infer<typeof BeatPlanSchema>>().toExtend<BeatPlan>();
    type Frozen = Omit<z.infer<typeof RenderManifestSchema>, 'layout' | 'beatPlan'>;
    expectTypeOf<Frozen>().toExtend<RendererSnapshot>();
  });

  it('matches the outcome type the comparison judges with', () => {
    expectTypeOf<z.infer<typeof OutcomeSchema>>().toExtend<Outcome>();
    expectTypeOf<Outcome>().toExtend<z.infer<typeof OutcomeSchema>>();
  });
});
