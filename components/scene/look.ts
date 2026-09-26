'use client';

import { createContext } from 'react';
import { CanvasTexture, ClampToEdgeWrapping, Color, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Vec2 } from '@/lib/replay';

/**
 * The room's surfaces and placement helpers — the parts of the look that are
 * code, not snapshot data.
 *
 * ── Deterministic, like everything else in the replay ──────────────────────
 * The textures are painted on a 2D canvas from a fixed integer hash, never
 * a random source: the same run draws the same grain on every machine, every
 * time. They are tinted by the snapshot's colours, so a published run's
 * palette still decides the room's hue.
 */

/** A fixed hash of an integer to [0, 1). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** `colour` lightened (amount > 0) or darkened (amount < 0), as a CSS hex. */
export function shade(colour: string, amount: number): string {
  const c = new Color(colour);
  const target = amount >= 0 ? new Color('#ffffff') : new Color('#000000');
  return `#${c.lerp(target, Math.abs(amount)).getHexString()}`;
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return [el, el.getContext('2d')!];
}

function texture(el: HTMLCanvasElement, repeat: Vec2 = [1, 1]): CanvasTexture {
  const tex = new CanvasTexture(el);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  return tex;
}

/** Staggered wooden planks with grain, tinted by `base`. */
export function plankTexture(base: string): CanvasTexture {
  const size = 512;
  const [el, g] = canvas(size, size);
  const rows = 8;
  const h = size / rows;
  let seed = 1;
  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (size / 3) + hash01(r * 17) * 60;
    for (let x = -offset; x < size; x += size / 1.5) {
      const tone = (hash01(seed++) - 0.5) * 0.1 - 0.04;
      g.fillStyle = shade(base, tone);
      g.fillRect(x, r * h, size / 1.5, h);
      // Grain: faint streaks along the plank.
      for (let s = 0; s < 7; s++) {
        const y = r * h + hash01(seed++) * h;
        g.strokeStyle = `rgba(0,0,0,${0.05 + hash01(seed++) * 0.08})`;
        g.lineWidth = 0.6 + hash01(seed++) * 1.2;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + 80, y + 3, x + 200, y - 3, x + size / 1.5, y + 1);
        g.stroke();
      }
      // Butt joint.
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(x, r * h, 2, h);
    }
    // Seam between rows, with a highlight on the lower edge.
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, r * h, size, 2);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(0, r * h + 2, size, 1);
  }
  return texture(el, [3, 3]);
}

/** Damask-ish wallpaper: vertical stripes and a faint repeating motif. */
export function wallpaperTexture(base: string): CanvasTexture {
  const size = 256;
  const [el, g] = canvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.06)';
    g.fillRect(i * 32, 0, 32, size);
  }
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1.5;
  for (const [cx, cy] of [
    [64, 64],
    [192, 192],
  ] as const) {
    g.beginPath();
    g.moveTo(cx, cy - 22);
    g.quadraticCurveTo(cx + 18, cy, cx, cy + 22);
    g.quadraticCurveTo(cx - 18, cy, cx, cy - 22);
    g.stroke();
  }
  // Darker toward the ceiling, where the lamps do not reach. The texture spans the
  // wall's full height once (repeat y = 1), so the gradient is the wall's own.
  const fall = g.createLinearGradient(0, 0, 0, size);
  fall.addColorStop(0, 'rgba(0,0,0,0.5)');
  fall.addColorStop(0.45, 'rgba(0,0,0,0.12)');
  fall.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fall;
  g.fillRect(0, 0, size, size);
  return texture(el, [4, 1]);
}

/** One raised wainscot panel, bevelled: tile it along a wall with `repeat.x`. */
export function panelTexture(base: string): CanvasTexture {
  const w = 256;
  const h = 300;
  const [el, g] = canvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const inset = 26;
  const [x0, y0, x1, y1] = [inset, inset + 6, w - inset, h - inset];
  // The field, a shade lighter, then its bevel: lit from above, shadowed below.
  g.fillStyle = shade(base, 0.05);
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.fillStyle = 'rgba(255,255,255,0.09)';
  g.fillRect(x0, y0, x1 - x0, 3);
  g.fillRect(x0, y0, 3, y1 - y0);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x0, y1 - 4, x1 - x0, 4);
  g.fillRect(x1 - 4, y0, 4, y1 - y0);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  g.strokeRect(x0 + 14, y0 + 14, x1 - x0 - 28, y1 - y0 - 28);
  return texture(el);
}

/**
 * Long-grain wood for furniture and doors, tinted by `base`. `across` turns the
 * grain horizontal, as on a chest's planks.
 */
export function woodTexture(base: string, across = false): CanvasTexture {
  const w = 256;
  const h = 512;
  const [el, g] = canvas(w, h);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  let seed = 11;
  for (let i = 0; i < 110; i++) {
    const x = hash01(seed++) * w;
    const dark = hash01(seed++) < 0.65;
    const alpha = dark ? 0.05 + hash01(seed++) * 0.13 : 0.03 + hash01(seed++) * 0.05;
    g.strokeStyle = dark ? `rgba(0,0,0,${alpha})` : `rgba(255,224,186,${alpha})`;
    g.lineWidth = 0.5 + hash01(seed++) * 2.2;
    const wobble = (hash01(seed++) - 0.5) * 22;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + wobble, h * 0.33, x - wobble, h * 0.66, x + wobble * 0.4, h);
    g.stroke();
  }
  // A couple of knots.
  for (let k = 0; k < 2; k++) {
    const cx = hash01(seed++) * w;
    const cy = hash01(seed++) * h;
    for (let r = 3; r < 18; r += 3) {
      g.strokeStyle = `rgba(0,0,0,${0.18 - r * 0.007})`;
      g.lineWidth = 1.2;
      g.beginPath();
      g.ellipse(cx, cy, r * 0.55, r * 1.7, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const tex = texture(el);
  if (across) {
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI / 2;
  }
  return tex;
}

/**
 * White at the top edge fading to clear at the bottom — for baked contact
 * shadows (tinted black) and light shafts (tinted warm, blended additively).
 */
export function fadeTexture(): CanvasTexture {
  const [el, g] = canvas(4, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const tex = new CanvasTexture(el);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  return tex;
}

/** A woven rug: a field, a double border and a centre medallion. */
export function rugTexture(field: string, trim: string): CanvasTexture {
  const w = 512;
  const h = 360;
  const [el, g] = canvas(w, h);
  g.fillStyle = field;
  g.fillRect(0, 0, w, h);
  // Weave.
  for (let y = 0; y < h; y += 3) {
    g.fillStyle = `rgba(0,0,0,${0.04 + hash01(y) * 0.05})`;
    g.fillRect(0, y, w, 1);
  }
  g.strokeStyle = trim;
  // A lattice of small lozenges in the field.
  g.strokeStyle = 'rgba(0,0,0,0.18)';
  g.lineWidth = 1.5;
  for (let y = 60; y < h - 50; y += 28) {
    for (let x = 60 + ((y / 28) % 2) * 14; x < w - 50; x += 28) {
      g.beginPath();
      g.moveTo(x, y - 7);
      g.lineTo(x + 7, y);
      g.lineTo(x, y + 7);
      g.lineTo(x - 7, y);
      g.closePath();
      g.stroke();
    }
  }
  // Worn pale where feet have gone.
  const worn = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
  worn.addColorStop(0, 'rgba(255,230,200,0.1)');
  worn.addColorStop(1, 'rgba(255,230,200,0)');
  g.fillStyle = worn;
  g.fillRect(0, 0, w, h);
  // Fringe on the short ends.
  g.strokeStyle = shade(trim, 0.25);
  g.lineWidth = 1.4;
  for (let y = 18; y < h - 18; y += 5) {
    for (const [a, b] of [
      [0, 12],
      [w - 12, w],
    ] as const) {
      g.beginPath();
      g.moveTo(a, y);
      g.lineTo(b, y + (hash01(y + a) - 0.5) * 3);
      g.stroke();
    }
  }
  g.strokeStyle = trim;
  g.lineWidth = 7;
  g.strokeRect(22, 22, w - 44, h - 44);
  g.lineWidth = 3;
  g.strokeRect(44, 44, w - 88, h - 88);
  g.beginPath();
  g.ellipse(w / 2, h / 2, 70, 50, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.moveTo(w / 2 - 110, h / 2);
  g.lineTo(w / 2, h / 2 - 80);
  g.lineTo(w / 2 + 110, h / 2);
  g.lineTo(w / 2, h / 2 + 80);
  g.closePath();
  g.stroke();
  const tex = texture(el);
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  return tex;
}

/** A soft radial alpha disc, for blob shadows and floor glows. */
export function discTexture(): CanvasTexture {
  const size = 128;
  const [el, g] = canvas(size, size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(el);
  return tex;
}

export type Wall = 'back' | 'left' | 'right';

export interface WallMount {
  readonly wall: Wall;
  /** On the wall's inner face, at the object's position along it. */
  readonly position: Vec2;
  /** Faces into the room. */
  readonly yaw: number;
}

/** The wall nearest `position`, and where on it an object there would hang. */
export function wallMount(position: Vec2, roomHalf: number, inset = 0.05): WallMount {
  const [x, z] = position;
  const back = z + roomHalf;
  const left = x + roomHalf;
  const right = roomHalf - x;
  if (back <= left && back <= right) return { wall: 'back', position: [x, -roomHalf + inset], yaw: 0 };
  if (left <= right) return { wall: 'left', position: [-roomHalf + inset, z], yaw: Math.PI / 2 };
  return { wall: 'right', position: [roomHalf - inset, z], yaw: -Math.PI / 2 };
}

/**
 * Whether to draw purely decorative sub-meshes — bands, studs, feet, trim,
 * sconces. `RoomScene` turns it off on the `low` tier: on a software
 * rasteriser every draw call costs real CPU, and none of these carry meaning.
 */
export const Detail = createContext(true);
