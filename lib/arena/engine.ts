import { createDeck, type Deck } from './questions/deck';
import { gradeAnswer } from './questions/grade';
import type { Question } from './questions/types';
import { observe, type ArenaObservation, type ObservedState } from './observation';
import {
  ArenaActionSchema,
  ArenaAnswerSchema,
  PLAYER_IDS,
  TOTAL_CORES,
  type ArenaAction,
  type ArenaAnswer,
  type ArenaEndReason,
  type ArenaVerdict,
  type PlayerId,
  type TurnOutcome,
} from './schema';

/**
 * The arena engine — the sole authority on who holds which core.
 *
 * The room's rule, carried over: a model's output is DATA. Whatever arrives in
 * `decide` or `answer` is parsed here, and anything that is not a valid call is
 * a `malformed` verdict that costs the turn — never an exception. An exception
 * from this file means the CALLER broke the protocol (acted out of turn, answered
 * with no question pending), which is a bug, not a model's mistake.
 *
 * ── The rules (docs/decisions/arena.md) ────────────────────────────────────
 * - Opening: each player holds one core, the centre two.
 * - Round r plays `PLAYER_IDS` rotated left by (r-1) % 3, skipping the
 *   eliminated. The rotation comes from the round's base order, not from who is
 *   alive, so skipping never shifts it.
 * - A turn: decide (claim / steal / pass). A legal claim draws a medium question,
 *   a legal steal a hard one, and the action happens only if the answer grades
 *   correct. A wrong answer, an illegal decision or a malformed call wastes the
 *   turn — nothing more.
 * - A player left with no cores is eliminated for good.
 * - The match ends when one player still holds cores, after round `maxRounds`,
 *   or when the harness calls time.
 *
 * Every step keeps centre + holdings = `TOTAL_CORES`; `engine.test.ts` checks it
 * after every call of a long seeded random game.
 */

export class ArenaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export interface ArenaOptions {
  /** Seeds the question decks. The match id. */
  readonly seed: string;
  readonly maxRounds: number;
  /** Injected in tests; the committed bank otherwise. */
  readonly deck?: Deck;
}

export interface DecideResult {
  /** `null` when the call was not an action at all. */
  readonly action: ArenaAction | null;
  readonly verdict: ArenaVerdict;
  /** The question to answer — set exactly when the decision was a legal claim or steal. */
  readonly question: Question | null;
  /** Set when the decision ended the turn (pass, illegal, malformed). */
  readonly outcome: TurnOutcome | null;
}

export interface AnswerResult {
  readonly given: ArenaAnswer | null;
  readonly verdict: ArenaVerdict;
  readonly correct: boolean;
  readonly outcome: TurnOutcome;
  readonly eliminated: PlayerId | null;
  /** The canonical answer, for the record and the viewer. NEVER sent to a model. */
  readonly expected: string;
  readonly question: Question;
}

export interface PlayerTally {
  /** Cores won from the centre. */
  readonly claims: number;
  /** Cores taken from another player. */
  readonly steals: number;
  readonly passes: number;
  readonly correct: number;
  readonly wrong: number;
  readonly invalid: number;
}

export interface ArenaSnapshot {
  readonly round: number;
  readonly centre: number;
  readonly cores: Readonly<Record<PlayerId, number>>;
  /** The round each player was eliminated in, `null` while still in. */
  readonly eliminated: Readonly<Record<PlayerId, number | null>>;
}

export interface Arena {
  observe(playerId: PlayerId): ArenaObservation;
  /** Whose turn it is, and in which phase; `null` once the match has ended. */
  current(): { readonly round: number; readonly playerId: PlayerId; readonly phase: 'decide' | 'answer' } | null;
  decide(playerId: PlayerId, raw: unknown): DecideResult;
  answer(playerId: PlayerId, raw: unknown): AnswerResult;
  /** The harness ran out of wall clock. Only between turns. */
  stopForTime(): void;
  hasEnded(): boolean;
  endedBecause(): ArenaEndReason | null;
  snapshot(): ArenaSnapshot;
  tally(playerId: PlayerId): PlayerTally;
}

/** Round r's turn order: `PLAYER_IDS` rotated left by (r-1) % 3. */
export function turnOrder(round: number): PlayerId[] {
  const shift = (round - 1) % PLAYER_IDS.length;
  return [...PLAYER_IDS.slice(shift), ...PLAYER_IDS.slice(0, shift)];
}

function malformedMessage(issues: readonly { path: PropertyKey[]; message: string }[], what: string): string {
  const detail = issues.map((issue) => `${issue.path.map(String).join('.') || what}: ${issue.message}`);
  return `That is not a valid ${what}. ${detail.join('; ')}`;
}

function blank(): { -readonly [K in keyof PlayerTally]: number } {
  return { claims: 0, steals: 0, passes: 0, correct: 0, wrong: 0, invalid: 0 };
}

export function createArena({ seed, maxRounds, deck = createDeck(seed) }: ArenaOptions): Arena {
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new RangeError(`createArena: maxRounds must be a positive integer, received ${maxRounds}`);

  const cores: Record<PlayerId, number> = { 'player-a': 1, 'player-b': 1, 'player-c': 1 };
  let centre = TOTAL_CORES - PLAYER_IDS.length;
  const eliminated: Record<PlayerId, number | null> = { 'player-a': null, 'player-b': null, 'player-c': null };
  const tallies: Record<PlayerId, ReturnType<typeof blank>> = { 'player-a': blank(), 'player-b': blank(), 'player-c': blank() };
  let round = 1;
  let position = 0;
  let pending: ObservedState['pending'] = null;
  let ended: ArenaEndReason | null = null;

  const alive = () => PLAYER_IDS.filter((id) => eliminated[id] === null);

  function currentPlayer(): PlayerId | null {
    return ended === null ? turnOrder(round)[position]! : null;
  }

  /** Move to the next living player, rolling into the next round — or end the match. */
  function endTurn(): void {
    pending = null;
    if (alive().length <= 1) {
      ended = 'last_standing';
      return;
    }
    for (;;) {
      position += 1;
      if (position >= PLAYER_IDS.length) {
        if (round >= maxRounds) {
          ended = 'round_cap';
          return;
        }
        round += 1;
        position = 0;
      }
      if (eliminated[turnOrder(round)[position]!] === null) return;
    }
  }

  function assertTurn(playerId: PlayerId, phase: 'decide' | 'answer'): void {
    if (ended !== null) throw new ArenaError(`${playerId}: the match has ended (${ended})`);
    const now = currentPlayer();
    if (now !== playerId) throw new ArenaError(`${playerId}: it is ${now}'s turn`);
    if (phase === 'decide' && pending !== null) throw new ArenaError(`${playerId}: a question is waiting for an answer`);
    if (phase === 'answer' && pending === null) throw new ArenaError(`${playerId}: there is no question to answer`);
  }

  function refuse(playerId: PlayerId, action: ArenaAction, reason: string): DecideResult {
    tallies[playerId].invalid += 1;
    endTurn();
    return { action, verdict: { ok: false, code: 'not_permitted', message: `Not permitted: ${reason} Your turn is over.` }, question: null, outcome: 'wasted' };
  }

  function state(): ObservedState {
    return { round, maxRounds, centre, cores: { ...cores }, eliminated: { ...eliminated }, pending };
  }

  return {
    observe(playerId) {
      return observe(state(), playerId, PLAYER_IDS);
    },

    current() {
      const playerId = currentPlayer();
      return playerId === null ? null : { round, playerId, phase: pending === null ? 'decide' : 'answer' };
    },

    decide(playerId, raw) {
      assertTurn(playerId, 'decide');
      const parsed = ArenaActionSchema.safeParse(raw);
      if (!parsed.success) {
        tallies[playerId].invalid += 1;
        endTurn();
        return {
          action: null,
          verdict: { ok: false, code: 'malformed', message: `${malformedMessage(parsed.error.issues, 'action')} Your turn is over.` },
          question: null,
          outcome: 'wasted',
        };
      }

      const action = parsed.data;
      if (action.name === 'pass') {
        tallies[playerId].passes += 1;
        endTurn();
        return { action, verdict: { ok: true, code: 'ok', message: 'You passed. Your turn is over.' }, question: null, outcome: 'passed' };
      }

      let targetId: PlayerId | null = null;
      if (action.name === 'claim') {
        if (centre === 0) return refuse(playerId, action, 'the centre is empty — steal from a player or pass.');
      } else {
        const target = PLAYER_IDS.find((id) => id === action.targetId);
        const others = alive().filter((id) => id !== playerId);
        if (target === undefined) return refuse(playerId, action, `"${action.targetId}" is not a player. Steal from one of: ${others.join(', ')}.`);
        if (target === playerId) return refuse(playerId, action, 'you cannot steal from yourself.');
        if (eliminated[target] !== null || cores[target] === 0) return refuse(playerId, action, `${target} has been eliminated and holds no cores.`);
        targetId = target;
      }

      const tier = action.name === 'claim' ? 'medium' : 'hard';
      const question = deck.draw(tier);
      pending = { playerId, action: action.name, targetId, question };
      const what = action.name === 'claim' ? 'claim a core from the centre' : `steal a core from ${targetId}`;
      return {
        action,
        verdict: { ok: true, code: 'ok', message: `To ${what}, answer this ${tier} ${question.category} question correctly.` },
        question,
        outcome: null,
      };
    },

    answer(playerId, raw) {
      assertTurn(playerId, 'answer');
      const { action, targetId, question } = pending!;
      const failed = action === 'claim' ? 'The claim failed' : 'The steal failed';
      const parsed = ArenaAnswerSchema.safeParse(raw);

      if (!parsed.success) {
        tallies[playerId].invalid += 1;
        endTurn();
        return {
          given: null,
          verdict: { ok: false, code: 'malformed', message: `${malformedMessage(parsed.error.issues, 'answer')} ${failed}. Your turn is over.` },
          correct: false,
          outcome: 'failed',
          eliminated: null,
          expected: question.display,
          question,
        };
      }

      const given = parsed.data;
      if (!gradeAnswer(question.key, given.answer).correct) {
        tallies[playerId].wrong += 1;
        endTurn();
        return {
          given,
          verdict: { ok: false, code: 'wrong_answer', message: `Wrong answer. ${failed}. Your turn is over.` },
          correct: false,
          outcome: 'failed',
          eliminated: null,
          expected: question.display,
          question,
        };
      }

      tallies[playerId].correct += 1;
      let knockedOut: PlayerId | null = null;
      let message: string;
      if (action === 'claim') {
        centre -= 1;
        cores[playerId] += 1;
        tallies[playerId].claims += 1;
        message = 'Correct. You took a core from the centre.';
      } else {
        const target = targetId!;
        if (cores[target] < 1) throw new ArenaError(`${playerId}: steal target ${target} holds no cores`);
        cores[target] -= 1;
        cores[playerId] += 1;
        tallies[playerId].steals += 1;
        message = `Correct. You took a core from ${target}.`;
        if (cores[target] === 0) {
          eliminated[target] = round;
          knockedOut = target;
          message += ` ${target} has no cores left and is eliminated.`;
        }
      }
      endTurn();
      return {
        given,
        verdict: { ok: true, code: 'ok', message: `${message} Your turn is over.` },
        correct: true,
        outcome: action === 'claim' ? 'claimed' : 'stole',
        eliminated: knockedOut,
        expected: question.display,
        question,
      };
    },

    stopForTime() {
      if (ended !== null) return;
      if (pending !== null) throw new ArenaError('stopForTime: a question is waiting for an answer — call time between turns');
      ended = 'time_cap';
    },

    hasEnded: () => ended !== null,
    endedBecause: () => ended,

    snapshot() {
      return { round, centre, cores: { ...cores }, eliminated: { ...eliminated } };
    },

    tally(playerId) {
      return { ...tallies[playerId] };
    },
  };
}
