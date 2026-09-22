import { describe, expect, it } from 'vitest';
import { NO_COST, actionsRemaining, chargeLedger, createLedger, totalTokens, type ActionCost, type Budget } from './budget';

const budget: Budget = { maxActions: 3, maxTokens: 1_000, maxWallClockMs: 10_000 };

function cost(prompt: number, completion: number, elapsedMs: number): ActionCost {
  return { tokens: { prompt, completion }, elapsedMs };
}

describe('createLedger', () => {
  it('starts empty and remembers its budget', () => {
    const ledger = createLedger(budget);
    expect(ledger.actions).toBe(0);
    expect(totalTokens(ledger)).toBe(0);
    expect(ledger.elapsedMs).toBe(0);
    expect(actionsRemaining(ledger)).toBe(3);
  });
});

describe('chargeLedger', () => {
  it('accumulates actions, tokens and elapsed time', () => {
    const { ledger } = chargeLedger(chargeLedger(createLedger(budget), cost(10, 5, 100)).ledger, cost(20, 5, 200));
    expect(ledger.actions).toBe(2);
    expect(ledger.promptTokens).toBe(30);
    expect(ledger.completionTokens).toBe(10);
    expect(ledger.elapsedMs).toBe(300);
  });

  it('does not mutate the ledger it was given', () => {
    const ledger = createLedger(budget);
    chargeLedger(ledger, cost(10, 5, 100));
    expect(ledger.actions).toBe(0);
    expect(ledger.promptTokens).toBe(0);
  });

  it('is not exhausted while the budget holds', () => {
    expect(chargeLedger(createLedger(budget), cost(1, 1, 1)).exhausted).toBeNull();
  });

  /** The golden run ends model-b on its 14th action against `maxActions: 14`. */
  it('ends the run on the action that reaches the cap, not the one after', () => {
    let ledger = createLedger(budget);
    const reasons = [];
    for (let i = 0; i < 3; i += 1) {
      const charged = chargeLedger(ledger, NO_COST);
      ledger = charged.ledger;
      reasons.push(charged.exhausted);
    }
    expect(reasons).toEqual([null, null, 'budget_actions']);
    expect(actionsRemaining(ledger)).toBe(0);
  });

  it('ends on tokens independently of actions', () => {
    const { exhausted } = chargeLedger(createLedger(budget), cost(600, 400, 0));
    expect(exhausted).toBe('budget_tokens');
  });

  it('counts prompt and completion tokens against one cap', () => {
    const first = chargeLedger(createLedger(budget), cost(900, 0, 0));
    expect(first.exhausted).toBeNull();
    expect(chargeLedger(first.ledger, cost(0, 100, 0)).exhausted).toBe('budget_tokens');
  });

  it('ends on wall clock independently of actions and tokens', () => {
    expect(chargeLedger(createLedger(budget), cost(1, 1, 10_000)).exhausted).toBe('budget_time');
  });

  /** Fixed order, so a replay reports the same reason every time. */
  it('reports budget_actions first when several caps trip at once', () => {
    let ledger = createLedger(budget);
    ledger = chargeLedger(ledger, NO_COST).ledger;
    ledger = chargeLedger(ledger, NO_COST).ledger;
    expect(chargeLedger(ledger, cost(5_000, 5_000, 99_999)).exhausted).toBe('budget_actions');
  });

  it('reports budget_tokens before budget_time', () => {
    const { exhausted } = chargeLedger(createLedger(budget), cost(5_000, 0, 99_999));
    expect(exhausted).toBe('budget_tokens');
  });

  it('never returns a negative number of remaining actions', () => {
    let ledger = createLedger({ ...budget, maxActions: 1 });
    ledger = chargeLedger(ledger, NO_COST).ledger;
    ledger = chargeLedger(ledger, NO_COST).ledger;
    expect(actionsRemaining(ledger)).toBe(0);
  });
});
