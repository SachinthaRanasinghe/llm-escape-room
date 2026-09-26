/**
 * The headless run harness — TICKET-6 (#7).
 *
 * What `scripts/run.mts` and the gate spike (#8) import. The caller builds the
 * adapters — the harness never reads a key — and supplies a clock:
 *
 *   const adapters = { 'model-a': createAdapter(a, readProviderKey(a.provider)), … };
 *   const { hero, repeats, dropped } = await runMatchup({
 *     runId, spec, competitors: [a, b], adapters, repeats: 3, deps: { now: realClock },
 *   });
 *   // hero.run → run.json, hero.events → events.json
 *
 * ── What is deliberately NOT exported ──────────────────────────────────────
 * `testing.ts`. Test support, like `lib/providers/testing.ts`: nothing on a real
 * run path should be able to swap a model for a script.
 *
 * The per-turn prose helpers in `prompt.ts`. `SYSTEM_PROMPT` is exported so a
 * caller can record what the models were told; the rest exists to be called by
 * the loop, identically for every model, and not assembled piecemeal elsewhere.
 */
export { runMatchup } from './matchup';
export type { MatchupOptions, MatchupResult, DroppedRepeat } from './matchup';

export { runDuel, mergeLog, DuelAbortedError } from './duel';
export type { DuelResult } from './duel';

export { runCompetitor, CompetitorAbortedError } from './competitor';
export type { CompetitorOptions, CompetitorResult } from './competitor';

export { SYSTEM_PROMPT } from './prompt';
export { buildEvent, describeRejection } from './record';
export { costOf, PRICING } from './pricing';
export type { Price, PriceTable } from './pricing';
export { outcomeOf, isTypical } from './typicality';
export type { Outcome } from './typicality';

export { DEFAULT_BUDGET, DEFAULT_REPEATS } from './types';
export type { DuelOptions, EventObserver, HarnessDeps } from './types';
