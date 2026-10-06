'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LivePlayer } from '@/components/scene/LivePlayer';
import { ReplayPlayer } from '@/components/scene/ReplayPlayer';
import type {
  CatalogueResponse,
  HostedRacePoll,
  HostedRaceStarted,
  ProviderCatalogue,
  RaceMessage,
  RacePhase,
} from '@/lib/race/wire';
import type { ReplayBeat, ReplayData } from '@/lib/replay';
import type { ComparisonData } from '@/lib/comparison';
import type { EndReason } from '@/lib/schema/run';
import { ModelSelect } from './ModelSelect';
import { decodePick, encodePick, priceLabel } from './picks';
import styles from './race.module.css';

/** How often the hosted page asks for new messages. Beats that arrive together play at the live player's catch-up pace. */
const POLL_MS = 1000;

/**
 * The local race page — pick any two models and watch them race, live. Free
 * models by default; Claude, which has no free tier, is offered marked paid.
 *
 * It talks to `/api/models` and `/api/race` and nothing else. It holds no key and
 * names no provider endpoint: the server reads the keys and calls the models.
 * While the main run is on, every action arrives as a beat the moment the room
 * judges it, and `LivePlayer` plays it in the 3D scene straight away. When the
 * race is saved, the server sends the same `ReplayData` + `RendererSnapshot` +
 * comparison a published run hands the player, so "Watch the replay" plays what
 * `/run/<id>` would play once the run is published.
 */

type Stage =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'setup' }
  | { readonly kind: 'running'; readonly progress: Progress }
  | { readonly kind: 'done'; readonly result: Extract<RaceMessage, { type: 'done' }>; readonly replaying: boolean }
  | { readonly kind: 'error'; readonly message: string; readonly savedTo: string | null }
  /** A provider stopped the main run part-way: the live view stays, with the results so far. */
  | { readonly kind: 'stopped'; readonly message: string; readonly savedTo: string | null; readonly comparison: ComparisonData };

interface Progress {
  readonly started: Extract<RaceMessage, { type: 'started' }> | null;
  readonly phase: RacePhase;
  readonly actions: Readonly<Record<string, number>>;
  readonly dropped: number;
  readonly startedAt: number;
}

/** The main run as it is being played: what the room has judged so far, per competitor. */
interface Live {
  readonly started: Extract<RaceMessage, { type: 'started' }>;
  readonly beats: Readonly<Record<string, readonly ReplayBeat[]>>;
  readonly ended: Readonly<Record<string, EndReason | null>>;
  /** The main run is over — every lane has ended, even one whose end was not reported. */
  readonly over: boolean;
  /** The main run's result, sent the moment it ended — before the silent repeats have run. */
  readonly result: ComparisonData | null;
}

function liveData({ started, beats, ended }: Live): ReplayData {
  return {
    runId: started.runId,
    layout: started.layout,
    lanes: started.competitors.map((c) => ({
      competitorId: c.id,
      label: c.modelId,
      provider: c.provider,
      beats: beats[c.id] ?? [],
      // Shown only once a lane is finished, and replaced by the saved run's own when it arrives.
      endedBecause: ended[c.id] ?? 'budget_actions',
      escaped: ended[c.id] === 'escaped',
      maxActions: started.budget.maxActions,
    })),
  };
}

/** The first two raceable FREE models, preferring two different providers so the default is a cross-lab duel. Never a paid default. */
function defaultPicks(providers: readonly ProviderCatalogue[]): [string, string] {
  const usable = providers
    .map((p) => ({ ...p, models: p.models.filter((m) => m.price === null) }))
    .filter((p) => p.keySet && p.models.length > 0);
  const first = usable[0];
  if (first === undefined) return ['', ''];
  const a = encodePick({ provider: first.provider, modelId: first.models[0]!.modelId });
  const other = usable[1];
  const b = other
    ? encodePick({ provider: other.provider, modelId: other.models[0]!.modelId })
    : first.models[1]
      ? encodePick({ provider: first.provider, modelId: first.models[1].modelId })
      : a;
  return [a, b];
}

function phaseLabel(phase: RacePhase): string {
  return phase.kind === 'hero' ? 'Main run' : `Silent repeat ${phase.index} of ${phase.of}`;
}

function livePhaseLabel(phase: RacePhase): string {
  return phase.kind === 'hero' ? 'Racing' : `Main run over · silent repeat ${phase.index} of ${phase.of}`;
}

function elapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function RaceLab() {
  const [catalogue, setCatalogue] = useState<CatalogueResponse | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [pickA, setPickA] = useState('');
  const [pickB, setPickB] = useState('');
  const [roomId, setRoomId] = useState('');
  const [repeats, setRepeats] = useState(1);
  const [live, setLive] = useState<Live | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (refresh: boolean) => {
    setStage({ kind: 'loading' });
    try {
      const response = await fetch(`/api/models${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`the model list could not be loaded (HTTP ${response.status})`);
      const data = (await response.json()) as CatalogueResponse;
      setCatalogue(data);
      const [a, b] = defaultPicks(data.providers);
      setPickA((current) => current || a);
      setPickB((current) => current || b);
      setRoomId((current) => current || (data.rooms[0]?.id ?? ''));
      setRepeats(data.defaultRepeats);
      setStage({ kind: 'setup' });
    } catch (error) {
      setStage({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => abortRef.current?.abort();
  }, [load]);

  // A one-second tick for the elapsed timer, only while a race runs.
  useEffect(() => {
    if (stage.kind !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [stage.kind]);

  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of catalogue?.providers ?? []) {
      for (const model of provider.models) map.set(encodePick({ provider: provider.provider, modelId: model.modelId }), `${model.label} · ${provider.name}`);
    }
    return map;
  }, [catalogue]);

  const start = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const a = decodePick(pickA);
      const b = decodePick(pickB);
      if (a === null || b === null) return;

      const abort = new AbortController();
      abortRef.current = abort;
      let progress: Progress = { started: null, phase: { kind: 'hero' }, actions: {}, dropped: 0, startedAt: Date.now() };
      let current = null as Live | null;
      const updateLive = (next: Live) => {
        current = next;
        setLive(next);
      };
      setLive(null);
      setNow(Date.now());
      setStage({ kind: 'running', progress });

      // One handler for both transports: the local NDJSON stream and the hosted poll.
      let finished = false;
      const handle = (message: RaceMessage) => {
        switch (message.type) {
          case 'started':
            progress = { ...progress, started: message };
            updateLive({ started: message, beats: {}, ended: {}, over: false, result: null });
            break;
          case 'phase':
            progress = { ...progress, phase: message.phase, actions: {} };
            if (message.phase.kind === 'repeat' && current !== null) updateLive({ ...current, over: true });
            break;
          case 'beat':
            if (current !== null) {
              const { competitorId, beat, ended } = message;
              updateLive({
                ...current,
                beats: { ...current.beats, [competitorId]: [...(current.beats[competitorId] ?? []), beat] },
                ended: { ...current.ended, [competitorId]: ended },
              });
            }
            return;
          case 'result':
            if (current !== null) updateLive({ ...current, over: true, result: message.comparison });
            return;
          case 'action':
            progress = { ...progress, actions: { ...progress.actions, [message.competitorId]: message.actions } };
            break;
          case 'dropped':
            progress = { ...progress, dropped: progress.dropped + 1 };
            break;
          case 'done':
            finished = true;
            setStage({ kind: 'done', result: message, replaying: false });
            return;
          case 'error':
            finished = true;
            if (message.comparison !== null && current !== null) {
              setStage({ kind: 'stopped', message: message.message, savedTo: message.savedTo, comparison: message.comparison });
            } else {
              setStage({ kind: 'error', message: message.message, savedTo: message.savedTo });
            }
            return;
        }
        setStage({ kind: 'running', progress });
      };

      try {
        const response = await fetch('/api/race', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ a, b, roomId, repeats }),
          signal: abort.signal,
        });
        if (!response.ok || response.body === null) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setStage({ kind: 'error', message: body?.error ?? `HTTP ${response.status}`, savedTo: null });
          return;
        }

        if (response.status === 202) {
          // The hosted site: the race runs in the background; follow it by polling.
          const { raceId } = (await response.json()) as HostedRaceStarted;
          abort.signal.addEventListener('abort', () => {
            void fetch(`/api/race/${raceId}/cancel`, { method: 'POST', keepalive: true }).catch(() => {});
          });
          let next = 0;
          let misses = 0;
          while (!finished) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            if (abort.signal.aborted) throw new DOMException('cancelled', 'AbortError');
            const poll = await fetch(`/api/race/${raceId}?from=${next}`, { cache: 'no-store', signal: abort.signal }).catch((error: unknown) => {
              if (abort.signal.aborted) throw error;
              return null;
            });
            if (poll === null || !poll.ok) {
              // A dropped poll is retried; a minute of them is a lost race.
              misses += 1;
              if (misses * POLL_MS > 60_000) break;
              continue;
            }
            misses = 0;
            const body = (await poll.json()) as HostedRacePoll;
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
              if (line.length === 0) continue;
              handle(JSON.parse(line) as RaceMessage);
            }
          }
        }
        if (!finished) setStage({ kind: 'error', message: 'The connection closed before the race finished.', savedTo: null });
      } catch (error) {
        if (abort.signal.aborted) {
          setStage({ kind: 'error', message: 'Race cancelled. Nothing was published.', savedTo: null });
        } else {
          setStage({ kind: 'error', message: error instanceof Error ? error.message : String(error), savedTo: null });
        }
      } finally {
        abortRef.current = null;
      }
    },
    [pickA, pickB, roomId, repeats],
  );

  const liveView = useMemo(() => (live === null ? null : liveData(live)), [live]);

  if (stage.kind === 'done' && (stage.replaying || liveView === null)) {
    const { result } = stage;
    return (
      <div className={styles.doneRoot}>
        <SavedBar result={result} onAgain={() => setStage({ kind: 'setup' })} />
        <ReplayPlayer data={result.data} renderer={result.renderer} comparison={result.comparison} />
      </div>
    );
  }

  // The live view stays mounted from the first beat through the saved result, so
  // its clocks carry on where they are when the race is saved.
  if (live !== null && liveView !== null && (stage.kind === 'running' || stage.kind === 'done' || stage.kind === 'stopped')) {
    const done = stage.kind === 'done' ? stage.result : null;
    const stopped = stage.kind === 'stopped' ? stage : null;
    return (
      <div className={styles.doneRoot}>
        {done ? (
          <SavedBar
            result={done}
            onAgain={() => setStage({ kind: 'setup' })}
            onReplay={() => setStage({ kind: 'done', result: done, replaying: true })}
          />
        ) : stopped ? (
          <div className={`${styles.savedBar} ${styles.stoppedBar}`} role="alert" data-testid="race-stopped">
            <span>{stopped.message}</span>
            <button type="button" className={styles.secondary} onClick={() => setStage({ kind: 'setup' })} data-testid="race-again">
              New race
            </button>
          </div>
        ) : null}
        <LivePlayer
          data={done ? done.data : liveView}
          renderer={done ? done.renderer : live.started.renderer}
          finished={live.started.competitors.map(
            (c) => done !== null || stopped !== null || live.over || (live.ended[c.id] ?? null) !== null,
          )}
          endLabels={stopped?.comparison.rows.map((row) => row.result)}
          comparison={done?.comparison ?? stopped?.comparison ?? live.result ?? undefined}
          status={
            stage.kind === 'running' && (
              <div className={styles.liveStatus} data-testid="race-progress">
                <span>{livePhaseLabel(stage.progress.phase)}</span>
                <span className={styles.clock}>
                  <span className={styles.clockLabel}>Race time</span> {elapsed(now - stage.progress.startedAt)}
                </span>
                <button type="button" className={styles.secondary} onClick={() => abortRef.current?.abort()} data-testid="race-cancel">
                  Cancel
                </button>
              </div>
            )
          }
        />
      </div>
    );
  }

  return (
    <main className={styles.root}>
      <div className={styles.inner}>
        <nav className={styles.nav}>
          <Link href="/" className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <span />
              <span />
            </span>
            LLM Escape Room
          </Link>
          <Link href="/run/canonical" className={styles.navLink}>
            Watch a published run →
          </Link>
        </nav>
        <header className={styles.header}>
          <p className={styles.eyebrow}>{catalogue?.hosted ? 'Live race' : 'Local race'}</p>
          <h1 className={styles.title}>Race two models</h1>
          {catalogue?.hosted ? (
            <p className={styles.lede}>
              Pick any two free models. They race the same room with the same tools, and you watch them play it live in 3D
              as each model decides. A race takes a few minutes.
            </p>
          ) : (
            <p className={styles.lede}>
              Pick any two models — free ones, or Claude on a paid OpenRouter key. They race the same room with the same
              tools, and you watch them play it live in 3D as each model decides. A race makes live calls on the keys in your <code>.env</code> and takes a few minutes.
            </p>
          )}
        </header>

        {stage.kind === 'loading' && <p className={styles.status}>Loading the model list from each provider…</p>}

        {stage.kind === 'failed' && (
          <div className={styles.errorBox} role="alert">
            <p>{stage.message}</p>
            <button type="button" className={styles.secondary} onClick={() => void load(true)}>
              Try again
            </button>
          </div>
        )}

        {catalogue && (stage.kind === 'setup' || stage.kind === 'error') && (
          <form className={styles.form} onSubmit={start} data-testid="race-form">
            <div className={styles.pickers}>
              <ModelSelect id="model-a" label="Model A" lane="a" value={pickA} onChange={setPickA} providers={catalogue.providers} />
              <span className={styles.versus} aria-hidden>
                vs
              </span>
              <ModelSelect id="model-b" label="Model B" lane="b" value={pickB} onChange={setPickB} providers={catalogue.providers} />
            </div>

            <div className={styles.options}>
              <label className={styles.field}>
                <span>Room</span>
                <select value={roomId} onChange={(e) => setRoomId(e.target.value)} data-testid="room-select">
                  {catalogue.rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Silent repeats</span>
                <select value={repeats} onChange={(e) => setRepeats(Number(e.target.value))} data-testid="repeats-select">
                  {Array.from({ length: catalogue.maxRepeats + 1 }, (_, n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'None' : n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={styles.hint}>
              Repeats replay the same room out of sight so the result can say whether this run was typical.{' '}
              {catalogue.hosted
                ? 'Each one is another full race of calls on the free quota this site shares.'
                : 'Each one costs another full race of calls, and free OpenRouter keys allow 50 requests a day.'}
            </p>
            {catalogue.hosted && (
              <p className={styles.hint} data-testid="public-limits">
                This site runs one race at a time, a few per visitor each hour, and a fixed number a day, so the free quota
                lasts. Races here are watched, not saved.
              </p>
            )}

            <PaidNote picks={[pickA, pickB]} repeats={repeats} providers={catalogue.providers} />

            {pickA === pickB && pickA !== '' && (
              <p className={styles.hint}>Both sides are the same model — a race against itself shows run-to-run variance.</p>
            )}

            {stage.kind === 'error' && (
              <div className={styles.errorBox} role="alert" data-testid="race-error">
                <p>{stage.message}</p>
                {stage.savedTo && (
                  <p className={styles.hint}>
                    The partial log is in <code>{stage.savedTo}</code>.
                  </p>
                )}
              </div>
            )}

            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={!pickA || !pickB || !roomId} data-testid="race-start">
                Start race
              </button>
              <button type="button" className={styles.secondary} onClick={() => void load(true)}>
                Refresh model list
              </button>
            </div>

            <ProviderNotes providers={catalogue.providers} hosted={catalogue.hosted} />
          </form>
        )}

        {stage.kind === 'running' && (
          <section className={styles.running} aria-live="polite" data-testid="race-progress">
            <div className={styles.runningHead}>
              <h2>{phaseLabel(stage.progress.phase)}</h2>
              <span className={styles.clock}>{elapsed(now - stage.progress.startedAt)}</span>
            </div>
            {stage.progress.started && <p className={styles.hint}>{stage.progress.started.roomLabel}</p>}
            <div className={styles.lanes}>
              {(stage.progress.started?.competitors ?? []).map((c, i) => {
                const done = stage.progress.actions[c.id] ?? 0;
                const max = stage.progress.started!.budget.maxActions;
                return (
                  <div key={c.id} className={styles.laneCard} data-lane={i === 0 ? 'a' : 'b'}>
                    <div className={styles.laneName}>{labels.get(encodePick(c)) ?? c.modelId}</div>
                    <div className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={done}>
                      <div className={styles.meterFill} style={{ width: `${Math.min(100, (done / max) * 100)}%` }} />
                    </div>
                    <div className={styles.hint}>
                      {done} of at most {max} actions
                    </div>
                  </div>
                );
              })}
            </div>
            {stage.progress.dropped > 0 && (
              <p className={styles.hint}>{stage.progress.dropped} repeat(s) dropped after a provider error — they are not counted.</p>
            )}
            <button type="button" className={styles.secondary} onClick={() => abortRef.current?.abort()} data-testid="race-cancel">
              Cancel
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

/** Shown when a pick costs money: what it costs, and that every silent repeat costs it again. */
function PaidNote({ picks, repeats, providers }: { picks: readonly string[]; repeats: number; providers: readonly ProviderCatalogue[] }) {
  const paid = [...new Set(picks)].flatMap((value) => {
    const pick = decodePick(value);
    const model = providers.find((p) => p.provider === pick?.provider)?.models.find((m) => m.modelId === pick?.modelId);
    return model?.price ? [{ label: model.label, price: model.price }] : [];
  });
  if (paid.length === 0) return null;
  return (
    <div className={styles.hint} role="note" data-testid="paid-note">
      <p>
        <strong>This race costs money.</strong> Claude has no free tier, so it is billed to the credit on your OpenRouter
        key, and the results show what it cost.
      </p>
      <ul>
        {paid.map((m) => (
          <li key={m.label}>
            {m.label}: {priceLabel(m.price)}
          </li>
        ))}
      </ul>
      {repeats > 0 && (
        <p>
          The main run plus {repeats} silent repeat{repeats === 1 ? '' : 's'} is {repeats + 1} full races of calls — set
          repeats to None to pay for one.
        </p>
      )}
    </div>
  );
}

function ProviderNotes({ providers, hosted }: { providers: readonly ProviderCatalogue[]; hosted: boolean }) {
  const missing = providers.filter((p) => !p.keySet);
  const failed = providers.filter((p) => p.error !== null);
  const excluded = providers.flatMap((p) => p.excluded.map((e) => ({ ...e, provider: p.name })));
  const total = providers.reduce((n, p) => n + (p.keySet ? p.models.filter((m) => m.price === null).length : 0), 0);
  const paid = providers.reduce((n, p) => n + (p.keySet ? p.models.filter((m) => m.price !== null).length : 0), 0);

  return (
    <div className={styles.notes} data-testid="provider-notes">
      <p className={styles.hint}>
        {total} free models{paid > 0 && <> and {paid} paid Claude models</>} ready to race, listed live from{' '}
        {providers
          .filter((p) => p.keySet)
          .map((p) => p.name)
          .join(', ') || 'no provider yet'}
        . Only models that can be forced to make a tool call are offered, so every model plays by the same rules.
      </p>
      {!hosted && missing.map((p) => (
        <p key={p.provider} className={styles.hint}>
          <strong>{p.name}</strong>: add <code>{p.keyVar}=…</code> to <code>.env</code> and restart <code>pnpm dev</code>
          {p.models.length > 0 && <> to unlock {p.models.length} more models</>}.
          {p.provider === 'openrouter' && (
            <> A free key comes from the Keys page of your OpenRouter account; racing Claude needs credit on it.</>
          )}
        </p>
      ))}
      {failed.map((p) => (
        <p key={p.provider} className={styles.hint}>
          <strong>{p.name}</strong>: the model list failed to load — {p.error}
        </p>
      ))}
      {excluded.length > 0 && (
        <details>
          <summary className={styles.hint}>{excluded.length} listed models left out, and why</summary>
          <ul className={styles.excluded}>
            {excluded.map((e) => (
              <li key={`${e.provider}-${e.modelId}`}>
                <code>{e.modelId}</code> ({e.provider}) — {e.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SavedBar({
  result,
  onAgain,
  onReplay,
}: {
  result: Extract<RaceMessage, { type: 'done' }>;
  onAgain: () => void;
  onReplay?: () => void;
}) {
  return (
    <div className={styles.savedBar} data-testid="race-saved">
      <span>
        {result.savedTo !== null ? (
          <>
            Saved to <code>{result.savedTo}</code> ·{' '}
          </>
        ) : (
          <>Race finished · </>
        )}
        {result.providerCalls} provider calls
        {result.unpriced.length > 0 && <> · no price on file for {result.unpriced.join(', ')} (shown as $0)</>}
      </span>
      {result.publishCommand !== null && (
        <details className={styles.publish}>
          <summary>Publish this run</summary>
          <p>Publishing freezes it at a shareable <code>/run/&lt;id&gt;</code> URL after the next build:</p>
          <code className={styles.command}>{result.publishCommand}</code>
        </details>
      )}
      {onReplay && (
        <button type="button" className={styles.secondary} onClick={onReplay} data-testid="race-replay">
          Watch the replay
        </button>
      )}
      <button type="button" className={styles.secondary} onClick={onAgain} data-testid="race-again">
        New race
      </button>
    </div>
  );
}
