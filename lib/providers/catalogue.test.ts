import { describe, expect, it } from 'vitest';
import { CATALOGUE_EXCLUSIONS, geminiCatalogue, groqCatalogue, listModels, openRouterCatalogue } from './catalogue';
import { GROQ_MODELS_ENDPOINT } from './groq';
import { OPENROUTER_MODELS_ENDPOINT } from './openrouter';
import { ProviderError } from './types';
import { stubFetch } from './testing';

/**
 * The catalogue's rules, against listings shaped like the real ones on
 * 2026-09-25 — trimmed to the fields the rules read, plus the neighbours each
 * rule has to tell apart.
 */

const GROQ_LISTING = {
  object: 'list',
  data: [
    { id: 'openai/gpt-oss-120b', active: true, context_window: 131072 },
    { id: 'openai/gpt-oss-20b', active: true, context_window: 131072 },
    { id: 'openai/gpt-oss-safeguard-20b', active: true, context_window: 131072 },
    { id: 'qwen/qwen3.8-27b', active: true, context_window: 131072 },
    { id: 'whisper-large-v3', active: true, context_window: 448 },
    { id: 'canopylabs/orpheus-v1-english', active: true, context_window: 4000 },
    { id: 'meta-llama/llama-prompt-guard-2-86m', active: true, context_window: 512 },
    { id: 'allam-2-7b', active: true, context_window: 4096 },
    { id: 'retired-model', active: false, context_window: 131072 },
  ],
};

const GEMINI_LISTING = {
  models: [
    { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-flash-latest', displayName: 'Gemini Flash Latest', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemma-4-31b-it', displayName: 'Gemma 4 31B', inputTokenLimit: 262144, supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-pro-latest', displayName: 'Gemini Pro Latest', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/lyria-3.5', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
  ],
};

const text = { output_modalities: ['text'] };
const TOOLS = ['tools', 'tool_choice', 'temperature'];
const OPENROUTER_LISTING = {
  data: [
    { id: 'nvidia/nemotron-3-super-120b-a12b:free', name: 'NVIDIA: Nemotron 3 Super (free)', context_length: 262144, pricing: { prompt: '0', completion: '0' }, supported_parameters: TOOLS, architecture: text },
    { id: 'google/gemma-4-31b-it:free', name: 'Google: Gemma 4 31B (free)', context_length: 262144, pricing: { prompt: '0', completion: '0' }, supported_parameters: TOOLS, architecture: text },
    { id: 'openrouter/free', name: 'Free Models Router', context_length: 200000, pricing: { prompt: '0', completion: '0' }, supported_parameters: TOOLS, architecture: text },
    { id: 'z-ai/glm-5.2:free', name: 'GLM 5.2 (free)', context_length: 32768, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['temperature'], architecture: text },
    { id: 'vendor/tools-no-choice:free', name: 'No forced mode', context_length: 32768, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'], architecture: text },
    { id: 'google/lyria-3-pro-preview', name: 'Lyria', context_length: 1048576, pricing: { prompt: '0', completion: '0' }, supported_parameters: TOOLS, architecture: { output_modalities: ['text', 'audio'] } },
    { id: 'fireworks/ember-1', name: 'Ember', context_length: 1048576, pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: TOOLS, architecture: text },
    { id: 'vendor/tiny:free', name: 'Tiny', context_length: 4096, pricing: { prompt: '0', completion: '0' }, supported_parameters: TOOLS, architecture: text },
    { id: 'anthropic/claude-sonnet-5', name: 'Anthropic: Claude Sonnet 5', context_length: 1000000, pricing: { prompt: '0.000002', completion: '0.00001' }, supported_parameters: TOOLS, architecture: text },
    { id: 'anthropic/claude-sonnet-5:batch', name: 'Anthropic: Claude Sonnet 5 (batch)', context_length: 1000000, pricing: { prompt: '0.000001', completion: '0.000005' }, supported_parameters: TOOLS, architecture: text },
    { id: 'anthropic/claude-no-tools', name: 'No forced mode', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['tools'], architecture: text },
    { id: 'anthropic/claude-unpriced', name: 'No price', context_length: 200000, pricing: {}, supported_parameters: TOOLS, architecture: text },
  ],
};

const ids = (listing: { models: readonly { modelId: string }[] }) => listing.models.map((m) => m.modelId);
const excludedIds = (listing: { excluded: readonly { modelId: string }[] }) => listing.excluded.map((m) => m.modelId);

describe('groqCatalogue', () => {
  const listing = groqCatalogue(GROQ_LISTING);

  it('keeps the chat models that can play and drops speech, guard and tiny-context models quietly', () => {
    expect(ids(listing)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  });

  it('lists what a probe ruled out, with the reason', () => {
    expect(excludedIds(listing)).toEqual(['openai/gpt-oss-safeguard-20b', 'qwen/qwen3.8-27b']);
    expect(listing.excluded.find((e) => e.modelId === 'qwen/qwen3.8-27b')!.reason).toMatch(/1,000 output tokens/);
  });
});

describe('geminiCatalogue', () => {
  const listing = geminiCatalogue(GEMINI_LISTING);

  it('keeps free Flash and Gemma chat models, with their display names', () => {
    expect(ids(listing)).toEqual(['gemini-3.5-flash', 'gemini-flash-latest', 'gemma-4-31b-it']);
    expect(listing.models.find((m) => m.modelId === 'gemma-4-31b-it')).toMatchObject({ label: 'Gemma 4 31B', contextWindow: 262144 });
  });

  it('excludes retired 2.x models and Pro models without free quota, and says so', () => {
    expect(excludedIds(listing)).toEqual(['gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-pro-latest']);
  });
});

describe('openRouterCatalogue', () => {
  const listing = openRouterCatalogue(OPENROUTER_LISTING);

  it('keeps exactly the zero-price (or Claude), text-out models that support forced tool calls', () => {
    expect(ids(listing)).toEqual(['anthropic/claude-sonnet-5', 'google/gemma-4-31b-it:free', 'nvidia/nemotron-3-super-120b-a12b:free']);
  });

  it('excludes the free router and Claude batch variants, and says why', () => {
    expect(excludedIds(listing)).toEqual(['anthropic/claude-sonnet-5:batch', 'openrouter/free']);
  });

  it('never offers a paid model that is not Claude', () => {
    expect(ids(listing)).not.toContain('fireworks/ember-1');
  });

  it('carries a paid model\'s listed price per million tokens, and null for a free one', () => {
    expect(listing.models.find((m) => m.modelId === 'anthropic/claude-sonnet-5')!.price).toEqual({ promptPerMTok: 2, completionPerMTok: 10 });
    expect(listing.models.find((m) => m.modelId === 'google/gemma-4-31b-it:free')!.price).toBeNull();
  });

  it('never offers a Claude model without a stated price, since its cost could not be reported', () => {
    expect(ids(listing)).not.toContain('anthropic/claude-unpriced');
  });
});

describe('the exclusion list', () => {
  it('gives every entry a reason a person can read', () => {
    for (const exclusion of CATALOGUE_EXCLUSIONS) expect(exclusion.reason.length).toBeGreaterThan(10);
  });
});

describe('listModels', () => {
  it('reads OpenRouter without a key', async () => {
    const stub = stubFetch([{ status: 200, body: OPENROUTER_LISTING }]);
    const listing = await listModels('openrouter', null, { fetch: stub.fetch });
    expect(stub.calls[0]!.url).toBe(OPENROUTER_MODELS_ENDPOINT);
    expect(stub.calls[0]!.init.method).toBe('GET');
    expect(ids(listing)).toHaveLength(3);
  });

  it('sends the Groq key as a bearer header and never echoes it in an error', async () => {
    const key = 'gsk_TEST_SECRET_abcdefghijklmnopqrstuvwxyz';
    const ok = stubFetch([{ status: 200, body: GROQ_LISTING }]);
    await listModels('groq', key, { fetch: ok.fetch });
    expect(ok.calls[0]!.url).toBe(GROQ_MODELS_ENDPOINT);
    expect((ok.calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${key}`);

    const refused = stubFetch([{ status: 401, body: { error: { message: `Invalid API Key ${key}` } } }]);
    const error = await listModels('groq', key, { fetch: refused.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(String(error)).not.toContain(key);
  });

  it('turns a network failure into a ProviderError', async () => {
    const down = stubFetch([new Error('getaddrinfo ENOTFOUND')]);
    await expect(listModels('gemini', 'AIzaTEST_SECRET_abcdefghijklmnopqrstuvwxyz012', { fetch: down.fetch })).rejects.toThrow(
      /gemini: getaddrinfo ENOTFOUND/,
    );
  });
});
