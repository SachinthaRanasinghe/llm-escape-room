import type { PlayerId, QuestionCategory, QuestionTier, TurnOutcome, ArenaEndReason } from '@/lib/arena/schema';
import type { Provider } from '@/lib/schema/run';
import type { ModelPick } from './wire';

/**
 * What crosses the wire between the arena page and `/api/arena` — types only,
 * like `wire.ts`. `secrets.test.ts` keeps it that way: the browser may import
 * this file and nothing else from `lib/race`.
 *
 * Everything here is what a viewer may see: model ids, the board, each model's
 * intent and answer as written (leak-scanned on the server), and the question's
 * text and canonical answer only AFTER the answer was graded.
 */

export interface ArenaRequest {
  readonly players: readonly [ModelPick, ModelPick, ModelPick];
  readonly rounds: number;
}

export interface ArenaPlayerView {
  readonly id: PlayerId;
  readonly provider: Provider;
  readonly modelId: string;
}

export type Cores = Readonly<Record<PlayerId, number>>;

/** One turn, as the page draws it. */
export interface ArenaTurnView {
  readonly seq: number;
  readonly round: number;
  readonly playerId: PlayerId;
  /** `invalid` for a malformed or refused decision. */
  readonly action: 'claim' | 'steal' | 'pass' | 'invalid';
  readonly targetId: PlayerId | null;
  /** The model's own decision intent, verbatim — `null` when it wrote none or it was withheld. */
  readonly intent: string | null;
  /** The engine's verdict on the decision. */
  readonly decisionMessage: string;
  readonly question: { readonly category: QuestionCategory; readonly tier: QuestionTier; readonly prompt: string } | null;
  readonly answerGiven: string | null;
  readonly answerIntent: string | null;
  /** `null` when no question was asked. */
  readonly correct: boolean | null;
  readonly expected: string | null;
  readonly answerMessage: string | null;
  readonly outcome: TurnOutcome;
  readonly eliminated: PlayerId | null;
  readonly cores: Cores;
  readonly centre: number;
  readonly latencyMs: number;
}

export interface ArenaStandingView {
  readonly playerId: PlayerId;
  readonly provider: Provider;
  readonly modelId: string;
  readonly cores: number;
  readonly eliminatedInRound: number | null;
  readonly claims: number;
  readonly steals: number;
  readonly passes: number;
  readonly correct: number;
  readonly wrong: number;
  readonly invalid: number;
  readonly tokens: { readonly prompt: number; readonly completion: number };
  readonly latencyMs: number;
  readonly costUsd: number;
  /** Decisions taken — the denominator for average think-time. */
  readonly turns: number;
}

export interface ArenaStandingsView {
  /** `null` for a match that did not finish. */
  readonly endedBecause: ArenaEndReason | null;
  readonly roundsPlayed: number;
  readonly maxRounds: number;
  /** Empty for a match that did not finish: no winner is named. */
  readonly winners: readonly PlayerId[];
  readonly outcome: 'win' | 'tie' | null;
  /** In player order. */
  readonly standings: readonly ArenaStandingView[];
}

/** One line of the `/api/arena` NDJSON stream, or one message of a hosted poll. */
export type ArenaMessage =
  | {
      readonly type: 'started';
      readonly matchId: string;
      readonly players: readonly ArenaPlayerView[];
      readonly maxRounds: number;
      readonly cores: Cores;
      readonly centre: number;
    }
  /** A model call is about to be made. */
  | {
      readonly type: 'thinking';
      readonly playerId: PlayerId;
      readonly phase: 'decide' | 'answer';
      readonly round: number;
      /** On an answer call: the kind of question being solved — never its text, which is shown once graded. */
      readonly question: { readonly category: QuestionCategory; readonly tier: QuestionTier } | null;
    }
  | { readonly type: 'turn'; readonly turn: ArenaTurnView }
  | {
      readonly type: 'done';
      readonly matchId: string;
      readonly result: ArenaStandingsView;
      /** Relative to the repo root. `null` on the hosted site, which saves nothing. */
      readonly savedTo: string | null;
      readonly providerCalls: number;
      readonly unpriced: readonly string[];
    }
  | {
      readonly type: 'error';
      readonly message: string;
      readonly savedTo: string | null;
      /** The standings so far when a provider stopped the match part-way; `null` otherwise. */
      readonly standings: ArenaStandingsView | null;
    };

/** `GET /api/arena/<raceId>?from=<n>` on the hosted site. */
export interface HostedArenaPoll {
  readonly messages: readonly ArenaMessage[];
  /** Index to ask for next. */
  readonly next: number;
  /** True once a `done` or `error` message has been sent: stop polling. */
  readonly finished: boolean;
}
