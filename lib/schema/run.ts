import { z } from 'zod';
import { RUN_VERSION, RunVersionSchema, SchemaError } from './version';

/**
 * Who competed, under what budget, and how it went.
 *
 * A `Run` is the record; the event log is the narrative. They are versioned
 * separately and stored separately — TICKET-9 (#9) publishes them together with
 * a render manifest as the shareable artifact.
 */

/** Free-tier providers only. `architecture.md` holds the serving stack constant for the first matchup. */
export const PROVIDERS = ['groq', 'gemini'] as const;
export const ProviderSchema = z.enum(PROVIDERS);
export type Provider = z.infer<typeof ProviderSchema>;

export const CompetitorSchema = z.strictObject({
  /** Stable within a run; what `Event.competitorId` points at. */
  id: z.string().min(1),
  provider: ProviderSchema,
  modelId: z.string().min(1),
  params: z.strictObject({
    /** `null` means "provider default" — recorded rather than guessed, so a rerun is reproducible. */
    temperature: z.number().nullable(),
    topP: z.number().nullable(),
  }),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

/**
 * Why a competitor stopped.
 *
 * Budget exhaustion is a RECORDED OUTCOME, not an exception. `architecture.md`
 * is explicit: a run that runs out of actions is a failure to escape, and the
 * harness must be able to say so calmly rather than throw. TICKET-2 (#2) depends
 * on this distinction and the PRD counts it as a real result.
 */
export const END_REASONS = ['escaped', 'budget_actions', 'budget_tokens', 'budget_time'] as const;
export const EndReasonSchema = z.enum(END_REASONS);
export type EndReason = z.infer<typeof EndReasonSchema>;

export const RunSummarySchema = z.strictObject({
  competitorId: z.string().min(1),
  escaped: z.boolean(),
  /** `null` when the competitor did not escape — absence is a value, not a missing key. */
  escapeActionCount: z.number().int().nonnegative().nullable(),
  escapeMs: z.number().int().nonnegative().nullable(),
  puzzlesSolved: z.number().int().nonnegative(),
  /** Wrong answers and wrong codes: the model understood the interface and got it wrong. */
  failedAttempts: z.number().int().nonnegative(),
  /**
   * Malformed or illegal actions. Published as a metric, never hidden: the PRD
   * counts them, and `architecture.md` decides they consume a turn because using
   * the interface correctly is part of the task.
   */
  invalidActions: z.number().int().nonnegative(),
  tokens: z.strictObject({
    prompt: z.number().int().nonnegative(),
    completion: z.number().int().nonnegative(),
  }),
  /**
   * Kept even though the free-tier target is $0 marginal, because the PRD tracks
   * cost per run as a guardrail — a run that silently starts costing money is a
   * result worth seeing.
   */
  costUsd: z.number().nonnegative(),
  endedBecause: EndReasonSchema,
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const RunSchema = z.strictObject({
  runVersion: RunVersionSchema,
  runId: z.string().min(1),
  roomId: z.string().min(1),
  /** Exactly two for the MVP, but the schema does not hard-code that — tournaments are a later question. */
  competitors: z.array(CompetitorSchema).min(2),
  budget: z.strictObject({
    maxActions: z.number().int().positive(),
    maxTokens: z.number().int().positive(),
    maxWallClockMs: z.number().int().positive(),
  }),
  startedAt: z.iso.datetime(),
  summaries: z.array(RunSummarySchema),
  /**
   * Whether this published run was typical of its silent repeats — `null` when no
   * repeats have been run yet.
   *
   * This is the field TICKET-10 (#10) discloses variance with. It exists because
   * a single run of a nondeterministic model proves little, and the answer to
   * that is honesty rather than pretending. Do not drop it as unused.
   */
  typicalOfRepeats: z.boolean().nullable(),
});
export type Run = z.infer<typeof RunSchema>;

export class RunError extends SchemaError {}

export function parseRun(raw: unknown): Run {
  const result = RunSchema.safeParse(raw);
  if (!result.success) {
    throw new RunError(`invalid run (expected runVersion ${RUN_VERSION})`, result.error.issues);
  }
  return result.data;
}
