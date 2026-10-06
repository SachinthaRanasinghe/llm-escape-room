'use client';

import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { AdditiveBlending, Color, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, type Group, type Mesh, type PointLight } from 'three';
import { discTexture, hash01, shade } from '@/components/scene/look';
import { yawToward } from '@/components/scene/SceneObject';
import type { PlayerId } from './choreography';
import { BAD, clamp01, easeInOut, isMoving, moveProgress, positionAt, SPOT, type ArenaDirector, type P2 } from './director';

/**
 * One model's robot — the escape room's visor-faced rig, in its lane's colour,
 * posed every frame from the director's tweens.
 *
 * It walks out to the reactor or a rival's pad, types at a holo terminal while
 * the model works the challenge, hops or gets zapped on the verdict, carries a
 * won core home over its head, staggers when robbed and collapses when it has
 * nothing left. Poses are functions of the time since the pose began, so a
 * skipped beat lands the robot in the right stance, not half-way through one.
 */

export const BOT_SCALE = 1.45;
/** Height above the floor where a carried core rides. */
export const CARRY_HEIGHT = 2.5;

const BODY = '#e9e6df';
const DEAD = '#4a4f5c';
const STRIDE = 0.5;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

interface Props {
  readonly director: ArenaDirector;
  readonly id: PlayerId;
  readonly colour: string;
  readonly high: boolean;
}

export function Bot({ director, id, colour, high }: Props) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const antenna = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const jets = useRef<Group>(null);
  const lamp = useRef<PointLight>(null);
  const yaw = useRef<number | null>(null);

  const mats = useMemo(
    () => ({
      shell: high
        ? new MeshPhysicalMaterial({ color: BODY, roughness: 0.22, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })
        : new MeshStandardMaterial({ color: BODY, roughness: 0.35, metalness: 0.1 }),
      suit: high
        ? new MeshPhysicalMaterial({ color: colour, roughness: 0.28, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08 })
        : new MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.2 }),
      dark: new MeshStandardMaterial({ color: '#15171c', roughness: 0.25, metalness: 0.5 }),
      visor: high
        ? new MeshPhysicalMaterial({ color: '#07090e', roughness: 0.05, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.03 })
        : new MeshStandardMaterial({ color: '#0b0d12', roughness: 0.2, metalness: 0.4 }),
      // On the low tier every material shares the scene's few shader programs:
      // each extra variant is a compile the CPU has to finish before the first frame.
      eye: new MeshStandardMaterial({ color: '#000', emissive: shade(colour, 0.35), emissiveIntensity: 2.4, toneMapped: !high }),
      core: new MeshStandardMaterial({ color: '#000', emissive: shade(colour, 0.2), emissiveIntensity: 1.6, toneMapped: !high }),
      glow: new MeshBasicMaterial({ color: shade(colour, 0.25), toneMapped: !high }),
      joint: new MeshStandardMaterial({ color: '#2a2f3a', metalness: 0.95, roughness: 0.2 }),
      jet: new MeshBasicMaterial({ color: shade(colour, 0.4), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, map: discTexture() }),
    }),
    [colour, high],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) {
        m.map?.dispose();
        m.dispose();
      }
    },
    [mats],
  );
  const tint = useMemo(() => ({ live: new Color(colour), dead: new Color(DEAD), shell: new Color(BODY), eye: new Color(shade(colour, 0.35)), bad: new Color(BAD) }), [colour]);

  useFrame((_, dt) => {
    if (!root.current || !body.current || !head.current || !armL.current || !armR.current || !legL.current || !legR.current) return;
    const now = director.now();
    const robot = director.robots[id];
    const since = now - robot.poseAt;
    const moving = isMoving(robot.move, now);
    const pos = positionAt(robot.move, now);

    // Facing: where it is going while it walks; otherwise its focus.
    let want: number;
    if (moving) want = yawToward([robot.move.from.x, robot.move.from.z], [robot.move.to.x, robot.move.to.z]);
    else if (robot.face === 'camera') want = 0;
    else {
      const target: P2 = robot.face === 'centre' ? SPOT.centre : director.robotFloor(robot.face);
      want = yawToward([pos.x, pos.z], [target.x, target.z]);
    }
    if (yaw.current === null || director.reduced) yaw.current = want;
    else yaw.current += wrapAngle(want - yaw.current) * (1 - Math.exp(-dt * 9));
    let facing = yaw.current;

    let lift = 0;
    let lean = 0;
    let roll = 0;
    let squash = 1;
    let headYaw = 0;
    let headTilt = 0;
    let armLx = 0;
    let armRx = 0;
    let armLz = 0.08;
    let armRz = 0.08;
    let legLx = 0;
    let legRx = 0;
    let eyeOpen = 1;
    let eyeGlow = 2.4;
    let eyeRed = 0;
    let pulseMs = 700;
    let fall = 0;
    let jitterX = 0;
    let jitterZ = 0;
    let back = 0;
    const breathe = Math.sin(now / 650 + hash01(id.length) * 6) * 0.015;

    if (moving) {
      const p = moveProgress(robot.move, now);
      const distance = Math.hypot(robot.move.to.x - robot.move.from.x, robot.move.to.z - robot.move.from.z);
      const steps = Math.max(1, Math.round(distance / STRIDE));
      const envelope = Math.sin(p * Math.PI) ** 0.35;
      const phase = easeInOut(p) * steps * Math.PI;
      const swing = Math.sin(phase) * 0.8 * envelope;
      legLx = swing;
      legRx = -swing;
      armLx = -swing * 0.9;
      armRx = swing * 0.9;
      lift = Math.abs(Math.sin(phase)) * 0.07 * envelope;
      lean = 0.16 * envelope;
      roll = Math.sin(phase) * 0.05 * envelope;
    }

    const k = (ms: number) => clamp01(since / ms);
    switch (robot.pose) {
      case 'idle':
        armLz = 0.1 + Math.sin(now / 900) * 0.04;
        armRz = armLz;
        if (!moving && director.active !== null && director.active !== id) {
          const other = director.robotFloor(director.active);
          headYaw = Math.max(-0.7, Math.min(0.7, wrapAngle(yawToward([pos.x, pos.z], [other.x, other.z]) - facing)));
        }
        break;
      case 'alert':
        armLx = 0.9;
        armRx = 0.9;
        armLz = 0.35;
        armRz = 0.35;
        squash = 0.95;
        headTilt = -0.08;
        break;
      case 'think':
        armRx = 2.1;
        armRz = -0.55;
        armLz = 0.55;
        armLx = -0.2;
        headTilt = 0.18 + Math.sin(now / 500) * 0.05;
        headYaw = Math.sin(now / 1300) * 0.25;
        pulseMs = 220;
        break;
      case 'hack': {
        const tap = Math.sin(now / 55);
        armLx = 1.15 + Math.max(0, tap) * 0.22;
        armRx = 1.15 + Math.max(0, -tap) * 0.22;
        armLz = -0.12;
        armRz = -0.12;
        lean = Math.max(lean, 0.12);
        headTilt = 0.22;
        pulseMs = 140;
        eyeGlow = 3;
        break;
      }
      case 'cheer': {
        const hop = k(1100);
        lift = hop < 1 ? Math.abs(Math.sin(hop * Math.PI * 2)) * 0.45 * (1 - hop * 0.5) : 0;
        const up = since < 1500 ? 1 : Math.max(0, 1 - (since - 1500) / 500);
        armLz = 0.08 + 2.5 * up;
        armRz = 0.08 + 2.5 * up;
        eyeOpen = 0.45;
        eyeGlow = 3.6;
        squash = 1 + 0.06 * up;
        break;
      }
      case 'fail': {
        if (since < 550) {
          jitterX = Math.sin(now * 0.9) * 0.05;
          jitterZ = Math.cos(now * 1.3) * 0.05;
          eyeRed = 1;
          eyeOpen = hash01(Math.floor(now / 40)) > 0.5 ? 1 : 0.2;
          armLz = 0.7;
          armRz = 0.7;
          headTilt = -0.25;
        } else {
          const r = k(1400);
          headYaw = Math.sin(r * Math.PI * 5) * 0.4 * (1 - r);
          headTilt = 0.3;
          eyeOpen = 0.55;
          eyeGlow = 1.2;
          eyeRed = 0.4;
          lean = 0.1;
        }
        break;
      }
      case 'carry':
        armLx = 2.75;
        armRx = 2.75;
        armLz = 0.25;
        armRz = 0.25;
        lean = moving ? 0.06 : 0;
        headTilt = -0.15;
        eyeOpen = 0.6;
        eyeGlow = 3.2;
        break;
      case 'slump':
        headTilt = 0.4;
        armLx = -0.1;
        armRx = -0.1;
        armLz = 0.04;
        armRz = 0.04;
        lean = Math.max(lean, 0.12);
        eyeOpen = 0.5;
        eyeGlow = 1.1;
        pulseMs = 1500;
        break;
      case 'hit': {
        const h = k(900);
        const s = Math.sin(h * Math.PI);
        back = 0.55 * Math.sin(Math.min(1, h * 1.6) * Math.PI * 0.5) * (1 - h * 0.6);
        lean = -0.45 * s;
        armLz = 0.3 + 1.3 * s;
        armRz = 0.3 + 1.3 * s;
        armLx = 0.6 * s;
        armRx = 0.6 * s;
        headTilt = -0.35 * s;
        eyeRed = 1 - h;
        eyeOpen = h < 0.4 ? 0.3 : 0.8;
        break;
      }
      case 'down': {
        const d = easeInOut(k(900));
        fall = d;
        headTilt = 0.4 * d;
        armLz = 0.08 + 0.9 * d;
        armRz = 0.08 + 1.1 * d;
        legLx = 0.25 * d;
        eyeGlow = Math.max(0, 2.4 * (1 - k(600)));
        eyeOpen = 0.35;
        pulseMs = 4000;
        if (since < 500) {
          jitterX = Math.sin(now * 0.7) * 0.06 * (1 - since / 500);
          eyeRed = 1;
        }
        break;
      }
      case 'win': {
        const t = since / 1000;
        lift = Math.abs(Math.sin(t * Math.PI * 1.9)) * 0.5;
        squash = 1 + Math.sin(t * Math.PI * 3.8) * 0.04;
        armLz = 2.35 + Math.sin(t * 9) * 0.35;
        armRz = 2.35 - Math.sin(t * 9) * 0.35;
        headYaw = Math.sin(t * 2.6) * 0.3;
        facing += Math.sin(t * 1.3) * 0.5;
        eyeOpen = 0.4;
        eyeGlow = 4;
        pulseMs = 260;
        break;
      }
      case 'shield': {
        const on = since < 1700 ? 1 : Math.max(0, 1 - (since - 1700) / 400);
        armLx = 1.4 * on;
        armRx = 1.4 * on;
        armLz = -0.45 * on + 0.08;
        armRz = -0.45 * on + 0.08;
        squash = 1 - 0.08 * on;
        headTilt = 0.15 * on;
        break;
      }
      case 'glitch': {
        const g = since < 1600;
        if (g) {
          const n = Math.floor(now / 70);
          jitterX = (hash01(n) - 0.5) * 0.18;
          jitterZ = (hash01(n + 7) - 0.5) * 0.18;
          headTilt = (hash01(n + 3) - 0.5) * 0.8;
          headYaw = (hash01(n + 5) - 0.5) * 1.2;
          eyeRed = 1;
          eyeOpen = hash01(n + 11) > 0.3 ? 1 : 0.1;
          armLz = 0.2 + hash01(n + 13) * 0.9;
          armRz = 0.2 + hash01(n + 17) * 0.9;
        }
        break;
      }
    }

    // A blink every few seconds, offset per robot.
    const blink = (now + hash01(id.charCodeAt(7)) * 3000) % 3600;
    if (blink < 140 && robot.pose !== 'down') eyeOpen = Math.min(eyeOpen, Math.abs(blink / 140 - 0.5) * 1.8 + 0.1);

    const bx = pos.x - Math.sin(facing) * back + jitterX;
    const bz = pos.z - Math.cos(facing) * back + jitterZ;
    root.current.position.set(bx, lift, bz);
    root.current.rotation.set(0, facing, 0);
    // Collapse: tip over backwards, sinking to lie on the pad.
    body.current.rotation.set(lean - fall * 1.35, 0, roll + fall * 0.2);
    body.current.position.y = 0.5 - fall * 0.32;
    body.current.position.z = -fall * 0.25;
    body.current.scale.set(1, squash + breathe, 1);
    head.current.rotation.set(headTilt, headYaw, 0);
    armL.current.rotation.set(-armLx, 0, -armLz);
    armR.current.rotation.set(-armRx, 0, armRz);
    legL.current.rotation.x = -legLx - fall * 1.2;
    legR.current.rotation.x = -legRx - fall * 1.3;
    if (antenna.current) antenna.current.rotation.set(-lean * 1.6 - lift * 2 + Math.sin(now / 300) * 0.05, 0, -roll * 2.4);
    if (eyes.current) eyes.current.scale.set(1, eyeOpen, 1);

    const dead = robot.pose === 'down' ? easeInOut(k(900)) : 0;
    mats.suit.color.copy(tint.live).lerp(tint.dead, dead);
    mats.shell.color.copy(tint.shell).lerp(tint.dead, dead * 0.7);
    mats.eye.emissive.copy(tint.eye).lerp(tint.bad, eyeRed);
    mats.glow.color.copy(tint.eye).lerp(tint.bad, eyeRed).multiplyScalar((1 - dead * 0.92) * (1.1 + (eyeGlow / 4) * 0.8));
    mats.eye.emissiveIntensity = eyeGlow;
    const beat = 0.5 + 0.5 * Math.sin((now / pulseMs) * Math.PI * 2);
    mats.core.emissiveIntensity = (0.6 + beat * 1.2) * (1 - dead * 0.9);
    if (core.current) core.current.scale.setScalar(0.9 + beat * 0.2);
    if (lamp.current) lamp.current.intensity = (2 + beat * 1.2) * (1 - dead);

    // Jets under the feet while it dashes about.
    const thrust = moving ? Math.sin(moveProgress(robot.move, now) * Math.PI) : 0;
    mats.jet.opacity = thrust * (0.55 + Math.sin(now / 30) * 0.15);
    if (jets.current) jets.current.visible = thrust > 0.02;
  });

  return (
    <group ref={root} scale={BOT_SCALE}>
      {high && <pointLight ref={lamp} position={[0, 1, 0.5]} color={colour} intensity={2} distance={3} decay={2} />}
      <group ref={jets} visible={false}>
        {[-0.11, 0.11].map((x) => (
          <mesh key={x} position={[x, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} material={mats.jet}>
            <planeGeometry args={[0.45, 0.45]} />
          </mesh>
        ))}
      </group>
      {[
        [legL, -0.11],
        [legR, 0.11],
      ].map(([ref, x]) => (
        <group key={x as number} ref={ref as RefObject<Group>} position={[x as number, 0.5, 0]}>
          <mesh position={[0, -0.22, 0]} material={mats.dark} castShadow>
            <capsuleGeometry args={[0.07, 0.3, 4, 10]} />
          </mesh>
          <RoundedBox args={[0.15, 0.08, 0.24]} radius={0.03} smoothness={2} position={[0, -0.44, 0.04]} material={mats.suit} castShadow />
          {high && (
            <>
              <mesh position={[0, -0.2, 0.02]} material={mats.shell} castShadow>
                <sphereGeometry args={[0.085, 14, 10]} />
              </mesh>
              <mesh position={[0, -0.2, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.glow}>
                <torusGeometry args={[0.085, 0.012, 6, 20]} />
              </mesh>
              <mesh position={[0, -0.47, 0.16]} material={mats.glow}>
                <boxGeometry args={[0.12, 0.02, 0.02]} />
              </mesh>
            </>
          )}
        </group>
      ))}

      <group ref={body} position={[0, 0.5, 0]}>
        <mesh position={[0, 0.34, 0]} material={mats.suit} castShadow>
          <capsuleGeometry args={[0.24, 0.3, 6, 16]} />
        </mesh>
        {high && (
          <>
            <mesh position={[0, 0.34, 0.2]} material={mats.shell}>
              <sphereGeometry args={[0.12, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
            <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.dark}>
              <torusGeometry args={[0.235, 0.03, 8, 32]} />
            </mesh>
            {/* A backpack reactor with glowing vents. */}
            <RoundedBox args={[0.32, 0.36, 0.16]} radius={0.05} smoothness={2} position={[0, 0.38, -0.25]} material={mats.dark} />
            {[0.3, 0.38, 0.46].map((y) => (
              <mesh key={y} position={[0, y, -0.335]} material={mats.glow}>
                <boxGeometry args={[0.2, 0.025, 0.01]} />
              </mesh>
            ))}
            {/* Neck collar and the seams on the chest plate. */}
            <mesh position={[0, 0.62, 0]} material={mats.joint}>
              <cylinderGeometry args={[0.13, 0.17, 0.08, 20]} />
            </mesh>
            <mesh position={[0, 0.665, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.glow}>
              <torusGeometry args={[0.13, 0.012, 6, 24]} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * 0.13, 0.36, 0.215]} rotation={[0, side * 0.5, 0]} material={mats.glow}>
                <boxGeometry args={[0.012, 0.2, 0.012]} />
              </mesh>
            ))}
          </>
        )}
        <mesh ref={core} position={[0, 0.4, high ? 0.315 : 0.235]} material={mats.core}>
          <sphereGeometry args={[0.032, 16, 12]} />
        </mesh>

        {[
          [armL, -0.31],
          [armR, 0.31],
        ].map(([ref, x]) => (
          <group key={x as number} ref={ref as RefObject<Group>} position={[x as number, 0.5, 0]}>
            {high && (
              <mesh position={[0, -0.02, 0]} material={mats.shell}>
                <sphereGeometry args={[0.085, 16, 12]} />
              </mesh>
            )}
            <mesh position={[0, -0.22, 0]} material={mats.suit} castShadow>
              <capsuleGeometry args={[0.06, 0.26, 4, 10]} />
            </mesh>
            <mesh position={[0, -0.42, 0]} material={mats.shell}>
              <sphereGeometry args={[0.075, 16, 12]} />
            </mesh>
            {high && (
              <>
                <RoundedBox args={[0.2, 0.12, 0.22]} radius={0.05} smoothness={2} position={[(x as number) < 0 ? -0.03 : 0.03, 0.05, 0]} material={mats.suit} castShadow />
                <mesh position={[0, -0.21, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.glow}>
                  <torusGeometry args={[0.066, 0.01, 6, 20]} />
                </mesh>
                <mesh position={[0, -0.33, 0]} material={mats.joint}>
                  <cylinderGeometry args={[0.072, 0.065, 0.06, 16]} />
                </mesh>
              </>
            )}
          </group>
        ))}

        <group ref={head} position={[0, 0.82, 0]}>
          <RoundedBox args={[0.46, 0.4, 0.42]} radius={0.14} smoothness={4} material={mats.shell} castShadow />
          <RoundedBox args={[0.38, 0.2, 0.06]} radius={0.05} smoothness={3} position={[0, 0.01, 0.2]} material={mats.visor} />
          <mesh position={[0, -0.075, 0.232]} material={mats.glow}>
            <boxGeometry args={[0.3, 0.01, 0.005]} />
          </mesh>
          <group ref={eyes} position={[0, 0.015, 0.235]}>
            {[-0.08, 0.08].map((ex) => (
              <mesh key={ex} position={[ex, 0, 0]} material={mats.eye}>
                <capsuleGeometry args={[0.025, 0.035, 4, 8]} />
              </mesh>
            ))}
          </group>
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * 0.235, 0.02, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.suit}>
              <cylinderGeometry args={[0.075, 0.075, 0.05, 20]} />
            </mesh>
          ))}
          <group ref={antenna} position={[0, 0.18, 0]}>
            <mesh position={[0, 0.06, 0]} material={mats.dark}>
              <cylinderGeometry args={[0.012, 0.012, 0.12, 8]} />
            </mesh>
            <mesh position={[0, 0.12, 0]} material={mats.eye}>
              <sphereGeometry args={[0.035, 12, 10]} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}
