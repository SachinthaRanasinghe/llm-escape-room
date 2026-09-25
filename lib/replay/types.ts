import type { ActionName, VerdictCode } from '@/lib/schema/action';
import type { REJECTION_KINDS } from '@/lib/schema/event';
import type { ObjectKind } from '@/lib/schema/room';
import type { EndReason, Provider } from '@/lib/schema/run';

/**
 * The replay's contract — what the server page hands the client player.
 *
 * Everything here is PLAIN JSON: no `Map`, no `Set`, no `Date`, no class, no
 * function. It crosses the server → client boundary as a React prop in
 * TICKET-8 (#5), and TICKET-9 (#9) freezes it into a published artifact, so a
 * value that does not survive `JSON.stringify` is a bug waiting for either.
 *
 * ── What is deliberately absent: the room ──────────────────────────────────
 * A `RoomSpec` carries every lock code and answer. The player never receives
 * one. It receives a `SceneLayout` — a public projection built by listing fields
 * in `layout.ts` — plus the log, which already says everything a viewer is
 * entitled to see. `boundary.test.ts` holds this mechanically.
 *
 * Type imports only. `lib/replay` ships to the browser.
 */

export type RejectionKind = (typeof REJECTION_KINDS)[number];

/** A floor position. `y` is always the floor, so it is not stored. */
export type Vec2 = readonly [x: number, z: number];

/** Public projection of one `RoomObject`. Listed, never spread — see `layout.ts`. */
export interface SceneObject {
  readonly id: string;
  readonly name: string;
  readonly kind: ObjectKind;
  /** Which object `contains` this one, or `null` when it stands in the room. */
  readonly parentId: string | null;
  /** A contained object sits where its top-level ancestor sits. */
  readonly position: Vec2;
}

export interface SceneLayout {
  readonly roomId: string;
  readonly themeName: string;
  /** Room order. */
  readonly objects: readonly SceneObject[];
  /** `puzzleId → unlocksObjectId`, so `submit_answer` has somewhere to walk to. */
  readonly puzzleTargets: Readonly<Record<string, string>>;
  readonly exitObjectId: string;
  /** Where a character stands to `look`, or when it names an object that does not exist. */
  readonly centre: Vec2;
}

/** One recorded action, as the player draws it. */
export interface ReplayBeat {
  readonly seq: number;
  /** `null` for a rejected turn — the model sent no valid action. */
  readonly verb: ActionName | null;
  /** A layout object id, or `null` when the action has no target or names one that does not exist. */
  readonly targetId: string | null;
  /** What the model named, verbatim, even when it does not exist (`bookshelf`). */
  readonly rawTargetId: string | null;
  /** `use`'s held item. */
  readonly heldItemId: string | null;
  /** `enter_code`'s code or `submit_answer`'s answer, verbatim. */
  readonly argument: string | null;
  /** VERBATIM, or `null` when the model wrote none. Never invented, never trimmed. */
  readonly intent: string | null;
  readonly rejection: RejectionKind | null;
  readonly verdict: { readonly ok: boolean; readonly code: VerdictCode; readonly message: string };
  /** Real wall-clock think-time — a stat, never a duration. */
  readonly thinkMs: number;
  readonly cumulativeThinkMs: number;
}

export interface ReplayLane {
  readonly competitorId: string;
  /** The model id, as the run recorded it. */
  readonly label: string;
  readonly provider: Provider;
  /** `seq` order. */
  readonly beats: readonly ReplayBeat[];
  readonly endedBecause: EndReason;
  readonly escaped: boolean;
  /** `Run.budget.maxActions`, for "Action 7 / 14". */
  readonly maxActions: number;
}

export interface ReplayData {
  readonly runId: string;
  readonly layout: SceneLayout;
  /** `Run.competitors` order. */
  readonly lanes: readonly ReplayLane[];
}

export type LanePhase = 'intro' | 'walk' | 'act' | 'hold' | 'done';

/** Where one lane is at one instant. */
export interface LaneMoment {
  /** `-1` during the intro; the last beat's index once `done`. */
  readonly beatIndex: number;
  readonly phase: LanePhase;
  /** 0..1 within the phase. */
  readonly progress: number;
}

export interface BeatPlan {
  readonly beatMs: number;
  readonly introMs: number;
  readonly outroMs: number;
  /** Per lane, in lane order. */
  readonly laneOffsetsMs: readonly number[];
  /** Per lane, in lane order. */
  readonly beatCounts: readonly number[];
  readonly totalMs: number;
  /** Within a beat: the share spent walking to the target… */
  readonly walkFraction: number;
  /** …and acting on it. The rest holds the verdict. */
  readonly actFraction: number;
  readonly exitWalkMs: number;
  readonly exitFadeMs: number;
}

/** What one lane's copy of the room looks like at a given beat. Sorted, deduplicated ids. */
export interface LaneRoomState {
  readonly opened: readonly string[];
  readonly unlocked: readonly string[];
  readonly held: readonly string[];
  readonly escaped: boolean;
}

/**
 * What the player reports to an observer — TICKET-11 (#11). The replay clock's
 * time (never the wall clock, so paused time does not count), the playback
 * state, and whether the viewer skipped to the results. Lives here, not in
 * `lib/telemetry`, so the scene never imports telemetry.
 */
export interface PlaybackProgress {
  readonly tMs: number;
  readonly state: 'playing' | 'paused' | 'ended';
  readonly skipped: boolean;
}
