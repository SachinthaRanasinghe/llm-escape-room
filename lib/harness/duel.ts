import { findSeqBreaks, parseEventLog, type Event, type EventLog } from '@/lib/schema/event';
import { parseRun, type Run } from '@/lib/schema/run';
import { RUN_VERSION } from '@/lib/schema/version';
import { CompetitorAbortedError, runCompetitor, type CompetitorResult } from './competitor';
import { costOf } from './pricing';
import { DEFAULT_BUDGET, type DuelOptions } from './types';

/**
 * One run of the duel — TICKET-6 (#7). Both competitors, the same room, one log.
 *
 * ── Both race at once ──────────────────────────────────────────────────────
 * The competitors run concurrently, each against its own simulator. Running them
 * side by side gives both models the same network and the same time of day, which
 * matters because think-time is published. The merged log is ordered by when
 * each action resolved, as the golden log is (`scripts/generate-fixtures.mts`).
 *
 * ── A dead provider aborts the run; it does not end it ─────────────────────
 * Budget exhaustion is a result. A `ProviderError` is not — it says nothing about
 * either model — so there is no `EndReason` for it and no `Run` is produced.
 * `DuelAbortedError` carries the partial log so the quota already spent is still
 * visible. `Promise.allSettled` rather than `all`: with `all`, the survivor would
 * keep calling its provider after nobody was listening. The failing competitor
 * raises a shared flag instead, and the survivor stops at its next turn.
 */

export interface DuelResult {
  readonly run: Run;
  readonly events: EventLog;
  /** Real provider calls per competitor, retries included. */
  readonly providerCalls: Readonly<Record<string, number>>;
  /** Competitor ids whose model has no price — their `costUsd` is a $0 guess. */
  readonly unpriced: readonly string[];
}

export class DuelAbortedError extends Error {
  readonly runId: string;
  /** Every event that completed, from both competitors, in log order. */
  readonly events: readonly Event[];
  readonly providerCalls: number;

  constructor(runId: string, events: readonly Event[], providerCalls: number, cause: CompetitorAbortedError) {
    super(`${runId}: ${cause.message}`, { cause });
    this.name = new.target.name;
    this.runId = runId;
    this.events = events;
    this.providerCalls = providerCalls;
  }
}

/**
 * Ordered by resolution time, then competitor order, then `seq` — so the result
 * does not depend on which promise happened to settle first.
 */
export function mergeLog(events: readonly Event[], competitorOrder: readonly string[]): Event[] {
  const rank = new Map(competitorOrder.map((id, index) => [id, index]));
  return [...events].sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      (rank.get(a.competitorId) ?? 0) - (rank.get(b.competitorId) ?? 0) ||
      a.seq - b.seq,
  );
}

function validate({ competitors, adapters }: DuelOptions): void {
  if (competitors.length < 2) {
    throw new RangeError(`runDuel: a duel needs at least two competitors, received ${competitors.length}`);
  }
  const ids = competitors.map((c) => c.id);
  if (new Set(ids).size !== ids.length) {
    throw new RangeError(`runDuel: competitor ids must be unique, received ${ids.join(', ')}`);
  }
  for (const competitor of competitors) {
    const adapter = adapters[competitor.id];
    if (adapter === undefined) throw new RangeError(`runDuel: no adapter for competitor ${competitor.id}`);
    if (adapter.provider !== competitor.provider || adapter.modelId !== competitor.modelId) {
      // The run record would name one model while another played. Caught before any call.
      throw new RangeError(
        `runDuel: adapter for ${competitor.id} is ${adapter.provider}/${adapter.modelId}, competitor says ${competitor.provider}/${competitor.modelId}`,
      );
    }
  }
}

export async function runDuel(options: DuelOptions): Promise<DuelResult> {
  validate(options);
  const { runId, spec, competitors, adapters, deps, onEvent } = options;
  const budget = options.budget ?? DEFAULT_BUDGET;
  const order = competitors.map((c) => c.id);

  const startedAt = new Date(deps.now()).toISOString();
  let stop = false;

  const settled = await Promise.allSettled(
    competitors.map((competitor) =>
      runCompetitor({
        runId,
        spec,
        budget,
        competitor,
        adapter: adapters[competitor.id]!,
        deps,
        shouldStop: () => stop,
        onEvent,
      }).catch((error: unknown) => {
        stop = true;
        throw error;
      }),
    ),
  );

  const failures = settled.flatMap((s) => (s.status === 'rejected' ? [s.reason as unknown] : []));
  if (failures.length > 0) {
    const aborted = failures.find((f): f is CompetitorAbortedError => f instanceof CompetitorAbortedError);
    if (aborted === undefined || failures.some((f) => !(f instanceof CompetitorAbortedError))) {
      // A bug, not a provider. Surface the first one as it is.
      throw failures.find((f) => !(f instanceof CompetitorAbortedError)) ?? failures[0];
    }
    const partial: Event[] = [];
    let calls = 0;
    for (const s of settled) {
      const part = s.status === 'fulfilled' ? s.value : (s.reason as CompetitorAbortedError);
      partial.push(...part.events);
      calls += part.providerCalls;
    }
    throw new DuelAbortedError(runId, mergeLog(partial, order), calls, aborted);
  }

  const results = settled.map((s) => (s as PromiseFulfilledResult<CompetitorResult>).value);
  const events = parseEventLog(mergeLog(results.flatMap((r) => r.events), order));
  const breaks = findSeqBreaks(events);
  if (breaks.length > 0) {
    throw new Error(`runDuel: seq is not contiguous for ${breaks.join(', ')} — an action went unrecorded`);
  }

  const unpriced: string[] = [];
  const summaries = competitors.map((competitor, index) => {
    const summary = results[index]!.summary;
    if (summary === null) throw new Error(`runDuel: ${competitor.id} stopped without a provider failure`);
    const cost = costOf(competitor, summary.tokens, options.prices);
    if (!cost.priced) unpriced.push(competitor.id);
    return { ...summary, costUsd: cost.usd };
  });

  const run = parseRun({
    runVersion: RUN_VERSION,
    runId,
    roomId: spec.roomId,
    competitors,
    budget,
    startedAt,
    summaries,
    // Set by `runMatchup` once the repeats are in; a lone duel has nothing to compare against.
    typicalOfRepeats: null,
  });

  return {
    run,
    events,
    providerCalls: Object.fromEntries(results.map((r) => [r.competitorId, r.providerCalls])),
    unpriced,
  };
}
