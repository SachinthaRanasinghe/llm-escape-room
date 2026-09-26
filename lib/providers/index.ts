import type { Competitor } from '@/lib/schema/run';
import { createGroqAdapter } from './groq';
import { createGeminiAdapter } from './gemini';
import { createOpenRouterAdapter } from './openrouter';
import type { AdapterOptions, ProviderAdapter } from './types';

/**
 * The provider adapters — TICKET-4 (#4).
 *
 * What #7 (the run harness) and #6 (the generator) import. One call per turn:
 *
 *   const adapter = createAdapter(competitor, readProviderKey(competitor.provider));
 *   const turn = await adapter.act({ system, transcript });
 *   const { verdict } = sim.apply(turn.rawAction, { tokens: turn.tokens, elapsedMs: turn.latencyMs });
 *
 * The generator (#6) uses a sibling, not an adapter — one JSON document per call:
 *
 *   const client = createGenerationClient(model, readProviderKey(model.provider));
 *   const { text, anomaly, tokens, attempts } = await client.complete({ system, prompt });
 *
 * `turn.rawAction` is handed over unexamined. A model's bad output is the
 * simulator's to score, as `malformed`, and it costs a turn. `act` throws only
 * `ProviderError`, and only when the transport gives up or the provider refuses
 * the request itself.
 *
 * ── What is deliberately NOT exported ──────────────────────────────────────
 * `postJson`. A caller holding raw transport could post a request with
 * `tool_choice: "auto"`, which is the fairness setting, and nothing would
 * notice. Every request goes through an adapter's `compile*Request`, and
 * `equivalence.test.ts` pins what those send.
 *
 * The `compile*` / `normalise*` / `decode*` internals. They exist to be proved
 * equivalent, not to be called piecemeal by the harness.
 *
 * `testing.ts`. Test support, like `lib/solver/fuzz.ts`.
 */

export function createAdapter(
  competitor: Pick<Competitor, 'provider' | 'modelId' | 'params'>,
  apiKey: string,
  deps?: AdapterOptions['deps'],
): ProviderAdapter {
  const options: AdapterOptions = { apiKey, modelId: competitor.modelId, params: competitor.params, deps };
  switch (competitor.provider) {
    case 'groq':
      return createGroqAdapter(options);
    case 'gemini':
      return createGeminiAdapter(options);
    case 'openrouter':
      return createOpenRouterAdapter(options);
    default: {
      const unreachable: never = competitor.provider;
      throw new Error(`no adapter for provider ${String(unreachable)}`);
    }
  }
}

export { createGenerationClient } from './generation';
export { DEFAULT_DEPS, DEFAULT_RETRY } from './transport';
export type { RetryPolicy, TransportDeps } from './transport';
export { createGroqAdapter } from './groq';
export { createGeminiAdapter } from './gemini';
export { createOpenRouterAdapter } from './openrouter';
export { listModels, CATALOGUE_EXCLUSIONS, PAID_MODELS } from './catalogue';
export type { CatalogueExclusion, CatalogueListing, CatalogueModel, ExcludedModel, ModelPrice } from './catalogue';
export { hasProviderKey, isLocalRaceEnabled, readProviderKey, PROVIDER_KEY_VARS } from './env';
export { buildPortableSpec } from './vocabulary';
export type { PortableSpec, PortableTool, PortableParam } from './vocabulary';
export { findSpecDrift } from './equivalence';
export type { Drift } from './equivalence';
export { TURN_ANOMALIES, ProviderError } from './types';
export type {
  AdapterOptions,
  GenerationClient,
  JsonCompletion,
  JsonRequest,
  ProviderAdapter,
  ProviderTurn,
  ToolCall,
  TranscriptEntry,
  TurnAnomaly,
  TurnRequest,
} from './types';
