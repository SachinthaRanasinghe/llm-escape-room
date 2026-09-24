import { describe, expect, it } from 'vitest';
import { VERDICT_CODES } from '@/lib/schema/action';
import type { RoomSpec } from '@/lib/schema/room';
import { loadCanonicalRoom } from '@/fixtures';
import { NO_COST, type ActionCost, type Budget } from './budget';
import { SimulatorError } from './state';
import { VERDICT_TALLY, createSimulator } from './simulator';

const spec = loadCanonicalRoom();
const budget: Budget = { maxActions: 20, maxTokens: 100_000, maxWallClockMs: 300_000 };

function sim(overrides: Partial<Budget> = {}) {
  return createSimulator({ spec, budget: { ...budget, ...overrides }, competitorId: 'model-a' });
}

function cost(elapsedMs: number, prompt = 0, completion = 0): ActionCost {
  return { tokens: { prompt, completion }, elapsedMs };
}

const intent = 'test';

describe('createSimulator — malformed input', () => {
  it.each([
    ['an empty object', {}],
    ['a verb outside the vocabulary', { name: 'fly', intent }],
    ['an action missing its intent', { name: 'look' }],
    ['an action missing a required argument', { name: 'inspect', intent }],
    ['an unknown extra key', { name: 'look', intent, colour: 'blue' }],
    ['a string', 'look at the desk'],
    ['null', null],
  ])('returns malformed for %s', (_label, raw) => {
    const simulator = sim();
    const result = simulator.apply(raw, NO_COST);
    expect(result.verdict.code).toBe('malformed');
    expect(result.verdict.ok).toBe(false);
    expect(result.action).toBeNull();
  });

  it('explains what was wrong, so the model can correct itself', () => {
    const { verdict } = sim().apply({ name: 'inspect', intent }, NO_COST);
    expect(verdict.message.length).toBeGreaterThan(20);
    expect(verdict.message).toContain('targetId');
  });

  /** The ticket's explicit rule: using the interface correctly is part of the task. */
  it('consumes a turn for a malformed action', () => {
    const simulator = sim({ maxActions: 3 });
    expect(simulator.observe().actionsRemaining).toBe(3);
    simulator.apply({ name: 'fly' }, NO_COST);
    expect(simulator.observe().actionsRemaining).toBe(2);
  });

  it('counts malformed actions as invalid, never as failed attempts', () => {
    const simulator = sim({ maxActions: 2 });
    simulator.apply({ name: 'fly' }, NO_COST);
    simulator.apply({ name: 'fly' }, NO_COST);
    const summary = simulator.summarise();
    expect(summary.invalidActions).toBe(2);
    expect(summary.failedAttempts).toBe(0);
  });

  it('can exhaust an entire budget on nothing but garbage', () => {
    const simulator = sim({ maxActions: 2 });
    expect(simulator.apply({}, NO_COST).ended).toBeNull();
    expect(simulator.apply({}, NO_COST).ended).toBe('budget_actions');
    expect(simulator.summarise().escaped).toBe(false);
  });
});

describe('createSimulator — budget', () => {
  it('reports the reason on the action that ends the run, and only that one', () => {
    const simulator = sim({ maxActions: 3 });
    expect(simulator.apply({ name: 'look', intent }, NO_COST).ended).toBeNull();
    expect(simulator.apply({ name: 'look', intent }, NO_COST).ended).toBeNull();
    expect(simulator.apply({ name: 'look', intent }, NO_COST).ended).toBe('budget_actions');
    expect(simulator.hasEnded()).toBe(true);
  });

  it('ends on tokens and on wall clock too', () => {
    const onTokens = sim({ maxTokens: 100 });
    expect(onTokens.apply({ name: 'look', intent }, cost(0, 60, 60)).ended).toBe('budget_tokens');

    const onTime = sim({ maxWallClockMs: 1_000 });
    expect(onTime.apply({ name: 'look', intent }, cost(1_500)).ended).toBe('budget_time');
  });

  it('records exhaustion as an outcome rather than throwing', () => {
    const simulator = sim({ maxActions: 1 });
    expect(() => simulator.apply({ name: 'look', intent }, NO_COST)).not.toThrow();
    expect(simulator.summarise().endedBecause).toBe('budget_actions');
  });

  it('throws if the harness keeps acting after the run is over', () => {
    const simulator = sim({ maxActions: 1 });
    simulator.apply({ name: 'look', intent }, NO_COST);
    expect(() => simulator.apply({ name: 'look', intent }, NO_COST)).toThrow(SimulatorError);
  });
});

describe('createSimulator — escaping', () => {
  function escape(maxActions: number) {
    const simulator = sim({ maxActions });
    simulator.apply({ name: 'inspect', targetId: 'ledger', intent }, cost(1_000));
    simulator.apply({ name: 'enter_code', targetId: 'wall-safe', code: '4471', intent }, cost(1_000));
    simulator.apply({ name: 'inspect', targetId: 'sea-chart', intent }, cost(1_000));
    simulator.apply({ name: 'enter_code', targetId: 'cabinet', code: '1770', intent }, cost(1_000));
    simulator.apply({ name: 'inspect', targetId: 'logbook', intent }, cost(1_000));
    const last = simulator.apply({ name: 'submit_answer', puzzleId: 'p3', answer: 'north', intent }, cost(1_000));
    return { simulator, last };
  }

  it('ends the run the moment the exit puzzle is solved', () => {
    const { simulator, last } = escape(20);
    expect(last.ended).toBe('escaped');
    expect(simulator.hasEnded()).toBe(true);
  });

  it('records the action count and elapsed time it escaped on', () => {
    const summary = escape(20).simulator.summarise();
    expect(summary.escaped).toBe(true);
    expect(summary.escapeActionCount).toBe(6);
    expect(summary.escapeMs).toBe(6_000);
    expect(summary.puzzlesSolved).toBe(3);
    expect(summary.endedBecause).toBe('escaped');
  });

  /** Escaping beats running out: a model that solved the room escaped, full stop. */
  it('prefers escaped over budget_actions when the last action does both', () => {
    const { last, simulator } = escape(6);
    expect(last.ended).toBe('escaped');
    expect(simulator.summarise().endedBecause).toBe('escaped');
  });

  it('leaves escape fields null when the competitor did not escape', () => {
    const simulator = sim({ maxActions: 1 });
    simulator.apply({ name: 'look', intent }, cost(500));
    const summary = simulator.summarise();
    expect(summary.escaped).toBe(false);
    expect(summary.escapeActionCount).toBeNull();
    expect(summary.escapeMs).toBeNull();
  });
});

describe('createSimulator — summarise', () => {
  it('refuses to summarise a run that has not ended', () => {
    expect(() => sim().summarise()).toThrow(SimulatorError);
  });

  it('accumulates tokens across every action, valid or not', () => {
    const simulator = sim({ maxActions: 3 });
    simulator.apply({ name: 'look', intent }, cost(0, 100, 20));
    simulator.apply({ name: 'fly' }, cost(0, 50, 10));
    simulator.apply({ name: 'look', intent }, cost(0, 30, 5));
    expect(simulator.summarise().tokens).toEqual({ prompt: 180, completion: 35 });
  });

  it('separates failed attempts from invalid actions, and counts locked as neither', () => {
    const simulator = sim({ maxActions: 4 });
    simulator.apply({ name: 'enter_code', targetId: 'wall-safe', code: '0000', intent }, NO_COST); // failed
    simulator.apply({ name: 'submit_answer', puzzleId: 'p3', answer: 'south', intent }, NO_COST); // failed
    simulator.apply({ name: 'inspect', targetId: 'bookshelf', intent }, NO_COST); // invalid
    simulator.apply({ name: 'open', targetId: 'wall-safe', intent }, NO_COST); // locked — neither
    const summary = simulator.summarise();
    expect(summary.failedAttempts).toBe(2);
    expect(summary.invalidActions).toBe(1);
  });

  it('counts a wrong key as a failed attempt, not as locked', () => {
    const cellar: RoomSpec = {
      ...spec,
      objects: [
        { id: 'key', name: 'brass key', description: 'A key.', kind: 'portable', lock: null, contains: [], clueText: null },
        { id: 'spoon', name: 'tin spoon', description: 'A spoon.', kind: 'portable', lock: null, contains: [], clueText: null },
        { id: 'gate', name: 'iron gate', description: 'A gate.', kind: 'door', lock: { opensWith: 'key', keyItemId: 'key' }, contains: [], clueText: null },
      ],
      puzzles: [{ id: 'k1', order: 1, kind: 'key', clueObjectId: 'key', answer: 'key', unlocksObjectId: 'gate' }],
      exit: { objectId: 'gate', requiresPuzzleId: 'k1' },
      solution: { order: ['k1'] },
    };
    const simulator = createSimulator({ spec: cellar, budget: { ...budget, maxActions: 2 }, competitorId: 'model-a' });
    simulator.apply({ name: 'take', targetId: 'spoon', intent }, NO_COST);
    simulator.apply({ name: 'use', itemId: 'spoon', targetId: 'gate', intent }, NO_COST);
    const summary = simulator.summarise();
    expect(summary.failedAttempts).toBe(1);
    expect(summary.invalidActions).toBe(0);
  });

  it('does not report costUsd — the harness knows pricing and this does not', () => {
    const simulator = sim({ maxActions: 1 });
    simulator.apply({ name: 'look', intent }, NO_COST);
    expect(simulator.summarise()).not.toHaveProperty('costUsd');
  });
});

describe('VERDICT_TALLY', () => {
  it('classifies every verdict code, so a new one cannot go uncounted', () => {
    for (const code of VERDICT_CODES) {
      expect(VERDICT_TALLY[code]).toBeDefined();
    }
  });
});

describe('createSimulator — independence', () => {
  /**
   * The quietly catastrophic bug this guards: a shared state would let one model
   * walk through a door the other opened, and every published result would be
   * wrong without anything looking broken.
   */
  it('gives two competitors on one spec entirely separate rooms', () => {
    const a = createSimulator({ spec, budget, competitorId: 'model-a' });
    const b = createSimulator({ spec, budget, competitorId: 'model-b' });

    a.apply({ name: 'enter_code', targetId: 'wall-safe', code: '4471', intent }, NO_COST);

    expect(a.observe().visible.find((o) => o.id === 'wall-safe')?.locked).toBe(false);
    expect(b.observe().visible.find((o) => o.id === 'wall-safe')?.locked).toBe(true);
    expect(b.apply({ name: 'inspect', targetId: 'sea-chart', intent }, NO_COST).verdict.code).toBe('not_found');
  });

  it('gives identical action sequences identical outcomes', () => {
    const a = createSimulator({ spec, budget: { ...budget, maxActions: 2 }, competitorId: 'a' });
    const b = createSimulator({ spec, budget: { ...budget, maxActions: 2 }, competitorId: 'b' });
    const actions = [
      { name: 'enter_code', targetId: 'wall-safe', code: '4471', intent },
      { name: 'inspect', targetId: 'sea-chart', intent },
    ];
    const codesA = actions.map((action) => a.apply(action, NO_COST).verdict);
    const codesB = actions.map((action) => b.apply(action, NO_COST).verdict);
    expect(codesA).toEqual(codesB);
    expect({ ...a.summarise(), competitorId: 'x' }).toEqual({ ...b.summarise(), competitorId: 'x' });
  });
});
