'use client';

import styles from './replay.module.css';

/**
 * How far through the run the replay is, as a hairline under the bar.
 *
 * It moves only when the player re-renders — when a lane crosses a phase, a
 * few times a beat — never on its own animation loop. Every DOM change repaints
 * the page, and on a software compositor (and in the e2e run) a per-frame
 * repaint costs an order of magnitude more than the 3D scene itself.
 */
export function ProgressBar({ share }: { readonly share: number }) {
  return (
    <div className={styles.progress} aria-hidden="true">
      <div className={styles.progressFill} style={{ transform: `scaleX(${Math.min(1, Math.max(0, share))})` }} />
    </div>
  );
}
