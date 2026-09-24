/**
 * The substrate spike's analysis — TICKET-7 (#8).
 *
 * Pure functions over what the runner left on disk: the divergence rule, the
 * adoption decision, and the free-tier quota extrapolation. The live runner is
 * `scripts/spike-substrate.mts`; the report CLI is `scripts/spike-report.mts`.
 *
 *   const report = buildReport('runs/spike');
 *   report.decision.adopted;   // 'spatial' | … | null (the fallback branch)
 *   report.markdown;           // the tables for docs/decisions/substrate.md
 *
 * ── What is deliberately NOT exported ──────────────────────────────────────
 * `testing.ts`, like every other module's.
 */
export { DIVERGENCE_GAP, DIVERGENCE_REASONS, divergenceOf } from './divergence';
export type { DivergenceReason, InstanceVerdict } from './divergence';

export { ADOPTION_THRESHOLD, MIN_ELIGIBLE, decide, median, modelKeyOf, percentile, summariseStrategy } from './decide';
export type { CompetitorStats, Decision, SpikeInstance, StrategySummary } from './decide';

export { DEFAULT_START, FREE_TIER_LIMITS, estimateMatchup, planCuts } from './quota';
export type { CutPlan, Fit, Limits, MatchupConfig, MatchupEstimate, Measured, ModelUsage } from './quota';

export { SpikeReportError, buildReport, measure, renderMarkdown } from './report';
export type { SpikeReport } from './report';
