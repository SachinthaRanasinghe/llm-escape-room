import type { Competitor } from '@/lib/schema/run';
import { buildPortableSpec, type PortableParam, type PortableSpec, type PortableTool } from './vocabulary';
import { DEFAULT_DEPS, errorExcerpt, postJson } from './transport';
import { count, isSyntheticCallId, rejectedTurn, syntheticCallId, turnFromCalls, type DecodeContext, type DecodedTurn } from './turn';
import {
  ProviderError,
  type AdapterOptions,
  type JsonCompletion,
  type JsonRequest,
  type ProviderAdapter,
  type ToolCall,
  type TurnRequest,
} from './types';

/**
 * The Gemini adapter — `models/{model}:generateContent` with forced function calls.
 *
 * Mirrors `groq.ts` function-for-function:
 *
 *   compileGeminiTools   PortableSpec → { functionDeclarations }
 *   normaliseGeminiTools native       → PortableSpec   (the inverse; equivalence.test.ts)
 *   compileGeminiRequest TurnRequest  → request body
 *   decodeGeminiResponse response     → ProviderTurn (minus timing)
 *
 * ── `parameters`, not `parametersJsonSchema` ───────────────────────────────
 * Gemini will also take near-verbatim JSON Schema. That would make equivalence
 * trivially true while hiding what the model actually receives. The OpenAPI-
 * subset `Schema` (upper-case types, no `additionalProperties`) forces the
 * mapping to be explicit, and the round trip in `equivalence.test.ts` tests it.
 *
 * ── Thought signatures ─────────────────────────────────────────────────────
 * Thinking models attach an opaque `thoughtSignature` to a `functionCall` part
 * and expect it back, byte for byte, on the next turn. So the WHOLE original
 * part is kept as `ToolCall.native` and echoed verbatim when the transcript is
 * re-encoded. It is the one piece of provider data allowed into the neutral
 * transcript, and only as an opaque passthrough.
 *
 * ── The key goes in a header ───────────────────────────────────────────────
 * `x-goog-api-key`, never `?key=`: a URL ends up in logs and error messages.
 */

export const GEMINI_HOST = 'https://generativelanguage.googleapis.com';

export function geminiEndpoint(modelId: string): string {
  return `${GEMINI_HOST}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
}

interface GeminiParam {
  type: 'STRING';
  description: string;
  /** int64 fields are strings in the REST API's JSON mapping. */
  minLength?: string;
  maxLength?: string;
}

export interface GeminiTools {
  functionDeclarations: {
    name: string;
    description: string;
    parameters: {
      type: 'OBJECT';
      properties: Record<string, GeminiParam>;
      required: string[];
      propertyOrdering: string[];
    };
  }[];
}

function compileParam(param: PortableParam): GeminiParam {
  return {
    type: 'STRING',
    description: param.description,
    ...(param.minLength !== null ? { minLength: String(param.minLength) } : {}),
    ...(param.maxLength !== null ? { maxLength: String(param.maxLength) } : {}),
  };
}

export function compileGeminiTools(spec: PortableSpec): GeminiTools {
  return {
    functionDeclarations: spec.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'OBJECT',
        properties: Object.fromEntries(Object.entries(tool.params).map(([key, p]) => [key, compileParam(p)])),
        required: [...tool.required],
        propertyOrdering: Object.keys(tool.params),
      },
    })),
  };
}

/** Throw on any key the compiler is not known to emit — see the same guard in `groq.ts`. */
function assertKeys(value: unknown, allowed: readonly string[], at: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`gemini tools: expected an object at ${at}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`gemini tools: unexpected key ${at}.${key}`);
  }
  return value as Record<string, unknown>;
}

/** The API types lengths as int64-as-string; accept either spelling. */
function length(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

export function normaliseGeminiTools(native: unknown): PortableSpec {
  const outer = assertKeys(native, ['functionDeclarations'], 'tools');
  if (!Array.isArray(outer.functionDeclarations)) throw new Error('gemini tools: functionDeclarations is not an array');

  const tools = outer.functionDeclarations.map((entry: unknown, index: number): PortableTool => {
    const fn = assertKeys(entry, ['name', 'description', 'parameters'], `[${index}]`);
    const name = String(fn.name);
    const parameters = assertKeys(
      fn.parameters,
      ['type', 'properties', 'required', 'propertyOrdering'],
      `${name}.parameters`,
    );
    if (parameters.type !== 'OBJECT') throw new Error(`gemini tools: ${name}.parameters.type is ${String(parameters.type)}`);
    const properties = parameters.properties;
    if (properties === null || typeof properties !== 'object') throw new Error(`gemini tools: ${name}.properties missing`);

    // `propertyOrdering` carries no meaning of its own, but it must name exactly
    // the properties — otherwise it is a second, divergent parameter list.
    const ordering = Array.isArray(parameters.propertyOrdering) ? parameters.propertyOrdering.map(String) : [];
    if ([...ordering].sort().join() !== Object.keys(properties).sort().join()) {
      throw new Error(`gemini tools: ${name}.propertyOrdering does not match its properties`);
    }

    const params: Record<string, PortableParam> = {};
    for (const [key, raw] of Object.entries(properties)) {
      const p = assertKeys(raw, ['type', 'description', 'minLength', 'maxLength'], `${name}.${key}`);
      if (p.type !== 'STRING') throw new Error(`gemini tools: ${name}.${key}.type is ${String(p.type)}`);
      params[key] = {
        type: 'string',
        description: String(p.description),
        minLength: length(p.minLength),
        maxLength: length(p.maxLength),
      };
    }

    return {
      name: name as PortableTool['name'],
      description: String(fn.description),
      params,
      required: Array.isArray(parameters.required) ? parameters.required.map(String) : [],
    };
  });
  return { tools };
}

export interface GeminiConfig {
  readonly modelId: string;
  readonly params: Competitor['params'];
}

export function compileGeminiRequest(request: TurnRequest, config: GeminiConfig): Record<string, unknown> {
  const contents: Record<string, unknown>[] = [];
  for (const entry of request.transcript) {
    switch (entry.kind) {
      case 'user':
        contents.push({ role: 'user', parts: [{ text: entry.text }] });
        break;
      case 'assistant_text':
        contents.push({ role: 'model', parts: [{ text: entry.text }] });
        break;
      case 'tool_call':
        contents.push({
          role: 'model',
          parts: [
            entry.call.native ?? {
              functionCall: {
                name: entry.call.toolName,
                args: entry.call.args,
                ...(isSyntheticCallId(entry.call.callId) ? {} : { id: entry.call.callId }),
              },
            },
          ],
        });
        break;
      case 'tool_result':
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: entry.toolName,
                ...(isSyntheticCallId(entry.callId) ? {} : { id: entry.callId }),
                response: { result: entry.text },
              },
            },
          ],
        });
        break;
    }
  }

  const generationConfig = {
    // `null` means provider default — omitted, not sent as null.
    ...(config.params.temperature !== null ? { temperature: config.params.temperature } : {}),
    ...(config.params.topP !== null ? { topP: config.params.topP } : {}),
  };

  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents,
    tools: [compileGeminiTools(buildPortableSpec())],
    toolConfig: { functionCallingConfig: { mode: 'ANY' } },
    ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
  };
}

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown; id?: string };
  [key: string]: unknown;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

export function decodeGeminiResponse(status: number, json: unknown, context: DecodeContext): DecodedTurn {
  const { callIndex, secrets = [], attempts = 1 } = context;
  if (status < 200 || status >= 300) {
    throw new ProviderError('gemini', status, attempts, errorExcerpt(json, secrets) || `HTTP ${status}`);
  }

  const body = (json ?? {}) as GeminiResponse;
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const usage = body.usageMetadata;
  // Thinking tokens are completion tokens. Leaving them out would make a
  // thinking model look cheaper than it is and charge the run budget unevenly.
  const tokens = {
    prompt: count(usage?.promptTokenCount),
    completion: count(usage?.candidatesTokenCount) + count(usage?.thoughtsTokenCount),
  };

  const texts = parts.filter((part) => typeof part.text === 'string' && part.thought !== true).map((p) => p.text!);
  const text = texts.length > 0 ? texts.join('') : null;

  if (candidate?.finishReason === 'MALFORMED_FUNCTION_CALL') {
    return rejectedTurn(tokens, text);
  }

  const calls = parts
    .filter((part) => part.functionCall !== undefined)
    .map(
      (part, index): ToolCall => ({
        callId: part.functionCall!.id ?? syntheticCallId(callIndex, index),
        toolName: part.functionCall!.name ?? '',
        // Already an object — no JSON.parse, unlike Groq.
        args: part.functionCall!.args ?? {},
        native: part,
      }),
    );

  return turnFromCalls(calls, text, tokens);
}

/* ── JSON mode, for the room generator — TICKET-5 (#6) ────────────────────
 * `responseMimeType` only, no `responseSchema`: the proposal schema has unions
 * and nullable fields the OpenAPI subset handles unevenly, and Zod on the
 * generator's side is the real gate. `generationConfig` is therefore always
 * present here, unlike in the adapter. */

export function compileGeminiJsonRequest(request: JsonRequest, config: GeminiConfig): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      ...(config.params.temperature !== null ? { temperature: config.params.temperature } : {}),
      ...(config.params.topP !== null ? { topP: config.params.topP } : {}),
    },
  };
}

/** A finish that leaves the JSON cut off or withheld — the model's failure, not the transport's. */
const TRUNCATING_FINISHES = new Set(['MAX_TOKENS', 'SAFETY', 'RECITATION']);

export function decodeGeminiJsonResponse(
  status: number,
  json: unknown,
  { secrets = [], attempts = 1 }: Pick<DecodeContext, 'secrets' | 'attempts'>,
): Omit<JsonCompletion, 'latencyMs' | 'attempts'> {
  if (status < 200 || status >= 300) {
    throw new ProviderError('gemini', status, attempts, errorExcerpt(json, secrets) || `HTTP ${status}`);
  }

  const body = (json ?? {}) as GeminiResponse;
  const candidate = body.candidates?.[0];
  const usage = body.usageMetadata;
  const tokens = {
    prompt: count(usage?.promptTokenCount),
    completion: count(usage?.candidatesTokenCount) + count(usage?.thoughtsTokenCount),
  };

  const texts = (candidate?.content?.parts ?? [])
    .filter((part) => typeof part.text === 'string' && part.thought !== true)
    .map((part) => part.text!);
  const text = texts.join('');

  if (TRUNCATING_FINISHES.has(candidate?.finishReason ?? '') || text.length === 0) {
    return { text: null, anomaly: 'invalid_json', tokens };
  }
  return { text, anomaly: null, tokens };
}

export function createGeminiAdapter({ apiKey, modelId, params, deps = DEFAULT_DEPS }: AdapterOptions): ProviderAdapter {
  let calls = 0;
  return {
    provider: 'gemini',
    modelId,
    async act(request) {
      const index = calls++;
      const headers = { 'x-goog-api-key': apiKey };
      const body = compileGeminiRequest(request, { modelId, params });
      const result = await postJson('gemini', geminiEndpoint(modelId), headers, body, deps);
      const decoded = decodeGeminiResponse(result.status, result.json, {
        callIndex: index,
        secrets: [apiKey],
        attempts: result.attempts,
      });
      return { ...decoded, latencyMs: result.latencyMs, attempts: result.attempts };
    },
  };
}
