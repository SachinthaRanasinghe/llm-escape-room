import { describe, expect, it } from 'vitest';
import type { RoomSpec } from '@/lib/schema/room';
import { loadCanonicalRoom } from '@/fixtures';
import { DIFFICULTY_RANGES, bandFor, checkDifficulty } from './difficulty';
import { codesOf } from './rejections';

const canonical = loadCanonicalRoom();

function withDifficulty(band: RoomSpec['difficulty']['band'], estimatedActions: number): RoomSpec {
  return { ...canonical, difficulty: { band, estimatedActions } };
}

describe('the canonical room', () => {
  it('certifies on its committed numbers — intended 6, estimate 14, standard', () => {
    // The calibration point. If this ever fails, the thresholds moved, and the
    // fixture four tickets build against stopped certifying.
    expect(checkDifficulty(canonical, { intendedActions: 6 })).toEqual([]);
  });
});

describe('band boundaries', () => {
  it('accepts an intended length at the bottom of its band', () => {
    expect(checkDifficulty(withDifficulty('standard', 5), { intendedActions: 5 })).toEqual([]);
  });

  it('accepts an intended length at the top of its band', () => {
    expect(checkDifficulty(withDifficulty('standard', 12), { intendedActions: 12 })).toEqual([]);
  });

  it('rejects one action below the band', () => {
    expect(codesOf(checkDifficulty(withDifficulty('standard', 4), { intendedActions: 4 }))).toEqual([
      'difficulty_out_of_band',
    ]);
  });

  it('rejects one action above the band', () => {
    expect(codesOf(checkDifficulty(withDifficulty('standard', 13), { intendedActions: 13 }))).toEqual([
      'difficulty_out_of_band',
    ]);
  });

  it('rejects the canonical length declared as easy', () => {
    expect(codesOf(checkDifficulty(withDifficulty('easy', 6), { intendedActions: 6 }))).toEqual([
      'difficulty_out_of_band',
    ]);
  });

  it('accepts a genuinely easy room', () => {
    expect(checkDifficulty(withDifficulty('easy', 2), { intendedActions: 2 })).toEqual([]);
  });

  it('accepts a genuinely hard room', () => {
    expect(checkDifficulty(withDifficulty('hard', 20), { intendedActions: 20 })).toEqual([]);
  });

  it('rejects a room longer than any band covers', () => {
    expect(codesOf(checkDifficulty(withDifficulty('hard', 30), { intendedActions: 30 }))).toEqual([
      'difficulty_out_of_band',
    ]);
  });
});

describe('estimate plausibility', () => {
  it('rejects an estimate below the actual optimum', () => {
    expect(codesOf(checkDifficulty(withDifficulty('standard', 3), { intendedActions: 6 }))).toEqual([
      'difficulty_estimate_implausible',
    ]);
  });

  it('accepts an estimate exactly at the optimum', () => {
    expect(checkDifficulty(withDifficulty('standard', 6), { intendedActions: 6 })).toEqual([]);
  });

  it('accepts an estimate exactly at three times the optimum', () => {
    expect(checkDifficulty(withDifficulty('standard', 18), { intendedActions: 6 })).toEqual([]);
  });

  it('rejects an estimate above three times the optimum', () => {
    expect(codesOf(checkDifficulty(withDifficulty('standard', 19), { intendedActions: 6 }))).toEqual([
      'difficulty_estimate_implausible',
    ]);
  });

  it('measures slack against the intended route, so a shortcut cannot inflate the complaint', () => {
    // The committed `broken-chain` fixture forced this: its shortcut makes
    // minActions 4, and a 3x4 ceiling would reject an estimate of 14 that the
    // intended six-action chain makes perfectly reasonable. A chain defect must
    // not surface as a difficulty defect.
    expect(checkDifficulty(withDifficulty('standard', 14), { intendedActions: 6 })).toEqual([]);
  });
});

describe('a band failure suppresses the estimate check', () => {
  it('reports exactly one code for the out-of-band fixture shape', () => {
    // band easy + estimate 400 breaks both rules; only the band is reported, so
    // the committed fixture yields exactly one code.
    const result = checkDifficulty(withDifficulty('easy', 400), { intendedActions: 6 });
    expect(codesOf(result)).toEqual(['difficulty_out_of_band']);
  });
});

describe('bandFor', () => {
  it('names the band a room of that length would honestly declare', () => {
    expect(bandFor(2)).toBe('easy');
    expect(bandFor(6)).toBe('standard');
    expect(bandFor(20)).toBe('hard');
  });

  it('returns null past the top of the scale', () => {
    expect(bandFor(100)).toBeNull();
  });
});

describe('the range table', () => {
  it('is contiguous and non-overlapping', () => {
    const ranges = Object.values(DIFFICULTY_RANGES).sort((a, b) => a.min - b.min);
    for (let i = 0; i < ranges.length - 1; i++) {
      expect(ranges[i + 1]!.min).toBe(ranges[i]!.max + 1);
    }
  });
});
