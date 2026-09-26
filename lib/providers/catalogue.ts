import type { Provider } from '@/lib/schema/run';
import { GEMINI_MODELS_ENDPOINT } from './gemini';
import { GROQ_MODELS_ENDPOINT } from './groq';
import { OPENROUTER_MODELS_ENDPOINT } from './openrouter';
import { DEFAULT_DEPS, getJson, type TransportDeps } from './transport';

/**
 * The model catalogue — which free models can play, read LIVE from each provider.
 *
 * A hard-coded list goes stale within weeks (Groq retired `llama-3.1-8b-instant`
 * mid-project), so the picker on `/race` is filled from each provider's own model
 * list, narrowed by rules that say what an escape-room competitor needs:
 *
 *   - it writes text (not speech, images, music or embeddings),
 *   - it can be FORCED to call a tool — the fairness setting every adapter sends,
 *   - it costs nothing on the provider's free tier — or it is a Claude model
 *     on OpenRouter, the one paid family the page offers, marked with its price.
 *
 * Providers do not all publish those facts. OpenRouter does (`pricing`,
 * `supported_parameters`), so its rule is exact. Groq and Gemini do not, so their
 * rules are name-based, and `CATALOGUE_EXCLUSIONS` records what a live probe
 * found a listing cannot show — a model still listed but retired for new
 * projects, or one whose free-tier limit is smaller than a single turn. Those come
 * back in `excluded` with the reason, so the page can say why a model is missing
 * instead of silently dropping it.
 *
 * Endpoints are imported from the adapter files: `secrets.test.ts` asserts the
 * hosts are named nowhere else.
 */

export interface CatalogueModel {
  readonly provider: Provider;
  readonly modelId: string;
  /** The provider's display name when it gives one, otherwise the id. */
  readonly label: string;
  readonly contextWindow: number | null;
  /** `null` for a free model. A paid model carries its live listed price, which `costUsd` is computed from. */
  readonly price: ModelPrice | null;
}

/** USD per million tokens — the same shape as the harness's `Price`. */
export interface ModelPrice {
  readonly promptPerMTok: number;
  readonly completionPerMTok: number;
}

/**
 * The paid models the race page may offer: Claude, which has no free tier
 * anywhere. Everything else paid stays out, so an OpenRouter key with credit on
 * it still cannot be pointed at an arbitrary paid model.
 */
export const PAID_MODELS: RegExp = /^anthropic\/claude-/;

export interface ExcludedModel {
  readonly provider: Provider;
  readonly modelId: string;
  readonly reason: string;
}

export interface CatalogueListing {
  readonly models: readonly CatalogueModel[];
  readonly excluded: readonly ExcludedModel[];
}

export interface CatalogueExclusion {
  readonly provider: Provider;
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Found by one forced tool call per model against a free-tier key (2026-09-25).
 * Revisit when a provider changes its free tier; an entry that no longer matches
 * anything costs nothing.
 */
export const CATALOGUE_EXCLUSIONS: readonly CatalogueExclusion[] = [
  {
    provider: 'groq',
    pattern: /^qwen\/qwen3\.8-27b$/,
    reason: 'Free tier allows 1,000 output tokens per minute, less than one turn',
  },
  {
    provider: 'groq',
    pattern: /safeguard/,
    reason: 'A safety-policy classifier, not a general chat model',
  },
  {
    provider: 'gemini',
    pattern: /^gemini-2\./,
    reason: 'Listed, but no longer served to new API projects',
  },
  {
    provider: 'gemini',
    pattern: /-pro(-|$)/,
    reason: 'No free-tier quota',
  },
  {
    provider: 'openrouter',
    pattern: /^openrouter\//,
    reason: 'A router that picks a different model per call — no fixed opponent',
  },
  {
    provider: 'openrouter',
    pattern: /^anthropic\/.*:batch$/,
    reason: 'A batch variant, which answers asynchronously rather than turn by turn',
  },
];

/** Models that are not chat models at all. Dropped quietly: nobody would pick them. */
const NOT_CHAT: Readonly<Record<Provider, RegExp>> = {
  groq: /whisper|orpheus|prompt-guard|tts|allam|playai|compound|distil/i,
  gemini: /image|tts|audio|live|lyria|transcribe|robotics|computer-use|embedding|aqa|banana|omni|customtools|deep-research|antigravity|learnlm/i,
  openrouter: /$^/,
};

/** Below this a transcript of fourteen turns does not fit. */
const MIN_CONTEXT = 8_192;

function exclusionFor(provider: Provider, modelId: string): string | null {
  return CATALOGUE_EXCLUSIONS.find((e) => e.provider === provider && e.pattern.test(modelId))?.reason ?? null;
}

function partition(provider: Provider, candidates: readonly CatalogueModel[]): CatalogueListing {
  const models: CatalogueModel[] = [];
  const excluded: ExcludedModel[] = [];
  for (const model of candidates) {
    const reason = exclusionFor(provider, model.modelId);
    if (reason === null) models.push(model);
    else excluded.push({ provider, modelId: model.modelId, reason });
  }
  const byId = (a: { modelId: string }, b: { modelId: string }) => a.modelId.localeCompare(b.modelId);
  return { models: models.sort(byId), excluded: excluded.sort(byId) };
}

function list(json: unknown, key: string): Record<string, unknown>[] {
  const value = (json as Record<string, unknown> | null)?.[key];
  return Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object') : [];
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `GET /openai/v1/models`: `{ data: [{ id, active, context_window }] }`. No capability flags, so the rule is by name. */
export function groqCatalogue(json: unknown): CatalogueListing {
  const candidates = list(json, 'data')
    .filter((m) => typeof m.id === 'string' && m.active !== false)
    .filter((m) => !NOT_CHAT.groq.test(String(m.id)))
    .filter((m) => (num(m.context_window) ?? MIN_CONTEXT) >= MIN_CONTEXT)
    .map((m) => ({ provider: 'groq' as const, modelId: String(m.id), label: String(m.id), contextWindow: num(m.context_window), price: null }));
  return partition('groq', candidates);
}

/** `GET /v1beta/models`: `{ models: [{ name: 'models/<id>', displayName, inputTokenLimit, supportedGenerationMethods }] }`. */
export function geminiCatalogue(json: unknown): CatalogueListing {
  const candidates = list(json, 'models')
    .filter((m) => typeof m.name === 'string' && String(m.name).startsWith('models/'))
    .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => ({
      provider: 'gemini' as const,
      modelId: String(m.name).slice('models/'.length),
      label: typeof m.displayName === 'string' ? m.displayName : String(m.name).slice('models/'.length),
      contextWindow: num(m.inputTokenLimit),
      price: null,
    }))
    .filter((m) => /^(gemini|gemma)-/.test(m.modelId) && !NOT_CHAT.gemini.test(m.modelId));
  return partition('gemini', candidates);
}

function isZero(value: unknown): boolean {
  return (typeof value === 'string' || typeof value === 'number') && Number(value) === 0;
}

function paidPrice(pricing: Record<string, unknown>): ModelPrice | null {
  return isZero(pricing.prompt) && isZero(pricing.completion) ? null : perMTok(pricing);
}

/** OpenRouter prices per token, as strings; `null` when either is missing or not a number. */
function perMTok(pricing: Record<string, unknown>): ModelPrice | null {
  const prompt = Number(pricing.prompt);
  const completion = Number(pricing.completion);
  if (pricing.prompt === undefined || pricing.completion === undefined || !Number.isFinite(prompt) || !Number.isFinite(completion)) return null;
  // Rounded so '0.000003' reads as 3, not 2.9999999999999997.
  return { promptPerMTok: Math.round(prompt * 1e12) / 1e6, completionPerMTok: Math.round(completion * 1e12) / 1e6 };
}

/**
 * `GET /api/v1/models`: the one listing that states price and tool support, so
 * the rule is exact — zero prompt AND completion price (or a `PAID_MODELS` id
 * with a stated price), `tools` and `tool_choice` both supported, text out and
 * nothing else.
 */
export function openRouterCatalogue(json: unknown): CatalogueListing {
  const candidates = list(json, 'data')
    .filter((m) => typeof m.id === 'string')
    .filter((m) => {
      const pricing = (m.pricing ?? {}) as Record<string, unknown>;
      if (isZero(pricing.prompt) && isZero(pricing.completion)) return true;
      return PAID_MODELS.test(String(m.id)) && perMTok(pricing) !== null;
    })
    .filter((m) => {
      const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : [];
      return params.includes('tools') && params.includes('tool_choice');
    })
    .filter((m) => {
      const out = ((m.architecture ?? {}) as Record<string, unknown>).output_modalities;
      return !Array.isArray(out) || (out.length === 1 && out[0] === 'text');
    })
    .map((m) => ({
      provider: 'openrouter' as const,
      modelId: String(m.id),
      label: typeof m.name === 'string' ? m.name : String(m.id),
      contextWindow: num(m.context_length),
      price: paidPrice((m.pricing ?? {}) as Record<string, unknown>),
    }))
    .filter((m) => (m.contextWindow ?? MIN_CONTEXT) >= MIN_CONTEXT);
  return partition('openrouter', candidates);
}

/**
 * One provider's live listing. Groq and Gemini need the key to list; OpenRouter's
 * list is public, so `apiKey` may be `null` there — the page can show its models
 * even before a key is set. Throws `ProviderError` when the listing fails.
 */
export async function listModels(
  provider: Provider,
  apiKey: string | null,
  deps: Pick<TransportDeps, 'fetch'> = DEFAULT_DEPS,
): Promise<CatalogueListing> {
  switch (provider) {
    case 'groq': {
      const { json } = await getJson('groq', GROQ_MODELS_ENDPOINT, { authorization: `Bearer ${apiKey ?? ''}` }, deps);
      return groqCatalogue(json);
    }
    case 'gemini': {
      const { json } = await getJson('gemini', GEMINI_MODELS_ENDPOINT, { 'x-goog-api-key': apiKey ?? '' }, deps);
      return geminiCatalogue(json);
    }
    case 'openrouter': {
      const { json } = await getJson('openrouter', OPENROUTER_MODELS_ENDPOINT, {}, deps);
      return openRouterCatalogue(json);
    }
    default: {
      const unreachable: never = provider;
      throw new Error(`no catalogue for provider ${String(unreachable)}`);
    }
  }
}
