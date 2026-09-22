import type { Rng } from '@/lib/rng';
import type { RoomSpec } from '@/lib/schema/room';
import type { AnswerDomain } from '@/lib/solver';

/**
 * The strategy seam — TICKET-5 (#6).
 *
 * `architecture.md` leaves the puzzle substrate deliberately undecided, and
 * TICKET-7 (#8) picks it after the divergence spike. So everything that depends
 * on the substrate — what structure to ask for, how to ask, and how to read the
 * answer back — lives behind `GeneratorStrategy`, and the loop in `generate.ts`
 * knows none of it. Swapping substrates is registering a strategy, not editing
 * the loop.
 */

export type Band = RoomSpec['difficulty']['band'];

/**
 * The structure a model is asked to fill in, drawn from the seed.
 *
 * Variety comes from HERE, not from hoping a model varies its own output: the
 * PRD's "≥90% of runs differ structurally from the previous run" is only
 * measurable if the structure is chosen, and only reproducible if it is chosen
 * from a seed.
 *
 * These fields are a v0 guess shaped by `symbolic`. TICKET-7 may widen them
 * when spatial and mixed strategies need things this cannot express.
 */
export interface StructuralBrief {
  readonly chainLength: number;
  readonly band: Band;
  /** The lexicon domain the final, prose answer comes from. */
  readonly finalAnswerDomain: AnswerDomain;
  /** Digits per code puzzle, in chain order — `chainLength - 1` entries. */
  readonly codeWidths: readonly number[];
  readonly decoys: number;
  readonly themeHint: string;
}

/** What code, not the model, decides about a room. */
export interface Stamp {
  readonly seed: string;
  readonly roomId: string;
  readonly band: Band;
}

/**
 * Why the previous attempt failed, as lines for the next prompt.
 *
 * IN MEMORY ONLY. The solver's messages quote answers, which is harmless when
 * they go back to the model that wrote the room and a leak anywhere else — so
 * this type is never part of a persisted record. See `record.ts`.
 */
export interface AttemptFeedback {
  readonly lines: readonly string[];
}

export type NarrowResult =
  | { readonly ok: true; readonly spec: RoomSpec }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface GeneratorStrategy {
  /** The `--strategy` flag value, and what the record and fingerprint carry. */
  readonly name: string;
  /** Pure over `rng`: the same seed must give the same brief. */
  brief(rng: Rng): StructuralBrief;
  system(): string;
  /** Deterministic text. `feedback` is `null` on the first attempt. */
  prompt(brief: StructuralBrief, feedback: AttemptFeedback | null): string;
  /** Model JSON → strict `RoomSpec`, or the issues. Never throws. */
  narrow(json: unknown, stamp: Stamp): NarrowResult;
}
