import { describe, expect, it } from 'vitest';
import { RoomSpecError } from '@/lib/schema/room';
import { findSeqBreaks, parseEventLog } from '@/lib/schema/event';
import { parseRoomSpec } from '@/lib/schema/room';
import {
  INVALID_ROOMS,
  loadCanonicalLog,
  loadCanonicalRoom,
  loadCanonicalRun,
  loadInvalidRoom,
} from './index';

describe('the canonical room', () => {
  it('parses', () => {
    expect(loadCanonicalRoom().roomId).toBe('canonical-study');
  });

  it('has the three-puzzle chain the PRD describes', () => {
    const room = loadCanonicalRoom();
    expect(room.puzzles).toHaveLength(3);
    expect(room.solution.order).toEqual(['p1', 'p2', 'p3']);
    expect(room.puzzles.map((p) => p.order)).toEqual([1, 2, 3]);
  });

  it('is referentially coherent — every id resolves', () => {
    // The SCHEMA does not check this (that boundary is deliberate), but the
    // canonical fixture had better be a real room, since #2 and #5 build on it.
    const room = loadCanonicalRoom();
    const ids = new Set(room.objects.map((o) => o.id));

    for (const object of room.objects) {
      for (const child of object.contains) expect(ids).toContain(child);
    }
    for (const puzzle of room.puzzles) {
      expect(ids).toContain(puzzle.clueObjectId);
      expect(ids).toContain(puzzle.unlocksObjectId);
    }
    expect(ids).toContain(room.exit.objectId);
    expect(room.puzzles.map((p) => p.id)).toContain(room.exit.requiresPuzzleId);
  });

  it('chains: each answer unlocks the object holding the next clue', () => {
    const room = loadCanonicalRoom();
    const byId = new Map(room.objects.map((o) => [o.id, o]));
    const ordered = [...room.puzzles].sort((a, b) => a.order - b.order);

    for (let i = 0; i < ordered.length - 1; i++) {
      const unlocked = byId.get(ordered[i]!.unlocksObjectId)!;
      expect(unlocked.contains).toContain(ordered[i + 1]!.clueObjectId);
    }
  });

  it('puts each code answer on the lock it opens', () => {
    const room = loadCanonicalRoom();
    const byId = new Map(room.objects.map((o) => [o.id, o]));
    for (const puzzle of room.puzzles.filter((p) => p.kind === 'code')) {
      const target = byId.get(puzzle.unlocksObjectId)!;
      expect(target.lock).not.toBeNull();
      expect(target.lock).toEqual({ opensWith: 'code', code: puzzle.answer });
    }
  });
});

describe('the canonical event log', () => {
  it('parses', () => {
    expect(loadCanonicalLog().length).toBeGreaterThan(0);
  });

  it('has contiguous sequence numbers for every competitor', () => {
    expect(findSeqBreaks(loadCanonicalLog())).toEqual([]);
  });

  it('carries a non-empty intent on every single action', () => {
    for (const event of loadCanonicalLog()) {
      expect(event.action.intent.length).toBeGreaterThan(0);
    }
  });

  it('is INTERESTING, not merely valid', () => {
    // #5 renders this log and can only display states the fixture contains. A
    // sterile happy-path log produces a player that cannot show the divergence
    // the whole product exists to show, so these are asserted as requirements.
    const log = loadCanonicalLog();
    const codes = new Set(log.map((e) => e.verdict.code));

    expect(codes).toContain('wrong_code'); // a model got it wrong
    expect(codes).toContain('not_found'); // a model acted on something imaginary
    expect(codes).toContain('locked'); // a legal action that simply failed
    expect(codes).toContain('ok');
  });

  it('records both competitors diverging — one escapes, one does not', () => {
    const log = loadCanonicalLog();
    const escapes = log.filter((e) => e.action.name === 'submit_answer' && e.verdict.ok);
    expect(escapes).toHaveLength(1);
    expect(escapes[0]!.competitorId).toBe('model-a');
  });
});

describe('the canonical run record', () => {
  it('parses', () => {
    expect(loadCanonicalRun().runId).toBe('run-canonical-0001');
  });

  it('summarises the log it accompanies — totals cannot silently drift', () => {
    const run = loadCanonicalRun();
    const log = loadCanonicalLog();

    for (const summary of run.summaries) {
      const mine = log.filter((e) => e.competitorId === summary.competitorId);
      expect(mine.length).toBeGreaterThan(0);

      const wrong = mine.filter(
        (e) => e.verdict.code === 'wrong_code' || e.verdict.code === 'wrong_answer',
      ).length;
      expect(summary.failedAttempts).toBe(wrong);

      const tokens = mine.reduce((sum, e) => sum + e.tokens.prompt, 0);
      expect(summary.tokens.prompt).toBe(tokens);

      if (summary.escaped) {
        expect(summary.escapeActionCount).toBe(mine.length);
        expect(summary.escapeMs).toBe(mine.reduce((sum, e) => sum + e.latencyMs, 0));
      } else {
        expect(summary.escapeActionCount).toBeNull();
        expect(summary.escapeMs).toBeNull();
      }
    }
  });

  it('shows budget exhaustion as a recorded outcome', () => {
    const stalled = loadCanonicalRun().summaries.find((s) => !s.escaped)!;
    expect(stalled.endedBecause).toBe('budget_actions');
    expect(stalled.invalidActions).toBeGreaterThan(0);
  });

  it('exhausted competitor used exactly the action budget', () => {
    const run = loadCanonicalRun();
    const log = loadCanonicalLog();
    const stalled = run.summaries.find((s) => !s.escaped)!;
    const actions = log.filter((e) => e.competitorId === stalled.competitorId).length;
    expect(actions).toBe(run.budget.maxActions);
  });

  it('leaves typicalOfRepeats null until repeats have been run', () => {
    expect(loadCanonicalRun().typicalOfRepeats).toBeNull();
  });
});

describe('the invalid corpus', () => {
  it('has one fixture per named failure', () => {
    expect(INVALID_ROOMS.map((r) => r.name)).toEqual([
      'unsolvable',
      'ambiguous-answer',
      'broken-chain',
      'out-of-band-difficulty',
      'version-mismatch',
    ]);
  });

  it('rejects the version mismatch at parse time, loudly', () => {
    expect(() => parseRoomSpec(loadInvalidRoom('version-mismatch'))).toThrow(RoomSpecError);
  });

  it('lets the other four parse — they are the SOLVER\'s problem, not the schema\'s', () => {
    // This is the assertion that keeps #3's test corpus alive. If a future
    // `.refine()` starts catching these here, the solver loses its ability to be
    // tested on which rule it rejected, and this test will say so.
    for (const entry of INVALID_ROOMS.filter((r) => !r.failsAtParse)) {
      expect(() => parseRoomSpec(entry.raw), entry.name).not.toThrow();
    }
  });

  it('gives every fixture a stated reason for #3 to assert against', () => {
    for (const entry of INVALID_ROOMS) {
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it('breaks exactly one thing each — every invalid room is otherwise the canonical room', () => {
    const canonical = loadCanonicalRoom();
    for (const entry of INVALID_ROOMS.filter((r) => !r.failsAtParse)) {
      const room = parseRoomSpec(entry.raw);
      expect(room.objects, entry.name).toHaveLength(canonical.objects.length);
      expect(room.puzzles, entry.name).toHaveLength(canonical.puzzles.length);
    }
  });
});

describe('log and room agree', () => {
  it('every object the log acts on exists in the room, except the deliberate mistake', () => {
    const room = loadCanonicalRoom();
    const ids = new Set(room.objects.map((o) => o.id));
    const missing = new Set<string>();

    for (const event of loadCanonicalLog()) {
      const action = event.action;
      if ('targetId' in action && !ids.has(action.targetId)) missing.add(action.targetId);
    }

    // Exactly one: model-b inspects a bookshelf that does not exist, which is the
    // invalid action the renderer needs to be able to display.
    expect([...missing]).toEqual(['bookshelf']);
  });

  it('parses the log through the schema a second time without drift', () => {
    const log = loadCanonicalLog();
    expect(parseEventLog(JSON.parse(JSON.stringify(log)))).toEqual(log);
  });
});
