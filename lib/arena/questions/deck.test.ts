import { describe, expect, it } from 'vitest';
import { BANK } from './bank';
import { createDeck, DeckExhaustedError } from './deck';

describe('createDeck', () => {
  it('draws the same sequence for the same seed, forever', () => {
    const a = createDeck('arena-seed');
    const b = createDeck('arena-seed');
    const drawn = [a.draw('medium').id, a.draw('hard').id, a.draw('medium').id];
    expect([b.draw('medium').id, b.draw('hard').id, b.draw('medium').id]).toEqual(drawn);
    // Pinned: changing the shuffle or the bank order changes which questions a seed draws.
    expect(drawn).toMatchInlineSnapshot(`
      [
        "m-sql-1",
        "h-logic-1",
        "m-sql-5",
      ]
    `);
  });

  it('keeps tiers independent: claims before a steal never change the hard question', () => {
    const a = createDeck('s');
    const b = createDeck('s');
    a.draw('medium');
    a.draw('medium');
    expect(a.draw('hard').id).toBe(b.draw('hard').id);
  });

  it('never repeats within a match and only draws its own tier', () => {
    const deck = createDeck('no-repeats');
    for (const tier of ['medium', 'hard'] as const) {
      const ids = Array.from({ length: 30 }, () => deck.draw(tier));
      expect(new Set(ids.map((q) => q.id)).size).toBe(30);
      expect(ids.every((q) => q.tier === tier)).toBe(true);
    }
  });

  it('throws when a tier runs out — a bank too small is a bug, not a model failure', () => {
    const deck = createDeck('tiny', BANK.filter((q) => q.tier === 'hard').slice(0, 1));
    deck.draw('hard');
    expect(deck.remaining('hard')).toBe(0);
    expect(() => deck.draw('hard')).toThrow(DeckExhaustedError);
    expect(() => deck.draw('medium')).toThrow(DeckExhaustedError);
  });
});
