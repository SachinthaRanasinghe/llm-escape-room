'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { laneAt, type BeatPlan, type LaneMoment } from '@/lib/replay';

/**
 * The clock for a race that is still being run — the live twin of `usePlayback`.
 *
 * ── One clock per lane ─────────────────────────────────────────────────────
 * A recorded replay has every beat up front, so one clock paces both lanes. A
 * live race does not: each model's next action exists only once its provider has
 * answered, and the two answer at different speeds. So each lane has its own
 * clock, and a lane's clock may only run up to the end of the last beat that has
 * ARRIVED. There it holds — the verdict on screen, the character standing — and
 * the panel says the model is thinking, until the next beat lands.
 *
 * ── Catching up ────────────────────────────────────────────────────────────
 * A fast provider answers in a second; a beat is several seconds on screen. When
 * beats queue up behind the clock, the lane plays faster (up to `MAX_RATE`) so
 * the scene stays close to what the model is doing now, then drops back to the
 * normal pace once it has caught up. The beat plan itself is unchanged — only
 * how fast the lane's clock moves through it.
 *
 * The plan's lane offsets are expected to be 0: the lanes already start apart,
 * because their models answer apart.
 *
 * Like `usePlayback`, time comes only from the `requestAnimationFrame`
 * timestamp, and React state changes only when a lane crosses a phase.
 */

const MAX_STEP_MS = 250;
const MAX_RATE = 4;

export interface LivePlayback {
  /** One clock per lane, read inside `useFrame`. */
  readonly timeRefs: readonly RefObject<number>[];
  readonly moments: readonly LaneMoment[];
  /** Per lane: caught up with the model and waiting for its next action. */
  readonly waiting: readonly boolean[];
  /** Every lane has finished and played to its end. */
  readonly ended: boolean;
}

/** How far lane `i`'s clock may run: the end of its last arrived beat, or its exit once finished. */
function capOf(plan: BeatPlan, i: number, finished: boolean): number {
  const count = plan.beatCounts[i] ?? 0;
  if (finished) return plan.introMs + count * plan.beatMs + plan.exitWalkMs + plan.exitFadeMs;
  // A millisecond short of the next beat, so the lane holds on the last verdict rather than going `done`.
  return plan.introMs + count * plan.beatMs - 1;
}

function sameMoments(a: readonly LaneMoment[], b: readonly LaneMoment[]): boolean {
  return a.length === b.length && a.every((m, i) => m.beatIndex === b[i].beatIndex && m.phase === b[i].phase);
}

export function useLivePlayback(plan: BeatPlan, finished: readonly boolean[]): LivePlayback {
  const laneCount = plan.beatCounts.length;
  const timeRefs = useMemo(() => Array.from({ length: laneCount }, () => ({ current: 0 })), [laneCount]);
  const [moments, setMoments] = useState<LaneMoment[]>(() => timeRefs.map((_, i) => laneAt(plan, i, 0)));
  const [waiting, setWaiting] = useState<boolean[]>(() => timeRefs.map(() => false));
  const [ended, setEnded] = useState(false);

  // The loop reads the latest plan without restarting on every beat.
  const latest = useRef({ plan, finished });
  useEffect(() => {
    latest.current = { plan, finished };
  }, [plan, finished]);

  useEffect(() => {
    let frame = 0;
    let last: number | null = null;

    const step = (now: number) => {
      const { plan: p, finished: done } = latest.current;
      const dt = last === null ? 0 : Math.min(now - last, MAX_STEP_MS);
      last = now;

      const caps = timeRefs.map((_, i) => capOf(p, i, done[i] ?? false));
      timeRefs.forEach((ref, i) => {
        const current = laneAt(p, i, ref.current);
        const queued = (p.beatCounts[i] ?? 0) - Math.max(current.beatIndex + 1, 0);
        const rate = Math.min(MAX_RATE, 1 + Math.max(0, queued - 1) * 0.75);
        ref.current = Math.min(caps[i], ref.current + dt * rate);
      });

      const nextMoments = timeRefs.map((ref, i) => laneAt(p, i, ref.current));
      const nextWaiting = timeRefs.map((ref, i) => !(done[i] ?? false) && ref.current >= caps[i]);
      setMoments((prev) => (sameMoments(prev, nextMoments) ? prev : nextMoments));
      setWaiting((prev) => (prev.every((w, i) => w === nextWaiting[i]) ? prev : nextWaiting));

      const allDone = timeRefs.every((ref, i) => (done[i] ?? false) && ref.current >= caps[i]);
      if (allDone) {
        setEnded(true);
        return;
      }
      frame = requestAnimationFrame(step);
    };

    setEnded(false);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // Restart only when the lanes change, or when a finished race gets a new beat (it cannot today).
  }, [timeRefs, finished]);

  return { timeRefs, moments, waiting, ended };
}
