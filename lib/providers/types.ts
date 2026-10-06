import type { Competitor, Provider } from '@/lib/schema/run';
import type { TransportDeps } from './transport';
import type { PortableSpec } from './vocabulary';

/**
 * The adapter contract — TICKET-4 (#4).
 *
 * `architecture.md`: "Groq and Gemini behind one interface; the normalised
 * vocabulary compiles to each." An adapter makes ONE model call per turn and
 * hands back what the model did, what it cost and how long it took. It does not
 * loop, does not write prompts, and never sees a `RoomSpec` — the harness
 * (TICKET-6, #7) owns all three, and the simulator is the only thing that knows
 * what is in the room.
 *
 * ── A model's mistake is data, not an exception ────────────────────────────
 * No tool call, two tool calls, arguments that are not JSON: each of these comes
 * back as a `ProviderTurn` with an `anomaly` and a `rawAction` the simulator will
 * score `malformed`. That is the architecture's rule — an invalid action returns
 * a clear error AND CONSUMES A TURN — and it can only hold if the adapter does not
 * throw on it. `ProviderError` is reserved for the transport failing after its
 * retries, which is the harness's problem and not the model's.
 */

export interface TurnRequest {
  /** Identical for both competitors — TICKET-6 builds it once. */
  readonly system: string;
  readonly transcript: readonly TranscriptEntry[];
  /**
   * The tools offered on this call. Default `buildPortableSpec()` — the escape
   * room. Another game passes its own spec built with `buildToolSpec`, and
   * `equivalence.test.ts` proves it compiles to the same task for every provider
   * too. The forced tool-calling mode is the same either way.
   */
  readonly tools?: PortableSpec;
}

/**
 * The conversation so far, in no provider's dialect. Each adapter encodes it
 * into its own, and `equivalence.test.ts` proves the two encodings carry the
 * same words.
 */
export type TranscriptEntry =
  /** Observation or other harness prose. */
  | { readonly kind: 'user'; readonly text: string }
  /** A turn on which the model spoke instead of acting. */
  | { readonly kind: 'assistant_text'; readonly text: string }
  | { readonly kind: 'tool_call'; readonly call: ToolCall }
  /** The simulator's verdict message, sent back verbatim. */
  | { readonly kind: 'tool_result'; readonly callId: string; readonly toolName: string; readonly text: string };

export interface ToolCall {
  /** The provider's id when it gives one, otherwise synthesised by the adapter (see `syntheticCallId`). */
  readonly callId: string;
  readonly toolName: string;
  /** Parsed arguments, or the raw string when they were not valid JSON. */
  readonly args: unknown;
  /**
   * Opaque provider data that must round-trip verbatim — Gemini's
   * `thoughtSignature` lives here. Never inspect it, and never write it to the
   * event log: `EventSchema` is strict and has no field for it, on purpose.
   */
  readonly native?: unknown;
}

export const TURN_ANOMALIES = [
  'no_tool_call',
  'multiple_tool_calls',
  'unparseable_arguments',
  'provider_rejected_call',
] as const;
export type TurnAnomaly = (typeof TURN_ANOMALIES)[number];

export interface ProviderTurn {
  /**
   * Hand straight to `Simulator.apply`. `null`, an array or a half-formed object
   * are all fine — the simulator scores them `malformed` and charges the turn.
   */
  readonly rawAction: unknown;
  /** What to append to the transcript. `null` when the model called no tool. */
  readonly toolCall: ToolCall | null;
  /** Free text the model produced, if any. */
  readonly text: string | null;
  readonly anomaly: TurnAnomaly | null;
  /** Same shape as `ActionCost.tokens` in `lib/sim/budget.ts`. */
  readonly tokens: { readonly prompt: number; readonly completion: number };
  /**
   * Wall-clock ms of the SUCCESSFUL attempt only — maps to `ActionCost.elapsedMs`.
   * Backoff sleeps are not think-time and must not surface as hesitation in the
   * replay.
   */
  readonly latencyMs: number;
  /** 1 + retries. Recorded so the quota analysis (#8) counts real calls. */
  readonly attempts: number;
}

/** What either `create*Adapter` takes. The key is passed in — adapters never read the environment. */
export interface AdapterOptions {
  readonly apiKey: string;
  readonly modelId: string;
  readonly params: Competitor['params'];
  /** Injected in tests; the real network and clock otherwise. */
  readonly deps?: TransportDeps;
}

export interface ProviderAdapter {
  readonly provider: Provider;
  readonly modelId: string;
  act(request: TurnRequest): Promise<ProviderTurn>;
}

/**
 * ── The generation channel — TICKET-5 (#6) ─────────────────────────────────
 * One JSON document out of one prompt, for the room generator. A sibling of
 * `ProviderAdapter`, not a mode of it: see `generation.ts` for why.
 */
export interface JsonRequest {
  readonly system: string;
  /** Must mention "JSON" — Groq's JSON mode refuses a request whose messages do not. */
  readonly prompt: string;
}

export interface JsonCompletion {
  /** The model's text, meant to be one JSON object. `null` when there was none worth reading. */
  readonly text: string | null;
  /**
   * The provider itself said the output was not valid JSON (Groq's
   * `json_validate_failed`) or cut it off (Gemini's `MAX_TOKENS`). The model's
   * failure, so it is an attempt the generator counts — not an exception.
   */
  readonly anomaly: 'invalid_json' | null;
  readonly tokens: { readonly prompt: number; readonly completion: number };
  /** Wall-clock ms of the successful attempt only, as for `ProviderTurn`. */
  readonly latencyMs: number;
  /** 1 + retries — the real call count the quota analysis (#8) needs. */
  readonly attempts: number;
}

export interface GenerationClient {
  readonly provider: Provider;
  readonly modelId: string;
  complete(request: JsonRequest): Promise<JsonCompletion>;
}

/**
 * The transport gave up, or the provider refused the request for a reason that
 * is not the model's fault (bad key, unknown model).
 *
 * The message is built from these fields and a redacted excerpt of the
 * provider's own error text — never from a URL or a header, so a key cannot ride
 * out of the harness inside a stack trace.
 */
export class ProviderError extends Error {
  readonly provider: Provider;
  /** `null` when no HTTP response was received at all. */
  readonly status: number | null;
  readonly attempts: number;

  constructor(provider: Provider, status: number | null, attempts: number, detail: string) {
    super(`${provider}: ${detail} (status ${status ?? 'none'}, ${attempts} attempt${attempts === 1 ? '' : 's'})`);
    this.name = new.target.name;
    this.provider = provider;
    this.status = status;
    this.attempts = attempts;
  }
}
