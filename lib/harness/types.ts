import type { ProviderAdapter } from '@/lib/providers';
import type { RoomSpec } from '@/lib/schema/room';
import type { Event } from '@/lib/schema/event';
import type { Competitor, EndReason } from '@/lib/schema/run';
import type { Budget } from '@/lib/sim';
import type { PriceTable } from './pricing';

/**
 * Shared shapes for the run harness — TICKET-6 (#7).
 *
 * ── The clock is injected, and only for ordering ───────────────────────────
 * `now` stamps `Event.at` and `Run.startedAt`, nothing else. Think-time is the
 * adapter's `latencyMs` — the successful attempt only — because a harness-side
 * delta would include rate-limit backoff and make the unlucky model look
 * hesitant. The script passes the real clock; tests pass a fixed one.
 */
export interface HarnessDeps {
  /** Epoch milliseconds. */
  readonly now: () => number;
}

/**
 * The golden run's budget (`fixtures/runs/canonical-run.json`). A default the
 * CLI overrides, not a value derived from the room — TICKET-7 (#8) may retune it
 * once the spike shows how many actions real models take.
 */
export const DEFAULT_BUDGET: Budget = { maxActions: 14, maxTokens: 60_000, maxWallClockMs: 300_000 };

/** One published run plus this many silent repeats of the same room. */
export const DEFAULT_REPEATS = 3;

export interface DuelOptions {
  readonly runId: string;
  readonly spec: RoomSpec;
  readonly competitors: readonly Competitor[];
  /** Keyed by `Competitor.id`. Built by the caller — the harness never reads a key. */
  readonly adapters: Readonly<Record<string, ProviderAdapter>>;
  /** Default `DEFAULT_BUDGET`. */
  readonly budget?: Budget;
  readonly deps: HarnessDeps;
  /**
   * Called as each action is logged, with how the competitor's run ended when
   * this action ended it (`null` otherwise). For watching a run live — it sees
   * exactly what the log records, and a throw from it is swallowed so a watcher
   * can never change or break the run.
   */
  readonly onEvent?: EventObserver;
  /**
   * Default `PRICING`. The race page passes a table that adds the live listed
   * price of a paid pick, so its `costUsd` is real rather than an unpriced $0.
   */
  readonly prices?: PriceTable;
}

export type EventObserver = (event: Event, ended: EndReason | null) => void;
