import type { RoomObject, RoomSpec } from '@/lib/schema/room';
import { SPEC_VERSION } from '@/lib/schema/version';

/**
 * Hand-built rooms with `key` puzzles — test support for TICKET-7 (#8).
 *
 * Like `fuzz.ts`, it lives in lib/ so the solver, simulator and generator tests
 * can share one certified shape, and like `fuzz.ts` it is NOT re-exported from
 * `index.ts`: nothing on a published path builds rooms by hand.
 *
 * The shape is the one the `spatial` strategy asks a model for: each key lies
 * in (or is) its clue object, and each next key sits inside what the previous
 * one opens. Every room here certifies at `standard` in 6 intended actions.
 */

export function object(o: Partial<RoomObject> & Pick<RoomObject, 'id' | 'kind'>): RoomObject {
  return { name: o.id, description: `A ${o.id}.`, lock: null, contains: [], clueText: null, ...o };
}

export function keyRoom(): RoomSpec {
  return {
    specVersion: SPEC_VERSION,
    seed: 'key-chain',
    roomId: 'key-chain',
    theme: { name: 'Boathouse', description: 'A damp boathouse.' },
    objects: [
      object({ id: 'crate', kind: 'container', contains: ['key1'], clueText: 'Straw, and something small and metal.' }),
      object({ id: 'key1', kind: 'portable' }),
      object({ id: 'chest', kind: 'container', lock: { opensWith: 'key', keyItemId: 'key1' }, contains: ['key2'] }),
      object({ id: 'key2', kind: 'portable' }),
      object({ id: 'locker', kind: 'container', lock: { opensWith: 'key', keyItemId: 'key2' }, contains: ['key3'] }),
      object({ id: 'key3', kind: 'portable' }),
      object({ id: 'door', kind: 'door', lock: { opensWith: 'key', keyItemId: 'key3' } }),
      object({ id: 'rusty-key', kind: 'portable' }),
    ],
    puzzles: [
      { id: 'k1', order: 1, kind: 'key', clueObjectId: 'crate', answer: 'key1', unlocksObjectId: 'chest' },
      { id: 'k2', order: 2, kind: 'key', clueObjectId: 'key2', answer: 'key2', unlocksObjectId: 'locker' },
      { id: 'k3', order: 3, kind: 'key', clueObjectId: 'key3', answer: 'key3', unlocksObjectId: 'door' },
    ],
    exit: { objectId: 'door', requiresPuzzleId: 'k3' },
    difficulty: { band: 'standard', estimatedActions: 8 },
    solution: { order: ['k1', 'k2', 'k3'] },
  };
}

/** A mixed chain: a code, then a key, then a spoken answer. */
export function mixedRoom(): RoomSpec {
  return {
    ...keyRoom(),
    seed: 'mixed-chain',
    roomId: 'mixed-chain',
    objects: [
      object({ id: 'note', kind: 'portable', clueText: 'Scrawled on it: 482.' }),
      object({ id: 'box', kind: 'container', lock: { opensWith: 'code', code: '482' }, contains: ['key1'] }),
      object({ id: 'key1', kind: 'portable' }),
      object({ id: 'chest', kind: 'container', lock: { opensWith: 'key', keyItemId: 'key1' }, contains: ['diary'] }),
      object({ id: 'diary', kind: 'portable', clueText: 'The last page says only: west.' }),
      object({ id: 'door', kind: 'door' }),
    ],
    puzzles: [
      { id: 'p1', order: 1, kind: 'code', clueObjectId: 'note', answer: '482', unlocksObjectId: 'box' },
      { id: 'p2', order: 2, kind: 'key', clueObjectId: 'key1', answer: 'key1', unlocksObjectId: 'chest' },
      { id: 'p3', order: 3, kind: 'answer', clueObjectId: 'diary', answer: 'west', unlocksObjectId: 'door' },
    ],
    exit: { objectId: 'door', requiresPuzzleId: 'p3' },
    solution: { order: ['p1', 'p2', 'p3'] },
  };
}
