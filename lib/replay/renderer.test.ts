import { describe, expect, it } from 'vitest';
import {
  ACT_FRACTION,
  BEAT_MS,
  beatStartMs,
  DEFAULT_TIMING,
  INTRO_MS,
  LANE_OFFSET_MS,
  laneAt,
  OUTRO_MS,
  planBeats,
  RENDERER_VERSION,
  WALK_FRACTION,
} from './beats';
import { ROOM_HALF } from './layout';
import { CURRENT_RENDERER, rendererMajor, SUPPORTED_RENDERER_MAJORS } from './renderer';
import { lane, replayData } from './testing';

describe('the current renderer snapshot', () => {
  it('is plain JSON — it is frozen into a file and crosses into the client as a prop', () => {
    expect(JSON.parse(JSON.stringify(CURRENT_RENDERER))).toEqual(CURRENT_RENDERER);
  });

  it('is the constants, not a second copy of them', () => {
    expect(CURRENT_RENDERER.rendererVersion).toBe(RENDERER_VERSION);
    expect(CURRENT_RENDERER.timing).toBe(DEFAULT_TIMING);
    expect(DEFAULT_TIMING).toMatchObject({
      beatMs: BEAT_MS,
      introMs: INTRO_MS,
      outroMs: OUTRO_MS,
      laneOffsetMs: LANE_OFFSET_MS,
      walkFraction: WALK_FRACTION,
      actFraction: ACT_FRACTION,
    });
    expect(CURRENT_RENDERER.geometry.roomHalf).toBe(ROOM_HALF);
  });

  it('can always play what it publishes', () => {
    expect(SUPPORTED_RENDERER_MAJORS).toContain(rendererMajor(CURRENT_RENDERER.rendererVersion));
  });
});

describe('rendererMajor', () => {
  it('reads the major of replay-v<major>.<minor>', () => {
    expect(rendererMajor('replay-v0.1')).toBe(0);
    expect(rendererMajor('replay-v12.3')).toBe(12);
  });

  it('refuses anything else', () => {
    for (const bad of ['v0.1', 'replay-v0', 'replay-v0.1.2', 'replay-va.1', '']) {
      expect(rendererMajor(bad), bad).toBeNull();
    }
  });
});

describe('the plan is the only source of time', () => {
  const data = replayData([lane(3), lane(2, { competitorId: 'b' })]);
  const faster = { ...DEFAULT_TIMING, beatMs: 4000, laneOffsetMs: 0, walkFraction: 0.5 };

  it('follows the timing it is given', () => {
    const plan = planBeats(data, faster);
    expect(plan.beatMs).toBe(4000);
    expect(plan.laneOffsetsMs).toEqual([0, 0]);
    expect(plan.totalMs).toBe(INTRO_MS + 3 * 4000 + OUTRO_MS);
    expect(plan.walkFraction).toBe(0.5);
  });

  it('defaults to the current timing', () => {
    expect(planBeats(data)).toEqual(planBeats(data, DEFAULT_TIMING));
  });

  it("puts laneAt's phase boundaries where the plan's fractions say, not the module's", () => {
    const plan = planBeats(data, faster);
    const s = beatStartMs(plan, 0, 1);
    expect(laneAt(plan, 0, s + 1999).phase).toBe('walk');
    expect(laneAt(plan, 0, s + 2000)).toEqual({ beatIndex: 1, phase: 'act', progress: 0 });
  });
});
