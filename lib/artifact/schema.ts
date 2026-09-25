import { z } from 'zod';
import { EventLogSchema } from '@/lib/schema/event';
import { OBJECT_KINDS } from '@/lib/schema/room';
import { RunSchema } from '@/lib/schema/run';
import { ARTIFACT_VERSION, ArtifactVersionSchema, SchemaError } from '@/lib/schema/version';

/**
 * The published artifact — the thing you send someone. TICKET-9 (#9).
 *
 * One file, `published/<id>.json`: the event log, the run record, and a FROZEN
 * render manifest. `architecture.md` → *Data model · RenderManifest*: the log
 * stays the source of truth and can be re-rendered as the visuals evolve; the
 * manifest guarantees an already-published run never changes under a viewer's
 * feet.
 *
 * ── Strict everywhere ──────────────────────────────────────────────────────
 * Every object is a `z.strictObject`, all the way down. An unknown key is
 * refused, which is the mechanical half of "the artifact carries no secret":
 * nothing can ride along in a field nobody listed. The other half is
 * `scan.ts`.
 *
 * ── No room ────────────────────────────────────────────────────────────────
 * A `RoomSpec` carries every answer. The manifest holds its public projection,
 * the `SceneLayout` (`lib/replay/layout.ts`), and nothing else of it.
 *
 * ── Timing AND plan ────────────────────────────────────────────────────────
 * Both are stored. `beatPlan` is what plays; `timing` is how to re-derive it,
 * and the loader refuses a file where the two disagree (`replay.ts`).
 *
 * The shapes mirror `lib/replay/types.ts` and `lib/replay/renderer.ts`, which are
 * plain TypeScript because they ship to the browser; `schema.test.ts` holds the
 * two in step at the type level.
 */

/** URL segment and filename. A lowercase slug: no path traversal, no case collisions on macOS. */
export const ARTIFACT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const Vec2Schema = z.tuple([z.number(), z.number()]);
const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const Ms = z.number().int().nonnegative();
const Fraction = z.number().min(0).max(1);

export const SceneLayoutSchema = z.strictObject({
  roomId: z.string().min(1),
  themeName: z.string().min(1),
  objects: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      kind: z.enum(OBJECT_KINDS),
      parentId: z.string().min(1).nullable(),
      position: Vec2Schema,
    }),
  ),
  puzzleTargets: z.record(z.string(), z.string()),
  exitObjectId: z.string().min(1),
  centre: Vec2Schema,
});

export const BeatTimingSchema = z.strictObject({
  beatMs: z.number().int().positive(),
  introMs: Ms,
  outroMs: Ms,
  laneOffsetMs: Ms,
  walkFraction: Fraction,
  actFraction: Fraction,
  exitWalkMs: z.number().int().positive(),
  exitFadeMs: z.number().int().positive(),
});

export const CameraPlanSchema = z.strictObject({
  position: Vec3Schema,
  lookAt: Vec3Schema,
  fov: z.number().positive(),
  swayAmplitude: z.number().nonnegative(),
  swayPeriodMs: z.number().positive(),
});

export const RendererAssetsSchema = z.strictObject({
  laneColours: z.array(HexSchema).min(1),
  scene: z.strictObject({
    background: HexSchema,
    floor: HexSchema,
    wall: HexSchema,
    success: HexSchema,
    failure: HexSchema,
    locked: HexSchema,
    unlocked: HexSchema,
  }),
  kindColours: z.strictObject({
    container: HexSchema,
    fixture: HexSchema,
    portable: HexSchema,
    lock: HexSchema,
    door: HexSchema,
  }),
});

export const StageGeometrySchema = z.strictObject({
  roomHalf: z.number().positive(),
  wallHeight: z.number().positive(),
  standOff: z.number().nonnegative(),
});

export const BeatPlanSchema = z.strictObject({
  beatMs: z.number().int().positive(),
  introMs: Ms,
  outroMs: Ms,
  laneOffsetsMs: z.array(Ms),
  beatCounts: z.array(Ms),
  totalMs: Ms,
  walkFraction: Fraction,
  actFraction: Fraction,
  exitWalkMs: z.number().int().positive(),
  exitFadeMs: z.number().int().positive(),
});

export const RenderManifestSchema = z.strictObject({
  rendererVersion: z.string().regex(/^replay-v\d+\.\d+$/),
  timing: BeatTimingSchema,
  camera: CameraPlanSchema,
  assets: RendererAssetsSchema,
  geometry: StageGeometrySchema,
  layout: SceneLayoutSchema,
  beatPlan: BeatPlanSchema,
});
export type RenderManifest = z.infer<typeof RenderManifestSchema>;

/**
 * A run's outcome — `lib/comparison/outcome.ts`'s `Outcome`, as data.
 * `schema.test.ts` holds the two in step at the type level.
 */
export const OutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('winner'), competitorId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('tie') }),
  z.strictObject({ kind: z.literal('none') }),
]);

/**
 * What the silent repeats of this room came to — TICKET-10 (#10).
 *
 * Counts, not runs: the page states "won in 2 of 3", and needs nothing more.
 * No repeat log is published, and no reason a repeat was dropped — that reason
 * is provider error text. `lib/artifact/repeats.ts` derives the block from the
 * repeat runs and refuses one that disagrees with `run.typicalOfRepeats`.
 */
export const RepeatsSchema = z.strictObject({
  /** Silent repeats that finished — what `run.typicalOfRepeats` was judged on. */
  completed: z.number().int().nonnegative(),
  /** Repeats that stopped on a provider failure. Counted, never explained. */
  dropped: z.number().int().nonnegative(),
  /** `tallyOutcomes` order: count descending, then key. Sums to `completed`. */
  outcomes: z.array(z.strictObject({ outcome: OutcomeSchema, count: z.number().int().positive() })),
});
export type RepeatRecord = z.infer<typeof RepeatsSchema>;

export const PublishedArtifactSchema = z.strictObject({
  artifactVersion: ArtifactVersionSchema,
  id: z.string().regex(ARTIFACT_ID),
  /** ISO 8601. When it was frozen — not when the run happened (`run.startedAt`). */
  publishedAt: z.iso.datetime(),
  /** Competitors, budget, per-competitor summaries and `typicalOfRepeats` — what TICKET-10 (#10) compares. */
  run: RunSchema,
  /** The counts behind `run.typicalOfRepeats`. Required: no repeats is `{ completed: 0, dropped: 0, outcomes: [] }`. */
  repeats: RepeatsSchema,
  log: EventLogSchema,
  manifest: RenderManifestSchema,
});
export type PublishedArtifact = z.infer<typeof PublishedArtifactSchema>;

export class ArtifactSchemaError extends SchemaError {}

export function parseArtifact(raw: unknown): PublishedArtifact {
  const result = PublishedArtifactSchema.safeParse(raw);
  if (!result.success) {
    throw new ArtifactSchemaError(`invalid artifact (expected artifactVersion ${ARTIFACT_VERSION})`, result.error.issues);
  }
  return result.data;
}

/**
 * Why an artifact could not be built or played — machine-readable, like
 * `ReplayError`. A schema failure is `ArtifactSchemaError` instead.
 */
export const ARTIFACT_ERROR_REASONS = [
  'room_mismatch',
  'leak',
  'plan_drift',
  'unsupported_renderer',
  'not_found',
  'repeats_mismatch',
] as const;
export type ArtifactErrorReason = (typeof ARTIFACT_ERROR_REASONS)[number];

export class ArtifactError extends Error {
  readonly reason: ArtifactErrorReason;
  readonly detail: string;

  constructor(reason: ArtifactErrorReason, detail: string) {
    super(`artifact: ${reason} (${detail})`);
    this.name = 'ArtifactError';
    this.reason = reason;
    this.detail = detail;
  }
}
