import { z } from 'zod';
import { SchemaError } from './version';

/**
 * The action vocabulary — the single seam that makes the duel fair.
 *
 * `architecture.md` decides that fairness lives here rather than in the prompt:
 * this schema is defined ONCE and compiled down to each provider's native
 * tool-calling format by TICKET-4 (#4), so every model gets the same actions
 * while speaking the dialect it was trained on. Nothing else may define what a
 * model is allowed to do.
 *
 * THE VERB SET BELOW IS v0 AND TICKET-2 (#2) MAY ADJUST IT. The simulator is the
 * thing that discovers whether `use(item, target)` is expressive enough, or
 * whether `look` needs arguments. If #2 changes this union it must also bump the
 * fixtures in `fixtures/`, because four tickets build against them.
 */

/**
 * The one-line "why" the model writes as it acts.
 *
 * This is a PRODUCT FEATURE, not a debug field. `llm-escape-room.prd.md` bets
 * that a viewer can point at the moment one model lost the thread, and this is
 * what they point at. Carrying it as a required argument of every action — rather
 * than streaming raw reasoning and summarising it later — is what keeps it
 * truthful: it cannot drift from the action it accompanies, and no second model
 * gets to paraphrase it.
 */
const IntentSchema = z
  .string()
  .min(1, 'intent must not be empty')
  .max(280, 'intent must fit on screen at beat pace');

/** Every member carries `name` (the discriminant) and `intent`. */
const base = { intent: IntentSchema };

export const ActionSchema = z.discriminatedUnion('name', [
  /** Survey the room. The cheap orienting move; returns what is visible. */
  z.strictObject({ name: z.literal('look'), ...base }),
  /** Examine one object closely — where clue text is found. */
  z.strictObject({ name: z.literal('inspect'), targetId: z.string().min(1), ...base }),
  /** Move a portable object into the competitor's possession. */
  z.strictObject({ name: z.literal('take'), targetId: z.string().min(1), ...base }),
  /** Attempt to open a container or door. Fails with `locked` if it is locked. */
  z.strictObject({ name: z.literal('open'), targetId: z.string().min(1), ...base }),
  /** Apply a held item to an object — the key on the drawer. */
  z.strictObject({
    name: z.literal('use'),
    itemId: z.string().min(1),
    targetId: z.string().min(1),
    ...base,
  }),
  /** Enter a code into a lock. Distinct from `submit_answer`: this one is physical. */
  z.strictObject({
    name: z.literal('enter_code'),
    targetId: z.string().min(1),
    code: z.string().min(1),
    ...base,
  }),
  /** Answer a puzzle directly, without a lock to type it into. */
  z.strictObject({
    name: z.literal('submit_answer'),
    puzzleId: z.string().min(1),
    answer: z.string().min(1),
    ...base,
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

export const ACTION_NAMES = [
  'look',
  'inspect',
  'take',
  'open',
  'use',
  'enter_code',
  'submit_answer',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

/**
 * How the simulator answers an action. TICKET-2 (#2) owns resolution; this
 * ticket only fixes the vocabulary of outcomes so the renderer and the harness
 * can both be built against it before the simulator exists.
 *
 * `malformed` and `not_permitted` are the ones that matter for scoring:
 * `architecture.md` decides an invalid action returns a clear error AND CONSUMES
 * A TURN, because using the interface correctly is part of the task. They are
 * counted in `RunSummary.invalidActions` and published, never hidden.
 */
export const VERDICT_CODES = [
  'ok',
  'not_found',
  'locked',
  'wrong_answer',
  'wrong_code',
  /** The competitor used a key that does not fit. Added by TICKET-7 (#8); see `VERDICT_TALLY`. */
  'wrong_key',
  'not_holding',
  'malformed',
  'not_permitted',
] as const;

export const VerdictCodeSchema = z.enum(VERDICT_CODES);
export type VerdictCode = z.infer<typeof VerdictCodeSchema>;

export const VerdictSchema = z.strictObject({
  ok: z.boolean(),
  code: VerdictCodeSchema,
  /** What the competitor sees. The ONLY channel back into the model. */
  message: z.string(),
});

export type Verdict = z.infer<typeof VerdictSchema>;

export class ActionError extends SchemaError {}

/** Parse, don't cast. Callers get an `Action`, never an `any`. */
export function parseAction(raw: unknown): Action {
  const result = ActionSchema.safeParse(raw);
  if (!result.success) {
    throw new ActionError('invalid action', result.error.issues);
  }
  return result.data;
}
