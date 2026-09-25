import type { ObjectKind } from '@/lib/schema/room';
import { DEFAULT_TIMING, RENDERER_VERSION } from './beats';
import { ROOM_HALF } from './layout';

/**
 * The single description of how a run LOOKS — TICKET-9 (#9).
 *
 * Every number and colour a retune would touch lives here as data: beat timing,
 * the camera, the palette, the stage's proportions. The player reads a snapshot
 * of this as a prop and never a module constant, which is what lets two
 * snapshots coexist:
 *
 *   `/replay`      plays `CURRENT_RENDERER` — the live preview, retuned freely.
 *   `/run/[id]`    plays the snapshot FROZEN into that run's render manifest.
 *
 * ── Versioning ─────────────────────────────────────────────────────────────
 * `rendererVersion` is `replay-v<major>.<minor>`.
 *
 *   minor   a value in here changed. Always safe: an already-published run
 *           carries its own values and replays exactly as it did.
 *   major   geometry or behaviour CODE changed in a way a snapshot cannot
 *           describe — a mesh, a gesture, what a verdict looks like. Old
 *           artifacts are refused (`SUPPORTED_RENDERER_MAJORS`) until a
 *           compatible path exists, rather than rendered wrong.
 *
 * Mesh shapes, gesture curves, `OPEN_ANGLE`, `HIGHLIGHT_INTENSITY` and the intent
 * typography are code, not data — changing how they look is a major bump. Move a
 * knob in here the day spike 3 actually retunes it, not before.
 *
 * Plain JSON only: it is frozen into a published file and crosses the server →
 * client boundary as a prop.
 */

export interface BeatTiming {
  /** Every action gets exactly this much screen time. */
  readonly beatMs: number;
  readonly introMs: number;
  readonly outroMs: number;
  /** Lane `i` starts `i ×` this later. */
  readonly laneOffsetMs: number;
  readonly walkFraction: number;
  readonly actFraction: number;
  /** After its last beat, an escaped character walks out through the exit… */
  readonly exitWalkMs: number;
  /** …and fades. */
  readonly exitFadeMs: number;
}

export interface CameraPlan {
  readonly position: readonly [x: number, y: number, z: number];
  readonly lookAt: readonly [x: number, y: number, z: number];
  readonly fov: number;
  /** Sideways drift. Always 0 under reduced motion, whatever this says. */
  readonly swayAmplitude: number;
  readonly swayPeriodMs: number;
}

export interface SceneColours {
  readonly background: string;
  readonly floor: string;
  readonly wall: string;
  readonly success: string;
  readonly failure: string;
  readonly locked: string;
  readonly unlocked: string;
}

export interface RendererAssets {
  /** Lane order. Also drives the chrome's `--lane-a` / `--lane-b`. */
  readonly laneColours: readonly string[];
  readonly scene: SceneColours;
  readonly kindColours: Readonly<Record<ObjectKind, string>>;
}

export interface StageGeometry {
  /** Half the width of the square floor. Must match the positions in the layout it is frozen with. */
  readonly roomHalf: number;
  readonly wallHeight: number;
  /** How far in front of an object a character stands. */
  readonly standOff: number;
}

export interface RendererSnapshot {
  readonly rendererVersion: string;
  readonly timing: BeatTiming;
  readonly camera: CameraPlan;
  readonly assets: RendererAssets;
  readonly geometry: StageGeometry;
}

export const CURRENT_RENDERER: RendererSnapshot = {
  rendererVersion: RENDERER_VERSION,
  timing: DEFAULT_TIMING,
  camera: {
    position: [0, 5.6, 6.2],
    lookAt: [0, 0.3, -1.4],
    fov: 42,
    swayAmplitude: 0.15,
    swayPeriodMs: DEFAULT_TIMING.beatMs * 4,
  },
  assets: {
    laneColours: ['#e0a458', '#5ab1bb'],
    scene: {
      background: '#15171c',
      floor: '#2a2d35',
      wall: '#343844',
      success: '#6fcf86',
      failure: '#e0655b',
      locked: '#c9504a',
      unlocked: '#58c472',
    },
    kindColours: {
      container: '#8a6a4a',
      fixture: '#6b7686',
      portable: '#d8c9a3',
      lock: '#7d8590',
      door: '#6e4f36',
    },
  },
  geometry: {
    roomHalf: ROOM_HALF,
    wallHeight: 1.6,
    standOff: 0.9,
  },
};

/** The renderer majors this build can play. Always includes the current one. */
export const SUPPORTED_RENDERER_MAJORS: readonly number[] = [0];

const VERSION = /^replay-v(\d+)\.(\d+)$/;

/** `replay-v0.1` → `0`; anything not in that shape → `null`. */
export function rendererMajor(version: string): number | null {
  const match = VERSION.exec(version);
  return match ? Number(match[1]) : null;
}
