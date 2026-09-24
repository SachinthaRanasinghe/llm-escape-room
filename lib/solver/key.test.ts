import { describe, expect, it } from 'vitest';
import type { RoomObject, RoomSpec } from '@/lib/schema/room';
import { keyRoom, mixedRoom, object } from './key-rooms';
import { codesOf } from './rejections';
import { verifySpec } from './verify';

/**
 * Certifying `key` puzzles — TICKET-7 (#8), for the spike's `spatial` and
 * `mixed` substrates. The rooms come from `key-rooms.ts`; the committed corpus
 * is all code locks.
 */

function edit(spec: RoomSpec, change: (draft: RoomSpec) => void): RoomSpec {
  const draft = structuredClone(spec);
  change(draft);
  return draft;
}

function objectIn(spec: RoomSpec, id: string): RoomObject {
  return spec.objects.find((o) => o.id === id)!;
}

describe('key puzzles', () => {
  it('certifies an all-key chain at two actions per link: take, then use', () => {
    const result = verifySpec(keyRoom());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.intendedActions).toBe(6);
    expect(result.report.minActions).toBe(6);
    expect(result.report.intendedPath.map((a) => a.name)).toEqual(['take', 'use', 'take', 'use', 'take', 'use']);
  });

  it('refuses a key that is not in its clue object as answer_not_derivable', () => {
    const spec = edit(keyRoom(), (d) => {
      d.objects.push(object({ id: 'shelf', kind: 'fixture' }));
      d.puzzles[0]!.clueObjectId = 'shelf';
    });
    const result = verifySpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.rejections)).toContain('answer_not_derivable');
  });

  it('refuses a lock that takes a different key as lock_mismatch', () => {
    const spec = edit(keyRoom(), (d) => {
      objectIn(d, 'chest').lock = { opensWith: 'key', keyItemId: 'rusty-key' };
    });
    const result = verifySpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.rejections)).toContain('lock_mismatch');
  });

  it('refuses a key puzzle whose target has a code lock as lock_mismatch', () => {
    const spec = edit(keyRoom(), (d) => {
      objectIn(d, 'chest').lock = { opensWith: 'code', code: '123' };
    });
    const result = verifySpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.rejections)).toContain('lock_mismatch');
  });

  it('refuses a "key" that cannot be carried as lock_mismatch', () => {
    const spec = edit(keyRoom(), (d) => {
      objectIn(d, 'key1').kind = 'fixture';
    });
    const result = verifySpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.rejections)).toContain('lock_mismatch');
  });

  it('refuses a key id that names no object as dangling_reference, once', () => {
    const spec = edit(keyRoom(), (d) => {
      d.puzzles[0]!.answer = 'ghost-key';
      objectIn(d, 'chest').lock = { opensWith: 'key', keyItemId: 'ghost-key' };
    });
    const result = verifySpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = codesOf(result.rejections);
      expect(codes.filter((c) => c === 'dangling_reference')).toHaveLength(1);
      expect(codes).not.toContain('answer_not_derivable');
    }
  });

  it('reports a key left on the floor as one chain_broken', () => {
    const spec = edit(keyRoom(), (d) => {
      objectIn(d, 'chest').contains = [];
    });
    const result = verifySpec(spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(codesOf(result.rejections).filter((c) => c === 'chain_broken')).toHaveLength(1);
  });

  it('certifies a mixed chain: code, then key, then a spoken answer', () => {
    const spec = mixedRoom();
    const result = verifySpec(spec);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.intendedActions).toBe(6);
  });
});
