import { describe, expect, it } from 'vitest';
import { ActionSchema } from '@/lib/schema/action';
import { loadCanonicalRoom } from '@/fixtures';
import { createSimulator } from '@/lib/sim';
import {
  GROQ_ENDPOINT,
  compileGroqRequest,
  compileGroqTools,
  createGroqAdapter,
  decodeGroqResponse,
  normaliseGroqTools,
} from './groq';
import { buildPortableSpec } from './vocabulary';
import { ProviderError, type TurnRequest } from './types';
import { groqToolCallResponse, testDeps } from './testing';

const spec = buildPortableSpec();
const KEY = 'gsk_TEST_SECRET_abcdefghijklmnopqrstuvwxyz';
const params = { temperature: 0, topP: null };
const inspectDesk = JSON.stringify({ targetId: 'desk', intent: 'The desk is the obvious start.' });

const request: TurnRequest = {
  system: 'You are in a locked room.',
  transcript: [
    { kind: 'user', text: 'You see a writing desk.' },
    { kind: 'tool_call', call: { callId: 'call_1', toolName: 'inspect', args: { targetId: 'desk', intent: 'Read.' } } },
    { kind: 'tool_result', callId: 'call_1', toolName: 'inspect', text: 'A ledger lies open.' },
    { kind: 'assistant_text', text: 'Thinking aloud.' },
  ],
};

describe('compileGroqTools / normaliseGroqTools', () => {
  it('emits seven function tools and no additionalProperties', () => {
    const tools = compileGroqTools(spec);
    expect(tools).toHaveLength(7);
    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.function.parameters).not.toHaveProperty('additionalProperties');
    }
  });

  it('inverts exactly: normalise(compile(spec)) equals spec', () => {
    expect(normaliseGroqTools(compileGroqTools(spec))).toEqual(spec);
  });

  it('refuses a key the compiler is not known to emit — a hint for one model only', () => {
    const tools = compileGroqTools(spec) as unknown as { function: { parameters: { properties: Record<string, object> } } }[];
    tools[1]!.function.parameters.properties.targetId = { type: 'string', description: 'x', enum: ['desk'] };
    expect(() => normaliseGroqTools(tools)).toThrow(/unexpected key/);
  });
});

describe('compileGroqRequest', () => {
  const body = compileGroqRequest(request, { modelId: 'test-model', params }) as Record<string, unknown>;
  const messages = body.messages as Record<string, unknown>[];

  it('puts the system prompt first and forces exactly one tool call', () => {
    expect(messages[0]).toEqual({ role: 'system', content: 'You are in a locked room.' });
    expect(body.tool_choice).toBe('required');
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.model).toBe('test-model');
  });

  it('encodes every transcript kind in the OpenAI dialect, arguments stringified', () => {
    expect(messages.slice(1)).toEqual([
      { role: 'user', content: 'You see a writing desk.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'inspect', arguments: '{"targetId":"desk","intent":"Read."}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'inspect', content: 'A ledger lies open.' },
      { role: 'assistant', content: 'Thinking aloud.' },
    ]);
  });

  it('sends a sampling param when set and omits it — not null — when it is the provider default', () => {
    expect(body.temperature).toBe(0);
    expect(body).not.toHaveProperty('top_p');
    const defaults = compileGroqRequest(request, { modelId: 'm', params: { temperature: null, topP: null } });
    expect(defaults).not.toHaveProperty('temperature');
    expect(defaults).not.toHaveProperty('top_p');
  });

  it('builds a valid first-turn request from an empty transcript', () => {
    const first = compileGroqRequest({ system: 's', transcript: [] }, { modelId: 'm', params }) as { messages: unknown[] };
    expect(first.messages).toEqual([{ role: 'system', content: 's' }]);
  });
});

describe('decodeGroqResponse', () => {
  const ctx = { callIndex: 0 };

  it('decodes a single call into a parseable action with its tokens and id', () => {
    const turn = decodeGroqResponse(200, groqToolCallResponse([{ id: 'call_9', name: 'inspect', arguments: inspectDesk }], { prompt: 820, completion: 28 }), ctx);
    expect(turn.anomaly).toBeNull();
    expect(ActionSchema.parse(turn.rawAction)).toMatchObject({ name: 'inspect', targetId: 'desk' });
    expect(turn.tokens).toEqual({ prompt: 820, completion: 28 });
    expect(turn.toolCall?.callId).toBe('call_9');
  });

  it('treats a text-only reply as no_tool_call, keeping the text', () => {
    const turn = decodeGroqResponse(200, groqToolCallResponse([], undefined, 'I would look around.'), ctx);
    expect(turn).toMatchObject({ anomaly: 'no_tool_call', rawAction: null, toolCall: null, text: 'I would look around.' });
  });

  it('treats two calls as multiple_tool_calls, which the simulator will refuse', () => {
    const turn = decodeGroqResponse(
      200,
      groqToolCallResponse([
        { name: 'inspect', arguments: inspectDesk },
        { name: 'look', arguments: '{"intent":"x"}' },
      ]),
      ctx,
    );
    expect(turn.anomaly).toBe('multiple_tool_calls');
    expect(ActionSchema.safeParse(turn.rawAction).success).toBe(false);
    expect(turn.toolCall?.toolName).toBe('inspect');
  });

  it('keeps arguments that are not JSON as a string and flags them', () => {
    const turn = decodeGroqResponse(200, groqToolCallResponse([{ name: 'look', arguments: '{"intent":' }]), ctx);
    expect(turn.anomaly).toBe('unparseable_arguments');
    expect(turn.toolCall?.args).toBe('{"intent":');
    expect(ActionSchema.safeParse(turn.rawAction).success).toBe(false);
  });

  it('synthesises a call id when the provider sends none', () => {
    const json = groqToolCallResponse([{ name: 'look', arguments: '{"intent":"x"}' }]);
    delete (json.choices[0]!.message as { tool_calls?: { id?: string }[] }).tool_calls![0]!.id;
    const turn = decodeGroqResponse(200, json, { callIndex: 4 });
    expect(turn.toolCall?.callId).toMatch(/4-0$/);
  });

  it('counts missing usage as zero, never NaN', () => {
    const json = groqToolCallResponse([{ name: 'look', arguments: '{"intent":"x"}' }]) as Record<string, unknown>;
    delete json.usage;
    expect(decodeGroqResponse(200, json, ctx).tokens).toEqual({ prompt: 0, completion: 0 });
  });

  it("turns Groq's 400 tool_use_failed into a consumed turn, not an exception", () => {
    const json = {
      error: { message: 'Failed to call a function.', type: 'invalid_request_error', code: 'tool_use_failed', failed_generation: '<fn>' },
    };
    const turn = decodeGroqResponse(400, json, ctx);
    expect(turn.anomaly).toBe('provider_rejected_call');
    expect(ActionSchema.safeParse(turn.rawAction).success).toBe(false);
  });

  it('throws ProviderError on a real refusal, with the key scrubbed', () => {
    const json = { error: { message: `Invalid API Key ${KEY}`, code: 'invalid_api_key' } };
    const error = (() => {
      try {
        decodeGroqResponse(401, json, { callIndex: 0, secrets: [KEY] });
      } catch (e) {
        return e as ProviderError;
      }
    })();
    expect(error).toBeInstanceOf(ProviderError);
    expect(error!.status).toBe(401);
    expect(error!.message).not.toContain(KEY);
  });
});

describe('createGroqAdapter', () => {
  it('posts to the endpoint with a bearer header and returns timing', async () => {
    const { deps, calls } = testDeps([{ status: 200, body: groqToolCallResponse([{ name: 'inspect', arguments: inspectDesk }]) }], 420);
    const adapter = createGroqAdapter({ apiKey: KEY, modelId: 'test-model', params, deps });
    const turn = await adapter.act(request);
    expect(adapter.provider).toBe('groq');
    expect(calls[0]!.url).toBe(GROQ_ENDPOINT);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(turn).toMatchObject({ latencyMs: 420, attempts: 1, anomaly: null });
  });

  it('plugs straight into Simulator.apply — a good call resolves, a bad one costs a turn', async () => {
    const { deps } = testDeps([
      { status: 200, body: groqToolCallResponse([{ name: 'inspect', arguments: inspectDesk }]) },
      { status: 200, body: groqToolCallResponse([], undefined, 'hmm') },
    ]);
    const adapter = createGroqAdapter({ apiKey: KEY, modelId: 'test-model', params, deps });
    const sim = createSimulator({
      spec: loadCanonicalRoom(),
      budget: { maxActions: 14, maxTokens: 60_000, maxWallClockMs: 300_000 },
      competitorId: 'model-a',
    });

    const good = await adapter.act(request);
    expect(sim.apply(good.rawAction, { tokens: good.tokens, elapsedMs: good.latencyMs }).verdict.code).toBe('ok');

    const bad = await adapter.act(request);
    const before = sim.observe().actionsRemaining;
    expect(sim.apply(bad.rawAction, { tokens: bad.tokens, elapsedMs: bad.latencyMs }).verdict.code).toBe('malformed');
    expect(sim.observe().actionsRemaining).toBe(before - 1);
  });
});
