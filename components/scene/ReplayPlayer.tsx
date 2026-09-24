'use client';

import dynamic from 'next/dynamic';
import { useMemo, useRef, type RefObject } from 'react';
import { planBeats, type ReplayData } from '@/lib/replay';
import { Controls } from './Controls';
import { LanePanel } from './LanePanel';
import { usePlayback, useReducedMotion } from './usePlayback';
import styles from './replay.module.css';

/**
 * The replay player — two rooms side by side, each with its panel, and one clock.
 *
 * It receives `ReplayData` and nothing else: no room spec, no fixture, no
 * provider. The server page built that data; this component only plays it. That
 * one-way shape is `architecture.md`'s "Replay ↔ artifact" boundary, and it is
 * what lets TICKET-9 (#9) swap the fixture for a published artifact without
 * touching anything in here.
 */

const ReplayStage = dynamic(() => import('./ReplayStage'), { ssr: false });

const LANE_CLASSES = [styles.laneA, styles.laneB];

export function ReplayPlayer({ data }: { readonly data: ReplayData }) {
  const plan = useMemo(() => planBeats(data), [data]);
  const { timeRef, moments, state, toggle, restart } = usePlayback(plan);
  const reduced = useReducedMotion();

  const container = useRef<HTMLDivElement>(null);
  const trackA = useRef<HTMLDivElement>(null);
  const trackB = useRef<HTMLDivElement>(null);
  const tracks = [trackA, trackB].slice(0, data.lanes.length) as RefObject<HTMLElement>[];

  return (
    <main className={styles.root} data-testid="replay" data-state={state}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{data.layout.themeName}</h1>
        <Controls state={state} onToggle={toggle} onRestart={restart} />
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
          plan={plan}
          moments={moments}
          timeRef={timeRef}
          reduced={reduced}
          container={container as RefObject<HTMLElement>}
          tracks={tracks}
        />
      </div>
    </main>
  );
}
