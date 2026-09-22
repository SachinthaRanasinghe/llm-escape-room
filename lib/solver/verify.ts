import type { Action } from '@/lib/schema/action';
import { RoomSpecError, parseRoomSpec, type RoomSpec } from '@/lib/schema/room';
import { SimulatorError, compileRoom } from '@/lib/sim';
import { checkDerivation } from './derivation';
import { checkDifficulty } from './difficulty';
import { intendedActionsFor, minActionsFor } from './oracle';
import { reject, type Rejection } from './rejections';
import { checkStructure } from './structure';

/**
 * The gate. A room is certified here or it is not published.
 *
 * `architecture.md` lists the solver under *Missing pieces* as the thing that
 * "gates the generator; nothing ships before it", and this function is that
 * gate: TICKET-5 (#6) is a loop around `verifyRoom`, asking a model for a room
 * and regenerating until one comes back `ok`.
 *
 * ── Every rejection is collected, never the first one only ─────────────────
 * Failing fast would be cheaper and is wrong here. #6 regenerates on rejection
 * and #8 extrapolates quota from how many attempts that takes, so a full list
 * makes a badly-behaved generator diagnosable in one attempt instead of N — and
 * a generator that is getting three things wrong should not look like a
 * generator that is getting one thing wrong three times.
 *
 * The pipeline only short-circuits where a later stage genuinely cannot run.
 */

export interface SolverReport {
  /** Shortest escape by any route — what a competitor could get away with. */
  readonly minActions: number;
  /** Shortest escape along `solution.order` — the room as designed. */
  readonly intendedActions: number;
  readonly band: RoomSpec['difficulty']['band'];
  readonly solutionOrder: readonly string[];
  readonly minPath: readonly Action[];
  readonly intendedPath: readonly Action[];
}

export type SolverResult =
  | { readonly ok: true; readonly report: SolverReport }
  | { readonly ok: false; readonly rejections: readonly Rejection[] };

/**
 * Parse, then verify. The entry point for anything holding untrusted JSON —
 * which is every caller that matters, since #6's input comes out of a model.
 */
export function verifyRoom(raw: unknown): SolverResult {
  let spec: RoomSpec;
  try {
    spec = parseRoomSpec(raw);
  } catch (error) {
    if (error instanceof RoomSpecError) {
      /*
       * A version mismatch is called out separately because it is the one
       * failure that is not the generator's fault: `lib/schema/version.ts`
       * promises exactly one migration when #8 promotes v0 to v1, and a room
       * written by the other version must be recognisable as such rather than
       * lumped in with malformed output.
       */
      const versioned = error.issues.some((issue) => issue.path[0] === 'specVersion');
      return {
        ok: false,
        rejections: [reject(versioned ? 'spec_version_mismatch' : 'spec_malformed', error.message)],
      };
    }
    throw error;
  }
  return verifySpec(spec);
}

/** For callers that already hold a parsed spec — the simulator's own tests, and #6 after a retry. */
export function verifySpec(spec: RoomSpec): SolverResult {
  const rejections: Rejection[] = [];

  /* ── Stage 2: the object graph ─────────────────────────────────────────
   * `compileRoom` owns containment: dangling children, duplicate ids, two
   * holders for one object, cycles. Catching its error rather than
   * re-implementing its rules is what keeps one definition of a valid graph.
   * Nothing downstream can run against a room that will not compile, so this is
   * the one stage that aborts. */
  try {
    // Called for its refusal, not its result: nothing below needs the compiled
    // state, but everything below assumes the graph is sound.
    compileRoom(spec);
  } catch (error) {
    if (error instanceof SimulatorError) {
      return { ok: false, rejections: [reject('object_graph_invalid', error.message)] };
    }
    throw error;
  }

  /* ── Stage 3: structure ────────────────────────────────────────────────── */
  rejections.push(...checkStructure(spec));

  /* ── Stage 4: derivation ───────────────────────────────────────────────── */
  const { rejections: derivationRejections, derivable } = checkDerivation(spec);
  rejections.push(...derivationRejections);

  /* ── Stage 5: the oracle ───────────────────────────────────────────────── */
  const minPath = minActionsFor(spec, derivable);
  const intendedPath = intendedActionsFor(spec, derivable);

  if (intendedPath === null || minPath === null) {
    /*
     * `unsolvable` is frequently a CONSEQUENCE rather than a root cause, and the
     * committed corpus shows it: `unsolvable.json` reports BOTH
     * `answer_not_derivable` on p2 (the mistake) and `unsolvable` (what that
     * mistake did to the room), because the oracle cannot learn a clue nobody
     * can read.
     *
     * That is correct and deliberate. Do not "fix" it by suppressing one of
     * them: the derivation code says what to change, and this code says why it
     * matters. A future reader will be tempted; `fixtures/index.ts` describes
     * each invalid room as breaking one rule, and this is the single place that
     * reads literally as two.
     */
    rejections.push(reject('unsolvable', 'no sequence of actions escapes this room'));
    return { ok: false, rejections };
  }

  /* ── Stage 6: chain integrity ──────────────────────────────────────────── */
  rejections.push(...checkChain(spec, minPath.actionCount, intendedPath.actionCount));

  /* ── Stage 7: difficulty ───────────────────────────────────────────────── */
  rejections.push(...checkDifficulty(spec, { intendedActions: intendedPath.actionCount }));

  if (rejections.length > 0) return { ok: false, rejections };

  return {
    ok: true,
    report: {
      minActions: minPath.actionCount,
      intendedActions: intendedPath.actionCount,
      band: spec.difficulty.band,
      solutionOrder: spec.solution.order,
      minPath: minPath.actions,
      intendedPath: intendedPath.actions,
    },
  };
}

/**
 * Does the chain actually gate?
 *
 * Two ways it can fail to, and both are the same defect seen from different
 * sides:
 *
 * 1. **Structurally** — puzzle N+1's clue is not inside what puzzle N unlocks,
 *    so solving N was never a precondition for reaching N+1.
 * 2. **By outcome** — a shorter route exists than the intended one, so whatever
 *    the containment says, a competitor can skip a link.
 *
 * `broken-chain.json` trips both: its sea chart was moved out of the wall safe
 * and onto the floor, which severs the link AND opens a four-action route
 * through a room that claims to need six.
 */
function checkChain(spec: RoomSpec, minActions: number, intendedActions: number): Rejection[] {
  const rejections: Rejection[] = [];
  const byId = new Map(spec.objects.map((o) => [o.id, o]));
  const puzzleById = new Map(spec.puzzles.map((p) => [p.id, p]));

  for (let i = 0; i < spec.solution.order.length - 1; i++) {
    const current = puzzleById.get(spec.solution.order[i]!);
    const next = puzzleById.get(spec.solution.order[i + 1]!);
    if (current === undefined || next === undefined) continue; // dangling, already reported

    if (!containsTransitively(byId, current.unlocksObjectId, next.clueObjectId)) {
      rejections.push(
        reject(
          'chain_broken',
          `puzzle ${next.id}'s clue (${next.clueObjectId}) is not inside what ${current.id} unlocks (${current.unlocksObjectId}), so solving ${current.id} was never required to reach it`,
          { puzzleId: next.id, objectId: next.clueObjectId },
        ),
      );
    }
  }

  /*
   * The shortcut check CORROBORATES the containment check; it does not stand
   * beside it. When containment already caught the break, reporting the shorter
   * route as a second `chain_broken` would hand #6 the same code twice for one
   * defect and skew its per-attempt failure counts — the same double-reporting
   * `derivation.ts` avoids for dangling references.
   *
   * It still earns its place on its own: a room whose containment looks correct
   * can have a second copy of a clue elsewhere, and only the action counts
   * reveal it.
   */
  if (rejections.length === 0 && minActions < intendedActions) {
    rejections.push(
      reject(
        'chain_broken',
        `the room can be escaped in ${minActions} actions but the intended chain takes ${intendedActions}, so a competitor can skip a link`,
      ),
    );
  }

  return rejections;
}

function containsTransitively(
  byId: ReadonlyMap<string, RoomSpec['objects'][number]>,
  holderId: string,
  childId: string,
): boolean {
  const holder = byId.get(holderId);
  if (holder === undefined) return false;
  const queue = [...holder.contains];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === childId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const child = byId.get(id);
    if (child !== undefined) queue.push(...child.contains);
  }
  return false;
}
