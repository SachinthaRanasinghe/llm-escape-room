import type { Rng } from '@/lib/rng';
import { narrowProposal } from '../proposal';
import type { AttemptFeedback, Band, GeneratorStrategy, StructuralBrief } from '../types';
import {
  MAX_CHAIN_LENGTH,
  THEME_HINTS,
  chainLengthsFor,
  chainRule,
  estimateRule,
  exampleLines,
  feedbackLines,
  idRule,
  solutionOrderRule,
  systemPrompt,
} from './shared';

/**
 * The `spatial` strategy — every link is a key — TICKET-7 (#8).
 *
 * Where `symbolic` asks a competitor to READ an answer off a clue, this asks it
 * to FIND something: which container holds the key, which of several keys fits,
 * what the last lock opened. The work is search and manipulation — `open`,
 * `take`, `use` — which exercises the object graph and the interface, where two
 * models plausibly differ more than they do at reading a digit run.
 *
 * It is machine-checkable with the solver's existing machinery: a `key` puzzle
 * certifies when its key lies in (or is) its clue object and its lock names that
 * key (`lib/solver/structure.ts`, `derivation.ts`). Decoy keys fit nothing; a
 * competitor trying one gets `wrong_key`, counted as a failed attempt.
 *
 * Every prompt sentence maps to a rejection code, as in `symbolic.ts`.
 */

/** The shape, never the content. Exported so a test can prove the shape a model copies certifies. */
export const SPATIAL_EXAMPLE = {
  theme: { name: 'The Example Room', description: 'One sentence setting the scene.' },
  objects: [
    { id: 'crate', name: 'wooden crate', description: 'An open wooden crate.', kind: 'container', lock: null, contains: ['key-a'], clueText: 'Packed with straw. Something small glints at the bottom.' },
    { id: 'key-a', name: 'small key', description: 'A small iron key.', kind: 'portable', lock: null, contains: [], clueText: 'Plain and worn.' },
    { id: 'chest', name: 'chest', description: 'A chest with a keyhole.', kind: 'container', lock: { opensWith: 'key', keyItemId: 'key-a' }, contains: ['key-b'], clueText: 'The keyhole is small.' },
    { id: 'key-b', name: 'long key', description: 'A long key.', kind: 'portable', lock: null, contains: [], clueText: 'Heavier than it looks.' },
    { id: 'door', name: 'door', description: 'A heavy door with a lock.', kind: 'door', lock: { opensWith: 'key', keyItemId: 'key-b' }, contains: [], clueText: 'The lock is deep-set.' },
    { id: 'spare-key', name: 'bent key', description: 'A bent key.', kind: 'portable', lock: null, contains: [], clueText: 'It looks like it fits something.' },
    { id: 'rug', name: 'rug', description: 'A threadbare rug.', kind: 'fixture', lock: null, contains: [], clueText: 'Worn through at the edges, nothing beneath.' },
  ],
  puzzles: [
    { id: 'p1', order: 1, kind: 'key', clueObjectId: 'crate', answer: 'key-a', unlocksObjectId: 'chest' },
    { id: 'p2', order: 2, kind: 'key', clueObjectId: 'key-b', answer: 'key-b', unlocksObjectId: 'door' },
  ],
  exit: { objectId: 'door', requiresPuzzleId: 'p2' },
  estimatedActions: 8,
  solutionOrder: ['p1', 'p2'],
};

export interface SpatialOptions {
  readonly band?: Band;
}

export function createSpatialStrategy({ band = 'standard' }: SpatialOptions = {}): GeneratorStrategy {
  return {
    name: 'spatial',

    brief(rng: Rng): StructuralBrief {
      const lengths = chainLengthsFor(band);
      if (lengths.length === 0) {
        throw new RangeError(
          `spatial: band "${band}" needs more than ${MAX_CHAIN_LENGTH} puzzles, above this strategy's chain cap`,
        );
      }
      const chainLength = rng.pick(lengths);
      return {
        chainLength,
        band,
        linkKinds: Array<'key'>(chainLength).fill('key'),
        finalAnswerDomain: null,
        codeWidths: [],
        decoys: rng.int(1, 3),
        decoyKeys: rng.int(1, 2),
        themeHint: rng.pick(THEME_HINTS),
      };
    },

    system: systemPrompt,

    prompt(brief: StructuralBrief, feedback: AttemptFeedback | null): string {
      return [...promptLines(brief), ...feedbackLines(feedback)].join('\n');
    },

    narrow: narrowProposal,
  };
}

function promptLines(brief: StructuralBrief): string[] {
  const n = brief.chainLength;
  return [
    `Design an escape room set in ${brief.themeHint}. Write it as one JSON object.`,
    '',
    'HARD CONSTRAINTS — the verifier rejects the room if any is broken:',
    ...chainRule(n),
    ...keyLinkRules(2, n === 1 ? 'Puzzle p1 is' : `Puzzles p1..p${n} are`),
    `3. Puzzle p${n} unlocks an object with id "door", "kind": "door", locked with its key the same way,`,
    `   and "exit" is {"objectId": "door", "requiresPuzzleId": "p${n}"}.`,
    ...keyPlacementRule(4),
    `5. Exactly ${brief.decoyKeys} decoy key(s): "portable" objects named like keys that fit NO lock, lying where`,
    `   they can be reached. Plus exactly ${brief.decoys} other decoy object(s): unlocked, holding nothing.`,
    estimateRule(6, n),
    ...idRule(7),
    solutionOrderRule(8, n),
    ...exampleLines(SPATIAL_EXAMPLE),
  ];
}

/**
 * The key-link rule — shared with `mixed`, numbered by the caller. `subject`
 * names which puzzles it covers: `Puzzles p1..p3 are`, `Every key puzzle is`.
 */
export function keyLinkRules(number: number, subject: string): string[] {
  return [
    `${number}. ${subject} "kind": "key". A key puzzle's "answer" is the id of a "portable" key object, and the`,
    '   object it unlocks has "lock": {"opensWith": "key", "keyItemId": <that same id>}. Every key is a different object.',
  ];
}

/** Where keys go, and what may not be said about them — shared with `mixed`. */
export function keyPlacementRule(number: number): string[] {
  return [
    `${number}. A key puzzle's "clueObjectId" is the key itself, or the container the key lies in. If p1 is a key`,
    '   puzzle, its key is reachable at the start (on the floor, or in unlocked containers up to two deep); the key',
    '   for any later puzzle is inside what the previous puzzle unlocks. No "description" or "clueText" says which',
    '   lock a key fits.',
  ];
}
