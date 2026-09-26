'use client';

import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef, type RefObject } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  MathUtils,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
  type PointLight,
  type Points,
  type PointsMaterial,
} from 'three';
import type { RendererAssets, SceneObject as SceneObjectData, Vec2, VerdictTone } from '@/lib/replay';
import { Detail, discTexture, fadeTexture, hash01, shade, wallMount, woodTexture } from './look';

/**
 * One room object, one detailed prop per `ObjectKind` — built from primitives,
 * no model files.
 *
 *   container   a banded wooden chest whose lid swings up, lit from inside
 *   lock        a steel safe: dial, handle and status lamp; the door swings open
 *   door        a studded, panelled door set in the wall; light spills through
 *   fixture     a framed panel hung on the nearest wall
 *   portable    a small bound book that bobs where it lies
 *
 * State arrives as props (`opened`, `unlocked`) and changes at most a few times
 * a beat; the motion toward that state is damped inside `useFrame` by mutating
 * refs, never through React state. `highlight` is the one "where is it acting"
 * cue: the target glows and a ring lights the floor in front of it while the
 * character works, then both flash the verdict's tone when it lands.
 *
 * Colours come from the renderer snapshot's `assets` (`lib/replay/renderer.ts`),
 * so a published run keeps the palette it was published with. Idle motion reads
 * the replay clock (`timeRef`), so a paused replay is a still frame.
 *
 * When a verdict lands, a shockwave runs out across the floor in its tone, and
 * a success throws a fountain of sparks off the object (`VerdictBurst`) — timed
 * from the replay clock at the moment the highlight changed.
 */

export type Highlight = 'active' | VerdictTone | null;

function highlightColours(assets: RendererAssets): Readonly<Record<Exclude<Highlight, null>, string>> {
  return {
    active: '#ffe2b8',
    success: assets.scene.success,
    neutral: '#c8ccd4',
    failure: assets.scene.failure,
    invalid: assets.scene.failure,
  };
}
const HIGHLIGHT_INTENSITY: Readonly<Record<Exclude<Highlight, null>, number>> = {
  active: 0.18,
  success: 0.55,
  neutral: 0.25,
  failure: 0.55,
  invalid: 0.35,
};

const BRASS = '#c9a14a';
const STEEL_DARK = '#1d2127';

/** Yaw that turns an object's front (+z) toward `target`. */
export function yawToward(from: Vec2, target: Vec2): number {
  return Math.atan2(target[0] - from[0], target[1] - from[1]);
}

/** Doors and fixtures hang on the wall; everything else stands where the layout put it. */
export function isWallMounted(kind: SceneObjectData['kind']): boolean {
  return kind === 'door' || kind === 'fixture';
}

interface Props {
  readonly object: SceneObjectData;
  readonly opened: boolean;
  readonly unlocked: boolean;
  readonly highlight: Highlight;
  readonly assets: RendererAssets;
  readonly roomHalf: number;
  readonly timeRef: RefObject<number>;
  /** Revealed contents sit on their holder: no wall snapping, no floor ring. */
  readonly nested?: boolean;
}

export function SceneObject({ object, opened, unlocked, highlight, assets, roomHalf, timeRef, nested = false }: Props) {
  const detail = useContext(Detail);
  const hinge = useRef<Group>(null);
  const dial = useRef<Mesh>(null);
  const bob = useRef<Group>(null);
  const body = useRef<MeshStandardMaterial>(null);
  const keypad = useRef<MeshStandardMaterial>(null);
  const beyond = useRef<MeshBasicMaterial>(null);
  const spill = useRef<MeshBasicMaterial>(null);
  const inner = useRef<MeshStandardMaterial>(null);
  const ring = useRef<MeshBasicMaterial>(null);
  const ringMesh = useRef<Mesh>(null);
  const glow = useMemo(() => new Color(), []);
  const keypadColour = useMemo(() => new Color(), []);
  const ringColour = useMemo(() => new Color(), []);
  const highlightColour = useMemo(() => highlightColours(assets), [assets]);
  const disc = useMemo(() => discTexture(), []);
  const fade = useMemo(() => fadeTexture(), []);
  const shaft = useRef<MeshBasicMaterial>(null);
  const doorLight = useRef<PointLight>(null);
  const wooden = object.kind === 'container' || object.kind === 'door';
  const grain = useMemo(
    () => (wooden ? woodTexture(assets.kindColours[object.kind], object.kind === 'container') : null),
    [wooden, assets, object.kind],
  );
  useEffect(
    () => () => {
      disc.dispose();
      fade.dispose();
      grain?.dispose();
    },
    [disc, fade, grain],
  );

  const mount = wallMount(object.position, roomHalf);
  const mounted = !nested && isWallMounted(object.kind);
  const [x, z] = mounted ? mount.position : nested ? [0, 0] : object.position;
  const yaw = nested ? 0 : mount.yaw;

  useFrame((_, delta) => {
    const t = timeRef.current ?? 0;
    if (hinge.current) {
      const target = opened ? OPEN_ANGLE[object.kind] : 0;
      const axis = object.kind === 'container' ? 'x' : 'y';
      hinge.current.rotation[axis] = MathUtils.damp(hinge.current.rotation[axis], target, 5, delta);
    }
    const openness = hinge.current && OPEN_ANGLE[object.kind] !== 0 ? hinge.current.rotation[object.kind === 'container' ? 'x' : 'y'] / OPEN_ANGLE[object.kind] : 0;

    if (body.current) {
      const colour = highlight ? highlightColour[highlight] : '#000000';
      body.current.emissive.lerp(glow.set(colour), Math.min(1, delta * 8));
      body.current.emissiveIntensity = MathUtils.damp(body.current.emissiveIntensity, highlight ? HIGHLIGHT_INTENSITY[highlight] : 0, 8, delta);
    }
    if (ring.current && ringMesh.current) {
      const colour = highlight ? highlightColour[highlight] : '#000000';
      ring.current.color.lerp(ringColour.set(colour), Math.min(1, delta * 8));
      ring.current.opacity = MathUtils.damp(ring.current.opacity, highlight ? 0.9 : 0, 8, delta);
      const pulse = highlight === 'active' ? 1 + Math.sin(t / 180) * 0.04 : 1;
      ringMesh.current.scale.setScalar(pulse);
      ringMesh.current.visible = ring.current.opacity > 0.01;
    }
    if (keypad.current) {
      keypad.current.emissive.lerp(keypadColour.set(unlocked ? assets.scene.unlocked : assets.scene.locked), Math.min(1, delta * 6));
      keypad.current.emissiveIntensity = 1.6 + Math.sin(t / 260) * 0.4;
    }
    if (dial.current) {
      const target = highlight === 'active' ? dial.current.rotation.z + delta * 6 : Math.round(dial.current.rotation.z / 0.6) * 0.6;
      dial.current.rotation.z = highlight === 'active' ? target : MathUtils.damp(dial.current.rotation.z, target, 6, delta);
    }
    if (beyond.current) beyond.current.opacity = Math.max(0, Math.min(1, openness));
    if (spill.current) spill.current.opacity = Math.max(0, Math.min(1, openness)) * 0.55;
    if (shaft.current) shaft.current.opacity = Math.max(0, Math.min(1, openness)) * 0.22;
    if (doorLight.current) doorLight.current.intensity = Math.max(0, Math.min(1, openness)) * 9;
    if (inner.current) inner.current.emissiveIntensity = Math.max(0, Math.min(1, openness)) * 1.2;
    if (bob.current) {
      bob.current.position.y = 0.06 + Math.sin(t / 520 + object.position[0]) * 0.04;
      bob.current.rotation.y = t / 1400;
    }
  });

  const colour = assets.kindColours[object.kind];
  const trim = shade(colour, -0.35);
  // Wood is varnished, the safe is polished steel; on the `low` tier, plain standard materials.
  const material = detail ? (
    <meshPhysicalMaterial
      ref={body}
      color={grain ? '#ffffff' : colour}
      map={grain}
      roughness={object.kind === 'lock' ? 0.32 : 0.58}
      metalness={object.kind === 'lock' ? 0.7 : 0.04}
      clearcoat={object.kind === 'lock' ? 0.6 : wooden ? 0.3 : 0.1}
      clearcoatRoughness={0.3}
    />
  ) : (
    <meshStandardMaterial ref={body} color={colour} roughness={0.62} metalness={object.kind === 'lock' ? 0.55 : 0.05} />
  );

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {!nested && (
        <mesh ref={ringMesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, mounted ? 0.45 : 0.05]} visible={false}>
          <ringGeometry args={[0.78, 0.86, 64]} />
          <meshBasicMaterial ref={ring} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} />
        </mesh>
      )}
      {!nested && (
        <VerdictBurst
          highlight={highlight}
          colours={highlightColour}
          timeRef={timeRef}
          floorZ={mounted ? 0.45 : 0.05}
          top={TOP[object.kind]}
          sparks={detail}
          disc={disc}
        />
      )}

      {object.kind === 'container' && (
        <>
          {detail && (
            <>
              {[-0.5, 0.5].flatMap((fx) =>
                [-0.24, 0.24].map((fz) => (
                  <mesh key={`${fx}${fz}`} position={[fx, 0.05, fz]} castShadow>
                    <boxGeometry args={[0.1, 0.1, 0.1]} />
                    <meshStandardMaterial color={trim} roughness={0.8} />
                  </mesh>
                )),
              )}
            </>
          )}
          <RoundedBox args={[1.2, 0.7, 0.66]} radius={0.035} smoothness={3} position={[0, 0.45, 0]} castShadow receiveShadow>
            {material}
          </RoundedBox>
          {detail && (
            <>
              {/* Brass bands and the lock plate. */}
              {[-0.42, 0.42].map((bx) => (
                <mesh key={bx} position={[bx, 0.45, 0.335]}>
                  <boxGeometry args={[0.07, 0.7, 0.012]} />
                  <meshStandardMaterial color={BRASS} metalness={0.8} roughness={0.35} />
                </mesh>
              ))}
              <mesh position={[0, 0.66, 0.337]}>
                <boxGeometry args={[0.14, 0.16, 0.014]} />
                <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
              </mesh>
            </>
          )}
          {/* The hollow, lit as the lid comes up. */}
          <mesh position={[0, 0.795, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.08, 0.54]} />
            <meshStandardMaterial ref={inner} color="#1a120b" emissive="#ffb35c" emissiveIntensity={0} />
          </mesh>
          <group ref={hinge} position={[0, 0.8, -0.33]}>
            <RoundedBox args={[1.24, 0.1, 0.7]} radius={0.03} smoothness={3} position={[0, 0.05, 0.35]} castShadow>
              <meshStandardMaterial color={grain ? shade('#ffffff', -0.06) : shade(colour, 0.06)} map={grain} roughness={0.55} />
            </RoundedBox>
            {detail && (
              <>
                {[-0.42, 0.42].map((bx) => (
                  <mesh key={bx} position={[bx, 0.102, 0.35]}>
                    <boxGeometry args={[0.07, 0.012, 0.7]} />
                    <meshStandardMaterial color={BRASS} metalness={0.8} roughness={0.35} />
                  </mesh>
                ))}
              </>
            )}
          </group>
        </>
      )}

      {object.kind === 'lock' && (
        <>
          <mesh position={[0, 0.04, 0]} receiveShadow castShadow>
            <boxGeometry args={[1.0, 0.08, 0.78]} />
            <meshStandardMaterial color={STEEL_DARK} roughness={0.7} />
          </mesh>
          <RoundedBox args={[0.9, 0.92, 0.7]} radius={0.05} smoothness={3} position={[0, 0.54, 0]} castShadow receiveShadow>
            {material}
          </RoundedBox>
          {/* The cavity behind the door. */}
          <mesh position={[0, 0.54, 0.3]}>
            <boxGeometry args={[0.72, 0.74, 0.12]} />
            <meshStandardMaterial color="#0b0c0f" roughness={1} />
          </mesh>
          <group ref={hinge} position={[-0.41, 0.54, 0.37]}>
            <RoundedBox args={[0.82, 0.82, 0.06]} radius={0.02} smoothness={2} position={[0.41, 0, 0]} castShadow>
              <meshStandardMaterial color={shade(colour, 0.12)} metalness={0.6} roughness={0.38} />
            </RoundedBox>
            <mesh ref={dial} position={[0.41, 0.08, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.13, 0.14, 0.05, 32]} />
              <meshStandardMaterial color="#d9dde3" metalness={0.9} roughness={0.2} />
            </mesh>
            {detail && (
              <>
                <mesh position={[0.41, 0.08, 0.08]}>
                  <boxGeometry args={[0.02, 0.1, 0.01]} />
                  <meshStandardMaterial color={STEEL_DARK} />
                </mesh>
                <mesh position={[0.41, -0.2, 0.06]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.022, 0.022, 0.26, 12]} />
                  <meshStandardMaterial color="#d9dde3" metalness={0.9} roughness={0.25} />
                </mesh>
              </>
            )}
            <mesh position={[0.68, 0.3, 0.04]}>
              <sphereGeometry args={[0.035, 16, 12]} />
              <meshStandardMaterial ref={keypad} color="#111" emissive={assets.scene.locked} emissiveIntensity={1.6} toneMapped={false} />
            </mesh>
          </group>
        </>
      )}

      {object.kind === 'door' && (
        <>
          {/* What lies beyond: dark while shut, warm light once open. */}
          <mesh position={[0, 1.15, -0.16]}>
            <planeGeometry args={[1.24, 2.26]} />
            <meshBasicMaterial ref={beyond} color="#ffd9a0" transparent opacity={0} toneMapped={false} />
          </mesh>
          <mesh position={[0, 1.15, -0.17]}>
            <planeGeometry args={[1.24, 2.26]} />
            <meshBasicMaterial color="#050506" />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0.9]}>
            <planeGeometry args={[1.8, 1.9]} />
            <meshBasicMaterial ref={spill} map={disc} color="#ffc98a" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} />
          </mesh>
          {detail && (
            <>
              {/* Once open: a shaft of light leaning in through the doorway, and the room lit by it. */}
              <mesh position={[0, 1.15, 1.15]} rotation={[-Math.PI / 4, 0, 0]}>
                <planeGeometry args={[1.25, 3.2]} />
                <meshBasicMaterial ref={shaft} map={fade} color="#ffd6a0" transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={2} />
              </mesh>
              <pointLight ref={doorLight} position={[0, 1.6, 0.7]} color="#ffcf94" intensity={0} distance={6} decay={2} />
            </>
          )}
          {/* Frame. */}
          {[-0.68, 0.68].map((fx) => (
            <mesh key={fx} position={[fx, 1.17, 0.02]} castShadow>
              <boxGeometry args={[0.14, 2.34, 0.16]} />
              <meshStandardMaterial color={trim} roughness={0.7} />
            </mesh>
          ))}
          <mesh position={[0, 2.36, 0.02]} castShadow>
            <boxGeometry args={[1.5, 0.16, 0.18]} />
            <meshStandardMaterial color={trim} roughness={0.7} />
          </mesh>
          <group ref={hinge} position={[-0.6, 0, 0]}>
            <RoundedBox args={[1.2, 2.24, 0.08]} radius={0.02} smoothness={2} position={[0.6, 1.13, 0]} castShadow receiveShadow>
              {material}
            </RoundedBox>
            {detail && (
              <>
                {[
                  [0.33, 1.62],
                  [0.87, 1.62],
                  [0.33, 0.62],
                  [0.87, 0.62],
                ].map(([px, py]) => (
                  <mesh key={`${px}${py}`} position={[px, py, 0.045]}>
                    <boxGeometry args={[0.4, 0.78, 0.02]} />
                    <meshStandardMaterial color={shade(colour, -0.18)} roughness={0.75} />
                  </mesh>
                ))}
                {[0.12, 1.08].flatMap((sx) =>
                  [0.3, 1.13, 1.96].map((sy) => (
                    <mesh key={`${sx}${sy}`} position={[sx, sy, 0.05]}>
                      <sphereGeometry args={[0.025, 10, 8]} />
                      <meshStandardMaterial color={BRASS} metalness={0.85} roughness={0.3} />
                    </mesh>
                  )),
                )}
              </>
            )}
            <mesh position={[1.02, 1.08, 0.08]}>
              <sphereGeometry args={[0.05, 16, 12]} />
              <meshStandardMaterial color={BRASS} metalness={0.9} roughness={0.2} />
            </mesh>
          </group>
        </>
      )}

      {object.kind === 'fixture' && (
        <group position={[0, 1.45, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.3, 1.02, 0.06]} />
            <meshStandardMaterial color={BRASS} metalness={0.65} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0, 0.035]}>
            <boxGeometry args={[1.14, 0.86, 0.02]} />
            {material}
          </mesh>
          {detail && (
            <>
              <mesh position={[0, 0, 0.05]}>
                <boxGeometry args={[0.03, 0.86, 0.01]} />
                <meshStandardMaterial color={trim} />
              </mesh>
              <mesh position={[0, 0, 0.05]}>
                <boxGeometry args={[1.14, 0.03, 0.01]} />
                <meshStandardMaterial color={trim} />
              </mesh>
              <mesh position={[0, -0.64, 0.02]}>
                <boxGeometry args={[0.3, 0.08, 0.02]} />
                <meshStandardMaterial color={BRASS} metalness={0.8} roughness={0.3} />
              </mesh>
            </>
          )}
        </group>
      )}

      {object.kind === 'portable' && (
        <>
          {!nested && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.011, 0]}>
              <planeGeometry args={[0.9, 0.9]} />
              <meshBasicMaterial map={disc} color={colour} transparent opacity={0.35} depthWrite={false} blending={AdditiveBlending} />
            </mesh>
          )}
          <group ref={bob}>
            <RoundedBox args={[0.3, 0.09, 0.4]} radius={0.015} smoothness={2} castShadow>
              {material}
            </RoundedBox>
            <mesh position={[0.012, 0, 0]}>
              <boxGeometry args={[0.28, 0.07, 0.37]} />
              <meshStandardMaterial color="#f3ead6" roughness={0.9} />
            </mesh>
            <mesh position={[-0.14, 0, 0]}>
              <boxGeometry args={[0.03, 0.095, 0.41]} />
              <meshStandardMaterial color={trim} roughness={0.6} />
            </mesh>
          </group>
        </>
      )}
    </group>
  );
}

/** Roughly each kind's top, where a success's sparks fly from. */
const TOP: Readonly<Record<SceneObjectData['kind'], number>> = {
  container: 0.9,
  lock: 1.05,
  door: 1.6,
  fixture: 1.5,
  portable: 0.25,
};

const SPARKS = 28;
const SPARK_MS = 1300;
const WAVE_MS = 900;

interface BurstProps {
  readonly highlight: Highlight;
  readonly colours: Readonly<Record<Exclude<Highlight, null>, string>>;
  readonly timeRef: RefObject<number>;
  readonly floorZ: number;
  readonly top: number;
  readonly sparks: boolean;
  readonly disc: ReturnType<typeof discTexture>;
}

/**
 * The verdict landing: a ring that runs out across the floor in the verdict's
 * tone, and for a success a fountain of sparks. Both are functions of the time
 * since the highlight turned into a verdict, on the replay clock — a pause
 * freezes them mid-flight, and a restart (the clock going back) clears them.
 */
function VerdictBurst({ highlight, colours, timeRef, floorZ, top, sparks, disc }: BurstProps) {
  const wave = useRef<Mesh>(null);
  const waveMat = useRef<MeshBasicMaterial>(null);
  const points = useRef<Points>(null);
  const pointsMat = useRef<PointsMaterial>(null);
  const since = useRef<{ tone: Highlight; at: number }>({ tone: null, at: -Infinity });

  // Each spark's launch, fixed by a hash: angle, outward speed, upward speed.
  const launch = useMemo(
    () =>
      Array.from({ length: SPARKS }, (_, i) => ({
        angle: hash01(i * 7 + 1) * Math.PI * 2,
        out: 0.5 + hash01(i * 7 + 2) * 0.9,
        up: 1.6 + hash01(i * 7 + 3) * 1.6,
      })),
    [],
  );
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(SPARKS * 3), 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const t = timeRef.current ?? 0;
    const s = since.current;
    if (highlight !== s.tone) {
      s.tone = highlight;
      s.at = highlight === null || highlight === 'active' || highlight === 'neutral' ? -Infinity : t;
    }
    if (t < s.at) s.at = -Infinity; // the clock went back: a restart
    const age = t - s.at;

    if (wave.current && waveMat.current) {
      const p = age / WAVE_MS;
      const on = p >= 0 && p < 1;
      wave.current.visible = on;
      if (on && s.tone) {
        waveMat.current.color.set(colours[s.tone as Exclude<Highlight, null>]);
        wave.current.scale.setScalar(1 + p * 2.6);
        waveMat.current.opacity = (1 - p) ** 2 * 0.9;
      }
    }
    if (points.current && pointsMat.current) {
      const p = age / SPARK_MS;
      const on = sparks && s.tone === 'success' && p >= 0 && p < 1;
      points.current.visible = on;
      if (on) {
        const secs = age / 1000;
        const attr = geometry.getAttribute('position') as BufferAttribute;
        launch.forEach(({ angle, out, up }, i) => {
          const r = out * secs;
          attr.setXYZ(i, Math.sin(angle) * r, top + up * secs - 3.2 * secs * secs, floorZ * 0.3 + Math.cos(angle) * r);
        });
        attr.needsUpdate = true;
        pointsMat.current.color.set(colours.success);
        pointsMat.current.opacity = 1 - p * p;
      }
    }
  });

  return (
    <>
      <mesh ref={wave} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.016, floorZ]} visible={false}>
        <ringGeometry args={[0.8, 0.9, 64]} />
        <meshBasicMaterial ref={waveMat} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
      <points ref={points} geometry={geometry} visible={false} frustumCulled={false}>
        <pointsMaterial ref={pointsMat} map={disc} size={0.13} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </points>
    </>
  );
}

const OPEN_ANGLE: Readonly<Record<SceneObjectData['kind'], number>> = {
  container: -1.15,
  lock: -1.6,
  door: 1.35,
  fixture: 0,
  portable: 0,
};
