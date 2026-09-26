import { describe, expect, it } from 'vitest';
import { ActionSchema } from '@/lib/schema/action';
import { compileGroqRequest, decodeGroqResponse } from './groq';
import { createGenerationClient } from './generation';
import { OPENROUTER_ENDPOINT, compileOpenRouterRequest, createOpenRouterAdapter, decodeOpenRouterResponse } from './openrouter';
import { ProviderError, type TurnRequest } from './types';
import { groqToolCallResponse, testDeps } from './testing';

const KEY = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`;
const params = { temperature: null, topP: null };
const inspectDesk = JSON.stringify({ targetId: 'desk', intent: 'The desk is the obvious start.' });

const request: TurnRequest = {
  system: 'You are in a locked room.',
  transcript: [
    { kind: 'user', text: 'You see a writing desk.' },
    { kind: 'tool_call', call: { callId: 'call_1', toolName: 'inspect', args: { targetId: 'desk', intent: 'Read.' } } },
    { kind: 'tool_result', callId: 'call_1', toolName: 'inspect', text: 'A ledger lies open.' },
  ],
};

describe('compileOpenRouterRequest', () => {
  it('is byte-for-byte the Groq request — the same tools, the same forced mode, nothing extra a model could see', () => {
    const config = { modelId: 'vendor/model:free', params: { temperature: 0.2, topP: null } };
    expect(JSON.stringify(compileOpenRouterRequest(request, config))).toBe(JSON.stringify(compileGroqRequest(request, config)));
  });
});

describe('decodeOpenRouterResponse', () => {
  it('decodes a tool call exactly as the Groq decoder does', () => {
    const body = groqToolCallResponse([{ name: 'inspect', arguments: inspectDesk }]);
    const viaOpenRouter = decodeOpenRouterResponse(200, body, { callIndex: 0 });
    expect(viaOpenRouter).toEqual(decodeGroqResponse(200, body, { callIndex: 0 }));
    expect(ActionSchema.safeParse(viaOpenRouter.rawAction).success).toBe(true);
  });

  it('turns a 200 carrying an upstream error into a ProviderError, not a turn the model is charged', () => {
    const error = (() => {
      try {
        decodeOpenRouterResponse(200, { error: { message: 'Provider returned error', code: 502 } }, { callIndex: 0 });
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).provider).toBe('openrouter');
  });

  it('also catches an error attached to the choice', () => {
    expect(() =>
      decodeOpenRouterResponse(200, { choices: [{ error: { message: 'upstream timeout' }, finish_reason: 'error' }] }, { callIndex: 0 }),
    ).toThrow(/openrouter: upstream timeout/);
  });

  it('blames openrouter, not groq, for a refused request, with the key scrubbed', () => {
    expect(() =>
      decodeOpenRouterResponse(401, { error: { message: `bad key ${KEY}` } }, { callIndex: 0, secrets: [KEY] }),
    ).toThrow(/^openrouter: bad key \*\*\*/);
  });

  it('scores a 400 carrying failed_generation as the model fumbling a turn, like Groq', () => {
    const turn = decodeOpenRouterResponse(400, { error: { message: 'x', failed_generation: '<junk>' } }, { callIndex: 0 });
    expect(turn.anomaly).toBe('provider_rejected_call');
  });
});

describe('createOpenRouterAdapter', () => {
  it('posts to the OpenRouter endpoint with a bearer header and returns timing', async () => {
    const { deps, calls } = testDeps([{ status: 200, body: groqToolCallResponse([{ name: 'inspect', arguments: inspectDesk }]) }], 300);
    const adapter = createOpenRouterAdapter({ apiKey: KEY, modelId: 'vendor/model:free', params, deps });
    const turn = await adapter.act(request);
    expect(adapter.provider).toBe('openrouter');
    expect(calls[0]!.url).toBe(OPENROUTER_ENDPOINT);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect((calls[0]!.body as { model: string }).model).toBe('vendor/model:free');
    expect(turn).toMatchObject({ latencyMs: 300, attempts: 1, anomaly: null });
  });

  it('retries a 429 through the shared transport', async () => {
    const { deps, slept } = testDeps([
      { status: 429, body: { error: { message: 'Rate limit exceeded: free-models-per-min' } } },
      { status: 200, body: groqToolCallResponse([{ name: 'look', arguments: '{"intent":"x"}' }]) },
    ]);
    const turn = await createOpenRouterAdapter({ apiKey: KEY, modelId: 'm:free', params, deps }).act(request);
    expect(turn.attempts).toBe(2);
    expect(slept).toHaveLength(1);
  });
});

describe('transient upstream failures inside a 200', () => {
  const overloaded = { error: { message: 'Upstream error from Nvidia: Service temporarily overloaded', code: 502 } };

  it('are retried with backoff, every attempt counted, and the model is not charged a turn', async () => {
    const { deps, slept, calls } = testDeps([
      { status: 200, body: overloaded },
      { status: 200, body: groqToolCallResponse([{ name: 'look', arguments: '{"intent":"x"}' }]) },
    ]);
    const turn = await createOpenRouterAdapter({ apiKey: KEY, modelId: 'm:free', params, deps }).act(request);
    expect(calls).toHaveLength(2);
    expect(turn).toMatchObject({ attempts: 2, anomaly: null });
    expect(slept).toEqual([1000]);
  });

  it('give up after the retry policy, as a ProviderError', async () => {
    const { deps } = testDeps(Array.from({ length: 4 }, () => ({ status: 200, body: overloaded })));
    await expect(createOpenRouterAdapter({ apiKey: KEY, modelId: 'm:free', params, deps }).act(request)).rejects.toThrow(
      /openrouter: Upstream error from Nvidia/,
    );
  });

  it('are told apart from a refusal, which is never retried', async () => {
    const { deps, calls } = testDeps([{ status: 200, body: { error: { message: 'Model does not support tools', code: 400 } } }]);
    await expect(createOpenRouterAdapter({ apiKey: KEY, modelId: 'm:free', params, deps }).act(request)).rejects.toThrow(ProviderError);
    expect(calls).toHaveLength(1);
  });
});

describe('the OpenRouter generation client', () => {
  it('asks for one JSON object through the same endpoint', async () => {
    const { deps, calls } = testDeps([{ status: 200, body: groqToolCallResponse([], undefined, '{"a":1}') }]);
    const client = createGenerationClient({ provider: 'openrouter', modelId: 'm:free', params }, KEY, deps);
    const completion = await client.complete({ system: 's', prompt: 'Reply in JSON.' });
    expect(client.provider).toBe('openrouter');
    expect(calls[0]!.url).toBe(OPENROUTER_ENDPOINT);
    expect((calls[0]!.body as { response_format: unknown }).response_format).toEqual({ type: 'json_object' });
    expect(completion).toMatchObject({ text: '{"a":1}', anomaly: null });
  });
});
