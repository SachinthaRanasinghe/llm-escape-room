import type { QuestionCategory, QuestionTier } from '../schema';

/**
 * A question in the committed bank — `bank.ts`.
 *
 * The bank is data the engine judges against, the way a certified room is: a
 * wrong key would make a correct model lose, which is the worst fairness bug
 * this game can have. So every key is exact and machine-checked, and
 * `bank.test.ts` recomputes every answer it can from first principles.
 */

export type AnswerKey =
  /** A number. Commas, underscores and a leading `=` are ignored; `tolerance` defaults to exact. */
  | { readonly kind: 'number'; readonly value: number; readonly tolerance?: number }
  /** A short string. Compared case-insensitively with all whitespace removed. */
  | { readonly kind: 'text'; readonly accept: readonly string[] }
  /** A comma-separated list of items, each normalised as `text`. */
  | { readonly kind: 'list'; readonly items: readonly string[]; readonly ordered: boolean };

export interface Question {
  readonly id: string;
  readonly category: QuestionCategory;
  readonly tier: QuestionTier;
  /** What the answering model reads. Ends with the format the answer must take. */
  readonly prompt: string;
  readonly key: AnswerKey;
  /** The canonical answer shown to viewers once the question was graded. Never sent to a model. */
  readonly display: string;
}
