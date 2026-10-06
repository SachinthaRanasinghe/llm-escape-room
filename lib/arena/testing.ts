import type { ProviderAdapter, ProviderTurn, ToolCall, TurnRequest } from '@/lib/providers';
import type { Provider } from '@/lib/schema/run';
import type { HarnessDeps } from '@/lib/harness/types';

/**
 * Test support for the arena — an adapter that plays by a strategy function,
 * and a clock. Not exported from `index.ts`, like `lib/harness/testing.ts`:
 * nothing on a real match path should be able to swap a model for a script.
 */

export type Move = Partial<ProviderTurn> & { readonly rawAction: unknown };

/** The question text in the last message a player received, or `null` on a decide call. */
export function questionIn(request: TurnRequest): string | null {
  const last = request.transcript.at(-1);
  const text = last?.kind === 'tool_result' || last?.kind === 'user' ? last.text : '';
  const match = /\nQuestion \((?:medium|hard) \w+\):\n([\s\S]*)\n\nCall answer with only the final answer\.$/.exec(text);
  return match?.[1] ?? null;
}

/**
 * Calls `strategy` for every `act`. A move with no `anomaly` gets a tool call
 * synthesised from its `rawAction`, as a real adapter would decode one. An
 * `Error` is thrown from `act`. `requests` records each request as it was sent.
 */
export function strategyAdapter(
  strategy: (request: TurnRequest, call: number) => Move | Error,
  identity: { readonly provider: Provider; readonly modelId: string } = { provider: 'groq', modelId: 'stub-model' },
): { adapter: ProviderAdapter; requests: TurnRequest[] } {
  const requests: TurnRequest[] = [];
  let index = 0;
  const adapter: ProviderAdapter = {
    ...identity,
    async act(request) {
      requests.push(structuredClone(request));
      const move = strategy(request, index);
      if (move instanceof Error) throw move;
      const anomaly = move.anomaly ?? null;
      let toolCall: ToolCall | null = null;
      if (move.toolCall !== undefined) toolCall = move.toolCall;
      else if (anomaly === null && typeof move.rawAction === 'object' && move.rawAction !== null && !Array.isArray(move.rawAction)) {
        const { name, ...args } = move.rawAction as Record<string, unknown>;
        toolCall = { callId: `call_${identity.modelId}_${index}`, toolName: String(name), args };
      }
      index += 1;
      return {
        rawAction: move.rawAction,
        toolCall,
        text: move.text ?? null,
        anomaly,
        tokens: move.tokens ?? { prompt: 100, completion: 10 },
        latencyMs: move.latencyMs ?? 1000,
        attempts: move.attempts ?? 1,
      };
    },
  };
  return { adapter, requests };
}

/** A clock that advances one second per read, so every event gets a distinct, ordered stamp. */
export function steppingClock(start = Date.parse('2026-10-06T10:00:00.000Z'), stepMs = 1000): HarnessDeps & { readonly reads: () => number } {
  let t = start - stepMs;
  let reads = 0;
  return {
    now: () => {
      reads += 1;
      t += stepMs;
      return t;
    },
    reads: () => reads,
  };
}
