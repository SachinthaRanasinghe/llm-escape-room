'use client';

import { useEffect, useRef, useState } from 'react';
import type { ArenaPlayerView, ArenaTurnView, Cores } from '@/lib/race/arena-wire';
import { LANE, LAYOUT, LETTER, reached, type Beat, type Owner, type PlayerId } from './choreography';
import { ChallengeCard, type Solving } from './ChallengeCard';
import type { ArenaDirector } from './director';
import styles from './arena.module.css';

/**
 * The arena itself: a 3D scene (`Arena3D.tsx`) under a layer of DOM — the base
 * tags, the action banner, the challenge card and the big moments (round
 * splash, elimination, victory). The DOM carries every number and word, so the
 * stage reads the same to a screen reader, a test and a viewer.
 *
 * React decides WHAT is on screen from the playback beat; the director
 * (`director.ts`) decides how the robots and cores move. Effects here translate
 * beats into director calls, once per beat.
 */

/** The page's one 3D scene: its director, and the element its canvas is drawn in. */
export interface Scene {
  readonly director: ArenaDirector;
  readonly host: HTMLElement | null;
}

export interface Finale {
  readonly kind: 'win' | 'tie' | 'halted';
  readonly winners: readonly PlayerId[];
  readonly message?: string;
}

interface Props {
  readonly players: readonly Pick<ArenaPlayerView, 'id' | 'modelId' | 'provider'>[];
  readonly cores: Cores;
  readonly centre: number;
  readonly out: ReadonlySet<PlayerId>;
  readonly active: PlayerId | null;
  /** The turn being played back, and its beat. */
  readonly turn: ArenaTurnView | null;
  readonly beat: Beat | null;
  readonly beatMs: number;
  /** A model call in flight, once playback has caught up. */
  readonly solving: Solving | null;
  readonly deciding: PlayerId | null;
  readonly finale: Finale | null;
  readonly reduced: boolean;
  /** The lobby's idle preview: no HUD overlays. */
  readonly preview?: boolean;
  readonly scene: Scene;
}

function shortModel(modelId: string, max = 28): string {
  const name = modelId.includes('/') ? modelId.slice(modelId.indexOf('/') + 1) : modelId;
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

function Banner({ turn, beat, deciding, solving, names }: { turn: ArenaTurnView | null; beat: Beat | null; deciding: PlayerId | null; solving: Solving | null; names: Record<string, string> }) {
  if (turn !== null) {
    const actor = turn.playerId;
    const verb = turn.action === 'claim' ? 'CLAIM' : turn.action === 'steal' ? 'STEAL' : turn.action === 'pass' ? 'HOLD' : 'INVALID MOVE';
    const target = turn.action === 'claim' ? 'CORE RESERVE' : turn.action === 'steal' && turn.targetId ? `PLAYER ${LETTER[turn.targetId]}` : null;
    return (
      <div className={styles.banner} data-lane={LANE[actor]} data-kind={turn.action} key={`${turn.seq}`} data-testid="arena-action">
        <span className={styles.bannerActor}>
          <b>{LETTER[actor]}</b> {shortModel(names[actor] ?? '', 22)}
        </span>
        <span className={styles.bannerVerb}>{verb}</span>
        {target !== null && (
          <span className={styles.bannerTarget} data-lane={turn.targetId ? LANE[turn.targetId] : undefined}>
            {target}
          </span>
        )}
        {turn.action === 'pass' && <span className={styles.bannerNote}>shields up · turn passed</span>}
        {turn.action === 'invalid' && <span className={styles.bannerNote}>turn lost</span>}
        {beat !== null && turn.question !== null && (
          <span className={styles.bannerNote}>{turn.action === 'claim' ? 'medium challenge to claim' : 'hard challenge to steal'}</span>
        )}
      </div>
    );
  }
  const who = solving?.playerId ?? deciding;
  if (who === null) return null;
  return (
    <div className={styles.banner} data-lane={LANE[who]} data-kind="thinking" key={`think-${who}-${solving ? 's' : 'd'}`}>
      <span className={styles.bannerActor}>
        <b>{LETTER[who]}</b> {shortModel(names[who] ?? '', 22)}
      </span>
      <span className={styles.bannerVerb}>{solving ? 'SOLVING' : 'PLANNING'}</span>
      <span className={styles.bannerNote}>
        {solving ? `${solving.tier} ${solving.category} challenge — ${solving.tier === 'hard' ? 'a steal' : 'a claim'} rides on it` : 'choosing: claim · steal · pass'}
        <span className={styles.dots} aria-hidden="true" />
      </span>
    </div>
  );
}

/** The left of the console: what the acting model says it is doing, in its own words. */
function Comms({ turn, beat, deciding, solving, finale, names }: { turn: ArenaTurnView | null; beat: Beat | null; deciding: PlayerId | null; solving: Solving | null; finale: Finale | null; names: Record<string, string> }) {
  const who = turn?.playerId ?? solving?.playerId ?? deciding;
  if (who == null) {
    return (
      <section className={styles.comms} aria-label="Comms">
        <header className={styles.commsHead}>Comms</header>
        <p className={styles.commsIdle}>{finale === null ? 'Waiting for the next move…' : finale.kind === 'halted' ? 'Transmission lost — the match stopped.' : 'Match complete. Final results incoming.'}</p>
      </section>
    );
  }
  let line: string;
  if (turn !== null) line = turn.action === 'invalid' ? turn.decisionMessage : (turn.intent ?? 'No intent given.');
  else if (solving !== null) line = `Working the ${solving.tier} ${solving.category} challenge…`;
  else line = 'Reading the board — claim, steal or pass?';
  const answerNote = turn !== null && reached(beat, 'answer') && turn.answerIntent ? turn.answerIntent : null;
  return (
    <section className={styles.comms} data-lane={LANE[who]} aria-label="Comms" key={`${who}-${turn?.seq ?? 'live'}`}>
      <header className={styles.commsHead}>
        <span className={styles.letter}>{LETTER[who]}</span>
        <span className={styles.commsName}>{shortModel(names[who] ?? '', 34)}</span>
        <span className={styles.commsTag}>{turn === null ? 'live' : 'strategy'}</span>
      </header>
      <blockquote className={styles.commsQuote} data-thinking={turn === null || undefined}>
        {turn === null || turn.action === 'invalid' ? line : `“${line}”`}
      </blockquote>
      {answerNote !== null && <p className={styles.commsNote}>Answer reasoning: “{answerNote}”</p>}
    </section>
  );
}

export function ArenaStage({ players, cores, centre, out, active, turn, beat, beatMs, solving, deciding, finale, reduced, preview = false, scene }: Props) {
  const { director, host } = scene;
  const slot = useRef<HTMLDivElement>(null);

  // Slot the shared canvas into this stage while it is on screen.
  useEffect(() => {
    const el = slot.current;
    if (el === null || host === null) return;
    el.appendChild(host);
    return () => {
      if (host.parentElement === el) host.remove();
    };
  }, [host]);
  const [round, setRound] = useState<number | null>(null);

  useEffect(() => director.setReduced(reduced), [director, reduced]);

  // Beats → director, once each. Declared before the board sync so a grab is
  // known before the core it carries changes hands.
  const seq = turn?.seq ?? null;
  useEffect(() => {
    if (turn === null || beat === null) return;
    const actor = turn.playerId;
    const worked = turn.outcome === 'claimed' || turn.outcome === 'stole';
    const target = turn.action === 'claim' ? 'centre' : turn.action === 'steal' ? turn.targetId : null;
    switch (beat) {
      case 'lock':
        if (target) director.approach(actor, target, beatMs);
        else if (turn.action === 'pass') director.shield(actor);
        else director.glitch(actor);
        break;
      case 'challenge':
        director.hack(actor);
        break;
      case 'verdict':
        director.verdict(actor, turn.correct === true);
        break;
      case 'execute':
        if (worked && target) director.grab(actor, target, beatMs);
        else director.retreat(actor, beatMs);
        director.clearLock();
        break;
      case 'eliminate':
        if (turn.eliminated) director.eliminate(turn.eliminated);
        break;
    }
  }, [seq, beat]);

  // Round splash on the first beat of a new round.
  const turnRound = turn?.round ?? null;
  useEffect(() => {
    if (turnRound === null || reduced) return;
    setRound(turnRound);
  }, [turnRound, reduced]);
  useEffect(() => {
    if (round === null) return;
    const id = setTimeout(() => setRound(null), 1500);
    return () => clearTimeout(id);
  }, [round]);

  // Between turns: a live model call, or everyone home.
  const solvingId = solving?.playerId ?? null;
  const between = turn === null;
  useEffect(() => {
    if (!between) return;
    director.clearLock();
    if (solvingId !== null) director.think(solvingId);
    else {
      director.setCharging(null);
      director.settle();
    }
  }, [director, solvingId, between]);

  useEffect(() => {
    director.setBoard(cores, centre, beat !== 'execute');
  }, [director, cores, centre, beat]);

  const winnersKey = finale?.kind === 'halted' ? '' : (finale?.winners.join(',') ?? '');
  useEffect(() => {
    director.setStatus({ active, out, winners: winnersKey === '' ? [] : (winnersKey.split(',') as PlayerId[]) });
  }, [director, active, out, winnersKey]);

  useEffect(() => {
    if (winnersKey !== '') director.victory(winnersKey.split(',') as PlayerId[]);
  }, [director, winnersKey]);

  // The wall screens: names, the round, and the move in progress.
  const labelKey = players.map((p) => `${p.id}=${p.modelId}`).join('|');
  useEffect(() => {
    director.labels = Object.fromEntries(players.map((p) => [p.id, p.modelId]));
  }, [director, labelKey]);
  useEffect(() => {
    director.round = turn?.round ?? director.round;
    if (turn !== null) {
      const who = `PLAYER ${LETTER[turn.playerId]}`;
      const text =
        turn.action === 'claim'
          ? `${who} ▸ CLAIM\n${reached(beat, 'verdict') ? (turn.correct ? 'CHALLENGE CLEARED' : 'CHALLENGE FAILED') : 'HACKING THE RESERVE'}`
          : turn.action === 'steal' && turn.targetId
            ? `${who} ▸ STEAL ▸ ${LETTER[turn.targetId]}\n${reached(beat, 'verdict') ? (turn.correct ? 'BREACH SUCCESSFUL' : 'BREACH REPELLED') : 'BREACHING DEFENCES'}`
            : turn.action === 'pass'
              ? `${who} ▸ HOLD\nSHIELDS UP`
              : `${who}\nINVALID MOVE`;
      director.headline = { text, lane: turn.playerId };
    } else if (solving !== null) {
      director.headline = { text: `PLAYER ${LETTER[solving.playerId]}\nSOLVING ${solving.tier.toUpperCase()} ${solving.category.toUpperCase()}`, lane: solving.playerId };
    } else if (deciding !== null) {
      director.headline = { text: `PLAYER ${LETTER[deciding]}\nPLANNING MOVE`, lane: deciding };
    } else {
      director.headline = null;
    }
  });

  const pin = (owner: Owner) => (el: HTMLElement | null) => {
    if (el) director.anchors.set(owner, el);
    else director.anchors.delete(owner);
  };

  const names = Object.fromEntries(players.map((p) => [p.id, p.modelId]));
  const showChallenge = turn !== null && turn.question !== null && beat !== null && reached(beat, 'challenge') ? turn : null;
  const delta = turn !== null && reached(beat, 'execute') && (turn.outcome === 'claimed' || turn.outcome === 'stole') ? turn : null;
  const knocked = turn !== null && reached(beat, 'eliminate') ? turn.eliminated : null;
  const summary = [...players.map((p) => `${LETTER[p.id]} (${p.modelId}): ${out.has(p.id) ? 'eliminated' : `${cores[p.id]} cores`}`), `centre: ${centre}`].join('; ');

  return (
    <figure className={styles.stage} data-preview={preview || undefined} data-testid="arena-board">
      <figcaption className={styles.srOnly}>{summary}</figcaption>
      <div className={styles.arena}>
        <div className={styles.canvas} ref={slot} aria-hidden="true" />

        <div className={styles.centreTag} ref={pin('centre')} style={{ left: `${LAYOUT.centre.x * 100}%`, top: `${LAYOUT.centre.y * 100}%` }}>
          <span>Core reserve</span>
          <b data-testid="centre-cores">{centre}</b>
        </div>

        {players.map((p) => {
          const isOut = out.has(p.id);
          const won = finale !== null && finale.kind !== 'halted' && finale.winners.includes(p.id);
          const at = LAYOUT[p.id];
          const gained = delta !== null && delta.playerId === p.id;
          const lost = delta !== null && delta.action === 'steal' && delta.targetId === p.id;
          return (
            <div
              key={p.id}
              ref={pin(p.id)}
              className={styles.baseTag}
              style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
              data-lane={LANE[p.id]}
              data-out={isOut || undefined}
              data-active={active === p.id || undefined}
              data-won={won || undefined}
              data-testid={`base-${p.id}`}
            >
              <div className={styles.baseName}>
                <span className={styles.letter}>{LETTER[p.id]}</span>
                <span title={p.modelId}>{shortModel(p.modelId)}</span>
              </div>
              <div className={styles.baseCount}>
                <b key={cores[p.id]} data-testid={`base-${p.id}-cores`}>
                  {cores[p.id]}
                </b>{' '}
                {cores[p.id] === 1 ? 'core' : 'cores'}
                {isOut ? <span className={styles.outTag}> · ELIMINATED</span> : won ? <span className={styles.wonTag}> · WINNER</span> : null}
              </div>
              {gained && (
                <span className={styles.delta} data-sign="up" key={`up-${delta.seq}`}>
                  +1 CORE
                </span>
              )}
              {lost && (
                <span className={styles.delta} data-sign="down" key={`down-${delta.seq}`}>
                  −1 CORE
                </span>
              )}
            </div>
          );
        })}

        {!preview && (
          <>
            <div className={styles.bannerSlot} aria-live="polite">
              <Banner turn={turn} beat={beat} deciding={deciding} solving={turn === null ? solving : null} names={names} />
            </div>

            {round !== null && (
              <div className={styles.roundSplash} key={`round-${round}`} aria-hidden="true">
                <span>Round</span>
                <b>{round}</b>
              </div>
            )}

            {knocked !== null && (
              <div className={styles.knockout} data-lane={LANE[knocked]} key={`ko-${turn?.seq}`} role="status">
                <span className={styles.knockoutLabel}>Eliminated</span>
                <b>Player {LETTER[knocked]}</b>
                <span>{shortModel(names[knocked] ?? '', 40)} has no cores left</span>
              </div>
            )}

            {finale !== null && (
              <div className={styles.finale} data-kind={finale.kind} data-lane={finale.winners.length === 1 ? LANE[finale.winners[0]!] : undefined} role="status">
                {finale.kind === 'halted' ? (
                  <>
                    <span className={styles.finaleLabel}>Match halted</span>
                    <b>No winner</b>
                    {finale.message && <span className={styles.finaleNote}>{finale.message}</span>}
                  </>
                ) : (
                  <>
                    <span className={styles.finaleLabel}>{finale.kind === 'win' ? 'Victory' : 'Draw'}</span>
                    <b>{finale.winners.map((id) => `Player ${LETTER[id]}`).join(' & ')}</b>
                    <span className={styles.finaleNote}>{finale.winners.map((id) => names[id]).join(' · ')}</span>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {!preview && (
        <div className={styles.console}>
          <Comms turn={turn} beat={beat} deciding={deciding} solving={turn === null ? solving : null} finale={finale} names={names} />
          <div className={styles.consoleChallenge}>
            {showChallenge !== null || (turn === null && solving !== null) ? (
              <ChallengeCard turn={showChallenge} beat={beat} solving={turn === null ? solving : null} />
            ) : (
              <div className={styles.idleChallenge}>
                {turn?.action === 'pass'
                  ? 'No challenge — a pass risks nothing'
                  : turn?.action === 'invalid'
                    ? 'No challenge — the move was refused before one was drawn'
                    : 'No challenge in play'}
              </div>
            )}
          </div>
        </div>
      )}
    </figure>
  );
}
