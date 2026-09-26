import { parseRun } from '@/lib/schema/run';
import { DuelAbortedError, runDuel, type DuelResult } from './duel';
import { isTypical } from './typicality';
import { DEFAULT_REPEATS, type DuelOptions } from './types';

/**
 * A matchup: one published run plus its silent repeats — TICKET-6 (#7).
 *
 * `architecture.md` → Other calls · publication unit: the shareable URL is a
 * single run, and the same room is replayed headless a few times so the page can
 * say honestly whether the published outcome was typical. The first duel is the
 * hero; the repeats run after it on the same room, adapters and budget.
 *
 * ── Repeats run one after another ──────────────────────────────────────────
 * Inside a duel the two competitors race concurrently. Across repeats they do
 * not: running N duels at once would multiply the peak request rate by N on a
 * free tier, for no gain — repeats are never watched, so their timing is not a
 * fairness question.
 *
 * ── Failure is asymmetric ──────────────────────────────────────────────────
 * If the hero's provider dies, there is nothing to publish: `DuelAbortedError`
 * propagates and no repeat runs. If a repeat's provider dies, that repeat is
 * dropped and recorded, and typicality is judged on the ones that finished —
 * `null` if none did.
 */

export interface MatchupOptions extends Omit<DuelOptions, 'runId'> {
  /** The hero's run id. Repeats are `<runId>-r1`, `<runId>-r2`, … */
  readonly runId: string;
  /** Default `DEFAULT_REPEATS`. `0` publishes with `typicalOfRepeats: null`. */
  readonly repeats?: number;
  /** Counts and ids only — never room content. */
  readonly onProgress?: (message: string) => void;
  /**
   * The main run, the moment it ends — before any repeat starts — so a watcher
   * can show its result without waiting on the silent repeats. Its
   * `typicalOfRepeats` is still `null`: the repeats have not run yet.
   */
  readonly onHero?: (hero: DuelResult) => void;
}

export interface DroppedRepeat {
  readonly runId: string;
  /** The (already redacted) provider error message. */
  readonly reason: string;
  readonly providerCalls: number;
}

export interface MatchupResult {
  /** `hero.run.typicalOfRepeats` is set from `repeats`. */
  readonly hero: DuelResult;
  readonly repeats: readonly DuelResult[];
  readonly dropped: readonly DroppedRepeat[];
  /** Every real provider call the matchup made, dropped repeats included. */
  readonly providerCalls: number;
}

function callsOf(result: DuelResult): number {
  return Object.values(result.providerCalls).reduce((total, n) => total + n, 0);
}

export async function runMatchup(options: MatchupOptions): Promise<MatchupResult> {
  const { runId, repeats: repeatCount = DEFAULT_REPEATS, onProgress, onHero, ...duel } = options;
  if (!Number.isInteger(repeatCount) || repeatCount < 0) {
    throw new RangeError(`runMatchup: repeats must be a non-negative integer, received ${repeatCount}`);
  }

  onProgress?.(`hero ${runId}`);
  const hero = await runDuel({ ...duel, runId });
  onHero?.(hero);
  let providerCalls = callsOf(hero);

  const repeats: DuelResult[] = [];
  const dropped: DroppedRepeat[] = [];
  for (let index = 1; index <= repeatCount; index++) {
    const repeatId = `${runId}-r${index}`;
    onProgress?.(`repeat ${index}/${repeatCount} ${repeatId}`);
    try {
      const result = await runDuel({ ...duel, runId: repeatId });
      repeats.push(result);
      providerCalls += callsOf(result);
    } catch (error) {
      if (!(error instanceof DuelAbortedError)) throw error;
      dropped.push({ runId: repeatId, reason: error.message, providerCalls: error.providerCalls });
      providerCalls += error.providerCalls;
      onProgress?.(`repeat ${repeatId} dropped: provider failure`);
    }
  }

  const typicalOfRepeats = isTypical(hero.run, repeats.map((r) => r.run));
  return {
    hero: { ...hero, run: parseRun({ ...hero.run, typicalOfRepeats }) },
    repeats,
    dropped,
    providerCalls,
  };
}
