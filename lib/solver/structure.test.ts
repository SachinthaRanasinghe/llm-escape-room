import { describe, expect, it } from 'vitest';
import { SPEC_VERSION } from '@/lib/schema/version';
import type { RoomObject, RoomSpec } from '@/lib/schema/room';
import { loadCanonicalRoom } from '@/fixtures';
import { answersMatch, checkStructure } from './structure';
import { codesOf } from './rejections';

/**
 * A minimal two-puzzle room that can be broken one rule at a time. Hand-built
 * rather than taken from `fixtures/`, exactly as `lib/sim/state.test.ts` does:
 * every committed fixture is a variation of one room and cannot exercise key
 * locks, short chains, or a misplaced exit.
 */
function baseSpec(): RoomSpec {
  const objects: RoomObject[] = [
    { id: 'shelf', name: 'shelf', description: 'A shelf.', kind: 'container', lock: null, contains: ['note'], clueText: null },
    { id: 'note', name: 'note', description: 'A note.', kind: 'portable', lock: null, contains: [], clueText: 'It reads 1234.' },
    { id: 'box', name: 'box', description: 'A box.', kind: 'container', lock: { opensWith: 'code', code: '1234' }, contains: ['map'], clueText: null },
    { id: 'map', name: 'map', description: 'A map.', kind: 'portable', lock: null, contains: [], clueText: 'The way out lies north.' },
    { id: 'door', name: 'door', description: 'A door.', kind: 'door', lock: null, contains: [], clueText: null },
  ];

  return {
    specVersion: SPEC_VERSION,
    seed: 'structure-test',
    roomId: 'structure-test',
    theme: { name: 'Cell', description: 'A bare cell.' },
    objects,
    puzzles: [
      { id: 'p1', order: 1, kind: 'code', clueObjectId: 'note', answer: '1234', unlocksObjectId: 'box' },
      { id: 'p2', order: 2, kind: 'answer', clueObjectId: 'map', answer: 'north', unlocksObjectId: 'door' },
    ],
    exit: { objectId: 'door', requiresPuzzleId: 'p2' },
    difficulty: { band: 'easy', estimatedActions: 4 },
    solution: { order: ['p1', 'p2'] },
  };
}

describe('checkStructure — sound rooms', () => {
  it('accepts the canonical fixture', () => {
    expect(checkStructure(loadCanonicalRoom())).toEqual([]);
  });

  it('accepts the hand-built base spec', () => {
    expect(checkStructure(baseSpec())).toEqual([]);
  });
});

describe('checkStructure — referential', () => {
  it('rejects a clueObjectId naming no object', () => {
    const spec = baseSpec();
    spec.puzzles[0]!.clueObjectId = 'nowhere';
    expect(codesOf(checkStructure(spec))).toContain('dangling_reference');
  });

  it('rejects an unlocksObjectId naming no object', () => {
    const spec = baseSpec();
    spec.puzzles[1]!.unlocksObjectId = 'nowhere';
    expect(codesOf(checkStructure(spec))).toContain('dangling_reference');
  });

  it('rejects an exit.objectId naming no object', () => {
    const spec = baseSpec();
    spec.exit = { ...spec.exit, objectId: 'nowhere' };
    expect(codesOf(checkStructure(spec))).toContain('dangling_reference');
  });

  it('rejects an exit.requiresPuzzleId naming no puzzle', () => {
    const spec = baseSpec();
    spec.exit = { ...spec.exit, requiresPuzzleId: 'p9' };
    expect(codesOf(checkStructure(spec))).toContain('dangling_reference');
  });

  it('rejects a solution.order entry naming no puzzle', () => {
    const spec = baseSpec();
    spec.solution = { order: ['p1', 'p9'] };
    expect(codesOf(checkStructure(spec))).toContain('dangling_reference');
  });
});

describe('checkStructure — ordering', () => {
  it('rejects a gap in the order sequence', () => {
    const spec = baseSpec();
    spec.puzzles[1]!.order = 3;
    expect(codesOf(checkStructure(spec))).toContain('puzzle_order_invalid');
  });

  it('rejects a duplicate puzzle id', () => {
    const spec = baseSpec();
    spec.puzzles[1]!.id = 'p1';
    expect(codesOf(checkStructure(spec))).toContain('puzzle_order_invalid');
  });

  it('rejects solution.order disagreeing with the declared order', () => {
    const spec = baseSpec();
    spec.solution = { order: ['p2', 'p1'] };
    expect(codesOf(checkStructure(spec))).toContain('puzzle_order_invalid');
  });

  it('rejects a solution.order that is shorter than the puzzle list', () => {
    const spec = baseSpec();
    spec.solution = { order: ['p1'] };
    expect(codesOf(checkStructure(spec))).toContain('puzzle_order_invalid');
  });
});

describe('checkStructure — exit placement', () => {
  it('rejects an exit puzzle that is not last in the chain', () => {
    const spec = baseSpec();
    spec.exit = { ...spec.exit, requiresPuzzleId: 'p1' };
    expect(codesOf(checkStructure(spec))).toContain('exit_not_last');
  });

  it('accepts a single-puzzle room where the exit puzzle is also the first', () => {
    const spec = baseSpec();
    spec.puzzles = [spec.puzzles[1]!];
    spec.puzzles[0]!.order = 1;
    spec.solution = { order: ['p2'] };
    expect(codesOf(checkStructure(spec))).not.toContain('exit_not_last');
  });
});

describe('checkStructure — lock agreement', () => {
  it('rejects a code puzzle whose target has no lock', () => {
    const spec = baseSpec();
    spec.objects.find((o) => o.id === 'box')!.lock = null;
    expect(codesOf(checkStructure(spec))).toContain('lock_mismatch');
  });

  it('rejects a code puzzle whose target opens with a key', () => {
    const spec = baseSpec();
    spec.objects.find((o) => o.id === 'box')!.lock = { opensWith: 'key', keyItemId: 'note' };
    expect(codesOf(checkStructure(spec))).toContain('lock_mismatch');
  });

  it('rejects a code puzzle whose lock accepts a different code than its answer', () => {
    // The room that looks solvable on paper and cannot be escaped in practice.
    const spec = baseSpec();
    spec.objects.find((o) => o.id === 'box')!.lock = { opensWith: 'code', code: '9999' };
    const rejections = checkStructure(spec);
    expect(codesOf(rejections)).toContain('lock_mismatch');
    expect(rejections.find((r) => r.code === 'lock_mismatch')!.message).toContain('9999');
  });

  it('leaves an answer puzzle alone whose target has no lock', () => {
    // p2 unlocks the door, which has no lock — that is how the canonical room
    // works too, and it is correct: an answer puzzle needs no keypad.
    expect(codesOf(checkStructure(baseSpec()))).not.toContain('lock_mismatch');
  });
});

describe('checkStructure — answer collision', () => {
  it('rejects two puzzles accepting the same string', () => {
    const spec = baseSpec();
    spec.puzzles[1]!.answer = '1234';
    expect(codesOf(checkStructure(spec))).toContain('answer_collision');
  });

  it('rejects answers differing only in case, matching the simulator comparison', () => {
    const spec = baseSpec();
    spec.puzzles[0]!.kind = 'answer';
    spec.puzzles[0]!.answer = 'NORTH';
    expect(codesOf(checkStructure(spec))).toContain('answer_collision');
  });

  it('rejects answers differing only in surrounding whitespace', () => {
    const spec = baseSpec();
    spec.puzzles[0]!.kind = 'answer';
    spec.puzzles[0]!.answer = ' north ';
    expect(codesOf(checkStructure(spec))).toContain('answer_collision');
  });
});

describe('answersMatch', () => {
  it('matches the simulator rule: trim and lowercase, nothing more', () => {
    expect(answersMatch('North', ' north ')).toBe(true);
    expect(answersMatch('north', 'north.')).toBe(false);
    expect(answersMatch('4471', '4471')).toBe(true);
  });
});
