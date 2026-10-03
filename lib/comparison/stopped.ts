import type { Provider } from '@/lib/schema/run';
import { ESCAPE_TIME_NOTE, formatCost, LIMITATION, type ComparisonData, type ComparisonRow } from './comparison';

/**
 * The results of a race a provider stopped — the local race page only.
 *
 * A duel whose provider dies produces no `Run` (`lib/harness/duel.ts`): it says
 * nothing about either model, so it has no winner and cannot be published. But
 * the moves made up to that point were real, and the viewer has just watched
 * them. So the page shows the same table as a finished run — actions, puzzles,
 * failed and invalid attempts, tokens, cost — counted from the partial log, with
 * the variance slot saying plainly why there is no result.
 *
 * Every string is written here, from numbers; the one piece of provider text is
 * the already-redacted reason, which only the page's owner sees.
 */

export interface StoppedLane {
  readonly competitorId: string;
  readonly label: string;
  readonly provider: Provider;
  readonly actions: number;
  readonly puzzlesSolved: number;
  readonly failedAttempts: number;
  readonly invalidActions: number;
  readonly tokens: { readonly prompt: number; readonly completion: number };
  readonly costUsd: number;
}

export interface StoppedInput {
  /** In lane order. */
  readonly lanes: readonly StoppedLane[];
  readonly maxActions: number;
  readonly puzzleCount: number;
  /** The competitor whose provider failed; `null` when the race was cancelled. */
  readonly failedCompetitorId: string | null;
  /** The provider's HTTP status, when it sent one. */
  readonly status: number | null;
  /** Where the partial log was written, relative to the repo root. `null` on the hosted site, which keeps no files. */
  readonly savedTo: string | null;
}

const NUMBER = new Intl.NumberFormat('en-US');

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const PROVIDER_NAMES: Readonly<Record<Provider, string>> = {
  groq: 'Groq',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
};

function whatHappened(provider: string, status: number | null): string {
  if (status === 429) return `${provider} refused further requests: the free-tier rate or quota limit for this model was reached`;
  if (status !== null && status >= 500) return `${provider} kept failing on its side (HTTP ${status})`;
  if (status !== null) return `${provider} refused a request (HTTP ${status})`;
  return `${provider} could not be reached`;
}

export function buildStoppedComparison({
  lanes,
  maxActions,
  puzzleCount,
  failedCompetitorId,
  status,
  savedTo,
}: StoppedInput): ComparisonData {
  const failed = lanes.find((l) => l.competitorId === failedCompetitorId) ?? null;

  const rows = lanes.map(
    (lane): ComparisonRow => ({
      competitorId: lane.competitorId,
      label: lane.label,
      provider: lane.provider,
      escaped: false,
      isWinner: false,
      result:
        failed === null
          ? `Stopped after ${plural(lane.actions, 'action')}`
          : lane === failed
            ? `Provider error after ${plural(lane.actions, 'action')}`
            : `Stopped after ${plural(lane.actions, 'action')} with the other side`,
      escapeTime: '—',
      actions: `${lane.actions} / ${maxActions}`,
      puzzles: `${lane.puzzlesSolved} of ${puzzleCount}`,
      failedAttempts: lane.failedAttempts,
      invalidActions: lane.invalidActions,
      tokens: NUMBER.format(lane.tokens.prompt + lane.tokens.completion),
      tokensDetail: `${NUMBER.format(lane.tokens.prompt)} in · ${NUMBER.format(lane.tokens.completion)} out`,
      cost: formatCost(lane.costUsd),
    }),
  );

  const cause =
    failed === null
      ? 'The race was stopped before either model finished.'
      : `${whatHappened(PROVIDER_NAMES[failed.provider], status)} while ${failed.label} was playing.`;
  const advice =
    failed !== null && status === 429
      ? ' Pick another model — each model has its own free limit — or wait for the limit to reset, then race again.'
      : ' Race again, or pick another model.';

  return {
    rows,
    headline: failed === null ? 'Race stopped — no result' : `Race stopped early — ${failed.label}'s provider failed`,
    variance: {
      kind: 'stopped',
      title: 'Not a finished race',
      body:
        `${cause} A provider error says nothing about either model, so this race has no winner and cannot be ` +
        `published.${savedTo === null ? '' : ` The moves so far are saved in ${savedTo}.`}${advice}`,
    },
    limitation: LIMITATION,
    escapeTimeNote: ESCAPE_TIME_NOTE,
  };
}
