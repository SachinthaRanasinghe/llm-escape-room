import { describe, expect, it } from 'vitest';
import { SPEC_VERSION } from '@/lib/schema/version';
import type { RoomSpec } from '@/lib/schema/room';
import { loadCanonicalRoom } from '@/fixtures';
import { codesOf, verifyRoom, verifySpec } from './index';
import { roomFromSeed } from './fuzz';

/**
 * The pipeline itself: how it enters, what it aborts on, and what it collects.
 * The committed corpus is asserted in `corpus.test.ts`; this file covers the
 * shapes no fixture can reach — a broken object graph, a non-object payload,
 * and a room breaking several rules at once.
 */

const canonical = loadCanonicalRoom();

describe('verifyRoom — the untrusted entry point', () => {
  it('certifies a room it had to parse first', () => {
    expect(verifyRoom(loadCanonicalRoom()).ok).toBe(true);
  });

  it('separates a version mismatch from ordinary malformed output', () => {
    const future = { ...canonical, specVersion: SPEC_VERSION + 1 };
    const result = verifyRoom(future);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : codesOf(result.rejections)).toEqual(['spec_version_mismatch']);
  });

  it('rejects a payload missing a required field as malformed', () => {
    const { puzzles, ...withoutPuzzles } = canonical;
    void puzzles;
    const result = verifyRoom(withoutPuzzles);
    expect(result.ok ? [] : codesOf(result.rejections)).toEqual(['spec_malformed']);
  });

  it('rejects a payload carrying an unknown key, because the schema is strict', () => {
    const result = verifyRoom({ ...canonical, surprise: true });
    expect(result.ok ? [] : codesOf(result.rejections)).toEqual(['spec_malformed']);
  });

  it('rejects things that are not rooms at all', () => {
    for (const raw of [null, undefined, 42, 'a room', [], {}]) {
      const result = verifyRoom(raw);
      expect(result.ok, JSON.stringify(raw) ?? 'undefined').toBe(false);
    }
  });
});

describe('the object graph aborts the pipeline', () => {
  it('converts a dangling child into a rejection rather than a thrown SimulatorError', () => {
    const spec: RoomSpec = {
      ...canonical,
      objects: canonical.objects.map((o) => (o.id === 'desk' ? { ...o, contains: ['ghost'] } : o)),
    };
    const result = verifySpec(spec);
    expect(result.ok ? [] : codesOf(result.rejections)).toEqual(['object_graph_invalid']);
  });

  it('converts a containment cycle into a rejection', () => {
    const spec: RoomSpec = {
      ...canonical,
      objects: canonical.objects.map((o) =>
        o.id === 'ledger' ? { ...o, kind: 'container' as const, contains: ['desk'] } : o,
      ),
    };
    const result = verifySpec(spec);
    expect(result.ok ? [] : codesOf(result.rejections)).toEqual(['object_graph_invalid']);
  });

  it('reports nothing else, because nothing else could run', () => {
    // The one stage that short-circuits. A room that will not compile cannot be
    // searched, so piling on further codes would be guesswork.
    const spec: RoomSpec = {
      ...canonical,
      objects: canonical.objects.map((o) => (o.id === 'desk' ? { ...o, contains: ['ghost'] } : o)),
    };
    const result = verifySpec(spec);
    expect(result.ok ? 0 : result.rejections.length).toBe(1);
  });
});

describe('rejections are collected, not fanned out one at a time', () => {
  it('reports several independent defects in one pass', () => {
    // A generator getting three things wrong should not look like a generator
    // getting one thing wrong three times.
    const spec: RoomSpec = {
      ...canonical,
      objects: canonical.objects.map((o) =>
        o.id === 'logbook' ? { ...o, clueText: 'The entries are illegible.' } : o,
      ),
      difficulty: { band: 'hard', estimatedActions: 14 },
    };
    const result = verifySpec(spec);
    if (result.ok) throw new Error('expected rejection');
    const codes = codesOf(result.rejections);
    expect(codes).toContain('answer_not_derivable');
    expect(codes).toContain('unsolvable');
    expect(result.rejections.length).toBeGreaterThan(1);
  });

  it('still reports structure and derivation when the room is unsolvable', () => {
    const spec: RoomSpec = {
      ...canonical,
      puzzles: canonical.puzzles.map((p) => (p.id === 'p2' ? { ...p, answer: '9999' } : p)),
    };
    const result = verifySpec(spec);
    if (result.ok) throw new Error('expected rejection');
    const codes = codesOf(result.rejections);
    expect(codes).toContain('lock_mismatch');
    expect(codes).toContain('answer_not_derivable');
  });
});

describe('the report', () => {
  it('carries both action counts and the chain it proved', () => {
    const result = verifySpec(canonical);
    if (!result.ok) throw new Error('expected the canonical room to certify');
    expect(result.report).toMatchObject({
      minActions: 6,
      intendedActions: 6,
      band: 'standard',
      solutionOrder: ['p1', 'p2', 'p3'],
    });
  });

  it('carries a min path and an intended path of the lengths it reports', () => {
    const result = verifySpec(canonical);
    if (!result.ok) throw new Error('expected the canonical room to certify');
    expect(result.report.minPath).toHaveLength(result.report.minActions);
    expect(result.report.intendedPath).toHaveLength(result.report.intendedActions);
  });
});

describe('verifySpec and verifyRoom agree', () => {
  it('reaches the same verdict by both doors', () => {
    for (const seed of ['a', 'b', 'c']) {
      const spec = roomFromSeed(seed);
      expect(JSON.stringify(verifySpec(spec))).toBe(JSON.stringify(verifyRoom(spec)));
    }
  });
});
