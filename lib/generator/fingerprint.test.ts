import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { createRng } from '@/lib/rng';
import type { RoomSpec } from '@/lib/schema/room';
import { verifySpec } from '@/lib/solver';
import { buildValidRoom } from '@/lib/solver/fuzz';
import { keyRoom, mixedRoom } from '@/lib/solver/key-rooms';
import { differsFrom, fingerprintRoom } from './fingerprint';

function certified(spec: RoomSpec) {
  const result = verifySpec(spec);
  if (!result.ok) throw new Error(`fixture did not certify: ${result.rejections.map((r) => r.code).join(', ')}`);
  return fingerprintRoom(spec, result.report, 'symbolic');
}

const canonical = loadCanonicalRoom();

/**
 * Renames every id, rewrites every piece of prose, and swaps every answer for
 * another of the same shape — a different room to a reader, the same skeleton
 * to a model.
 */
function reskinned(spec: RoomSpec): RoomSpec {
  const ids = new Map(spec.objects.map((o, i) => [o.id, `obj-${i}`]));
  const pids = new Map(spec.puzzles.map((p, i) => [p.id, `puzzle-${i}`]));
  const answers = new Map([['4471', '9025'], ['1770', '3388'], ['north', 'west']]);
  const rename = (id: string) => ids.get(id) ?? id;
  const reanswer = (a: string) => answers.get(a) ?? a;
  return {
    ...spec,
    seed: 'other',
    roomId: 'other',
    theme: { name: 'Somewhere else', description: 'Entirely different prose.' },
    objects: spec.objects.map((o) => ({
      ...o,
      id: rename(o.id),
      name: `thing ${rename(o.id)}`,
      description: 'Rewritten.',
      contains: o.contains.map(rename),
      lock: o.lock?.opensWith === 'code' ? { opensWith: 'code', code: reanswer(o.lock.code) } : o.lock,
      clueText: o.clueText === null ? null : `Rewritten clue ${[...answers].find(([from]) => o.clueText!.includes(from))?.[1] ?? ''}`.trim(),
    })),
    puzzles: spec.puzzles.map((p) => ({
      ...p,
      id: pids.get(p.id)!,
      clueObjectId: rename(p.clueObjectId),
      unlocksObjectId: rename(p.unlocksObjectId),
      answer: reanswer(p.answer),
    })),
    exit: { objectId: rename(spec.exit.objectId), requiresPuzzleId: pids.get(spec.exit.requiresPuzzleId)! },
    solution: { order: spec.solution.order.map((id) => pids.get(id)!) },
  };
}

describe('fingerprintRoom', () => {
  it('pins the canonical room, hash included — change the algorithm and this SHOULD break', () => {
    expect(certified(canonical)).toEqual({
      strategy: 'symbolic',
      chainLength: 3,
      puzzleKinds: ['code', 'code', 'answer'],
      unlockKinds: ['code', 'code', 'none'],
      answerShapes: ['digits:4', 'digits:4', 'domain:direction'],
      maxContainmentDepth: 1,
      objectCount: 8,
      decoyCount: 1,
      intendedActions: 6,
      band: 'standard',
      structureHash: 'f432b72bc8427487',
    });
  });

  it('ignores ids, prose and answers', () => {
    expect(certified(reskinned(canonical)).structureHash).toBe(certified(canonical).structureHash);
  });

  it('notices an extra decoy', () => {
    const withDecoy: RoomSpec = {
      ...canonical,
      objects: [
        ...canonical.objects,
        { id: 'stool', name: 'stool', description: 'A stool.', kind: 'fixture', lock: null, contains: [], clueText: 'Just a stool.' },
      ],
    };
    const a = certified(canonical);
    const b = certified(withDecoy);
    expect(b.decoyCount).toBe(2);
    expect(differsFrom(a, b)).toBe(true);
  });

  it('notices a different code width', () => {
    const spec = JSON.parse(JSON.stringify(canonical)) as RoomSpec;
    spec.puzzles[0]!.answer = '44712';
    spec.objects.find((o) => o.id === 'wall-safe')!.lock = { opensWith: 'code', code: '44712' };
    spec.objects.find((o) => o.id === 'ledger')!.clueText = 'Columns of harbour dues. The final column totals 44712.';
    expect(certified(spec).answerShapes[0]).toBe('digits:5');
    expect(differsFrom(certified(canonical), certified(spec))).toBe(true);
  });

  it('tells a two-link chain from a three-link one', () => {
    const two = certified(buildValidRoom(createRng('fp-2'), { chainLength: 2 }));
    const three = certified(buildValidRoom(createRng('fp-3'), { chainLength: 3 }));
    expect(differsFrom(two, three)).toBe(true);
    expect(differsFrom(three, three)).toBe(false);
  });
});

describe('fingerprintRoom — key links (TICKET-7, #8)', () => {
  it('records key links as their own kind and shape', () => {
    const f = certified(keyRoom());
    expect(f.puzzleKinds).toEqual(['key', 'key', 'key']);
    expect(f.unlockKinds).toEqual(['key', 'key', 'key']);
    expect(f.answerShapes).toEqual(['key', 'key', 'key']);
  });

  it('tells a key chain from a mixed chain of the same length', () => {
    expect(differsFrom(certified(keyRoom()), certified(mixedRoom()))).toBe(true);
  });
});
