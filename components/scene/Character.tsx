'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import type { Group, Mesh, MeshStandardMaterial } from 'three';
import {
  beatStartMs,
  laneAt,
  VERDICT_TONE,
  type BeatPlan,
  type ReplayBeat,
  type ReplayLane,
  type SceneLayout,
  type Vec2,
} from '@/lib/replay';
import { KIND_COLOUR } from './palette';
import { yawToward } from './SceneObject';

/**
 * One competitor's stand-in: a capsule and a head.
 *
 * ── A pure function of time ────────────────────────────────────────────────
 * Every frame recomputes the pose from `timeRef` alone — where the lane is in
 * its beat, where it came from, where it is going — rather than integrating
 * velocity. The same instant always draws the same pose, so a pause, a restart
 * or a fake test clock cannot leave the character somewhere the log never put
 * it.
 *
 * Per beat: WALK to the target (or to the centre, for `look` and for an object
 * that does not exist), ACT with a verb-specific gesture, then HOLD and react to
 * the verdict — a hop, a head shake, or a shrug. A rejected turn shrugs in place.
 */

/** How far in front of an object the character stands. */
const STAND_OFF = 0.9;
/** After its last beat, an escaped character walks out through the exit and fades. */
const EXIT_WALK_MS = 1500;
const EXIT_FADE_MS = 1000;

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

interface Props {
  readonly lane: ReplayLane;
  readonly laneIndex: number;
  readonly layout: SceneLayout;
  readonly plan: BeatPlan;
  readonly timeRef: RefObject<number>;
  readonly colour: string;
  /** How many items the character is carrying. */
  readonly carrying: number;
}

export function Character({ lane, laneIndex, layout, plan, timeRef, colour, carrying }: Props) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Mesh>(null);
  const bodyMat = useRef<MeshStandardMaterial>(null);
  const headMat = useRef<MeshStandardMaterial>(null);

  const positions = useMemo(() => new Map(layout.objects.map((o) => [o.id, o.position])), [layout]);

  const standFor = useMemo(() => {
    return (beat: ReplayBeat | undefined): Vec2 => {
      const at = beat?.targetId ? positions.get(beat.targetId) : undefined;
      if (!at) return layout.centre;
      const dx = layout.centre[0] - at[0];
      const dz = layout.centre[1] - at[1];
      const length = Math.hypot(dx, dz) || 1;
      return [at[0] + (dx / length) * STAND_OFF, at[1] + (dz / length) * STAND_OFF];
    };
  }, [positions, layout]);

  const exitAt = positions.get(layout.exitObjectId) ?? layout.centre;

  useFrame(() => {
    if (!root.current || !body.current || !head.current) return;
    const t = timeRef.current ?? 0;
    const moment = laneAt(plan, laneIndex, t);
    const current = lane.beats[moment.beatIndex];
    const from = moment.beatIndex > 0 ? standFor(lane.beats[moment.beatIndex - 1]) : layout.centre;
    const to = moment.phase === 'intro' ? layout.centre : standFor(current);

    let position: Vec2 = to;
    let yaw = 0;
    let lean = 0;
    let lift = 0;
    let squash = 1;
    let shake = 0;
    let opacity = 1;

    const facing = (): number => {
      const target = current?.targetId ? positions.get(current.targetId) : undefined;
      return target ? yawToward(position, target) : Math.PI; // no target: face the back wall
    };

    switch (moment.phase) {
      case 'intro':
        position = layout.centre;
        yaw = 0; // facing the camera
        break;
      case 'walk': {
        const p = easeInOut(moment.progress);
        position = lerp2(from, to, p);
        const moving = Math.hypot(to[0] - from[0], to[1] - from[1]) > 0.01;
        yaw = moving ? yawToward(from, to) : facing();
        break;
      }
      case 'act': {
        yaw = facing();
        const s = Math.sin(moment.progress * Math.PI);
        if (current?.verb === null) squash = 1 - 0.15 * s;
        else if (current?.verb === 'look') yaw += Math.sin(moment.progress * Math.PI * 2) * 0.9;
        else if (current?.verb === 'enter_code' || current?.verb === 'submit_answer') {
          lift = Math.abs(Math.sin(moment.progress * Math.PI * 3)) * 0.06;
        } else lean = 0.35 * s;
        break;
      }
      case 'hold': {
        yaw = facing();
        const react = Math.min(1, moment.progress / 0.4);
        const s = Math.sin(react * Math.PI);
        const tone = current ? VERDICT_TONE[current.verdict.code] : 'neutral';
        if (tone === 'success') lift = 0.22 * s;
        else if (tone === 'failure') shake = Math.sin(react * Math.PI * 4) * 0.35;
        else if (tone === 'invalid') squash = 1 - 0.12 * s;
        break;
      }
      case 'done': {
        const last = standFor(lane.beats.at(-1));
        position = last;
        yaw = 0;
        if (lane.escaped) {
          const since = t - beatStartMs(plan, laneIndex, lane.beats.length);
          const beyond: Vec2 = [exitAt[0], exitAt[1] - 1.2];
          if (since < EXIT_WALK_MS) {
            position = lerp2(last, exitAt, easeInOut(Math.max(0, since) / EXIT_WALK_MS));
            yaw = yawToward(last, exitAt);
          } else {
            const fade = Math.min(1, (since - EXIT_WALK_MS) / EXIT_FADE_MS);
            position = lerp2(exitAt, beyond, fade);
            yaw = Math.PI;
            opacity = 1 - fade;
          }
        }
        break;
      }
    }

    root.current.position.set(position[0], lift, position[1]);
    root.current.rotation.y = yaw;
    body.current.rotation.x = lean;
    body.current.scale.set(1, squash, 1);
    head.current.rotation.y = shake;
    for (const mat of [bodyMat.current, headMat.current]) {
      if (mat) {
        mat.opacity = opacity;
        mat.transparent = opacity < 1;
      }
    }
    root.current.visible = opacity > 0.01;
  });

  return (
    <group ref={root}>
      <group ref={body}>
        <mesh position={[0, 0.65, 0]}>
          <capsuleGeometry args={[0.28, 0.6, 4, 12]} />
          <meshStandardMaterial ref={bodyMat} color={colour} roughness={0.6} />
        </mesh>
        <mesh ref={head} position={[0, 1.32, 0]}>
          <sphereGeometry args={[0.22, 20, 16]} />
          <meshStandardMaterial ref={headMat} color={colour} roughness={0.5} />
          {/* A nose, so which way it faces is legible from the camera. */}
          <mesh position={[0, 0, 0.21]}>
            <boxGeometry args={[0.08, 0.06, 0.08]} />
            <meshStandardMaterial color="#1b1d22" />
          </mesh>
        </mesh>
        {Array.from({ length: carrying }, (_, i) => (
          <mesh key={i} position={[0.36, 0.72 + i * 0.16, 0.18]}>
            <boxGeometry args={[0.2, 0.14, 0.26]} />
            <meshStandardMaterial color={KIND_COLOUR.portable} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
