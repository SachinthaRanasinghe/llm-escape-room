'use client';

import { SYSTEM_PROMPT } from '@/lib/harness/prompt';
import styles from './replay.module.css';

/**
 * "How to read this" — the strip under the rooms that tells a first-time
 * viewer what they are looking at, and shows the instructions both models were
 * given, verbatim.
 *
 * `SYSTEM_PROMPT` is the harness's one constant — the same words for every
 * model, carrying no clue or answer (`lib/harness/prompt.ts`). Runs do not
 * record it yet, so a published run shows the prompt this build ships; if the
 * prompt ever changes, freeze it into the render manifest first.
 */
export function Briefing() {
  return (
    <details className={styles.briefing} open>
      <summary className={styles.briefingSummary}>
        <span className={styles.briefingTitle}>How to read this</span>
        <span className={styles.briefingHint}>Two models, two identical rooms, one goal: get out.</span>
      </summary>
      <div className={styles.briefingBody}>
        <ol className={styles.legend}>
          <li>
            <span className={styles.legendKey}>
              <i className={styles.dotA} />
              <i className={styles.dotB} />
            </span>
            <span>
              <strong>Each robot is one model</strong>, alone in its own copy of the same room.
            </span>
          </li>
          <li>
            <span className={styles.legendKey}>
              <i className={styles.ring} />
            </span>
            <span>
              <strong>The floor ring</strong> marks what it is acting on: green when the room says yes, red when wrong.
            </span>
          </li>
          <li>
            <span className={styles.legendKey}>
              <i className={styles.bubble} />
            </span>
            <span>
              <strong>The card beside the object</strong> is each turn: what the model decided, the action it sent, and
              the room’s reply — which is all it gets to read before its next move.
            </span>
          </li>
        </ol>
        <details className={styles.prompt}>
          <summary className={styles.promptSummary}>Show what both models were told, word for word</summary>
          <pre className={styles.promptText}>{SYSTEM_PROMPT}</pre>
        </details>
      </div>
    </details>
  );
}
