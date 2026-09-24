import { describe, expect, it } from 'vitest';
import { SPEC_VERSION } from '@/lib/schema/version';
import type { Action } from '@/lib/schema/action';
import type { RoomSpec } from '@/lib/schema/room';
import { loadCanonicalRoom } from '@/fixtures';
import { compileRoom, withHeld, withUnlocked, type RoomState } from './state';
import { resolve } from './resolve';

const room = loadCanonicalRoom();
const fresh = compileRoom(room);

/** Every action carries an intent; the tests do not care what it says. */
function act<T extends Omit<Action, 'intent'>>(action: T): Action {
  return { ...action, intent: 'test' } as Action;
}

function run(state: RoomState, ...actions: Action[]): { state: RoomState; codes: string[] } {
  let current = state;
  const codes: string[] = [];
  for (const action of actions) {
    const result = resolve(current, action);
    current = result.state;
    codes.push(result.verdict.code);
  }
  return { state: current, codes };
}

/**
 * The canonical room is code-locked throughout, so `use` and its key lock have no
 * fixture to be tested against. This is the smallest room that exercises them.
 */
const keyRoom: RoomSpec = {
  specVersion: SPEC_VERSION,
  seed: 'key-room',
  roomId: 'key-room',
  theme: { name: 'Cellar', description: 'A brick cellar.' },
  objects: [
    { id: 'hook', name: 'iron hook', description: 'A hook in the wall.', kind: 'fixture', lock: null, contains: ['key'], clueText: null },
    { id: 'key', name: 'brass key', description: 'A small brass key.', kind: 'portable', lock: null, contains: [], clueText: 'Its bow is stamped with a crown.' },
    { id: 'spoon', name: 'tin spoon', description: 'A bent tin spoon.', kind: 'portable', lock: null, contains: [], clueText: null },
    { id: 'gate', name: 'iron gate', description: 'A barred gate.', kind: 'door', lock: { opensWith: 'key', keyItemId: 'key' }, contains: [], clueText: null },
  ],
  puzzles: [{ id: 'k1', order: 1, kind: 'answer', clueObjectId: 'key', answer: 'crown', unlocksObjectId: 'gate' }],
  exit: { objectId: 'gate', requiresPuzzleId: 'k1' },
  difficulty: { band: 'easy', estimatedActions: 4 },
  solution: { order: ['k1'] },
};

describe('resolve — look', () => {
  it('always succeeds and names the room', () => {
    const { verdict } = resolve(fresh, act({ name: 'look' }));
    expect(verdict.code).toBe('ok');
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toContain('wall safe');
  });
});

describe('resolve — inspect', () => {
  it('returns the clue of a reachable object', () => {
    const { verdict } = resolve(fresh, act({ name: 'inspect', targetId: 'ledger' }));
    expect(verdict.code).toBe('ok');
    expect(verdict.message).toContain('4471');
  });

  it('falls back to the description when an object has no clue', () => {
    const state = compileRoom(keyRoom);
    const { verdict } = resolve(state, act({ name: 'inspect', targetId: 'spoon' }));
    expect(verdict.code).toBe('ok');
    expect(verdict.message).toBe('A bent tin spoon.');
  });

  it('is not_found for an object that does not exist', () => {
    expect(resolve(fresh, act({ name: 'inspect', targetId: 'bookshelf' })).verdict.code).toBe('not_found');
  });

  /** The secrecy rule: out of reach is indistinguishable from not there. */
  it('is not_found for a real object sealed in a locked container', () => {
    const { verdict } = resolve(fresh, act({ name: 'inspect', targetId: 'sea-chart' }));
    expect(verdict.code).toBe('not_found');
    expect(verdict.message).not.toContain('safe');
  });

  it('reaches that same object once the lock is open', () => {
    const state = withUnlocked(fresh, 'wall-safe');
    const { verdict } = resolve(state, act({ name: 'inspect', targetId: 'sea-chart' }));
    expect(verdict.code).toBe('ok');
    expect(verdict.message).toContain('1770');
  });
});

/**
 * TICKET-7 (#8): a competitor must be able to learn every id it needs from what
 * the simulator says, not by guessing. Ids are not secrets; answers are.
 */
describe('resolve — ids a competitor can act on', () => {
  it('names each object in look with its id', () => {
    const { verdict } = resolve(fresh, act({ name: 'look' }));
    expect(verdict.message).toContain('writing desk [desk]');
    expect(verdict.message).toContain('wall safe [wall-safe]');
  });

  it('names what an opened container holds with its id', () => {
    const { verdict } = resolve(fresh, act({ name: 'open', targetId: 'desk' }));
    expect(verdict.message).toContain('[ledger]');
  });

  it('names the answer puzzle id on inspecting its clue, never the answer beyond the clue', () => {
    const state = withUnlocked(withUnlocked(fresh, 'wall-safe'), 'cabinet');
    const { verdict } = resolve(state, act({ name: 'inspect', targetId: 'logbook' }));
    expect(verdict.message).toContain('puzzleId "p3"');
  });

  it('names the answer puzzle id on inspecting what the answer opens', () => {
    const { verdict } = resolve(fresh, act({ name: 'inspect', targetId: 'door' }));
    expect(verdict.message).toContain('puzzleId "p3"');
    expect(verdict.message.toLowerCase()).not.toContain('north');
  });

  it('gives no puzzle id for a code clue — the lock id is enough', () => {
    const { verdict } = resolve(fresh, act({ name: 'inspect', targetId: 'ledger' }));
    expect(verdict.message).not.toContain('puzzleId');
  });

  it('stops hinting once the puzzle is solved', () => {
    const solved = run(fresh, act({ name: 'submit_answer', puzzleId: 'p3', answer: 'north' })).state;
    expect(resolve(solved, act({ name: 'inspect', targetId: 'door' })).verdict.message).not.toContain('puzzleId');
  });
});

describe('resolve — take', () => {
  it('picks up a reachable portable object', () => {
    const { verdict, state } = resolve(fresh, act({ name: 'take', targetId: 'ledger' }));
    expect(verdict.code).toBe('ok');
    expect(state.held.has('ledger')).toBe(true);
  });

  it('is not_permitted for something that cannot be carried', () => {
    expect(resolve(fresh, act({ name: 'take', targetId: 'cabinet' })).verdict.code).toBe('not_permitted');
    expect(resolve(fresh, act({ name: 'take', targetId: 'window' })).verdict.code).toBe('not_permitted');
  });

  it('is not_found for an unreachable portable', () => {
    expect(resolve(fresh, act({ name: 'take', targetId: 'logbook' })).verdict.code).toBe('not_found');
  });

  it('is a harmless ok when already carried', () => {
    const state = withHeld(fresh, 'ledger');
    expect(resolve(state, act({ name: 'take', targetId: 'ledger' })).verdict.code).toBe('ok');
  });
});

describe('resolve — open', () => {
  it('opens an unlocked container and names what is inside', () => {
    const { verdict, state } = resolve(fresh, act({ name: 'open', targetId: 'desk' }));
    expect(verdict.code).toBe('ok');
    expect(verdict.message).toContain('accounts ledger');
    expect(state.opened.has('desk')).toBe(true);
  });

  it('is locked for something shut', () => {
    const { verdict } = resolve(fresh, act({ name: 'open', targetId: 'wall-safe' }));
    expect(verdict.code).toBe('locked');
    expect(verdict.ok).toBe(false);
  });

  it('is not_permitted for a portable or a fixture', () => {
    expect(resolve(fresh, act({ name: 'open', targetId: 'ledger' })).verdict.code).toBe('not_permitted');
    expect(resolve(fresh, act({ name: 'open', targetId: 'window' })).verdict.code).toBe('not_permitted');
  });

  it('is not_found for an unknown object', () => {
    expect(resolve(fresh, act({ name: 'open', targetId: 'bookshelf' })).verdict.code).toBe('not_found');
  });

  it('says so plainly when an opened container is empty', () => {
    const state = withUnlocked(compileRoom(keyRoom), 'gate');
    const { verdict } = resolve(state, act({ name: 'open', targetId: 'gate' }));
    expect(verdict.code).toBe('ok');
    expect(verdict.message).toContain('nothing inside');
  });
});

describe('resolve — use', () => {
  const cellar = compileRoom(keyRoom);

  it('unlocks a key lock with the right key in hand', () => {
    const state = withHeld(cellar, 'key');
    const { verdict, state: next } = resolve(state, act({ name: 'use', itemId: 'key', targetId: 'gate' }));
    expect(verdict.code).toBe('ok');
    expect(next.unlocked.has('gate')).toBe(true);
  });

  it('is not_holding when the item is not carried', () => {
    expect(resolve(cellar, act({ name: 'use', itemId: 'key', targetId: 'gate' })).verdict.code).toBe('not_holding');
  });

  it('is wrong_key when the wrong item is applied — a mistake, not a locked door', () => {
    const state = withHeld(cellar, 'spoon');
    expect(resolve(state, act({ name: 'use', itemId: 'spoon', targetId: 'gate' })).verdict.code).toBe('wrong_key');
  });

  it('is not_permitted against something with no lock', () => {
    const state = withHeld(cellar, 'key');
    expect(resolve(state, act({ name: 'use', itemId: 'key', targetId: 'hook' })).verdict.code).toBe('not_permitted');
  });

  it('is not_permitted against a code lock', () => {
    const state = withHeld(fresh, 'ledger');
    expect(resolve(state, act({ name: 'use', itemId: 'ledger', targetId: 'wall-safe' })).verdict.code).toBe(
      'not_permitted',
    );
  });

  it('is not_found for an unknown target', () => {
    expect(resolve(cellar, act({ name: 'use', itemId: 'key', targetId: 'hatch' })).verdict.code).toBe('not_found');
  });
});

describe('resolve — enter_code', () => {
  it('unlocks on the right code and solves the puzzle behind it', () => {
    const { verdict, state } = resolve(fresh, act({ name: 'enter_code', targetId: 'wall-safe', code: '4471' }));
    expect(verdict.code).toBe('ok');
    expect(state.unlocked.has('wall-safe')).toBe(true);
    expect(state.solved.has('p1')).toBe(true);
  });

  it('is wrong_code on a miss, and changes nothing', () => {
    const { verdict, state } = resolve(fresh, act({ name: 'enter_code', targetId: 'wall-safe', code: '7777' }));
    expect(verdict.code).toBe('wrong_code');
    expect(state.unlocked.size).toBe(0);
    expect(state.solved.size).toBe(0);
  });

  it('is not_permitted against something with no lock', () => {
    expect(resolve(fresh, act({ name: 'enter_code', targetId: 'door', code: '1234' })).verdict.code).toBe(
      'not_permitted',
    );
  });

  it('is not_permitted against a key lock', () => {
    const state = compileRoom(keyRoom);
    expect(resolve(state, act({ name: 'enter_code', targetId: 'gate', code: '1234' })).verdict.code).toBe(
      'not_permitted',
    );
  });

  it('is not_found for an unknown target', () => {
    expect(resolve(fresh, act({ name: 'enter_code', targetId: 'bookshelf', code: '1234' })).verdict.code).toBe(
      'not_found',
    );
  });

  it('accepts a code with surrounding whitespace', () => {
    expect(resolve(fresh, act({ name: 'enter_code', targetId: 'wall-safe', code: ' 4471 ' })).verdict.code).toBe('ok');
  });
});

describe('resolve — submit_answer', () => {
  it('solves an answer puzzle and opens what it unlocks', () => {
    const { verdict, state } = resolve(fresh, act({ name: 'submit_answer', puzzleId: 'p3', answer: 'north' }));
    expect(verdict.code).toBe('ok');
    expect(state.solved.has('p3')).toBe(true);
    expect(state.unlocked.has('door')).toBe(true);
  });

  it('matches case-insensitively after trimming', () => {
    expect(resolve(fresh, act({ name: 'submit_answer', puzzleId: 'p3', answer: '  NORTH ' })).verdict.code).toBe('ok');
  });

  it('is wrong_answer on a miss', () => {
    const { verdict, state } = resolve(fresh, act({ name: 'submit_answer', puzzleId: 'p3', answer: 'south' }));
    expect(verdict.code).toBe('wrong_answer');
    expect(state.solved.size).toBe(0);
  });

  it('is not_found for a puzzle that does not exist', () => {
    expect(resolve(fresh, act({ name: 'submit_answer', puzzleId: 'p9', answer: 'north' })).verdict.code).toBe(
      'not_found',
    );
  });

  it('refuses a key puzzle and points at its lock, never naming the key', () => {
    const spec: RoomSpec = {
      ...keyRoom,
      puzzles: [{ id: 'k1', order: 1, kind: 'key', clueObjectId: 'hook', answer: 'key', unlocksObjectId: 'gate' }],
    };
    const { verdict } = resolve(compileRoom(spec), act({ name: 'submit_answer', puzzleId: 'k1', answer: 'key' }));
    expect(verdict.code).toBe('not_permitted');
    expect(verdict.message).toContain('iron gate');
    expect(verdict.message).not.toContain('brass');
  });

  /** A code puzzle has a lock to type into; answering it in the abstract would make the lock decorative. */
  it('refuses a code puzzle and points at the lock instead', () => {
    const { verdict } = resolve(fresh, act({ name: 'submit_answer', puzzleId: 'p1', answer: '4471' }));
    expect(verdict.code).toBe('not_permitted');
    expect(verdict.message).toContain('wall safe');
  });
});

describe('resolve — escape', () => {
  it('escapes the moment the exit puzzle is solved, with no further action', () => {
    const { state } = resolve(fresh, act({ name: 'submit_answer', puzzleId: 'p3', answer: 'north' }));
    expect(state.escaped).toBe(true);
  });

  it('does not escape on solving an earlier puzzle', () => {
    const { state } = resolve(fresh, act({ name: 'enter_code', targetId: 'wall-safe', code: '4471' }));
    expect(state.solved.has('p1')).toBe(true);
    expect(state.escaped).toBe(false);
  });

  it('walks the whole canonical chain', () => {
    const { state, codes } = run(
      fresh,
      act({ name: 'inspect', targetId: 'ledger' }),
      act({ name: 'enter_code', targetId: 'wall-safe', code: '4471' }),
      act({ name: 'open', targetId: 'wall-safe' }),
      act({ name: 'inspect', targetId: 'sea-chart' }),
      act({ name: 'enter_code', targetId: 'cabinet', code: '1770' }),
      act({ name: 'open', targetId: 'cabinet' }),
      act({ name: 'inspect', targetId: 'logbook' }),
      act({ name: 'submit_answer', puzzleId: 'p3', answer: 'north' }),
    );
    expect(codes.every((code) => code === 'ok')).toBe(true);
    expect(state.solved.size).toBe(3);
    expect(state.escaped).toBe(true);
  });
});

describe('resolve — purity', () => {
  it('gives the same verdict for the same state and action, twice', () => {
    const action = act({ name: 'enter_code', targetId: 'wall-safe', code: '4471' });
    expect(resolve(fresh, action).verdict).toEqual(resolve(fresh, action).verdict);
  });

  it('never mutates the state it was given', () => {
    const before = {
      unlocked: fresh.unlocked.size,
      opened: fresh.opened.size,
      held: fresh.held.size,
      solved: fresh.solved.size,
    };
    resolve(fresh, act({ name: 'enter_code', targetId: 'wall-safe', code: '4471' }));
    resolve(fresh, act({ name: 'take', targetId: 'ledger' }));
    resolve(fresh, act({ name: 'open', targetId: 'desk' }));
    resolve(fresh, act({ name: 'submit_answer', puzzleId: 'p3', answer: 'north' }));

    expect(fresh.unlocked.size).toBe(before.unlocked);
    expect(fresh.opened.size).toBe(before.opened);
    expect(fresh.held.size).toBe(before.held);
    expect(fresh.solved.size).toBe(before.solved);
    expect(fresh.escaped).toBe(false);
  });

  it('does not mutate the spec it was compiled from', () => {
    const snapshot = JSON.stringify(room);
    resolve(fresh, act({ name: 'enter_code', targetId: 'wall-safe', code: '4471' }));
    expect(JSON.stringify(room)).toBe(snapshot);
  });
});
