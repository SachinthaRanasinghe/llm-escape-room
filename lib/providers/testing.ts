import type { TransportDeps } from './transport';

/**
 * Test support for the adapters — a scripted `fetch`, a fake clock, and canned
 * native responses in each provider's dialect.
 *
 * Deliberately NOT exported from `index.ts`, like `lib/solver/fuzz.ts`: nothing
 * on a real call path should be able to swap its transport for a script.
 * Everything is injected through `TransportDeps` rather than `vi.stubGlobal`, so
 * one test file can never leak a stub into another.
 */

export type ScriptedResponse = { status: number; body: unknown; headers?: Record<string, string> } | Error;

export interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
  readonly body: unknown;
}

export function stubFetch(script: ScriptedResponse[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const queue = [...script];
  const calls: RecordedCall[] = [];
  const fake = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url: String(input), init, body });
    const next = queue.shift();
    if (next === undefined) throw new Error('stubFetch: no scripted response left');
    if (next instanceof Error) throw next;
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status, headers: next.headers });
  };
  return { fetch: fake as typeof fetch, calls };
}

/** `now` advances `stepMs` per read; `sleep` records the delay and returns at once. */
export function fakeClock(stepMs = 100): { now: () => number; sleep: (ms: number) => Promise<void>; slept: number[] } {
  let t = 0;
  const slept: number[] = [];
  return {
    now: () => {
      t += stepMs;
      return t;
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
    slept,
  };
}

export function testDeps(script: ScriptedResponse[], stepMs = 100) {
  const stub = stubFetch(script);
  const clock = fakeClock(stepMs);
  const deps: TransportDeps = { fetch: stub.fetch, now: clock.now, sleep: clock.sleep };
  return { deps, calls: stub.calls, slept: clock.slept };
}

export interface Usage {
  readonly prompt: number;
  readonly completion: number;
}

export function groqToolCallResponse(
  calls: readonly { id?: string; name: string; arguments: string }[],
  usage: Usage = { prompt: 100, completion: 10 },
  content: string | null = null,
) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(calls.length > 0
            ? {
                tool_calls: calls.map((call, index) => ({
                  id: call.id ?? `call_${index}`,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        },
        finish_reason: calls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: { prompt_tokens: usage.prompt, completion_tokens: usage.completion, total_tokens: usage.prompt + usage.completion },
  };
}

export function geminiFunctionCallResponse(
  parts: readonly Record<string, unknown>[],
  usage: Usage & { thoughts?: number } = { prompt: 100, completion: 10 },
  finishReason = 'STOP',
) {
  return {
    candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
    usageMetadata: {
      promptTokenCount: usage.prompt,
      candidatesTokenCount: usage.completion,
      ...(usage.thoughts !== undefined ? { thoughtsTokenCount: usage.thoughts } : {}),
      totalTokenCount: usage.prompt + usage.completion + (usage.thoughts ?? 0),
    },
  };
}
