'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { Comparison } from '@/components/comparison/Comparison';
import type { ComparisonData } from '@/lib/comparison';
import { planBeats, type RendererSnapshot, type ReplayData } from '@/lib/replay';
import { Controls } from './Controls';
import { LanePanel } from './LanePanel';
import { usePlayback, useReducedMotion } from './usePlayback';
import styles from './replay.module.css';

/**
 * The replay player — two rooms side by side, each with its panel, and one clock.
 *
 * It receives `ReplayData` and a `RendererSnapshot`, and nothing else: no room
 * spec, no fixture, no provider. The server page built both; this component only
 * plays them. That one-way shape is `architecture.md`'s "Replay ↔ artifact"
 * boundary.
 *
 * `renderer` is the whole of how the run looks — timing, camera, colours,
 * proportions. `/replay` passes the live one; `/run/[id]` passes the snapshot
 * frozen into the published artifact (TICKET-9, #9), which is why nothing below
 * this component reads a renderer constant.
 *
 * `comparison` is the post-run read (TICKET-10, #10), passed only by `/run/[id]`.
 * It is revealed when playback ends, or at once on "Skip to results", and then
 * stays revealed through restarts — so the result is never spoiled before the
 * viewer chooses to see it, and never taken away once they have. `/replay`
 * passes none and shows neither the button nor the results.
 */

const ReplayStage = dynamic(() => import('./ReplayStage'), { ssr: false });

const LANE_CLASSES = [styles.laneA, styles.laneB];

interface Props {
  readonly data: ReplayData;
  readonly renderer: RendererSnapshot;
  readonly comparison?: ComparisonData;
}

export function ReplayPlayer({ data, renderer, comparison }: Props) {
  const plan = useMemo(() => planBeats(data, renderer.timing), [data, renderer]);
  const { timeRef, moments, state, toggle, restart } = usePlayback(plan);
  const reduced = useReducedMotion();

  const [skipped, setSkipped] = useState(false);
  const [shown, setShown] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (comparison && (state === 'ended' || skipped)) setShown(true);
  }, [comparison, state, skipped]);

  // Only a skip moves focus: a viewer who watched to the end keeps their place.
  useEffect(() => {
    if (!skipped || !shown) return;
    const frame = requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [skipped, shown, reduced]);

  const container = useRef<HTMLDivElement>(null);
  const trackA = useRef<HTMLDivElement>(null);
  const trackB = useRef<HTMLDivElement>(null);
  const tracks = [trackA, trackB].slice(0, data.lanes.length) as RefObject<HTMLElement>[];

  return (
    <main className={styles.root} style={laneColourVars(renderer)} data-testid="replay" data-state={state}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{data.layout.themeName}</h1>
        <div className={styles.controls}>
          {comparison && !shown && (
            <button type="button" className={styles.button} onClick={() => setSkipped(true)} data-testid="skip-to-results">
              Skip to results
            </button>
          )}
          <Controls state={state} onToggle={toggle} onRestart={restart} />
        </div>
      </header>

      <div ref={container} className={styles.stage}>
        <div className={styles.lanes}>
          {data.lanes.map((lane, i) => (
            <div key={lane.competitorId} className={styles.lane}>
              <div ref={tracks[i] as RefObject<HTMLDivElement>} className={styles.view} />
              <LanePanel lane={lane} layout={data.layout} moment={moments[i]} colourClass={LANE_CLASSES[i % 2]} />
            </div>
          ))}
        </div>
        <ReplayStage
          data={data}
          renderer={renderer}
          plan={plan}
          moments={moments}
          timeRef={timeRef}
          reduced={reduced}
          container={container as RefObject<HTMLElement>}
          tracks={tracks}
        />
      </div>

      {shown && comparison && <Comparison data={comparison} headingRef={headingRef} />}
    </main>
  );
}

/** The chrome's lane colours, from the snapshot, so the panels match the characters. */
function laneColourVars(renderer: RendererSnapshot): CSSProperties {
  const [a, b] = renderer.assets.laneColours;
  return { '--lane-a': a, '--lane-b': b ?? a } as CSSProperties;
}
