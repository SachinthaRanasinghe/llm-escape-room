'use client';

import { Environment, Lightformer, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Quaternion,
  ShaderMaterial,
  RepeatWrapping,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type Group,
  type Mesh,
  type PerspectiveCamera as PerspectiveCameraImpl,
  type Points,
  type Sprite,
  type WebGLRenderer,
} from 'three';
import { discTexture, hash01, shade } from '@/components/scene/look';
import { yawToward } from '@/components/scene/SceneObject';
import { LETTER, type Owner, type PlayerId } from './choreography';
import { Bot, BOT_SCALE, CARRY_HEIGHT } from './Bot';
import { PostFX } from './PostFX';
import { Pad, Shrine, SkyIslands } from './SkyIslands';
import { clamp01, CORE_COLOR, easeInOut, LANE_COLOR, PLAYERS, positionAt, SPOT, type ArenaDirector, type P2 } from './director';

/**
 * The Energy Core Heist arena in 3D: three hex pads round a reactor, a robot
 * per model, five cores, and the effects that make a turn read from across
 * the room — lock-on beams, holo terminals, sparks, shockwaves, shields and
 * fireworks.
 *
 * Everything reads `ArenaDirector` every frame; nothing here holds game state.
 * The DOM tags over the canvas (names, counts) are pinned to the pads by
 * projecting their world anchors each frame, so they ride the camera.
 *
 * Same quality split as the escape room's `ReplayStage`: a software
 * rasteriser gets no shadows, no environment map and fewer particles.
 *
 * Loaded with `next/dynamic` and `ssr: false` from `ArenaStage`.
 */

type Quality = 'high' | 'low';

const REACTOR_TOP = 2.05;
/** The moon's light: high on the left over the camera's shoulder, so faces are lit and shadows fall back and right. */
const MOON: [number, number, number] = [-16, 26, 14];
/** Where each DOM tag pins, in world space. */
const ANCHOR: Readonly<Record<Owner, readonly [number, number, number]>> = {
  'player-a': [SPOT['player-a'].x, 0, SPOT['player-a'].z + 1.7],
  'player-b': [SPOT['player-b'].x, 0, SPOT['player-b'].z + 1.7],
  'player-c': [SPOT['player-c'].x, 0, SPOT['player-c'].z + 1.6],
  centre: [0, 2.85, 0],
};

function canvasTexture(width: number, height: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  paint(el.getContext('2d')!);
  const tex = new CanvasTexture(el);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Holo-terminal glass: scanlines, a frame and rows of "code". */
function holoTexture(): CanvasTexture {
  const tex = canvasTexture(256, 160, (g) => {
    g.fillStyle = 'rgba(14,22,34,0.82)';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, 252, 156);
    for (let y = 0; y < 160; y += 3) {
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, y, 256, 1);
    }
    let seed = 3;
    for (let row = 0; row < 9; row++) {
      let x = 14;
      while (x < 230) {
        const w = 8 + hash01(seed++) * 38;
        g.fillStyle = `rgba(255,255,255,${0.35 + hash01(seed++) * 0.55})`;
        g.fillRect(x, 16 + row * 15, Math.min(w, 240 - x), 6);
        x += w + 6;
      }
    }
  });
  tex.wrapT = RepeatWrapping;
  return tex;
}

function owned(director: ArenaDirector, owner: Owner, index: number): { slot: number; of: number } {
  let slot = 0;
  let of = 0;
  director.cores.forEach((c, i) => {
    if (c.owner !== owner) return;
    if (i < index) slot += 1;
    of += 1;
  });
  return { slot, of };
}

// ── Camera ────────────────────────────────────────────────────────────────

function CameraRig({ director }: { readonly director: ArenaDirector }) {
  const camera = useRef<PerspectiveCameraImpl>(null);
  const size = useThree((s) => s.size);
  const point = useMemo(() => new Vector3(), []);
  const look = useMemo(() => new Vector3(), []);
  const focus = useRef({ x: 0, z: 0 });

  useFrame((_, dt) => {
    const cam = camera.current;
    if (!cam) return;
    const now = director.reduced ? 0 : director.now();
    const aspect = size.width / Math.max(1, size.height);
    // Keep the three pads in frame on a narrow stage by backing away.
    const narrow = Math.max(1, 1.75 / aspect);
    const back = narrow ** 0.45;
    cam.fov = Math.min(70, 42 * narrow ** 0.55);
    cam.updateProjectionMatrix();

    // Lean toward whoever is acting.
    let fx = 0;
    let fz = 0;
    if (director.lock) {
      const actor = director.robotFloor(director.lock.from);
      fx = actor.x * 0.15;
      fz = actor.z * 0.08;
    }
    const ease = director.reduced ? 1 : 1 - Math.exp(-dt * 1.6);
    focus.current.x += (fx - focus.current.x) * ease;
    focus.current.z += (fz - focus.current.z) * ease;

    const drift = Math.sin(now / 7000) * 0.6;
    const bob = Math.sin(now / 5100) * 0.15;
    let px = focus.current.x + drift;
    let py = 7.4 * back + bob;
    let pz = focus.current.z + 14.2 * back;
    let lx = focus.current.x;
    let ly = 0.6;
    let lz = focus.current.z + 0.9;

    // The end: swing round to the winner, close and low, framed above the finale card.
    const winner = director.winners.length === 1 ? director.winners[0]! : null;
    if (winner) {
      const w = director.robotFloor(winner);
      const k = director.reduced ? 1 : easeInOut(clamp01((director.now() - director.victoryAt) / 2000));
      const orbit = director.reduced ? 0 : Math.sin(now / 2600) * 0.9;
      const toward = Math.atan2(-w.x, -w.z) * 0.25;
      px += (w.x + Math.sin(toward) * 8.4 + orbit - px) * k;
      py += (4.6 * back - py) * k;
      pz += (w.z + Math.cos(toward) * 8.4 * back - pz) * k;
      lx += (w.x - lx) * k;
      ly += (0.6 - ly) * k;
      lz += (w.z - lz) * k;
    }

    const since = director.now() - director.shake.at;
    if (!director.reduced && since < 550) {
      const fade = (1 - since / 550) ** 2 * director.shake.strength;
      px += Math.sin(since * 0.21) * fade;
      py += Math.cos(since * 0.27) * fade;
    }
    cam.position.set(px, py, pz);
    look.set(lx, ly, lz);
    cam.lookAt(look);
    cam.updateMatrixWorld();

    // Pin the DOM tags.
    for (const [owner, el] of director.anchors) {
      const [ax, ay, az] = ANCHOR[owner];
      point.set(ax, ay, az).project(cam);
      el.style.left = `${((point.x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - point.y) / 2) * 100}%`;
    }
  });
  return <PerspectiveCamera ref={camera} makeDefault position={[0, 7.4, 15]} fov={42} near={0.1} far={600} />;
}

// ── Cores ─────────────────────────────────────────────────────────────────

function Cores({ director, spawn }: { readonly director: ArenaDirector; readonly spawn: Spawner }) {
  const groups = useRef<(Group | null)[]>([]);
  const halos = useRef<(Sprite | null)[]>([]);
  const state = useRef(director.cores.map(() => ({ x: 0, y: 0, z: 0, ready: false, snap: -1, trail: 0 })));
  const glow = useMemo(() => discTexture(), []);
  const crystal = useMemo(() => new MeshStandardMaterial({ color: '#ffb020', emissive: '#ff9d00', emissiveIntensity: 1.1, metalness: 0.35, roughness: 0.12 }), []);
  const inner = useMemo(() => new MeshBasicMaterial({ color: '#fff6d8', toneMapped: false }), []);
  const haloMats = useMemo(() => director.cores.map(() => new SpriteMaterial({ map: glow, color: '#ffb02e', transparent: true, opacity: 0.32, depthWrite: false, blending: AdditiveBlending, toneMapped: false })), [director, glow]);
  useEffect(() => () => [glow, crystal, inner, ...haloMats].forEach((d) => d.dispose()), [glow, crystal, inner, haloMats]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const real = director.now();
    const now = director.reduced ? 0 : real;
    director.cores.forEach((core, i) => {
      const g = groups.current[i];
      if (!g) return;
      const s = state.current[i]!;
      let tx: number;
      let ty: number;
      let tz: number;
      let rate = 5.5;
      let scale = 1;
      if (core.carrier !== null && real < core.carryUntil) {
        const p = positionAt(director.robots[core.carrier].move, real);
        tx = p.x;
        ty = CARRY_HEIGHT + Math.sin(real / 120) * 0.04;
        tz = p.z;
        rate = 16;
        scale = 1.3;
      } else {
        const { slot, of } = owned(director, core.owner, i);
        if (core.owner === 'centre') {
          const a = (slot / Math.max(1, of)) * Math.PI * 2 + now / 1500;
          const r = of === 1 ? 0 : 0.38;
          tx = Math.sin(a) * r;
          tz = Math.cos(a) * r;
          ty = REACTOR_TOP + Math.sin(now / 700 + i) * 0.12;
        } else {
          const spot = SPOT[core.owner];
          const a = (slot / Math.max(1, of)) * Math.PI * 2 + now / 2600 + i * 0.01;
          tx = spot.x + Math.sin(a) * 1.0;
          tz = spot.z + Math.cos(a) * 1.0;
          ty = 0.75 + Math.sin(now / 600 + i * 1.7) * 0.1;
        }
      }
      if (!s.ready || s.snap !== core.snap || director.reduced) {
        s.x = tx;
        s.y = ty;
        s.z = tz;
        s.ready = true;
        s.snap = core.snap;
      } else {
        const k = 1 - Math.exp(-dt * rate);
        const dx = (tx - s.x) * k;
        const dz = (tz - s.z) * k;
        const far = Math.hypot(tx - s.x, tz - s.z);
        // Flights arc up and over rather than sliding along the floor.
        const arc = rate < 10 ? Math.min(1.2, far * 0.35) : 0;
        s.x += dx;
        s.z += dz;
        s.y += (ty + arc - s.y) * k;
        // A sparkling trail while it moves.
        const speed = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
        s.trail += speed * dt;
        if (speed > 0.8 && s.trail > 0.12) {
          s.trail = 0;
          spawn(s.x, s.y, s.z, 0, 0.2, 0, CORE_COLOR, 0.5, 0.11);
        }
      }
      g.position.set(s.x, s.y, s.z);
      g.rotation.set(now / 900 + i, now / 700 + i * 2, 0);
      g.scale.setScalar(scale);
      const h = halos.current[i];
      if (h) {
        h.position.set(s.x, s.y, s.z);
        h.scale.setScalar((0.85 + Math.sin(now / 300 + i) * 0.08) * scale);
      }
    });
  });

  return (
    <>
      {director.cores.map((_, i) => (
        <group key={i}>
          <group ref={(g) => void (groups.current[i] = g)}>
            <mesh material={crystal} castShadow>
              <octahedronGeometry args={[0.24, 0]} />
            </mesh>
            <mesh material={inner}>
              <icosahedronGeometry args={[0.08, 0]} />
            </mesh>
          </group>
          <sprite ref={(s) => void (halos.current[i] = s)} material={haloMats[i]} />
        </group>
      ))}
    </>
  );
}

// ── Effects ───────────────────────────────────────────────────────────────

type Spawner = (x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, life: number, size?: number) => void;

const MAX_PARTICLES = 1400;
const CONFETTI = ['#e8424c', '#f2b632', '#3c8fe0', '#4fc27a', '#c45de0', '#ffffff', CORE_COLOR];

/** Round soft dots with their own alpha, so sparks and confetti read against a bright sky. */
const PARTICLE_VERTEX = /* glsl */ `
  attribute float alpha;
  attribute float size;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (520.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const PARTICLE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5 || vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.25, d) * vAlpha);
  }
`;

function useParticles(high: boolean) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3).fill(-999), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
    g.setAttribute('alpha', new BufferAttribute(new Float32Array(MAX_PARTICLES), 1));
    g.setAttribute('size', new BufferAttribute(new Float32Array(MAX_PARTICLES).fill(0.12), 1));
    return g;
  }, []);
  const sim = useMemo(
    () => ({
      vel: new Float32Array(MAX_PARTICLES * 3),
      life: new Float32Array(MAX_PARTICLES),
      max: new Float32Array(MAX_PARTICLES),
      base: new Float32Array(MAX_PARTICLES * 3),
      next: 0,
    }),
    [],
  );
  const scratch = useMemo(() => new Color(), []);
  const spawn: Spawner = (x, y, z, vx, vy, vz, color, life, size = 0.12) => {
    const i = sim.next;
    sim.next = (sim.next + 1) % (high ? MAX_PARTICLES : 500);
    const pos = geometry.attributes.position!.array as Float32Array;
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    sim.vel[i * 3] = vx;
    sim.vel[i * 3 + 1] = vy;
    sim.vel[i * 3 + 2] = vz;
    sim.life[i] = life;
    sim.max[i] = life;
    (geometry.attributes.size!.array as Float32Array)[i] = size;
    scratch.set(color);
    sim.base[i * 3] = scratch.r;
    sim.base[i * 3 + 1] = scratch.g;
    sim.base[i * 3 + 2] = scratch.b;
  };
  return { geometry, sim, spawn };
}

function Particles({ director, high, particles }: { readonly director: ArenaDirector; readonly high: boolean; readonly particles: ReturnType<typeof useParticles> }) {
  const { geometry, sim, spawn } = particles;
  const points = useRef<Points>(null);
  const material = useMemo(
    () => new ShaderMaterial({ vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT, vertexColors: true, transparent: true, depthWrite: false, blending: NormalBlending }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  const lastFirework = useRef(0);
  const seed = useRef(1);
  const rand = () => hash01(seed.current++);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const now = director.now();
    director.tick(now);

    // Bursts the director asked for.
    for (const b of director.bursts.splice(0)) {
      const count = high ? b.count : Math.ceil(b.count / 3);
      for (let n = 0; n < count; n++) {
        const theta = rand() * Math.PI * 2;
        const phi = Math.acos(2 * rand() - 1);
        const sp = b.speed * (0.35 + rand() * 0.65);
        spawn(b.at[0], b.at[1], b.at[2], Math.sin(phi) * Math.cos(theta) * sp, Math.abs(Math.cos(phi)) * sp * 0.6 + (b.up ?? 0) * rand(), Math.sin(phi) * Math.sin(theta) * sp, b.color, 0.6 + rand() * 0.8);
      }
    }

    if (!director.reduced) {
      // The robot working a challenge: sparks spiralling up around it.
      if (director.charging) {
        const p = director.robotFloor(director.charging);
        for (let n = 0; n < (high ? 3 : 1); n++) {
          const a = now / 160 + n * 2.1;
          spawn(p.x + Math.sin(a) * 0.75, 0.2, p.z + Math.cos(a) * 0.75, Math.cos(a) * 0.5, 1.6 + rand(), -Math.sin(a) * 0.5, LANE_COLOR[director.charging], 1.1);
        }
      }
      // A knocked-out robot still sparks and smokes.
      for (const p of director.out) {
        if (rand() > (high ? 0.12 : 0.05)) continue;
        const at = director.robotFloor(p);
        const hot = rand() > 0.5;
        spawn(at.x + (rand() - 0.5) * 0.8, 0.5, at.z + (rand() - 0.5) * 0.6, (rand() - 0.5) * 1.5, hot ? 2.5 + rand() * 2 : 0.8, (rand() - 0.5) * 1.5, hot ? '#ff9b4a' : '#3a3f52', hot ? 0.5 : 1.6);
      }
      // Victory: confetti showering the winners.
      if (director.winners.length > 0 && now - director.victoryAt < 7000 && now - lastFirework.current > 260) {
        lastFirework.current = now;
        const w = director.winners[Math.floor(rand() * director.winners.length)]!;
        const at = SPOT[w];
        const x = at.x + (rand() - 0.5) * 3;
        const y = 4.2 + rand() * 1.5;
        const z = at.z + (rand() - 0.5) * 2;
        const count = high ? 70 : 24;
        for (let n = 0; n < count; n++) {
          const theta = rand() * Math.PI * 2;
          const sp = 1.5 + rand() * 2.5;
          spawn(x, y, z, Math.cos(theta) * sp, 2 + rand() * 2.5, Math.sin(theta) * sp, CONFETTI[Math.floor(rand() * CONFETTI.length)]!, 2.2 + rand() * 0.8, 0.1 + rand() * 0.06);
        }
      }
    }

    const pos = geometry.attributes.position!.array as Float32Array;
    const col = geometry.attributes.color!.array as Float32Array;
    const alpha = geometry.attributes.alpha!.array as Float32Array;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (sim.life[i]! <= 0) {
        alpha[i] = 0;
        continue;
      }
      sim.life[i]! -= dt;
      const k = Math.max(0, sim.life[i]! / sim.max[i]!);
      sim.vel[i * 3 + 1]! -= 3.2 * dt;
      const drag = 1 - 1.4 * dt;
      sim.vel[i * 3]! *= drag;
      sim.vel[i * 3 + 2]! *= drag;
      pos[i * 3]! += sim.vel[i * 3]! * dt;
      pos[i * 3 + 1] = Math.max(0.03, pos[i * 3 + 1]! + sim.vel[i * 3 + 1]! * dt);
      pos[i * 3 + 2]! += sim.vel[i * 3 + 2]! * dt;
      col[i * 3] = sim.base[i * 3]!;
      col[i * 3 + 1] = sim.base[i * 3 + 1]!;
      col[i * 3 + 2] = sim.base[i * 3 + 2]!;
      alpha[i] = Math.min(1, k * 2.2);
    }
    geometry.attributes.alpha!.needsUpdate = true;
    geometry.attributes.position!.needsUpdate = true;
    geometry.attributes.color!.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} material={material} frustumCulled={false} />
  );
}

const UP = new Vector3(0, 1, 0);

/** The lock-on: a crackling beam from the actor to its target, and a reticle on the target. */
function LockBeam({ director }: { readonly director: ArenaDirector }) {
  const core = useRef<Mesh>(null);
  const sheath = useRef<Mesh>(null);
  const reticle = useRef<Group>(null);
  const a = useMemo(() => new Vector3(), []);
  const b = useMemo(() => new Vector3(), []);
  const q = useMemo(() => new Quaternion(), []);

  useFrame(() => {
    const lock = director.lock;
    const now = director.now();
    const on = lock !== null && now < lock.until;
    for (const m of [core.current, sheath.current]) if (m) m.visible = on;
    if (reticle.current) reticle.current.visible = on;
    if (!on || !lock) return;
    const from = director.robotFloor(lock.from);
    const to: P2 = lock.to === 'centre' ? SPOT.centre : director.robotFloor(lock.to);
    a.set(from.x, 1.35 * BOT_SCALE, from.z);
    b.set(to.x, lock.to === 'centre' ? REACTOR_TOP : 1.1 * BOT_SCALE, to.z);
    const grow = clamp01((now - lock.start) / 350);
    b.lerpVectors(a, b, grow);
    const length = a.distanceTo(b);
    const dir = b.clone().sub(a).normalize();
    q.setFromUnitVectors(UP, dir);
    const flicker = 0.75 + hash01(Math.floor(now / 45)) * 0.5;
    for (const [m, w] of [
      [core.current, 1],
      [sheath.current, flicker],
    ] as const) {
      if (!m) continue;
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.copy(q);
      m.scale.set(w, length, w);
    }
    if (reticle.current) {
      reticle.current.position.set(to.x, 0.3, to.z);
      reticle.current.rotation.y = now / 400;
      const pulse = 1 + Math.sin(now / 90) * 0.06;
      reticle.current.scale.setScalar((lock.to === 'centre' ? 1.5 : 1.1) * pulse * (2 - grow));
    }
  });

  const colourOf = director.lock ? LANE_COLOR[director.lock.from] : '#ffffff';
  return (
    <>
      <mesh ref={core} visible={false}>
        <cylinderGeometry args={[0.025, 0.025, 1, 8, 1, true]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      <mesh ref={sheath} visible={false}>
        <cylinderGeometry args={[0.11, 0.11, 1, 12, 1, true]} />
        <LockColour director={director} fallback={colourOf} opacity={0.35} />
      </mesh>
      <group ref={reticle} visible={false}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, (i * Math.PI) / 2]}>
            <ringGeometry args={[0.9, 1.0, 24, 1, 0.2, Math.PI / 2 - 0.4]} />
            <LockColour director={director} fallback={colourOf} opacity={0.9} />
          </mesh>
        ))}
      </group>
    </>
  );
}

/** A material that takes the colour of whoever holds the lock. */
function LockColour({ director, fallback, opacity }: { readonly director: ArenaDirector; readonly fallback: string; readonly opacity: number }) {
  const mat = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    if (mat.current && director.lock) mat.current.color.set(LANE_COLOR[director.lock.from]);
  });
  return <meshBasicMaterial ref={mat} color={fallback} transparent opacity={opacity} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />;
}

/** The holo terminal a robot types at while its model works a challenge. */
function Terminal({ director }: { readonly director: ArenaDirector }) {
  const group = useRef<Group>(null);
  const tex = useMemo(() => holoTexture(), []);
  useEffect(() => () => tex.dispose(), [tex]);
  const mat = useRef<MeshBasicMaterial>(null);
  const frame = useRef<MeshBasicMaterial>(null);

  useFrame(() => {
    const g = group.current;
    const who = director.charging;
    if (!g) return;
    g.visible = who !== null;
    if (who === null) return;
    const now = director.now();
    const robot = director.robots[who];
    const pos = director.robotFloor(who);
    const target: P2 = robot.face === 'centre' || robot.face === 'camera' ? SPOT.centre : director.robotFloor(robot.face);
    const yaw = yawToward([pos.x, pos.z], [target.x, target.z]);
    const open = director.reduced ? 1 : easeInOut(clamp01((now - director.chargingAt) / 300));
    g.position.set(pos.x + Math.sin(yaw) * 0.85, 1.25 + Math.sin(now / 500) * 0.03, pos.z + Math.cos(yaw) * 0.85);
    g.rotation.set(0, yaw, 0);
    g.scale.set(open, open * (0.9 + 0.1 * open), 1);
    tex.offset.y = -now / 2400;
    const colour = LANE_COLOR[who];
    mat.current?.color.set(colour);
    frame.current?.color.set(colour);
    if (mat.current) mat.current.opacity = 0.88 + hash01(Math.floor(now / 70)) * 0.1;
  });

  return (
    <group ref={group} visible={false}>
      <mesh rotation={[-0.35, 0, 0]}>
        <planeGeometry args={[1.15, 0.72]} />
        <meshBasicMaterial ref={mat} map={tex} transparent side={DoubleSide} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* The projector beam, from the floor to the glass. */}
      <mesh position={[0, -0.62, 0.1]}>
        <coneGeometry args={[0.55, 0.9, 4, 1, true]} />
        <meshBasicMaterial ref={frame} transparent opacity={0.08} side={DoubleSide} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Shockwave rings along the floor. */
function Rings({ director }: { readonly director: ArenaDirector }) {
  const meshes = useRef<(Mesh | null)[]>([]);
  useFrame(() => {
    const now = director.now();
    const live = director.rings.filter((r) => now - r.start < r.ms).slice(-8);
    meshes.current.forEach((m, i) => {
      if (!m) return;
      const r = live[i];
      m.visible = r !== undefined;
      if (!r) return;
      const k = clamp01((now - r.start) / r.ms);
      const radius = 0.3 + r.radius * (1 - (1 - k) ** 3);
      m.position.set(r.at.x, 0.06, r.at.z);
      m.scale.setScalar(radius);
      const mat = m.material as MeshBasicMaterial;
      mat.color.set(r.color);
      mat.opacity = (1 - k) * 0.9;
    });
  });
  return (
    <>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} ref={(m) => void (meshes.current[i] = m)} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.9, 1, 64]} />
          <meshBasicMaterial transparent side={DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </>
  );
}

// ── The canvas ────────────────────────────────────────────────────────────

function Scene({ director, high }: { readonly director: ArenaDirector; readonly high: boolean }) {
  const particles = useParticles(high);
  return (
    <>
      <color attach="background" args={['#0c1634']} />
      <fog attach="fog" args={['#0f1a3c', 70, 280]} />
      {high && (
        <Environment resolution={128} frames={1}>
          {/* A night sky to reflect: dim blue overhead, the moon, and a little warm lantern light low down. */}
          <Lightformer form="rect" intensity={0.35} color="#3a4f8f" position={[0, 14, 0]} rotation-x={Math.PI / 2} scale={[50, 50, 1]} />
          <Lightformer form="circle" intensity={3} color="#d6e0ff" position={MOON} scale={4} />
          <Lightformer form="rect" intensity={0.3} color="#ffb76b" position={[0, 1.5, -12]} scale={[30, 2, 1]} />
        </Environment>
      )}
      {/* Moonlight bright enough to read every robot clearly: a cool key over the camera's shoulder, generous sky fill, and a rim from behind. */}
      <hemisphereLight args={['#7d90cc', '#26304f', high ? 0.95 : 1.8]} />
      <directionalLight
        position={MOON}
        intensity={high ? 1.9 : 1.8}
        color="#c9d6ff"
        castShadow={high}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.0003}
        shadow-normalBias={0.03}
        shadow-radius={5}
      />
      {high && <directionalLight position={[6, 9, -16]} intensity={1.0} color="#8fa6ff" />}
      <SkyIslands director={director} high={high} />
      <Shrine director={director} />
      {PLAYERS.map((p) => (
        <Pad key={p} director={director} id={p} />
      ))}
      {PLAYERS.map((p) => (
        <Bot key={p} director={director} id={p} colour={LANE_COLOR[p]} high={high} />
      ))}
      <Cores director={director} spawn={particles.spawn} />
      <LockBeam director={director} />
      <Terminal director={director} />
      <Rings director={director} />
      <Particles director={director} high={high} particles={particles} />
      <CameraRig director={director} />
      {high && <PostFX />}
    </>
  );
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

function qualityOf(gl: WebGLRenderer): Quality {
  const context = gl.getContext();
  const info = context.getExtension('WEBGL_debug_renderer_info');
  const name = info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
  return typeof name === 'string' && SOFTWARE_RENDERER.test(name) ? 'low' : 'high';
}

/** On the low tier, a frame on every third animation frame. */
function HalfRate() {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let frame = 0;
    let count = 0;
    const tick = () => {
      count = (count + 1) % 3;
      if (count === 0) invalidate();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [invalidate]);
  return null;
}

export default function Arena3D({ director }: { readonly director: ArenaDirector }) {
  // Nothing is drawn until the renderer is known: building the high tier first
  // would compile its shaders on a software rasteriser for nothing.
  const [quality, setQuality] = useState<Quality | null>(null);
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={quality === 'high' ? 'always' : 'demand'}
      shadows={quality === 'high' ? 'soft' : false}
      onCreated={({ gl, setDpr }) => {
        const tier = qualityOf(gl);
        // Every pixel is shaded on the CPU on the low tier: draw a quarter of them.
        if (tier === 'low') setDpr(0.5);
        setQuality(tier);
      }}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
      style={{ position: 'absolute', inset: 0 }}
      data-testid="arena-canvas"
    >
      {quality === 'low' && <HalfRate />}
      {quality !== null && <Scene director={director} high={quality === 'high'} />}
    </Canvas>
  );
}
