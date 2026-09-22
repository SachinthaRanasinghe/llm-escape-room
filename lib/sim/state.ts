import type { RoomSpec, RoomObject } from '@/lib/schema/room';

/**
 * The compiled room — a `RoomSpec` turned into something an action can be
 * resolved against.
 *
 * ── Immutable by construction ──────────────────────────────────────────────
 * Every field is readonly and every transition returns a NEW state. Nothing here
 * is mutated in place, which is what lets `resolve` be a pure function and what
 * lets a test assert that resolving the same action twice gives the same answer.
 * Two competitors racing the same room each hold their own state; see the
 * one-simulator-per-competitor note in `simulator.ts`.
 *
 * ── The state is not the spec ──────────────────────────────────────────────
 * `spec` is carried along because resolution needs the answers, but a `RoomState`
 * must never be handed to anything that talks to a model. `observation.ts` owns
 * the narrow view a competitor is allowed; this type is the privileged one.
 */
export interface RoomState {
  readonly spec: RoomSpec;
  /** Ids of objects whose lock has been opened. An object with `lock: null` is never in here and never needs to be. */
  readonly unlocked: ReadonlySet<string>;
  /** Ids of objects a successful `open` has revealed the inside of. */
  readonly opened: ReadonlySet<string>;
  /** Ids of portable objects the competitor is carrying. */
  readonly held: ReadonlySet<string>;
  /** Ids of puzzles solved, in no particular order. */
  readonly solved: ReadonlySet<string>;
  /** Set the moment `spec.exit.requiresPuzzleId` is solved. */
  readonly escaped: boolean;
  /** Inverted `contains`: child id → the id of the object holding it. Built once at compile time. */
  readonly holderOf: ReadonlyMap<string, string>;
  /** Id → object, so resolution never scans the array. */
  readonly byId: ReadonlyMap<string, RoomObject>;
}

/**
 * A PROGRAMMER error — a malformed spec, or the harness driving the simulator
 * wrongly. It is deliberately NOT how a competitor's mistake is reported: a model
 * that names a nonexistent object gets a `not_found` verdict and loses a turn.
 * Throwing at a model would end a run over something the run is meant to measure.
 */
export class SimulatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulatorError';
  }
}

/**
 * Turn a spec into a state machine.
 *
 * `RoomSpecSchema` validates SHAPE ONLY — it deliberately does no referential
 * checking, because that is the solver's job in #3. So a structurally perfect
 * spec can still name a child that does not exist, or have two objects claiming
 * the same child, or contain a containment cycle. The simulator cannot resolve
 * anything against such a room, so it refuses it here, loudly, rather than
 * behaving strangely halfway through a run.
 *
 * Note what is NOT checked: whether the room is solvable, whether the chain
 * connects, whether answers are unique. Those are semantic properties and they
 * belong to #3. The simulator assumes the room it is handed was already proved.
 */
export function compileRoom(spec: RoomSpec): RoomState {
  const byId = new Map<string, RoomObject>();
  for (const object of spec.objects) {
    if (byId.has(object.id)) {
      throw new SimulatorError(`duplicate object id: ${object.id}`);
    }
    byId.set(object.id, object);
  }

  const holderOf = new Map<string, string>();
  for (const object of spec.objects) {
    for (const childId of object.contains) {
      if (!byId.has(childId)) {
        throw new SimulatorError(`object ${object.id} contains unknown object: ${childId}`);
      }
      if (childId === object.id) {
        throw new SimulatorError(`object ${object.id} contains itself`);
      }
      const existing = holderOf.get(childId);
      if (existing !== undefined) {
        throw new SimulatorError(`object ${childId} is contained by both ${existing} and ${object.id}`);
      }
      holderOf.set(childId, object.id);
    }
  }

  // A cycle would make `isReachable` recurse forever, and a run that hangs is far
  // worse than a run that refuses to start. Walking upward from every object is
  // cheap at this size and catches every cycle, including ones of length > 2.
  for (const object of spec.objects) {
    const seen = new Set<string>([object.id]);
    let current = holderOf.get(object.id);
    while (current !== undefined) {
      if (seen.has(current)) {
        throw new SimulatorError(`containment cycle through object: ${current}`);
      }
      seen.add(current);
      current = holderOf.get(current);
    }
  }

  return {
    spec,
    unlocked: new Set(),
    opened: new Set(),
    held: new Set(),
    solved: new Set(),
    escaped: false,
    holderOf,
    byId,
  };
}

export function objectById(state: RoomState, id: string): RoomObject | undefined {
  return state.byId.get(id);
}

/** An object with no lock is never locked; one with a lock is locked until it is unlocked. */
export function isLocked(state: RoomState, id: string): boolean {
  const object = state.byId.get(id);
  if (object === undefined || object.lock === null) return false;
  return !state.unlocked.has(id);
}

/**
 * THE GATING RULE of the whole simulator: can the competitor touch this object?
 *
 * An object is reachable when it is top-level, or when its holder is reachable
 * AND ITS HOLDER IS NOT LOCKED.
 *
 * ── Why the lock and not `open` ────────────────────────────────────────────
 * The obvious alternative is to gate on whether the holder has been `open`ed.
 * The golden fixture log settles it the other way: at `seq 5` model-b inspects
 * the `ledger` and receives `ok`, having never opened the `desk` that contains
 * it — the desk is unlocked, its drawer is literally described as hanging open,
 * so what is inside is in reach. Gating on `open` would turn that committed event
 * into `not_found` and force a regeneration of the corpus that #3, #4 and #8 are
 * all being built against.
 *
 * `open` keeps its job: it is what NAMES the contents back to the competitor, and
 * it is what returns `locked` when something is shut. Reachability is the lock.
 *
 * ── Why reachability is also secrecy ───────────────────────────────────────
 * An unreachable object is not merely un-actionable — a competitor must not learn
 * that it exists. `observation.ts` filters on this same predicate, and `resolve`
 * returns `not_found` (not a distinct "it's in the safe" code) for exactly that
 * reason.
 */
export function isReachable(state: RoomState, id: string): boolean {
  if (!state.byId.has(id)) return false;

  let holderId = state.holderOf.get(id);
  // `compileRoom` has already proved there are no cycles, so this terminates.
  while (holderId !== undefined) {
    if (isLocked(state, holderId)) return false;
    holderId = state.holderOf.get(holderId);
  }
  return true;
}

/** Top-level objects, in spec order — what `look` surveys. */
export function topLevelObjects(state: RoomState): RoomObject[] {
  return state.spec.objects.filter((object) => !state.holderOf.has(object.id));
}

/** Reachable contents of an object, in spec order — what a successful `open` names. */
export function contentsOf(state: RoomState, id: string): RoomObject[] {
  const object = state.byId.get(id);
  if (object === undefined) return [];
  return object.contains
    .map((childId) => state.byId.get(childId))
    .filter((child): child is RoomObject => child !== undefined);
}

/*
 * ── Transitions ────────────────────────────────────────────────────────────
 * Each returns a new state and leaves its argument untouched. They are exported
 * for `resolve` to build verdicts with, and deliberately NOT re-exported from
 * `index.ts`: a harness that could call `withUnlocked` directly would bypass
 * every rule this ticket exists to enforce.
 */

function withAdded(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  next.add(id);
  return next;
}

export function withUnlocked(state: RoomState, id: string): RoomState {
  return { ...state, unlocked: withAdded(state.unlocked, id) };
}

export function withOpened(state: RoomState, id: string): RoomState {
  return { ...state, opened: withAdded(state.opened, id) };
}

export function withHeld(state: RoomState, id: string): RoomState {
  return { ...state, held: withAdded(state.held, id) };
}

export function withSolved(state: RoomState, puzzleId: string): RoomState {
  return { ...state, solved: withAdded(state.solved, puzzleId) };
}

export function withEscaped(state: RoomState): RoomState {
  return { ...state, escaped: true };
}
