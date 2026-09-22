/**
 * The solver / verifier — TICKET-3 (#3).
 *
 * What #6 (the generator) imports, and the gate `architecture.md` says nothing
 * ships before. One question, asked one way:
 *
 *   const result = verifyRoom(candidateFromModel);
 *   if (!result.ok) {
 *     attempts.push(result.rejections.map((r) => r.code));  // feeds #8's quota analysis
 *     continue;                                             // regenerate
 *   }
 *   accept(result.report);
 *
 * It proves five things about a room: that it can be escaped by someone who
 * starts knowing nothing, that every answer can be read off its clue, that no
 * clue supports two answers, that the chain genuinely gates, and that the
 * declared difficulty is honest.
 *
 * ── What is deliberately NOT exported ──────────────────────────────────────
 * `solveRoom` and its two wrappers. Their return value is a complete escape
 * path — which is every answer in the room, in order. A caller able to run the
 * oracle could publish that alongside a run, and the replay artifact is served
 * statically to anyone with the URL. It is the same class of leak
 * `lib/sim/observation.ts` guards against, and it is withheld for the same
 * reason. `SolverReport` carries the two action COUNTS, which is what #6 and #8
 * actually need, plus the paths for tests that replay them in-process.
 *
 * Also not exported: `fuzz.ts`. It is test support, and `buildValidRoom` is
 * reachable by deep import for #6's stubbed-provider tests. Nothing in a
 * published path should be constructing rooms from a seed.
 *
 * Also not exported: the individual stage functions. They are a pipeline, and a
 * caller running `checkStructure` alone would get a room that passed one of five
 * gates and looked certified.
 */
export { verifyRoom, verifySpec } from './verify';
export type { SolverResult, SolverReport } from './verify';

export { REJECTION_CODES, RejectionCodeSchema, codesOf } from './rejections';
export type { Rejection, RejectionCode } from './rejections';

export { DIFFICULTY_RANGES, bandFor } from './difficulty';

export { ANSWER_DOMAINS } from './lexicon';
export type { AnswerDomain } from './lexicon';
