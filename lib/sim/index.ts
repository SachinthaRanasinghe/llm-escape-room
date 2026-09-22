/**
 * The room simulator — TICKET-2 (#2).
 *
 * What #7 (the run harness) and #8 (the gate spike) import. The shape of the
 * seam is deliberately narrow: build a simulator, observe, apply an action,
 * summarise.
 *
 *   const sim = createSimulator({ spec, budget, competitorId });
 *   while (!sim.hasEnded()) {
 *     const { verdict, ended } = sim.apply(await model.act(sim.observe()), cost);
 *   }
 *   const summary = sim.summarise();   // plus costUsd, which only the harness knows
 *
 * ── What is deliberately NOT exported ──────────────────────────────────────
 * `RoomState`'s transition helpers — `withUnlocked`, `withOpened`, `withHeld`,
 * `withSolved`, `withEscaped`. They are exported from `state.ts` for `resolve.ts`
 * and for tests, and stop here. A harness that could call `withUnlocked` directly
 * would be able to open a door without spending an action, which bypasses every
 * rule this module exists to enforce and would do it silently. Reach for the
 * facade; if the facade cannot express something, that is a gap worth fixing in
 * the facade.
 *
 * Also not exported: anything that would let a caller read a `RoomSpec`'s answers
 * through the simulator. `Observation` is the competitor-facing view and
 * `observation.ts` is the only place it is built.
 */
export { createSimulator, VERDICT_TALLY } from './simulator';
export type { Simulator, SimulatorOptions, ApplyResult } from './simulator';

export { observe, describeRoom } from './observation';
export type { Observation, VisibleObject } from './observation';

export { compileRoom, isReachable, isLocked, objectById, contentsOf, topLevelObjects, SimulatorError } from './state';
export type { RoomState } from './state';

export { resolve } from './resolve';
export type { Resolution } from './resolve';

export { createLedger, chargeLedger, actionsRemaining, totalTokens, NO_COST } from './budget';
export type { ActionCost, Budget, Ledger } from './budget';
