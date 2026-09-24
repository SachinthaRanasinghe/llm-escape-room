import type { Action } from '@/lib/schema/action';
import type { RoomSpec } from '@/lib/schema/room';
import { compileRoom, isReachable, objectById, resolve, type RoomState } from '@/lib/sim';

/**
 * Plays the room, properly, and reports the shortest way out.
 *
 * ── It plays through the REAL engine ───────────────────────────────────────
 * Every move below is applied by calling `resolve()` from `lib/sim` — the same
 * pure function the two competitors are judged by. So "this room is solvable"
 * means solvable under the exact rules the race is run under, not under a second
 * model of the room that lives in this file and could drift from the first.
 *
 * That is the whole reason this ticket reuses the simulator rather than
 * re-deriving reachability. A solver with its own idea of what is reachable
 * could certify a room the simulator cannot actually run, and nothing would look
 * broken until a published matchup got stuck.
 *
 * ── The knowledge gate is the point ────────────────────────────────────────
 * The oracle holds the spec, and the spec holds every answer in plaintext.
 * Without a gate it types them straight in and EVERY room is solvable in a
 * handful of moves — the search proves nothing at all.
 *
 * So a puzzle is usable only once the oracle has spent an action inspecting its
 * clue, and only if `derivation.ts` says the answer can actually be read off
 * that clue. A destroyed clue is therefore an unescapable room, which is
 * precisely what `fixtures/rooms/invalid/unsolvable.json` is.
 *
 * The gate is derivability, NOT uniqueness. An ambiguous clue still teaches its
 * answer — see the asymmetry documented in `derivation.ts`.
 *
 * ── State moves ONLY through resolve() ─────────────────────────────────────
 * `withUnlocked`, `withSolved` and friends are deliberately not exported from
 * `lib/sim/index.ts`. Reaching for them would let this file open a door without
 * spending an action, which is exactly the bypass that export boundary exists to
 * prevent — and it would silently inflate every room's certified difficulty.
 */

export interface OraclePath {
  readonly actions: readonly Action[];
  readonly actionCount: number;
}

export interface OracleOptions {
  /** Puzzle ids whose answer can be learned by inspecting their clue. */
  readonly derivable: ReadonlySet<string>;
  /** When true, puzzles may only be solved in `spec.solution.order`. */
  readonly respectSolutionOrder: boolean;
}

/**
 * A generous ceiling on explored states. A fuzzed or adversarial spec must never
 * hang the test suite: returning `null` on overrun reports "no path found", which
 * a caller already handles, whereas a hang reports nothing and blocks CI.
 *
 * MVP rooms are ~8 objects and ~3 puzzles, which explore a few hundred states at
 * most — four orders of magnitude below this. If a real room ever trips it, the
 * room is the problem.
 */
const MAX_NODES = 50_000;

interface Node {
  readonly state: RoomState;
  readonly known: ReadonlySet<string>;
  readonly path: readonly Action[];
}

/** Synthetic and never published, but `ActionSchema` requires a non-empty intent under 280 chars. */
const INTENT = 'oracle';

export function solveRoom(spec: RoomSpec, options: OracleOptions): OraclePath | null {
  const start: Node = { state: compileRoom(spec), known: new Set(), path: [] };
  if (start.state.escaped) return { actions: [], actionCount: 0 };

  const queue: Node[] = [start];
  const seen = new Set<string>([keyOf(start)]);
  let expanded = 0;

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (++expanded > MAX_NODES) return null;

    for (const action of movesFrom(spec, node, options)) {
      const { verdict, state } = resolve(node.state, action);
      // A move the engine refuses teaches the oracle nothing and costs a turn;
      // there is never a reason to include it in a SHORTEST path.
      if (!verdict.ok) continue;

      const known = learnedBy(action, spec, node.known, options.derivable);
      const next: Node = { state, known, path: [...node.path, action] };

      if (state.escaped) return { actions: next.path, actionCount: next.path.length };

      const key = keyOf(next);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }

  return null;
}

/**
 * The moves worth considering.
 *
 * ── `look` and `open` are deliberately absent, and a reader will ask why ───
 * `look` returns prose. The oracle has the spec and needs no description of a
 * room it can already see, so the move can only ever lengthen a path.
 *
 * `open` is subtler. It is NOT how contents become reachable — `lib/sim/state.ts`
 * gates reachability on the LOCK, not on whether anything was opened, and its
 * comment explains why (the golden log has a model inspecting the ledger inside
 * a desk it never opened). `open` only NAMES contents back to a competitor, which
 * is information the oracle already has. Including either verb would multiply the
 * branching factor for moves that can never shorten a solution.
 */
function movesFrom(spec: RoomSpec, node: Node, options: OracleOptions): Action[] {
  const moves: Action[] = [];
  const solvable = solvableNow(spec, node, options);

  for (const puzzle of spec.puzzles) {
    const known = knows(node, puzzle, options.derivable);

    /* Learn: inspect a derivable clue not yet read. A key is never read — see `knows`. */
    if (
      puzzle.kind !== 'key' &&
      !known &&
      options.derivable.has(puzzle.id) &&
      isReachable(node.state, puzzle.clueObjectId)
    ) {
      moves.push({ name: 'inspect', targetId: puzzle.clueObjectId, intent: INTENT });
    }

    /* Act: spend what has been learned. */
    if (!known) continue;
    if (node.state.solved.has(puzzle.id)) continue;
    if (!solvable.has(puzzle.id)) continue;

    const target = objectById(node.state, puzzle.unlocksObjectId);

    if (puzzle.kind === 'answer') {
      moves.push({ name: 'submit_answer', puzzleId: puzzle.id, answer: puzzle.answer, intent: INTENT });
      continue;
    }

    if (target === undefined || !isReachable(node.state, puzzle.unlocksObjectId)) continue;

    if (target.lock !== null && target.lock.opensWith === 'key') {
      /*
       * A key lock needs the key in hand first, so it costs two actions rather
       * than one. `take` is emitted as its own move (not fused with `use`) so
       * the action count stays exactly what a competitor would spend.
       */
      const keyItemId = target.lock.keyItemId;
      if (!node.state.held.has(keyItemId)) {
        if (isReachable(node.state, keyItemId)) {
          moves.push({ name: 'take', targetId: keyItemId, intent: INTENT });
        }
      } else {
        moves.push({ name: 'use', itemId: keyItemId, targetId: puzzle.unlocksObjectId, intent: INTENT });
      }
      continue;
    }

    moves.push({ name: 'enter_code', targetId: puzzle.unlocksObjectId, code: puzzle.answer, intent: INTENT });
  }

  return moves;
}

/**
 * Which puzzles may be solved from here.
 *
 * Unconstrained, that is all of them — any route out counts, which is what makes
 * `minActions` a true lower bound on what a competitor could get away with.
 *
 * Constrained to `solution.order`, only the next unsolved link is allowed, which
 * measures the room AS DESIGNED. `verify.ts` compares the two: when the free
 * route is shorter than the intended one, a shortcut exists and the chain does
 * not really gate.
 */
function solvableNow(spec: RoomSpec, node: Node, options: OracleOptions): Set<string> {
  if (!options.respectSolutionOrder) return new Set(spec.puzzles.map((p) => p.id));

  const next = spec.solution.order.find((id) => !node.state.solved.has(id));
  return new Set(next === undefined ? [] : [next]);
}

/**
 * Whether the oracle may act on a puzzle yet.
 *
 * ── A key is known by REACHING it, not by reading about it ─────────────────
 * TICKET-7 (#8). A competitor can pick up a key it never inspected, so gating a
 * `key` puzzle on an `inspect` would make `minActions` overstate what a
 * competitor could get away with — and could hide a real shortcut. The key's
 * `take` + `use` is then two actions, the same as `inspect` + `enter_code`, so a
 * link costs the same whatever its kind and the difficulty bands mean the same
 * thing for every generator strategy.
 *
 * `derivable` still gates it: `derivation.ts` only calls a key puzzle derivable
 * when the key really lies where its clue object says.
 */
function knows(node: Node, puzzle: RoomSpec['puzzles'][number], derivable: ReadonlySet<string>): boolean {
  if (puzzle.kind !== 'key') return node.known.has(puzzle.id);
  if (!derivable.has(puzzle.id)) return false;
  return node.state.held.has(puzzle.answer) || isReachable(node.state, puzzle.answer);
}

/**
 * Inspecting a clue is the only way anything is learned — except where a key
 * is, which is learned by reaching it (`knows`).
 *
 * The `derivable` filter matters when ONE object carries the clue for two
 * puzzles: without it, reading a clue that yields one answer would hand over a
 * second answer the clue does not actually contain, and a room with a destroyed
 * clue could be certified through its neighbour.
 */
function learnedBy(
  action: Action,
  spec: RoomSpec,
  known: ReadonlySet<string>,
  derivable: ReadonlySet<string>,
): ReadonlySet<string> {
  if (action.name !== 'inspect') return known;

  const learned = spec.puzzles
    .filter((p) => p.clueObjectId === action.targetId && derivable.has(p.id))
    .map((p) => p.id);
  if (learned.length === 0) return known;

  const next = new Set(known);
  for (const id of learned) next.add(id);
  return next;
}

/**
 * The visited key.
 *
 * `opened` is deliberately excluded: no move above reads it, so two states that
 * differ only in what has been opened are the same state to this search, and
 * including it would split the graph for no gain. Sets are sorted because
 * insertion order is not semantic.
 */
function keyOf(node: Node): string {
  const parts = [
    [...node.state.unlocked].sort().join(','),
    [...node.state.solved].sort().join(','),
    [...node.state.held].sort().join(','),
    [...node.known].sort().join(','),
    node.state.escaped ? '1' : '0',
  ];
  return parts.join('|');
}

/** The shortest escape by any route — the lower bound on what a competitor could spend. */
export function minActionsFor(spec: RoomSpec, derivable: ReadonlySet<string>): OraclePath | null {
  return solveRoom(spec, { derivable, respectSolutionOrder: false });
}

/** The shortest escape along the chain as designed — the number difficulty is judged on. */
export function intendedActionsFor(spec: RoomSpec, derivable: ReadonlySet<string>): OraclePath | null {
  return solveRoom(spec, { derivable, respectSolutionOrder: true });
}
