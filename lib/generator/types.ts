import type { Rng } from '@/lib/rng';
import type { PuzzleKind, RoomSpec } from '@/lib/schema/room';
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
 * Shaped first by `symbolic`, then widened by TICKET-7 (#8) for `spatial` and
 * `mixed`: `linkKinds` says what each link is, so one brief describes any mix of
 * code, key and spoken-answer links.
 */
export interface StructuralBrief {
  readonly chainLength: number;
  readonly band: Band;
  /** One per link, in chain order — `chainLength` entries. */
  readonly linkKinds: readonly PuzzleKind[];
  /** The lexicon domain the final prose answer comes from; `null` when the last link is not an `answer`. */
  readonly finalAnswerDomain: AnswerDomain | null;
  /** Digits per `code` link, in chain order — one entry per `code` in `linkKinds`. */
  readonly codeWidths: readonly number[];
  readonly decoys: number;
  /** Portable keys that fit nothing. Zero for a strategy with no key links. */
  readonly decoyKeys: number;
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
