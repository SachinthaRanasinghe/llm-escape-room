'use client';

import { useEffect, useState } from 'react';
import type { ArenaTurnView } from '@/lib/race/arena-wire';
import { LANE, LETTER, reached, type Beat, type PlayerId } from './choreography';
import styles from './arena.module.css';

/**
 * The challenge a claim or steal rides on, shown as part of the game.
 *
 * While a model is still solving, the wire carries only the question's kind —
 * its text is withheld until the answer is graded (`lib/race/arena-wire.ts`) —
 * so the card shows an encrypted panel. Once the turn arrives it is replayed:
 * the question, then the model's answer typed in, then the verdict stamp.
 */

export interface Solving {
  readonly playerId: PlayerId;
  readonly tier: 'medium' | 'hard';
  readonly category: string;
}

const GLYPHS = 'ABCDEF0123456789#$%&*+=<>/\\[]{}';

function Scramble({ length }: { length: number }) {
  const [text, setText] = useState('');
  useEffect(() => {
    const roll = () => setText(Array.from({ length }, () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join(''));
    roll();
    const id = setInterval(roll, 70);
    return () => clearInterval(id);
  }, [length]);
  return <span className={styles.scramble}>{text}</span>;
}

export function ChallengeCard({ turn, beat, solving }: { turn: ArenaTurnView | null; beat: Beat | null; solving: Solving | null }) {
  if (turn === null || turn.question === null) {
    if (solving === null) return null;
    return (
      <section className={styles.challenge} data-lane={LANE[solving.playerId]} data-state="solving" aria-label="Challenge in progress">
        <header className={styles.challengeHead}>
          <span className={styles.tier} data-tier={solving.tier}>
            {solving.tier}
          </span>
          <span>{solving.category} challenge</span>
          <span className={styles.challengeWho}>Player {LETTER[solving.playerId]} solving</span>
        </header>
        <div className={styles.encrypted}>
          <Scramble length={46} />
          <Scramble length={32} />
          <p>Challenge sealed until graded</p>
        </div>
      </section>
    );
  }

  const { question } = turn;
  const answered = reached(beat, 'answer');
  const judged = reached(beat, 'verdict');
  const worked = turn.outcome === 'claimed' || turn.outcome === 'stole';

  return (
    <section
      className={styles.challenge}
      data-lane={LANE[turn.playerId]}
      data-state={judged ? (turn.correct ? 'right' : 'wrong') : 'open'}
      aria-label="Challenge"
      data-testid="arena-challenge"
      key={turn.seq}
    >
      <header className={styles.challengeHead}>
        <span className={styles.tier} data-tier={question.tier}>
          {question.tier}
        </span>
        <span>{question.category} challenge</span>
        <span className={styles.challengeWho}>
          Player {LETTER[turn.playerId]} · {turn.action === 'claim' ? 'to claim' : 'to steal'}
        </span>
      </header>
      <pre className={styles.challengePrompt}>{question.prompt}</pre>
      <div className={styles.answerRow} data-shown={answered || undefined}>
        <span className={styles.answerLabel}>Answer ›</span>
        {answered ? (
          <code className={styles.typed} key={`a-${turn.seq}`}>
            {turn.answerGiven ?? 'no valid answer'}
          </code>
        ) : (
          <span className={styles.cursor} aria-hidden="true" />
        )}
      </div>
      {judged && (
        <div className={styles.verdictRow} data-testid="arena-verdict">
          <span className={styles.stamp} data-ok={turn.correct || undefined}>
            {turn.correct ? 'Correct' : 'Wrong'}
          </span>
          <span className={styles.verdictNote}>
            {turn.correct
              ? worked
                ? turn.action === 'claim'
                  ? 'Core claimed from the reserve'
                  : `Core stolen from Player ${turn.targetId ? LETTER[turn.targetId] : '?'}`
                : 'Action resolved'
              : `Expected ${turn.expected ?? '—'} · ${turn.action === 'claim' ? 'claim' : 'steal'} fails`}
          </span>
        </div>
      )}
    </section>
  );
}
