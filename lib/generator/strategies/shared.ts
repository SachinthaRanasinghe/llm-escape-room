import { DIFFICULTY_RANGES } from '@/lib/solver';
import type { AttemptFeedback, Band } from '../types';

/**
 * What every generator strategy shares — TICKET-7 (#8).
 *
 * Extracted from `symbolic.ts` when `spatial` and `mixed` arrived, so that three
 * strategies ask for the same chain discipline in the same words. The rules here
 * are substrate-free: how a chain gates, how ids behave, how the order is
 * declared, how feedback is phrased. What a LINK is — a code, a key, a spoken
 * answer — stays in each strategy.
 *
 * Symbolic's prompt text is pinned byte-for-byte by `symbolic.test.ts`, so these
 * builders reproduce its exact wording. Change a sentence here and that test,
 * rightly, fails: a changed prompt is a changed experiment.
 */

/**
 * The PRD asks for "a short chain of ~3 puzzles", and every action is a beat on
 * screen against the 60–90 second watch target. Four is the ceiling until
 * TICKET-7 measures otherwise — which puts `hard` out of this strategy's reach.
 */
export const MAX_CHAIN_LENGTH = 4;

export const CODE_WIDTHS = [3, 4, 5] as const;

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

/**
 * Every chain length whose intended action count (two per link) fits the band.
 * Two per link holds for every kind: `inspect` + `enter_code`, `inspect` +
 * `submit_answer`, or `take` + `use` (`lib/solver/oracle.ts` → `knows`).
 */
export function chainLengthsFor(band: Band): number[] {
  const range = DIFFICULTY_RANGES[band];
  const lengths: number[] = [];
  for (let length = 1; length <= MAX_CHAIN_LENGTH; length++) {
    if (2 * length >= range.min && 2 * length <= range.max) lengths.push(length);
  }
  return lengths;
}

export function systemPrompt(): string {
  return (
    'You design small, logically airtight escape rooms for a puzzle engine. ' +
    'A machine verifier checks every room you write, literally and without judgement. ' +
    'Respond with a single JSON object and nothing else.'
  );
}

/** Rule 1: the chain, and the gating that makes it one. */
export function chainRule(n: number): string[] {
  return [
    `1. Exactly ${n} puzzles, ids p1..p${n}, with "order" 1..${n}, forming one linear chain.`,
    `   The clue object for puzzle N+1 must be INSIDE (directly, or nested) the object that puzzle N unlocks,`,
    '   so it cannot be reached before puzzle N is solved. The clue object for p1 must be reachable at the start:',
    '   on the floor, or inside an unlocked container.',
  ];
}

/** The estimate rule, numbered by the caller. */
export function estimateRule(number: number, n: number): string {
  return `${number}. "estimatedActions" is an integer from ${2 * n} to ${6 * n}; if unsure, use ${3 * n}.`;
}

/** The id-integrity rule, numbered by the caller. */
export function idRule(number: number): string[] {
  return [
    `${number}. Every id is unique; every id referenced anywhere exists; an object is inside at most one other object;`,
    '   nothing contains itself. Object "kind" is one of: container, fixture, portable, lock, door.',
  ];
}

/** The declared-order rule, numbered by the caller. */
export function solutionOrderRule(number: number, n: number): string {
  return `${number}. "solutionOrder" is ["p1", ..., "p${n}"].`;
}

/** The example block that closes every prompt. */
export function exampleLines(example: unknown): string[] {
  return ['', 'The JSON shape, with placeholder content — copy the SHAPE, never the content:', JSON.stringify(example)];
}

export function feedbackLines(feedback: AttemptFeedback | null): string[] {
  if (feedback === null || feedback.lines.length === 0) return [];
  return [
    '',
    'Your previous room was rejected by the verifier for:',
    ...feedback.lines.map((line) => `- ${line}`),
    'Write a complete new room as one JSON object that satisfies every constraint above.',
  ];
}
