import type { LaneRoomState, ReplayLane, SceneLayout } from './types';

/**
 * What one lane's copy of the room looks like after a given beat — which lids
 * are up, which locks are green, what the character is carrying.
 *
 * Derived from `ok` verdicts in the log and nothing else. The replay does not
 * re-simulate (`boundary.test.ts` forbids importing `lib/sim`): the simulator
 * already decided, and the log is the record of what it decided. A failed
 * action changes nothing, and an action on an object that does not exist
 * changes nothing either.
 *
 * `settled` says whether the CURRENT beat's verdict has landed yet. A safe swings
 * open when the verdict does, not when the character starts walking toward it.
 */

const EMPTY: LaneRoomState = { opened: [], unlocked: [], held: [], escaped: false };

export function laneStateAt(lane: ReplayLane, layout: SceneLayout, beatIndex: number, settled: boolean): LaneRoomState {
  const last = settled ? beatIndex : beatIndex - 1;
  if (last < 0) return EMPTY;

  const opened = new Set<string>();
  const unlocked = new Set<string>();
  const held = new Set<string>();
  let escaped = false;

  for (const beat of lane.beats.slice(0, last + 1)) {
    if (!beat.verdict.ok || beat.targetId === null) continue;
    switch (beat.verb) {
      case 'open':
        opened.add(beat.targetId);
        break;
      case 'take':
        held.add(beat.targetId);
        break;
      case 'enter_code':
      case 'use':
      case 'submit_answer':
        unlocked.add(beat.targetId);
        if (beat.targetId === layout.exitObjectId) {
          escaped = true;
          opened.add(beat.targetId);
        }
        break;
      default:
        break;
    }
  }

  // Belt and braces: the run says this lane escaped, and its last beat has landed.
  if (lane.escaped && last >= lane.beats.length - 1) {
    escaped = true;
    opened.add(layout.exitObjectId);
  }

  return { opened: [...opened].sort(), unlocked: [...unlocked].sort(), held: [...held].sort(), escaped };
}
