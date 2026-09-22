import { z } from 'zod';
import { SPEC_VERSION, SchemaError, SpecVersionSchema } from './version';

/**
 * A generated escape room: its objects, its chain of puzzles, and the answers.
 *
 * THIS IS THE INTERNAL CONTRACT — `strictObject` throughout, nothing optional.
 * It is what the solver has already proved and what the simulator trusts.
 *
 * DO NOT TIDY THIS INTO A MODEL-FACING SHAPE. The generator's looser output
 * schema — the one a model is actually asked to produce, with the tolerances
 * structured output needs — belongs to TICKET-5 (#6), which parses and narrows
 * it INTO this type. That is the same "parse, don't cast" split the sibling
 * project uses between `JobExtractionSchema` and `StoredJobExtractionSchema`.
 * Adding `.optional()` here to make a generator's life easier moves the
 * tolerance to the wrong side of the boundary.
 *
 * ── The structural / semantic boundary ──────────────────────────────────────
 * This schema validates SHAPE ONLY. It deliberately does NOT check that
 * `clueObjectId` names a real object, that the chain actually connects, or that
 * the room is solvable. Those are semantic properties and they belong to the
 * solver in TICKET-3 (#3).
 *
 * That split is load-bearing: `fixtures/rooms/invalid/` contains four rooms that
 * are structurally perfect and semantically broken, and they exist so the solver
 * can be tested on WHICH rule it rejected. If this schema grew a `.refine()` that
 * caught them, they would fail here instead and the solver would lose its test
 * corpus. The ONLY thing that fails at parse time is a version mismatch.
 *
 * ── Secrecy ────────────────────────────────────────────────────────────────
 * A `RoomSpec` carries every answer. It must never be serialised into anything a
 * competitor model can see. TICKET-2 (#2) owns that boundary — the simulator is
 * the sole authority on what a competitor observes — but the warning belongs on
 * the type that holds the secrets.
 */

/** What an object is, which decides which verbs make sense against it. */
export const OBJECT_KINDS = ['container', 'fixture', 'portable', 'lock', 'door'] as const;
export const ObjectKindSchema = z.enum(OBJECT_KINDS);
export type ObjectKind = z.infer<typeof ObjectKindSchema>;

/**
 * How a locked object opens. A discriminated union rather than a bag of nullable
 * fields, so "a key lock with a code" is unrepresentable rather than merely
 * invalid.
 */
export const LockSchema = z.discriminatedUnion('opensWith', [
  z.strictObject({ opensWith: z.literal('key'), keyItemId: z.string().min(1) }),
  z.strictObject({ opensWith: z.literal('code'), code: z.string().min(1) }),
]);
export type Lock = z.infer<typeof LockSchema>;

export const RoomObjectSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  /** What a competitor sees on `look`. Must not leak what `inspect` reveals. */
  description: z.string().min(1),
  kind: ObjectKindSchema,
  /** `null` when the object is not locked — absence is a value, never a missing key. */
  lock: LockSchema.nullable(),
  /** Ids of objects inside this one. Empty array, never null, when it holds nothing. */
  contains: z.array(z.string().min(1)),
  /** What `inspect` reveals. `null` when inspecting it tells you nothing. */
  clueText: z.string().nullable(),
});
export type RoomObject = z.infer<typeof RoomObjectSchema>;

/**
 * One link in the chain. `clueObjectId` holds the hint, `answer` is what that
 * hint yields, and `unlocksObjectId` is what the answer opens — which in turn
 * holds the next puzzle's clue. That cycle is the room.
 */
export const PuzzleSchema = z.strictObject({
  id: z.string().min(1),
  /** 1-based position in the chain. */
  order: z.number().int().positive(),
  /** `code` is typed into a lock; `answer` is submitted directly. */
  kind: z.enum(['code', 'answer']),
  clueObjectId: z.string().min(1),
  /** The expected answer, compared case-insensitively after trimming by the simulator. */
  answer: z.string().min(1),
  unlocksObjectId: z.string().min(1),
});
export type Puzzle = z.infer<typeof PuzzleSchema>;

export const DIFFICULTY_BANDS = ['easy', 'standard', 'hard'] as const;
export const DifficultyBandSchema = z.enum(DIFFICULTY_BANDS);

export const RoomSpecSchema = z.strictObject({
  specVersion: SpecVersionSchema,
  /** The seed this room was generated from; `(seed, specVersion)` reproduces it. */
  seed: z.string().min(1),
  roomId: z.string().min(1),
  theme: z.strictObject({
    name: z.string().min(1),
    description: z.string().min(1),
  }),
  objects: z.array(RoomObjectSchema).min(1),
  puzzles: z.array(PuzzleSchema).min(1),
  exit: z.strictObject({
    objectId: z.string().min(1),
    requiresPuzzleId: z.string().min(1),
  }),
  difficulty: z.strictObject({
    band: DifficultyBandSchema,
    /**
     * The generator's estimate of how many actions a competent solver needs.
     * TICKET-3 (#3) checks it against the difficulty band; TICKET-7 (#8) uses it
     * to keep rooms inside the 60–90 second watch target.
     */
    estimatedActions: z.number().int().positive(),
  }),
  /**
   * The solved chain, in order — what the solver proved. Kept explicitly rather
   * than derived from `puzzles[].order` so a generator cannot quietly disagree
   * with the solver about what the intended path was.
   */
  solution: z.strictObject({
    order: z.array(z.string().min(1)).min(1),
  }),
});

export type RoomSpec = z.infer<typeof RoomSpecSchema>;

export class RoomSpecError extends SchemaError {}

/**
 * Parse, don't cast. A caller gets a `RoomSpec` or an error carrying the issues —
 * never an `any` it has to trust. Note again that success here means STRUCTURALLY
 * valid: it says nothing about whether the room can be escaped.
 */
export function parseRoomSpec(raw: unknown): RoomSpec {
  const result = RoomSpecSchema.safeParse(raw);
  if (!result.success) {
    throw new RoomSpecError(`invalid room spec (expected specVersion ${SPEC_VERSION})`, result.error.issues);
  }
  return result.data;
}
