'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { Vector3 } from 'three';
import type { ObjectKind } from '@/lib/schema/room';
import type { ReplayBeat, SceneLayout } from '@/lib/replay';
import { wallMount } from './look';
import { isWallMounted } from './SceneObject';

/**
 * Where, on screen, the current action is happening — so the HUD can pin its
 * card beside the object being acted on rather than in a panel below the room.
 *
 * The 3D side (`AnchorProbe`, inside each lane's `<View>`) projects a point on
 * the target through that lane's camera and writes it to a tiny store; the HUD
 * reads the store with `useSyncExternalStore`. Only the HUD re-renders, and only
 * when the point has moved by a visible amount — the camera's slow sway moves it
 * a few times a beat, not every frame.
 */

/** A point in the lane's view, as fractions of its width and height (0..1, top-left origin). */
export interface Anchor {
  readonly x: number;
  readonly y: number;
}

export interface AnchorStore {
  readonly get: () => Anchor | null;
  readonly set: (anchor: Anchor | null) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createAnchorStore(): AnchorStore {
  let current: Anchor | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (anchor) => {
      if (anchor === current) return;
      current = anchor;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Roughly the top of each kind of object, so the pin sits on it rather than at its feet. */
const HEIGHT: Readonly<Record<ObjectKind, number>> = {
  door: 2.1,
  fixture: 1.5,
  lock: 1.1,
  container: 0.9,
  portable: 0.5,
};

/**
 * The world point the current beat is about: its target (a contained object
 * sits on its holder), the middle of the room for `look` or a name that does
 * not exist — where the character goes to stand — or `null` for a turn with no
 * action, which the HUD shows unpinned.
 */
export function anchorPoint(layout: SceneLayout, beat: ReplayBeat | undefined, roomHalf: number): readonly [number, number, number] | null {
  if (!beat || beat.verb === null) return null;
  const byId = new Map(layout.objects.map((o) => [o.id, o]));
  let target = beat.targetId === null ? undefined : byId.get(beat.targetId);
  if (!target) return [layout.centre[0], 1.9, layout.centre[1]];

  let nested = false;
  for (let depth = 0; target.parentId !== null && depth < layout.objects.length; depth++) {
    const parent = byId.get(target.parentId);
    if (!parent) break;
    target = parent;
    nested = true;
  }
  const [x, z] = isWallMounted(target.kind) ? wallMount(target.position, roomHalf).position : target.position;
  return [x, HEIGHT[target.kind] + (nested ? 0.35 : 0), z];
}

/** Smallest move, as a share of the view, worth re-rendering the HUD for. */
const STEP = 0.008;

/** Projects `point` through this `<View>`'s camera into `store`. Renders nothing. */
export function AnchorProbe({ point, store }: { readonly point: readonly [number, number, number] | null; readonly store: AnchorStore }) {
  const camera = useThree((state) => state.camera);
  const scratch = useMemo(() => new Vector3(), []);

  useEffect(() => {
    if (point === null) store.set(null);
  }, [point, store]);
  useEffect(() => () => store.set(null), [store]);

  useFrame(() => {
    if (point === null) return;
    scratch.set(point[0], point[1], point[2]).project(camera);
    const next = { x: (scratch.x + 1) / 2, y: (1 - scratch.y) / 2 };
    const prev = store.get();
    if (!prev || Math.abs(prev.x - next.x) > STEP || Math.abs(prev.y - next.y) > STEP) store.set(next);
  });
  return null;
}
