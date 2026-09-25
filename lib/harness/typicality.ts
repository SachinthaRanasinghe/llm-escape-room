/**
 * Was the published run typical of its silent repeats? — TICKET-6 (#7).
 *
 * Moved to `lib/comparison/outcome.ts` in TICKET-10 (#10), so the published
 * artifact can judge a repeat tally with the same definition without importing
 * the harness. Re-exported here so harness callers are unchanged.
 */
export { isTypical, outcomeOf, type Outcome } from '@/lib/comparison/outcome';
