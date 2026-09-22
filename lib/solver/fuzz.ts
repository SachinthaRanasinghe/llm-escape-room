import { createRng, type Rng } from '@/lib/rng';
import { SPEC_VERSION } from '@/lib/schema/version';
import type { RoomObject, RoomSpec } from '@/lib/schema/room';
import { ANSWER_DOMAINS } from './lexicon';
import { bandFor } from './difficulty';
import type { RejectionCode } from './rejections';

/**
 * Seeded room generation, for property-testing the verifier against rooms nobody
 * hand-wrote.
 *
 * ── Why this is hand-rolled ────────────────────────────────────────────────
 * `fast-check` would give real shrinking and a smaller counterexample on
 * failure, which is genuinely better. It was rejected for the reason `lib/rng.ts`
 * gives for having no upstream of its own: this project's reproducibility
 * guarantee is that a seed reproduces an artifact forever, and a guarantee with
 * a dependency is one somebody else can change. Every generator here draws from
 * `createRng`, so a failing property test is reproduced by quoting its seed.
 *
 * ── It ships in lib/, not in a test file ───────────────────────────────────
 * TICKET-5 (#6) needs valid rooms to test its generator loop against without
 * calling a model, and `buildValidRoom` is exactly that. It is deliberately NOT
 * re-exported from `index.ts` — nothing on a published path should be building
 * rooms from a seed — but it is importable directly.
 */

const DIRECTIONS = ANSWER_DOMAINS.direction!;

/**
 * Decoy prose, kept free of every lexicon member and every digit run.
 *
 * A decoy that mentioned a direction would not actually change a verdict —
 * `derivation.ts` only reads a puzzle's OWN clue object — but a decoy that
 * mentioned one would make this file's intent unreadable the first time a
 * property test failed near it.
 */
const DECOY_TEXT = [
  'A shelf of ledgers, none of them relevant.',
  'A cracked basin, long since dry.',
  'A stack of crates, empty and splintering.',
  'A coat on a peg, pockets turned out.',
  'A stopped clock, hands missing.',
] as const;

export interface BuildOptions {
  /** How many puzzles in the chain. Defaults to a random 1–4. */
  readonly chainLength?: number;
}

/**
 * A room that certifies, by construction.
 *
 * The shape is the canonical room's: clue N is sealed inside the container that
 * puzzle N-1 unlocks, so every link genuinely gates, and the final puzzle is a
 * prose answer that opens the door. Intended length is therefore exactly
 * `2 * chainLength` — one `inspect` and one solving move per link — and the
 * declared band and estimate are derived from that rather than guessed, so a
 * generated room is honest about itself.
 */
export function buildValidRoom(rng: Rng, options: BuildOptions = {}): RoomSpec {
  const chainLength = options.chainLength ?? rng.int(1, 4);
  const objects: RoomObject[] = [];
  const puzzles: RoomSpec['puzzles'] = [];

  const codes = uniqueCodes(rng, chainLength);
  const direction = rng.pick(DIRECTIONS);

  for (let i = 0; i < chainLength; i++) {
    const isLast = i === chainLength - 1;
    const clueId = `clue-${i}`;
    const answer = isLast ? direction : codes[i]!;

    objects.push({
      id: clueId,
      name: `slip ${i}`,
      description: `A slip of paper, numbered ${i}.`,
      kind: 'portable',
      lock: null,
      contains: [],
      clueText: isLast ? `The way out lies ${answer}.` : `The plate reads ${answer}.`,
    });

    if (isLast) {
      objects.push({
        id: 'door',
        name: 'door',
        description: 'A heavy door.',
        kind: 'door',
        lock: null,
        contains: [],
        clueText: null,
      });
      puzzles.push({ id: `p${i}`, order: i + 1, kind: 'answer', clueObjectId: clueId, answer, unlocksObjectId: 'door' });
    } else {
      objects.push({
        id: `holder-${i}`,
        name: `cabinet ${i}`,
        description: `A cabinet with a keypad, numbered ${i}.`,
        kind: 'container',
        lock: { opensWith: 'code', code: answer },
        contains: [`clue-${i + 1}`],
        clueText: null,
      });
      puzzles.push({
        id: `p${i}`,
        order: i + 1,
        kind: 'code',
        clueObjectId: clueId,
        answer,
        unlocksObjectId: `holder-${i}`,
      });
    }
  }

  for (let d = 0; d < rng.int(0, 3); d++) {
    objects.push({
      id: `decoy-${d}`,
      name: `fitting ${d}`,
      description: 'Part of the furniture.',
      kind: 'fixture',
      lock: null,
      contains: [],
      clueText: DECOY_TEXT[d % DECOY_TEXT.length]!,
    });
  }

  const intended = chainLength * 2;
  const band = bandFor(intended);
  if (band === null) throw new Error(`fuzz: chainLength ${chainLength} produces ${intended} actions, off the scale`);

  return {
    specVersion: SPEC_VERSION,
    seed: `fuzz-${chainLength}`,
    roomId: `fuzz-${chainLength}`,
    theme: { name: 'Store room', description: 'A windowless store room.' },
    objects,
    puzzles,
    exit: { objectId: 'door', requiresPuzzleId: `p${chainLength - 1}` },
    difficulty: { band, estimatedActions: rng.int(intended, intended * 3) },
    solution: { order: puzzles.map((p) => p.id) },
  };
}

/** Convenience: a room straight from a seed string. */
export function roomFromSeed(seed: string, options: BuildOptions = {}): RoomSpec {
  return buildValidRoom(createRng(seed), options);
}

/**
 * Each mutator breaks ONE rule and names the code that must come back.
 *
 * `minChainLength` exists because some defects are unrepresentable in a
 * one-puzzle room: there is no second answer to collide with and no link to
 * sever.
 */
export interface Mutator {
  readonly name: string;
  readonly expect: RejectionCode;
  readonly minChainLength: number;
  readonly apply: (rng: Rng, spec: RoomSpec) => RoomSpec;
}

/** Structural clone, so no mutator can edit the room it was handed. */
function clone(spec: RoomSpec): RoomSpec {
  return JSON.parse(JSON.stringify(spec)) as RoomSpec;
}

export const MUTATORS: readonly Mutator[] = [
  {
    name: 'eraseClue',
    expect: 'answer_not_derivable',
    minChainLength: 1,
    apply: (rng, original) => {
      const spec = clone(original);
      const index = rng.int(0, spec.puzzles.length - 1);
      const puzzle = spec.puzzles[index]!;
      const clue = spec.objects.find((o) => o.id === puzzle.clueObjectId)!;
      clue.clueText = 'The writing has been scrubbed away past reading.';
      return spec;
    },
  },
  {
    name: 'duplicateAnswer',
    expect: 'answer_collision',
    minChainLength: 2,
    apply: (_rng, original) => {
      // Rewrites the answer, its lock and its clue together, so the ONLY thing
      // wrong with the room is that two puzzles now accept the same string.
      const spec = clone(original);
      const first = spec.puzzles[0]!;
      const second = spec.puzzles[1]!;
      second.answer = first.answer;
      const holder = spec.objects.find((o) => o.id === second.unlocksObjectId)!;
      if (holder.lock !== null && holder.lock.opensWith === 'code') holder.lock.code = first.answer;
      const clue = spec.objects.find((o) => o.id === second.clueObjectId)!;
      clue.clueText =
        second.kind === 'code' ? `The plate reads ${first.answer}.` : `The way out lies ${first.answer}.`;
      return spec;
    },
  },
  {
    name: 'severChain',
    expect: 'chain_broken',
    minChainLength: 2,
    apply: (_rng, original) => {
      // Tips the second clue onto the floor: it is still reachable, so the room
      // is still escapable — just not through the chain it advertises.
      const spec = clone(original);
      const holder = spec.objects.find((o) => o.id === spec.puzzles[0]!.unlocksObjectId)!;
      holder.contains = holder.contains.filter((id) => id !== spec.puzzles[1]!.clueObjectId);
      return spec;
    },
  },
  {
    name: 'inflateEstimate',
    expect: 'difficulty_estimate_implausible',
    minChainLength: 1,
    apply: (_rng, original) => {
      const spec = clone(original);
      spec.difficulty = { ...spec.difficulty, estimatedActions: spec.puzzles.length * 2 * 3 + 10 };
      return spec;
    },
  },
  {
    name: 'misdeclareBand',
    expect: 'difficulty_out_of_band',
    minChainLength: 1,
    apply: (_rng, original) => {
      const spec = clone(original);
      spec.difficulty = { ...spec.difficulty, band: spec.difficulty.band === 'hard' ? 'easy' : 'hard' };
      return spec;
    },
  },
  {
    name: 'danglingClueRef',
    expect: 'dangling_reference',
    minChainLength: 1,
    apply: (_rng, original) => {
      const spec = clone(original);
      spec.puzzles[0]!.clueObjectId = 'no-such-object';
      return spec;
    },
  },
  {
    name: 'reorderSolution',
    expect: 'puzzle_order_invalid',
    minChainLength: 2,
    apply: (_rng, original) => {
      const spec = clone(original);
      spec.solution = { order: [...spec.solution.order].reverse() };
      return spec;
    },
  },
  {
    name: 'sealClueInOwnLock',
    expect: 'unsolvable',
    minChainLength: 2,
    apply: (_rng, original) => {
      // The first clue is locked inside the cabinet its own answer opens, so
      // nobody can ever start.
      const spec = clone(original);
      const first = spec.puzzles[0]!;
      const holder = spec.objects.find((o) => o.id === first.unlocksObjectId)!;
      holder.contains = [...holder.contains, first.clueObjectId];
      return spec;
    },
  },
];

function uniqueCodes(rng: Rng, count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(String(rng.int(1000, 9999)));
  }
  return [...codes];
}
