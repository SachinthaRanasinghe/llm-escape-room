import type { ArenaPlayerView, ArenaTurnView, Cores } from '@/lib/race/arena-wire';
import { LANE, LETTER, type PlayerId } from './choreography';
import styles from './arena.module.css';

/**
 * The scoreboard across the top of the arena: one card per model with its core
 * count as five energy cells, what it is doing right now, and its record so far
 * — counted from the turns already shown, so it never runs ahead of the stage.
 */

const TOTAL = 5;

interface Props {
  readonly players: readonly ArenaPlayerView[];
  readonly cores: Cores;
  readonly out: ReadonlySet<PlayerId>;
  readonly active: PlayerId | null;
  readonly status: Readonly<Partial<Record<PlayerId, string>>>;
  readonly winners: readonly PlayerId[];
  readonly turns: readonly ArenaTurnView[];
}

export function PlayerCards({ players, cores, out, active, status, winners, turns }: Props) {
  return (
    <ol className={styles.cards} aria-label="Players">
      {players.map((p) => {
        const mine = turns.filter((t) => t.playerId === p.id);
        const right = mine.filter((t) => t.correct === true).length;
        const wrong = mine.filter((t) => t.correct === false).length;
        const isOut = out.has(p.id);
        const won = winners.includes(p.id);
        return (
          <li
            key={p.id}
            className={styles.card}
            data-lane={LANE[p.id]}
            data-active={active === p.id || undefined}
            data-out={isOut || undefined}
            data-won={won || undefined}
            data-testid={`card-${p.id}`}
          >
            <div className={styles.cardTop}>
              <span className={styles.emblem}>{LETTER[p.id]}</span>
              <div className={styles.cardName}>
                <strong title={p.modelId}>{p.modelId}</strong>
                <span>{p.provider}</span>
              </div>
              <div className={styles.cardScore} aria-label={`${cores[p.id]} cores`}>
                <b key={cores[p.id]}>{cores[p.id]}</b>
                <span>cores</span>
              </div>
            </div>
            <div className={styles.cells} aria-hidden="true">
              {Array.from({ length: TOTAL }, (_, i) => (
                <span key={i} className={styles.cell} data-on={i < cores[p.id] || undefined} />
              ))}
            </div>
            <div className={styles.cardFoot}>
              <span className={styles.cardStatus}>{isOut ? 'Eliminated' : won ? 'Winner' : (status[p.id] ?? (active === p.id ? 'Their turn' : 'Waiting'))}</span>
              <span className={styles.cardRecord}>
                <span className={styles.right}>✓ {right}</span> <span className={styles.wrong}>✗ {wrong}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
