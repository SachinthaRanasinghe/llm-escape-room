import type { ArenaObservation } from './observation';
import type { ArenaEvent, ArenaVerdict, PlayerId, QuestionCategory, QuestionTier } from './schema';

/**
 * Everything the match says to a player — mirroring `lib/harness/prompt.ts`.
 *
 * One system prompt for all three players, and every per-turn message a pure
 * function of the engine's observation and the public record. Nothing here
 * knows which model it is talking to, and nothing here imports the question
 * bank: a question reaches a player only through its own observation, and an
 * answer key never reaches one at all.
 *
 * Players are named by id (player-a, -b, -c), never by model: a model should
 * pick its target from the board, not from a reputation.
 */

export function arenaSystemPrompt(maxRounds: number): string {
  return [
    'You are one of three players — player-a, player-b and player-c — competing for 5 Energy Cores.',
    'At the start each player holds 1 core and 2 cores sit in the centre.',
    'On your turn choose exactly one action:',
    '- claim: take a core from the centre. You must first answer a medium question correctly.',
    '- steal: take a core from another player. You must first answer a hard question correctly.',
    '- pass: do nothing.',
    'Questions cover math, code, algorithms, logic, SQL and computer science. A wrong answer wastes your turn; nothing else is lost.',
    'A player who loses their last core is eliminated for good.',
    `The game ends when only one player has cores, or after round ${maxRounds}. The player with the most cores wins; equal counts tie.`,
    'Act only by calling exactly one of the tools on each call.',
    'Every call needs an `intent`: one short sentence, in your own words, saying why you are taking that action. Viewers see it beside your character.',
    'Each turn message tells you which player you are.',
  ].join('\n');
}

/** One other player's turn, as everyone saw it: the action, never the question text or the answer. */
export interface PublicTurn {
  readonly playerId: PlayerId;
  readonly action: 'claim' | 'steal' | 'pass' | 'invalid';
  readonly targetId: PlayerId | null;
  readonly category: QuestionCategory | null;
  readonly tier: QuestionTier | null;
  readonly succeeded: boolean;
  readonly eliminated: PlayerId | null;
}

export function publicTurn(event: ArenaEvent): PublicTurn {
  const action = event.decision.action;
  const legal = action !== null && event.decision.verdict.ok;
  return {
    playerId: event.playerId,
    action: legal ? action.name : 'invalid',
    targetId: event.targetId,
    category: event.question?.category ?? null,
    tier: event.question?.tier ?? null,
    succeeded: event.outcome === 'claimed' || event.outcome === 'stole',
    eliminated: event.eliminated,
  };
}

function describeTurn(turn: PublicTurn): string {
  const question = turn.category !== null ? ` (${turn.tier} ${turn.category} question)` : '';
  const result = turn.succeeded ? 'succeeded' : 'failed';
  const out = turn.eliminated !== null ? ` ${turn.eliminated} was eliminated.` : '';
  switch (turn.action) {
    case 'pass':
      return `- ${turn.playerId} passed.`;
    case 'invalid':
      return `- ${turn.playerId} made an invalid move and lost the turn.`;
    case 'claim':
      return `- ${turn.playerId} tried to claim a centre core${question}: ${result}.${out}`;
    case 'steal':
      return `- ${turn.playerId} tried to steal from ${turn.targetId}${question}: ${result}.${out}`;
  }
}

function standings(obs: ArenaObservation): string[] {
  return [
    `Centre: ${obs.centre} core${obs.centre === 1 ? '' : 's'}`,
    ...obs.players.map((p) => `${p.id}${p.id === obs.you ? ' (you)' : ''}: ${p.eliminated ? 'eliminated' : `${p.cores} core${p.cores === 1 ? '' : 's'}`}`),
  ];
}

/** The start of a player's turn: where things stand and what the others did since its last turn. */
export function turnMessage(obs: ArenaObservation, sinceLast: readonly PublicTurn[]): string {
  const lines = [`Round ${obs.round} of ${obs.maxRounds}. You are ${obs.you}.`, '', ...standings(obs)];
  if (sinceLast.length > 0) lines.push('', 'Since your last turn:', ...sinceLast.map(describeTurn));
  lines.push('', 'Choose your action: call claim, steal or pass.');
  return lines.join('\n');
}

/** The decision's verdict and the question to answer. Only ever sent to the player who must answer. */
export function questionMessage(verdict: ArenaVerdict, obs: ArenaObservation): string {
  const pending = obs.pending;
  if (pending === null) throw new Error('questionMessage: no question is pending for this player');
  return [verdict.message, '', `Question (${pending.question.tier} ${pending.question.category}):`, pending.question.prompt, '', 'Call answer with only the final answer.'].join('\n');
}

/** The answer to any other call: the engine's message verbatim, then the board. */
export function verdictText(verdict: ArenaVerdict, obs: ArenaObservation): string {
  return [verdict.message, '', ...standings(obs)].join('\n');
}

/** A call with no usable tool call — the same, plus a fixed reminder. */
export function noActionText(verdict: ArenaVerdict, obs: ArenaObservation): string {
  return [verdict.message, 'Act by calling exactly one tool.', '', ...standings(obs)].join('\n');
}
