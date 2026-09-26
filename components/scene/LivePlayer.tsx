'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Comparison } from '@/components/comparison/Comparison';
import type { ComparisonData } from '@/lib/comparison';
import { allVerdictsIn, planBeats, type RendererSnapshot, type ReplayData } from '@/lib/replay';
import { Briefing } from './Briefing';
import { createAnchorStore } from './anchor';
import { LaneHud } from './LaneHud';
import type { Quality } from './RoomScene';
import { useLivePlayback } from './useLivePlayback';
import { useReducedMotion } from './usePlayback';
import styles from './replay.module.css';

/**
 * A race as it happens — the same two rooms, characters and panels as
 * `ReplayPlayer`, fed by a log that is still being written.
 *
 * `data` grows by one beat each time a model's action is judged; `finished`
 * says which lanes have ended. Each lane plays its beats as they arrive and
 * holds, "thinking", while its model chooses the next one (`useLivePlayback`).
 * There is no pause or restart: this is the race, not a recording of it. The
 * recording is `ReplayPlayer`, once the race is saved.
 *
 * `comparison` arrives with the finished race. It is revealed once both lanes
 * have landed their last verdict, or at once on "Skip to results" — never before the
 * viewer has seen the finish or chosen to skip it.
 */

const ReplayStage = dynamic(() => import('./ReplayStage'), { ssr: false });

const LANE_CLASSES = [styles.laneA, styles.laneB];
const LANE_LETTERS = ['A', 'B'];

interface Props {
  readonly data: ReplayData;
  readonly renderer: RendererSnapshot;
  /** Per lane, in lane order. */
  readonly finished: readonly boolean[];
  readonly comparison?: ComparisonData;
  /** Per lane: how to word its end instead of the log's end reason — for a race a provider stopped. */
  readonly endLabels?: readonly string[];
  /** What sits in the bar beside the title: the race's phase, clock and controls. */
  readonly status?: ReactNode;
}

export function LivePlayer({ data, renderer, finished, comparison, endLabels, status }: Props) {
  // No lane offset: live lanes already start apart, because their models answer apart.
  const plan = useMemo(() => planBeats(data, { ...renderer.timing, laneOffsetMs: 0 }), [data, renderer]);
  const finishedKey = finished.join(',');
  // By value: a new array with the same flags is the same state, and must not restart the clocks.
  const stableFinished = useMemo(() => finished, [finishedKey]);
  const { timeRefs, moments, waiting, ended } = useLivePlayback(plan, stableFinished);
  const reduced = useReducedMotion();

  const [skipped, setSkipped] = useState(false);
  // As soon as every model is finished and its last verdict is on screen — not after the exit walk.
  const decided = stableFinished.length > 0 && stableFinished.every(Boolean) && allVerdictsIn(plan, moments);
  const shown = comparison !== undefined && (ended || skipped || decided);
  const headingRef = useRef<HTMLHeadingElement>(null);
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
  const laneCount = data.lanes.length;
  const anchors = useMemo(() => Array.from({ length: laneCount }, createAnchorStore), [laneCount]);
  // Unknown until the canvas has looked at its renderer; the HUD's blur waits for `high`.
  const [quality, setQuality] = useState<Quality | null>(null);

  return (
    <main className={styles.root} style={laneColourVars(renderer)} data-testid="race-live" data-state={ended ? 'ended' : 'live'} data-quality={quality ?? undefined}>
      <header className={styles.bar}>
        <div className={styles.titleGroup}>
          <Link href="/" className={styles.home} aria-label="Home">
            <span />
            <span />
          </Link>
          <h1 className={styles.title}>{data.layout.themeName}</h1>
          <span className={`${styles.chip} ${ended ? '' : styles.chipLive}`}>{ended ? 'Finished' : 'Live'}</span>
        </div>
        <div className={styles.controls}>
          {comparison && !shown && (
            <button type="button" className={styles.button} onClick={() => setSkipped(true)} data-testid="skip-to-results">
              Skip to results
            </button>
          )}
          {status}
        </div>
      </header>

      <div ref={container} className={styles.stage}>
        <div className={styles.lanes}>
          {data.lanes.map((lane, i) => (
            <div key={lane.competitorId} className={`${styles.lane} ${LANE_CLASSES[i % 2]}`}>
              <div ref={tracks[i] as RefObject<HTMLDivElement>} className={styles.view} />
              <div className={styles.vignette} aria-hidden="true" />
              <LaneHud
                lane={lane}
                layout={data.layout}
                moment={moments[i]}
                colourClass={LANE_CLASSES[i % 2]}
                letter={LANE_LETTERS[i % 2]}
                side={i % 2 === 0 ? 'left' : 'right'}
                mode="live"
                anchor={anchors[i]}
                thinking={waiting[i] ?? false}
                endLabel={endLabels?.[i]}
              />
            </div>
          ))}
        </div>
        <ReplayStage
          data={data}
          renderer={renderer}
          plan={plan}
          moments={moments}
          timeRef={timeRefs[0]}
          laneTimeRefs={timeRefs}
          reduced={reduced}
          container={container as RefObject<HTMLElement>}
          tracks={tracks}
          anchors={anchors}
          onQuality={setQuality}
        />
      </div>

      {shown && comparison && <Comparison data={comparison} headingRef={headingRef} />}

      <Briefing />
    </main>
  );
}

function laneColourVars(renderer: RendererSnapshot): CSSProperties {
  const [a, b] = renderer.assets.laneColours;
  return { '--lane-a': a, '--lane-b': b ?? a } as CSSProperties;
}
