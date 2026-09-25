/**
 * Test support for `lib/telemetry` — a scripted `fetch` that records its calls.
 *
 * The same shape as `lib/providers/testing.ts`'s `stubFetch`, deliberately not
 * imported from it: telemetry must never import the providers
 * (`boundary.test.ts`). Not exported from `index.ts`.
 */

export type ScriptedResponse = { status: number; body: unknown } | Error;

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
    return new Response(text, { status: next.status });
  };
  return { fetch: fake as typeof fetch, calls };
}
