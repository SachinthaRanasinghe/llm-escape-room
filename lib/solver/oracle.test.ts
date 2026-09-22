import { describe, expect, it } from 'vitest';
import { SPEC_VERSION } from '@/lib/schema/version';
import { parseRoomSpec, type RoomObject, type RoomSpec } from '@/lib/schema/room';
import { compileRoom, resolve } from '@/lib/sim';
import { loadCanonicalRoom, loadInvalidRoom } from '@/fixtures';
import { checkDerivation } from './derivation';
import { intendedActionsFor, minActionsFor, solveRoom } from './oracle';

const canonical = loadCanonicalRoom();
const brokenChain = parseRoomSpec(loadInvalidRoom('broken-chain'));

const allDerivable = (spec: RoomSpec) => checkDerivation(spec).derivable;

/** Replay a path through a fresh engine — the proof that the path is really playable. */
function replay(spec: RoomSpec, actions: readonly import('@/lib/schema/action').Action[]) {
  let state = compileRoom(spec);
  const codes: string[] = [];
  for (const action of actions) {
    const result = resolve(state, action);
    codes.push(result.verdict.code);
    state = result.state;
  }
  return { escaped: state.escaped, codes };
}

describe('the canonical room', () => {
  it('escapes in six actions by the shortest route', () => {
    expect(minActionsFor(canonical, allDerivable(canonical))!.actionCount).toBe(6);
  });

  it('escapes in six actions along the intended chain', () => {
    expect(intendedActionsFor(canonical, allDerivable(canonical))!.actionCount).toBe(6);
  });

  it('takes the route the room was designed around', () => {
    const path = intendedActionsFor(canonical, allDerivable(canonical))!;
    expect(path.actions.map((a) => a.name)).toEqual([
      'inspect',
      'enter_code',
      'inspect',
      'enter_code',
      'inspect',
      'submit_answer',
    ]);
  });

  it('produces a path that really plays — every verdict ok, ending escaped', () => {
    const path = intendedActionsFor(canonical, allDerivable(canonical))!;
    const { escaped, codes } = replay(canonical, path.actions);
    expect(codes.every((c) => c === 'ok')).toBe(true);
    expect(escaped).toBe(true);
  });
});

describe('the knowledge gate', () => {
  it('finds no route when a puzzle is not derivable', () => {
    // Remove p2 from the derivable set: the cabinet code can never be learned.
    const derivable = new Set(['p1', 'p3']);
    expect(minActionsFor(canonical, derivable)).toBeNull();
  });

  it('finds no route when nothing at all is derivable', () => {
    expect(minActionsFor(canonical, new Set())).toBeNull();
  });

  it('is what makes the unsolvable fixture unsolvable', () => {
    const spec = parseRoomSpec(loadInvalidRoom('unsolvable'));
    const { derivable } = checkDerivation(spec);
    expect(derivable.has('p2')).toBe(false);
    expect(minActionsFor(spec, derivable)).toBeNull();
  });

  it('would certify that same room if the gate were removed', () => {
    // The positive control. Without the gate the search proves nothing at all,
    // because the oracle holds every answer in plaintext.
    const spec = parseRoomSpec(loadInvalidRoom('unsolvable'));
    expect(minActionsFor(spec, new Set(['p1', 'p2', 'p3']))).not.toBeNull();
  });
});

describe('the broken-chain fixture', () => {
  it('has a four-action shortcut, because the sea chart was orphaned to the floor', () => {
    expect(minActionsFor(brokenChain, allDerivable(brokenChain))!.actionCount).toBe(4);
  });

  it('still takes six along the intended chain', () => {
    expect(intendedActionsFor(brokenChain, allDerivable(brokenChain))!.actionCount).toBe(6);
  });

  it('is exactly the gap verify.ts reads as a broken chain', () => {
    const min = minActionsFor(brokenChain, allDerivable(brokenChain))!.actionCount;
    const intended = intendedActionsFor(brokenChain, allDerivable(brokenChain))!.actionCount;
    expect(min).toBeLessThan(intended);
  });

  it('skips the wall safe entirely on the short route', () => {
    const path = minActionsFor(brokenChain, allDerivable(brokenChain))!;
    const targets = path.actions.map((a) => ('targetId' in a ? a.targetId : a.name));
    expect(targets).not.toContain('wall-safe');
  });
});

describe('key locks', () => {
  /** The canonical room has no key lock, so this mirrors `keyRoom` in resolve.test.ts. */
  function keyRoom(): RoomSpec {
    const objects: RoomObject[] = [
      { id: 'hook', name: 'hook', description: 'A hook.', kind: 'fixture', lock: null, contains: ['key'], clueText: 'A brass key hangs here, stamped north.' },
      { id: 'key', name: 'brass key', description: 'A brass key.', kind: 'portable', lock: null, contains: [], clueText: null },
      { id: 'door', name: 'door', description: 'A door.', kind: 'door', lock: { opensWith: 'key', keyItemId: 'key' }, contains: [], clueText: null },
    ];
    return {
      specVersion: SPEC_VERSION,
      seed: 'key-room',
      roomId: 'key-room',
      theme: { name: 'Cell', description: 'A bare cell.' },
      objects,
      puzzles: [{ id: 'p1', order: 1, kind: 'answer', clueObjectId: 'hook', answer: 'north', unlocksObjectId: 'door' }],
      exit: { objectId: 'door', requiresPuzzleId: 'p1' },
      difficulty: { band: 'easy', estimatedActions: 2 },
      solution: { order: ['p1'] },
    };
  }

  it('solves a single-puzzle room in two actions', () => {
    const spec = keyRoom();
    expect(minActionsFor(spec, allDerivable(spec))!.actionCount).toBe(2);
  });

  it('spends take and use when the lock needs a key', () => {
    // Same room, but the door is opened by the key rather than by answering.
    const spec = keyRoom();
    spec.puzzles[0]!.kind = 'code';
    spec.puzzles[0]!.answer = '1234';
    spec.objects[0]!.clueText = 'The key opens it; the plate reads 1234.';
    const path = minActionsFor(spec, allDerivable(spec))!;
    expect(path.actions.map((a) => a.name)).toEqual(['inspect', 'take', 'use']);
    expect(replay(spec, path.actions).escaped).toBe(true);
  });
});

describe('rooms with no way out', () => {
  it('returns null when the only clue is sealed inside the lock it opens', () => {
    const objects: RoomObject[] = [
      { id: 'safe', name: 'safe', description: 'A safe.', kind: 'lock', lock: { opensWith: 'code', code: '1234' }, contains: ['note'], clueText: null },
      { id: 'note', name: 'note', description: 'A note.', kind: 'portable', lock: null, contains: [], clueText: 'It reads 1234.' },
      { id: 'door', name: 'door', description: 'A door.', kind: 'door', lock: null, contains: [], clueText: null },
    ];
    const spec: RoomSpec = {
      specVersion: SPEC_VERSION,
      seed: 'sealed',
      roomId: 'sealed',
      theme: { name: 'Cell', description: 'A bare cell.' },
      objects,
      puzzles: [{ id: 'p1', order: 1, kind: 'code', clueObjectId: 'note', answer: '1234', unlocksObjectId: 'safe' }],
      exit: { objectId: 'door', requiresPuzzleId: 'p1' },
      difficulty: { band: 'easy', estimatedActions: 2 },
      solution: { order: ['p1'] },
    };
    expect(minActionsFor(spec, allDerivable(spec))).toBeNull();
  });
});

describe('determinism', () => {
  it('returns the same path every time', () => {
    const a = intendedActionsFor(canonical, allDerivable(canonical))!;
    const b = intendedActionsFor(canonical, allDerivable(canonical))!;
    expect(a.actions).toEqual(b.actions);
  });

  it('does not mutate the spec it is given', () => {
    const before = JSON.stringify(canonical);
    solveRoom(canonical, { derivable: allDerivable(canonical), respectSolutionOrder: false });
    expect(JSON.stringify(canonical)).toBe(before);
  });
});
