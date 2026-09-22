import type { EndReason, Run } from '@/lib/schema/run';

/**
 * The run budget — actions, tokens and wall clock — as a ledger the facade
 * charges once per action.
 *
 * ── Exhaustion is an outcome, not an exception ─────────────────────────────
 * `lib/schema/run.ts` is explicit and `architecture.md` agrees: a run that runs
 * out of actions is a FAILURE TO ESCAPE, which is a real result the PRD counts.
 * So `chargeLedger` returns a reason and never throws. Only the facade decides
 * the run is over, and it records that decision in `RunSummary.endedBecause`.
 *
 * ── The simulator does not read the clock ──────────────────────────────────
 * There is no `Date.now()` here and there must never be one. Elapsed time is
 * REPORTED by the harness as `cost.elapsedMs`, because the thing being budgeted
 * is how long the model took to think — not how long this process happened to
 * spend. Reading the clock here would make a replay of a committed log produce
 * different results on a different machine, and would let a slow morning end a
 * run that a fast one would have finished.
 */
export type Budget = Run['budget'];

/** What one action cost, as observed by the harness that made the provider call. */
export interface ActionCost {
  readonly tokens: { readonly prompt: number; readonly completion: number };
  readonly elapsedMs: number;
}

export interface Ledger {
  readonly budget: Budget;
  readonly actions: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly elapsedMs: number;
}

export const NO_COST: ActionCost = { tokens: { prompt: 0, completion: 0 }, elapsedMs: 0 };

export function createLedger(budget: Budget): Ledger {
  return { budget, actions: 0, promptTokens: 0, completionTokens: 0, elapsedMs: 0 };
}

export function totalTokens(ledger: Ledger): number {
  return ledger.promptTokens + ledger.completionTokens;
}

/**
 * Charge one action and report whether that was the one that ended the run.
 *
 * ── Every action is charged, including the bad ones ────────────────────────
 * A malformed action, an illegal one and a wrong answer all cost a turn.
 * `architecture.md` decides this deliberately: using the interface correctly is
 * part of the task, and a model that could flail for free would be measured on a
 * different task than one that could not.
 *
 * ── Caps are checked in `END_REASONS` order ────────────────────────────────
 * Actions, then tokens, then wall clock. A run that trips two caps on the same
 * action must report the same reason every time it is replayed, so the order is
 * fixed rather than incidental — and it matches the order the reasons are
 * declared in, so the two cannot drift apart unnoticed.
 */
export function chargeLedger(ledger: Ledger, cost: ActionCost): { ledger: Ledger; exhausted: EndReason | null } {
  const next: Ledger = {
    budget: ledger.budget,
    actions: ledger.actions + 1,
    promptTokens: ledger.promptTokens + cost.tokens.prompt,
    completionTokens: ledger.completionTokens + cost.tokens.completion,
    elapsedMs: ledger.elapsedMs + cost.elapsedMs,
  };

  // `>=` rather than `>`: a budget of 14 actions means the 14th is the last one
  // taken, not the last one allowed before a 15th. The golden run ends model-b
  // at exactly its 14th action.
  if (next.actions >= next.budget.maxActions) {
    return { ledger: next, exhausted: 'budget_actions' };
  }
  if (totalTokens(next) >= next.budget.maxTokens) {
    return { ledger: next, exhausted: 'budget_tokens' };
  }
  if (next.elapsedMs >= next.budget.maxWallClockMs) {
    return { ledger: next, exhausted: 'budget_time' };
  }
  return { ledger: next, exhausted: null };
}

export function actionsRemaining(ledger: Ledger): number {
  return Math.max(0, ledger.budget.maxActions - ledger.actions);
}
