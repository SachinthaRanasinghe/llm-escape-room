'use client';

import { Environment, Lightformer, PerspectiveCamera } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  type CanvasTexture,
  type Group,
  type PerspectiveCamera as PerspectiveCameraImpl,
} from 'three';
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
import { AnchorProbe, anchorPoint, type AnchorStore } from './anchor';
import { Character } from './Character';
import { Detail, discTexture, fadeTexture, hash01, panelTexture, plankTexture, rugTexture, shade, wallMount, wallpaperTexture, type Wall } from './look';
import { SceneObject, type Highlight } from './SceneObject';

/**
 * One lane's copy of the room: a planked floor and rug, three panelled walls
 * (no front, so the camera sees in) with a doorway cut for the exit, warm
 * lamplight, the objects, and the character.
 *
 * Contained objects are not drawn until their holder is opened, and a taken
 * object stops being drawn in the room and rides on the character instead. What
 * is open, unlocked and held comes from `laneStateAt` — the log's `ok` verdicts —
 * recomputed only when the lane's coarse moment changes.
 *
 * Camera, colours and the stage's proportions all come from `renderer` — the
 * live snapshot on `/replay`, the frozen one on `/run/[id]` — never a constant.
 * The decor (trim, rug, sconces, dust) is deliberately not an object: nothing a
 * model could name, so the room never shows a thing the log says is not there.
 *
 * ── Light ──────────────────────────────────────────────────────────────────
 * The pendant is a soft spot: a warm pool where the characters work, falling
 * off into dark corners, with a faint cone of haze under it. The sconces wash
 * the back wall, and baked gradients darken where walls meet the floor — the
 * contact shadow a real room has and a shadow map alone does not give.
 *
 * ── Camera ─────────────────────────────────────────────────────────────────
 * Like the character, a pure function of the clock: an establishing sweep in
 * over the intro, a slow drift, and a gentle lean toward where the character
 * is (`focus`, written by `Character` each frame). Reduced motion holds it
 * still at the snapshot's framing.
 */

/** Where the character is on the floor, written by `Character` and read by the camera. */
export interface Focus {
  x: number;
  z: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

interface CameraRigProps {
  readonly camera: CameraPlan;
  readonly timeRef: RefObject<number>;
  readonly reduced: boolean;
  readonly introMs: number;
  readonly focus: Focus;
  readonly centre: readonly [number, number];
}

/** How far the camera leans toward the character: its eye, and where it looks. */
const FOLLOW = { position: 0.16, look: 0.3 } as const;
/** The establishing shot starts this far round (radians), back and up, then settles. */
const SWEEP = { yaw: 0.55, back: 0.4, up: 1.3 } as const;

function CameraRig({ camera: plan, timeRef, reduced, introMs, focus, centre }: CameraRigProps) {
  const camera = useRef<PerspectiveCameraImpl>(null);
  const [x, y, z] = plan.position;
  const [lx, ly, lz] = plan.lookAt;
  useFrame(() => {
    const cam = camera.current;
    if (!cam) return;
    if (reduced) {
      cam.position.set(x, y, z);
      cam.lookAt(lx, ly, lz);
      return;
    }
    const t = timeRef.current ?? 0;
    // Establishing sweep: round, back and up, easing into the frozen framing as the intro ends.
    const settle = 1 - (1 - clamp01(t / (introMs * 1.5))) ** 3;
    const pull = 1 - settle;
    const drift = Math.sin((t / plan.swayPeriodMs) * Math.PI * 2);
    const breathe = Math.sin((t / (plan.swayPeriodMs * 0.73)) * Math.PI * 2);
    const fx = focus.x - centre[0];
    const fz = focus.z - centre[1];

    // Orbit the look-at point for the sweep, then add drift and the lean.
    const ox = x - lx;
    const oz = z - lz;
    const yaw = -pull * SWEEP.yaw;
    const scale = 1 + pull * SWEEP.back;
    cam.position.set(
      lx + (ox * Math.cos(yaw) + oz * Math.sin(yaw)) * scale + drift * plan.swayAmplitude + fx * FOLLOW.position,
      y + pull * SWEEP.up + breathe * 0.05,
      lz + (-ox * Math.sin(yaw) + oz * Math.cos(yaw)) * scale + fz * FOLLOW.position * 0.5,
    );
    cam.lookAt(lx + fx * FOLLOW.look, ly, lz + fz * FOLLOW.look * 0.6);
  });
  return <PerspectiveCamera ref={camera} makeDefault position={[x, y, z]} fov={plan.fov} />;
}

const DOOR_GAP = 0.62;
const WAINSCOT = 0.95;
const RUG = { field: '#35161a', trim: '#9a7a3c' } as const;
const LAMP = '#ffb36b';
/** Wainscot panels this wide, tiled along each run of wall. */
const PANEL_WIDTH = 0.8;

/** [from, to] spans along a wall, with the doorway's gap cut out. */
function spans(from: number, to: number, gap: number | null): [number, number][] {
  if (gap === null) return [[from, to]];
  return [
    [from, gap - DOOR_GAP],
    [gap + DOOR_GAP, to],
  ];
}

interface WallProps {
  readonly roomHalf: number;
  readonly height: number;
  readonly wall: string;
  /** The exit's x on the back wall, or `null` when there is no doorway to cut. */
  readonly doorX: number | null;
}

function Walls({ roomHalf: h, height, wall, doorX }: WallProps) {
  const detail = useContext(Detail);
  const paper = useMemo(() => wallpaperTexture(wall), [wall]);
  useEffect(() => () => paper.dispose(), [paper]);
  const panel = useMemo(() => panelTexture(shade(wall, -0.45)), [wall]);
  useEffect(() => () => panel.dispose(), [panel]);
  const rail = shade(wall, -0.6);
  // One clone of the panel per run length, so each run tiles whole panels.
  const panels = useRef(new Map<number, CanvasTexture>());
  const panelFor = (length: number): CanvasTexture => {
    const count = Math.max(1, Math.round(length / PANEL_WIDTH));
    let tex = panels.current.get(count);
    if (!tex || tex.source !== panel.source) {
      tex = panel.clone();
      tex.repeat.set(count, 1);
      tex.needsUpdate = true;
      panels.current.set(count, tex);
    }
    return tex;
  };
  useEffect(() => {
    const cache = panels.current;
    return () => {
      cache.forEach((tex) => tex.dispose());
      cache.clear();
    };
  }, [panel]);

  // Back wall spans along x at z = -h; side walls along z at x = ±h.
  const runs: { key: string; axis: 'x' | 'z'; at: number; spans: [number, number][]; face: number }[] = [
    { key: 'back', axis: 'x', at: -h, spans: spans(-h, h, doorX), face: 1 },
    { key: 'left', axis: 'z', at: -h, spans: [[-h, h]], face: 1 },
    { key: 'right', axis: 'z', at: h, spans: [[-h, h]], face: -1 },
  ];

  return (
    <>
      {runs.flatMap(({ key, axis, at, spans: parts, face }) =>
        parts.map(([a, b]) => {
          const length = b - a;
          const mid = (a + b) / 2;
          const along = (depth: number, y: number, size: [number, number, number]) => {
            const [w, hh, d] = size;
            return axis === 'x'
              ? { position: [mid, y, at + face * depth] as const, args: [w, hh, d] as const }
              : { position: [at + face * depth, y, mid] as const, args: [d, hh, w] as const };
          };
          const shell = along(-0.05, height / 2, [length, height, 0.1]);
          const wains = along(0.02, WAINSCOT / 2, [length, WAINSCOT, 0.04]);
          const chair = along(0.05, WAINSCOT, [length, 0.05, 0.06]);
          const base = along(0.04, 0.07, [length, 0.14, 0.08]);
          const crown = along(0.04, height - 0.05, [length, 0.1, 0.08]);
          return (
            <group key={`${key}${a}`}>
              <mesh position={shell.position} receiveShadow>
                <boxGeometry args={shell.args} />
                <meshStandardMaterial map={paper} roughness={0.9} />
              </mesh>
              <mesh position={wains.position} receiveShadow>
                <boxGeometry args={wains.args} />
                <meshStandardMaterial map={detail ? panelFor(length) : null} color={detail ? '#ffffff' : shade(wall, -0.45)} roughness={0.6} />
              </mesh>
              {(detail ? [chair, base, crown] : []).map((m, i) => (
                <mesh key={i} position={m.position} castShadow receiveShadow>
                  <boxGeometry args={m.args} />
                  <meshStandardMaterial color={rail} roughness={0.55} />
                </mesh>
              ))}
            </group>
          );
        }),
      )}
      {doorX !== null && (
        // The lintel over the doorway.
        <mesh position={[doorX, (height + 2.45) / 2, -h - 0.05]}>
          <boxGeometry args={[DOOR_GAP * 2, height - 2.45, 0.1]} />
          <meshStandardMaterial map={paper} roughness={0.9} />
        </mesh>
      )}
    </>
  );
}

function Sconce({ x, z, glow }: { readonly x: number; readonly z: number; readonly glow: CanvasTexture }) {
  return (
    <group position={[x, 1.95, z]}>
      {/* Light washing the wall around it, and the halo round the shade. */}
      <mesh position={[0, 0.05, 0.012]}>
        <planeGeometry args={[1.5, 1.7]} />
        <meshBasicMaterial map={glow} color={LAMP} transparent opacity={0.28} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.07, 0.16]}>
        <planeGeometry args={[0.55, 0.55]} />
        <meshBasicMaterial map={glow} color="#ffd29a" transparent opacity={0.55} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, 0.04]}>
        <boxGeometry args={[0.1, 0.22, 0.04]} />
        <meshStandardMaterial color="#c9a14a" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.06, 0.13]}>
        <cylinderGeometry args={[0.07, 0.1, 0.16, 16, 1, true]} />
        <meshStandardMaterial color="#f7dfb9" emissive={LAMP} emissiveIntensity={1.4} side={2} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Motes hanging in the lamplight — a fixed scatter, drifting on the replay clock. */
function Dust({ roomHalf, height, timeRef, mote }: { readonly roomHalf: number; readonly height: number; readonly timeRef: RefObject<number>; readonly mote: CanvasTexture }) {
  const group = useRef<Group>(null);
  const geometry = useMemo(() => {
    const count = 110;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (hash01(i * 3 + 1) * 2 - 1) * roomHalf * 0.9;
      positions[i * 3 + 1] = 0.3 + hash01(i * 3 + 2) * height;
      positions[i * 3 + 2] = (hash01(i * 3 + 3) * 2 - 1) * roomHalf * 0.9;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(positions, 3));
    return g;
  }, [roomHalf, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(() => {
    if (!group.current) return;
    const t = timeRef.current ?? 0;
    group.current.rotation.y = t / 40000;
    group.current.position.y = Math.sin(t / 3000) * 0.08;
  });
  return (
    <group ref={group}>
      <points geometry={geometry}>
        <pointsMaterial map={mote} color="#ffe3b8" size={0.024} transparent opacity={0.35} depthWrite={false} blending={AdditiveBlending} />
      </points>
    </group>
  );
}

/** The haze under the pendant: an open cone, bright at the lamp, gone by the floor. */
function LightCone({ height, fade }: { readonly height: number; readonly fade: CanvasTexture }) {
  const h = height + 0.4;
  return (
    <mesh position={[0, h / 2, 0.3]}>
      <cylinderGeometry args={[0.25, 2.3, h, 40, 1, true]} />
      <meshBasicMaterial map={fade} color={LAMP} transparent opacity={0.035} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

const WALL_YAW: Readonly<Record<Wall, number>> = { back: 0, left: Math.PI / 2, right: -Math.PI / 2 };

/** Baked contact shadow where each wall meets the floor. */
function WallShadows({ roomHalf: h, fade }: { readonly roomHalf: number; readonly fade: CanvasTexture }) {
  const walls: [Wall, [number, number]][] = [
    ['back', [0, -h]],
    ['left', [-h, 0]],
    ['right', [h, 0]],
  ];
  return (
    <>
      {walls.map(([wall, [x, z]]) => (
        <group key={wall} position={[x, 0.004, z]} rotation={[0, WALL_YAW[wall], 0]}>
          <mesh position={[0, 0, 0.4]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[h * 2, 0.8]} />
            <meshBasicMaterial map={fade} color="#000000" transparent opacity={0.6} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** `low` drops shadow maps, the environment map, the dust and the sconce lamp — see `ReplayStage`. */
export type Quality = 'high' | 'low';

interface Props {
  readonly lane: ReplayLane;
  readonly laneIndex: number;
  readonly layout: SceneLayout;
  readonly plan: BeatPlan;
  readonly moment: LaneMoment;
  readonly timeRef: RefObject<number>;
  readonly colour: string;
  readonly reduced: boolean;
  readonly quality?: Quality;
  readonly renderer: RendererSnapshot;
  /** Where the HUD should pin this lane's current action — see `anchor.tsx`. */
  readonly anchor?: AnchorStore;
}

export function RoomScene({ lane, laneIndex, layout, plan, moment, timeRef, colour, reduced, quality = 'high', renderer, anchor }: Props) {
  const high = quality === 'high';
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

  const floor = useMemo(() => plankTexture(scene.floor), [scene.floor]);
  const rug = useMemo(() => rugTexture(RUG.field, RUG.trim), []);
  const glow = useMemo(() => discTexture(), []);
  const fade = useMemo(() => fadeTexture(), []);
  useEffect(() => () => floor.dispose(), [floor]);
  useEffect(() => () => rug.dispose(), [rug]);
  useEffect(() => () => glow.dispose(), [glow]);
  useEffect(() => () => fade.dispose(), [fade]);
  const focus = useMemo<Focus>(() => ({ x: layout.centre[0], z: layout.centre[1] }), [layout]);

  const current = moment.beatIndex >= 0 && moment.phase !== 'done' ? lane.beats[moment.beatIndex] : undefined;
  const highlightOf = (id: string): Highlight => {
    if (!current || current.targetId !== id) return null;
    return moment.phase === 'hold' ? VERDICT_TONE[current.verdict.code] : 'active';
  };

  const byId = useMemo(() => new Map(layout.objects.map((o) => [o.id, o])), [layout]);
  const point = useMemo(() => anchorPoint(layout, current, roomHalf), [layout, current, roomHalf]);
  const visible = layout.objects.filter((o) => {
    if (held.has(o.id)) return false;
    if (o.parentId === null) return true;
    return opened.has(o.parentId) && byId.get(o.parentId)?.parentId === null;
  });

  // The exit gets a real doorway when it is a door on the back wall.
  const exit = byId.get(layout.exitObjectId);
  const exitMount = exit ? wallMount(exit.position, roomHalf) : null;
  const doorX = exit?.kind === 'door' && exitMount?.wall === 'back' ? exitMount.position[0] : null;
  const sconceX = doorX ?? 0;

  return (
    <Detail.Provider value={high}>
      <color attach="background" args={[scene.background]} />
      <fog attach="fog" args={[scene.background, 9, 19]} />

      {high && (
        <Environment resolution={64} frames={1}>
          <Lightformer form="circle" intensity={3} color="#ffc98f" position={[0, 5, 0]} rotation-x={Math.PI / 2} scale={[3, 3, 1]} />
          <Lightformer form="rect" intensity={0.5} color="#8fa6ff" position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
          <Lightformer form="rect" intensity={0.35} color="#ffe2c4" position={[6, 2, 2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
          <Lightformer form="rect" intensity={0.25} color="#b8c6ff" position={[0, 2, 8]} scale={[10, 4, 1]} />
        </Environment>
      )}

      <hemisphereLight args={['#b9c6ff', '#2a1d14', high ? 0.55 : 0.9]} />
      {high ? (
        <>
          {/* The pendant: a soft warm pool on the floor that casts the shadows… */}
          <spotLight
            position={[0, 4.4, 0.8]}
            angle={1.05}
            penumbra={0.95}
            intensity={80}
            distance={16}
            decay={2}
            color={LAMP}
            castShadow
            shadow-mapSize={[1024, 1024]}
            shadow-bias={-0.0004}
            shadow-normalBias={0.03}
            shadow-camera-near={1}
            shadow-camera-far={14}
          />
          {/* …its bounce off the ceiling, and a cool fill from the open side of the room. */}
          <pointLight position={[0, 3.3, 0]} intensity={10} distance={11} decay={2} color={LAMP} />
          <directionalLight position={[-3, 5, 7]} intensity={0.7} color="#a9bcff" />
          <pointLight position={[sconceX, 1.95, -roomHalf + 0.5]} intensity={6} distance={5} decay={2} color={LAMP} />
        </>
      ) : (
        <>
          <directionalLight position={[3.5, 8, 5]} intensity={1.5} color="#ffe9d2" />
          <pointLight position={[0, 3.4, 0]} intensity={14} distance={10} decay={2} color={LAMP} />
        </>
      )}

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[roomHalf * 2, roomHalf * 2]} />
        {high ? (
          // Varnished boards: a clear coat that catches the lamps.
          <meshPhysicalMaterial map={floor} roughness={0.72} metalness={0.02} clearcoat={0.4} clearcoatRoughness={0.32} />
        ) : (
          <meshStandardMaterial map={floor} roughness={0.75} metalness={0.05} />
        )}
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0.25]} receiveShadow>
        <planeGeometry args={[2.8, 1.9]} />
        <meshStandardMaterial map={rug} roughness={1} />
      </mesh>
      {high && <WallShadows roomHalf={roomHalf} fade={fade} />}

      <Walls roomHalf={roomHalf} height={wallHeight} wall={scene.wall} doorX={doorX} />
      {(high ? [-1, 1] : []).map((side) => (
        <Sconce key={side} x={sconceX + side * 1.05} z={-roomHalf} glow={glow} />
      ))}
      {high && !reduced && <LightCone height={wallHeight} fade={fade} />}
      {high && !reduced && <Dust roomHalf={roomHalf} height={wallHeight} timeRef={timeRef} mote={glow} />}

      {visible.map((object) => {
        if (object.parentId === null) {
          return (
            <SceneObject
              key={object.id}
              object={object}
              opened={opened.has(object.id)}
              unlocked={unlocked.has(object.id)}
              highlight={highlightOf(object.id)}
              assets={renderer.assets}
              roomHalf={roomHalf}
              timeRef={timeRef}
            />
          );
        }
        // Revealed contents sit on top of their open holder, nudged toward the room.
        const holder = byId.get(object.parentId);
        const facing = holder ? wallMount(holder.position, roomHalf).yaw : 0;
        const top = holder?.kind === 'lock' ? 1.06 : 0.9;
        return (
          <group
            key={object.id}
            position={[object.position[0] + Math.sin(facing) * 0.15, top, object.position[1] + Math.cos(facing) * 0.15]}
          >
            <SceneObject
              object={{ ...object, kind: 'portable' }}
              opened={false}
              unlocked={false}
              highlight={highlightOf(object.id)}
              assets={renderer.assets}
              roomHalf={roomHalf}
              timeRef={timeRef}
              nested
            />
          </group>
        );
      })}

      <Character
        lane={lane}
        laneIndex={laneIndex}
        layout={layout}
        plan={plan}
        timeRef={timeRef}
        colour={colour}
        carrying={state.held.length}
        renderer={renderer}
        focus={focus}
      />

      {/* After the character, so the camera reads this frame's focus — and the probe this frame's camera. */}
      <CameraRig camera={renderer.camera} timeRef={timeRef} reduced={reduced} introMs={plan.introMs} focus={focus} centre={layout.centre} />
      {anchor && <AnchorProbe point={point} store={anchor} />}
    </Detail.Provider>
  );
}
