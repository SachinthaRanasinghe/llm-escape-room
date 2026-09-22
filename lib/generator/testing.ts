import type { GenerationClient, JsonCompletion, JsonRequest } from '@/lib/providers';
import type { RoomSpec } from '@/lib/schema/room';

/**
 * Test support for the generator — a scripted generation client, and a way to
 * turn a known room into what a model would have sent.
 *
 * Deliberately NOT exported from `index.ts`, like `lib/providers/testing.ts`:
 * nothing on a real generation path should be able to swap its model for a
 * script.
 */

/** A `RoomSpec` as a model would propose it: no stamped fields, flattened estimate and order. */
export function proposalFromSpec(spec: RoomSpec): Record<string, unknown> {
  return {
    theme: spec.theme,
    objects: spec.objects,
    puzzles: spec.puzzles,
    exit: spec.exit,
    estimatedActions: spec.difficulty.estimatedActions,
    solutionOrder: spec.solution.order,
  };
}

export type ScriptedCompletion = string | { readonly anomaly: 'invalid_json' } | Error;

/** Chosen not to collide with any four-digit answer a test might search a record for. */
export const STUB_TOKENS = { prompt: 1000, completion: 500 } as const;
export const STUB_LATENCY_MS = 250;

export function scriptedGenerationClient(
  script: readonly ScriptedCompletion[],
  identity: Pick<GenerationClient, 'provider' | 'modelId'> = { provider: 'groq', modelId: 'stub-model' },
): { client: GenerationClient; requests: JsonRequest[] } {
  const queue = [...script];
  const requests: JsonRequest[] = [];
  const client: GenerationClient = {
    ...identity,
    async complete(request): Promise<JsonCompletion> {
      requests.push(request);
      const next = queue.shift();
      if (next === undefined) throw new Error('scriptedGenerationClient: no scripted response left');
      if (next instanceof Error) throw next;
      const base = { tokens: { ...STUB_TOKENS }, latencyMs: STUB_LATENCY_MS, attempts: 1 };
      if (typeof next === 'string') return { ...base, text: next, anomaly: null };
      return { ...base, text: null, anomaly: next.anomaly };
    },
  };
  return { client, requests };
}
