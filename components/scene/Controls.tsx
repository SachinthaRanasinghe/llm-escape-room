'use client';

import type { PlaybackState } from './usePlayback';
import styles from './replay.module.css';

/** Play/pause and restart — text buttons, nothing decorative. Scrubbing and speed are out of scope for v0. */
export function Controls({
  state,
  onToggle,
  onRestart,
}: {
  readonly state: PlaybackState;
  readonly onToggle: () => void;
  readonly onRestart: () => void;
}) {
  return (
    <div className={styles.controls}>
      <button type="button" className={styles.button} onClick={onToggle} aria-pressed={state === 'playing'} data-testid="play-toggle">
        {state === 'playing' ? 'Pause' : state === 'ended' ? 'Replay' : 'Play'}
      </button>
      <button type="button" className={styles.button} onClick={onRestart} data-testid="restart">
        Restart
      </button>
    </div>
  );
}
