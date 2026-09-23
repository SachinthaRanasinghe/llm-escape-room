import type { ProviderAdapter, ProviderTurn, ToolCall, TurnRequest } from '@/lib/providers';
import type { EventLog } from '@/lib/schema/event';
import type { Provider } from '@/lib/schema/run';
import type { HarnessDeps } from './types';

/**
 * Test support for the harness — a scripted adapter, a way to turn the golden
 * log back into what a model would have sent, and a fixed clock.
 *
 * Deliberately NOT exported from `index.ts`, like `lib/providers/testing.ts`:
 * nothing on a real run path should be able to swap a model for a script.
 */

export type ScriptedTurn = Partial<ProviderTurn> & { readonly rawAction: unknown };

export const STUB_TOKENS = { prompt: 100, completion: 10 } as const;
export const STUB_LATENCY_MS = 1000;

function syntheticCall(rawAction: unknown, index: number): ToolCall | null {
  if (typeof rawAction !== 'object' || rawAction === null || Array.isArray(rawAction)) return null;
  const { name, ...args } = rawAction as Record<string, unknown>;
  return { callId: `call_${index}`, toolName: typeof name === 'string' ? name : 'unknown', args };
}

/**
 * Plays `script` one turn per `act`. A turn with no `anomaly` gets a tool call
 * synthesised from its `rawAction`, as a real adapter would decode one; set
 * `toolCall: null` explicitly for the no-call shapes. An `Error` in the script is
 * thrown from `act`. `requests` snapshots each transcript as it was sent.
 */
export function scriptedAdapter(
  script: readonly (ScriptedTurn | Error)[],
  identity: { readonly provider: Provider; readonly modelId: string } = { provider: 'groq', modelId: 'stub-model' },
): { adapter: ProviderAdapter; requests: TurnRequest[] } {
  const queue = [...script];
  const requests: TurnRequest[] = [];
  let index = 0;
  const adapter: ProviderAdapter = {
    ...identity,
    async act(request) {
      requests.push(structuredClone(request));
      const next = queue.shift();
      if (next === undefined) throw new Error('scriptedAdapter: no scripted turn left');
      if (next instanceof Error) throw next;
      const anomaly = next.anomaly ?? null;
      const toolCall = next.toolCall !== undefined ? next.toolCall : anomaly === null ? syntheticCall(next.rawAction, index) : null;
      index += 1;
      return {
        rawAction: next.rawAction,
        toolCall,
        text: next.text ?? null,
        anomaly,
        tokens: next.tokens ?? { ...STUB_TOKENS },
        latencyMs: next.latencyMs ?? STUB_LATENCY_MS,
        attempts: next.attempts ?? 1,
      };
    },
  };
  return { adapter, requests };
}

/** The golden log's turns for one competitor, in `seq` order, with their real tokens and latency. */
export function turnsFromLog(log: EventLog, competitorId: string): ScriptedTurn[] {
  return log
    .filter((event) => event.competitorId === competitorId)
    .sort((a, b) => a.seq - b.seq)
    .map((event) => ({ rawAction: event.action, tokens: event.tokens, latencyMs: event.latencyMs }));
}

/** `now` advances `stepMs` per read. No real clock: `boundary.test.ts` sweeps this file too. */
export function fixedClock(startMs = Date.parse('2026-09-22T10:00:00.000Z'), stepMs = 1000): HarnessDeps {
  let t = startMs;
  return {
    now: () => {
      t += stepMs;
      return t;
    },
  };
}
