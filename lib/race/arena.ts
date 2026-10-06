import { join, relative } from 'node:path';
import { z } from 'zod';

import { findLeaks } from '@/lib/artifact';
import {
  MatchAbortedError,
  PLAYER_IDS,
  partialStandings,
  questionText,
  runMatch,
  type ArenaEvent,
  type ArenaResult,
  type ArenaStanding,
} from '@/lib/arena';
import { costOf, type PriceTable } from '@/lib/harness';
import { ProviderError, createAdapter, readProviderKey, type ProviderAdapter } from '@/lib/providers';
import type { Competitor } from '@/lib/schema/run';
import type { ArenaMessage, ArenaRequest, ArenaStandingsView, ArenaTurnView } from './arena-wire';
import { PickSchema, RaceError, checkPicks, pricesFor, publicRace, raceEnabled, releaseLocalLock, slug, takeLocalLock, write } from './index';

/**
 * The arena match, run from a web request — `docs/decisions/arena.md`.
 *
 * The race's twin (`lib/race/index.ts`) for the three-player game: the same
 * live catalogue and checks, the same one-at-a-time lock, the same leak scan on
 * everything that reaches the page, and the same split between the local page
 * (an NDJSON stream, files under `runs/`) and the hosted one (a background
 * function, nothing saved). It holds the keys' call path, so only `app/api/` may
 * import it (`secrets.test.ts`).
 */

export const ARENA_MIN_ROUNDS = 3;
export const ARENA_MAX_ROUNDS = 10;
export const ARENA_DEFAULT_ROUNDS = 10;

const ArenaRequestSchema = z.strictObject({
  players: z.tuple([PickSchema, PickSchema, PickSchema]),
  rounds: z.number().int().min(ARENA_MIN_ROUNDS).max(ARENA_MAX_ROUNDS),
});

export function parseArenaRequest(raw: unknown): ArenaRequest {
  const result = ArenaRequestSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new RaceError(400, `invalid arena request: ${issue?.path.join('.') || 'body'} ${issue?.message ?? ''}`.trim());
  }
  return result.data;
}

/** A match that passed every check. Hand it to `runArena` exactly once. */
export interface PreparedArena {
  readonly request: ArenaRequest;
  readonly prices: PriceTable;
}

/** Enabled, and every pick in the catalogue with its key set (free only on the public site). */
export async function checkArena(request: ArenaRequest): Promise<PreparedArena> {
  if (!raceEnabled()) throw new RaceError(404, 'the arena is disabled in this build');
  const priced = await checkPicks(request.players, publicRace());
  return { request, prices: pricesFor(priced) };
}

/** `checkArena`, then the local lock — shared with the race. `runArena` releases it. */
export async function prepareArena(request: ArenaRequest): Promise<PreparedArena> {
  if (!raceEnabled()) throw new RaceError(404, 'the arena is disabled in this build');
  const prepared = await checkArena(request);
  if (!takeLocalLock()) throw new RaceError(409, 'a race or match is already running — wait for it to finish');
  return prepared;
}

/* ── Views ──────────────────────────────────────────────────────────────── */

const WITHHELD = 'Withheld from the live view: this turn contained a URL or key-shaped text.';

export function turnView(event: ArenaEvent): ArenaTurnView {
  const decision = event.decision.action;
  const legal = decision !== null && event.decision.verdict.ok;
  const view: ArenaTurnView = {
    seq: event.seq,
    round: event.round,
    playerId: event.playerId,
    action: legal ? decision.name : 'invalid',
    targetId: event.targetId,
    intent: decision?.intent ?? event.decision.rejected?.intent ?? null,
    decisionMessage: event.decision.verdict.message,
    question:
      event.question === null
        ? null
        : { category: event.question.category, tier: event.question.tier, prompt: questionText(event.question.id) ?? '' },
    answerGiven: event.answer?.given?.answer ?? null,
    answerIntent: event.answer?.given?.intent ?? event.answer?.rejected?.intent ?? null,
    correct: event.answer === null ? null : event.answer.verdict.code === 'ok',
    expected: event.answer?.expected ?? null,
    answerMessage: event.answer?.verdict.message ?? null,
    outcome: event.outcome,
    eliminated: event.eliminated,
    cores: event.cores,
    centre: event.centre,
    latencyMs: event.latencyMs,
  };
  // The same scan the published artifact gets: a model that writes a URL or a
  // key-shaped string into an intent or answer does not get it onto the page.
  if (findLeaks(JSON.stringify(view)).length === 0) return view;
  return { ...view, intent: null, answerGiven: null, answerIntent: null, decisionMessage: WITHHELD, answerMessage: view.answerMessage === null ? null : WITHHELD };
}

function standingsView(
  standings: readonly ArenaStanding[],
  players: readonly Competitor[],
  events: readonly ArenaEvent[],
  summary: Pick<ArenaStandingsView, 'endedBecause' | 'roundsPlayed' | 'maxRounds' | 'winners' | 'outcome'>,
): ArenaStandingsView {
  return {
    ...summary,
    standings: standings.map((s, index) => ({
      ...s,
      provider: players[index]!.provider,
      modelId: players[index]!.modelId,
      turns: events.filter((e) => e.playerId === s.playerId).length,
    })),
  };
}

export function resultView(result: ArenaResult, events: readonly ArenaEvent[]): ArenaStandingsView {
  return standingsView(result.standings, result.players, events, {
    endedBecause: result.endedBecause,
    roundsPlayed: result.roundsPlayed,
    maxRounds: result.maxRounds,
    winners: result.winners,
    outcome: result.outcome,
  });
}

/* ── The match ──────────────────────────────────────────────────────────── */

export interface ArenaRunOptions {
  /** `false` on the hosted site: a function's disk is read-only and gone after the call. */
  readonly persist?: boolean;
  /** Injected in tests; the real adapters and clock otherwise. */
  readonly adapterFor?: (player: Competitor) => ProviderAdapter;
  readonly now?: () => number;
}

/** Refuses the next model call once the match is cancelled — the failure the match already handles. */
function cancellable(adapter: ProviderAdapter, signal: AbortSignal): ProviderAdapter {
  return {
    provider: adapter.provider,
    modelId: adapter.modelId,
    act(request) {
      if (signal.aborted) return Promise.reject(new ProviderError(adapter.provider, null, 0, 'match cancelled'));
      return adapter.act(request);
    },
  };
}

/**
 * Runs a prepared match to the end, reporting through `emit`, and releases the
 * lock. Never throws: a provider failure, a cancel or a bug ends the stream with
 * an `error` message.
 */
export async function runArena(
  { request, prices }: PreparedArena,
  emit: (message: ArenaMessage) => void,
  signal: AbortSignal,
  { persist = true, adapterFor = (p) => createAdapter(p, readProviderKey(p.provider)), now = Date.now }: ArenaRunOptions = {},
): Promise<void> {
  let savedTo: string | null = null;
  const players: Competitor[] = PLAYER_IDS.map((id, index) => ({
    id,
    provider: request.players[index]!.provider,
    modelId: request.players[index]!.modelId,
    params: { temperature: null, topP: null },
  }));
  try {
    const adapters = Object.fromEntries(players.map((p) => [p.id, cancellable(adapterFor(p), signal)]));
    const matchId = slug(`arena-${new Date(now()).toISOString().replace(/[:.]/g, '-')}`);
    const dir = join(process.cwd(), 'runs', matchId);
    savedTo = persist ? relative(process.cwd(), dir) : null;

    emit({
      type: 'started',
      matchId,
      players: PLAYER_IDS.map((id, index) => ({ id, provider: players[index]!.provider, modelId: players[index]!.modelId })),
      maxRounds: request.rounds,
      cores: { 'player-a': 1, 'player-b': 1, 'player-c': 1 },
      centre: 2,
    });

    let outcome;
    try {
      outcome = await runMatch({
        matchId,
        players,
        adapters,
        maxRounds: request.rounds,
        deps: { now },
        prices,
        shouldStop: () => signal.aborted,
        onThinking: (playerId, phase, round, question) => emit({ type: 'thinking', playerId, phase, round, question }),
        onEvent: (event) => emit({ type: 'turn', turn: turnView(event) }),
      });
    } catch (error) {
      if (!(error instanceof MatchAbortedError)) throw error;
      if (persist) write(join(dir, 'events.partial.json'), error.events);
      const cancelled = signal.aborted;
      const roundsPlayed = error.events.at(-1)?.round ?? 0;
      emit({
        type: 'error',
        message: cancelled ? 'Match cancelled. No winner is named.' : `${error.message}. No winner is named.`,
        savedTo,
        standings: standingsView(partialStandings(error.events, players, prices), players, error.events, {
          endedBecause: null,
          roundsPlayed,
          maxRounds: request.rounds,
          winners: [],
          outcome: null,
        }),
      });
      return;
    }

    const { result, events, providerCalls } = outcome;
    if (persist) {
      write(join(dir, 'arena.json'), result);
      write(join(dir, 'events.json'), events);
    }
    emit({
      type: 'done',
      matchId,
      result: resultView(result, events),
      savedTo,
      providerCalls: Object.values(providerCalls).reduce((sum, n) => sum + n, 0),
      unpriced: players.filter((p) => !costOf(p, { prompt: 0, completion: 0 }, prices).priced).map((p) => p.id),
    });
  } catch (error) {
    // A bug, or a provider failure outside a turn. The message names no key: the transport redacts.
    emit({ type: 'error', message: error instanceof Error ? error.message : String(error), savedTo, standings: null });
  } finally {
    releaseLocalLock();
  }
}
