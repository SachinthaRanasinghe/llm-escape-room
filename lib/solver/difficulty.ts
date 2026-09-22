import type { RoomSpec } from '@/lib/schema/room';
import { reject, type Rejection } from './rejections';

type Band = RoomSpec['difficulty']['band'];

/**
 * What each difficulty band means, in actions.
 *
 * ── Where these numbers came from ──────────────────────────────────────────
 * They are a CALIBRATION, not a measurement, and the distinction matters.
 *
 * The only room anyone has ever certified is the committed canonical fixture,
 * which the oracle solves in 6 actions along its intended chain and which
 * declares itself `standard`. The bands below are fitted so that room passes
 * unchanged — because `fixtures/` is the wave-2 contract that #3, #4 and #8 are
 * all building against simultaneously, and moving a fixture to satisfy a
 * threshold would be the tail wagging the dog.
 *
 * TICKET-7 (#8) re-tunes these against ~20 real instances per generator
 * strategy, which is the first point at which they become empirical. Until then
 * they are one data point and a straight edge. Do not read them as evidence.
 *
 * The PRD's 60–90 second watch target is what ultimately constrains the top of
 * `hard`: every action costs a beat on screen.
 */
export const DIFFICULTY_RANGES: Readonly<Record<Band, { readonly min: number; readonly max: number }>> = {
  easy: { min: 1, max: 4 },
  standard: { min: 5, max: 12 },
  hard: { min: 13, max: 25 },
};

/** How far above the optimum a generator's own estimate may sit before it is fiction. */
const ESTIMATE_SLACK = 3;

export interface DifficultyInput {
  /** Shortest escape along `solution.order` — the room as designed. */
  readonly intendedActions: number;
}

/**
 * ── The band is judged on the INTENDED path, not the shortest one ──────────
 * This looks like the wrong choice at first glance: surely difficulty is what a
 * competitor can actually get away with?
 *
 * It is not, and the committed corpus shows why. `broken-chain.json` has a
 * four-action shortcut because one clue was orphaned to the floor. Judging its
 * band on that 4 would make it trip `difficulty_out_of_band` ON TOP OF
 * `chain_broken` — two codes for one mistake, in a corpus whose stated design is
 * that each invalid room breaks exactly one rule.
 *
 * The shortcut is not a difficulty fact, it is a chain fact, and `verify.ts`
 * reports it as one. What the band measures is the room as its author intended
 * it; whether that intention holds is a separate question with its own code.
 */
export function checkDifficulty(spec: RoomSpec, { intendedActions }: DifficultyInput): Rejection[] {
  const { band, estimatedActions } = spec.difficulty;
  const range = DIFFICULTY_RANGES[band];

  if (intendedActions < range.min || intendedActions > range.max) {
    /*
     * Returning EARLY rather than also checking the estimate is deliberate.
     * A room that has misjudged its own band has one problem, and reporting a
     * second code for the estimate that follows from it would make
     * `out-of-band-difficulty.json` report two codes where the corpus expects
     * one — and would tell #6's generator loop that two things need fixing when
     * only one does.
     */
    return [
      reject(
        'difficulty_out_of_band',
        `declared band "${band}" expects ${range.min}-${range.max} actions, but the intended solution takes ${intendedActions}`,
      ),
    ];
  }

  /*
   * ── The estimate is judged against the INTENDED path too ────────────────
   * Measuring slack against the shortest route instead looks more conservative
   * and is actively wrong, which the committed corpus proved: `broken-chain.json`
   * has a four-action shortcut, so a ceiling of 3x4 would reject its estimate of
   * 14 and report `difficulty_estimate_implausible` ALONGSIDE `chain_broken` —
   * a difficulty complaint about a room whose only defect is its chain.
   *
   * The two numbers are equal in any sound room, so this changes nothing there.
   * It only stops one defect from being reported twice under two names, which is
   * the same reasoning that moved the band check off the shortest route.
   */
  const ceiling = intendedActions * ESTIMATE_SLACK;
  if (estimatedActions < intendedActions) {
    /*
     * A room claiming fewer actions than are physically possible. Left
     * unchecked it would feed #8 a watch-length figure shorter than any run can
     * be, and the 60–90 second target would be planned against fiction.
     */
    return [
      reject(
        'difficulty_estimate_implausible',
        `estimatedActions ${estimatedActions} is below the ${intendedActions} actions the room actually requires`,
      ),
    ];
  }
  if (estimatedActions > ceiling) {
    return [
      reject(
        'difficulty_estimate_implausible',
        `estimatedActions ${estimatedActions} is more than ${ESTIMATE_SLACK}x the ${intendedActions}-action intended solution`,
      ),
    ];
  }

  return [];
}

/** The band a room of this length would honestly declare, or `null` if it is off the scale. */
export function bandFor(intendedActions: number): Band | null {
  for (const [band, range] of Object.entries(DIFFICULTY_RANGES) as [Band, { min: number; max: number }][]) {
    if (intendedActions >= range.min && intendedActions <= range.max) return band;
  }
  return null;
}
