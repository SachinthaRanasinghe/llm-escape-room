import type { Rng } from '@/lib/rng';
import { ANSWER_DOMAINS, DIFFICULTY_RANGES } from '@/lib/solver';
import { narrowProposal } from '../proposal';
import type { AttemptFeedback, Band, GeneratorStrategy, StructuralBrief } from '../types';

/**
 * The `symbolic` strategy — digit codes, then one prose answer from a closed
 * lexicon. TICKET-5 (#6).
 *
 * It is the only substrate the solver can certify today: `derivation.ts` reads
 * a code as a digit run of the answer's width and a prose answer as one member
 * of an `ANSWER_DOMAINS` list, and nothing else. So the prompt below is those
 * rules, written as hard constraints — every sentence in it maps to a rejection
 * code a model would otherwise learn about one wasted attempt at a time.
 *
 * The shape is the canonical fixture's: code locks down the chain, and a final
 * `answer` puzzle that opens the door. No key locks.
 */

/**
 * The PRD asks for "a short chain of ~3 puzzles", and every action is a beat on
 * screen against the 60–90 second watch target. Four is the ceiling until
 * TICKET-7 measures otherwise — which puts `hard` out of this strategy's reach.
 */
export const MAX_CHAIN_LENGTH = 4;

const CODE_WIDTHS = [3, 4, 5] as const;

/** Settings, not stories: the model writes the story. Kept free of digits and lexicon words. */
export const THEME_HINTS = [
  'a lighthouse keeper’s lamp room',
  'an apothecary’s back room',
  'a disused observatory',
  'a ship’s chart room below deck',
  'a clockmaker’s workshop',
  'a monastery scriptorium',
  'a railway signal box',
  'a botanist’s glasshouse',
  'a bank vault antechamber',
  'a theatre’s prop store',
  'a mountain weather station',
  'a bookbinder’s attic',
] as const;

/** Every chain length whose intended action count (two per link) fits the band. */
export function chainLengthsFor(band: Band): number[] {
  const range = DIFFICULTY_RANGES[band];
  const lengths: number[] = [];
  for (let length = 1; length <= MAX_CHAIN_LENGTH; length++) {
    if (2 * length >= range.min && 2 * length <= range.max) lengths.push(length);
  }
  return lengths;
}

/**
 * The shape, never the content: a two-puzzle room whose answers are obviously
 * placeholders. Written by hand rather than drawn from `lib/solver/fuzz.ts`,
 * which is test support and has no business on a generation path.
 */
const EXAMPLE = {
  theme: { name: 'The Example Room', description: 'One sentence setting the scene.' },
  objects: [
    { id: 'shelf', name: 'bookshelf', description: 'A tall bookshelf.', kind: 'container', lock: null, contains: ['note'], clueText: 'Rows of dull almanacs. A folded note sticks out.' },
    { id: 'note', name: 'folded note', description: 'A folded scrap of paper.', kind: 'portable', lock: null, contains: [], clueText: 'Scrawled in pencil: 123.' },
    { id: 'strongbox', name: 'strongbox', description: 'A strongbox with a dial.', kind: 'container', lock: { opensWith: 'code', code: '123' }, contains: ['diary'], clueText: 'The dial has three wheels.' },
    { id: 'diary', name: 'diary', description: 'A small diary.', kind: 'portable', lock: null, contains: [], clueText: 'The last line reads: the answer is WORD.' },
    { id: 'door', name: 'door', description: 'A heavy door with a brass plate.', kind: 'door', lock: null, contains: [], clueText: 'The plate asks a question.' },
    { id: 'rug', name: 'rug', description: 'A threadbare rug.', kind: 'fixture', lock: null, contains: [], clueText: 'Worn through at the edges, nothing beneath.' },
  ],
  puzzles: [
    { id: 'p1', order: 1, kind: 'code', clueObjectId: 'note', answer: '123', unlocksObjectId: 'strongbox' },
    { id: 'p2', order: 2, kind: 'answer', clueObjectId: 'diary', answer: 'WORD', unlocksObjectId: 'door' },
  ],
  exit: { objectId: 'door', requiresPuzzleId: 'p2' },
  estimatedActions: 8,
  solutionOrder: ['p1', 'p2'],
};

export interface SymbolicOptions {
  readonly band?: Band;
}

export function createSymbolicStrategy({ band = 'standard' }: SymbolicOptions = {}): GeneratorStrategy {
  return {
    name: 'symbolic',

    brief(rng: Rng): StructuralBrief {
      const lengths = chainLengthsFor(band);
      if (lengths.length === 0) {
        throw new RangeError(
          `symbolic: band "${band}" needs more than ${MAX_CHAIN_LENGTH} puzzles, above this strategy's chain cap`,
        );
      }
      const chainLength = rng.pick(lengths);
      return {
        chainLength,
        band,
        finalAnswerDomain: rng.pick(Object.keys(ANSWER_DOMAINS).sort()),
        codeWidths: Array.from({ length: chainLength - 1 }, () => rng.pick(CODE_WIDTHS)),
        decoys: rng.int(1, 3),
        themeHint: rng.pick(THEME_HINTS),
      };
    },

    system(): string {
      return (
        'You design small, logically airtight escape rooms for a puzzle engine. ' +
        'A machine verifier checks every room you write, literally and without judgement. ' +
        'Respond with a single JSON object and nothing else.'
      );
    },

    prompt(brief: StructuralBrief, feedback: AttemptFeedback | null): string {
      return [...promptLines(brief), ...feedbackLines(feedback)].join('\n');
    },

    narrow: narrowProposal,
  };
}

function promptLines(brief: StructuralBrief): string[] {
  const n = brief.chainLength;
  const words = ANSWER_DOMAINS[brief.finalAnswerDomain] ?? [];
  const codeRules = brief.codeWidths.map(
    (width, i) => `   - puzzle p${i + 1}: a ${width}-digit code (quoted as a string, e.g. "${'7'.repeat(width)}" is the shape, not the value)`,
  );

  return [
    `Design an escape room set in ${brief.themeHint}. Write it as one JSON object.`,
    '',
    'HARD CONSTRAINTS — the verifier rejects the room if any is broken:',
    `1. Exactly ${n} puzzles, ids p1..p${n}, with "order" 1..${n}, forming one linear chain.`,
    `   The clue object for puzzle N+1 must be INSIDE (directly, or nested) the object that puzzle N unlocks,`,
    '   so it cannot be reached before puzzle N is solved. The clue object for p1 must be reachable at the start:',
    '   on the floor, or inside an unlocked container.',
    ...(n > 1
      ? [
          `2. Puzzles p1..p${n - 1} are "kind": "code". Each unlocks a "container" or "lock" object whose`,
          '   "lock" is {"opensWith": "code", "code": <the same string as the puzzle answer>}. Code widths:',
          ...codeRules,
          '   All codes must differ from each other.',
        ]
      : ['2. There are no code puzzles.']),
    `3. Puzzle p${n} is "kind": "answer". It unlocks an object with id "door", "kind": "door", "lock": null,`,
    `   and "exit" is {"objectId": "door", "requiresPuzzleId": "p${n}"}. Its answer is exactly ONE of these words:`,
    `   ${words.join(', ')}.`,
    '4. Each puzzle\'s clue object has a "clueText" that states its answer so a careful reader can find it:',
    '   - a code clue contains the code as digits, and NO OTHER number with the same count of digits',
    '     (no years, totals or dates of that width anywhere in that clueText);',
    `   - the final clue contains the answer word exactly as written, and NO OTHER word from the list above.`,
    '   An object\'s "description" is what is seen at a glance: it must never contain a clue or an answer.',
    `5. Exactly ${brief.decoys} extra decoy object(s): unlocked, holding nothing, with a short "clueText" that`,
    '   contains no digits and none of the words from the list above.',
    `6. "estimatedActions" is an integer from ${2 * n} to ${6 * n}; if unsure, use ${3 * n}.`,
    '7. Every id is unique; every id referenced anywhere exists; an object is inside at most one other object;',
    '   nothing contains itself. Object "kind" is one of: container, fixture, portable, lock, door.',
    `8. "solutionOrder" is ["p1", ..., "p${n}"].`,
    '',
    'The JSON shape, with placeholder content — copy the SHAPE, never the content:',
    JSON.stringify(EXAMPLE),
  ];
}

function feedbackLines(feedback: AttemptFeedback | null): string[] {
  if (feedback === null || feedback.lines.length === 0) return [];
  return [
    '',
    'Your previous room was rejected by the verifier for:',
    ...feedback.lines.map((line) => `- ${line}`),
    'Write a complete new room as one JSON object that satisfies every constraint above.',
  ];
}
