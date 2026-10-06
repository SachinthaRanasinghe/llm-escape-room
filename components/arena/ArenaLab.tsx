'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ModelSelect } from '@/components/race/ModelSelect';
import { decodePick, encodePick, priceLabel } from '@/components/race/picks';
import type { ArenaMessage, ArenaPlayerView, ArenaStandingsView, ArenaTurnView, Cores, HostedArenaPoll } from '@/lib/race/arena-wire';
import type { CatalogueResponse, HostedRaceStarted, ProviderCatalogue } from '@/lib/race/wire';
import { ArenaStage, type Finale, type Scene } from './ArenaStage';
import { ArenaDirector } from './director';
import { reached, type PlayerId } from './choreography';
import { PlayerCards } from './PlayerCards';
import { Standings } from './Standings';
import { TurnFeed } from './TurnFeed';
import { usePlayback, useReducedMotion } from './usePlayback';
import styles from './arena.module.css';

/**
 * Energy Core Heist — pick three models and watch them fight over five cores
 * (`docs/decisions/arena.md`).
 *
 * The race page's twin on the wire: it talks to `/api/models` and `/api/arena`
 * and nothing else, holds no key, and follows a match the same two ways — one
 * NDJSON stream locally, polling on the hosted site — through one message
 * handler. What it draws is a game: each turn is replayed beat by beat by the
 * director (`usePlayback`), and the board, scoreboard and log only ever show
 * what playback has reached.
 */

const Arena3D = dynamic(() => import('./Arena3D'), { ssr: false });

const POLL_MS = 1000;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 10;
const LANES = ['a', 'b', 'c'] as const;
const PLAYER_IDS: readonly PlayerId[] = ['player-a', 'player-b', 'player-c'];
/** How long the victory moment holds the stage before the results screen. */
const FINALE_MS = 3200;

type Started = Extract<ArenaMessage, { type: 'started' }>;
type Thinking = Extract<ArenaMessage, { type: 'thinking' }>;

type Stage =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'setup' }
  | { readonly kind: 'running'; readonly startedAt: number }
  | { readonly kind: 'done'; readonly result: Extract<ArenaMessage, { type: 'done' }> }
  | { readonly kind: 'error'; readonly message: string; readonly savedTo: string | null; readonly standings: ArenaStandingsView | null };

interface Live {
  readonly started: Started;
  readonly turns: readonly ArenaTurnView[];
  readonly thinking: Thinking | null;
}

const OPENING: Cores = { 'player-a': 1, 'player-b': 1, 'player-c': 1 };
const NO_TURNS: readonly ArenaTurnView[] = [];

/** Up to three free models, preferring different providers. Never a paid default. */
function defaultPicks(providers: readonly ProviderCatalogue[]): [string, string, string] {
  const usable = providers
    .map((p) => ({ ...p, models: p.models.filter((m) => m.price === null) }))
    .filter((p) => p.keySet && p.models.length > 0);
  const picks: string[] = usable.slice(0, 3).map((p) => encodePick({ provider: p.provider, modelId: p.models[0]!.modelId }));
  for (const p of usable) {
    for (const m of p.models.slice(1)) {
      if (picks.length >= 3) break;
      picks.push(encodePick({ provider: p.provider, modelId: m.modelId }));
    }
  }
  while (picks.length < 3) picks.push(picks[0] ?? '');
  return [picks[0]!, picks[1]!, picks[2]!];
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Nav() {
  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.brand}>
        <span className={styles.brandCore} aria-hidden="true" />
        LLM Escape Room
      </Link>
      <Link href="/race" className={styles.navLink}>
        Race two models →
      </Link>
    </nav>
  );
}

export function ArenaLab() {
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [picks, setPicks] = useState<[string, string, string]>(['', '', '']);
  const [rounds, setRounds] = useState(MAX_ROUNDS);
  const [live, setLive] = useState<Live | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reduced = useReducedMotion();

  // One 3D scene for the whole page. Its canvas lives in a detached element
  // that each stage — the lobby preview, then the match — slots into place, so
  // starting a match never builds a second WebGL context or reloads the park.
  const [director] = useState(() => new ArenaDirector());
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0';
    setHost(el);
    return () => el.remove();
  }, []);
  const scene: Scene = { director, host };
  const canvas = host === null ? null : createPortal(<Arena3D director={director} />, host);

  const load = useCallback(async (refresh: boolean) => {
    setStage({ kind: 'loading' });
    try {
      const response = await fetch(`/api/models${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`the model list could not be loaded (HTTP ${response.status})`);
      const data = (await response.json()) as CatalogueResponse;
      setCatalogue(data);
      const defaults = defaultPicks(data.providers);
      setPicks((current) => (current.every((p) => p === '') ? defaults : current));
      setStage({ kind: 'setup' });
    } catch (error) {
      setStage({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (stage.kind !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage.kind]);

  const setPick = (index: number) => (value: string) =>
    setPicks((current) => {
      const next = [...current] as [string, string, string];
      next[index] = value;
      return next;
    });

  const start = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const players = picks.map(decodePick);
      if (players.some((p) => p === null)) return;

      const abort = new AbortController();
      abortRef.current = abort;
      let current: Live | null = null;
      const update = (next: Live) => {
        current = next;
        setLive(next);
      };
      setLive(null);
      setNow(Date.now());
      director.reset();
      setStage({ kind: 'running', startedAt: Date.now() });

      let finished = false;
      const handle = (message: ArenaMessage) => {
        switch (message.type) {
          case 'started':
            update({ started: message, turns: [], thinking: null });
            return;
          case 'thinking':
            if (current !== null) update({ ...current, thinking: message });
            return;
          case 'turn':
            if (current !== null) update({ ...current, turns: [...current.turns, message.turn], thinking: null });
            return;
          case 'done':
            finished = true;
            if (current !== null) update({ ...current, thinking: null });
            setStage({ kind: 'done', result: message });
            return;
          case 'error':
            finished = true;
            if (current !== null) update({ ...current, thinking: null });
            setStage({ kind: 'error', message: message.message, savedTo: message.savedTo, standings: message.standings ?? null });
            return;
        }
      };

      try {
        const response = await fetch('/api/arena', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ players, rounds }),
          signal: abort.signal,
        });
        if (!response.ok || response.body === null) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setStage({ kind: 'error', message: body?.error ?? `HTTP ${response.status}`, savedTo: null, standings: null });
          return;
        }

        if (response.status === 202) {
          // The hosted site: the match runs in the background; follow it by polling.
          const { raceId } = (await response.json()) as HostedRaceStarted;
          abort.signal.addEventListener('abort', () => {
            void fetch(`/api/arena/${raceId}/cancel`, { method: 'POST', keepalive: true }).catch(() => {});
          });
          let next = 0;
          let misses = 0;
          while (!finished) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            if (abort.signal.aborted) throw new DOMException('cancelled', 'AbortError');
            const poll = await fetch(`/api/arena/${raceId}?from=${next}`, { cache: 'no-store', signal: abort.signal }).catch((error: unknown) => {
              if (abort.signal.aborted) throw error;
              return null;
            });
            if (poll === null || !poll.ok) {
              misses += 1;
              if (misses * POLL_MS > 60_000) break;
              continue;
            }
            misses = 0;
            const body = (await poll.json()) as HostedArenaPoll;
            for (const message of body.messages) handle(message);
            next = body.next;
            if (body.finished) break;
          }
        } else {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              if (line.length > 0) handle(JSON.parse(line) as ArenaMessage);
            }
          }
        }
        if (!finished) setStage({ kind: 'error', message: 'The connection closed before the match finished.', savedTo: null, standings: null });
      } catch (error) {
        const message = abort.signal.aborted ? 'Match cancelled. No winner is named.' : error instanceof Error ? error.message : String(error);
        setStage({ kind: 'error', message, savedTo: null, standings: null });
      } finally {
        abortRef.current = null;
      }
    },
    [picks, rounds, director],
  );

  // ── Playback: what the screen shows lags the wire by the replay ────────────
  const playback = usePlayback(live?.turns ?? NO_TURNS, reduced);
  const view = useMemo(() => {
    if (live === null) return null;
    const { turn, beat } = playback;
    const shown = live.turns.slice(0, playback.played);
    const executed = turn !== null && reached(beat, 'execute');
    const source = executed ? turn : (shown.at(-1) ?? null);
    const out = new Set<PlayerId>(shown.flatMap((t) => (t.eliminated ? [t.eliminated] : [])));
    if (turn?.eliminated && reached(beat, 'eliminate')) out.add(turn.eliminated);
    return {
      shown,
      log: executed ? [...shown, turn] : shown,
      cores: source?.cores ?? live.started.cores,
      centre: source?.centre ?? live.started.centre,
      out,
    };
  }, [live, playback]);

  const running = stage.kind === 'running';
  const thinking = playback.caughtUp && running ? (live?.thinking ?? null) : null;
  const ended = (stage.kind === 'done' || stage.kind === 'error') && playback.caughtUp;
  const result = stage.kind === 'done' ? stage.result.result : stage.kind === 'error' ? stage.standings : null;

  const finale = useMemo<Finale | null>(() => {
    if (!ended || live === null) return null;
    if (stage.kind === 'done') return { kind: stage.result.result.outcome === 'tie' ? 'tie' : 'win', winners: stage.result.result.winners };
    if (stage.kind === 'error' && stage.standings !== null) return { kind: 'halted', winners: [], message: 'A provider stopped the match part-way.' };
    return null;
  }, [ended, live, stage]);

  // The victory moment holds the stage, then the results screen takes over.
  const [showResults, setShowResults] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ended) {
      setShowResults(false);
      return;
    }
    if (reduced || finale === null) {
      setShowResults(true);
      return;
    }
    const id = setTimeout(() => setShowResults(true), FINALE_MS);
    return () => clearTimeout(id);
  }, [ended, reduced, finale]);
  useEffect(() => {
    if (showResults && finale !== null && !reduced) resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [showResults, finale, reduced]);

  if (live !== null && view !== null && stage.kind !== 'setup' && stage.kind !== 'loading' && stage.kind !== 'failed') {
    const players = live.started.players;
    const { turn, beat } = playback;
    const active: PlayerId | null = turn?.playerId ?? thinking?.playerId ?? null;
    const round = turn?.round ?? thinking?.round ?? view.shown.at(-1)?.round ?? 1;
    const solving = thinking?.phase === 'answer' && thinking.question ? { playerId: thinking.playerId, tier: thinking.question.tier, category: thinking.question.category } : null;
    const deciding = thinking?.phase === 'decide' ? thinking.playerId : null;
    const winners = finale?.kind === 'win' || finale?.kind === 'tie' ? finale.winners : [];

    const status: Partial<Record<PlayerId, string>> = {};
    if (turn !== null) {
      status[turn.playerId] =
        turn.action === 'claim' ? 'Claiming a core' : turn.action === 'steal' ? `Raiding Player ${turn.targetId?.slice(-1).toUpperCase()}` : turn.action === 'pass' ? 'Holding position' : 'Invalid move';
      if (turn.action === 'steal' && turn.targetId) status[turn.targetId] = 'Under attack';
    } else if (solving) status[solving.playerId] = `Solving ${solving.tier} ${solving.category}`;
    else if (deciding) status[deciding] = 'Planning a move…';

    const phase = stage.kind === 'running' ? (playback.caughtUp ? 'Live' : 'Replaying') : stage.kind === 'done' ? 'Match over' : 'Stopped';
    const backlog = live.turns.length - playback.played - (turn === null ? 0 : 1);

    return (
      <>
        {canvas}
        <main className={styles.root} data-phase={stage.kind}>
          <div className={styles.wide}>
            <Nav />
            <header className={styles.hud} data-testid="arena-progress" aria-live="polite">
              <div className={styles.hudTitle}>
                <span className={styles.hudLogo}>Energy Core Heist</span>
                <span className={styles.hudPhase} data-phase={stage.kind}>
                  {stage.kind === 'running' && <span className={styles.liveDot} aria-hidden="true" />}
                  {phase}
                </span>
              </div>
              <div className={styles.hudRound}>
                <span className={styles.hudLabel}>
                  Round {Math.min(round, live.started.maxRounds)} of {live.started.maxRounds}
                </span>
                <span className={styles.roundPips} aria-hidden="true">
                  {Array.from({ length: live.started.maxRounds }, (_, i) => (
                    <span key={i} data-on={i < round || undefined} data-now={i === round - 1 || undefined} />
                  ))}
                </span>
              </div>
              <div className={styles.hudTurn}>
                <span className={styles.hudLabel}>{ended ? 'Result' : 'Turn'}</span>
                <b>
                  {ended
                    ? finale?.kind === 'win'
                      ? `Player ${finale.winners[0]!.slice(-1).toUpperCase()} wins`
                      : finale?.kind === 'tie'
                        ? 'Tie'
                        : 'No winner'
                    : active
                      ? `Player ${active.slice(-1).toUpperCase()}`
                      : '—'}
                </b>
              </div>
              {stage.kind === 'running' ? (
                <div className={styles.hudActions}>
                  <span className={styles.clock}>{elapsed(now - stage.startedAt)}</span>
                  {backlog > 0 && (
                    <button type="button" className={styles.ghost} onClick={playback.skip} data-testid="arena-skip">
                      Skip to live ({backlog})
                    </button>
                  )}
                  <button type="button" className={styles.ghost} onClick={() => abortRef.current?.abort()} data-testid="arena-cancel">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className={styles.hudActions}>
                  <span className={styles.hudMessage} role={stage.kind === 'error' ? 'alert' : undefined} data-testid={stage.kind === 'error' ? 'arena-error' : 'arena-done'}>
                    {stage.kind === 'done'
                      ? `${stage.result.providerCalls} model calls${stage.result.savedTo ? ` · saved to ${stage.result.savedTo}` : ''}`
                      : stage.message}
                  </span>
                  {!playback.caughtUp && (
                    <button type="button" className={styles.ghost} onClick={playback.skip} data-testid="arena-skip">
                      Skip replay
                    </button>
                  )}
                  <button type="button" className={styles.launch} onClick={() => setStage({ kind: 'setup' })} data-testid="arena-again">
                    New match
                  </button>
                </div>
              )}
            </header>

            <PlayerCards players={players} cores={view.cores} out={view.out} active={active} status={status} winners={winners} turns={view.log} />

            <div className={styles.layout}>
              <ArenaStage
                players={players}
                cores={view.cores}
                centre={view.centre}
                out={view.out}
                active={ended ? null : active}
                turn={turn}
                beat={beat}
                beatMs={playback.beatMs}
                solving={solving}
                deciding={deciding}
                finale={finale}
                reduced={reduced}
                scene={scene}
              />
              <TurnFeed turns={view.log} players={players} />
            </div>
            <div ref={resultsRef}>{showResults && result !== null && <Standings result={result} stoppedReason={stage.kind === 'error' ? stage.message : undefined} />}</div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      {canvas}
      <Lobby
        catalogue={catalogue}
        stage={stage}
        picks={picks}
        setPick={setPick}
        rounds={rounds}
        setRounds={setRounds}
        onStart={start}
        onReload={() => void load(true)}
        reduced={reduced}
        scene={scene}
      />
    </>
  );
}

function Lobby({
  catalogue,
  stage,
  picks,
  setPick,
  rounds,
  setRounds,
  onStart,
  onReload,
  reduced,
  scene,
}: {
  catalogue: CatalogueResponse | null;
  stage: Stage;
  picks: [string, string, string];
  setPick: (index: number) => (value: string) => void;
  rounds: number;
  setRounds: (rounds: number) => void;
  onStart: (event: FormEvent) => void;
  onReload: () => void;
  reduced: boolean;
  scene: Scene;
}) {
  const paid =
    catalogue === null
      ? []
      : [...new Set(picks)].flatMap((value) => {
          const pick = decodePick(value);
          const model = catalogue.providers.find((p) => p.provider === pick?.provider)?.models.find((m) => m.modelId === pick?.modelId);
          return model?.price ? [{ label: model.label, price: model.price }] : [];
        });

  const preview: ArenaPlayerView[] = PLAYER_IDS.map((id, i) => {
    const pick = decodePick(picks[i]!);
    return { id, provider: pick?.provider ?? 'groq', modelId: pick?.modelId ?? `Player ${id.slice(-1).toUpperCase()}` };
  });

  return (
    <main className={styles.root}>
      <div className={styles.wide}>
        <Nav />
        <header className={styles.lobbyHead}>
          <p className={styles.eyebrow}>{catalogue?.hosted ? 'Live arena' : 'Local arena'} · three models · five cores</p>
          <h1 className={styles.title}>Energy Core Heist</h1>
          <p className={styles.lede}>
            Three AI models share one arena. Each starts with a core in its base; two more sit in the reserve. On its turn a
            model claims, steals or passes — and every grab must be earned by solving a challenge from math, code,
            algorithms, logic, SQL or computer science. Lose your last core and you are out. Most cores after the last round
            wins.
          </p>
        </header>

        <div className={styles.lobby}>
          <ArenaStage
            players={preview}
            cores={OPENING}
            centre={2}
            out={new Set()}
            active={null}
            turn={null}
            beat={null}
            beatMs={0}
            solving={null}
            deciding={null}
            finale={null}
            reduced={reduced}
            scene={scene}
            preview
          />

          <div className={styles.lobbyPanel}>
            <ul className={styles.rules}>
              <li data-kind="claim">
                <b>◆ Claim</b>
                <span>Take a reserve core · medium challenge</span>
              </li>
              <li data-kind="steal">
                <b>⚡ Steal</b>
                <span>Rip a core from a rival · hard challenge</span>
              </li>
              <li data-kind="pass">
                <b>◌ Pass</b>
                <span>Hold position · no challenge</span>
              </li>
            </ul>

            {stage.kind === 'loading' && <p className={styles.status}>Loading the model list from each provider…</p>}

            {stage.kind === 'failed' && (
              <div className={styles.errorBox} role="alert">
                <p>{stage.message}</p>
                <button type="button" className={styles.ghost} onClick={onReload}>
                  Try again
                </button>
              </div>
            )}

            {catalogue && (stage.kind === 'setup' || stage.kind === 'error') && (
              <form className={styles.form} onSubmit={onStart} data-testid="arena-form">
                <h2 className={styles.formTitle}>Choose your contenders</h2>
                <div className={styles.pickers}>
                  {LANES.map((lane, index) => (
                    <ModelSelect
                      key={lane}
                      id={`player-${lane}`}
                      label={`Player ${lane.toUpperCase()}`}
                      lane={lane}
                      value={picks[index]}
                      onChange={setPick(index)}
                      providers={catalogue.providers}
                    />
                  ))}
                </div>

                <label className={styles.roundsField}>
                  <span>Rounds</span>
                  <select value={rounds} onChange={(e) => setRounds(Number(e.target.value))} data-testid="rounds-select">
                    {Array.from({ length: MAX_ROUNDS - MIN_ROUNDS + 1 }, (_, i) => MIN_ROUNDS + i).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <p className={styles.hint} data-testid="arena-quota">
                  Each turn is one or two model calls — decide, then answer — so a match can take up to {rounds * 3 * 2} calls.{' '}
                  {catalogue.hosted
                    ? 'This site runs one race or match at a time and a few per visitor each hour, so the free quota lasts. Matches here are watched, not saved.'
                    : 'Free OpenRouter keys allow 50 requests a day, so three OpenRouter picks may not finish a full match.'}
                </p>

                {paid.length > 0 && (
                  <p className={styles.hint} data-testid="paid-note">
                    Paid: {paid.map((m) => `${m.label} (${priceLabel(m.price)})`).join('; ')}. A match spends real credit on your OpenRouter key.
                  </p>
                )}
                {new Set(picks).size < 3 && picks.every((p) => p !== '') && (
                  <p className={styles.hint}>The same model plays more than one seat — a mirror match shows how much luck the questions bring.</p>
                )}

                {stage.kind === 'error' && (
                  <div className={styles.errorBox} role="alert" data-testid="arena-error">
                    <p>{stage.message}</p>
                  </div>
                )}

                <div className={styles.actions}>
                  <button type="submit" className={styles.launch} disabled={picks.some((p) => p === '')} data-testid="arena-start">
                    Start match
                  </button>
                  <button type="button" className={styles.ghost} onClick={onReload}>
                    Refresh model list
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
