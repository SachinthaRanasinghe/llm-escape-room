import { z } from 'zod';
import { RejectedSchema } from '@/lib/schema/event';
import { CompetitorSchema } from '@/lib/schema/run';
import { SchemaError } from '@/lib/schema/version';

/**
 * The Energy Cores arena's contracts — `docs/decisions/arena.md`.
 *
 * A second game beside the escape room, with its own vocabulary. Three players
 * share ONE arena: five cores, one in each base at the start and two in the
 * centre. On a turn a player claims a centre core, steals one, or passes — and a
 * claim or a steal only happens if the player then answers a question drawn from
 * the committed bank correctly (`questions/bank.ts`). The engine
 * (`engine.ts`) is the only judge, exactly as the simulator is for the room.
 *
 * ── Two tool sets, one per phase ───────────────────────────────────────────
 * A turn is two model calls: DECIDE, offered only `claim`/`steal`/`pass`, and —
 * when the decision was legal — ANSWER, offered only `answer`. Offering one
 * phase's tools per call makes the phase structural: a model cannot "answer"
 * before it has seen a question.
 *
 * ── Intent, as in the room ─────────────────────────────────────────────────
 * Every call carries the model's own one-line intent, required by the schema, so
 * it cannot drift from what it explains. Copied from `lib/schema/action.ts`
 * rather than exported from it: that schema is the escape room's contract and is
 * left untouched.
 */

const IntentSchema = z
  .string()
  .min(1, 'intent must not be empty')
  .max(280, 'intent must fit on screen at beat pace');

const base = { intent: IntentSchema };

export const PLAYER_IDS = ['player-a', 'player-b', 'player-c'] as const;
export const PlayerIdSchema = z.enum(PLAYER_IDS);
export type PlayerId = z.infer<typeof PlayerIdSchema>;

/** The cores in play — always conserved: centre + every holding = this. */
export const TOTAL_CORES = 5;

export const ArenaActionSchema = z.discriminatedUnion('name', [
  /** Take a core from the centre — after a medium question. */
  z.strictObject({ name: z.literal('claim'), ...base }),
  /** Take a core from another player — after a hard question. */
  z.strictObject({ name: z.literal('steal'), targetId: z.string().min(1), ...base }),
  /** Do nothing. Legal play, scored as neither failed nor invalid. */
  z.strictObject({ name: z.literal('pass'), ...base }),
]);
export type ArenaAction = z.infer<typeof ArenaActionSchema>;

/** A union of one, so the tool spec derives from `.options` exactly as the room's does. */
export const ArenaAnswerSchema = z.discriminatedUnion('name', [
  z.strictObject({ name: z.literal('answer'), answer: z.string().min(1).max(200), ...base }),
]);
export type ArenaAnswer = z.infer<typeof ArenaAnswerSchema>;

/**
 * - `ok` — a legal decision, a correct answer, or a pass.
 * - `not_permitted` — a well-formed decision the arena refuses (empty centre, a
 *   bad target). Wastes the turn; counted invalid, as in the room.
 * - `malformed` — not an action at all. Wastes the turn; counted invalid.
 * - `wrong_answer` — the question was answered wrongly. The action fails; counted
 *   failed. No other penalty.
 */
export const ARENA_VERDICT_CODES = ['ok', 'not_permitted', 'malformed', 'wrong_answer'] as const;
export const ArenaVerdictSchema = z.strictObject({
  ok: z.boolean(),
  code: z.enum(ARENA_VERDICT_CODES),
  /** What the player reads — the only channel back into the model. Never carries an answer key. */
  message: z.string(),
});
export type ArenaVerdict = z.infer<typeof ArenaVerdictSchema>;

export const QUESTION_CATEGORIES = ['math', 'code', 'algorithms', 'logic', 'sql', 'cs'] as const;
export const QuestionCategorySchema = z.enum(QUESTION_CATEGORIES);
export type QuestionCategory = z.infer<typeof QuestionCategorySchema>;

export const QUESTION_TIERS = ['medium', 'hard'] as const;
export const QuestionTierSchema = z.enum(QUESTION_TIERS);
export type QuestionTier = z.infer<typeof QuestionTierSchema>;

export const TURN_OUTCOMES = ['claimed', 'stole', 'failed', 'passed', 'wasted'] as const;
export type TurnOutcome = (typeof TURN_OUTCOMES)[number];

const CoresSchema = z.strictObject({
  'player-a': z.number().int().nonnegative(),
  'player-b': z.number().int().nonnegative(),
  'player-c': z.number().int().nonnegative(),
});

const TokensSchema = z.strictObject({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
});

/** A null payload needs a `rejected` block, and only a null payload may have one — as `EventSchema`. */
function paired(payload: unknown, rejected: unknown): boolean {
  return (payload === null) === (rejected !== undefined);
}

/**
 * One TURN, as recorded — not one call. A viewer reasons in turns ("B tried to
 * steal from A and missed"), so both calls' latency and tokens are summed here,
 * with a `rejected` block per phase so a malformed call is never hidden.
 *
 * `question` names the question and never its text or key; `answer.expected` is
 * the canonical answer, recorded only after the answer was graded.
 */
export const ArenaEventSchema = z
  .strictObject({
    matchId: z.string().min(1),
    /** 0-based and contiguous across the whole match. */
    seq: z.number().int().nonnegative(),
    round: z.number().int().positive(),
    playerId: PlayerIdSchema,
    decision: z.strictObject({
      action: ArenaActionSchema.nullable(),
      rejected: RejectedSchema.optional(),
      verdict: ArenaVerdictSchema,
    }),
    question: z
      .strictObject({ id: z.string().min(1), category: QuestionCategorySchema, tier: QuestionTierSchema })
      .nullable(),
    answer: z
      .strictObject({
        given: ArenaAnswerSchema.nullable(),
        rejected: RejectedSchema.optional(),
        verdict: ArenaVerdictSchema,
        expected: z.string().min(1),
      })
      .nullable(),
    outcome: z.enum(TURN_OUTCOMES),
    /** The player stolen from — on a steal, whether or not it succeeded. */
    targetId: PlayerIdSchema.nullable(),
    /** The player this turn eliminated, if any. */
    eliminated: PlayerIdSchema.nullable(),
    /** Holdings and centre AFTER this turn. */
    cores: CoresSchema,
    centre: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    tokens: TokensSchema,
    at: z.iso.datetime(),
  })
  .superRefine((event, ctx) => {
    if (!paired(event.decision.action, event.decision.rejected)) {
      ctx.addIssue({ code: 'custom', path: ['decision', 'rejected'], message: 'a null action needs a rejected block, and only a null action may have one' });
    }
    if (event.answer !== null && !paired(event.answer.given, event.answer.rejected)) {
      ctx.addIssue({ code: 'custom', path: ['answer', 'rejected'], message: 'a null answer needs a rejected block, and only a null answer may have one' });
    }
    if ((event.question === null) !== (event.answer === null)) {
      ctx.addIssue({ code: 'custom', path: ['answer'], message: 'an answer exists exactly when a question was asked' });
    }
  });
export type ArenaEvent = z.infer<typeof ArenaEventSchema>;

export const ARENA_END_REASONS = ['last_standing', 'round_cap', 'time_cap'] as const;
export const ArenaEndReasonSchema = z.enum(ARENA_END_REASONS);
export type ArenaEndReason = z.infer<typeof ArenaEndReasonSchema>;

export const ArenaStandingSchema = z.strictObject({
  playerId: PlayerIdSchema,
  cores: z.number().int().nonnegative(),
  /** `null` when the player was never eliminated. */
  eliminatedInRound: z.number().int().positive().nullable(),
  claims: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  passes: z.number().int().nonnegative(),
  /** Questions answered correctly. */
  correct: z.number().int().nonnegative(),
  /** Questions answered wrongly. */
  wrong: z.number().int().nonnegative(),
  /** Malformed or not-permitted calls, either phase. */
  invalid: z.number().int().nonnegative(),
  tokens: TokensSchema,
  latencyMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type ArenaStanding = z.infer<typeof ArenaStandingSchema>;

export const ArenaResultSchema = z.strictObject({
  matchId: z.string().min(1),
  seed: z.string().min(1),
  players: z.array(CompetitorSchema).length(3),
  maxRounds: z.number().int().positive(),
  roundsPlayed: z.number().int().nonnegative(),
  endedBecause: ArenaEndReasonSchema,
  /** `tie` when more than one player shares the most cores. Stats never break a tie. */
  outcome: z.enum(['win', 'tie']),
  winners: z.array(PlayerIdSchema).min(1),
  /** In `PLAYER_IDS` order. */
  standings: z.array(ArenaStandingSchema).length(3),
});
export type ArenaResult = z.infer<typeof ArenaResultSchema>;

export class ArenaSchemaError extends SchemaError {}

export function parseArenaEvent(raw: unknown): ArenaEvent {
  const result = ArenaEventSchema.safeParse(raw);
  if (!result.success) throw new ArenaSchemaError('invalid arena event', result.error.issues);
  return result.data;
}

export function parseArenaResult(raw: unknown): ArenaResult {
  const result = ArenaResultSchema.safeParse(raw);
  if (!result.success) throw new ArenaSchemaError('invalid arena result', result.error.issues);
  return result.data;
}
