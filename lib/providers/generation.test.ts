import { describe, expect, it } from 'vitest';
import { createGenerationClient } from './generation';
import { compileGroqJsonRequest, decodeGroqJsonResponse, GROQ_ENDPOINT } from './groq';
import { compileGeminiJsonRequest, decodeGeminiJsonResponse } from './gemini';
import { ProviderError, type JsonRequest } from './types';
import { geminiFunctionCallResponse, groqToolCallResponse, testDeps } from './testing';

/**
 * The generation client — TICKET-5 (#6). JSON mode, one document per call, and
 * nothing that looks like a competitor request.
 */

const request: JsonRequest = { system: 'You design escape rooms.', prompt: 'Reply with one JSON object.' };
const defaults = { temperature: null, topP: null };
const room = '{"theme":{"name":"x"}}';

function groqText(content: string | null, usage = { prompt: 900, completion: 300 }) {
  return groqToolCallResponse([], usage, content);
}

function geminiText(text: string, finishReason = 'STOP', usage: { prompt: number; completion: number; thoughts?: number } = { prompt: 900, completion: 300 }) {
  return geminiFunctionCallResponse([{ text }], usage, finishReason);
}

describe('Groq JSON mode', () => {
  it('asks for a JSON object and sends no tools', () => {
    const body = compileGroqJsonRequest(request, { modelId: 'm', params: defaults });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('parallel_tool_calls');
    expect(JSON.stringify(body.messages)).toMatch(/JSON/);
  });

  it('omits null sampling params and sends set ones', () => {
    expect(compileGroqJsonRequest(request, { modelId: 'm', params: defaults })).not.toHaveProperty('temperature');
    const body = compileGroqJsonRequest(request, { modelId: 'm', params: { temperature: 0.7, topP: 0.9 } });
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
  });

  it('decodes content and tokens', () => {
    expect(decodeGroqJsonResponse(200, groqText(room), {})).toEqual({
      text: room,
      anomaly: null,
      tokens: { prompt: 900, completion: 300 },
    });
  });

  it('treats json_validate_failed as the model failing, not a throw, and drops failed_generation', () => {
    const decoded = decodeGroqJsonResponse(
      400,
      { error: { code: 'json_validate_failed', message: 'Failed to generate JSON', failed_generation: 'oops' } },
      {},
    );
    expect(decoded).toEqual({ text: null, anomaly: 'invalid_json', tokens: { prompt: 0, completion: 0 } });
  });

  it('throws ProviderError on any other failure', () => {
    expect(() => decodeGroqJsonResponse(401, { error: { message: 'bad key' } }, {})).toThrow(ProviderError);
  });

  it('reads empty content as no text', () => {
    expect(decodeGroqJsonResponse(200, groqText(''), {}).text).toBeNull();
  });
});

describe('Gemini JSON mode', () => {
  it('asks for application/json and sends no tools', () => {
    const body = compileGeminiJsonRequest(request, { modelId: 'm', params: defaults });
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json' });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('toolConfig');
    expect(body.systemInstruction).toEqual({ parts: [{ text: request.system }] });
  });

  it('adds set sampling params beside the mime type', () => {
    const body = compileGeminiJsonRequest(request, { modelId: 'm', params: { temperature: 1, topP: null } });
    expect(body.generationConfig).toEqual({ responseMimeType: 'application/json', temperature: 1 });
  });

  it('excludes thought parts from text and counts thinking tokens as completion', () => {
    const json = geminiFunctionCallResponse(
      [{ text: 'let me think', thought: true }, { text: room }],
      { prompt: 900, completion: 300, thoughts: 200 },
    );
    expect(decodeGeminiJsonResponse(200, json, {})).toEqual({
      text: room,
      anomaly: null,
      tokens: { prompt: 900, completion: 500 },
    });
  });

  it('treats a truncated or empty response as invalid JSON', () => {
    expect(decodeGeminiJsonResponse(200, geminiText('{"theme":', 'MAX_TOKENS'), {}).anomaly).toBe('invalid_json');
    expect(decodeGeminiJsonResponse(200, geminiText(''), {}).anomaly).toBe('invalid_json');
  });

  it('throws ProviderError on a non-2xx', () => {
    expect(() => decodeGeminiJsonResponse(400, { error: { message: 'bad model' } }, {})).toThrow(ProviderError);
  });
});

describe('createGenerationClient', () => {
  it('posts to the Groq endpoint and reports timing and real call count across a retry', async () => {
    const { deps, calls, slept } = testDeps([
      { status: 429, body: { error: { message: 'slow down' } } },
      { status: 200, body: groqText(room) },
    ]);
    const client = createGenerationClient({ provider: 'groq', modelId: 'm', params: defaults }, 'k', deps);
    const completion = await client.complete(request);

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(GROQ_ENDPOINT);
    expect(slept).toHaveLength(1);
    expect(completion).toMatchObject({ text: room, anomaly: null, attempts: 2, latencyMs: 100 });
    expect(client).toMatchObject({ provider: 'groq', modelId: 'm' });
  });

  it('posts Gemini JSON mode with the key in a header', async () => {
    const { deps, calls } = testDeps([{ status: 200, body: geminiText(room) }]);
    const client = createGenerationClient({ provider: 'gemini', modelId: 'gm', params: defaults }, 'k', deps);
    const completion = await client.complete(request);

    expect(calls[0]!.url).toContain('gm:generateContent');
    expect(calls[0]!.url).not.toContain('key=');
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
    expect(completion).toMatchObject({ text: room, attempts: 1 });
  });
});
