import { z } from 'zod';

/**
 * Why a room was refused, as data.
 *
 * ── A rejection is an OUTCOME, not an exception ────────────────────────────
 * TICKET-5 (#6) is a propose → verify → accept loop: it asks a model for a room,
 * hands it to this module, and regenerates when it comes back refused. Rejection
 * is therefore the loop's NORMAL path, hit far more often than acceptance, and
 * modelling it as a thrown error would put a try/catch on the happy path of the
 * only consumer this module has.
 *
 * This is the same call `lib/sim/budget.ts` makes about budget exhaustion — a run
 * that runs out of actions is a recorded failure to escape, not a crash — and it
 * is made here for the same reason: the thing being reported is a fact about the
 * room, not a fault in the program.
 *
 * ── Machine-readable means the CODE, not the message ───────────────────────
 * `architecture.md` calls this module the thing that makes "machine-checkable"
 * true. A generator cannot act on prose. `code` is the contract — a closed
 * vocabulary a caller can branch on and count — and `message` exists only so a
 * human reading a failing test knows what happened. Never parse `message`.
 */

/**
 * The closed set of reasons a room can be refused, grouped by the stage that
 * raises them. Ordered as the pipeline in `verify.ts` runs.
 *
 * Adding a code is a contract change for #6, which counts them per generation
 * attempt and feeds that count to #8's quota analysis.
 */
export const REJECTION_CODES = [
  /* Stage 1 — parse. The payload is not a `RoomSpec` at all. */
  'spec_version_mismatch',
  'spec_malformed',

  /* Stage 2 — object graph. `compileRoom` refused it: a dangling child, a
   * duplicate id, two holders for one object, or a containment cycle. */
  'object_graph_invalid',

  /* Stage 3 — structure. Shape is fine; the references and ordering are not. */
  'dangling_reference',
  'puzzle_order_invalid',
  'exit_not_last',
  'lock_mismatch',
  'answer_collision',

  /* Stage 4 — derivation. The answer cannot be read out of its clue, or the
   * clue supports more than one answer. */
  'answer_not_derivable',
  'answer_ambiguous',

  /* Stage 5 — oracle, chain and difficulty. */
  'chain_broken',
  'unsolvable',
  'difficulty_out_of_band',
  'difficulty_estimate_implausible',
] as const;

export const RejectionCodeSchema = z.enum(REJECTION_CODES);
export type RejectionCode = z.infer<typeof RejectionCodeSchema>;

/**
 * `puzzleId` and `objectId` are optional in the TypeScript sense (`?:`), which
 * breaks the null-not-absent rule every schema in `lib/schema/` follows — on
 * purpose. Those rules exist because a serialised contract with a sometimes-
 * missing key is a contract two readers can disagree about. A `Rejection` is
 * never serialised and never crosses a version boundary: it is produced and
 * consumed in the same process, in the same tick, by a loop that either
 * regenerates or accepts. Carrying explicit `null`s here would be ceremony.
 */
export interface Rejection {
  readonly code: RejectionCode;
  readonly message: string;
  /** The puzzle at fault, when the rule is about one puzzle. */
  readonly puzzleId?: string;
  /** The object at fault, when the rule is about one object. */
  readonly objectId?: string;
}

/** Where a rejection points, when it points anywhere. */
export interface RejectionSite {
  readonly puzzleId?: string;
  readonly objectId?: string;
}

/**
 * The only way a `Rejection` should be built, so that every one of them is
 * constructed the same way and a future field cannot be forgotten at one of the
 * dozen call sites.
 */
export function reject(code: RejectionCode, message: string, where: RejectionSite = {}): Rejection {
  return {
    code,
    message,
    ...(where.puzzleId !== undefined ? { puzzleId: where.puzzleId } : {}),
    ...(where.objectId !== undefined ? { objectId: where.objectId } : {}),
  };
}

/** Convenience for tests and for #6's attempt log: just the codes, in order. */
export function codesOf(rejections: readonly Rejection[]): RejectionCode[] {
  return rejections.map((r) => r.code);
}
