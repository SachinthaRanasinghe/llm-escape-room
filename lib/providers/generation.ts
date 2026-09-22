import type { Competitor } from '@/lib/schema/run';
import { GROQ_ENDPOINT, compileGroqJsonRequest, decodeGroqJsonResponse } from './groq';
import { compileGeminiJsonRequest, decodeGeminiJsonResponse, geminiEndpoint } from './gemini';
import { DEFAULT_DEPS, postJson, type TransportDeps } from './transport';
import type { GenerationClient } from './types';

/**
 * The generation client — TICKET-5 (#6).
 *
 * One JSON document out of one prompt, for the room generator. It shares the
 * transport — retries, success-only timing, redaction — and nothing else with
 * the competitor adapters.
 *
 * ── A sibling of the adapter, not a mode of it ─────────────────────────────
 * `act()` is worth something because both competitors' requests are pinned by
 * `equivalence.test.ts`: forced tool calling, the same tools, the same words. A
 * `mode: 'json'` flag on the adapter would put a tool-free, unforced request one
 * boolean away from a competitor call, and nothing would notice a harness
 * passing it. A separate factory with a separate return type — `JsonCompletion`
 * has no `rawAction` — cannot be handed to the simulator by mistake, because it
 * does not type-check.
 *
 * There is no equivalence check here on purpose: only one model ever sees a
 * generation prompt, so there is no second translation to drift from it.
 *
 * ── Endpoints are imported, never written ──────────────────────────────────
 * `secrets.test.ts` asserts the provider hosts are named only in the two
 * adapter files. This one takes them from there.
 */
export function createGenerationClient(
  model: Pick<Competitor, 'provider' | 'modelId' | 'params'>,
  apiKey: string,
  deps: TransportDeps = DEFAULT_DEPS,
): GenerationClient {
  const config = { modelId: model.modelId, params: model.params };
  const secrets = [apiKey];

  switch (model.provider) {
    case 'groq':
      return {
        provider: 'groq',
        modelId: model.modelId,
        async complete(request) {
          const headers = { authorization: `Bearer ${apiKey}` };
          const result = await postJson('groq', GROQ_ENDPOINT, headers, compileGroqJsonRequest(request, config), deps);
          const decoded = decodeGroqJsonResponse(result.status, result.json, { secrets, attempts: result.attempts });
          return { ...decoded, latencyMs: result.latencyMs, attempts: result.attempts };
        },
      };
    case 'gemini':
      return {
        provider: 'gemini',
        modelId: model.modelId,
        async complete(request) {
          const headers = { 'x-goog-api-key': apiKey };
          const body = compileGeminiJsonRequest(request, config);
          const result = await postJson('gemini', geminiEndpoint(model.modelId), headers, body, deps);
          const decoded = decodeGeminiJsonResponse(result.status, result.json, { secrets, attempts: result.attempts });
          return { ...decoded, latencyMs: result.latencyMs, attempts: result.attempts };
        },
      };
    default: {
      const unreachable: never = model.provider;
      throw new Error(`no generation client for provider ${String(unreachable)}`);
    }
  }
}
