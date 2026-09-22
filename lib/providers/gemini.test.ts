import { describe, expect, it } from 'vitest';
import { ActionSchema } from '@/lib/schema/action';
import { loadCanonicalRoom } from '@/fixtures';
import { createSimulator } from '@/lib/sim';
import {
  compileGeminiRequest,
  compileGeminiTools,
  createGeminiAdapter,
  decodeGeminiResponse,
  geminiEndpoint,
  normaliseGeminiTools,
} from './gemini';
import { buildPortableSpec } from './vocabulary';
import { ProviderError, type TurnRequest } from './types';
import { geminiFunctionCallResponse, testDeps } from './testing';

const spec = buildPortableSpec();
const KEY = 'AIzaTEST_SECRET_abcdefghijklmnopqrstuvwxyz012';
const params = { temperature: 0, topP: null };
const inspectDesk = { functionCall: { name: 'inspect', args: { targetId: 'desk', intent: 'The desk is the obvious start.' } } };

const signedPart = {
  functionCall: { name: 'inspect', args: { targetId: 'desk', intent: 'Read.' }, id: 'fc_1' },
  thoughtSignature: 'opaque-sig',
};

const request: TurnRequest = {
  system: 'You are in a locked room.',
  transcript: [
    { kind: 'user', text: 'You see a writing desk.' },
    {
      kind: 'tool_call',
      call: { callId: 'fc_1', toolName: 'inspect', args: { targetId: 'desk', intent: 'Read.' }, native: signedPart },
    },
    { kind: 'tool_result', callId: 'fc_1', toolName: 'inspect', text: 'A ledger lies open.' },
    { kind: 'assistant_text', text: 'Thinking aloud.' },
  ],
};

describe('compileGeminiTools / normaliseGeminiTools', () => {
  it('emits upper-case types, a matching propertyOrdering and no additionalProperties', () => {
    const { functionDeclarations } = compileGeminiTools(spec);
    expect(functionDeclarations).toHaveLength(7);
    const use = functionDeclarations[4]!;
    expect(use.parameters.type).toBe('OBJECT');
    expect(use.parameters.properties.intent).toMatchObject({ type: 'STRING', minLength: '1', maxLength: '280' });
    expect(use.parameters.propertyOrdering).toEqual(['itemId', 'targetId', 'intent']);
    expect(use.parameters).not.toHaveProperty('additionalProperties');
  });

  it('inverts exactly: normalise(compile(spec)) equals spec', () => {
    expect(normaliseGeminiTools(compileGeminiTools(spec))).toEqual(spec);
  });

  it('accepts lengths as numbers as well as int64 strings', () => {
    const tools = compileGeminiTools(spec) as unknown as {
      functionDeclarations: { parameters: { properties: Record<string, { maxLength?: unknown }> } }[];
    };
    tools.functionDeclarations[0]!.parameters.properties.intent!.maxLength = 280;
    expect(normaliseGeminiTools(tools)).toEqual(spec);
  });

  it('refuses a key the compiler is not known to emit, and a propertyOrdering that disagrees', () => {
    const extra = compileGeminiTools(spec) as unknown as { functionDeclarations: { parameters: Record<string, unknown> }[] };
    extra.functionDeclarations[0]!.parameters.nullable = true;
    expect(() => normaliseGeminiTools(extra)).toThrow(/unexpected key/);

    const ordering = compileGeminiTools(spec);
    ordering.functionDeclarations[4]!.parameters.propertyOrdering = ['itemId', 'intent'];
    expect(() => normaliseGeminiTools(ordering)).toThrow(/propertyOrdering/);
  });
});

describe('compileGeminiRequest', () => {
  const body = compileGeminiRequest(request, { modelId: 'test-model', params }) as Record<string, unknown>;

  it('carries the system prompt as systemInstruction and forces a function call', () => {
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'You are in a locked room.' }] });
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
  });

  it('encodes every transcript kind, echoing the native part byte for byte', () => {
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'You see a writing desk.' }] },
      { role: 'model', parts: [signedPart] },
      { role: 'user', parts: [{ functionResponse: { name: 'inspect', id: 'fc_1', response: { result: 'A ledger lies open.' } } }] },
      { role: 'model', parts: [{ text: 'Thinking aloud.' }] },
    ]);
    expect(JSON.stringify(body.contents)).toContain('"thoughtSignature":"opaque-sig"');
  });

  it('never sends a made-up call id to Gemini', () => {
    const synthetic = compileGeminiRequest(
      {
        system: 's',
        transcript: [
          { kind: 'tool_call', call: { callId: 'local:0-0', toolName: 'look', args: { intent: 'x' } } },
          { kind: 'tool_result', callId: 'local:0-0', toolName: 'look', text: 'ok' },
        ],
      },
      { modelId: 'm', params },
    ) as { contents: unknown[] };
    expect(JSON.stringify(synthetic.contents)).not.toContain('local:');
  });

  it('sends a sampling param when set and omits generationConfig entirely for provider defaults', () => {
    expect(body.generationConfig).toEqual({ temperature: 0 });
    const defaults = compileGeminiRequest(request, { modelId: 'm', params: { temperature: null, topP: null } });
    expect(defaults).not.toHaveProperty('generationConfig');
  });

  it('builds a valid first-turn request from an empty transcript', () => {
    const first = compileGeminiRequest({ system: 's', transcript: [] }, { modelId: 'm', params }) as { contents: unknown[] };
    expect(first.contents).toEqual([]);
  });
});

describe('decodeGeminiResponse', () => {
  const ctx = { callIndex: 0 };

  it('decodes a single call into a parseable action, keeping the whole part as native', () => {
    const turn = decodeGeminiResponse(200, geminiFunctionCallResponse([signedPart], { prompt: 820, completion: 28 }), ctx);
    expect(turn.anomaly).toBeNull();
    expect(ActionSchema.parse(turn.rawAction)).toMatchObject({ name: 'inspect', targetId: 'desk' });
    expect(turn.toolCall).toMatchObject({ callId: 'fc_1', native: signedPart });
    expect(turn.tokens).toEqual({ prompt: 820, completion: 28 });
  });

  it('counts thinking tokens as completion tokens', () => {
    const json = geminiFunctionCallResponse([inspectDesk], { prompt: 100, completion: 10, thoughts: 250 });
    expect(decodeGeminiResponse(200, json, ctx).tokens).toEqual({ prompt: 100, completion: 260 });
  });

  it('treats a text-only reply as no_tool_call, ignoring thought parts', () => {
    const json = geminiFunctionCallResponse([{ text: 'secret thoughts', thought: true }, { text: 'I would look.' }]);
    expect(decodeGeminiResponse(200, json, ctx)).toMatchObject({ anomaly: 'no_tool_call', rawAction: null, text: 'I would look.' });
  });

  it('treats two calls as multiple_tool_calls', () => {
    const turn = decodeGeminiResponse(200, geminiFunctionCallResponse([inspectDesk, { functionCall: { name: 'look', args: { intent: 'x' } } }]), ctx);
    expect(turn.anomaly).toBe('multiple_tool_calls');
    expect(ActionSchema.safeParse(turn.rawAction).success).toBe(false);
  });

  it('turns MALFORMED_FUNCTION_CALL into a consumed turn', () => {
    const turn = decodeGeminiResponse(200, geminiFunctionCallResponse([], undefined, 'MALFORMED_FUNCTION_CALL'), ctx);
    expect(turn.anomaly).toBe('provider_rejected_call');
    expect(ActionSchema.safeParse(turn.rawAction).success).toBe(false);
  });

  it('synthesises a call id when the provider sends none', () => {
    expect(decodeGeminiResponse(200, geminiFunctionCallResponse([inspectDesk]), { callIndex: 3 }).toolCall?.callId).toMatch(/3-0$/);
  });

  it('counts missing usage as zero and survives an empty body', () => {
    expect(decodeGeminiResponse(200, {}, ctx)).toMatchObject({ anomaly: 'no_tool_call', tokens: { prompt: 0, completion: 0 } });
  });

  it('throws ProviderError on a refusal, with the key scrubbed', () => {
    let error: ProviderError | undefined;
    try {
      decodeGeminiResponse(400, { error: { message: `API key not valid: ${KEY}` } }, { callIndex: 0, secrets: [KEY] });
    } catch (e) {
      error = e as ProviderError;
    }
    expect(error).toBeInstanceOf(ProviderError);
    expect(error!.message).not.toContain(KEY);
  });
});

describe('createGeminiAdapter', () => {
  it('puts the model in the path and the key in a header, never the URL', async () => {
    const { deps, calls } = testDeps([{ status: 200, body: geminiFunctionCallResponse([inspectDesk]) }], 380);
    const adapter = createGeminiAdapter({ apiKey: KEY, modelId: 'test-model', params, deps });
    const turn = await adapter.act(request);
    expect(adapter.provider).toBe('gemini');
    expect(calls[0]!.url).toBe(geminiEndpoint('test-model'));
    expect(calls[0]!.url).toContain('/models/test-model:generateContent');
    expect(calls[0]!.url).not.toMatch(/key=/);
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(turn).toMatchObject({ latencyMs: 380, attempts: 1, anomaly: null });
  });

  it('plugs straight into Simulator.apply — a good call resolves, a bad one costs a turn', async () => {
    const { deps } = testDeps([
      { status: 200, body: geminiFunctionCallResponse([inspectDesk]) },
      { status: 200, body: geminiFunctionCallResponse([{ text: 'hmm' }]) },
    ]);
    const adapter = createGeminiAdapter({ apiKey: KEY, modelId: 'test-model', params, deps });
    const sim = createSimulator({
      spec: loadCanonicalRoom(),
      budget: { maxActions: 14, maxTokens: 60_000, maxWallClockMs: 300_000 },
      competitorId: 'model-b',
    });

    const good = await adapter.act(request);
    expect(sim.apply(good.rawAction, { tokens: good.tokens, elapsedMs: good.latencyMs }).verdict.code).toBe('ok');

    const bad = await adapter.act(request);
    const before = sim.observe().actionsRemaining;
    expect(sim.apply(bad.rawAction, { tokens: bad.tokens, elapsedMs: bad.latencyMs }).verdict.code).toBe('malformed');
    expect(sim.observe().actionsRemaining).toBe(before - 1);
  });
});
