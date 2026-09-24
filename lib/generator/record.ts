import { z } from 'zod';
import { DifficultyBandSchema, PuzzleKindSchema } from '@/lib/schema/room';
import { ProviderSchema } from '@/lib/schema/run';
import { SchemaError } from '@/lib/schema/version';
import { RejectionCodeSchema } from '@/lib/solver';
import { RoomFingerprintSchema } from './fingerprint';

/**
 * How a room came to be — every attempt, including the ones that failed.
 * TICKET-5 (#6).
 *
 * Rejected candidates burn quota, and TICKET-7 (#8) extrapolates whether a full
 * publishable matchup fits the free tier from exactly these numbers. So an
 * attempt is recorded whatever happened to it, and `providerCalls` counts the
 * REAL requests — transport retries included — not the attempts.
 *
 * ── Codes, never messages ──────────────────────────────────────────────────
 * There is no `message` field anywhere in this schema, and that is the point.
 * The solver's messages quote answers — `answer_not_derivable` says `the answer
 * "4471" cannot be read…` — and so can Zod's issue text. This record is written
 * to disk beside the room, and the publication path (TICKET-9) will be tempted
 * to carry it as provenance. Answer-free by construction is cheaper than
 * remembering to scrub it later. The messages still reach the next prompt; they
 * just never reach this.
 *
 * Versioned on its own, like the run and log schemas: it is not a one-way door,
 * but a reader of an old record should still refuse a new one loudly.
 */

/**
 * 1 since TICKET-7 (#8) widened the brief (`linkKinds`, `decoyKeys`, a nullable
 * `finalAnswerDomain`). No version-0 record was ever committed — `runs/` is
 * gitignored — so there is nothing to migrate; an old one on disk is refused.
 */
export const GENERATION_RECORD_VERSION = 1;

export const ATTEMPT_OUTCOMES = ['accepted', 'rejected', 'proposal_malformed', 'unparseable_json'] as const;
export const AttemptOutcomeSchema = z.enum(ATTEMPT_OUTCOMES);
export type AttemptOutcome = z.infer<typeof AttemptOutcomeSchema>;

const TokensSchema = z.strictObject({
  prompt: z.number().int().nonnegative(),
  completion: z.number().int().nonnegative(),
});

export const GenerationAttemptSchema = z.strictObject({
  /** 1-based. */
  index: z.number().int().positive(),
  outcome: AttemptOutcomeSchema,
  /** Empty unless `rejected`. Serialised, so `null` rather than absent. */
  rejections: z.array(
    z.strictObject({
      code: RejectionCodeSchema,
      puzzleId: z.string().nullable(),
      objectId: z.string().nullable(),
    }),
  ),
  /** How many schema issues a `proposal_malformed` attempt had — the count, not the text. */
  malformedIssueCount: z.number().int().nonnegative(),
  tokens: TokensSchema,
  latencyMs: z.number().int().nonnegative(),
  providerCalls: z.number().int().positive(),
});
export type GenerationAttempt = z.infer<typeof GenerationAttemptSchema>;

export const GenerationRecordSchema = z.strictObject({
  generationRecordVersion: z.literal(GENERATION_RECORD_VERSION),
  strategy: z.string().min(1),
  seed: z.string().min(1),
  roomId: z.string().min(1),
  provider: ProviderSchema,
  modelId: z.string().min(1),
  maxAttempts: z.number().int().positive(),
  brief: z.strictObject({
    chainLength: z.number().int().positive(),
    band: DifficultyBandSchema,
    linkKinds: z.array(PuzzleKindSchema),
    finalAnswerDomain: z.string().min(1).nullable(),
    codeWidths: z.array(z.number().int().positive()),
    decoys: z.number().int().nonnegative(),
    decoyKeys: z.number().int().nonnegative(),
    themeHint: z.string().min(1),
  }),
  attempts: z.array(GenerationAttemptSchema),
  totals: z.strictObject({
    attempts: z.number().int().nonnegative(),
    providerCalls: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  }),
  accepted: z.boolean(),
  /** `null` unless a room was accepted. */
  fingerprint: RoomFingerprintSchema.nullable(),
});
export type GenerationRecord = z.infer<typeof GenerationRecordSchema>;

export class GenerationRecordError extends SchemaError {}

export function parseGenerationRecord(raw: unknown): GenerationRecord {
  const result = GenerationRecordSchema.safeParse(raw);
  if (!result.success) {
    throw new GenerationRecordError(
      `invalid generation record (expected generationRecordVersion ${GENERATION_RECORD_VERSION})`,
      result.error.issues,
    );
  }
  return result.data;
}
