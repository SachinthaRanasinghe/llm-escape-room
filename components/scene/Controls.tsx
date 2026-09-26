'use client';

import type { PlaybackState } from './usePlayback';
import styles from './replay.module.css';

/** Play/pause and restart. Scrubbing and speed are out of scope for v0. */
export function Controls({
  state,
  onToggle,
  onRestart,
}: {
  readonly state: PlaybackState;
  readonly onToggle: () => void;
  readonly onRestart: () => void;
}) {
  const label = state === 'playing' ? 'Pause' : state === 'ended' ? 'Replay' : 'Play';
  return (
    <div className={styles.controls}>
      <button
        type="button"
        className={`${styles.button} ${state === 'playing' ? '' : styles.buttonPrimary}`}
        onClick={onToggle}
        aria-pressed={state === 'playing'}
        data-testid="play-toggle"
      >
        {state === 'playing' ? <PauseIcon /> : <PlayIcon />}
        {label}
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.iconButton}`}
        onClick={onRestart}
        aria-label="Restart"
        title="Restart"
        data-testid="restart"
      >
        <RestartIcon />
      </button>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 1.8v10.4a.6.6 0 0 0 .9.5l8.6-5.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2.5" y="1.5" width="3.2" height="11" rx="1" fill="currentColor" />
      <rect x="8.3" y="1.5" width="3.2" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2 1.8v3.4h3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
