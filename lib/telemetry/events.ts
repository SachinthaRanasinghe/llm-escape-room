/**
 * The watch-through vocabulary — TICKET-11 (#11).
 *
 * Four event names, and nothing else a published run ever sends. Each maps to
 * one line of `llm-escape-room.prd.md`:
 *
 *   run-open       the player mounted on `/run/<id>`. The denominator: opens.
 *   run-t30        the REPLAY clock reached 30 s of playback. Paused time does
 *                  not count. Hypothesis · WRONG if "viewers drop inside the
 *                  first 30 seconds".
 *   run-complete   playback reached its end on its own. Success metrics ·
 *                  Watch-through, "≥ 50% of opens".
 *   run-skip       the viewer pressed "Skip to results". Reported on its own
 *                  line and NEVER counted as a completion.
 *
 * Each fires at most once per page load — a restart does not count again — and
 * none carries a visitor id. `docs/decisions/telemetry.md` records why.
 */

export const TELEMETRY_EVENTS = ['run-open', 'run-t30', 'run-complete', 'run-skip'] as const;

export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];

/** The PRD's survival mark, on the replay clock. */
export const T30_MS = 30_000;
