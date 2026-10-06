import { describe, expect, it } from 'vitest';
import { createArena } from './engine';
import { BANK } from './questions/bank';
import { arenaSystemPrompt, noActionText, publicTurn, questionMessage, turnMessage, verdictText } from './prompt';
import type { ArenaEvent } from './schema';

const base: ArenaEvent = {
  matchId: 'm',
  seq: 0,
  round: 1,
  playerId: 'player-b',
  decision: { action: { name: 'steal', targetId: 'player-a', intent: 'A is weak.' }, verdict: { ok: true, code: 'ok', message: 'Answer.' } },
  question: { id: 'h-sql-1', category: 'sql', tier: 'hard' },
  answer: { given: { name: 'answer', answer: '1', intent: 'Count.' }, verdict: { ok: true, code: 'ok', message: 'Correct.' }, expected: '1' },
  outcome: 'stole',
  targetId: 'player-a',
  eliminated: 'player-a',
  cores: { 'player-a': 0, 'player-b': 2, 'player-c': 1 },
  centre: 2,
  latencyMs: 10,
  tokens: { prompt: 1, completion: 1 },
  at: '2026-10-06T10:00:00.000Z',
};

describe('arena prompts', () => {
  it('states the rules once, the same for every player, with the round cap', () => {
    const prompt = arenaSystemPrompt(10);
    expect(prompt).toContain('5 Energy Cores');
    expect(prompt).toContain('after round 10');
    expect(prompt).not.toMatch(/gpt|gemini|llama|claude/i);
  });

  it('reports another player\'s turn by its category and result, never its question or answer', () => {
    const turn = publicTurn(base);
    expect(turn).toEqual({ playerId: 'player-b', action: 'steal', targetId: 'player-a', category: 'sql', tier: 'hard', succeeded: true, eliminated: 'player-a' });
    const game = createArena({ seed: 's', maxRounds: 10 });
    const text = turnMessage(game.observe('player-c'), [turn]);
    expect(text).toContain('Round 1 of 10. You are player-c.');
    expect(text).toContain('player-b tried to steal from player-a (hard sql question): succeeded. player-a was eliminated.');
    const question = BANK.find((q) => q.id === 'h-sql-1')!;
    expect(text).not.toContain(question.prompt.slice(0, 30));
  });

  it('calls a refused or malformed decision invalid', () => {
    const refused: ArenaEvent = {
      ...base,
      decision: { action: { name: 'claim', intent: 'x' }, verdict: { ok: false, code: 'not_permitted', message: 'no' } },
      question: null,
      answer: null,
      outcome: 'wasted',
      targetId: null,
      eliminated: null,
    };
    expect(publicTurn(refused).action).toBe('invalid');
  });

  it('shows the question only to the player who must answer it, and never its key', () => {
    const game = createArena({ seed: 's', maxRounds: 10 });
    const decided = game.decide('player-a', { name: 'claim', intent: 'Take it.' });
    const text = questionMessage(decided.verdict, game.observe('player-a'));
    expect(text).toContain(decided.question!.prompt);
    expect(() => questionMessage(decided.verdict, game.observe('player-b'))).toThrow();
    const answered = game.answer('player-a', { name: 'answer', answer: 'wrong', intent: 'Guess.' });
    for (const out of [verdictText(answered.verdict, game.observe('player-a')), noActionText(answered.verdict, game.observe('player-a'))]) {
      expect(out).not.toContain(`${answered.expected}\n`);
      expect(out).toContain('Wrong answer.');
    }
  });
});
