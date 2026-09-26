'use client';

import { View } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState, type RefObject } from 'react';
import { AgXToneMapping, type WebGLRenderer } from 'three';
import type { BeatPlan, LaneMoment, RendererSnapshot, ReplayData } from '@/lib/replay';
import type { AnchorStore } from './anchor';
import { RoomScene, type Quality } from './RoomScene';

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
 * ── Quality ────────────────────────────────────────────────────────────────
 * Soft shadows and an environment map are cheap on a GPU and ruinous on a
 * software rasteriser (SwiftShader, llvmpipe), where every pixel is shaded on
 * the CPU. So the canvas asks which renderer it got and, on a software one,
 * draws the `low` tier: the same room, objects and motion, lit more simply
 * and drawn on every other animation frame (`HalfRate`).
 * Nothing a viewer reads from the replay changes between tiers.
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
  /** A live race's per-lane clocks (`useLivePlayback`). Absent for a replay: one clock drives both lanes. */
  readonly laneTimeRefs?: readonly RefObject<number>[];
  readonly reduced: boolean;
  readonly container: RefObject<HTMLElement>;
  readonly tracks: readonly RefObject<HTMLElement>[];
  /** Per lane: where its HUD pins the current action. */
  readonly anchors?: readonly AnchorStore[];
  /** Which tier the canvas chose, so the HUD can drop its blur on a software renderer too. */
  readonly onQuality?: (quality: Quality) => void;
}

export default function ReplayStage({ data, renderer, plan, moments, timeRef, laneTimeRefs, reduced, container, tracks, anchors, onQuality }: Props) {
  const { laneColours } = renderer.assets;
  const [quality, setQuality] = useState<Quality>('high');
  return (
    <Canvas
      eventSource={container}
      dpr={[1, 2]}
      frameloop={quality === 'high' ? 'always' : 'demand'}
      shadows={quality === 'high' ? 'soft' : false}
      onCreated={({ gl }) => {
        const tier = qualityOf(gl);
        setQuality(tier);
        onQuality?.(tier);
      }}
      // AgX: a filmic curve that rolls warm highlights off gently instead of pushing them to flat orange.
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: AgXToneMapping, toneMappingExposure: 1.3 }}
      style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}
      data-testid="replay-canvas"
    >
      {quality === 'low' && <HalfRate />}
      {data.lanes.map((lane, i) => (
        <View key={lane.competitorId} track={tracks[i]}>
          <RoomScene
            lane={lane}
            laneIndex={i}
            layout={data.layout}
            plan={plan}
            moment={moments[i]}
            timeRef={laneTimeRefs?.[i] ?? timeRef}
            colour={laneColours[i % laneColours.length]}
            reduced={reduced}
            quality={quality}
            renderer={renderer}
            anchor={anchors?.[i]}
          />
        </View>
      ))}
    </Canvas>
  );
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** `low` on a software rasteriser, `high` otherwise — including when the driver will not say. */
function qualityOf(gl: WebGLRenderer): Quality {
  const context = gl.getContext();
  const info = context.getExtension('WEBGL_debug_renderer_info');
  const name = info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);
  return typeof name === 'string' && SOFTWARE_RENDERER.test(name) ? 'low' : 'high';
}

/**
 * Asks for a frame on every second animation frame, for the `demand` loop the
 * `low` tier uses. Poses are pure functions of the replay clock, so a skipped
 * frame changes smoothness, never where anything is.
 */
function HalfRate() {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let frame = 0;
    let odd = false;
    const tick = () => {
      odd = !odd;
      if (odd) invalidate();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [invalidate]);
  return null;
}
