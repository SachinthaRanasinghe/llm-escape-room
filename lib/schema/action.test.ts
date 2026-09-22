import { describe, expect, it } from 'vitest';
import {
  ACTION_NAMES,
  ActionError,
  ActionSchema,
  VERDICT_CODES,
  VerdictSchema,
  parseAction,
  type Action,
} from './action';

const look: Action = { name: 'look', intent: 'Get my bearings before touching anything.' };

describe('ActionSchema', () => {
  it('accepts every verb in the v0 vocabulary', () => {
    const actions: Action[] = [
      look,
      { name: 'inspect', targetId: 'desk', intent: 'The desk is the obvious start.' },
      { name: 'take', targetId: 'brass-key', intent: 'I will need this for the drawer.' },
      { name: 'open', targetId: 'drawer', intent: 'The clue said the drawer holds the next step.' },
      { name: 'use', itemId: 'brass-key', targetId: 'cabinet', intent: 'The key looks cabinet-sized.' },
      { name: 'enter_code', targetId: 'wall-safe', code: '4471', intent: 'The ledger totalled 4471.' },
      { name: 'submit_answer', puzzleId: 'p3', answer: 'north', intent: 'The compass rose points north.' },
    ];
    for (const action of actions) {
      expect(ActionSchema.parse(action)).toEqual(action);
    }
    expect(actions.map((a) => a.name)).toEqual([...ACTION_NAMES]);
  });

  it('requires intent on every single verb — it is a product feature, not a debug field', () => {
    const withoutIntent = [
      { name: 'look' },
      { name: 'inspect', targetId: 'desk' },
      { name: 'take', targetId: 'brass-key' },
      { name: 'open', targetId: 'drawer' },
      { name: 'use', itemId: 'brass-key', targetId: 'cabinet' },
      { name: 'enter_code', targetId: 'wall-safe', code: '4471' },
      { name: 'submit_answer', puzzleId: 'p3', answer: 'north' },
    ];
    for (const action of withoutIntent) {
      expect(ActionSchema.safeParse(action).success).toBe(false);
    }
  });

  it('rejects an empty intent', () => {
    expect(ActionSchema.safeParse({ name: 'look', intent: '' }).success).toBe(false);
  });

  it('rejects an intent too long to read at beat pace', () => {
    const wall = 'x'.repeat(281);
    expect(ActionSchema.safeParse({ name: 'look', intent: wall }).success).toBe(false);
  });

  it('rejects an unknown verb', () => {
    expect(ActionSchema.safeParse({ name: 'teleport', intent: 'Worth a try.' }).success).toBe(false);
  });

  it('rejects unknown keys — strictObject, so a typo is a failure not a silent drop', () => {
    const typo = { name: 'inspect', targetID: 'desk', targetId: 'desk', intent: 'Look closer.' };
    expect(ActionSchema.safeParse(typo).success).toBe(false);
  });

  it('rejects a verb missing its own arguments', () => {
    expect(ActionSchema.safeParse({ name: 'use', itemId: 'key', intent: 'Use it.' }).success).toBe(false);
    expect(ActionSchema.safeParse({ name: 'enter_code', targetId: 'safe', intent: 'Type it.' }).success).toBe(false);
  });

  it('rejects empty string arguments', () => {
    expect(ActionSchema.safeParse({ name: 'inspect', targetId: '', intent: 'Look.' }).success).toBe(false);
  });
});

describe('parseAction', () => {
  it('returns a typed action', () => {
    expect(parseAction(look)).toEqual(look);
  });

  it('throws ActionError carrying the issues, not a bare string', () => {
    try {
      parseAction({ name: 'look' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ActionError);
      expect((error as ActionError).issues.length).toBeGreaterThan(0);
      expect((error as ActionError).name).toBe('ActionError');
    }
  });
});

describe('VerdictSchema', () => {
  it('accepts every verdict code', () => {
    for (const code of VERDICT_CODES) {
      const verdict = { ok: code === 'ok', code, message: 'something happened' };
      expect(VerdictSchema.parse(verdict)).toEqual(verdict);
    }
  });

  it('names the two codes that scoring depends on', () => {
    // architecture.md: an invalid action returns an error AND consumes a turn.
    expect(VERDICT_CODES).toContain('malformed');
    expect(VERDICT_CODES).toContain('not_permitted');
  });

  it('rejects an unknown code', () => {
    expect(VerdictSchema.safeParse({ ok: false, code: 'exploded', message: 'x' }).success).toBe(false);
  });
});
