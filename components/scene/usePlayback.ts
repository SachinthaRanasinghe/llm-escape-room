'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { laneAt, type BeatPlan, type LaneMoment } from '@/lib/replay';

/**
 * The replay's one clock.
 *
 * ── Two speeds on purpose ──────────────────────────────────────────────────
 * `timeRef` advances every animation frame and is read inside R3F's `useFrame`,
 * which is where smooth motion happens. React state (`moments`) changes only
 * when some lane crosses into a new beat or phase — about four times a beat —
 * so the DOM panels re-render at the pace a viewer reads, not 60 times a second.
 * Setting React state per frame is the first R3F performance pitfall.
 *
 * ── The only clock read ────────────────────────────────────────────────────
 * Time comes from the `requestAnimationFrame` timestamp and nowhere else — no
 * wall-clock or high-resolution timer reads (`lib/replay/boundary.test.ts`). That keeps
 * the replay deterministic in tests: Playwright's fake clock drives rAF, so a
 * 79-second run can be played to the end in a couple of seconds.
 *
 * Pausing only stops the clock. The pacing itself is `lib/replay/beats.ts`'s,
 * and neither reduced motion nor a slow frame changes it — a long frame is
 * capped at `MAX_STEP_MS` so a backgrounded tab resumes where it left off
 * rather than jumping ahead.
 */

const MAX_STEP_MS = 250;

export type PlaybackState = 'playing' | 'paused' | 'ended';

export interface Playback {
  readonly timeRef: RefObject<number>;
  readonly moments: readonly LaneMoment[];
  readonly state: PlaybackState;
  readonly toggle: () => void;
  readonly restart: () => void;
}

function momentsAt(plan: BeatPlan, tMs: number): LaneMoment[] {
  return plan.beatCounts.map((_, i) => laneAt(plan, i, tMs));
}

function sameMoments(a: readonly LaneMoment[], b: readonly LaneMoment[]): boolean {
  return a.every((m, i) => m.beatIndex === b[i].beatIndex && m.phase === b[i].phase);
}

export function usePlayback(plan: BeatPlan): Playback {
  const timeRef = useRef(0);
  const [moments, setMoments] = useState(() => momentsAt(plan, 0));
  const [state, setState] = useState<PlaybackState>('playing');

  useEffect(() => {
    if (state !== 'playing') return;
    let frame = 0;
    let last: number | null = null;

    const step = (now: number) => {
      if (last !== null) timeRef.current = Math.min(plan.totalMs, timeRef.current + Math.min(now - last, MAX_STEP_MS));
      last = now;
      const next = momentsAt(plan, timeRef.current);
      setMoments((prev) => (sameMoments(prev, next) ? prev : next));
      if (timeRef.current >= plan.totalMs) {
        setState('ended');
        return;
      }
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [state, plan]);

  const restart = useCallback(() => {
    timeRef.current = 0;
    setMoments(momentsAt(plan, 0));
    setState('playing');
  }, [plan]);

  const toggle = useCallback(() => {
    if (state === 'ended') restart();
    else setState(state === 'playing' ? 'paused' : 'playing');
  }, [state, restart]);

  return { timeRef, moments, state, toggle, restart };
}

/** Whether the viewer asked for less motion. Affects chrome and camera only — never pacing. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
