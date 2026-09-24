import type { Rng } from '@/lib/rng';
import { ANSWER_DOMAINS } from '@/lib/solver';
import { narrowProposal } from '../proposal';
import type { AttemptFeedback, Band, GeneratorStrategy, StructuralBrief } from '../types';
import {
  CODE_WIDTHS,
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

// Re-exported so existing importers keep working; the definitions moved to `shared.ts`.
export { MAX_CHAIN_LENGTH, THEME_HINTS, chainLengthsFor } from './shared';

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
 *
 * The substrate-free rules — chain, ids, order, feedback — live in `shared.ts`
 * since TICKET-7 (#8); this file keeps what makes a link symbolic.
 */

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
      // Draw order is fixed: a new draw here would change every existing seed's brief.
      const chainLength = rng.pick(lengths);
      return {
        chainLength,
        band,
        linkKinds: [...Array<'code'>(chainLength - 1).fill('code'), 'answer'],
        finalAnswerDomain: rng.pick(Object.keys(ANSWER_DOMAINS).sort()),
        codeWidths: Array.from({ length: chainLength - 1 }, () => rng.pick(CODE_WIDTHS)),
        decoys: rng.int(1, 3),
        decoyKeys: 0,
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
  const words = brief.finalAnswerDomain === null ? [] : (ANSWER_DOMAINS[brief.finalAnswerDomain] ?? []);
  const codeRules = brief.codeWidths.map((width, i) => codeWidthLine(i + 1, width));

  return [
    `Design an escape room set in ${brief.themeHint}. Write it as one JSON object.`,
    '',
    'HARD CONSTRAINTS — the verifier rejects the room if any is broken:',
    ...chainRule(n),
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
    ...CODE_CLUE_LINES,
    `   - the final clue contains the answer word exactly as written, and NO OTHER word from the list above.`,
    DESCRIPTION_LINE,
    `5. Exactly ${brief.decoys} extra decoy object(s): unlocked, holding nothing, with a short "clueText" that`,
    '   contains no digits and none of the words from the list above.',
    estimateRule(6, n),
    ...idRule(7),
    solutionOrderRule(8, n),
    ...exampleLines(EXAMPLE),
  ];
}

/** One code link's width, as `mixed` also states it. */
export function codeWidthLine(puzzleNumber: number, width: number): string {
  return `   - puzzle p${puzzleNumber}: a ${width}-digit code (quoted as a string, e.g. "${'7'.repeat(width)}" is the shape, not the value)`;
}

/** What `derivation.ts` needs from a code clue — shared with `mixed`. */
export const CODE_CLUE_LINES = [
  '   - a code clue contains the code as digits, and NO OTHER number with the same count of digits',
  '     (no years, totals or dates of that width anywhere in that clueText);',
] as const;

export const DESCRIPTION_LINE =
  '   An object\'s "description" is what is seen at a glance: it must never contain a clue or an answer.';
