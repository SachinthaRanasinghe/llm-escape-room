import type { Action, Verdict, VerdictCode } from '@/lib/schema/action';
import type { Puzzle, RoomObject } from '@/lib/schema/room';
import { describeRoom } from './observation';
import {
  contentsOf,
  isLocked,
  isReachable,
  objectById,
  withEscaped,
  withHeld,
  withOpened,
  withSolved,
  withUnlocked,
  type RoomState,
} from './state';

/**
 * Action resolution — the simulator's rulebook, as a pure function.
 *
 * ── Pure, and budget-free ──────────────────────────────────────────────────
 * `resolve` takes a state and an action and returns a verdict and the next
 * state. It reads no clock, draws no random number, mutates nothing, and knows
 * NOTHING about the run budget. Keeping the ledger out is what lets every rule
 * below be tested exhaustively without constructing a run, and keeping the clock
 * out is what makes a replay reproducible on any machine forever.
 *
 * ── A competitor's mistake is never an exception ───────────────────────────
 * Every failure below is a `Verdict`. The only throws in this module's
 * neighbourhood are `SimulatorError`, reserved for a broken spec or a harness
 * bug. `architecture.md` is explicit that using the interface correctly is part
 * of the task, so being wrong has to be a recordable, countable outcome.
 */

export interface Resolution {
  readonly verdict: Verdict;
  readonly state: RoomState;
}

function verdict(ok: boolean, code: VerdictCode, message: string): Verdict {
  return { ok, code, message };
}

function assertNever(value: never): never {
  throw new Error(`unhandled action: ${JSON.stringify(value)}`);
}

/**
 * Trimmed and case-insensitive, exactly as `lib/schema/room.ts` promises on
 * `Puzzle.answer`.
 *
 * Do NOT normalise further. Stripping punctuation, spaces or accents would
 * quietly widen what counts as correct, and #3 verifies answer UNIQUENESS
 * against this same comparison — a looser match here would let it certify a room
 * whose two puzzles secretly accept the same string.
 */
function matches(expected: string, given: string): boolean {
  return expected.trim().toLowerCase() === given.trim().toLowerCase();
}

/**
 * `not_found` for an object that exists but is out of reach is DELIBERATE, and
 * will look like a bug to a future reader.
 *
 * A distinct verdict — "that is inside the safe" — would hand the competitor a
 * map of the room's containment graph for the price of one cheap action, and
 * knowing that something is sealed in the safe is most of the puzzle. So an
 * object behind a lock is indistinguishable from an object that was never there.
 */
function notFound(id: string): Verdict {
  return verdict(false, 'not_found', `There is no ${id} within reach.`);
}

/** Which kinds have an inside worth opening. A portable or a fixture has none. */
const OPENABLE_KINDS: ReadonlySet<RoomObject['kind']> = new Set(['container', 'lock', 'door']);

/**
 * Solving is a CONSEQUENCE of unlocking, never a verb of its own.
 *
 * When an object is unlocked — by a code or by a key — any unsolved puzzle that
 * names it as `unlocksObjectId` has, by definition, just been solved: the whole
 * chain is defined as "the answer opens the thing holding the next clue". Doing
 * it here rather than in each verb means a future unlocking verb cannot forget.
 */
function unlockAndSolve(state: RoomState, objectId: string): RoomState {
  let next = withUnlocked(state, objectId);
  for (const puzzle of next.spec.puzzles) {
    if (puzzle.unlocksObjectId === objectId && !next.solved.has(puzzle.id)) {
      next = withSolved(next, puzzle.id);
    }
  }
  return next;
}

/**
 * Escape happens the MOMENT the exit puzzle is solved — not on a later `open` of
 * the door.
 *
 * The golden log ends model-a at `submit_answer p3` with `escapeActionCount: 13`.
 * Requiring a fourteenth `open door` would contradict the committed run record,
 * and would also mean a model that had genuinely solved the room could still lose
 * it to a budget that ran out on a formality.
 */
function checkEscape(state: RoomState): RoomState {
  if (state.escaped) return state;
  return state.solved.has(state.spec.exit.requiresPuzzleId) ? withEscaped(state) : state;
}

function puzzleById(state: RoomState, id: string): Puzzle | undefined {
  return state.spec.puzzles.find((puzzle) => puzzle.id === id);
}

export function resolve(state: RoomState, action: Action): Resolution {
  const resolution = resolveAction(state, action);
  return { verdict: resolution.verdict, state: checkEscape(resolution.state) };
}

function resolveAction(state: RoomState, action: Action): Resolution {
  switch (action.name) {
    case 'look':
      return { verdict: verdict(true, 'ok', describeRoom(state)), state };

    case 'inspect': {
      const target = objectById(state, action.targetId);
      if (target === undefined || !isReachable(state, action.targetId)) {
        return { verdict: notFound(action.targetId), state };
      }
      // `clueText` is the point of `inspect`; an object with none still yields its
      // description, so the move is never silently wasted.
      return { verdict: verdict(true, 'ok', target.clueText ?? target.description), state };
    }

    case 'take': {
      const target = objectById(state, action.targetId);
      if (target === undefined || !isReachable(state, action.targetId)) {
        return { verdict: notFound(action.targetId), state };
      }
      if (target.kind !== 'portable') {
        return {
          verdict: verdict(false, 'not_permitted', `The ${target.name} is not something you can carry.`),
          state,
        };
      }
      if (state.held.has(target.id)) {
        return { verdict: verdict(true, 'ok', `You are already carrying the ${target.name}.`), state };
      }
      return {
        verdict: verdict(true, 'ok', `You take the ${target.name}.`),
        state: withHeld(state, target.id),
      };
    }

    case 'open': {
      const target = objectById(state, action.targetId);
      if (target === undefined || !isReachable(state, action.targetId)) {
        return { verdict: notFound(action.targetId), state };
      }
      if (!OPENABLE_KINDS.has(target.kind)) {
        return { verdict: verdict(false, 'not_permitted', `The ${target.name} does not open.`), state };
      }
      if (isLocked(state, target.id)) {
        return { verdict: verdict(false, 'locked', `The ${target.name} is locked and does not budge.`), state };
      }
      const contents = contentsOf(state, target.id);
      const message =
        contents.length > 0
          ? `The ${target.name} opens. Inside is ${contents.map((c) => c.name).join(', ')}.`
          : `The ${target.name} opens. There is nothing inside.`;
      return { verdict: verdict(true, 'ok', message), state: withOpened(state, target.id) };
    }

    case 'use': {
      const target = objectById(state, action.targetId);
      if (target === undefined || !isReachable(state, action.targetId)) {
        return { verdict: notFound(action.targetId), state };
      }
      if (!state.held.has(action.itemId)) {
        return {
          verdict: verdict(false, 'not_holding', `You are not carrying any ${action.itemId}.`),
          state,
        };
      }
      if (target.lock === null) {
        return {
          verdict: verdict(false, 'not_permitted', `The ${target.name} has no lock to work on.`),
          state,
        };
      }
      if (target.lock.opensWith === 'code') {
        return {
          verdict: verdict(false, 'not_permitted', `The ${target.name} wants a code, not an object.`),
          state,
        };
      }
      if (target.lock.keyItemId !== action.itemId) {
        return { verdict: verdict(false, 'locked', `That does not fit the ${target.name}.`), state };
      }
      return {
        verdict: verdict(true, 'ok', `The ${target.name} unlocks.`),
        state: unlockAndSolve(state, target.id),
      };
    }

    case 'enter_code': {
      const target = objectById(state, action.targetId);
      if (target === undefined || !isReachable(state, action.targetId)) {
        return { verdict: notFound(action.targetId), state };
      }
      if (target.lock === null) {
        return {
          verdict: verdict(false, 'not_permitted', `The ${target.name} has nowhere to enter a code.`),
          state,
        };
      }
      if (target.lock.opensWith === 'key') {
        return {
          verdict: verdict(false, 'not_permitted', `The ${target.name} takes a key, not a code.`),
          state,
        };
      }
      if (!matches(target.lock.code, action.code)) {
        return { verdict: verdict(false, 'wrong_code', `The ${target.name} rejects that code.`), state };
      }
      return {
        verdict: verdict(true, 'ok', `The ${target.name} accepts the code and unlocks.`),
        state: unlockAndSolve(state, target.id),
      };
    }

    case 'submit_answer': {
      const puzzle = puzzleById(state, action.puzzleId);
      if (puzzle === undefined) {
        return { verdict: notFound(action.puzzleId), state };
      }
      /*
       * A `code` puzzle has a physical lock to type into, and `lib/schema/action.ts`
       * draws the distinction explicitly: `enter_code` is physical, `submit_answer`
       * is "without a lock to type it into". Letting an answer be submitted straight
       * at a code puzzle would make the lock decorative and give two different action
       * counts for the same solution — which would quietly corrupt the one number the
       * whole product compares models on.
       */
      if (puzzle.kind === 'code') {
        const holder = objectById(state, puzzle.unlocksObjectId);
        return {
          verdict: verdict(
            false,
            'not_permitted',
            `That answer has to be entered into the ${holder?.name ?? puzzle.unlocksObjectId}.`,
          ),
          state,
        };
      }
      if (!matches(puzzle.answer, action.answer)) {
        return { verdict: verdict(false, 'wrong_answer', 'That is not the answer.'), state };
      }
      if (state.solved.has(puzzle.id)) {
        return { verdict: verdict(true, 'ok', 'That is already answered.'), state };
      }
      const target = objectById(state, puzzle.unlocksObjectId);
      return {
        verdict: verdict(true, 'ok', `Correct. The ${target?.name ?? puzzle.unlocksObjectId} gives way.`),
        state: withSolved(unlockAndSolve(state, puzzle.unlocksObjectId), puzzle.id),
      };
    }

    default:
      return assertNever(action);
  }
}
