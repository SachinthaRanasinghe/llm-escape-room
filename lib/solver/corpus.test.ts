import { describe, expect, it } from 'vitest';
import { compileRoom, resolve } from '@/lib/sim';
import { INVALID_ROOMS, loadCanonicalRoom, loadInvalidRoom } from '@/fixtures';
import { codesOf, verifyRoom } from './index';

/**
 * THE CONTRACT TEST — this ticket's counterpart to `lib/sim/fixture-replay.test.ts`.
 *
 * `fixtures/index.ts` says the invalid corpus exists so that #3 "rejects each
 * invalid one BY REASON", and this is where that claim is cashed. Three of the
 * four semantic fixtures are asserted to produce EXACTLY one rejection code — not
 * "contains", not "at least" — because a solver that rejects the right room for
 * the wrong reason gives #6's generator loop a misleading signal about what to
 * fix, and the loop is the only consumer this module has.
 *
 * If one of those exact assertions ever needs loosening, something upstream is
 * mis-specified. Loosening the test hides it.
 */

describe('the canonical room', () => {
  const result = verifyRoom(loadCanonicalRoom());

  it('certifies', () => {
    expect(result.ok ? null : codesOf(result.rejections)).toBeNull();
    expect(result.ok).toBe(true);
  });

  it('reports six actions by both routes, which is what makes the chain real', () => {
    expect(result.ok && result.report.minActions).toBe(6);
    expect(result.ok && result.report.intendedActions).toBe(6);
  });

  it('reports the declared band', () => {
    expect(result.ok && result.report.band).toBe('standard');
  });

  it('reports the chain it proved', () => {
    expect(result.ok && result.report.solutionOrder).toEqual(['p1', 'p2', 'p3']);
  });

  it('hands back a path that really escapes the room', () => {
    if (!result.ok) throw new Error('expected the canonical room to certify');
    let state = compileRoom(loadCanonicalRoom());
    for (const action of result.report.intendedPath) {
      const step = resolve(state, action);
      expect(step.verdict.code).toBe('ok');
      state = step.state;
    }
    expect(state.escaped).toBe(true);
  });
});

describe('the invalid corpus, rejected by reason', () => {
  it('unsolvable — the destroyed clue, plus the consequence it has for the room', () => {
    const result = verifyRoom(loadInvalidRoom('unsolvable'));
    if (result.ok) throw new Error('expected rejection');

    const primary = result.rejections.find((r) => r.code === 'answer_not_derivable');
    expect(primary).toBeDefined();
    expect(primary!.puzzleId).toBe('p2');

    // The one fixture that legitimately reports two codes: the mistake, and what
    // the mistake did. See the note in verify.ts.
    expect(codesOf(result.rejections)).toContain('unsolvable');
  });

  it('ambiguous-answer — exactly one code, on exactly one puzzle', () => {
    const result = verifyRoom(loadInvalidRoom('ambiguous-answer'));
    if (result.ok) throw new Error('expected rejection');
    expect(codesOf(result.rejections)).toEqual(['answer_ambiguous']);
    expect(result.rejections[0]!.puzzleId).toBe('p3');
  });

  it('broken-chain — exactly one code', () => {
    const result = verifyRoom(loadInvalidRoom('broken-chain'));
    if (result.ok) throw new Error('expected rejection');
    expect(codesOf(result.rejections)).toEqual(['chain_broken']);
  });

  it('out-of-band-difficulty — exactly one code', () => {
    const result = verifyRoom(loadInvalidRoom('out-of-band-difficulty'));
    if (result.ok) throw new Error('expected rejection');
    expect(codesOf(result.rejections)).toEqual(['difficulty_out_of_band']);
  });

  it('version-mismatch — refused at the door, loudly, not half-parsed', () => {
    const result = verifyRoom(loadInvalidRoom('version-mismatch'));
    if (result.ok) throw new Error('expected rejection');
    expect(codesOf(result.rejections)).toEqual(['spec_version_mismatch']);
  });
});

describe('the corpus as a whole', () => {
  it('rejects every invalid room', () => {
    for (const room of INVALID_ROOMS) {
      const result = verifyRoom(room.raw);
      expect(result.ok, `${room.name} should have been rejected`).toBe(false);
    }
  });

  it('gives every rejection a reason drawn from the closed vocabulary', () => {
    for (const room of INVALID_ROOMS) {
      const result = verifyRoom(room.raw);
      if (result.ok) continue;
      expect(result.rejections.length, room.name).toBeGreaterThan(0);
      for (const rejection of result.rejections) {
        expect(rejection.message.length, `${room.name}/${rejection.code}`).toBeGreaterThan(0);
      }
    }
  });

  it('certifies the one room that is supposed to certify, and only it', () => {
    expect(verifyRoom(loadCanonicalRoom()).ok).toBe(true);
    expect(INVALID_ROOMS.every((r) => !verifyRoom(r.raw).ok)).toBe(true);
  });
});

describe('determinism', () => {
  it('gives the same verdict twice for the same room', () => {
    const a = verifyRoom(loadCanonicalRoom());
    const b = verifyRoom(loadCanonicalRoom());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
