import type { ProviderAdapter, ProviderTurn, TranscriptEntry, TurnRequest } from '@/lib/providers';
// The one value import from providers, as in the harness: `instanceof` needs the class.
import { ProviderError } from '@/lib/providers/types';
import type { HarnessDeps } from '@/lib/harness/types';
import type { PriceTable } from '@/lib/harness/pricing';
import type { Competitor } from '@/lib/schema/run';
import { createArena, type Arena, type AnswerResult, type DecideResult } from './engine';
import { arenaSystemPrompt, noActionText, publicTurn, questionMessage, turnMessage, verdictText } from './prompt';
import { buildArenaEvent, type Phase } from './record';
import { PLAYER_IDS, type ArenaEvent, type ArenaResult, type PlayerId, type QuestionCategory, type QuestionTier } from './schema';
import { buildArenaResult } from './standings';
import { ANSWER_TOOLS, DECISION_TOOLS } from './tools';

/**
 * One match of the arena — the loop `lib/harness/competitor.ts` runs for the
 * room, for three players sharing one engine and taking turns in order.
 *
 *   until the engine says the match is over:
 *     player ← whose turn it is
 *     decide ← adapter.act(DECISION_TOOLS)   claim / steal / pass
 *     if the engine drew a question:
 *       answer ← adapter.act(ANSWER_TOOLS)   the question, and only that player sees it
 *     log    ← one event for the turn
 *
 * ── Each player keeps its own conversation ─────────────────────────────────
 * A player's transcript holds its own calls, its own questions and verdicts,
 * and — at the start of each turn — the board and what the others did since. It
 * never holds another player's question. The verdict of a turn's last call is
 * delivered with the next turn's message, in the same tool result, so the
 * conversation stays one call, one result.
 *
 * ── Every call names its tools ─────────────────────────────────────────────
 * `TurnRequest.tools` defaults to the escape room's. Every request here sets it,
 * and `match.test.ts` checks that it did.
 *
 * ── A dead provider aborts the match ───────────────────────────────────────
 * As in the duel: a `ProviderError` says nothing about any model, so there is no
 * result, and `MatchAbortedError` carries the turns that completed.
 */

export const DEFAULT_ROUNDS = 10;
/** Under Netlify's 15-minute background-function limit, with room to report. */
export const DEFAULT_MATCH_WALL_CLOCK_MS = 12 * 60_000;

/** `question` is set on an answer call: what kind of question the player is now solving. */
export type ThinkingObserver = (
  playerId: PlayerId,
  phase: 'decide' | 'answer',
  round: number,
  question: { readonly category: QuestionCategory; readonly tier: QuestionTier } | null,
) => void;
export type ArenaEventObserver = (event: ArenaEvent) => void;

export interface MatchOptions {
  readonly matchId: string;
  /** Seeds the question decks. Defaults to the match id. */
  readonly seed?: string;
  /** Exactly three, in `PLAYER_IDS` order; each `id` must be its player id. */
  readonly players: readonly Competitor[];
  /** Keyed by player id. Built by the caller — the match never reads a key. */
  readonly adapters: Readonly<Record<string, ProviderAdapter>>;
  readonly maxRounds?: number;
  readonly maxWallClockMs?: number;
  readonly deps: HarnessDeps;
  readonly prices?: PriceTable;
  /** Called as each turn is logged. A throw from it is swallowed: a watcher cannot break a match. */
  readonly onEvent?: ArenaEventObserver;
  /** Called before each model call. Swallowed likewise. */
  readonly onThinking?: ThinkingObserver;
  /** Polled before every model call; `true` aborts the match. */
  readonly shouldStop?: () => boolean;
}

export interface MatchResult {
  readonly result: ArenaResult;
  readonly events: readonly ArenaEvent[];
  /** Real provider calls per player, retries included. */
  readonly providerCalls: Readonly<Record<string, number>>;
}

export class MatchAbortedError extends Error {
  readonly matchId: string;
  /** The player whose provider failed; `null` when the match was stopped from outside. */
  readonly playerId: PlayerId | null;
  readonly events: readonly ArenaEvent[];
  readonly providerCalls: number;

  constructor(matchId: string, playerId: PlayerId | null, events: readonly ArenaEvent[], providerCalls: number, cause: unknown) {
    const why = cause instanceof Error ? cause.message : 'stopped';
    super(`${matchId}: match aborted after ${events.length} turn(s): ${playerId === null ? why : `${playerId}: ${why}`}`, { cause });
    this.name = new.target.name;
    this.matchId = matchId;
    this.playerId = playerId;
    this.events = events;
    this.providerCalls = providerCalls;
  }
}

function validate({ players, adapters }: MatchOptions): void {
  if (players.length !== PLAYER_IDS.length) throw new RangeError(`runMatch: the arena needs exactly 3 players, received ${players.length}`);
  players.forEach((player, index) => {
    if (player.id !== PLAYER_IDS[index]) throw new RangeError(`runMatch: player ${index} must have id ${PLAYER_IDS[index]}, received ${player.id}`);
    const adapter = adapters[player.id];
    if (adapter === undefined) throw new RangeError(`runMatch: no adapter for ${player.id}`);
    if (adapter.provider !== player.provider || adapter.modelId !== player.modelId) {
      throw new RangeError(`runMatch: adapter for ${player.id} is ${adapter.provider}/${adapter.modelId}, player says ${player.provider}/${player.modelId}`);
    }
  });
}

/** What a player will be told at the start of its next turn, before the turn message. */
type Deferred = { readonly kind: 'tool_result'; readonly callId: string; readonly toolName: string; readonly text: string } | { readonly kind: 'user'; readonly text: string } | null;

function deliver(transcript: TranscriptEntry[], deferred: Deferred, text: string): void {
  if (deferred === null) transcript.push({ kind: 'user', text });
  else transcript.push({ ...deferred, text: `${deferred.text}\n\n${text}` });
}

function quietly(fn: () => void): void {
  try {
    fn();
  } catch {
    // A watcher's failure is the watcher's. The match goes on.
  }
}

export async function runMatch(options: MatchOptions): Promise<MatchResult> {
  validate(options);
  const { matchId, players, adapters, deps, prices, onEvent, onThinking } = options;
  const seed = options.seed ?? matchId;
  const maxRounds = options.maxRounds ?? DEFAULT_ROUNDS;
  const maxWallClockMs = options.maxWallClockMs ?? DEFAULT_MATCH_WALL_CLOCK_MS;
  const shouldStop = options.shouldStop ?? (() => false);

  const arena: Arena = createArena({ seed, maxRounds });
  const system = arenaSystemPrompt(maxRounds);
  const transcripts: Record<PlayerId, TranscriptEntry[]> = { 'player-a': [], 'player-b': [], 'player-c': [] };
  const deferred: Record<PlayerId, Deferred> = { 'player-a': null, 'player-b': null, 'player-c': null };
  const seen: Record<PlayerId, number> = { 'player-a': 0, 'player-b': 0, 'player-c': 0 };
  const calls: Record<PlayerId, number> = { 'player-a': 0, 'player-b': 0, 'player-c': 0 };
  const events: ArenaEvent[] = [];
  const startedAt = deps.now();

  const totalCalls = () => PLAYER_IDS.reduce((sum, id) => sum + calls[id], 0);

  async function act(
    playerId: PlayerId,
    phase: 'decide' | 'answer',
    round: number,
    tools: TurnRequest['tools'],
    question: Parameters<ThinkingObserver>[3] = null,
  ): Promise<ProviderTurn> {
    if (shouldStop()) throw new MatchAbortedError(matchId, null, events, totalCalls(), new Error('stopped'));
    quietly(() => onThinking?.(playerId, phase, round, question));
    try {
      const turn = await adapters[playerId]!.act({ system, transcript: [...transcripts[playerId]], tools });
      calls[playerId] += turn.attempts;
      return turn;
    } catch (error) {
      if (error instanceof ProviderError) {
        calls[playerId] += error.attempts;
        throw new MatchAbortedError(matchId, playerId, events, totalCalls(), error);
      }
      throw error;
    }
  }

  /** Records the call and decides what the player hears next — now, or with its next turn. */
  function answerCall(playerId: PlayerId, turn: ProviderTurn, text: string, now: boolean): void {
    const transcript = transcripts[playerId];
    if (turn.toolCall !== null) {
      transcript.push({ kind: 'tool_call', call: turn.toolCall });
      const result = { kind: 'tool_result', callId: turn.toolCall.callId, toolName: turn.toolCall.toolName, text } as const;
      if (now) transcript.push(result);
      else deferred[playerId] = result;
      return;
    }
    if (turn.text !== null && turn.text.trim().length > 0) transcript.push({ kind: 'assistant_text', text: turn.text });
    if (now) transcript.push({ kind: 'user', text });
    else deferred[playerId] = { kind: 'user', text };
  }

  while (!arena.hasEnded()) {
    if (deps.now() - startedAt >= maxWallClockMs) {
      arena.stopForTime();
      break;
    }
    const { playerId, round } = arena.current()!;

    const sinceLast = events.slice(seen[playerId]).filter((e) => e.playerId !== playerId).map(publicTurn);
    deliver(transcripts[playerId], deferred[playerId], turnMessage(arena.observe(playerId), sinceLast));
    deferred[playerId] = null;

    const decideTurn = await act(playerId, 'decide', round, DECISION_TOOLS);
    const decided: DecideResult = arena.decide(playerId, decideTurn.rawAction);
    let answer: Phase<AnswerResult> | null = null;

    if (decided.question !== null) {
      // The question goes back at once: the player must answer it on its next call.
      answerCall(playerId, decideTurn, questionMessage(decided.verdict, arena.observe(playerId)), true);
      const answerTurn = await act(playerId, 'answer', round, ANSWER_TOOLS, { category: decided.question.category, tier: decided.question.tier });
      const answered = arena.answer(playerId, answerTurn.rawAction);
      const obs = arena.observe(playerId);
      answerCall(playerId, answerTurn, answerTurn.toolCall !== null ? verdictText(answered.verdict, obs) : noActionText(answered.verdict, obs), false);
      answer = { turn: answerTurn, result: answered };
    } else {
      const obs = arena.observe(playerId);
      answerCall(playerId, decideTurn, decideTurn.toolCall !== null ? verdictText(decided.verdict, obs) : noActionText(decided.verdict, obs), false);
    }

    const event = buildArenaEvent(
      { matchId, seq: events.length, round, playerId, at: new Date(deps.now()).toISOString() },
      { turn: decideTurn, result: decided },
      answer,
      arena.snapshot(),
    );
    events.push(event);
    seen[playerId] = events.length;
    quietly(() => onEvent?.(event));
  }

  const result = buildArenaResult({ matchId, seed, players, maxRounds, endedBecause: arena.endedBecause()!, events, prices });
  return { result, events, providerCalls: { ...calls } };
}
