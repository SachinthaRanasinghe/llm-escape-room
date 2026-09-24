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
import { CODE_CLUE_LINES, DESCRIPTION_LINE, codeWidthLine } from './symbolic';
import { keyLinkRules, keyPlacementRule } from './spatial';

/**
 * The `mixed` strategy — codes and keys interleaved, then a spoken answer —
 * TICKET-7 (#8).
 *
 * The third arm of the substrate spike: some links are read (a code off a
 * clue), some are found (a key in a container), and the last is a word from a
 * closed lexicon, as in `symbolic`. If reading and searching each separate the
 * models a little, switching between them may separate them more.
 *
 * ── A mixed room is genuinely mixed ────────────────────────────────────────
 * The non-final links are drawn code-or-key from the seed. With two or more of
 * them, an all-code or all-key draw would just be a `symbolic` or near-`spatial`
 * room wearing this strategy's name and would blur the comparison, so one link
 * is flipped. With a chain of two there is only one non-final link, and it
 * cannot be both: those rooms are code → answer or key → answer.
 */

type NonFinal = 'code' | 'key';

/** The shape, never the content: a code, then a key, then the answer. `WORD` is obviously a placeholder. */
const EXAMPLE = {
  theme: { name: 'The Example Room', description: 'One sentence setting the scene.' },
  objects: [
    { id: 'note', name: 'folded note', description: 'A folded scrap of paper.', kind: 'portable', lock: null, contains: [], clueText: 'Scrawled in pencil: 123.' },
    { id: 'box', name: 'strongbox', description: 'A strongbox with a dial.', kind: 'container', lock: { opensWith: 'code', code: '123' }, contains: ['key-a'], clueText: 'The dial has three wheels.' },
    { id: 'key-a', name: 'small key', description: 'A small iron key.', kind: 'portable', lock: null, contains: [], clueText: 'Plain and worn.' },
    { id: 'chest', name: 'chest', description: 'A chest with a keyhole.', kind: 'container', lock: { opensWith: 'key', keyItemId: 'key-a' }, contains: ['diary'], clueText: 'The keyhole is small.' },
    { id: 'diary', name: 'diary', description: 'A small diary.', kind: 'portable', lock: null, contains: [], clueText: 'The last line reads: the answer is WORD.' },
    { id: 'door', name: 'door', description: 'A heavy door with a brass plate.', kind: 'door', lock: null, contains: [], clueText: 'The plate asks a question.' },
  ],
  puzzles: [
    { id: 'p1', order: 1, kind: 'code', clueObjectId: 'note', answer: '123', unlocksObjectId: 'box' },
    { id: 'p2', order: 2, kind: 'key', clueObjectId: 'key-a', answer: 'key-a', unlocksObjectId: 'chest' },
    { id: 'p3', order: 3, kind: 'answer', clueObjectId: 'diary', answer: 'WORD', unlocksObjectId: 'door' },
  ],
  exit: { objectId: 'door', requiresPuzzleId: 'p3' },
  estimatedActions: 9,
  solutionOrder: ['p1', 'p2', 'p3'],
};

export interface MixedOptions {
  readonly band?: Band;
}

export function createMixedStrategy({ band = 'standard' }: MixedOptions = {}): GeneratorStrategy {
  return {
    name: 'mixed',

    brief(rng: Rng): StructuralBrief {
      // A mixed room needs a link before the final answer.
      const lengths = chainLengthsFor(band).filter((length) => length >= 2);
      if (lengths.length === 0) {
        throw new RangeError(
          `mixed: band "${band}" has no chain of 2..${MAX_CHAIN_LENGTH} puzzles, which this strategy needs`,
        );
      }
      const chainLength = rng.pick(lengths);
      const nonFinal: NonFinal[] = Array.from({ length: chainLength - 1 }, () => rng.pick<NonFinal>(['code', 'key']));
      if (nonFinal.length >= 2 && nonFinal.every((kind) => kind === nonFinal[0])) {
        const flip = rng.int(0, nonFinal.length - 1);
        nonFinal[flip] = nonFinal[flip] === 'code' ? 'key' : 'code';
      }
      return {
        chainLength,
        band,
        linkKinds: [...nonFinal, 'answer'],
        finalAnswerDomain: rng.pick(Object.keys(ANSWER_DOMAINS).sort()),
        codeWidths: nonFinal.filter((kind) => kind === 'code').map(() => rng.pick(CODE_WIDTHS)),
        decoys: rng.int(1, 3),
        decoyKeys: rng.int(0, 1),
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
  const nonFinal = brief.linkKinds.slice(0, -1);
  const hasCode = nonFinal.includes('code');
  const hasKey = nonFinal.includes('key');

  let codeIndex = 0;
  const linkLines = nonFinal.map((kind, i) =>
    kind === 'code'
      ? `${codeWidthLine(i + 1, brief.codeWidths[codeIndex++]!)} — "kind": "code"`
      : `   - puzzle p${i + 1}: a key — "kind": "key"`,
  );

  return [
    `Design an escape room set in ${brief.themeHint}. Write it as one JSON object.`,
    '',
    'HARD CONSTRAINTS — the verifier rejects the room if any is broken:',
    ...chainRule(n),
    `2. The links before the last, in this exact order:`,
    ...linkLines,
    ...(hasCode
      ? [
          '3. A code puzzle unlocks a "container" or "lock" object whose "lock" is',
          '   {"opensWith": "code", "code": <the same string as the puzzle answer>}. All codes differ.',
          '   A code puzzle\'s clue object has a "clueText" that states the code:',
          ...CODE_CLUE_LINES,
        ]
      : ['3. There are no code puzzles.']),
    ...(hasKey
      ? [...keyLinkRules(4, 'Every key puzzle is'), ...keyPlacementRule(5)]
      : ['4. There are no key puzzles.', '5. There are no keys to place.']),
    `6. Puzzle p${n} is "kind": "answer". It unlocks an object with id "door", "kind": "door", "lock": null,`,
    `   and "exit" is {"objectId": "door", "requiresPuzzleId": "p${n}"}. Its answer is exactly ONE of these words:`,
    `   ${words.join(', ')}.`,
    `   Its clue object's "clueText" contains that word exactly as written, and NO OTHER word from the list.`,
    DESCRIPTION_LINE,
    `7. Exactly ${brief.decoys} decoy object(s): unlocked, holding nothing, with a short "clueText" that contains no`,
    '   digits and none of the words from the list above.' +
      (brief.decoyKeys > 0 ? ` Plus exactly ${brief.decoyKeys} decoy key(s): portable keys that fit NO lock.` : ''),
    estimateRule(8, n),
    ...idRule(9),
    solutionOrderRule(10, n),
    ...exampleLines(EXAMPLE),
  ];
}
