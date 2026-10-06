import type { ArenaStandingsView } from '@/lib/race/arena-wire';
import { LANE, LETTER } from './choreography';
import styles from './arena.module.css';

/**
 * The match-results screen: who won (or that it was a tie), then a podium card
 * per model. Ranked by cores — the only thing that decides the match. Accuracy
 * and think-time are shown beside it and never break a tie.
 */

const ENDED: Readonly<Record<NonNullable<ArenaStandingsView['endedBecause']>, string>> = {
  last_standing: 'Last one standing',
  round_cap: 'All rounds played',
  time_cap: 'Stopped at the time limit',
};

const PLACE = ['1st', '2nd', '3rd'] as const;

function accuracy(correct: number, wrong: number): number | null {
  const asked = correct + wrong;
  return asked === 0 ? null : Math.round((correct / asked) * 100);
}

function usd(value: number): string {
  return value === 0 ? '$0' : `$${value.toFixed(4)}`;
}

export function Standings({ result, stoppedReason }: { readonly result: ArenaStandingsView; readonly stoppedReason?: string }) {
  const ranked = [...result.standings].sort((a, b) => b.cores - a.cores);
  const names = (ids: readonly string[]) => ids.map((id) => result.standings.find((s) => s.playerId === id)!.modelId).join(' and ');
  const headline =
    result.outcome === null ? `No winner — ${stoppedReason ?? 'the match did not finish'}` : result.outcome === 'win' ? `Winner: ${names(result.winners)}` : `Tie: ${names(result.winners)}`;

  return (
    <section className={styles.results} aria-labelledby="arena-result" data-testid="arena-standings">
      <p className={styles.resultsEyebrow}>Match results</p>
      <h2 id="arena-result" className={styles.resultsTitle} data-testid="arena-winner">
        {headline}
      </h2>
      <p className={styles.hint}>
        {result.endedBecause ? `${ENDED[result.endedBecause]} · ` : ''}
        {result.roundsPlayed} of {result.maxRounds} rounds. Most cores wins; equal counts tie — accuracy and speed are shown, never used to break one.
      </p>
      <ol className={styles.podium}>
        {ranked.map((s, i) => {
          const rank = ranked.findIndex((r) => r.cores === s.cores);
          const acc = accuracy(s.correct, s.wrong);
          const won = result.winners.includes(s.playerId);
          return (
            <li key={s.playerId} className={styles.podiumCard} data-lane={LANE[s.playerId]} data-won={won || undefined} style={{ animationDelay: `${i * 120}ms` }}>
              <div className={styles.podiumHead}>
                <span className={styles.place}>{won ? (result.outcome === 'tie' ? 'Tied 1st' : 'Champion') : PLACE[rank]}</span>
                <span className={styles.emblem}>{LETTER[s.playerId]}</span>
              </div>
              <strong className={styles.podiumName}>{s.modelId}</strong>
              <span className={styles.provider}>
                {s.provider}
                {s.eliminatedInRound !== null && <span className={styles.out}> · out in round {s.eliminatedInRound}</span>}
              </span>
              <div className={styles.podiumCores}>
                <b>{s.cores}</b> {s.cores === 1 ? 'core' : 'cores'}
              </div>
              <div className={styles.meter} aria-label={acc === null ? 'No questions answered' : `${acc}% accuracy`}>
                <span style={{ width: `${acc ?? 0}%` }} />
              </div>
              <dl className={styles.stats}>
                <div>
                  <dt>Accuracy</dt>
                  <dd>{acc === null ? '—' : `${acc}%`}</dd>
                </div>
                <div>
                  <dt>Right / wrong</dt>
                  <dd>
                    {s.correct} / {s.wrong}
                  </dd>
                </div>
                <div>
                  <dt>Claims · steals · passes</dt>
                  <dd>
                    {s.claims} · {s.steals} · {s.passes}
                  </dd>
                </div>
                <div>
                  <dt>Invalid</dt>
                  <dd>{s.invalid}</dd>
                </div>
                <div>
                  <dt>Avg think</dt>
                  <dd>{s.turns === 0 ? '—' : `${(s.latencyMs / s.turns / 1000).toFixed(1)}s`}</dd>
                </div>
                <div>
                  <dt>Tokens · cost</dt>
                  <dd>
                    {(s.tokens.prompt + s.tokens.completion).toLocaleString('en-US')} · {usd(s.costUsd)}
                  </dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
