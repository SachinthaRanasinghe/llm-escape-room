import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DifficultyBandSchema, type RoomSpec } from '@/lib/schema/room';
import { ANSWER_DOMAINS, type SolverReport } from '@/lib/solver';

/**
 * A room's structure, without its story — TICKET-5 (#6).
 *
 * The PRD's variety metric is "runs whose puzzle chain structure differs from
 * the previous run ≥ 90%". That needs a definition of STRUCTURE that two rooms
 * can be compared on, and this is it: the shape of the chain, the kinds of lock,
 * the shape of each answer, how deep things nest, how much is decoy.
 *
 * ── What is deliberately left out ──────────────────────────────────────────
 * Ids, names, theme, prose and the answers themselves. A lighthouse and an
 * observatory built on the same three-link, two-code, direction-final skeleton
 * are the SAME puzzle to a model that has learned the skeleton, which is the
 * contamination the PRD worries about. Hashing their prose would call them
 * different and flatter the metric.
 */

const ShapeSchema = z.strictObject({
  chainLength: z.number().int().positive(),
  puzzleKinds: z.array(z.enum(['code', 'answer'])),
  unlockKinds: z.array(z.enum(['code', 'key', 'none'])),
  /** `digits:4` for a code, `domain:direction` for a prose answer. */
  answerShapes: z.array(z.string().min(1)),
  maxContainmentDepth: z.number().int().nonnegative(),
  objectCount: z.number().int().positive(),
  decoyCount: z.number().int().nonnegative(),
  intendedActions: z.number().int().positive(),
  band: DifficultyBandSchema,
});
type Shape = z.infer<typeof ShapeSchema>;

export const RoomFingerprintSchema = z.strictObject({
  strategy: z.string().min(1),
  ...ShapeSchema.shape,
  structureHash: z.string().regex(/^[0-9a-f]{16}$/),
});
export type RoomFingerprint = z.infer<typeof RoomFingerprintSchema>;

/**
 * Fixed key order. `JSON.stringify` on an arbitrary object follows insertion
 * order, which is an accident of whoever built it; the hash must not be.
 */
const HASHED_KEYS: readonly (keyof Shape)[] = [
  'chainLength',
  'puzzleKinds',
  'unlockKinds',
  'answerShapes',
  'maxContainmentDepth',
  'objectCount',
  'decoyCount',
  'intendedActions',
  'band',
];

/** 16 hex characters: collision-free at any number of rooms this project will ever make, and readable in a log. */
export function hashShape(shape: Shape): string {
  const canonical = JSON.stringify(HASHED_KEYS.map((key) => [key, shape[key]]));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

function answerShape(puzzle: RoomSpec['puzzles'][number]): string {
  const answer = puzzle.answer.trim().toLowerCase();
  if (puzzle.kind === 'code') return `digits:${answer.length}`;
  const domain = Object.entries(ANSWER_DOMAINS).find(([, members]) => members.includes(answer));
  return `domain:${domain?.[0] ?? 'unknown'}`;
}

/** Only meaningful for a CERTIFIED room: it takes the solver's report, not a guess. */
export function fingerprintRoom(spec: RoomSpec, report: SolverReport, strategy: string): RoomFingerprint {
  const objectById = new Map(spec.objects.map((o) => [o.id, o]));
  const puzzleById = new Map(spec.puzzles.map((p) => [p.id, p]));
  const parentOf = new Map<string, string>();
  for (const object of spec.objects) for (const child of object.contains) parentOf.set(child, object.id);

  const chain = spec.solution.order.map((id) => puzzleById.get(id)!).filter((p) => p !== undefined);

  const depthOf = (id: string): number => {
    let depth = 0;
    for (let at = parentOf.get(id); at !== undefined; at = parentOf.get(at)) depth++;
    return depth;
  };

  // On the path: every clue and every unlock target, and everything holding one.
  const onPath = new Set<string>();
  for (const puzzle of chain) {
    for (const id of [puzzle.clueObjectId, puzzle.unlocksObjectId]) {
      for (let at: string | undefined = id; at !== undefined; at = parentOf.get(at)) onPath.add(at);
    }
  }

  const shape: Shape = {
    chainLength: chain.length,
    puzzleKinds: chain.map((p) => p.kind),
    unlockKinds: chain.map((p) => {
      const lock = objectById.get(p.unlocksObjectId)?.lock ?? null;
      return lock === null ? 'none' : lock.opensWith;
    }),
    answerShapes: chain.map(answerShape),
    maxContainmentDepth: Math.max(0, ...spec.objects.map((o) => depthOf(o.id))),
    objectCount: spec.objects.length,
    decoyCount: spec.objects.filter((o) => !onPath.has(o.id)).length,
    intendedActions: report.intendedActions,
    band: spec.difficulty.band,
  };

  return RoomFingerprintSchema.parse({ strategy, ...shape, structureHash: hashShape(shape) });
}

/** The PRD's variety question for one pair of consecutive rooms. */
export function differsFrom(a: RoomFingerprint, b: RoomFingerprint): boolean {
  return a.structureHash !== b.structureHash;
}
