import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import {
  ACT_FRACTION,
  allVerdictsIn,
  BEAT_MS,
  beatStartMs,
  INTRO_MS,
  isSettled,
  LANE_OFFSET_MS,
  laneAt,
  OUTRO_MS,
  planBeats,
  WALK_FRACTION,
  WATCH_TARGET_MS,
} from './beats';
import { buildSceneLayout } from './layout';
import { beat, lane, replayData } from './testing';
import { buildReplay } from './timeline';

const canonical = buildReplay({
  log: loadCanonicalLog(),
  run: loadCanonicalRun(),
  layout: buildSceneLayout(loadCanonicalRoom()),
});

const RETUNE =
  'a typical run left the 60–90 s watch target — retune BEAT_MS / INTRO_MS / OUTRO_MS / LANE_OFFSET_MS ' +
  '(and bump RENDERER_VERSION) rather than widening this band';

describe('the watch target', () => {
  it('puts the canonical run inside 60–90 s', () => {
    const plan = planBeats(canonical);
    expect(plan.totalMs).toBe(INTRO_MS + LANE_OFFSET_MS + 14 * BEAT_MS + OUTRO_MS);
    expect(plan.totalMs, RETUNE).toBeGreaterThanOrEqual(WATCH_TARGET_MS.min);
    expect(plan.totalMs, RETUNE).toBeLessThanOrEqual(WATCH_TARGET_MS.max);
  });

  it('puts a run where both lanes use the whole budget inside 60–90 s', () => {
    const budget = canonical.lanes[0].maxActions;
    const plan = planBeats(replayData([lane(budget), lane(budget, { competitorId: 'b' })]));
    expect(plan.totalMs, RETUNE).toBeGreaterThanOrEqual(WATCH_TARGET_MS.min);
    expect(plan.totalMs, RETUNE).toBeLessThanOrEqual(WATCH_TARGET_MS.max);
  });

  it('lets a quick escape run short rather than stretching the beat', () => {
    const plan = planBeats(replayData([lane(6), lane(8, { competitorId: 'b' })]));
    expect(plan.beatMs).toBe(BEAT_MS);
    expect(plan.totalMs).toBe(INTRO_MS + LANE_OFFSET_MS + 8 * BEAT_MS + OUTRO_MS);
  });
});

describe('uniform beats', () => {
  it('gives every beat exactly BEAT_MS, whatever the think-time', () => {
    const fast = lane(5, { beats: Array.from({ length: 5 }, (_, seq) => beat({ seq, thinkMs: 10 })) });
    const slow = lane(5, {
      competitorId: 'b',
      beats: Array.from({ length: 5 }, (_, seq) => beat({ seq, thinkMs: 60_000 })),
    });
    const plan = planBeats(replayData([fast, slow]));
    for (const laneIndex of [0, 1]) {
      for (let k = 0; k < 5; k++) {
        expect(beatStartMs(plan, laneIndex, k + 1) - beatStartMs(plan, laneIndex, k)).toBe(BEAT_MS);
      }
    }
    // Swapping the latencies changes nothing.
    expect(planBeats(replayData([slow, fast]))).toEqual({ ...plan });
  });

  it('keeps the phases inside one beat', () => {
    expect(WALK_FRACTION + ACT_FRACTION).toBeLessThan(1);
  });
});

describe('laneAt', () => {
  const plan = planBeats(replayData([lane(3), lane(2, { competitorId: 'b' })]));

  it('is in the intro before the lane starts', () => {
    expect(laneAt(plan, 0, 0)).toEqual({ beatIndex: -1, phase: 'intro', progress: 0 });
    expect(laneAt(plan, 1, INTRO_MS + 100).phase).toBe('intro');
  });

  it('walks, acts and holds at the exact boundaries', () => {
    const s = beatStartMs(plan, 0, 1);
    expect(laneAt(plan, 0, s)).toEqual({ beatIndex: 1, phase: 'walk', progress: 0 });
    expect(laneAt(plan, 0, s + WALK_FRACTION * BEAT_MS)).toEqual({ beatIndex: 1, phase: 'act', progress: 0 });
    expect(laneAt(plan, 0, s + (WALK_FRACTION + ACT_FRACTION) * BEAT_MS)).toEqual({
      beatIndex: 1,
      phase: 'hold',
      progress: 0,
    });
    expect(laneAt(plan, 0, s + BEAT_MS - 1).phase).toBe('hold');
  });

  it('offsets the second lane by LANE_OFFSET_MS', () => {
    expect(beatStartMs(plan, 1, 0) - beatStartMs(plan, 0, 0)).toBe(LANE_OFFSET_MS);
    expect(laneAt(plan, 1, INTRO_MS + LANE_OFFSET_MS)).toEqual({ beatIndex: 0, phase: 'walk', progress: 0 });
  });

  it('lets a shorter lane finish first and stay done', () => {
    const bDone = beatStartMs(plan, 1, 2);
    expect(laneAt(plan, 1, bDone)).toEqual({ beatIndex: 1, phase: 'done', progress: 1 });
    expect(laneAt(plan, 0, bDone).phase).not.toBe('done');
    expect(laneAt(plan, 1, plan.totalMs).phase).toBe('done');
  });

  it('clamps outside the plan', () => {
    expect(laneAt(plan, 0, -500)).toEqual(laneAt(plan, 0, 0));
    expect(laneAt(plan, 0, plan.totalMs + 10_000)).toEqual({ beatIndex: 2, phase: 'done', progress: 1 });
  });

  it('calls a beat settled once its verdict lands', () => {
    const s = beatStartMs(plan, 0, 0);
    expect(isSettled(laneAt(plan, 0, s))).toBe(false);
    expect(isSettled(laneAt(plan, 0, s + BEAT_MS * 0.9))).toBe(true);
    expect(isSettled(laneAt(plan, 0, plan.totalMs))).toBe(true);
  });
});

describe('allVerdictsIn', () => {
  const plan = planBeats(replayData([lane(3), lane(2, { competitorId: 'b' })]));
  const at = (t: number) => plan.beatCounts.map((_, i) => laneAt(plan, i, t));
  const settle = (i: number, b: number) => beatStartMs(plan, i, b) + (WALK_FRACTION + ACT_FRACTION) * BEAT_MS;

  it('waits for the last lane to be judged on its last action', () => {
    expect(allVerdictsIn(plan, at(settle(1, 1)))).toBe(false); // lane b is judged, lane a is still acting
    expect(allVerdictsIn(plan, at(settle(0, 2) - 1))).toBe(false);
    expect(allVerdictsIn(plan, at(settle(0, 2)))).toBe(true);
  });

  it('comes well before the end of the replay, which only lets the scene settle', () => {
    expect(settle(0, 2)).toBeLessThan(plan.totalMs - OUTRO_MS);
    expect(allVerdictsIn(plan, at(plan.totalMs))).toBe(true);
  });
});
