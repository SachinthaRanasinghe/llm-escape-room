import type { Competitor } from '@/lib/schema/run';
import { buildPortableSpec, type PortableParam, type PortableSpec, type PortableTool } from './vocabulary';
import { DEFAULT_DEPS, errorExcerpt, postJson } from './transport';
import { count, rejectedTurn, syntheticCallId, turnFromCalls, type DecodeContext, type DecodedTurn } from './turn';
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
 * The Groq adapter — OpenAI-compatible chat completions with forced tool calls.
 *
 * Four pure functions and a thin facade, mirrored function-for-function in
 * `gemini.ts` so the two files diff cleanly:
 *
 *   compileGroqTools   PortableSpec → native tools
 *   normaliseGroqTools native tools → PortableSpec   (the inverse; equivalence.test.ts)
 *   compileGroqRequest TurnRequest  → request body
 *   decodeGroqResponse response     → ProviderTurn (minus timing)
 *
 * ── Fairness settings ──────────────────────────────────────────────────────
 * `tool_choice: "required"` and `parallel_tool_calls: false` are the Groq
 * spelling of what `gemini.ts` sends as `mode: "ANY"`: the model must act, once.
 * `equivalence.test.ts` checks the two stay in step.
 *
 * ── Arguments arrive as a JSON STRING ──────────────────────────────────────
 * Unlike Gemini's object. Parsed here and nowhere else; a string that is not
 * JSON is the model's mistake and becomes `unparseable_arguments`.
 */

export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
/** The live model list — read by `catalogue.ts`, which names no host itself. */
export const GROQ_MODELS_ENDPOINT = 'https://api.groq.com/openai/v1/models';

interface GroqParam {
  type: 'string';
  description: string;
  minLength?: number;
  maxLength?: number;
}

export interface GroqTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: { type: 'object'; properties: Record<string, GroqParam>; required: string[] };
  };
}

function compileParam(param: PortableParam): GroqParam {
  return {
    type: param.type,
    description: param.description,
    ...(param.minLength !== null ? { minLength: param.minLength } : {}),
    ...(param.maxLength !== null ? { maxLength: param.maxLength } : {}),
  };
}

export function compileGroqTools(spec: PortableSpec): GroqTool[] {
  return spec.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(tool.params).map(([key, p]) => [key, compileParam(p)])),
        required: [...tool.required],
      },
    },
  }));
}

/**
 * Throw on any key the compiler is not known to emit. If this ignored unknown
 * keys, someone could add an `enum` to the Groq compiler — a hint only one model
 * gets — and equivalence would still pass.
 */
function assertKeys(value: unknown, allowed: readonly string[], at: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`groq tools: expected an object at ${at}`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`groq tools: unexpected key ${at}.${key}`);
  }
  return value as Record<string, unknown>;
}

export function normaliseGroqTools(native: unknown): PortableSpec {
  if (!Array.isArray(native)) throw new Error('groq tools: expected an array');
  const tools = native.map((entry, index): PortableTool => {
    const outer = assertKeys(entry, ['type', 'function'], `[${index}]`);
    if (outer.type !== 'function') throw new Error(`groq tools: [${index}].type is ${String(outer.type)}`);
    const fn = assertKeys(outer.function, ['name', 'description', 'parameters'], `[${index}].function`);
    const name = String(fn.name);
    const parameters = assertKeys(fn.parameters, ['type', 'properties', 'required'], `${name}.parameters`);
    if (parameters.type !== 'object') throw new Error(`groq tools: ${name}.parameters.type is ${String(parameters.type)}`);
    const properties = parameters.properties;
    if (properties === null || typeof properties !== 'object') throw new Error(`groq tools: ${name}.properties missing`);

    const params: Record<string, PortableParam> = {};
    for (const [key, raw] of Object.entries(properties)) {
      const p = assertKeys(raw, ['type', 'description', 'minLength', 'maxLength'], `${name}.${key}`);
      if (p.type !== 'string') throw new Error(`groq tools: ${name}.${key}.type is ${String(p.type)}`);
      params[key] = {
        type: 'string',
        description: String(p.description),
        minLength: typeof p.minLength === 'number' ? p.minLength : null,
        maxLength: typeof p.maxLength === 'number' ? p.maxLength : null,
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

export interface GroqConfig {
  readonly modelId: string;
  readonly params: Competitor['params'];
}

export function compileGroqRequest(request: TurnRequest, config: GroqConfig): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [{ role: 'system', content: request.system }];
  for (const entry of request.transcript) {
    switch (entry.kind) {
      case 'user':
        messages.push({ role: 'user', content: entry.text });
        break;
      case 'assistant_text':
        messages.push({ role: 'assistant', content: entry.text });
        break;
      case 'tool_call':
        // `native` is Gemini's passthrough; a competitor never changes provider
        // mid-run, so there is nothing of Groq's to echo and it is ignored.
        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: entry.call.callId,
              type: 'function',
              function: {
                name: entry.call.toolName,
                arguments: typeof entry.call.args === 'string' ? entry.call.args : JSON.stringify(entry.call.args),
              },
            },
          ],
        });
        break;
      case 'tool_result':
        messages.push({ role: 'tool', tool_call_id: entry.callId, name: entry.toolName, content: entry.text });
        break;
    }
  }

  return {
    model: config.modelId,
    messages,
    tools: compileGroqTools(request.tools ?? buildPortableSpec()),
    tool_choice: 'required',
    parallel_tool_calls: false,
    // `null` means provider default — omitted, not sent as null.
    ...(config.params.temperature !== null ? { temperature: config.params.temperature } : {}),
    ...(config.params.topP !== null ? { top_p: config.params.topP } : {}),
  };
}

interface GroqResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: string; message?: string; failed_generation?: unknown };
}

/**
 * Groq attaches `failed_generation` to a 400 only when the MODEL's own output
 * could not be parsed — the payload is what the model wrote. `tool_use_failed`
 * is one code for that; gpt-oss produces another ("Parsing failed. The model
 * generated output that could not be parsed."), found in the first live
 * TICKET-7 (#8) duel, where treating it as a provider failure aborted the whole
 * run over one fumbled turn. Keyed on the field rather than on a list of codes,
 * so the next code Groq invents for the same failure is still a turn.
 *
 * The field's content is never read: it is untrusted model text.
 */
function modelGenerationFailed(error: GroqResponse['error']): boolean {
  return error !== undefined && Object.hasOwn(error, 'failed_generation');
}

/**
 * The OpenAI chat-completions dialect is shared: `openrouter.ts` compiles and
 * decodes through the functions in this file, so one tool spec and one decoder
 * serve both, and `equivalence.test.ts` has nothing new to drift. `provider`
 * only names who to blame in a `ProviderError`.
 */
export type OpenAiDialectProvider = 'groq' | 'openrouter';

export interface OpenAiDecodeContext extends DecodeContext {
  /** Default `groq`. */
  readonly provider?: OpenAiDialectProvider;
}

export function decodeGroqResponse(status: number, json: unknown, context: OpenAiDecodeContext): DecodedTurn {
  const { callIndex, secrets = [], attempts = 1, provider = 'groq' } = context;
  const body = (json ?? {}) as GroqResponse;

  if (status === 400 && (body.error?.code === 'tool_use_failed' || modelGenerationFailed(body.error))) {
    // Forced mode, and the model's output could not be read as a tool call.
    // The model's failure — a turn, not an exception.
    return rejectedTurn({ prompt: 0, completion: 0 }, null);
  }
  if (status < 200 || status >= 300) {
    throw new ProviderError(provider, status, attempts, errorExcerpt(json, secrets) || `HTTP ${status}`);
  }

  const message = body.choices?.[0]?.message ?? {};
  const tokens = { prompt: count(body.usage?.prompt_tokens), completion: count(body.usage?.completion_tokens) };
  const unparseable = new Set<ToolCall>();

  const calls = (message.tool_calls ?? []).map((raw, index): ToolCall => {
    const argumentsText = raw.function?.arguments ?? '';
    let args: unknown = argumentsText;
    let parsed = false;
    try {
      args = JSON.parse(argumentsText);
      parsed = true;
    } catch {
      args = argumentsText;
    }
    const call: ToolCall = {
      callId: raw.id ?? syntheticCallId(callIndex, index),
      toolName: raw.function?.name ?? '',
      args,
    };
    if (!parsed) unparseable.add(call);
    return call;
  });

  return turnFromCalls(calls, message.content ?? null, tokens, unparseable);
}

/* ── JSON mode, for the room generator — TICKET-5 (#6) ────────────────────
 * No tools and no tool_choice: the generator wants one document, not an action.
 * See `generation.ts` for why this is a sibling of the adapter, not a mode of it. */

export function compileGroqJsonRequest(request: JsonRequest, config: GroqConfig): Record<string, unknown> {
  return {
    model: config.modelId,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.prompt },
    ],
    response_format: { type: 'json_object' },
    ...(config.params.temperature !== null ? { temperature: config.params.temperature } : {}),
    ...(config.params.topP !== null ? { top_p: config.params.topP } : {}),
  };
}

export type DecodedJson = Omit<JsonCompletion, 'latencyMs' | 'attempts'>;

export function decodeGroqJsonResponse(
  status: number,
  json: unknown,
  { secrets = [], attempts = 1, provider = 'groq' }: Pick<OpenAiDecodeContext, 'secrets' | 'attempts' | 'provider'>,
): DecodedJson {
  const body = (json ?? {}) as GroqResponse;

  if (status === 400 && body.error?.code === 'json_validate_failed') {
    // The model wrote something that is not JSON. Its failure, so an attempt —
    // and `failed_generation` is deliberately dropped: untrusted text the
    // generator has no use for.
    return { text: null, anomaly: 'invalid_json', tokens: { prompt: 0, completion: 0 } };
  }
  if (status < 200 || status >= 300) {
    throw new ProviderError(provider, status, attempts, errorExcerpt(json, secrets) || `HTTP ${status}`);
  }

  const content = body.choices?.[0]?.message?.content;
  return {
    text: typeof content === 'string' && content.length > 0 ? content : null,
    anomaly: null,
    tokens: { prompt: count(body.usage?.prompt_tokens), completion: count(body.usage?.completion_tokens) },
  };
}

export function createGroqAdapter({ apiKey, modelId, params, deps = DEFAULT_DEPS }: AdapterOptions): ProviderAdapter {
  let calls = 0;
  return {
    provider: 'groq',
    modelId,
    async act(request) {
      const index = calls++;
      const headers = { authorization: `Bearer ${apiKey}` };
      const result = await postJson('groq', GROQ_ENDPOINT, headers, compileGroqRequest(request, { modelId, params }), deps);
      const decoded = decodeGroqResponse(result.status, result.json, {
        callIndex: index,
        secrets: [apiKey],
        attempts: result.attempts,
      });
      return { ...decoded, latencyMs: result.latencyMs, attempts: result.attempts };
    },
  };
}
