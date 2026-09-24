'use client';

import type { ObjectKind } from '@/lib/schema/room';

/**
 * Scene colours. three.js materials cannot read CSS custom properties, so the
 * 3D palette lives here and the chrome's lives in `replay.module.css`; the lane
 * colours are duplicated there as `--lane-a` / `--lane-b` and must match.
 */

export const LANE_COLOURS = ['#e0a458', '#5ab1bb'] as const;

export const SCENE = {
  background: '#15171c',
  floor: '#2a2d35',
  wall: '#343844',
  success: '#6fcf86',
  failure: '#e0655b',
  locked: '#c9504a',
  unlocked: '#58c472',
} as const;

export const KIND_COLOUR: Readonly<Record<ObjectKind, string>> = {
  container: '#8a6a4a',
  fixture: '#6b7686',
  portable: '#d8c9a3',
  lock: '#7d8590',
  door: '#6e4f36',
};
