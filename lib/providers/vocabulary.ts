import { z } from 'zod';
import { ActionSchema, ACTION_NAMES, type ActionName } from '@/lib/schema/action';

/**
 * The portable spec — the one neutral form both providers' tools are compiled
 * from and normalised back to.
 *
 * `ActionSchema` is the source of truth, but no model reads Zod. This module
 * derives, once, the provider-independent description of the seven tools: their
 * names (the verbs), their words, and their parameter constraints. `groq.ts` and
 * `gemini.ts` each compile it into their own dialect AND invert that dialect back
 * into this form, which is what lets `equivalence.test.ts` prove fairness with a
 * deep-equal rather than trust a third, hand-written mapping between two
 * dialects.
 *
 * ── One source of words ────────────────────────────────────────────────────
 * The descriptions below are the prompt a model reads to learn what it can do.
 * They live here and only here, keyed by verb, so neither provider can be given
 * a different sentence. They are deliberately NOT `.describe()` calls on
 * `ActionSchema`: that schema is the wave-2 contract four tickets build against,
 * and descriptions are prompt-layer, not schema-layer.
 *
 * ── Why no additionalProperties ────────────────────────────────────────────
 * The portable subset is exactly what Gemini's `Schema` object can express:
 * type, description, minLength, maxLength, required. Gemini has no
 * `additionalProperties`, so it is dropped for BOTH providers rather than sent to
 * one — a constraint only one model is told about is a different task. The rule
 * still holds: every member of `ActionSchema` is a `strictObject`, and the
 * simulator parses every raw action with it, so an extra key is a `malformed`
 * verdict whichever model sent it.
 */

export interface PortableParam {
  readonly type: 'string';
  readonly description: string;
  readonly minLength: number | null;
  readonly maxLength: number | null;
}

export interface PortableTool {
  readonly name: ActionName;
  readonly description: string;
  readonly params: Readonly<Record<string, PortableParam>>;
  readonly required: readonly string[];
}

export interface PortableSpec {
  /** Ordered as `ACTION_NAMES`. */
  readonly tools: readonly PortableTool[];
}

const INTENT_DESCRIPTION =
  'One short sentence, in your own words, saying why you are taking this action. Shown to viewers beside your character.';

/** A missing verb is a compile error — the mapped type is exhaustive over `ActionName`. */
export const TOOL_DESCRIPTIONS: {
  readonly [N in ActionName]: { readonly tool: string; readonly params: Readonly<Record<string, string>> };
} = {
  look: {
    tool: 'Survey the room. Returns the objects you can currently see and what you are carrying.',
    params: { intent: INTENT_DESCRIPTION },
  },
  inspect: {
    tool: 'Examine one object closely. This is how you read any writing or markings on it.',
    params: { targetId: 'The id of the object to examine.', intent: INTENT_DESCRIPTION },
  },
  take: {
    tool: 'Pick up a portable object and carry it.',
    params: { targetId: 'The id of the object to pick up.', intent: INTENT_DESCRIPTION },
  },
  open: {
    tool: 'Try to open a container or door. Fails if it is locked.',
    params: { targetId: 'The id of the container or door to open.', intent: INTENT_DESCRIPTION },
  },
  use: {
    tool: 'Apply an item you are carrying to an object, such as a key on a lock.',
    params: {
      itemId: 'The id of the item you are carrying.',
      targetId: 'The id of the object to use it on.',
      intent: INTENT_DESCRIPTION,
    },
  },
  enter_code: {
    tool: 'Type a code into a lock on an object.',
    params: {
      targetId: 'The id of the object whose lock you are typing into.',
      code: 'The code to enter.',
      intent: INTENT_DESCRIPTION,
    },
  },
  submit_answer: {
    tool: 'Answer a puzzle directly, without a lock to type it into.',
    params: {
      puzzleId: 'The id of the puzzle you are answering.',
      answer: 'Your answer.',
      intent: INTENT_DESCRIPTION,
    },
  },
};

interface JsonSchemaProperty {
  readonly type?: unknown;
  readonly minLength?: unknown;
  readonly maxLength?: unknown;
}

function deriveTool(member: (typeof ActionSchema.options)[number]): PortableTool {
  const name = member.shape.name.value as ActionName;
  const words = TOOL_DESCRIPTIONS[name];
  // `name` is the tool itself, not an argument of it. Dropped here rather than
  // with `.omit()`, which TypeScript cannot call across the union's members.
  const json = z.toJSONSchema(member) as {
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  const properties = Object.fromEntries(Object.entries(json.properties ?? {}).filter(([key]) => key !== 'name'));
  const required = (json.required ?? []).filter((key) => key !== 'name');

  const params: Record<string, PortableParam> = {};
  for (const [key, property] of Object.entries(properties)) {
    // Strings only, deliberately. A future non-string parameter is a decision —
    // can BOTH providers express it the same way? — not something to let
    // through by accident.
    if (property.type !== 'string') {
      throw new Error(`unsupported param type for ${name}.${key}: ${String(property.type)}`);
    }
    const description = words.params[key];
    if (description === undefined) {
      throw new Error(`no description for ${name}.${key}`);
    }
    params[key] = Object.freeze({
      type: 'string',
      description,
      minLength: typeof property.minLength === 'number' ? property.minLength : null,
      maxLength: typeof property.maxLength === 'number' ? property.maxLength : null,
    });
  }

  for (const key of Object.keys(words.params)) {
    if (!(key in params)) throw new Error(`description for ${name}.${key} names a parameter that does not exist`);
  }

  return Object.freeze({
    name,
    description: words.tool,
    params: Object.freeze(params),
    required: Object.freeze(required),
  });
}

let memo: PortableSpec | null = null;

/** Derived once from `ActionSchema` and frozen, so no caller can hand one provider an edited copy. */
export function buildPortableSpec(): PortableSpec {
  if (memo === null) {
    const tools = ActionSchema.options.map(deriveTool);
    const names = tools.map((tool) => tool.name);
    if (names.join() !== ACTION_NAMES.join()) {
      throw new Error(`tool order ${names.join()} does not match ACTION_NAMES`);
    }
    memo = Object.freeze({ tools: Object.freeze(tools) });
  }
  return memo;
}

/**
 * Rebuild the candidate action a tool call describes, for `Simulator.apply`.
 *
 * `name` is written LAST so an argument called `name` cannot override the tool
 * the model actually called. Anything that is not a plain object is wrapped
 * rather than dropped: `{ name, arguments }` fails the strict schema, so the
 * model is told its call was malformed instead of the call vanishing.
 */
export function toRawAction(toolName: string, args: unknown): unknown {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    return { ...(args as Record<string, unknown>), name: toolName };
  }
  return { name: toolName, arguments: args };
}
