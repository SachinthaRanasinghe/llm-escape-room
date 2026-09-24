import { describe, expect, it } from 'vitest';
import { SPEC_VERSION } from './version';
import { LockSchema, RoomSpecError, RoomSpecSchema, parseRoomSpec, type RoomSpec } from './room';

const room: RoomSpec = {
  specVersion: SPEC_VERSION,
  seed: 'test-room',
  roomId: 'test-room',
  theme: { name: 'Study', description: 'A cramped academic study.' },
  objects: [
    {
      id: 'desk',
      name: 'writing desk',
      description: 'A writing desk with a shallow drawer.',
      kind: 'container',
      lock: null,
      contains: ['ledger'],
      clueText: 'A number is scratched into the wood: 12.',
    },
    {
      id: 'ledger',
      name: 'ledger',
      description: 'A leather ledger.',
      kind: 'portable',
      lock: null,
      contains: [],
      clueText: 'The final column totals 4471.',
    },
    {
      id: 'safe',
      name: 'wall safe',
      description: 'A wall safe with a keypad.',
      kind: 'lock',
      lock: { opensWith: 'code', code: '4471' },
      contains: [],
      clueText: null,
    },
  ],
  puzzles: [
    {
      id: 'p1',
      order: 1,
      kind: 'code',
      clueObjectId: 'ledger',
      answer: '4471',
      unlocksObjectId: 'safe',
    },
  ],
  exit: { objectId: 'safe', requiresPuzzleId: 'p1' },
  difficulty: { band: 'standard', estimatedActions: 12 },
  solution: { order: ['p1'] },
};

describe('RoomSpecSchema', () => {
  it('accepts a complete room', () => {
    expect(RoomSpecSchema.parse(room)).toEqual(room);
  });

  it('rejects a future spec version LOUDLY rather than half-parsing', () => {
    const future = { ...room, specVersion: SPEC_VERSION + 1 };
    expect(RoomSpecSchema.safeParse(future).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(RoomSpecSchema.safeParse({ ...room, mood: 'tense' }).success).toBe(false);
  });

  it('requires lock and clueText to be present as null, never absent', () => {
    const [desk, ...rest] = room.objects;
    const { lock: _lock, ...deskWithoutLock } = desk!;
    expect(RoomSpecSchema.safeParse({ ...room, objects: [deskWithoutLock, ...rest] }).success).toBe(false);

    const { clueText: _clue, ...deskWithoutClue } = desk!;
    expect(RoomSpecSchema.safeParse({ ...room, objects: [deskWithoutClue, ...rest] }).success).toBe(false);
  });

  it('rejects an empty room or an empty chain', () => {
    expect(RoomSpecSchema.safeParse({ ...room, objects: [] }).success).toBe(false);
    expect(RoomSpecSchema.safeParse({ ...room, puzzles: [] }).success).toBe(false);
    expect(RoomSpecSchema.safeParse({ ...room, solution: { order: [] } }).success).toBe(false);
  });

  it('rejects a non-positive or fractional puzzle order', () => {
    const bad = (order: number) => ({ ...room, puzzles: [{ ...room.puzzles[0]!, order }] });
    expect(RoomSpecSchema.safeParse(bad(0)).success).toBe(false);
    expect(RoomSpecSchema.safeParse(bad(-1)).success).toBe(false);
    expect(RoomSpecSchema.safeParse(bad(1.5)).success).toBe(false);
  });

  it('rejects an unknown object kind or difficulty band', () => {
    const objects = [{ ...room.objects[0]!, kind: 'hologram' }, ...room.objects.slice(1)];
    expect(RoomSpecSchema.safeParse({ ...room, objects }).success).toBe(false);
    expect(
      RoomSpecSchema.safeParse({ ...room, difficulty: { band: 'nightmare', estimatedActions: 12 } }).success,
    ).toBe(false);
  });

  it('accepts a key puzzle — TICKET-7 (#8) widened v0 for the spatial substrate', () => {
    const puzzles = [{ ...room.puzzles[0]!, kind: 'key', answer: 'brass-key' }];
    expect(RoomSpecSchema.safeParse({ ...room, puzzles }).success).toBe(true);
  });

  it('still rejects an unknown puzzle kind', () => {
    const puzzles = [{ ...room.puzzles[0]!, kind: 'riddle' }];
    expect(RoomSpecSchema.safeParse({ ...room, puzzles }).success).toBe(false);
  });
});

describe('LockSchema', () => {
  it('accepts a key lock and a code lock', () => {
    expect(LockSchema.parse({ opensWith: 'key', keyItemId: 'brass-key' })).toEqual({
      opensWith: 'key',
      keyItemId: 'brass-key',
    });
    expect(LockSchema.parse({ opensWith: 'code', code: '4471' })).toEqual({
      opensWith: 'code',
      code: '4471',
    });
  });

  it('makes a key lock carrying a code unrepresentable', () => {
    expect(LockSchema.safeParse({ opensWith: 'key', keyItemId: 'k', code: '4471' }).success).toBe(false);
  });
});

describe('the structural / semantic boundary', () => {
  it('accepts a room whose ids do not resolve — that is the solver (#3), not the schema', () => {
    const dangling: RoomSpec = {
      ...room,
      puzzles: [{ ...room.puzzles[0]!, clueObjectId: 'does-not-exist' }],
    };
    // Structurally perfect, semantically broken. It MUST parse, so that the
    // invalid fixture corpus survives to be the solver's test contract.
    expect(RoomSpecSchema.safeParse(dangling).success).toBe(true);
  });

  it('accepts a room whose solution order disagrees with the chain', () => {
    expect(RoomSpecSchema.safeParse({ ...room, solution: { order: ['p9'] } }).success).toBe(true);
  });
});

describe('parseRoomSpec', () => {
  it('returns a typed room', () => {
    expect(parseRoomSpec(room)).toEqual(room);
  });

  it('throws RoomSpecError naming the expected version', () => {
    try {
      parseRoomSpec({ ...room, specVersion: 99 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(RoomSpecError);
      expect((error as RoomSpecError).message).toContain(`specVersion ${SPEC_VERSION}`);
      expect((error as RoomSpecError).issues.length).toBeGreaterThan(0);
    }
  });
});
