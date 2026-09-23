import type { Competitor, Provider } from '@/lib/schema/run';

/**
 * What a run cost — TICKET-6 (#7). The one `RunSummary` field the simulator
 * leaves to the harness, because it does not know what a token costs.
 *
 * Every model below is on a free tier, so every price is zero. The table exists
 * anyway because `lib/schema/run.ts` keeps `costUsd` as a guardrail: a run that
 * quietly starts costing money is a result worth seeing, and seeing it needs a
 * real price the day a paid model is added.
 *
 * ── An unknown model is $0, and says so ────────────────────────────────────
 * Zero for a model nobody priced is a GUESS. `priced: false` carries that out to
 * the caller, and the CLI prints it as a warning rather than publishing a
 * confident number it made up.
 */

export interface Price {
  /** USD per million prompt tokens. */
  readonly promptPerMTok: number;
  /** USD per million completion tokens. */
  readonly completionPerMTok: number;
}

export type PriceTable = Readonly<Record<Provider, Readonly<Record<string, Price>>>>;

const FREE: Price = { promptPerMTok: 0, completionPerMTok: 0 };

export const PRICING: PriceTable = {
  groq: { 'llama-3.3-70b-versatile': FREE, 'llama-3.1-8b-instant': FREE },
  gemini: { 'gemini-flash-latest': FREE },
};

export function costOf(
  competitor: Pick<Competitor, 'provider' | 'modelId'>,
  tokens: { readonly prompt: number; readonly completion: number },
  table: PriceTable = PRICING,
): { usd: number; priced: boolean } {
  const price = table[competitor.provider][competitor.modelId];
  if (price === undefined) return { usd: 0, priced: false };
  const usd = (tokens.prompt * price.promptPerMTok + tokens.completion * price.completionPerMTok) / 1_000_000;
  // Six places keeps float noise out of published JSON; a millionth of a dollar is below anything worth reporting.
  return { usd: Math.max(0, Math.round(usd * 1e6) / 1e6), priced: true };
}
