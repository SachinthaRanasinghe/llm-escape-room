import type { CatalogueEntry, ModelPick } from '@/lib/race/wire';

/**
 * How a model pick travels through a `<select>` — shared by the race and the
 * arena pages. A pick is `<provider>|<modelId>`: model ids hold `/` and `:`,
 * never `|`.
 */

const PICK_SEPARATOR = '|';

export function encodePick(pick: ModelPick): string {
  return `${pick.provider}${PICK_SEPARATOR}${pick.modelId}`;
}

export function decodePick(value: string): ModelPick | null {
  const at = value.indexOf(PICK_SEPARATOR);
  if (at < 1) return null;
  return { provider: value.slice(0, at) as ModelPick['provider'], modelId: value.slice(at + 1) };
}

export function usd(perMTok: number): string {
  return `$${Number(perMTok.toFixed(2))}`;
}

/** e.g. "$3 in / $15 out per million tokens". */
export function priceLabel(price: NonNullable<CatalogueEntry['price']>): string {
  return `${usd(price.promptPerMTok)} in / ${usd(price.completionPerMTok)} out per million tokens`;
}
