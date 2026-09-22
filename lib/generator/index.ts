/**
 * The room generator — TICKET-5 (#6). A model proposes, the solver disposes.
 *
 *   const client = createGenerationClient(model, readProviderKey(model.provider));
 *   const result = await generateRoom({ client, strategy: resolveStrategy('symbolic'), seed });
 *   if (!result.ok) report(result.record);          // cap tripped — every attempt still counted
 *   else use(result.spec, result.fingerprint);      // certified by verifySpec, fingerprinted for variety
 *
 * `result.record` is what TICKET-7 (#8) reads for quota: every attempt, its
 * outcome, its rejection codes, and the real provider calls behind it. It holds
 * no answer, by construction — see `record.ts`.
 *
 * ── What is deliberately NOT exported ──────────────────────────────────────
 * `testing.ts` — a scripted model. Like `lib/providers/testing.ts`, nothing on a
 * real generation path should be able to swap its model for a script.
 *
 * `narrowProposal` and the proposal schemas. They are a strategy's business,
 * reached through `GeneratorStrategy.narrow`; a caller narrowing by hand would
 * skip the stamp and could publish a room whose seed or band the model chose.
 */
export { generateRoom, GenerationAbortedError, DEFAULT_MAX_ATTEMPTS } from './generate';
export type { GenerateOptions, GenerationResult } from './generate';

export { STRATEGIES, resolveStrategy, createSymbolicStrategy, chainLengthsFor, MAX_CHAIN_LENGTH } from './strategies';
export type { SymbolicOptions } from './strategies';

export { fingerprintRoom, differsFrom, RoomFingerprintSchema } from './fingerprint';
export type { RoomFingerprint } from './fingerprint';

export {
  GenerationRecordSchema,
  GenerationRecordError,
  parseGenerationRecord,
  ATTEMPT_OUTCOMES,
  GENERATION_RECORD_VERSION,
} from './record';
export type { GenerationRecord, GenerationAttempt, AttemptOutcome } from './record';

export type { GeneratorStrategy, StructuralBrief, Stamp, NarrowResult, AttemptFeedback } from './types';
