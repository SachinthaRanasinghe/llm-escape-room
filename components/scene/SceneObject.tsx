'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, MathUtils, type Group, type MeshStandardMaterial } from 'three';
import type { RendererAssets, SceneObject as SceneObjectData, Vec2, VerdictTone } from '@/lib/replay';

/**
 * One room object as primitive geometry — one shape per `ObjectKind`, no assets.
 *
 * State arrives as props (`opened`, `unlocked`) and changes at most a few times
 * a beat; the motion toward that state is damped inside `useFrame` by mutating
 * refs, never through React state. `highlight` is the one "where is it acting"
 * cue: the current beat's target glows while the character works on it, then
 * flashes the verdict's tone when it lands.
 *
 * Colours come from the renderer snapshot's `assets` (`lib/replay/renderer.ts`),
 * so a published run keeps the palette it was published with.
 */

export type Highlight = 'active' | VerdictTone | null;

function highlightColours(assets: RendererAssets): Readonly<Record<Exclude<Highlight, null>, string>> {
  return {
    active: '#fff4e0',
    success: assets.scene.success,
    neutral: '#c8c8c8',
    failure: assets.scene.failure,
    invalid: assets.scene.failure,
  };
}
const HIGHLIGHT_INTENSITY: Readonly<Record<Exclude<Highlight, null>, number>> = {
  active: 0.1,
  success: 0.45,
  neutral: 0.2,
  failure: 0.45,
  invalid: 0.3,
};

/** Yaw that turns an object's front (+z) toward `target`. */
export function yawToward(from: Vec2, target: Vec2): number {
  return Math.atan2(target[0] - from[0], target[1] - from[1]);
}

interface Props {
  readonly object: SceneObjectData;
  readonly centre: Vec2;
  readonly opened: boolean;
  readonly unlocked: boolean;
  readonly highlight: Highlight;
  readonly assets: RendererAssets;
}

export function SceneObject({ object, centre, opened, unlocked, highlight, assets }: Props) {
  const hinge = useRef<Group>(null);
  const body = useRef<MeshStandardMaterial>(null);
  const keypad = useRef<MeshStandardMaterial>(null);
  const glow = useMemo(() => new Color(), []);
  const keypadColour = useMemo(() => new Color(), []);
  const highlightColour = useMemo(() => highlightColours(assets), [assets]);

  const [x, z] = object.position;
  const yaw = yawToward(object.position, centre);

  useFrame((_, delta) => {
    if (hinge.current) {
      const target = opened ? OPEN_ANGLE[object.kind] : 0;
      const axis = object.kind === 'container' ? 'x' : 'y';
      hinge.current.rotation[axis] = MathUtils.damp(hinge.current.rotation[axis], target, 6, delta);
    }
    if (body.current) {
      const colour = highlight ? highlightColour[highlight] : '#000000';
      body.current.emissive.lerp(glow.set(colour), Math.min(1, delta * 8));
      body.current.emissiveIntensity = MathUtils.damp(
        body.current.emissiveIntensity,
        highlight ? HIGHLIGHT_INTENSITY[highlight] : 0,
        8,
        delta,
      );
    }
    if (keypad.current) {
      keypad.current.emissive.lerp(keypadColour.set(unlocked ? assets.scene.unlocked : assets.scene.locked), Math.min(1, delta * 6));
    }
  });

  const colour = assets.kindColours[object.kind];
  const material = <meshStandardMaterial ref={body} color={colour} roughness={0.8} />;

  return (
    <group position={[x, 0, z]} rotation={[0, yaw, 0]}>
      {object.kind === 'container' && (
        <>
          <mesh position={[0, 0.4, 0]}>
            <boxGeometry args={[1.2, 0.8, 0.7]} />
            {material}
          </mesh>
          <group ref={hinge} position={[0, 0.8, -0.35]}>
            <mesh position={[0, 0.03, 0.35]}>
              <boxGeometry args={[1.24, 0.06, 0.72]} />
              <meshStandardMaterial color={colour} roughness={0.7} />
            </mesh>
          </group>
        </>
      )}
      {object.kind === 'lock' && (
        <>
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.9, 0.9, 0.6]} />
            {material}
          </mesh>
          <group ref={hinge} position={[-0.45, 0.45, 0.31]}>
            <mesh position={[0.45, 0, 0]}>
              <boxGeometry args={[0.86, 0.84, 0.04]} />
              <meshStandardMaterial color="#8e97a3" metalness={0.4} roughness={0.5} />
            </mesh>
            <mesh position={[0.66, 0.12, 0.03]}>
              <boxGeometry args={[0.16, 0.22, 0.02]} />
              <meshStandardMaterial ref={keypad} color="#222" emissive={assets.scene.locked} emissiveIntensity={0.9} />
            </mesh>
          </group>
        </>
      )}
      {object.kind === 'door' && (
        <group ref={hinge} position={[-0.6, 0, 0]}>
          <mesh position={[0.6, 1.1, 0]}>
            <boxGeometry args={[1.2, 2.2, 0.15]} />
            {material}
          </mesh>
          <mesh position={[1.0, 1.1, 0.09]}>
            <boxGeometry args={[0.18, 0.12, 0.02]} />
            <meshStandardMaterial color="#c9a14a" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      )}
      {object.kind === 'fixture' && (
        <mesh position={[0, 1.4, 0]}>
          <boxGeometry args={[1.2, 1.0, 0.08]} />
          {material}
        </mesh>
      )}
      {object.kind === 'portable' && (
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.3, 0.2, 0.4]} />
          {material}
        </mesh>
      )}
    </group>
  );
}

const OPEN_ANGLE: Readonly<Record<SceneObjectData['kind'], number>> = {
  container: -1.1,
  lock: -1.4,
  door: 1.3,
  fixture: 0,
  portable: 0,
};
