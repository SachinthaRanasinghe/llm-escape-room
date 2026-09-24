import type { RoomObject, RoomSpec } from '@/lib/schema/room';
import type { SceneLayout, SceneObject, Vec2 } from './types';

/**
 * The room, as the replay is allowed to know it.
 *
 * ── This file is the replay's secrecy boundary ─────────────────────────────
 * The scene needs the room — the log names `targetId`s but not what kind of
 * thing each one is, `submit_answer` names a puzzle rather than an object, and
 * a model will happily name an object that does not exist. But a `RoomSpec`
 * carries every lock code and every answer, and TICKET-9's (#9) published
 * artifact deliberately does not include one.
 *
 * So the server page calls this once and hands the CLIENT only the result.
 * TICKET-9 freezes that result into the render manifest, which is why it is
 * plain data with deterministic positions rather than something recomputed per
 * viewer.
 *
 * ── Build by listing, never by spreading ───────────────────────────────────
 * The same rule as `lib/sim/observation.ts`: every `SceneObject` field is named
 * below. A spread of `RoomObject` with the secrets deleted is one forgotten
 * `delete` away from publishing a lock code, and the next secret someone adds to
 * `RoomObject` would leak with no line of this file changing. `layout.test.ts`
 * asserts the exact key set.
 *
 * Type imports only: this is called on the server, but it lives where the client
 * lives, and `boundary.test.ts` forbids a value import of the room schema here.
 */

/** Half the width of the square floor. Walls stand at ±ROOM_HALF. */
export const ROOM_HALF = 4;
/** How far a wall-standing object is set in from its wall. */
const INSET = 0.8;
const BACK_Z = -(ROOM_HALF - INSET);
const SIDE_X = ROOM_HALF - INSET;
/** Half the width of the back-wall gap kept clear for the exit. */
const EXIT_GAP = 1.6;
/** Spacing between objects standing along a side wall. */
const SIDE_STEP = 1.6;
/** Where a character stands to look around. Slightly forward, so it faces the back wall. */
const CENTRE: Vec2 = [0, 1];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `n` points evenly spaced over the closed interval [from, to]; one point sits in the middle. */
function spread(n: number, from: number, to: number): number[] {
  if (n === 1) return [round((from + to) / 2)];
  return Array.from({ length: n }, (_, i) => round(from + ((to - from) * i) / (n - 1)));
}

/**
 * Wall slots for the non-exit top-level objects. The back wall takes up to four,
 * two either side of the gap the exit owns; the side walls take the rest,
 * back-to-front, left before right. Deterministic in `n` alone.
 */
function wallSlots(n: number): Vec2[] {
  const back = Math.min(n, 4);
  const backLeft = Math.ceil(back / 2);
  const sides = n - back;
  const left = Math.ceil(sides / 2);

  const slots: Vec2[] = [
    ...spread(backLeft, -SIDE_X, -EXIT_GAP).map((x): Vec2 => [x, BACK_Z]),
    ...spread(back - backLeft, EXIT_GAP, SIDE_X).map((x): Vec2 => [x, BACK_Z]),
  ];
  const sideFrom = BACK_Z + SIDE_STEP;
  for (const z of spread(left, sideFrom, sideFrom + SIDE_STEP * Math.max(left - 1, 0))) slots.push([-SIDE_X, z]);
  const right = sides - left;
  for (const z of spread(right, sideFrom, sideFrom + SIDE_STEP * Math.max(right - 1, 0))) slots.push([SIDE_X, z]);
  return slots;
}

function holders(objects: readonly RoomObject[]): Map<string, string> {
  const holderOf = new Map<string, string>();
  for (const object of objects) {
    for (const child of object.contains) {
      if (!holderOf.has(child)) holderOf.set(child, object.id);
    }
  }
  return holderOf;
}

export function buildSceneLayout(room: RoomSpec): SceneLayout {
  const holderOf = holders(room.objects);
  const exitId = room.exit.objectId;

  const standing = room.objects.filter((o) => !holderOf.has(o.id) && o.id !== exitId);
  const slots = wallSlots(standing.length);
  const floor = new Map<string, Vec2>(standing.map((o, i) => [o.id, slots[i]]));
  floor.set(exitId, [0, round(BACK_Z - 0.4)]);

  function positionOf(id: string, seen: ReadonlySet<string> = new Set()): Vec2 {
    const own = floor.get(id);
    if (own) return own;
    const parent = holderOf.get(id);
    // A containment cycle is the solver's to reject; here it just falls back to the centre.
    if (!parent || seen.has(parent)) return CENTRE;
    return positionOf(parent, new Set([...seen, id]));
  }

  const objects: SceneObject[] = room.objects.map((o) => ({
    id: o.id,
    name: o.name,
    kind: o.kind,
    parentId: holderOf.get(o.id) ?? null,
    position: positionOf(o.id),
  }));

  return {
    roomId: room.roomId,
    themeName: room.theme.name,
    objects,
    puzzleTargets: Object.fromEntries(room.puzzles.map((p) => [p.id, p.unlocksObjectId])),
    exitObjectId: exitId,
    centre: CENTRE,
  };
}
