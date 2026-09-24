import { isLocked, isReachable, topLevelObjects, type RoomState } from './state';

/**
 * Everything a competitor is allowed to know about the room, and nothing else.
 *
 * ── This file is the secrecy boundary ──────────────────────────────────────
 * `RoomState` carries the full `RoomSpec`, which carries every lock code and
 * every puzzle answer in plaintext. This module is the only place a view of that
 * is built for a model to read, which makes it the only place a leak can happen.
 * `secrecy.test.ts` sweeps it adversarially for exactly that reason.
 *
 * ── Build by listing, never by spreading ───────────────────────────────────
 * Every field below is named explicitly. Do NOT rewrite this as a spread of
 * `RoomObject` with the secrets deleted, however much shorter it looks: a spread
 * is one forgotten `delete` away from publishing a lock code, and — worse — the
 * next field somebody adds to `RoomObject` would start leaking silently, with no
 * test failing and no line of this file having changed. Listing the fields means
 * a new secret is invisible here until someone deliberately adds it.
 */
export interface VisibleObject {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly locked: boolean;
  readonly opened: boolean;
}

export interface Observation {
  readonly theme: { readonly name: string; readonly description: string };
  /** Reachable top-level objects. See the note on `visible` below. */
  readonly visible: readonly VisibleObject[];
  readonly held: readonly { readonly id: string; readonly name: string }[];
  readonly puzzlesSolved: number;
  readonly actionsRemaining: number;
}

/**
 * ── What `visible` deliberately omits ──────────────────────────────────────
 * 1. `clueText`. A clue is revealed ONLY by a successful `inspect`, one object at
 *    a time. That is what makes `inspect` a real move that costs a turn, and it
 *    is the whole reason a three-puzzle chain takes a dozen actions rather than
 *    one. Putting clues in the observation would collapse the game.
 * 2. Anything unreachable. An object inside a locked safe is not merely
 *    un-actionable — the competitor must not learn that it EXISTS. Knowing a sea
 *    chart is in there is most of the puzzle.
 * 3. Contents of containers. `open` is what names them, and `open` costs a turn.
 *
 * ── What it deliberately INCLUDES: ids ─────────────────────────────────────
 * Every object a competitor is told about is named with its id, as `name [id]`
 * — the convention `lib/harness/prompt.ts` sets in the opening message. Before
 * TICKET-7 (#8) only that opening message carried ids, so a model had to GUESS
 * the id of anything it found later, and `invalidActions` measured id-guessing
 * rather than play (`.claude/reports/run-harness-report.md`). An id is not a
 * secret: it only names what the competitor is already allowed to see.
 */
export function visibleObjects(state: RoomState): VisibleObject[] {
  return topLevelObjects(state)
    .filter((object) => isReachable(state, object.id))
    .map((object) => ({
      id: object.id,
      name: object.name,
      description: object.description,
      locked: isLocked(state, object.id),
      opened: state.opened.has(object.id),
    }));
}

export function heldObjects(state: RoomState): { id: string; name: string }[] {
  return state.spec.objects
    .filter((object) => state.held.has(object.id))
    .map((object) => ({ id: object.id, name: object.name }));
}

export function observe(state: RoomState, actionsRemaining: number): Observation {
  const visible = visibleObjects(state);
  const held = heldObjects(state);

  return {
    theme: { name: state.spec.theme.name, description: state.spec.theme.description },
    visible,
    held,
    puzzlesSolved: state.solved.size,
    actionsRemaining,
  };
}

/** How a competitor is told about an object: `writing desk [desk]`. */
export function labelOf(object: { readonly id: string; readonly name: string }): string {
  return `${object.name} [${object.id}]`;
}

/** Join names the way a sentence would: "a, b and c". */
function sentenceList(parts: string[]): string {
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The prose a successful `look` returns.
 *
 * It reads the same `visibleObjects` list the structured observation does, so the
 * two channels can never disagree about what is in the room — a competitor told
 * one thing in prose and another in fields would be a fairness bug, not a
 * cosmetic one.
 *
 * It deliberately takes no budget argument: `resolve` calls this, and `resolve`
 * must know nothing about the ledger. See the note in `resolve.ts`.
 */
export function describeRoom(state: RoomState): string {
  const visible = visibleObjects(state);
  const held = heldObjects(state);
  const names = sentenceList(visible.map(labelOf));
  const carried = held.length > 0 ? ` You are carrying ${sentenceList(held.map(labelOf))}.` : '';
  return `You see ${names}.${carried}`;
}
