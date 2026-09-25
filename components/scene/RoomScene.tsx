'use client';

import { PerspectiveCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import type { PerspectiveCamera as PerspectiveCameraImpl } from 'three';
import {
  isSettled,
  laneStateAt,
  VERDICT_TONE,
  type BeatPlan,
  type CameraPlan,
  type RendererSnapshot,
  type LaneMoment,
  type ReplayLane,
  type SceneLayout,
} from '@/lib/replay';
import { Character } from './Character';
import { SceneObject, type Highlight } from './SceneObject';

/**
 * One lane's copy of the room: floor, three low walls (no front, so the camera
 * sees in), the objects, and the character.
 *
 * Contained objects are not drawn until their holder is opened, and a taken
 * object stops being drawn in the room and rides on the character instead. What
 * is open, unlocked and held comes from `laneStateAt` — the log's `ok` verdicts —
 * recomputed only when the lane's coarse moment changes.
 *
 * Camera, colours and the stage's proportions all come from `renderer` — the
 * live snapshot on `/replay`, the frozen one on `/run/[id]` — never a constant.
 */

interface CameraRigProps {
  readonly camera: CameraPlan;
  readonly timeRef: RefObject<number>;
  readonly reduced: boolean;
}

function CameraRig({ camera: plan, timeRef, reduced }: CameraRigProps) {
  const camera = useRef<PerspectiveCameraImpl>(null);
  const [x, y, z] = plan.position;
  const [lx, ly, lz] = plan.lookAt;
  useFrame(() => {
    if (!camera.current) return;
    const t = timeRef.current ?? 0;
    const sway = reduced ? 0 : Math.sin((t / plan.swayPeriodMs) * Math.PI * 2) * plan.swayAmplitude;
    camera.current.position.x = x + sway;
    camera.current.lookAt(lx, ly, lz);
  });
  return <PerspectiveCamera ref={camera} makeDefault position={[x, y, z]} fov={plan.fov} />;
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
  readonly renderer: RendererSnapshot;
}

export function RoomScene({ lane, laneIndex, layout, plan, moment, timeRef, colour, reduced, renderer }: Props) {
  const { scene } = renderer.assets;
  const { roomHalf, wallHeight } = renderer.geometry;
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
      <color attach="background" args={[scene.background]} />
      <CameraRig camera={renderer.camera} timeRef={timeRef} reduced={reduced} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 7, 5]} intensity={1.6} />

      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[roomHalf * 2, roomHalf * 2]} />
        <meshStandardMaterial color={scene.floor} roughness={1} />
      </mesh>
      <mesh position={[0, wallHeight / 2, -roomHalf]}>
        <boxGeometry args={[roomHalf * 2, wallHeight, 0.1]} />
        <meshStandardMaterial color={scene.wall} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * roomHalf, wallHeight / 2, 0]}>
          <boxGeometry args={[0.1, wallHeight, roomHalf * 2]} />
          <meshStandardMaterial color={scene.wall} />
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
            assets={renderer.assets}
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
              assets={renderer.assets}
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
        renderer={renderer}
      />
    </>
  );
}
