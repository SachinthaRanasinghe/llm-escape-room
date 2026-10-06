import { describe, expect, it } from 'vitest';
import { ACTION_NAMES, ActionSchema, type Action } from '@/lib/schema/action';
import { loadCanonicalLog } from '@/fixtures';
import { compileGroqRequest, compileGroqTools, decodeGroqResponse, normaliseGroqTools } from './groq';
import { compileGeminiRequest, compileGeminiTools, decodeGeminiResponse, normaliseGeminiTools } from './gemini';
import { compileOpenRouterRequest, decodeOpenRouterResponse } from './openrouter';
import { buildPortableSpec, type PortableSpec } from './vocabulary';
import { findSpecDrift } from './equivalence';
import type { TurnRequest } from './types';
import { ANSWER_TOOLS, DECISION_TOOLS } from '@/lib/arena/tools';
import { ArenaActionSchema, ArenaAnswerSchema } from '@/lib/arena/schema';
import { geminiFunctionCallResponse, groqToolCallResponse } from './testing';

/**
 * THE EQUIVALENCE PROOF — TICKET-4's real deliverable.
 *
 * `architecture.md`: "An equivalence check proves the compiled tool specs are
 * genuinely the same task before any result is published … Without it the
 * fairness claim is an assertion."
 *
 * ── What "the same task" means precisely ───────────────────────────────────
 * Both models are handed the same tools, described in the same words, with the
 * same constraints, under the same forced tool-calling mode, framed by the same
 * text — AND whatever either one calls decodes to the same action. Tool specs
 * alone are half of it: two identical specs are still unfair if one provider's
 * decoder forgives a mistake the other's does not, or one transcript encoder
 * drops a verdict the other sends.
 *
 * ── How it is proved ───────────────────────────────────────────────────────
 * Each provider's compiled tools are normalised BACK into the portable spec and
 * compared three ways: source↔Groq, source↔Gemini, Groq↔Gemini. Comparing to
 * the source catches a compiler bug; comparing the two catches drift that both
 * sides of a round trip happen to agree on. A bug in `buildPortableSpec` itself
 * would pass all three, so the source is re-derived independently from the Zod
 * shapes below.
 *
 * ── When this test fires ───────────────────────────────────────────────────
 * The day someone rewords a description in one compiler, adds an `enum` to one
 * provider, or changes how one decoder treats a double call. That is the point.
 * Fix the drift; never loosen the assertion. If a positive control stops
 * producing drift, `findSpecDrift` is broken — fix that, not the control.
 *
 * "Fails the build" means `pnpm test`: this repo has no CI yet. Whatever CI is
 * added must run `pnpm test`, or this file protects nothing.
 */

const source = buildPortableSpec();
const groq = () => normaliseGroqTools(compileGroqTools(source));
const gemini = () => normaliseGeminiTools(compileGeminiTools(source));

function drift(a: PortableSpec, b: PortableSpec): string {
  return JSON.stringify(findSpecDrift(a, b), null, 1);
}

describe('the compiled tool specs describe the same task', () => {
  it('source ↔ Groq: zero drift', () => {
    expect(findSpecDrift(source, groq()), drift(source, groq())).toEqual([]);
  });

  it('source ↔ Gemini: zero drift', () => {
    expect(findSpecDrift(source, gemini()), drift(source, gemini())).toEqual([]);
  });

  it('Groq ↔ Gemini: zero drift', () => {
    expect(findSpecDrift(groq(), gemini()), drift(groq(), gemini())).toEqual([]);
  });

  it('the portable spec is faithful to ActionSchema — derived independently from the Zod shapes', () => {
    ActionSchema.options.forEach((member, index) => {
      const tool = source.tools[index]!;
      expect(tool.name).toBe(member.shape.name.value);
      for (const [key, field] of Object.entries(member.shape)) {
        if (key === 'name') continue;
        expect(tool.params, `${tool.name}.${key}`).toHaveProperty(key);
        expect(tool.required.includes(key), `${tool.name}.${key} required`).toBe(!field.safeParse(undefined).success);
      }
    });
  });
});

describe('the drift finder detects drift — positive controls', () => {
  type MutableGemini = ReturnType<typeof compileGeminiTools>;
  type MutableGroq = ReturnType<typeof compileGroqTools>;

  const mutations: { name: string; path: string; build: () => PortableSpec }[] = [
    {
      name: 'Gemini loses a maxLength',
      path: 'tools.use.params.intent.maxLength',
      build: () => {
        const tools: MutableGemini = compileGeminiTools(source);
        delete tools.functionDeclarations[4]!.parameters.properties.intent!.maxLength;
        return normaliseGeminiTools(tools);
      },
    },
    {
      name: 'Groq rewords a description by one word',
      path: 'tools.inspect.description',
      build: () => {
        const tools: MutableGroq = compileGroqTools(source);
        tools[1]!.function.description = tools[1]!.function.description.replace('closely', 'carefully');
        return normaliseGroqTools(tools);
      },
    },
    {
      name: 'Groq renames a parameter',
      path: 'tools.inspect.params.targetId',
      build: () => {
        const tools: MutableGroq = compileGroqTools(source);
        const props = tools[1]!.function.parameters.properties;
        props.target_id = props.targetId!;
        delete props.targetId;
        return normaliseGroqTools(tools);
      },
    },
    {
      name: 'Gemini drops a tool',
      path: 'tools.submit_answer',
      build: () => {
        const tools: MutableGemini = compileGeminiTools(source);
        tools.functionDeclarations.pop();
        return normaliseGeminiTools(tools);
      },
    },
    {
      name: 'Groq shortens required',
      path: 'tools.use.required',
      build: () => {
        const tools: MutableGroq = compileGroqTools(source);
        tools[4]!.function.parameters.required = ['itemId', 'intent'];
        return normaliseGroqTools(tools);
      },
    },
  ];

  for (const mutation of mutations) {
    it(`${mutation.name} → drift at ${mutation.path}`, () => {
      const found = findSpecDrift(source, mutation.build());
      expect(found.map((d) => d.path)).toContain(mutation.path);
    });
  }
});

/** Split an action into the tool it names and the arguments the model would send. */
function asCall(action: Action): { name: string; args: Record<string, unknown> } {
  const { name, ...args } = action;
  return { name, args };
}

describe('whatever a model calls decodes to the same action in both dialects', () => {
  const synthetic: Action[] = [
    { name: 'take', targetId: 'brass-key', intent: 'I will need this.' },
    { name: 'use', itemId: 'brass-key', targetId: 'cabinet', intent: 'The key looks cabinet-sized.' },
    { name: 'submit_answer', puzzleId: 'p3', answer: 'north', intent: 'The rose points north.' },
  ];
  const cases: Action[] = [...loadCanonicalLog().map((event) => event.action!), ...synthetic]; // golden log: no null actions;

  it('covers every verb in the vocabulary', () => {
    expect(new Set(cases.map((action) => action.name))).toEqual(new Set(ACTION_NAMES));
  });

  it('round-trips every golden-log action identically through Groq and Gemini', () => {
    for (const action of cases) {
      const { name, args } = asCall(action);
      const viaGroq = decodeGroqResponse(200, groqToolCallResponse([{ name, arguments: JSON.stringify(args) }]), {
        callIndex: 0,
      });
      const viaGemini = decodeGeminiResponse(200, geminiFunctionCallResponse([{ functionCall: { name, args } }]), {
        callIndex: 0,
      });
      expect(viaGroq.rawAction, `groq ${name}`).toEqual(action);
      expect(viaGemini.rawAction, `gemini ${name}`).toEqual(action);
      expect(viaGroq.anomaly).toBeNull();
      expect(viaGemini.anomaly).toBeNull();
    }
  });

  it('treats the same mistakes the same way', () => {
    const noCall = [
      decodeGroqResponse(200, groqToolCallResponse([], undefined, 'hmm'), { callIndex: 0 }),
      decodeGeminiResponse(200, geminiFunctionCallResponse([{ text: 'hmm' }]), { callIndex: 0 }),
    ];
    const twoCalls = [
      decodeGroqResponse(
        200,
        groqToolCallResponse([
          { name: 'look', arguments: '{"intent":"a"}' },
          { name: 'look', arguments: '{"intent":"b"}' },
        ]),
        { callIndex: 0 },
      ),
      decodeGeminiResponse(
        200,
        geminiFunctionCallResponse([
          { functionCall: { name: 'look', args: { intent: 'a' } } },
          { functionCall: { name: 'look', args: { intent: 'b' } } },
        ]),
        { callIndex: 0 },
      ),
    ];
    expect(noCall.map((t) => [t.anomaly, t.rawAction, t.text])).toEqual([
      ['no_tool_call', null, 'hmm'],
      ['no_tool_call', null, 'hmm'],
    ]);
    expect(twoCalls[0]!.anomaly).toBe('multiple_tool_calls');
    expect(twoCalls[0]!.rawAction).toEqual(twoCalls[1]!.rawAction);
  });
});

describe('both models are framed by the same text under the same mode', () => {
  const request: TurnRequest = {
    system: 'You are in a locked room. Escape.',
    transcript: [
      { kind: 'user', text: 'You see a writing desk and a studded door.' },
      { kind: 'tool_call', call: { callId: 'c1', toolName: 'inspect', args: { targetId: 'desk', intent: 'Read.' } } },
      { kind: 'tool_result', callId: 'c1', toolName: 'inspect', text: 'A ledger lies open.' },
      { kind: 'assistant_text', text: 'The ledger totals something.' },
      { kind: 'user', text: '12 actions remain.' },
    ],
  };
  const params = { temperature: 0.2, topP: null };

  /** Ordered human-readable text each model receives. */
  function groqTexts(body: Record<string, unknown>): string[] {
    return (body.messages as { content?: string | null }[]).flatMap((m) => (typeof m.content === 'string' ? [m.content] : []));
  }
  function geminiTexts(body: Record<string, unknown>): string[] {
    const system = (body.systemInstruction as { parts: { text: string }[] }).parts.map((p) => p.text);
    const rest = (body.contents as { parts: { text?: string; functionResponse?: { response: { result: string } } }[] }[]).flatMap(
      (c) => c.parts.flatMap((p) => (p.text !== undefined ? [p.text] : p.functionResponse ? [p.functionResponse.response.result] : [])),
    );
    return [...system, ...rest];
  }

  const groqBody = compileGroqRequest(request, { modelId: 'a', params });
  const geminiBody = compileGeminiRequest(request, { modelId: 'b', params });

  it('sends the identical sequence of system, observation, verdict and reply text', () => {
    expect(groqTexts(groqBody)).toEqual(geminiTexts(geminiBody));
    expect(groqTexts(groqBody)).toHaveLength(5);
  });

  it('forces a tool call on both', () => {
    expect(groqBody.tool_choice).toBe('required');
    expect((geminiBody.toolConfig as { functionCallingConfig: { mode: string } }).functionCallingConfig.mode).toBe('ANY');
  });

  it('sends the same sampling params to both, and omits the same ones', () => {
    expect(groqBody.temperature).toBe(0.2);
    expect(geminiBody.generationConfig).toEqual({ temperature: 0.2 });
    expect(groqBody).not.toHaveProperty('top_p');
  });

  it('compiles its tools from the same portable spec', () => {
    expect(findSpecDrift(normaliseGroqTools(groqBody.tools), normaliseGeminiTools((geminiBody.tools as unknown[])[0]))).toEqual([]);
  });
});

/**
 * OpenRouter shares Groq's dialect, so it inherits Groq's proof rather than
 * needing its own — PROVIDED it really sends what Groq sends. These pin that,
 * and then re-run the cross-dialect checks against Gemini through it.
 */
describe('OpenRouter is held to the same task', () => {
  const request: TurnRequest = {
    system: 'You are in a locked room. Escape.',
    transcript: [
      { kind: 'user', text: 'You see a writing desk and a studded door.' },
      { kind: 'tool_call', call: { callId: 'c1', toolName: 'inspect', args: { targetId: 'desk', intent: 'Read.' } } },
      { kind: 'tool_result', callId: 'c1', toolName: 'inspect', text: 'A ledger lies open.' },
    ],
  };
  const config = { modelId: 'x', params: { temperature: null, topP: null } };
  const body = compileOpenRouterRequest(request, config);

  it('source ↔ OpenRouter: zero drift', () => {
    expect(findSpecDrift(source, normaliseGroqTools(body.tools))).toEqual([]);
  });

  it('OpenRouter ↔ Gemini: zero drift, and the same forced mode', () => {
    const gemini = compileGeminiRequest(request, config);
    expect(findSpecDrift(normaliseGroqTools(body.tools), normaliseGeminiTools((gemini.tools as unknown[])[0]))).toEqual([]);
    expect(body.tool_choice).toBe('required');
    expect(body.parallel_tool_calls).toBe(false);
  });

  it('sends Groq\'s request and no key Groq does not send', () => {
    expect(Object.keys(body).sort()).toEqual(Object.keys(compileGroqRequest(request, config)).sort());
  });

  it('decodes every golden-log action the same as Gemini does', () => {
    for (const event of loadCanonicalLog()) {
      const { name, ...args } = event.action!;
      const viaOpenRouter = decodeOpenRouterResponse(200, groqToolCallResponse([{ name, arguments: JSON.stringify(args) }]), {
        callIndex: 0,
      });
      const viaGemini = decodeGeminiResponse(200, geminiFunctionCallResponse([{ functionCall: { name, args } }]), { callIndex: 0 });
      expect(viaOpenRouter.rawAction).toEqual(viaGemini.rawAction);
    }
  });
});

/**
 * The Energy Cores arena (`lib/arena/`) is a second game on the same adapters:
 * it passes its own tools on `TurnRequest.tools`. The same proof applies to both
 * of its tool sets — and a request that names no tools must still be the room.
 */
describe('the arena tool specs describe the same task', () => {
  const config = { modelId: 'x', params: { temperature: null, topP: null } };
  const transcript: TurnRequest['transcript'] = [{ kind: 'user', text: 'Round 1 of 10. You are player-a.' }];

  for (const [label, spec] of [['decision', DECISION_TOOLS], ['answer', ANSWER_TOOLS]] as const) {
    describe(label, () => {
      const request: TurnRequest = { system: 'Energy Cores.', transcript, tools: spec };
      const groqBody = compileGroqRequest(request, config);
      const geminiBody = compileGeminiRequest(request, config);
      const openRouterBody = compileOpenRouterRequest(request, config);
      const groqSpec = normaliseGroqTools(groqBody.tools);
      const geminiSpec = normaliseGeminiTools((geminiBody.tools as unknown[])[0]);

      it('source ↔ Groq, source ↔ Gemini, Groq ↔ Gemini: zero drift', () => {
        expect(findSpecDrift(spec, groqSpec)).toEqual([]);
        expect(findSpecDrift(spec, geminiSpec)).toEqual([]);
        expect(findSpecDrift(groqSpec, geminiSpec)).toEqual([]);
      });

      it('OpenRouter sends exactly what Groq sends', () => {
        expect(openRouterBody).toEqual(groqBody);
      });

      it('forces exactly one tool call on every provider', () => {
        expect(groqBody.tool_choice).toBe('required');
        expect(groqBody.parallel_tool_calls).toBe(false);
        expect((geminiBody.toolConfig as { functionCallingConfig: { mode: string } }).functionCallingConfig.mode).toBe('ANY');
      });

      it('offers only this phase\'s tools — never the room\'s', () => {
        const names = spec.tools.map((t) => t.name);
        expect(groqSpec.tools.map((t) => t.name)).toEqual(names);
        for (const name of names) expect(source.tools.map((t) => t.name)).not.toContain(name);
      });
    });
  }

  it('derives its params from the arena schemas, as the room\'s spec derives from ActionSchema', () => {
    expect(DECISION_TOOLS.tools.map((t) => t.name)).toEqual(ArenaActionSchema.options.map((o) => o.shape.name.value));
    expect(ANSWER_TOOLS.tools.map((t) => t.name)).toEqual(ArenaAnswerSchema.options.map((o) => o.shape.name.value));
    const steal = DECISION_TOOLS.tools.find((t) => t.name === 'steal')!;
    expect([...steal.required].sort()).toEqual(['intent', 'targetId']);
    const answer = ANSWER_TOOLS.tools[0]!;
    expect(answer.params.answer!.maxLength).toBe(200);
  });

  it('a request that names no tools is still the escape room', () => {
    const request: TurnRequest = { system: 'Room.', transcript };
    expect(findSpecDrift(source, normaliseGroqTools(compileGroqRequest(request, config).tools))).toEqual([]);
    expect(findSpecDrift(source, normaliseGeminiTools((compileGeminiRequest(request, config).tools as unknown[])[0]))).toEqual([]);
  });
});
