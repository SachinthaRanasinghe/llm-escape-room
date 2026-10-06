import { createRng } from '@/lib/rng';
import type { QuestionTier } from '../schema';
import { BANK } from './bank';
import type { Question } from './types';

/**
 * The questions a match draws, in a seeded order — one shuffled deck per tier.
 *
 * Seeded from the match id, so a match's questions are reproducible from its
 * record, and the models — not the deck — supply the nondeterminism. Each tier
 * is shuffled from its own derived seed, so how many claims came before a steal
 * never changes which hard question the steal draws. A question is never drawn
 * twice in one match.
 */

export interface Deck {
  draw(tier: QuestionTier): Question;
  remaining(tier: QuestionTier): number;
}

export class DeckExhaustedError extends Error {
  constructor(tier: QuestionTier) {
    super(`the ${tier} deck is exhausted — the bank needs more ${tier} questions than a match can draw`);
    this.name = new.target.name;
  }
}

export function createDeck(seed: string, bank: readonly Question[] = BANK): Deck {
  const decks: Record<QuestionTier, Question[]> = {
    medium: createRng(`${seed}:medium`).shuffle(bank.filter((q) => q.tier === 'medium')),
    hard: createRng(`${seed}:hard`).shuffle(bank.filter((q) => q.tier === 'hard')),
  };
  return {
    draw(tier) {
      const next = decks[tier].shift();
      if (next === undefined) throw new DeckExhaustedError(tier);
      return next;
    },
    remaining(tier) {
      return decks[tier].length;
    },
  };
}
