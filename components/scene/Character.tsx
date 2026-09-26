'use client';

import { RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useContext, useEffect, useMemo, useRef, type RefObject } from 'react';
import { AdditiveBlending, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, type Group, type Mesh, type PointLight } from 'three';
import {
  beatStartMs,
  laneAt,
  VERDICT_TONE,
  type BeatPlan,
  type RendererSnapshot,
  type ReplayBeat,
  type ReplayLane,
  type SceneLayout,
  type Vec2,
} from '@/lib/replay';
import { Detail, discTexture, shade } from './look';
import type { Focus } from './RoomScene';
import { yawToward } from './SceneObject';

/**
 * One competitor's stand-in: a small visor-faced robot in its lane's colour,
 * with a head, arms and legs on joints.
 *
 * ── A pure function of time ────────────────────────────────────────────────
 * Every frame recomputes the pose from `timeRef` alone — where the lane is in
 * its beat, where it came from, where it is going — rather than integrating
 * velocity. The same instant always draws the same pose, so a pause, a restart
 * or a fake test clock cannot leave the character somewhere the log never put
 * it. The walk cycle is a function of the walk's progress too, not of a
 * running phase.
 *
 * Per beat: WALK to the target (or to the centre, for `look` and for an object
 * that does not exist) with a stride sized to the distance, ACT with a
 * verb-specific gesture — reach, scan, key in, puzzle — then HOLD and react to
 * the verdict: a hop with both arms up, a head shake with a slump, or a shrug.
 * A rejected turn shrugs in place.
 *
 * The small life on top — a blink, eyes that narrow on a success and droop on a
 * failure, a chest core that quickens while it works, the hips swaying and the
 * antenna trailing its walk — is a function of the same clock, so it pauses too.
 */

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

const STRIDE = 0.42;
const BODY = '#e9e6df';
/** A blink every this many ms, lasting `BLINK_MS`. */
const BLINK_EVERY_MS = 3400;
const BLINK_MS = 140;

interface Props {
  readonly lane: ReplayLane;
  readonly laneIndex: number;
  readonly layout: SceneLayout;
  readonly plan: BeatPlan;
  readonly timeRef: RefObject<number>;
  readonly colour: string;
  /** How many items the character is carrying. */
  readonly carrying: number;
  readonly renderer: RendererSnapshot;
  /** Written with the character's floor position every frame, for the camera to follow. */
  readonly focus?: Focus;
}

export function Character({ lane, laneIndex, layout, plan, timeRef, colour, carrying, renderer, focus }: Props) {
  const standOff = renderer.geometry.standOff;
  const detail = useContext(Detail);
  const root = useRef<Group>(null);
  const marker = useRef<Group>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const antenna = useRef<Group>(null);
  const eyes = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const lamp = useRef<PointLight>(null);

  // One set of materials per character, so a fade touches each once.
  const mats = useMemo(
    () => ({
      // Glossy toy plastic over a painted suit; the visor is smoked glass.
      shell: detail
        ? new MeshPhysicalMaterial({ color: BODY, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12 })
        : new MeshStandardMaterial({ color: BODY, roughness: 0.35, metalness: 0.1 }),
      suit: detail
        ? new MeshPhysicalMaterial({ color: colour, roughness: 0.4, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.25 })
        : new MeshStandardMaterial({ color: colour, roughness: 0.45, metalness: 0.15 }),
      dark: new MeshStandardMaterial({ color: '#15171c', roughness: 0.25, metalness: 0.4 }),
      visor: detail
        ? new MeshPhysicalMaterial({ color: '#0b0d12', roughness: 0.06, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 })
        : new MeshStandardMaterial({ color: '#15171c', roughness: 0.25, metalness: 0.4 }),
      eye: new MeshStandardMaterial({ color: '#000', emissive: shade(colour, 0.35), emissiveIntensity: 2.2, toneMapped: false }),
      core: new MeshStandardMaterial({ color: '#000', emissive: shade(colour, 0.2), emissiveIntensity: 1.6, toneMapped: false }),
      glow: new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.3, depthWrite: false, blending: AdditiveBlending, map: discTexture() }),
      trim: new MeshStandardMaterial({ color: shade(colour, -0.3), roughness: 0.5 }),
      cargo: new MeshStandardMaterial({ color: renderer.assets.kindColours.portable, roughness: 0.6 }),
      ring: new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8, depthWrite: false, blending: AdditiveBlending }),
      shadow: new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.55, depthWrite: false, map: discTexture() }),
    }),
    [colour, detail, renderer.assets.kindColours.portable],
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

  const positions = useMemo(() => new Map(layout.objects.map((o) => [o.id, o.position])), [layout]);

  const standFor = useMemo(() => {
    return (beat: ReplayBeat | undefined): Vec2 => {
      const at = beat?.targetId ? positions.get(beat.targetId) : undefined;
      if (!at) return layout.centre;
      const dx = layout.centre[0] - at[0];
      const dz = layout.centre[1] - at[1];
      const length = Math.hypot(dx, dz) || 1;
      return [at[0] + (dx / length) * standOff, at[1] + (dz / length) * standOff];
    };
  }, [positions, layout, standOff]);

  const exitAt = positions.get(layout.exitObjectId) ?? layout.centre;

  useFrame(() => {
    if (!root.current || !body.current || !head.current || !marker.current) return;
    if (!armL.current || !armR.current || !legL.current || !legR.current) return;
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
    let headYaw = 0;
    let headTilt = 0;
    let opacity = 1;
    // Limb angles: x positive swings forward, z positive raises the arm outward.
    let armLx = 0;
    let armRx = 0;
    let armLz = 0;
    let armRz = 0;
    let legLx = 0;
    let legRx = 0;
    let sway = 0;
    let eyeOpen = 1;
    let eyeGlow = 2.2;
    let pulseMs = 650;
    const breathe = Math.sin(t / 700) * 0.012;

    const facing = (): number => {
      const target = current?.targetId ? positions.get(current.targetId) : undefined;
      return target ? yawToward(position, target) : Math.PI; // no target: face the back wall
    };

    const walk = (a: Vec2, b: Vec2, p: number) => {
      const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (distance < 0.01) return;
      const steps = Math.max(1, Math.round(distance / STRIDE));
      const envelope = Math.sin(Math.min(1, p) * Math.PI) ** 0.35;
      const phase = easeInOut(p) * steps * Math.PI;
      const swing = Math.sin(phase) * 0.7 * envelope;
      legLx = swing;
      legRx = -swing;
      armLx = -swing * 0.8;
      armRx = swing * 0.8;
      lift = Math.abs(Math.sin(phase)) * 0.05 * envelope;
      lean = 0.08 * envelope;
      sway = Math.sin(phase) * 0.06 * envelope;
    };

    switch (moment.phase) {
      case 'intro':
        position = layout.centre;
        yaw = 0; // facing the camera
        armLz = 0.12 + Math.sin(t / 500) * 0.05;
        armRz = armLz;
        break;
      case 'walk': {
        const p = easeInOut(moment.progress);
        position = lerp2(from, to, p);
        const moving = Math.hypot(to[0] - from[0], to[1] - from[1]) > 0.01;
        yaw = moving ? yawToward(from, to) : facing();
        walk(from, to, moment.progress);
        break;
      }
      case 'act': {
        yaw = facing();
        pulseMs = 160;
        const s = Math.sin(moment.progress * Math.PI);
        if (current?.verb === null) {
          // Rejected turn: an uncertain shrug in place.
          squash = 1 - 0.1 * s;
          armLz = 0.7 * s;
          armRz = 0.7 * s;
          headTilt = 0.25 * s;
        } else if (current?.verb === 'look') {
          headYaw = Math.sin(moment.progress * Math.PI * 2) * 0.9;
          yaw += Math.sin(moment.progress * Math.PI * 2) * 0.35;
          armRx = 1.2 * s; // hand up to the visor
          armRz = -0.3 * s;
        } else if (current?.verb === 'enter_code' || current?.verb === 'submit_answer') {
          armRx = 1.35 * s + Math.abs(Math.sin(moment.progress * Math.PI * 6)) * 0.25 * s;
          armLx = 0.5 * s;
          lean = 0.12 * s;
          headTilt = 0.15 * s;
        } else {
          // Reach for it with both hands.
          lean = 0.3 * s;
          armLx = 1.3 * s;
          armRx = 1.3 * s;
          headTilt = 0.2 * s;
        }
        break;
      }
      case 'hold': {
        yaw = facing();
        const react = Math.min(1, moment.progress / 0.4);
        const s = Math.sin(react * Math.PI);
        const tone = current ? VERDICT_TONE[current.verdict.code] : 'neutral';
        if (tone === 'success') {
          eyeOpen = 1 - 0.55 * Math.min(1, react * 3); // a pleased squint
          eyeGlow = 3.4;
          lift = 0.28 * s;
          armLz = 2.4 * s;
          armRz = 2.4 * s;
          squash = 1 + 0.06 * s;
        } else if (tone === 'failure') {
          eyeOpen = 0.6;
          eyeGlow = 1.3;
          headYaw = Math.sin(react * Math.PI * 4) * 0.45;
          headTilt = 0.25 * Math.min(1, react * 2);
          armLx = -0.15;
          armRx = -0.15;
          lean = -0.05;
        } else if (tone === 'invalid') {
          squash = 1 - 0.1 * s;
          armLz = 0.8 * s;
          armRz = 0.8 * s;
          headTilt = -0.2 * s;
        } else {
          headTilt = 0.12 * s;
        }
        break;
      }
      case 'done': {
        const last = standFor(lane.beats.at(-1));
        position = last;
        yaw = 0;
        if (lane.escaped) {
          const since = t - beatStartMs(plan, laneIndex, lane.beats.length);
          const beyond: Vec2 = [exitAt[0], exitAt[1] - 1.2];
          if (since < plan.exitWalkMs) {
            const p = Math.max(0, since) / plan.exitWalkMs;
            position = lerp2(last, exitAt, easeInOut(p));
            yaw = yawToward(last, exitAt);
            walk(last, exitAt, p);
          } else {
            const fade = Math.min(1, (since - plan.exitWalkMs) / plan.exitFadeMs);
            position = lerp2(exitAt, beyond, fade);
            yaw = Math.PI;
            walk(exitAt, beyond, fade);
            opacity = 1 - fade;
          }
        } else {
          // Out of actions: slumped, head down, eyes dimmed.
          eyeOpen = 0.45;
          eyeGlow = 0.8;
          pulseMs = 1600;
          headTilt = 0.35;
          armLz = 0.05;
          armRz = 0.05;
          lean = 0.06;
        }
        break;
      }
    }

    // Blink on a fixed schedule, offset per lane so the two never blink together.
    const blinkAt = (t + laneIndex * 1300) % BLINK_EVERY_MS;
    if (blinkAt < BLINK_MS) eyeOpen = Math.min(eyeOpen, Math.abs(blinkAt / BLINK_MS - 0.5) * 2 * 0.9 + 0.1);

    if (focus) {
      focus.x = position[0];
      focus.z = position[1];
    }
    root.current.position.set(position[0], lift, position[1]);
    root.current.rotation.y = yaw;
    marker.current.position.set(position[0], 0.012, position[1]);
    const ringScale = 1 + Math.sin(t / 400) * 0.05;
    marker.current.scale.set(ringScale, ringScale, ringScale);
    body.current.rotation.set(lean, 0, sway);
    body.current.scale.set(1, squash + breathe, 1);
    head.current.rotation.set(headTilt, headYaw, 0);
    // three.js swings a hanging limb backwards for +x, and toward +x for +z. The
    // angles above read "forward" and "outward", so x flips, and z flips on the left.
    armL.current.rotation.set(-armLx, 0, -armLz);
    armR.current.rotation.set(-armRx, 0, armRz);
    legL.current.rotation.x = -legLx;
    legR.current.rotation.x = -legRx;
    if (antenna.current) {
      // Trails the body: tips back as it leans in, wags with the hips, bobs on the hop.
      antenna.current.rotation.set(-lean * 1.6 - lift * 2 + Math.sin(t / 300) * 0.04, 0, -sway * 2.2);
    }
    if (eyes.current) eyes.current.scale.set(1, eyeOpen, 1);
    mats.eye.emissiveIntensity = eyeGlow;
    const beat = 0.5 + 0.5 * Math.sin((t / pulseMs) * Math.PI * 2);
    mats.core.emissiveIntensity = 0.6 + beat * 1.1;
    if (core.current) core.current.scale.setScalar(0.9 + beat * 0.15);
    if (lamp.current) lamp.current.intensity = (1.2 + beat * 0.5) * opacity;

    for (const m of [mats.shell, mats.suit, mats.dark, mats.visor, mats.eye, mats.core, mats.trim, mats.cargo]) {
      m.opacity = opacity;
      m.transparent = opacity < 1;
    }
    mats.ring.opacity = 0.8 * opacity;
    mats.shadow.opacity = 0.55 * opacity;
    mats.glow.opacity = 0.3 * opacity;
    root.current.visible = opacity > 0.01;
    marker.current.visible = opacity > 0.01;
  });

  return (
    <>
      {/* The lane marker and a soft contact shadow — on the floor, not on the hop. */}
      <group ref={marker}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={mats.shadow}>
          <planeGeometry args={[0.9, 0.9]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]} material={mats.glow}>
          <planeGeometry args={[1.5, 1.5]} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} material={mats.ring}>
          <ringGeometry args={[0.39, 0.415, 64]} />
        </mesh>
      </group>

      <group ref={root}>
        {/* Its own glow, tinting the floor and whatever it stands beside. */}
        {detail && <pointLight ref={lamp} position={[0, 0.9, 0.35]} color={colour} intensity={1.2} distance={2.4} decay={2} />}
        {/* Legs, pivoting at the hips. */}
        {[
          [legL, -0.11],
          [legR, 0.11],
        ].map(([ref, x]) => (
          <group key={x as number} ref={ref as RefObject<Group>} position={[x as number, 0.5, 0]}>
            <mesh position={[0, -0.22, 0]} material={mats.dark} castShadow>
              <capsuleGeometry args={[0.07, 0.3, 4, 10]} />
            </mesh>
            <RoundedBox args={[0.15, 0.08, 0.24]} radius={0.03} smoothness={2} position={[0, -0.44, 0.04]} material={mats.suit} castShadow />
          </group>
        ))}

        <group ref={body} position={[0, 0.5, 0]}>
          {/* Torso. */}
          <mesh position={[0, 0.34, 0]} material={mats.suit} castShadow>
            <capsuleGeometry args={[0.24, 0.3, 6, 16]} />
          </mesh>
          {detail && (
            <>
              <mesh position={[0, 0.34, 0.2]} material={mats.shell}>
                <sphereGeometry args={[0.12, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
              </mesh>
              <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.trim}>
                <torusGeometry args={[0.235, 0.03, 8, 32]} />
              </mesh>
            </>
          )}
          {/* The core: a light in its chest that quickens while it works. */}
          <mesh ref={core} position={[0, 0.4, detail ? 0.315 : 0.235]} material={mats.core}>
            <sphereGeometry args={[0.028, 16, 12]} />
          </mesh>

          {/* Arms, pivoting at the shoulders. */}
          {[
            [armL, -0.31],
            [armR, 0.31],
          ].map(([ref, x]) => (
            <group key={x as number} ref={ref as RefObject<Group>} position={[x as number, 0.5, 0]}>
              {detail && (
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
            </group>
          ))}

          {/* Head with a visor and two eyes, so which way it faces is legible. */}
          <group ref={head} position={[0, 0.82, 0]}>
            <RoundedBox args={[0.46, 0.4, 0.42]} radius={0.14} smoothness={4} material={mats.shell} castShadow />
            <RoundedBox args={[0.38, 0.2, 0.06]} radius={0.05} smoothness={3} position={[0, 0.01, 0.2]} material={mats.visor} />
            <group ref={eyes} position={[0, 0.015, 0.235]}>
              {[-0.08, 0.08].map((ex) => (
                <mesh key={ex} position={[ex, 0, 0]} material={mats.eye}>
                  <capsuleGeometry args={[0.025, 0.035, 4, 8]} />
                </mesh>
              ))}
            </group>
            {detail &&
              [-1, 1].map((side) => (
                // Ear pods, in the lane's colour.
                <mesh key={side} position={[side * 0.235, 0.02, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.suit}>
                  <cylinderGeometry args={[0.075, 0.075, 0.05, 20]} />
                </mesh>
              ))}
            <group ref={antenna} position={[0, 0.18, 0]}>
              {detail && (
                <mesh position={[0, 0.06, 0]} material={mats.dark}>
                  <cylinderGeometry args={[0.012, 0.012, 0.12, 8]} />
                </mesh>
              )}
              <mesh position={[0, 0.12, 0]} material={mats.eye}>
                <sphereGeometry args={[0.035, 12, 10]} />
              </mesh>
            </group>
          </group>

          {/* What it has picked up, strapped to its back. */}
          {Array.from({ length: carrying }, (_, i) => (
            <RoundedBox
              key={i}
              args={[0.26, 0.11, 0.18]}
              radius={0.02}
              smoothness={2}
              position={[0, 0.2 + i * 0.13, -0.27]}
              material={mats.cargo}
              castShadow
            />
          ))}
        </group>
      </group>
    </>
  );
}
