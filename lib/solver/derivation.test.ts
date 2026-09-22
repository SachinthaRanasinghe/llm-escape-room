import { describe, expect, it } from 'vitest';
import { parseRoomSpec, type Puzzle } from '@/lib/schema/room';
import { loadCanonicalRoom, loadInvalidRoom } from '@/fixtures';
import { candidatesFor, checkDerivation } from './derivation';
import { codesOf } from './rejections';

const canonical = loadCanonicalRoom();

/** The invalid fixtures are typed `unknown` on purpose; only version-mismatch fails this. */
const unsolvable = parseRoomSpec(loadInvalidRoom('unsolvable'));
const ambiguous = parseRoomSpec(loadInvalidRoom('ambiguous-answer'));

function clueOf(spec: typeof canonical, puzzleId: string): string | null {
  const puzzle = spec.puzzles.find((p) => p.id === puzzleId)!;
  return spec.objects.find((o) => o.id === puzzle.clueObjectId)!.clueText;
}

function puzzle(spec: typeof canonical, id: string): Puzzle {
  return spec.puzzles.find((p) => p.id === id)!;
}

describe('candidatesFor — the canonical room', () => {
  it('reads one four-digit code off the ledger', () => {
    expect(candidatesFor(puzzle(canonical, 'p1'), clueOf(canonical, 'p1'))).toEqual(['4471']);
  });

  it('reads one four-digit code off the sea chart', () => {
    expect(candidatesFor(puzzle(canonical, 'p2'), clueOf(canonical, 'p2'))).toEqual(['1770']);
  });

  it('reads one direction off the logbook', () => {
    expect(candidatesFor(puzzle(canonical, 'p3'), clueOf(canonical, 'p3'))).toEqual(['north']);
  });
});

describe('checkDerivation — the canonical room', () => {
  it('rejects nothing', () => {
    expect(checkDerivation(canonical).rejections).toEqual([]);
  });

  it('marks every puzzle derivable, which is what unlocks the oracle', () => {
    expect([...checkDerivation(canonical).derivable].sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('checkDerivation — the unsolvable fixture', () => {
  it('finds no candidate on the water-damaged chart', () => {
    expect(candidatesFor(puzzle(unsolvable, 'p2'), clueOf(unsolvable, 'p2'))).toEqual([]);
  });

  it('rejects p2 as not derivable, and rejects nothing else', () => {
    const { rejections } = checkDerivation(unsolvable);
    expect(codesOf(rejections)).toEqual(['answer_not_derivable']);
    expect(rejections[0]!.puzzleId).toBe('p2');
  });

  it('withholds p2 from the derivable set, which is what makes the room unsolvable', () => {
    // The gate that turns a destroyed clue into an unescapable room. Without
    // this the oracle would happily type 1770 it was never told.
    const { derivable } = checkDerivation(unsolvable);
    expect(derivable.has('p1')).toBe(true);
    expect(derivable.has('p2')).toBe(false);
    expect(derivable.has('p3')).toBe(true);
  });
});

describe('checkDerivation — the ambiguous-answer fixture', () => {
  it('reads both directions off the logbook', () => {
    const candidates = candidatesFor(puzzle(ambiguous, 'p3'), clueOf(ambiguous, 'p3'));
    expect(candidates).toContain('north');
    expect(candidates).toContain('south');
  });

  it('rejects p3 as ambiguous, and rejects nothing else', () => {
    const { rejections } = checkDerivation(ambiguous);
    expect(codesOf(rejections)).toEqual(['answer_ambiguous']);
    expect(rejections[0]!.puzzleId).toBe('p3');
  });

  it('names the competing reading in the message', () => {
    const { rejections } = checkDerivation(ambiguous);
    expect(rejections[0]!.message).toContain('south');
  });

  it('STILL marks p3 derivable — ambiguity is not unsolvability', () => {
    // The asymmetry this module exists to draw. An ambiguous clue teaches the
    // answer; it just teaches more than one. Gating the oracle on uniqueness
    // would make this fixture report `unsolvable` too and break the corpus's
    // one-rule-per-fixture design.
    expect(checkDerivation(ambiguous).derivable.has('p3')).toBe(true);
  });
});

describe('candidatesFor — edge cases', () => {
  const code = (answer: string): Puzzle => ({
    id: 'p',
    order: 1,
    kind: 'code',
    clueObjectId: 'c',
    answer,
    unlocksObjectId: 'u',
  });
  const prose = (answer: string): Puzzle => ({ ...code(answer), kind: 'answer' });

  it('ignores a four-digit run when the answer is three digits', () => {
    expect(candidatesFor(code('471'), 'The total is 4471.')).toEqual([]);
  });

  it('finds every distinct run of the right width', () => {
    expect(candidatesFor(code('4471'), 'Either 4471 or 1770.')).toEqual(['4471', '1770']);
  });

  it('deduplicates a run repeated in the clue', () => {
    expect(candidatesFor(code('4471'), '4471, again 4471.')).toEqual(['4471']);
  });

  it('returns nothing for a null clue rather than crashing', () => {
    expect(candidatesFor(code('4471'), null)).toEqual([]);
    expect(candidatesFor(prose('north'), null)).toEqual([]);
  });

  it('returns nothing for a prose answer no domain claims', () => {
    expect(candidatesFor(prose('ledger'), 'The answer is ledger.')).toEqual([]);
  });

  it('does not match a direction inside a longer word', () => {
    expect(candidatesFor(prose('north'), 'Against the northern wall.')).toEqual([]);
  });

  it('ignores a colour when the answer is a direction — different domains never compete', () => {
    expect(candidatesFor(prose('north'), 'The red door lies to the north.')).toEqual(['north']);
  });
});

describe('checkDerivation — a missing clue object', () => {
  it('stays silent about the dangling id and lets structure.ts report it', () => {
    const broken = { ...canonical, puzzles: [{ ...puzzle(canonical, 'p1'), clueObjectId: 'nowhere' }] };
    const { rejections } = checkDerivation(broken);
    // It still reports not-derivable (there is no clue to read), but it must not
    // invent a second code for the dangling reference.
    expect(codesOf(rejections)).toEqual(['answer_not_derivable']);
  });
});
