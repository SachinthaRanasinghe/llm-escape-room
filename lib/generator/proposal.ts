import { z } from 'zod';
import { LockSchema, ObjectKindSchema, PuzzleKindSchema, RoomSpecSchema, type RoomSpec } from '@/lib/schema/room';
import { SPEC_VERSION } from '@/lib/schema/version';
import type { NarrowResult, Stamp } from './types';

/**
 * The model-facing room — the looser shape a model is actually asked for.
 *
 * `lib/schema/room.ts` reserves this split for this ticket: `RoomSpecSchema` is
 * the internal contract, strict and with nothing optional, and a model's output
 * is parsed HERE and narrowed INTO it. Parse, don't cast. Every tolerance below
 * sits on this side of the boundary so `RoomSpecSchema` never has to grow one.
 *
 * ── What the model does not get to say ─────────────────────────────────────
 * `specVersion`, `seed`, `roomId` and the difficulty band are stamped by code.
 * A model that volunteers them is ignored rather than refused: they are not its
 * decisions, and failing an attempt over them would burn quota on nothing.
 *
 * ── `z.object`, not `z.strictObject` ───────────────────────────────────────
 * A chatty model adds keys — `notes`, `reasoning`. Stripping them costs nothing;
 * refusing them costs an attempt.
 */

const text = z.string().trim().min(1);
/** Models emit `4471` unquoted. JSON cannot carry a leading zero, so nothing is lost converting. */
const answerLike = z.union([text, z.number().int().nonnegative().transform(String)]);

const ProposedLockSchema = z.union([
  LockSchema,
  z.object({ opensWith: z.literal('code'), code: z.number().int().nonnegative().transform(String) }),
]);

export const ProposedObjectSchema = z.object({
  id: text,
  name: text,
  description: text,
  kind: ObjectKindSchema,
  /** Absent means unlocked. */
  lock: ProposedLockSchema.nullish().transform((v) => v ?? null),
  /** Absent means empty. */
  contains: z.array(text).optional().transform((v) => v ?? []),
  /** Absent means nothing to read. */
  clueText: z.string().trim().nullish().transform((v) => (v === undefined || v === '' ? null : v)),
});

export const ProposedPuzzleSchema = z.object({
  id: text,
  /** Absent means its position in the array. */
  order: z.number().int().positive().optional(),
  kind: PuzzleKindSchema,
  clueObjectId: text,
  answer: answerLike,
  unlocksObjectId: text,
});

export const RoomProposalSchema = z.object({
  theme: z.object({ name: text, description: text }),
  objects: z.array(ProposedObjectSchema).min(1),
  puzzles: z.array(ProposedPuzzleSchema).min(1),
  exit: z.object({ objectId: text, requiresPuzzleId: text }),
  estimatedActions: z.number().int().positive(),
  /** Absent means puzzle ids by `order`. */
  solutionOrder: z.array(text).optional(),
});
export type RoomProposal = z.infer<typeof RoomProposalSchema>;

/** Enough to act on, few enough to keep the next prompt short. */
const MAX_ISSUES = 10;

function describeIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.slice(0, MAX_ISSUES).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

/**
 * Model JSON → strict `RoomSpec`, or the issues that stopped it. Never throws:
 * a malformed proposal is an attempt the loop counts, not a fault.
 *
 * Success means STRUCTURALLY valid only. Whether the room can be escaped is the
 * solver's question, asked next.
 */
export function narrowProposal(json: unknown, stamp: Stamp): NarrowResult {
  const proposal = RoomProposalSchema.safeParse(json);
  if (!proposal.success) return { ok: false, issues: describeIssues(proposal.error.issues) };

  const p = proposal.data;
  const puzzles = p.puzzles.map((puzzle, index) => ({
    id: puzzle.id,
    order: puzzle.order ?? index + 1,
    kind: puzzle.kind,
    clueObjectId: puzzle.clueObjectId,
    answer: puzzle.answer,
    unlocksObjectId: puzzle.unlocksObjectId,
  }));
  const order = p.solutionOrder ?? [...puzzles].sort((a, b) => a.order - b.order).map((puzzle) => puzzle.id);

  const candidate: RoomSpec = {
    specVersion: SPEC_VERSION,
    seed: stamp.seed,
    roomId: stamp.roomId,
    theme: p.theme,
    objects: p.objects,
    puzzles,
    exit: p.exit,
    difficulty: { band: stamp.band, estimatedActions: p.estimatedActions },
    solution: { order },
  };

  const spec = RoomSpecSchema.safeParse(candidate);
  if (!spec.success) return { ok: false, issues: describeIssues(spec.error.issues) };
  return { ok: true, spec: spec.data };
}
