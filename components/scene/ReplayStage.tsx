'use client';

import { View } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { BeatPlan, LaneMoment, RendererSnapshot, ReplayData } from '@/lib/replay';
import { RoomScene } from './RoomScene';

/**
 * The 3D half of the player: ONE `<Canvas>` rendering one drei `<View>` per
 * lane, each scissored to the DOM element it tracks.
 *
 * One canvas rather than two means one WebGL context, one render loop and one
 * clock — which is also what a future video export (a second reader of the
 * same log) would want. The canvas lies OVER the lane columns with pointer
 * events off; it is transparent everywhere except the rectangles of the
 * tracking divs, so the panels show through and the buttons stay clickable.
 *
 * Loaded with `next/dynamic` and `ssr: false` from `ReplayPlayer`, so three.js
 * never runs during prerender.
 */

interface Props {
  readonly data: ReplayData;
  readonly renderer: RendererSnapshot;
  readonly plan: BeatPlan;
  readonly moments: readonly LaneMoment[];
  readonly timeRef: RefObject<number>;
  readonly reduced: boolean;
  readonly container: RefObject<HTMLElement>;
  readonly tracks: readonly RefObject<HTMLElement>[];
}

export default function ReplayStage({ data, renderer, plan, moments, timeRef, reduced, container, tracks }: Props) {
  const { laneColours } = renderer.assets;
  return (
    <Canvas
      eventSource={container}
      dpr={[1, 2]}
      style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
      data-testid="replay-canvas"
    >
      {data.lanes.map((lane, i) => (
        <View key={lane.competitorId} track={tracks[i]}>
          <RoomScene
            lane={lane}
            laneIndex={i}
            layout={data.layout}
            plan={plan}
            moment={moments[i]}
            timeRef={timeRef}
            colour={laneColours[i % laneColours.length]}
            reduced={reduced}
            renderer={renderer}
          />
        </View>
      ))}
    </Canvas>
  );
}
