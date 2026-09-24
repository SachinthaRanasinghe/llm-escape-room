import type { BeatPlan, LaneMoment, ReplayData } from './types';

/**
 * The beat scheduler — how long everything is on screen.
 *
 * ── Uniform by design ──────────────────────────────────────────────────────
 * Every recorded action gets exactly `BEAT_MS`, however long the model took to
 * produce it. Real think-time is a STAT beside the character
 * (`lib/schema/event.ts`, `latencyMs`), never a duration: if pacing followed
 * provider latency, watch length would swing with the provider's queue and a
 * slow model would look like a thoughtful one. The log carries no pacing at all;
 * this file derives it.
 *
 * ── Tuned to the watch target ──────────────────────────────────────────────
 * The PRD wants a typical run inside 60–90 s. With today's 14-action budget:
 * 3 s intro + 2.5 s lane offset + 14 × 5 s + 4 s outro = 79.5 s. A quick escape
 * runs shorter, BY DESIGN — the beat never stretches to fill. If TICKET-7 (#8)
 * raises the action budget, `beats.test.ts` fails, which is the point: it forces
 * a deliberate retune of these constants rather than a silent 100-second replay.
 *
 * ── Retuning ───────────────────────────────────────────────────────────────
 * Spike 3 (`docs/decisions/replay-legibility.md`) turns only these knobs and the
 * intent typography — never the model's words. Change a constant, bump
 * `RENDERER_VERSION`, update the note. TICKET-9 (#9) freezes all of them into the
 * render manifest so a published run never re-paces under a viewer.
 *
 * Pure arithmetic: no clock, no loop over time.
 */

/** Every action gets exactly this much screen time. */
export const BEAT_MS = 5000;
/** Both rooms and labels visible, nobody moving. */
export const INTRO_MS = 3000;
/** Final poses held after the last lane's last beat. */
export const OUTRO_MS = 4000;
/**
 * Lane `i` starts `i ×` this later, so the two intents change alternately rather
 * than together — one new line to read every 2.5 s instead of two every 5 s.
 * Set to 0 for strict lockstep.
 */
export const LANE_OFFSET_MS = BEAT_MS / 2;
/** Within a beat: walk to the target... */
export const WALK_FRACTION = 0.3;
/** ...act on it; the rest of the beat holds the verdict while the intent is read. */
export const ACT_FRACTION = 0.25;
export const WATCH_TARGET_MS = { min: 60_000, max: 90_000 } as const;
/** Bumped whenever any constant above changes. TICKET-9 (#9) freezes it into the render manifest. */
export const RENDERER_VERSION = 'replay-v0.1';

export function planBeats(data: ReplayData): BeatPlan {
  const laneOffsetsMs = data.lanes.map((_, i) => i * LANE_OFFSET_MS);
  const beatCounts = data.lanes.map((lane) => lane.beats.length);
  const longest = Math.max(0, ...beatCounts.map((count, i) => laneOffsetsMs[i] + count * BEAT_MS));
  return {
    beatMs: BEAT_MS,
    introMs: INTRO_MS,
    outroMs: OUTRO_MS,
    laneOffsetsMs,
    beatCounts,
    totalMs: INTRO_MS + longest + OUTRO_MS,
  };
}

/** When beat `beatIndex` of lane `laneIndex` starts. */
export function beatStartMs(plan: BeatPlan, laneIndex: number, beatIndex: number): number {
  return plan.introMs + plan.laneOffsetsMs[laneIndex] + beatIndex * plan.beatMs;
}

/** Where lane `laneIndex` is at `tMs` into the replay. `tMs` is clamped to the plan. */
export function laneAt(plan: BeatPlan, laneIndex: number, tMs: number): LaneMoment {
  const t = Math.min(Math.max(tMs, 0), plan.totalMs);
  const count = plan.beatCounts[laneIndex];
  const start = beatStartMs(plan, laneIndex, 0);

  if (t < start) return { beatIndex: -1, phase: 'intro', progress: start === 0 ? 1 : t / start };

  const elapsed = t - start;
  const beatIndex = Math.floor(elapsed / plan.beatMs);
  if (beatIndex >= count) return { beatIndex: count - 1, phase: 'done', progress: 1 };

  // Whole milliseconds, so a phase boundary lands exactly where the constants say.
  const within = elapsed - beatIndex * plan.beatMs;
  const walkMs = Math.round(plan.beatMs * WALK_FRACTION);
  const actMs = Math.round(plan.beatMs * ACT_FRACTION);
  if (within < walkMs) return { beatIndex, phase: 'walk', progress: within / walkMs };
  if (within < walkMs + actMs) return { beatIndex, phase: 'act', progress: (within - walkMs) / actMs };
  return { beatIndex, phase: 'hold', progress: (within - walkMs - actMs) / (plan.beatMs - walkMs - actMs) };
}

/** The verdict has landed for the current beat — `hold` or later. */
export function isSettled(moment: LaneMoment): boolean {
  return moment.phase === 'hold' || moment.phase === 'done';
}
