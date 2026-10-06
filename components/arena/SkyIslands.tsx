'use client';

import { Stars } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Group,
  type Mesh,
  type Sprite,
} from 'three';
import { discTexture, hash01, shade } from '@/components/scene/look';
import { LETTER, type PlayerId } from './choreography';
import { LANE_COLOR, PLAYERS, SPOT, type ArenaDirector, type P2 } from './director';

/**
 * The arena as a floating archipelago: a grassy island for each player, a
 * larger central island with the shrine that holds the reserve cores, rope
 * bridges between them (the robots walk across them), all at night: a starry
 * sky with the Milky Way and the moon, moonlit clouds far below, distant
 * islands with waterfalls, lanterns on the islands and fireflies.
 *
 * Built for legibility first: bright cool moonlight on the play, a calm
 * background, and glow kept to small accents — cores, eyes, lanterns.
 *
 * Deterministic like the rest of the arena — shapes and scatter from a fixed
 * hash, motion from the director's clock. The low tier (a software
 * rasteriser) draws the islands, bridges, pads and shrine only.
 */

/** Island radii: where the robots stand is flat grass at y = 0. */
export const ISLAND_R = 2.35;
export const CENTRE_R = 2.25;
const DEPTH = 3.6;

// ── Textures ──────────────────────────────────────────────────────────────

function paint(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): CanvasTexture {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  draw(el.getContext('2d')!);
  const tex = new CanvasTexture(el);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = RepeatWrapping;
    tex.wrapT = RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

function grassTexture(): CanvasTexture {
  return paint(
    256,
    256,
    (g) => {
      g.fillStyle = '#6fa548';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5000; i++) {
        const x = hash01(i * 3 + 1) * 256;
        const y = hash01(i * 3 + 2) * 256;
        const t = hash01(i * 3 + 3);
        g.strokeStyle = `rgba(${70 + t * 60},${120 + t * 70},${40 + t * 30},0.8)`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (hash01(i + 9) - 0.5) * 3, y - 3 - t * 4);
        g.stroke();
      }
    },
    [3, 3],
  );
}

/** Pale flagstones in rings, for the shrine and the player pads. */
function stoneTexture(): CanvasTexture {
  return paint(512, 512, (g) => {
    g.fillStyle = '#cfc8ba';
    g.fillRect(0, 0, 512, 512);
    const cx = 256;
    for (let ring = 0; ring < 5; ring++) {
      const r0 = 40 + ring * 46;
      const r1 = r0 + 46;
      const n = 6 + ring * 5;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1) / n) * Math.PI * 2;
        const tone = (hash01(ring * 50 + k) - 0.5) * 26;
        g.fillStyle = `rgb(${205 + tone},${198 + tone},${184 + tone})`;
        g.beginPath();
        g.arc(cx, cx, r1 - 2, a0 + 0.01, a1 - 0.01);
        g.arc(cx, cx, r0 + 2, a1 - 0.01, a0 + 0.01, true);
        g.closePath();
        g.fill();
      }
    }
    g.fillStyle = '#d8d1c3';
    g.beginPath();
    g.arc(cx, cx, 38, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 2500; i++) {
      g.fillStyle = `rgba(0,0,0,${0.03 + hash01(i + 7) * 0.05})`;
      g.fillRect(hash01(i * 2) * 512, hash01(i * 2 + 1) * 512, 2, 2);
    }
  });
}

function woodTexture(): CanvasTexture {
  return paint(
    128,
    32,
    (g) => {
      g.fillStyle = '#9a7048';
      g.fillRect(0, 0, 128, 32);
      for (let i = 0; i < 30; i++) {
        g.strokeStyle = `rgba(60,35,15,${0.15 + hash01(i) * 0.2})`;
        g.lineWidth = 1;
        const y = hash01(i + 40) * 32;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(40, y + 2, 80, y - 2, 128, y + 1);
        g.stroke();
      }
    },
  );
}

/** The night sky, equirectangular: deep blue overhead, a softer blue at the horizon, the Milky Way across it, and stars. */
function skyTexture(): CanvasTexture {
  return paint(2048, 1024, (g) => {
    const w = 2048;
    const h = 1024;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#040814');
    grad.addColorStop(0.3, '#0a1430');
    grad.addColorStop(0.46, '#1b2d5e');
    grad.addColorStop(0.5, '#25386c');
    grad.addColorStop(0.56, '#18264f');
    grad.addColorStop(1, '#0c1532');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // The Milky Way: a soft diagonal band of haze and dense faint stars.
    g.save();
    g.translate(w * 0.5, h * 0.28);
    g.rotate(-0.3);
    for (let i = 0; i < 240; i++) {
      const x = (hash01(i * 3 + 1) - 0.5) * w * 1.3;
      const y = (hash01(i * 3 + 2) - 0.5) * 130 * (0.6 + hash01(i + 7));
      const r = 30 + hash01(i * 3 + 3) * 90;
      const neb = g.createRadialGradient(x, y, 0, x, y, r);
      const tint = hash01(i + 40) > 0.7 ? '160,130,210' : '140,165,230';
      neb.addColorStop(0, `rgba(${tint},0.06)`);
      neb.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = neb;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 7000; i++) {
      const x = (hash01(i * 2 + 900) - 0.5) * w * 1.3;
      const y = (hash01(i * 2 + 901) + hash01(i * 2 + 902) - 1) * 100;
      g.fillStyle = `rgba(255,255,255,${0.15 + hash01(i + 5000) * 0.4})`;
      g.fillRect(x, y, 1, 1);
    }
    g.restore();
    for (let i = 0; i < 3000; i++) {
      const b = hash01(i + 9000);
      g.fillStyle = `rgba(${225 + b * 30},${230 + b * 25},255,${0.25 + b * 0.75})`;
      const s = b > 0.97 ? 2 : 1;
      g.fillRect(hash01(i * 2 + 1) * w, hash01(i * 2 + 2) * h, s, s);
    }
  });
}

function moonTexture(): CanvasTexture {
  return paint(256, 256, (g) => {
    const body = g.createRadialGradient(110, 110, 10, 128, 128, 120);
    body.addColorStop(0, '#fffbea');
    body.addColorStop(0.8, '#e9e4d2');
    body.addColorStop(1, '#cfc9b6');
    g.fillStyle = body;
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.clip();
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(150,145,130,${i < 8 ? 0.28 : 0.35})`;
      g.beginPath();
      g.arc(30 + hash01(i * 3 + 1) * 196, 30 + hash01(i * 3 + 2) * 196, 4 + hash01(i * 3 + 3) * (i < 8 ? 34 : 10), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  });
}

function cloudTexture(): CanvasTexture {
  return paint(256, 128, (g) => {
    for (let i = 0; i < 26; i++) {
      const x = 40 + hash01(i * 3) * 176;
      const y = 50 + hash01(i * 3 + 1) * 40 - (Math.abs(x - 128) / 128) * 12;
      const r = 16 + hash01(i * 3 + 2) * 32;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.6, 'rgba(250,252,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
    }
  });
}

function fallTexture(): CanvasTexture {
  return paint(
    64,
    256,
    (g) => {
      g.clearRect(0, 0, 64, 256);
      for (let i = 0; i < 70; i++) {
        const x = hash01(i) * 64;
        const y = hash01(i + 100) * 256;
        const len = 30 + hash01(i + 200) * 80;
        const grad = g.createLinearGradient(0, y, 0, y + len);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.5, `rgba(255,255,255,${0.5 + hash01(i + 300) * 0.5})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x, y, 2 + hash01(i + 400) * 3, len);
      }
    },
    [1, 1],
  );
}

function flagTexture(colour: string, letter: string): CanvasTexture {
  return paint(256, 160, (g) => {
    g.fillStyle = colour;
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillRect(0, 0, 256, 16);
    g.fillStyle = '#ffffff';
    g.font = 'bold 110px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 128, 88);
  });
}

function useTex(make: () => CanvasTexture): CanvasTexture {
  const tex = useMemo(make, [make]);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

// ── Shapes ────────────────────────────────────────────────────────────────

/** An island's rocky underside: an upside-down cone, its surface broken up by a fixed hash. */
function undersideGeometry(radius: number, depth: number, seed: number): BufferGeometry {
  const g = new ConeGeometry(radius, depth, 40, 10, true);
  g.rotateX(Math.PI);
  g.translate(0, -depth / 2 - 0.28, 0);
  const pos = g.attributes.position!;
  const colours = new Float32Array(pos.count * 3);
  const dirt = new Color('#7b5a3c');
  const rock = new Color('#8a8f98');
  const dark = new Color('#5b5f68');
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = Math.min(1, Math.max(0, (-0.28 - y) / depth));
    const a = Math.atan2(z, x);
    const key = Math.round(a * 30) * 7919 + Math.round(t * 20) * 104729 + seed * 31;
    const n = hash01(key) - 0.5;
    const bulge = t > 0.02 && t < 0.98 ? 1 + n * 0.32 + Math.sin(a * 3 + seed) * 0.08 : 1;
    pos.setXYZ(i, x * bulge, y + n * 0.25 * t, z * bulge);
    c.copy(dirt).lerp(rock, Math.min(1, t * 1.8)).lerp(dark, Math.max(0, t - 0.55) * 1.2);
    c.offsetHSL(0, 0, n * 0.06);
    colours[i * 3] = c.r;
    colours[i * 3 + 1] = c.g;
    colours[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(colours, 3));
  g.computeVertexNormals();
  return g;
}

function foliage(radius: number, seed: number): BufferGeometry {
  const geo = new IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position!;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = (Math.round(v.x * 40) * 73856093) ^ (Math.round(v.y * 40) * 19349663) ^ (Math.round(v.z * 40) * 83492791);
    v.multiplyScalar(1 + (hash01(key + seed) - 0.5) * 0.22);
    v.y *= 0.85;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function Rod({ from, to, radius, color }: { readonly from: readonly [number, number, number]; readonly to: readonly [number, number, number]; readonly radius: number; readonly color: string }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const dir = b.clone().sub(a);
    const o = new Object3D();
    o.position.copy(a).add(b).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
    return { position: o.position, quaternion: o.quaternion, length: dir.length() };
  }, [from, to]);
  return (
    <mesh position={position} quaternion={quaternion} castShadow>
      <cylinderGeometry args={[radius, radius, length, 8]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
    </mesh>
  );
}

// ── Islands ───────────────────────────────────────────────────────────────

interface IslandProps {
  readonly at: P2;
  readonly radius: number;
  readonly seed: number;
  readonly crystal: string;
  readonly grass: CanvasTexture;
  readonly high: boolean;
  /** Which way is "behind" (away from the camera and the centre), for trees that never block the view. */
  readonly back: P2;
  /** False on the island nearest the camera: a tree there would stand in front of the play. */
  readonly tree?: boolean;
}

function Island({ at, radius, seed, crystal, grass, high, back, tree = true }: IslandProps) {
  const under = useMemo(() => undersideGeometry(radius * 1.02, DEPTH * (radius / 2.3), seed), [radius, seed]);
  useEffect(() => () => under.dispose(), [under]);
  const leaf = useMemo(() => foliage(0.9, seed), [seed]);
  useEffect(() => () => leaf.dispose(), [leaf]);
  const vines = useMemo(
    () =>
      Array.from({ length: high ? 14 : 0 }, (_, i) => {
        const a = hash01(seed * 100 + i) * Math.PI * 2;
        return { x: Math.cos(a) * radius * 0.98, z: Math.sin(a) * radius * 0.98, len: 0.6 + hash01(seed * 100 + i + 50) * 1.8 };
      }),
    [seed, radius, high],
  );
  const crystals = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => {
        const a = (i / 4) * Math.PI * 2 + seed;
        return { x: Math.cos(a) * radius * 0.45, z: Math.sin(a) * radius * 0.45, y: -1.2 - hash01(seed + i) * 1.2, s: 0.25 + hash01(seed + i + 9) * 0.25 };
      }),
    [seed, radius],
  );
  const backAngle = Math.atan2(back.z, back.x);
  return (
    <group position={[at.x, 0, at.z]}>
      {/* Turf on top, a grassy lip, and the rock beneath. */}
      <mesh position={[0, -0.14, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[radius, radius * 1.02, 0.28, 48]} />
        <meshStandardMaterial map={grass} roughness={0.95} />
      </mesh>
      <mesh geometry={under} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.95} flatShading={!high} />
      </mesh>
      {vines.map((v, i) => (
        <mesh key={i} position={[v.x, -0.28 - v.len / 2, v.z]}>
          <cylinderGeometry args={[0.025, 0.012, v.len, 4]} />
          <meshStandardMaterial color="#4f7d33" roughness={0.9} />
        </mesh>
      ))}
      {crystals.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]} rotation={[Math.PI, 0, 0.2]} scale={[c.s, c.s * 2.2, c.s]}>
          <octahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={crystal} emissive={crystal} emissiveIntensity={1.1} roughness={0.2} metalness={0.1} />
        </mesh>
      ))}
      {high && (
        <>
          {/* A tree and some bushes on the far side, clear of the play area. */}
          {tree && (
          <group position={[Math.cos(backAngle + 0.5) * radius * 0.72, 0, Math.sin(backAngle + 0.5) * radius * 0.72]}>
            <mesh position={[0, 0.8, 0]} castShadow>
              <cylinderGeometry args={[0.09, 0.14, 1.6, 8]} />
              <meshStandardMaterial color="#6b4a30" roughness={0.9} />
            </mesh>
            <mesh geometry={leaf} position={[0, 2.0, 0]} castShadow receiveShadow>
              <meshStandardMaterial color={shade('#4f8a35', (hash01(seed) - 0.5) * 0.2)} roughness={0.9} />
            </mesh>
          </group>
          )}
          {[-0.4, 0.15].map((da, i) => (
            <mesh key={i} geometry={leaf} position={[Math.cos(backAngle + da) * radius * 0.85, 0.15, Math.sin(backAngle + da) * radius * 0.85]} scale={0.42} castShadow>
              <meshStandardMaterial color="#5b9640" roughness={0.9} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}

/** A plank bridge with rope rails between two islands' edges. */
function Bridge({ from, to, wood }: { readonly from: P2; readonly to: P2; readonly wood: CanvasTexture }) {
  const { planks, posts, rails } = useMemo(() => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const yaw = Math.atan2(dx, dz);
    const planks: { x: number; z: number; tone: number }[] = [];
    const n = Math.max(2, Math.round(len / 0.34));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      planks.push({ x: from.x + dx * t, z: from.z + dz * t, tone: (hash01(i + Math.round(from.x * 13)) - 0.5) * 0.25 });
    }
    const side = (s: number): P2 => ({ x: -uz * 0.62 * s, z: ux * 0.62 * s });
    const posts: [number, number][] = [];
    const rails: CatmullRomCurve3[] = [];
    for (const s of [-1, 1]) {
      const o = side(s);
      posts.push([from.x + o.x, from.z + o.z], [to.x + o.x, to.z + o.z]);
      const pts = Array.from({ length: 13 }, (_, i) => {
        const t = i / 12;
        return new Vector3(from.x + dx * t + o.x, 0.78 - Math.sin(t * Math.PI) * 0.18, from.z + dz * t + o.z);
      });
      rails.push(new CatmullRomCurve3(pts));
    }
    return { planks: planks.map((p) => ({ ...p, yaw })), posts, rails };
  }, [from, to]);
  return (
    <group>
      {planks.map((p, i) => (
        <mesh key={i} position={[p.x, -0.05, p.z]} rotation={[0, p.yaw, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.25, 0.08, 0.28]} />
          <meshStandardMaterial map={wood} color={shade('#ffffff', p.tone)} roughness={0.85} />
        </mesh>
      ))}
      {posts.map(([x, z], i) => (
        <mesh key={i} position={[x, 0.4, z]} castShadow>
          <cylinderGeometry args={[0.06, 0.07, 0.85, 8]} />
          <meshStandardMaterial color="#6b4a30" roughness={0.9} />
        </mesh>
      ))}
      {rails.map((r, i) => (
        <mesh key={i} castShadow>
          <tubeGeometry args={[r, 24, 0.02, 5, false]} />
          <meshStandardMaterial color="#c9a774" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** Edge points for a bridge between two island centres. */
function span(a: P2, ra: number, b: P2, rb: number): [P2, P2] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  return [
    { x: a.x + ux * (ra - 0.35), z: a.z + uz * (ra - 0.35) },
    { x: b.x - ux * (rb - 0.35), z: b.z - uz * (rb - 0.35) },
  ];
}

// ── The shrine and the pads ───────────────────────────────────────────────

/** The centre: a stone platform with a ring of runes turning round the pedestal where the reserve floats. */
export function Shrine({ director }: { readonly director: ArenaDirector }) {
  const stone = useTex(stoneTexture);
  const ring = useRef<Group>(null);
  const angle = useRef(0);
  useFrame((_, dt) => {
    const claiming = director.lock?.to === 'centre' ? 1 : 0;
    if (!director.reduced) angle.current += Math.min(dt, 0.05) * (0.25 + claiming * 1.4);
    if (ring.current) ring.current.rotation.y = angle.current;
  });
  return (
    <group>
      <mesh position={[0, 0.07, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[1.75, 1.85, 0.14, 48]} />
        <meshStandardMaterial color="#bdb5a6" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.142, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.72, 48]} />
        <meshStandardMaterial map={stone} roughness={0.9} />
      </mesh>
      {/* Pedestal and the bowl the cores float over. */}
      <mesh position={[0, 0.75, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.32, 0.45, 1.2, 12]} />
        <meshStandardMaterial color="#d6cfc1" roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.42, 0]} castShadow>
        <cylinderGeometry args={[0.62, 0.3, 0.22, 24]} />
        <meshStandardMaterial color="#c9a14a" metalness={0.75} roughness={0.3} />
      </mesh>
      <group ref={ring} position={[0, 1.05, 0]}>
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(a) * 1.35, Math.sin(a * 2) * 0.05, Math.cos(a) * 1.35]} rotation={[0, a, 0]} castShadow>
              <boxGeometry args={[0.28, 0.4, 0.08]} />
              <meshStandardMaterial color="#e6dfd0" emissive="#f2c45c" emissiveIntensity={0.9} roughness={0.7} />
            </mesh>
          );
        })}
      </group>
      {/* Four low standing stones at the rim. */}
      {[0.4, 2.0, 3.55, 5.1].map((a) => (
        <mesh key={a} position={[Math.sin(a) * 1.95, 0.45, Math.cos(a) * 1.95]} rotation={[0, a, 0.05]} castShadow receiveShadow>
          <boxGeometry args={[0.35, 0.9, 0.3]} />
          <meshStandardMaterial color="#a9a294" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

/** A player's pad: a stone disc inlaid with their colour, a flag, a turn marker and the shield dome. */
export function Pad({ director, id }: { readonly director: ArenaDirector; readonly id: PlayerId }) {
  const s = SPOT[id];
  const colour = LANE_COLOR[id];
  const stone = useTex(stoneTexture);
  const flagTex = useMemo(() => flagTexture(colour, LETTER[id]), [colour, id]);
  useEffect(() => () => flagTex.dispose(), [flagTex]);
  const top = useMemo(() => new MeshStandardMaterial({ map: stone, roughness: 0.9, emissive: '#ff3030', emissiveIntensity: 0 }), [stone]);
  const inlay = useMemo(() => new MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.15, roughness: 0.5 }), [colour]);
  const flagMat = useMemo(() => new MeshStandardMaterial({ map: flagTex, roughness: 0.8, side: DoubleSide }), [flagTex]);
  const gem = useMemo(() => new MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.8, roughness: 0.2 }), [colour]);
  const dome = useMemo(() => new MeshStandardMaterial({ color: shade(colour, 0.4), transparent: true, opacity: 0, side: DoubleSide, depthWrite: false, roughness: 0.2 }), [colour]);
  const domeWire = useMemo(() => new MeshStandardMaterial({ color: shade(colour, 0.2), transparent: true, opacity: 0, wireframe: true, depthWrite: false }), [colour]);
  useEffect(() => () => [top, inlay, flagMat, gem, dome, domeWire].forEach((m) => m.dispose()), [top, inlay, flagMat, gem, dome, domeWire]);

  const flagGeo = useMemo(() => new PlaneGeometry(1.05, 0.68, 14, 6), []);
  const flagRest = useMemo(() => Float32Array.from(flagGeo.attributes.position!.array), [flagGeo]);
  useEffect(() => () => flagGeo.dispose(), [flagGeo]);
  const flagGroup = useRef<Group>(null);
  const marker = useRef<Group>(null);
  const domeGroup = useRef<Group>(null);
  const tint = useMemo(() => ({ live: new Color('#ffffff'), dead: new Color('#8a8e96'), lane: new Color(colour), grey: new Color('#7b7f88') }), [colour]);

  // The flag stands on the island's far side, away from the shrine and the camera.
  const out = Math.hypot(s.x, s.z) || 1;
  const away = s.z / out > 0.5 ? { x: 0.8, z: -0.6 } : { x: s.x / out, z: s.z / out };
  const pole: [number, number] = [s.x + away.x * 1.55, s.z + away.z * 1.55];

  useFrame(() => {
    const real = director.now();
    const now = director.reduced ? 0 : real;
    const isOut = director.out.has(id);
    const active = director.active === id;
    const won = director.winners.includes(id);
    const flash = director.flashes[id];
    const flashK = flash ? Math.max(0, 1 - (real - flash.at) / 800) : 0;
    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    top.color.copy(isOut ? tint.dead : tint.live);
    top.emissiveIntensity = flashK * 0.8;
    inlay.color.copy(isOut ? tint.grey : tint.lane);
    inlay.emissive.copy(isOut ? tint.grey : tint.lane);
    inlay.emissiveIntensity = isOut ? 0 : won ? 0.6 + pulse * 0.4 : active ? 0.3 + pulse * 0.35 : 0.12;
    flagMat.color.copy(isOut ? tint.dead : tint.live);

    const pos = flagGeo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const x = flagRest[i * 3]!;
      const y = flagRest[i * 3 + 1]!;
      const k = (x + 0.525) / 1.05;
      pos.setZ(i, Math.sin(x * 5 - now / 200) * 0.08 * k + Math.sin(y * 4 + now / 320) * 0.02 * k);
    }
    pos.needsUpdate = true;
    flagGeo.computeVertexNormals();
    if (flagGroup.current) flagGroup.current.position.y = isOut ? 1.7 : 2.85;

    if (marker.current) {
      marker.current.visible = (active || won) && !isOut;
      marker.current.position.y = 3.4 + Math.sin(now / 300) * 0.12;
      marker.current.rotation.y = now / 500;
    }
    const shieldAt = director.shields[id];
    const since = shieldAt === undefined ? Infinity : real - shieldAt;
    const on = since < 250 ? since / 250 : since < 1900 ? 1 : Math.max(0, 1 - (since - 1900) / 400);
    dome.opacity = on * 0.22;
    domeWire.opacity = on * 0.5;
    if (domeGroup.current) {
      domeGroup.current.visible = on > 0.01;
      domeGroup.current.scale.setScalar(0.8 + 0.2 * Math.min(1, since / 250));
      domeGroup.current.rotation.y = real / 2000;
    }
  });

  return (
    <>
      <group position={[s.x, 0, s.z]}>
        <mesh position={[0, 0.05, 0]} material={top} receiveShadow castShadow>
          <cylinderGeometry args={[1.62, 1.68, 0.1, 48]} />
        </mesh>
        <mesh position={[0, 0.102, 0]} rotation={[-Math.PI / 2, 0, 0]} material={inlay}>
          <ringGeometry args={[1.38, 1.5, 48]} />
        </mesh>
        <group ref={marker} visible={false}>
          <mesh material={gem} castShadow scale={[1, 1.5, 1]}>
            <octahedronGeometry args={[0.22, 0]} />
          </mesh>
        </group>
        <group ref={domeGroup} visible={false}>
          <mesh material={dome}>
            <sphereGeometry args={[1.75, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh material={domeWire}>
            <icosahedronGeometry args={[1.78, 2]} />
          </mesh>
        </group>
      </group>
      <group position={[pole[0], 0, pole[1]]}>
        <Rod from={[0, 0, 0]} to={[0, 3.3, 0]} radius={0.035} color="#e5e1d8" />
        <group ref={flagGroup} position={[0, 2.85, 0]} rotation={[0, Math.atan2(s.x, s.z) + Math.PI / 2, 0]}>
          <mesh geometry={flagGeo} material={flagMat} position={[0.55, 0, 0]} castShadow />
        </group>
      </group>
    </>
  );
}

// ── The sky ───────────────────────────────────────────────────────────────

function SkyDome() {
  const tex = useTex(skyTexture);
  return (
    <mesh rotation={[0, -0.5, 0]}>
      <sphereGeometry args={[480, 48, 24]} />
      <meshBasicMaterial map={tex} side={BackSide} fog={false} depthWrite={false} />
    </mesh>
  );
}

/** The moon, low over the far islands: a disc and a soft halo, kept small so it never glares. */
function Moon() {
  const tex = useTex(moonTexture);
  const glow = useMemo(() => discTexture(), []);
  useEffect(() => () => glow.dispose(), [glow]);
  return (
    <group position={[-34, 30, -150]}>
      <sprite scale={26}>
        <spriteMaterial map={glow} color="#7f97d8" transparent opacity={0.3} depthWrite={false} blending={AdditiveBlending} fog={false} />
      </sprite>
      <sprite scale={8}>
        <spriteMaterial map={tex} color="#fffaf0" fog={false} />
      </sprite>
    </group>
  );
}

/** Fireflies drifting low over the islands, blinking slowly. */
function Fireflies({ director }: { readonly director: ArenaDirector }) {
  const refs = useRef<(Mesh | null)[]>([]);
  const flies = useMemo(
    () =>
      [...PLAYERS.map((p) => SPOT[p]), SPOT.centre].flatMap((c, k) =>
        Array.from({ length: 7 }, (_, i) => ({ x: c.x, z: c.z, seed: k * 10 + i })),
      ),
    [],
  );
  const mat = useMemo(() => new MeshBasicMaterial({ color: new Color('#e6ff8a').multiplyScalar(1.6), toneMapped: false, transparent: true }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const t = director.reduced ? 0 : director.now() / 1000;
    refs.current.forEach((m, i) => {
      const f = flies[i]!;
      if (!m) return;
      const a = t * 0.25 + hash01(f.seed) * 6.3;
      const r = 1.9 + hash01(f.seed + 1) * 0.8;
      m.position.set(f.x + Math.cos(a) * r, 0.6 + hash01(f.seed + 2) * 1.6 + Math.sin(t * 0.7 + f.seed) * 0.25, f.z + Math.sin(a * 1.2) * r);
      m.scale.setScalar(0.5 + 0.5 * Math.max(0, Math.sin(t * (0.8 + hash01(f.seed + 3)) + f.seed * 4)));
    });
  });
  return (
    <>
      {flies.map((_, i) => (
        <mesh key={i} ref={(m) => void (refs.current[i] = m)} material={mat}>
          <sphereGeometry args={[0.04, 6, 4]} />
        </mesh>
      ))}
    </>
  );
}

/** A lantern on a post at each island's edge: a warm pool of light, no halo. */
function Lantern({ at, high }: { readonly at: P2; readonly high: boolean }) {
  return (
    <group position={[at.x, 0, at.z]}>
      <Rod from={[0, 0, 0]} to={[0, 1.5, 0]} radius={0.04} color="#3b3328" />
      <mesh position={[0, 1.62, 0]}>
        <boxGeometry args={[0.2, 0.26, 0.2]} />
        <meshStandardMaterial color="#fff1cc" emissive="#ffb85c" emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.8, 0]}>
        <coneGeometry args={[0.18, 0.14, 4]} />
        <meshStandardMaterial color="#3b3328" roughness={0.7} />
      </mesh>
      {high && <pointLight position={[0, 1.6, 0]} color="#ffb76b" intensity={5} distance={5.5} decay={2} />}
    </group>
  );
}

/** Soft cloud puffs drifting at and below island height, kept away from the play area. */
function Puffs({ director }: { readonly director: ArenaDirector }) {
  const tex = useTex(cloudTexture);
  const refs = useRef<(Sprite | null)[]>([]);
  const puffs = useMemo(
    () =>
      Array.from({ length: 34 }, (_, i) => {
        // All round and well below the islands, so they drift past without crossing the play.
        const a = hash01(i) * Math.PI * 2;
        const r = 18 + hash01(i + 20) * 70;
        const x = Math.sin(a) * r;
        const z = Math.cos(a) * r - 10;
        // Under the camera's line of sight a cloud would sit in front of the play: sink those far below.
        const inView = Math.abs(x) < 24 && z > -8;
        return { x, y: (inView ? -34 : -12) - hash01(i + 40) * 18, z, s: 14 + hash01(i + 60) * 22, speed: 0.4 + hash01(i + 80) * 0.5 };
      }),
    [],
  );
  useFrame(() => {
    const t = director.reduced ? 0 : director.now() / 1000;
    refs.current.forEach((s, i) => {
      const p = puffs[i]!;
      if (s) s.position.set(p.x + Math.sin(t * 0.02 * p.speed + i) * 6, p.y, p.z);
    });
  });
  return (
    <>
      {puffs.map((p, i) => (
        <sprite key={i} ref={(s) => void (refs.current[i] = s)} scale={[p.s, p.s * 0.45, 1]}>
          <spriteMaterial map={tex} color="#7b8cc0" transparent opacity={0.75} depthWrite={false} fog={false} />
        </sprite>
      ))}
    </>
  );
}

const DISTANT: readonly { readonly x: number; readonly y: number; readonly z: number; readonly r: number; readonly fall: boolean }[] = [
  { x: -38, y: 4, z: -52, r: 7, fall: true },
  { x: 30, y: 9, z: -64, r: 9, fall: true },
  { x: -70, y: -3, z: -30, r: 6, fall: false },
  { x: 62, y: 1, z: -26, r: 5, fall: false },
  { x: 4, y: 15, z: -95, r: 12, fall: false },
  { x: -22, y: -6, z: -78, r: 4, fall: false },
  { x: 46, y: -4, z: -90, r: 6, fall: false },
];

/** Far-off islands, each with a few trees; two pour waterfalls into the clouds. */
function DistantIslands({ director }: { readonly director: ArenaDirector }) {
  const water = useTex(fallTexture);
  const refs = useRef<(Group | null)[]>([]);
  const bodies = useMemo(() => DISTANT.map((d, i) => undersideGeometry(d.r, d.r * 1.7, 50 + i)), []);
  const crowns = useMemo(() => DISTANT.map((_, i) => foliage(1, 90 + i)), []);
  useEffect(() => () => [...bodies, ...crowns].forEach((g) => g.dispose()), [bodies, crowns]);
  useFrame(() => {
    const t = director.reduced ? 0 : director.now() / 1000;
    water.offset.y = t * 0.6;
    refs.current.forEach((g, i) => {
      if (g) g.position.y = DISTANT[i]!.y + Math.sin(t * 0.3 + i * 1.7) * 0.4;
    });
  });
  return (
    <>
      {DISTANT.map((d, i) => (
        <group key={i} ref={(g) => void (refs.current[i] = g)} position={[d.x, d.y, d.z]}>
          <mesh position={[0, -0.2, 0]}>
            <cylinderGeometry args={[d.r, d.r * 1.02, 0.5, 32]} />
            <meshStandardMaterial color="#6ea24a" roughness={0.95} />
          </mesh>
          <mesh geometry={bodies[i]}>
            <meshStandardMaterial vertexColors roughness={0.95} />
          </mesh>
          {Array.from({ length: Math.round(d.r / 2) + 1 }, (_, k) => {
            const a = hash01(i * 10 + k) * Math.PI * 2;
            const rr = d.r * 0.6 * hash01(i * 10 + k + 5);
            const s = 1 + hash01(i * 10 + k + 9) * 1.2;
            return (
              <group key={k} position={[Math.cos(a) * rr, 0, Math.sin(a) * rr]} scale={s}>
                <mesh position={[0, 0.8, 0]}>
                  <cylinderGeometry args={[0.12, 0.18, 1.6, 6]} />
                  <meshStandardMaterial color="#6b4a30" />
                </mesh>
                <mesh geometry={crowns[i]} position={[0, 2.1, 0]}>
                  <meshStandardMaterial color={shade('#4f8a35', (hash01(i + k) - 0.5) * 0.2)} roughness={0.9} />
                </mesh>
              </group>
            );
          })}
          {d.fall && (
            <mesh position={[d.r * 0.3, -14, d.r * 0.98]}>
              <planeGeometry args={[1.8, 28]} />
              <meshBasicMaterial map={water} color="#9fb4e8" transparent opacity={0.7} depthWrite={false} side={DoubleSide} />
            </mesh>
          )}
        </group>
      ))}
    </>
  );
}

/** Flowers dotted over each island's turf, outside the pads. */
function Flowers({ high }: { readonly high: boolean }) {
  const ref = useRef<InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    const islands = [...PLAYERS.map((p) => ({ c: SPOT[p], r: ISLAND_R, inner: 1.75 })), { c: SPOT.centre, r: CENTRE_R, inner: 1.9 }];
    islands.forEach((isl, k) => {
      for (let i = 0; i < 70; i++) {
        const a = hash01(k * 1000 + i * 2) * Math.PI * 2;
        const rr = isl.inner + hash01(k * 1000 + i * 2 + 1) * (isl.r - isl.inner - 0.08);
        out.push({ x: isl.c.x + Math.cos(a) * rr, z: isl.c.z + Math.sin(a) * rr });
      }
    });
    return out;
  }, []);
  useEffect(() => {
    const o = new Object3D();
    const c = new Color();
    const palette = ['#ffffff', '#ffd23f', '#ff8fb1', '#b38cff'];
    spots.forEach((s, i) => {
      o.position.set(s.x, 0.06, s.z);
      o.scale.setScalar(0.7 + hash01(i + 3) * 0.6);
      o.updateMatrix();
      ref.current?.setMatrixAt(i, o.matrix);
      ref.current?.setColorAt(i, c.set(palette[Math.floor(hash01(i + 7) * palette.length)]!));
    });
    if (ref.current) {
      ref.current.instanceMatrix.needsUpdate = true;
      if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    }
  }, [spots]);
  if (!high) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]}>
      <icosahedronGeometry args={[0.055, 0]} />
      <meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  );
}

// ── The world ─────────────────────────────────────────────────────────────

export function SkyIslands({ director, high }: { readonly director: ArenaDirector; readonly high: boolean }) {
  const grass = useTex(grassTexture);
  const wood = useTex(woodTexture);
  // On each player island, beside where its bridges leave toward the shrine, and two by the shrine.
  const lanterns = useMemo<P2[]>(() => {
    const out: P2[] = PLAYERS.map((p) => {
      const s = SPOT[p];
      const len = Math.hypot(s.x, s.z) || 1;
      const ux = -s.x / len;
      const uz = -s.z / len;
      return { x: s.x + ux * 1.95 - uz * 1.0, z: s.z + uz * 1.95 + ux * 1.0 };
    });
    out.push({ x: -1.7, z: -1.3 }, { x: 1.7, z: -1.3 });
    return out;
  }, []);
  const bridges = useMemo(
    () => [
      span(SPOT['player-a'], ISLAND_R, SPOT.centre, CENTRE_R),
      span(SPOT['player-b'], ISLAND_R, SPOT.centre, CENTRE_R),
      span(SPOT['player-c'], ISLAND_R, SPOT.centre, CENTRE_R),
      span(SPOT['player-a'], ISLAND_R, SPOT['player-c'], ISLAND_R),
      span(SPOT['player-b'], ISLAND_R, SPOT['player-c'], ISLAND_R),
    ],
    [],
  );
  return (
    <>
      {high && (
        <>
          <SkyDome />
          <Stars radius={300} depth={60} count={1800} factor={4} saturation={0.1} fade speed={0.5} />
          <Moon />
          <Fireflies director={director} />
          <Puffs director={director} />
          <DistantIslands director={director} />
        </>
      )}
      {PLAYERS.map((p, i) => {
        const s = SPOT[p];
        const len = Math.hypot(s.x, s.z) || 1;
        // A and B keep a tree on their outer side; C, nearest the camera, has bushes only, so nothing stands in front of the play.
        const front = s.z / len > 0.5;
        const back = front ? { x: 0.75, z: 0.65 } : { x: s.x / len, z: -0.5 };
        return <Island key={p} at={s} radius={ISLAND_R} seed={i + 1} crystal={LANE_COLOR[p]} grass={grass} high={high} back={back} tree={!front} />;
      })}
      <Island at={SPOT.centre} radius={CENTRE_R} seed={9} crystal="#f2c45c" grass={grass} high={false} back={{ x: 0, z: -1 }} />
      {bridges.map(([a, b], i) => (
        <Bridge key={i} from={a} to={b} wood={wood} />
      ))}
      <Flowers high={high} />
      {lanterns.map((l, i) => (
        <Lantern key={i} at={l} high={high} />
      ))}
    </>
  );
}
