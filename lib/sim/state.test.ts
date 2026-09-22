import { describe, expect, it } from 'vitest';
import { SPEC_VERSION } from '@/lib/schema/version';
import type { RoomObject, RoomSpec } from '@/lib/schema/room';
import { loadCanonicalRoom } from '@/fixtures';
import {
  SimulatorError,
  compileRoom,
  contentsOf,
  isLocked,
  isReachable,
  objectById,
  topLevelObjects,
  withEscaped,
  withHeld,
  withOpened,
  withSolved,
  withUnlocked,
} from './state';

const room = loadCanonicalRoom();

/**
 * A minimal structurally-valid spec whose OBJECT GRAPH can be broken one way at
 * a time. It has to be built by hand rather than taken from `fixtures/`, because
 * every committed fixture is referentially sound — the invalid corpus in
 * `fixtures/rooms/invalid/` breaks SEMANTIC rules, which are #3's problem, not
 * the containment rules `compileRoom` guards.
 */
function specWithObjects(objects: RoomObject[]): RoomSpec {
  return {
    specVersion: SPEC_VERSION,
    seed: 'sim-state-test',
    roomId: 'sim-state-test',
    theme: { name: 'Cell', description: 'A bare cell.' },
    objects,
    puzzles: [
      { id: 'p1', order: 1, kind: 'answer', clueObjectId: objects[0]!.id, answer: 'out', unlocksObjectId: objects[0]!.id },
    ],
    exit: { objectId: objects[0]!.id, requiresPuzzleId: 'p1' },
    difficulty: { band: 'easy', estimatedActions: 3 },
    solution: { order: ['p1'] },
  };
}

function object(id: string, contains: string[] = [], lock: RoomObject['lock'] = null): RoomObject {
  return {
    id,
    name: id,
    description: `A ${id}.`,
    kind: contains.length > 0 ? 'container' : 'portable',
    lock,
    contains,
    clueText: null,
  };
}

describe('compileRoom', () => {
  it('indexes every object by id', () => {
    const state = compileRoom(room);
    expect(state.byId.size).toBe(room.objects.length);
    expect(objectById(state, 'wall-safe')?.name).toBe('wall safe');
    expect(objectById(state, 'bookshelf')).toBeUndefined();
  });

  it('inverts containment into holderOf', () => {
    const state = compileRoom(room);
    expect(state.holderOf.get('ledger')).toBe('desk');
    expect(state.holderOf.get('sea-chart')).toBe('wall-safe');
    expect(state.holderOf.get('logbook')).toBe('cabinet');
    expect(state.holderOf.has('desk')).toBe(false);
  });

  it('starts with nothing unlocked, opened, held, solved or escaped', () => {
    const state = compileRoom(room);
    expect(state.unlocked.size).toBe(0);
    expect(state.opened.size).toBe(0);
    expect(state.held.size).toBe(0);
    expect(state.solved.size).toBe(0);
    expect(state.escaped).toBe(false);
  });

  it('rejects a spec whose contains names an object that does not exist', () => {
    const spec = specWithObjects([object('chest', ['ghost'])]);
    expect(() => compileRoom(spec)).toThrow(SimulatorError);
    expect(() => compileRoom(spec)).toThrow(/unknown object: ghost/);
  });

  it('rejects a spec where two objects claim the same child', () => {
    const spec = specWithObjects([object('chest', ['coin']), object('crate', ['coin']), object('coin')]);
    expect(() => compileRoom(spec)).toThrow(/contained by both chest and crate/);
  });

  it('rejects a spec with duplicate object ids', () => {
    const spec = specWithObjects([object('chest'), object('chest')]);
    expect(() => compileRoom(spec)).toThrow(/duplicate object id: chest/);
  });

  it('rejects an object that contains itself', () => {
    const spec = specWithObjects([object('chest', ['chest'])]);
    expect(() => compileRoom(spec)).toThrow(/contains itself/);
  });

  it('rejects a containment cycle rather than hanging on it', () => {
    const spec = specWithObjects([object('a', ['b']), object('b', ['c']), object('c', ['a'])]);
    expect(() => compileRoom(spec)).toThrow(/containment cycle/);
  });
});

describe('isLocked', () => {
  it('is false for an object with no lock', () => {
    expect(isLocked(compileRoom(room), 'desk')).toBe(false);
  });

  it('is true for a locked object and false once unlocked', () => {
    const state = compileRoom(room);
    expect(isLocked(state, 'wall-safe')).toBe(true);
    expect(isLocked(withUnlocked(state, 'wall-safe'), 'wall-safe')).toBe(false);
  });

  it('is false for an object that does not exist', () => {
    expect(isLocked(compileRoom(room), 'bookshelf')).toBe(false);
  });
});

describe('isReachable', () => {
  it('reaches every top-level object from the start', () => {
    const state = compileRoom(room);
    for (const top of ['desk', 'wall-safe', 'cabinet', 'door', 'window']) {
      expect(isReachable(state, top)).toBe(true);
    }
  });

  /**
   * The rule this ticket turns on, and the one the golden log settles: the
   * `desk` is unlocked, so the `ledger` inside it is in reach WITHOUT anyone
   * having opened the desk. Gating on `open` instead would make the committed
   * log's `seq 5` a `not_found`.
   */
  it('reaches the contents of an unlocked container without opening it', () => {
    const state = compileRoom(room);
    expect(state.opened.has('desk')).toBe(false);
    expect(isReachable(state, 'ledger')).toBe(true);
  });

  it('does not reach the contents of a locked container', () => {
    const state = compileRoom(room);
    expect(isReachable(state, 'sea-chart')).toBe(false);
    expect(isReachable(state, 'logbook')).toBe(false);
  });

  it('reaches the contents once the lock is opened', () => {
    const state = withUnlocked(compileRoom(room), 'wall-safe');
    expect(isReachable(state, 'sea-chart')).toBe(true);
    expect(isReachable(state, 'logbook')).toBe(false);
  });

  it('does not reach an object that does not exist', () => {
    expect(isReachable(compileRoom(room), 'bookshelf')).toBe(false);
  });

  it('walks the whole holder chain, not just one level', () => {
    const spec = specWithObjects([
      object('vault', ['box'], { opensWith: 'code', code: '1234' }),
      object('box', ['gem']),
      object('gem'),
    ]);
    const state = compileRoom(spec);
    expect(isReachable(state, 'gem')).toBe(false);
    expect(isReachable(withUnlocked(state, 'vault'), 'gem')).toBe(true);
  });
});

describe('topLevelObjects and contentsOf', () => {
  it('surveys only the objects nothing else holds', () => {
    const ids = topLevelObjects(compileRoom(room)).map((o) => o.id);
    expect(ids).toEqual(['desk', 'wall-safe', 'cabinet', 'door', 'window']);
  });

  it('lists what an object holds, in spec order', () => {
    expect(contentsOf(compileRoom(room), 'wall-safe').map((o) => o.id)).toEqual(['sea-chart']);
    expect(contentsOf(compileRoom(room), 'ledger')).toEqual([]);
    expect(contentsOf(compileRoom(room), 'bookshelf')).toEqual([]);
  });
});

describe('transitions', () => {
  it('leave the state they were given untouched', () => {
    const state = compileRoom(room);

    withUnlocked(state, 'wall-safe');
    withOpened(state, 'desk');
    withHeld(state, 'ledger');
    withSolved(state, 'p1');
    withEscaped(state);

    expect(state.unlocked.size).toBe(0);
    expect(state.opened.size).toBe(0);
    expect(state.held.size).toBe(0);
    expect(state.solved.size).toBe(0);
    expect(state.escaped).toBe(false);
  });

  it('accumulate across successive applications', () => {
    const state = withSolved(withHeld(withUnlocked(compileRoom(room), 'wall-safe'), 'ledger'), 'p1');
    expect(state.unlocked.has('wall-safe')).toBe(true);
    expect(state.held.has('ledger')).toBe(true);
    expect(state.solved.has('p1')).toBe(true);
    expect(state.escaped).toBe(false);
    expect(withEscaped(state).escaped).toBe(true);
  });
});
