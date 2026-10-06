import type { ArenaPlayerView, ArenaTurnView } from '@/lib/race/arena-wire';
import { LANE, LETTER } from './choreography';
import styles from './arena.module.css';

/**
 * The live event log, newest first: who acted, what they went for, their intent
 * quoted exactly as written, and — once graded — the question, their answer and
 * the right one. The intent is never trimmed or summarised: what a viewer points
 * at has to be what the model said.
 */

function headline(turn: ArenaTurnView): string {
  const who = `Player ${LETTER[turn.playerId]}`;
  switch (turn.action) {
    case 'pass':
      return `${who} passes`;
    case 'invalid':
      return `${who} makes an invalid move`;
    case 'claim':
      return `${who} goes for a centre core`;
    case 'steal':
      return `${who} tries to steal from Player ${turn.targetId ? LETTER[turn.targetId] : '?'}`;
  }
}

const RESULT: Readonly<Record<ArenaTurnView['outcome'], string>> = {
  claimed: 'Claimed',
  stole: 'Stolen',
  failed: 'Failed',
  passed: 'Passed',
  wasted: 'Turn lost',
};

const ICON: Readonly<Record<ArenaTurnView['action'], string>> = { claim: '◆', steal: '⚡', pass: '◌', invalid: '⚠' };

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TurnFeed({ turns, players }: { readonly turns: readonly ArenaTurnView[]; readonly players: readonly ArenaPlayerView[] }) {
  const model = new Map(players.map((p) => [p.id, p.modelId]));
  return (
    <section className={styles.log} aria-labelledby="arena-log-title">
      <h2 id="arena-log-title" className={styles.logTitle}>
        <span className={styles.liveDot} aria-hidden="true" /> Event log
      </h2>
      {turns.length === 0 ? (
        <p className={styles.empty}>The first move is on its way…</p>
      ) : (
        <ol className={styles.feed} reversed aria-label="Turns, newest first">
          {[...turns].reverse().map((turn) => (
            <li key={turn.seq} className={styles.turn} data-lane={LANE[turn.playerId]} data-outcome={turn.outcome} data-testid="arena-turn">
              <div className={styles.turnHead}>
                <span className={styles.turnIcon} aria-hidden="true">
                  {ICON[turn.action]}
                </span>
                <span className={styles.chip}>R{turn.round}</span>
                <strong>{headline(turn)}</strong>
                <span className={styles.result} data-outcome={turn.outcome}>
                  {RESULT[turn.outcome]}
                </span>
              </div>
              {turn.eliminated && <p className={styles.turnKo}>☠ Player {LETTER[turn.eliminated]} eliminated</p>}
              <div className={styles.turnModel}>
                {model.get(turn.playerId)} · {seconds(turn.latencyMs)} thinking
              </div>
              {turn.intent !== null && (
                <blockquote className={styles.intent} data-testid="arena-intent">
                  “{turn.intent}”
                </blockquote>
              )}
              {turn.question === null ? (
                turn.action !== 'pass' && <p className={styles.verdict}>{turn.decisionMessage}</p>
              ) : (
                <details className={styles.question}>
                  <summary>
                    {turn.question.tier} {turn.question.category} question ·{' '}
                    {turn.correct ? <span className={styles.right}>✓ correct</span> : <span className={styles.wrong}>✗ {turn.answerGiven === null ? 'no valid answer' : 'wrong'}</span>}
                  </summary>
                  <pre className={styles.prompt}>{turn.question.prompt}</pre>
                  <dl className={styles.answers}>
                    <dt>Answered</dt>
                    <dd>{turn.answerGiven ?? '—'}</dd>
                    <dt>Expected</dt>
                    <dd>{turn.expected}</dd>
                  </dl>
                  {turn.answerIntent !== null && <blockquote className={styles.intent}>“{turn.answerIntent}”</blockquote>}
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
