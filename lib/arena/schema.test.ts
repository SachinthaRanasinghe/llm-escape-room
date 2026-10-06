import { describe, expect, it } from 'vitest';
import { ArenaActionSchema, ArenaAnswerSchema, ArenaSchemaError, parseArenaEvent, type ArenaEvent } from './schema';

const event: ArenaEvent = {
  matchId: 'arena-test',
  seq: 0,
  round: 1,
  playerId: 'player-a',
  decision: { action: { name: 'claim', intent: 'Grab the free core.' }, verdict: { ok: true, code: 'ok', message: 'Answer this.' } },
  question: { id: 'm-math-1', category: 'math', tier: 'medium' },
  answer: {
    given: { name: 'answer', answer: '24', intent: 'Count the fives.' },
    verdict: { ok: true, code: 'ok', message: 'Correct.' },
    expected: '24',
  },
  outcome: 'claimed',
  targetId: null,
  eliminated: null,
  cores: { 'player-a': 2, 'player-b': 1, 'player-c': 1 },
  centre: 1,
  latencyMs: 1200,
  tokens: { prompt: 100, completion: 20 },
  at: '2026-10-06T10:00:00.000Z',
};

describe('the arena vocabulary', () => {
  it('accepts the three decisions and refuses anything else', () => {
    expect(ArenaActionSchema.safeParse({ name: 'pass', intent: 'Wait.' }).success).toBe(true);
    expect(ArenaActionSchema.safeParse({ name: 'steal', targetId: 'player-b', intent: 'B leads.' }).success).toBe(true);
    expect(ArenaActionSchema.safeParse({ name: 'steal', intent: 'No target.' }).success).toBe(false);
    expect(ArenaActionSchema.safeParse({ name: 'claim', intent: 'x', extra: 1 }).success).toBe(false);
    expect(ArenaActionSchema.safeParse({ name: 'answer', answer: '1', intent: 'x' }).success).toBe(false);
    expect(ArenaActionSchema.safeParse({ name: 'claim' }).success).toBe(false);
  });

  it('caps an answer at 200 characters', () => {
    expect(ArenaAnswerSchema.safeParse({ name: 'answer', answer: 'x'.repeat(200), intent: 'i' }).success).toBe(true);
    expect(ArenaAnswerSchema.safeParse({ name: 'answer', answer: 'x'.repeat(201), intent: 'i' }).success).toBe(false);
    expect(ArenaAnswerSchema.safeParse({ name: 'answer', answer: '', intent: 'i' }).success).toBe(false);
  });
});

describe('ArenaEventSchema', () => {
  it('parses a full turn', () => {
    expect(parseArenaEvent(event)).toEqual(event);
  });

  it('pairs a null decision with a rejected block, both ways', () => {
    const malformed = {
      ...event,
      decision: { action: null, verdict: { ok: false, code: 'malformed', message: 'bad' } },
      question: null,
      answer: null,
      outcome: 'wasted',
    };
    expect(() => parseArenaEvent(malformed)).toThrow(ArenaSchemaError);
    expect(() =>
      parseArenaEvent({ ...malformed, decision: { ...malformed.decision, rejected: { kind: 'no_tool_call', raw: '', intent: null } } }),
    ).not.toThrow();
  });

  it('has an answer exactly when a question was asked', () => {
    expect(() => parseArenaEvent({ ...event, answer: null })).toThrow(ArenaSchemaError);
    expect(() => parseArenaEvent({ ...event, question: null })).toThrow(ArenaSchemaError);
  });

  it('refuses an unknown player and a question text smuggled in', () => {
    expect(() => parseArenaEvent({ ...event, playerId: 'player-d' })).toThrow(ArenaSchemaError);
    expect(() => parseArenaEvent({ ...event, question: { ...event.question, prompt: 'leak' } })).toThrow(ArenaSchemaError);
  });
});
