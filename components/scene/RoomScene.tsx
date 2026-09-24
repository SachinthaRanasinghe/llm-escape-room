'use client';

import { PerspectiveCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import type { PerspectiveCamera as PerspectiveCameraImpl } from 'three';
import {
  BEAT_MS,
  isSettled,
  laneStateAt,
  ROOM_HALF,
  VERDICT_TONE,
  type BeatPlan,
  type LaneMoment,
  type ReplayLane,
  type SceneLayout,
} from '@/lib/replay';
import { Character } from './Character';
import { SCENE } from './palette';
import { SceneObject, type Highlight } from './SceneObject';

/**
 * One lane's copy of the room: floor, three low walls (no front, so the camera
 * sees in), the objects, and the character.
 *
 * Contained objects are not drawn until their holder is opened, and a taken
 * object stops being drawn in the room and rides on the character instead. What
 * is open, unlocked and held comes from `laneStateAt` — the log's `ok` verdicts —
 * recomputed only when the lane's coarse moment changes.
 */

const WALL_HEIGHT = 1.6;
const SWAY = 0.15;

function CameraRig({ timeRef, reduced }: { readonly timeRef: RefObject<number>; readonly reduced: boolean }) {
  const camera = useRef<PerspectiveCameraImpl>(null);
  useFrame(() => {
    if (!camera.current) return;
    const t = timeRef.current ?? 0;
    camera.current.position.x = reduced ? 0 : Math.sin((t / (BEAT_MS * 4)) * Math.PI * 2) * SWAY;
    camera.current.lookAt(0, 0.3, -1.4);
  });
  return <PerspectiveCamera ref={camera} makeDefault position={[0, 5.6, 6.2]} fov={42} />;
}

interface Props {
  readonly lane: ReplayLane;
  readonly laneIndex: number;
  readonly layout: SceneLayout;
  readonly plan: BeatPlan;
  readonly moment: LaneMoment;
  readonly timeRef: RefObject<number>;
  readonly colour: string;
  readonly reduced: boolean;
}

export function RoomScene({ lane, laneIndex, layout, plan, moment, timeRef, colour, reduced }: Props) {
  const settled = isSettled(moment);
  const state = useMemo(
    () => laneStateAt(lane, layout, moment.beatIndex, settled),
    [lane, layout, moment.beatIndex, settled],
  );
  const opened = useMemo(() => new Set(state.opened), [state]);
  const unlocked = useMemo(() => new Set(state.unlocked), [state]);
  const held = useMemo(() => new Set(state.held), [state]);

  const current = moment.beatIndex >= 0 && moment.phase !== 'done' ? lane.beats[moment.beatIndex] : undefined;
  const highlightOf = (id: string): Highlight => {
    if (!current || current.targetId !== id) return null;
    return moment.phase === 'hold' ? VERDICT_TONE[current.verdict.code] : 'active';
  };

  const byId = useMemo(() => new Map(layout.objects.map((o) => [o.id, o])), [layout]);
  const visible = layout.objects.filter((o) => {
    if (held.has(o.id)) return false;
    if (o.parentId === null) return true;
    return opened.has(o.parentId) && byId.get(o.parentId)?.parentId === null;
  });

  return (
    <>
      <color attach="background" args={[SCENE.background]} />
      <CameraRig timeRef={timeRef} reduced={reduced} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 7, 5]} intensity={1.6} />

      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[ROOM_HALF * 2, ROOM_HALF * 2]} />
        <meshStandardMaterial color={SCENE.floor} roughness={1} />
      </mesh>
      <mesh position={[0, WALL_HEIGHT / 2, -ROOM_HALF]}>
        <boxGeometry args={[ROOM_HALF * 2, WALL_HEIGHT, 0.1]} />
        <meshStandardMaterial color={SCENE.wall} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * ROOM_HALF, WALL_HEIGHT / 2, 0]}>
          <boxGeometry args={[0.1, WALL_HEIGHT, ROOM_HALF * 2]} />
          <meshStandardMaterial color={SCENE.wall} />
        </mesh>
      ))}

      {visible.map((object) =>
        object.parentId === null ? (
          <SceneObject
            key={object.id}
            object={object}
            centre={layout.centre}
            opened={opened.has(object.id)}
            unlocked={unlocked.has(object.id)}
            highlight={highlightOf(object.id)}
          />
        ) : (
          // Revealed contents sit on top of their open holder, nudged forward.
          <group key={object.id} position={[0, 0.85, 0.35]}>
            <SceneObject
              object={{ ...object, kind: 'portable' }}
              centre={layout.centre}
              opened={false}
              unlocked={false}
              highlight={highlightOf(object.id)}
            />
          </group>
        ),
      )}

      <Character
        lane={lane}
        laneIndex={laneIndex}
        layout={layout}
        plan={plan}
        timeRef={timeRef}
        colour={colour}
        carrying={state.held.length}
      />
    </>
  );
}
