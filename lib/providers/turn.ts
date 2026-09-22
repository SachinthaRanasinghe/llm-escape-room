import type { ProviderTurn, ToolCall, TurnAnomaly } from './types';
import { toRawAction } from './vocabulary';

/**
 * The one place a decoded response becomes a `ProviderTurn`.
 *
 * Both decoders reduce their dialect to a list of tool calls and hand it here,
 * so "what counts as no call, two calls, or garbage arguments" is decided once.
 * If that rule lived in each decoder, one model could be forgiven a double call
 * the other was charged for — a fairness bug no spec comparison would see.
 */

export type DecodedTurn = Omit<ProviderTurn, 'latencyMs' | 'attempts'>;

/**
 * Prefix for a call id the adapter made up because the provider sent none.
 * Gemini must not be told a made-up id — it would not match any call it issued —
 * so the encoder checks for this and leaves `id` off.
 */
const SYNTHETIC_PREFIX = 'local:';

export function syntheticCallId(callIndex: number, index: number): string {
  return `${SYNTHETIC_PREFIX}${callIndex}-${index}`;
}

export function isSyntheticCallId(callId: string): boolean {
  return callId.startsWith(SYNTHETIC_PREFIX);
}

export interface DecodeContext {
  /** Used to synthesise a call id when the provider omits one. */
  readonly callIndex: number;
  /** Scrubbed from any error excerpt. */
  readonly secrets?: readonly string[];
  /** Carried onto a thrown `ProviderError`. */
  readonly attempts?: number;
}

export function turnFromCalls(
  calls: readonly ToolCall[],
  text: string | null,
  tokens: DecodedTurn['tokens'],
  unparseable: ReadonlySet<ToolCall> = new Set(),
): DecodedTurn {
  if (calls.length === 0) {
    return { rawAction: null, toolCall: null, text, anomaly: 'no_tool_call', tokens };
  }

  if (calls.length > 1) {
    // An array is never an action, so the simulator scores it `malformed`. The
    // first call is still returned so the transcript can answer it and stay
    // well-formed for the next turn.
    return {
      rawAction: calls.map((call) => toRawAction(call.toolName, call.args)),
      toolCall: calls[0]!,
      text,
      anomaly: 'multiple_tool_calls',
      tokens,
    };
  }

  const call = calls[0]!;
  const anomaly: TurnAnomaly | null = unparseable.has(call) ? 'unparseable_arguments' : null;
  return { rawAction: toRawAction(call.toolName, call.args), toolCall: call, text, anomaly, tokens };
}

/**
 * The provider itself refused what the model produced — Groq's
 * `tool_use_failed`, Gemini's `MALFORMED_FUNCTION_CALL`. Still the MODEL's
 * failure, so still a turn: the name is outside the vocabulary and the simulator
 * scores it `malformed`.
 */
export function rejectedTurn(tokens: DecodedTurn['tokens'], text: string | null): DecodedTurn {
  return {
    rawAction: { name: '__rejected__' },
    toolCall: null,
    text,
    anomaly: 'provider_rejected_call',
    tokens,
  };
}

/** Token counts arrive as optional numbers; absent is zero, never NaN. */
export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}
