import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { parseRoomSpec, type RoomSpec } from '@/lib/schema/room';
import { buildSceneLayout, ROOM_HALF } from './layout';

const room = loadCanonicalRoom();
const layout = buildSceneLayout(room);
const byId = new Map(layout.objects.map((o) => [o.id, o]));

function distance(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** A structurally valid room with `n` standing objects plus a door that is the exit. */
function roomWith(n: number): RoomSpec {
  const standing = Array.from({ length: n }, (_, i) => ({
    id: `thing-${i}`,
    name: `thing ${i}`,
    description: 'A thing.',
    kind: 'fixture' as const,
    lock: null,
    contains: [],
    clueText: null,
  }));
  return parseRoomSpec({
    ...room,
    objects: [
      ...standing,
      { id: 'door', name: 'door', description: 'A door.', kind: 'door', lock: null, contains: [], clueText: null },
    ],
  });
}

describe('buildSceneLayout on the canonical room', () => {
  it('lists every room object once, in room order', () => {
    expect(layout.objects.map((o) => o.id)).toEqual(room.objects.map((o) => o.id));
  });

  it('builds each object from exactly the five public fields', () => {
    for (const object of layout.objects) {
      expect(Object.keys(object).sort()).toEqual(['id', 'kind', 'name', 'parentId', 'position']);
    }
    expect(Object.keys(layout).sort()).toEqual([
      'centre',
      'exitObjectId',
      'objects',
      'puzzleTargets',
      'roomId',
      'themeName',
    ]);
  });

  it('carries no answer, no lock code and no clue text', () => {
    const json = JSON.stringify(layout);
    const secrets = [
      ...room.puzzles.map((p) => p.answer),
      ...room.objects.flatMap((o) => (o.lock?.opensWith === 'code' ? [o.lock.code] : [])),
      ...room.objects.flatMap((o) => (o.clueText ? [o.clueText] : [])),
      ...room.objects.map((o) => o.description),
    ];
    expect(secrets.length).toBeGreaterThan(5);
    for (const secret of secrets) expect(json, `layout leaks ${secret}`).not.toContain(secret);
    const keys = new Set<string>();
    JSON.parse(json, (key, value) => (keys.add(key), value));
    for (const key of ['lock', 'clueText', 'answer', 'code', 'description', 'contains']) {
      expect(keys.has(key), `layout has a "${key}" key`).toBe(false);
    }
  });

  it('records who holds what, and places a held object where its holder stands', () => {
    expect(byId.get('ledger')?.parentId).toBe('desk');
    expect(byId.get('sea-chart')?.parentId).toBe('wall-safe');
    expect(byId.get('logbook')?.parentId).toBe('cabinet');
    expect(byId.get('desk')?.parentId).toBeNull();
    expect(byId.get('ledger')?.position).toEqual(byId.get('desk')?.position);
    expect(byId.get('logbook')?.position).toEqual(byId.get('cabinet')?.position);
  });

  it('maps each puzzle to the object it unlocks, and puts the exit centre-back', () => {
    expect(layout.puzzleTargets).toEqual(Object.fromEntries(room.puzzles.map((p) => [p.id, p.unlocksObjectId])));
    expect(layout.puzzleTargets.p3).toBe('door');
    expect(layout.exitObjectId).toBe('door');
    const door = byId.get('door')!.position;
    expect(door[0]).toBe(0);
    expect(door[1]).toBeLessThan(-ROOM_HALF / 2);
  });

  it('spaces standing objects apart and keeps them inside the walls', () => {
    const standing = layout.objects.filter((o) => o.parentId === null);
    for (const [i, a] of standing.entries()) {
      expect(Math.abs(a.position[0])).toBeLessThanOrEqual(ROOM_HALF);
      expect(Math.abs(a.position[1])).toBeLessThanOrEqual(ROOM_HALF);
      for (const b of standing.slice(i + 1)) {
        expect(distance(a.position, b.position), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(1.2);
      }
    }
  });

  it('is deterministic', () => {
    expect(buildSceneLayout(loadCanonicalRoom())).toEqual(layout);
  });
});

describe('buildSceneLayout on other room sizes', () => {
  for (const n of [0, 1, 3, 8]) {
    it(`lays out ${n} standing objects plus the exit inside the walls, apart`, () => {
      const out = buildSceneLayout(roomWith(n));
      expect(out.objects).toHaveLength(n + 1);
      for (const [i, a] of out.objects.entries()) {
        expect(Math.abs(a.position[0])).toBeLessThanOrEqual(ROOM_HALF);
        expect(Math.abs(a.position[1])).toBeLessThanOrEqual(ROOM_HALF);
        for (const b of out.objects.slice(i + 1)) {
          expect(distance(a.position, b.position), `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(1.2);
        }
      }
    });
  }
});
