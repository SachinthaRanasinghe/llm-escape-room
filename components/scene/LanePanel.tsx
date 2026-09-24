'use client';

import {
  describeAction,
  describeEnd,
  formatThink,
  isSettled,
  NO_INTENT,
  VERDICT_TONE,
  type LaneMoment,
  type ReplayLane,
  type SceneLayout,
} from '@/lib/replay';
import styles from './replay.module.css';

/**
 * The words beside a character: who it is, what it meant, what it did, what the
 * room said back, and how long it thought.
 *
 * ── The intent is quoted, never edited ─────────────────────────────────────
 * `beat.intent` is rendered as-is. There is no truncation here or in the CSS —
 * no `text-overflow`, no line clamp — because spike 3's rule is that an intent
 * that does not fit is fixed with typography, never with its words. A long one
 * steps the type down one notch (`.intentLong`) and wraps.
 *
 * The intent appears at the START of its beat (what the model meant before
 * acting); the verdict appears when it lands (`hold`). Changes cross-fade with
 * opacity only.
 */

const LONG_INTENT = 140;

interface Props {
  readonly lane: ReplayLane;
  readonly layout: SceneLayout;
  readonly moment: LaneMoment;
  readonly colourClass: string;
}

export function LanePanel({ lane, layout, moment, colourClass }: Props) {
  const id = lane.competitorId;
  const beat = moment.beatIndex >= 0 ? lane.beats[moment.beatIndex] : undefined;
  const done = moment.phase === 'done';

  return (
    <section className={`${styles.panel} ${colourClass}`} aria-live="polite" data-testid={`panel-${id}`}>
      <header className={styles.panelHeader}>
        <span className={styles.model}>{lane.label}</span>
        <span className={styles.provider}>{lane.provider}</span>
        <span className={styles.count}>
          {beat ? `Action ${beat.seq + 1} / ${lane.maxActions}` : `0 / ${lane.maxActions}`}
        </span>
      </header>

      {done ? (
        <p className={styles.status} data-testid={`status-${id}`}>
          {describeEnd(lane)}
        </p>
      ) : !beat ? (
        <p className={styles.ready} data-testid={`status-${id}`}>
          Ready
        </p>
      ) : (
        <div key={beat.seq} className={styles.beat}>
          {beat.intent === null ? (
            <p className={styles.noIntent} data-testid={`intent-${id}`}>
              {NO_INTENT}
            </p>
          ) : (
            <blockquote
              className={`${styles.intent} ${beat.intent.length > LONG_INTENT ? styles.intentLong : ''}`}
              data-testid={`intent-${id}`}
            >
              {beat.intent}
            </blockquote>
          )}
          <p className={styles.action}>{describeAction(beat, layout)}</p>
          <p
            className={`${styles.verdict} ${styles[VERDICT_TONE[beat.verdict.code]]}`}
            style={{ opacity: isSettled(moment) ? 1 : 0 }}
          >
            {beat.verdict.message}
          </p>
        </div>
      )}

      <p className={styles.stats} data-testid={`think-${id}`}>
        {beat ? (
          <>
            thought <strong>{formatThink(beat.thinkMs)}</strong>
            <span aria-hidden="true"> · </span>
            total <strong>{formatThink(beat.cumulativeThinkMs)}</strong>
          </>
        ) : (
          <>&nbsp;</>
        )}
      </p>
    </section>
  );
}
