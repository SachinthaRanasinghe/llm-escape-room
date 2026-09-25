/**
 * The post-run comparison — TICKET-10 (#10).
 *
 *   outcomeOf / isTypical / tallyOutcomes / typicalOf   who won, and was it typical
 *   buildComparison                                     a run + its repeat counts → every string the results show
 *
 * Pure and client-safe: no filesystem, no clock, no provider
 * (`boundary.test.ts`).
 */
export {
  isTypical,
  outcomeKey,
  outcomeOf,
  tallyOutcomes,
  typicalOf,
  type Outcome,
  type OutcomeCount,
} from './outcome';
export {
  buildComparison,
  ESCAPE_TIME_NOTE,
  formatCost,
  LIMITATION,
  type ComparisonData,
  type ComparisonInput,
  type ComparisonRow,
  type VarianceKind,
  type VarianceStatement,
} from './comparison';
