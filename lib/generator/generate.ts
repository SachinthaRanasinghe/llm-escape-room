import type { GenerationClient } from '@/lib/providers';
// The one value import from providers, and from `types.ts` only: `instanceof`
// needs the class, and that file holds no transport. `boundary.test.ts` pins it.
import { ProviderError } from '@/lib/providers/types';
import { createRng } from '@/lib/rng';
import type { RoomSpec } from '@/lib/schema/room';
import { verifySpec, type SolverReport } from '@/lib/solver';
import { fingerprintRoom, type RoomFingerprint } from './fingerprint';
import { parseGenerationRecord, type GenerationAttempt, type GenerationRecord } from './record';
import type { AttemptFeedback, GeneratorStrategy } from './types';

/**
 * The generator loop — TICKET-5 (#6). A model proposes, the solver disposes.
 *
 *   brief ← strategy.brief(seed)                    once; every retry repairs the same target
 *   repeat up to maxAttempts:
 *     text  ← model(strategy.prompt(brief, feedback))
 *     json  ← JSON.parse(text)                      ✗ unparseable_json
 *     spec  ← strategy.narrow(json, stamp)          ✗ proposal_malformed
 *     verifySpec(spec)                              ✗ rejected  →  codes to the record, reasons to the next prompt
 *                                                   ✓ accepted  →  fingerprint, return
 *
 * ── A tripped cap is an outcome; a dead provider is not ────────────────────
 * Running out of attempts is a fact about how well a model writes rooms — the
 * number #8 wants — so it comes back as `{ ok: false, record }`, the same call
 * `SolverResult` makes about a rejected room. A `ProviderError` is the transport
 * giving up, which is nobody's measurement; it is thrown, wrapped with the
 * record so far so the quota already spent is still counted.
 *
 * ── Why the brief is fixed across retries ──────────────────────────────────
 * If each attempt re-rolled the structure, a rejected four-link room could be
 * "fixed" by a three-link one, and the attempt count would measure luck rather
 * than how reliably a model hits a spec. It also keeps `(seed, strategy)` →
 * brief reproducible, even though the model's text never is.
 *
 * ── Feedback is replaced, not accumulated ──────────────────────────────────
 * Only the previous attempt's reasons go into the next prompt, which keeps
 * prompt tokens flat across retries — they are the quota being measured.
 */

export const DEFAULT_MAX_ATTEMPTS = 5;

export interface GenerateOptions {
  readonly client: GenerationClient;
  readonly strategy: GeneratorStrategy;
  readonly seed: string;
  /** Default `DEFAULT_MAX_ATTEMPTS`. */
  readonly maxAttempts?: number;
  /** Default `${strategy.name}-${seed}`. */
  readonly roomId?: string;
}

export type GenerationResult =
  | {
      readonly ok: true;
      readonly spec: RoomSpec;
      readonly report: SolverReport;
      readonly fingerprint: RoomFingerprint;
      readonly record: GenerationRecord;
    }
  | { readonly ok: false; readonly record: GenerationRecord };

/**
 * The provider gave up mid-generation. `record` holds the attempts that
 * completed; `cause` is the `ProviderError`. The message is built from counts
 * and the provider error's own (already redacted) message — never from a room.
 */
export class GenerationAbortedError extends Error {
  readonly record: GenerationRecord;

  constructor(record: GenerationRecord, cause: ProviderError) {
    super(`generation aborted after ${record.attempts.length} completed attempt(s): ${cause.message}`, { cause });
    this.name = new.target.name;
    this.record = record;
  }
}

/** Enough to act on, few enough to keep the next prompt short. Mirrors `proposal.ts`. */
const MAX_FEEDBACK_LINES = 10;

export async function generateRoom(options: GenerateOptions): Promise<GenerationResult> {
  const { client, strategy, seed } = options;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`generateRoom: maxAttempts must be a positive integer, received ${maxAttempts}`);
  }
  const roomId = options.roomId ?? `${strategy.name}-${seed}`;

  const brief = strategy.brief(createRng(seed));
  const stamp = { seed, roomId, band: brief.band };
  const system = strategy.system();
  const attempts: GenerationAttempt[] = [];

  const record = (fingerprint: RoomFingerprint | null): GenerationRecord =>
    parseGenerationRecord({
      generationRecordVersion: 0,
      strategy: strategy.name,
      seed,
      roomId,
      provider: client.provider,
      modelId: client.modelId,
      maxAttempts,
      brief: { ...brief, codeWidths: [...brief.codeWidths] },
      attempts,
      totals: {
        attempts: attempts.length,
        providerCalls: sum(attempts, (a) => a.providerCalls),
        promptTokens: sum(attempts, (a) => a.tokens.prompt),
        completionTokens: sum(attempts, (a) => a.tokens.completion),
        latencyMs: sum(attempts, (a) => a.latencyMs),
      },
      accepted: fingerprint !== null,
      fingerprint,
    });

  let feedback: AttemptFeedback | null = null;

  for (let index = 1; index <= maxAttempts; index++) {
    let completion;
    try {
      completion = await client.complete({ system, prompt: strategy.prompt(brief, feedback) });
    } catch (error) {
      if (error instanceof ProviderError) throw new GenerationAbortedError(record(null), error);
      throw error;
    }

    const base = {
      index,
      rejections: [] as GenerationAttempt['rejections'],
      malformedIssueCount: 0,
      tokens: { prompt: completion.tokens.prompt, completion: completion.tokens.completion },
      latencyMs: completion.latencyMs,
      providerCalls: completion.attempts,
    };

    const json = completion.anomaly === null ? parseJson(completion.text) : undefined;
    if (json === undefined) {
      attempts.push({ ...base, outcome: 'unparseable_json' });
      feedback = { lines: ['the response was not a single valid JSON object'] };
      continue;
    }

    const narrowed = strategy.narrow(json, stamp);
    if (!narrowed.ok) {
      attempts.push({ ...base, outcome: 'proposal_malformed', malformedIssueCount: narrowed.issues.length });
      feedback = { lines: narrowed.issues.slice(0, MAX_FEEDBACK_LINES) };
      continue;
    }

    const verdict = verifySpec(narrowed.spec);
    if (!verdict.ok) {
      attempts.push({
        ...base,
        outcome: 'rejected',
        // Codes and sites only — the messages quote answers. See `record.ts`.
        rejections: verdict.rejections.map((r) => ({
          code: r.code,
          puzzleId: r.puzzleId ?? null,
          objectId: r.objectId ?? null,
        })),
      });
      // The messages DO go back to the model: it wrote the answers they quote.
      feedback = { lines: verdict.rejections.slice(0, MAX_FEEDBACK_LINES).map((r) => `${r.code}: ${r.message}`) };
      continue;
    }

    attempts.push({ ...base, outcome: 'accepted' });
    const fingerprint = fingerprintRoom(narrowed.spec, verdict.report, strategy.name);
    return { ok: true, spec: narrowed.spec, report: verdict.report, fingerprint, record: record(fingerprint) };
  }

  return { ok: false, record: record(null) };
}

/** `undefined` for anything that is not a JSON document — never a throw. */
function parseJson(text: string | null): unknown {
  if (text === null || text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sum<T>(items: readonly T[], of: (item: T) => number): number {
  return items.reduce((total, item) => total + of(item), 0);
}
