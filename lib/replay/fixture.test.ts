import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { buildReplay, buildSceneLayout, isSettled, laneAt, laneStateAt, planBeats, WATCH_TARGET_MS } from '.';

/**
 * The golden path, end to end: fixtures → layout → replay → plan → final state.
 * This is exactly what `app/replay/page.tsx` computes on the server and what the
 * client plays.
 */

const layout = buildSceneLayout(loadCanonicalRoom());
const data = buildReplay({ log: loadCanonicalLog(), run: loadCanonicalRun(), layout });
const plan = planBeats(data);

describe('the canonical replay', () => {
  it('survives the server → client boundary unchanged', () => {
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it('lands inside the watch target', () => {
    expect(plan.totalMs).toBeGreaterThanOrEqual(WATCH_TARGET_MS.min);
    expect(plan.totalMs).toBeLessThanOrEqual(WATCH_TARGET_MS.max);
  });

  it('ends with model-a out of the room and model-b still in it', () => {
    const [a, b] = data.lanes;
    const ma = laneAt(plan, 0, plan.totalMs);
    const mb = laneAt(plan, 1, plan.totalMs);
    expect(ma.phase).toBe('done');
    expect(mb.phase).toBe('done');
    expect(laneStateAt(a, layout, ma.beatIndex, isSettled(ma)).escaped).toBe(true);
    expect(laneStateAt(b, layout, mb.beatIndex, isSettled(mb)).escaped).toBe(false);
  });

  it('has model-a finish a beat before model-b', () => {
    const aEnd = plan.introMs + plan.laneOffsetsMs[0] + plan.beatCounts[0] * plan.beatMs;
    const bEnd = plan.introMs + plan.laneOffsetsMs[1] + plan.beatCounts[1] * plan.beatMs;
    expect(bEnd - aEnd).toBe(plan.beatMs + plan.laneOffsetsMs[1]);
  });
});
