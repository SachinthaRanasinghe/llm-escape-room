import type { Puzzle, RoomSpec } from '@/lib/schema/room';
import { domainOf, membersOf, tokenize } from './lexicon';
import { reject, type Rejection } from './rejections';

/**
 * Can a competitor who starts knowing nothing READ this answer off this clue,
 * and could they have read anything else?
 *
 * ── Why this stage exists, and why the oracle is not enough ────────────────
 * The naive reading of "prove the room is solvable" is a reachability search:
 * can you get to the exit? Under that reading almost every broken room in
 * `fixtures/rooms/invalid/` is solvable, because the solver holds the answers in
 * plaintext and can simply type them in. A room is only genuinely escapable if
 * each answer can be LEARNED, one clue at a time, by someone who does not
 * already have it.
 *
 * So this module runs before the oracle and feeds it: a puzzle whose answer is
 * not derivable is a puzzle the oracle is not allowed to know, which is what
 * turns `unsolvable.json` — whose sea chart is "water-damaged past reading" —
 * from a solvable room into an unsolvable one.
 *
 * ── Derivable and unique are NOT the same gate ─────────────────────────────
 * Derivability gates the oracle. Ambiguity does not.
 *
 * An ambiguous clue still teaches the answer; it just teaches more than one, and
 * a competitor could pick the right one on the first try. That is a quality bar
 * for a published room, not a proof that it cannot be escaped. Conflating the
 * two would make `ambiguous-answer.json` report `unsolvable` alongside
 * `answer_ambiguous`, and `fixtures/index.ts` states that each invalid fixture
 * breaks exactly one rule. The asymmetry is deliberate; see `verify.ts`.
 */

export interface DerivationResult {
  readonly rejections: readonly Rejection[];
  /**
   * The puzzles whose answer genuinely appears in their clue — regardless of
   * whether anything else does. This is what the oracle's knowledge gate reads.
   */
  readonly derivable: ReadonlySet<string>;
}

/**
 * Everything the clue could plausibly be read as yielding, for this puzzle kind.
 *
 * `code` — digit runs of the answer's own length. Length-matching is what stops
 * a clue that mentions a year and a four-digit total from being called
 * ambiguous when only one of them could physically be typed into the lock.
 *
 * `answer` — members of the answer's OWN domain, and no other domain's.
 */
export function candidatesFor(puzzle: Puzzle, clueText: string | null): string[] {
  if (clueText === null) return [];

  // A key is not read out of prose; where it lies is the whole clue. See `keyIsFindable`.
  if (puzzle.kind === 'key') return [];

  if (puzzle.kind === 'code') {
    const width = puzzle.answer.trim().length;
    const runs = clueText.match(/\d+/g) ?? [];
    return dedupe(runs.filter((run) => run.length === width));
  }

  /*
   * ── Only the answer's own domain is scanned ──────────────────────────────
   * This will look like an arbitrary narrowing. It is the decision that keeps
   * false rejections near zero.
   *
   * Scanning every domain would mean a clue that happens to mention a colour
   * while its answer is a direction gets called ambiguous — the two readings
   * were never in competition, because a competitor who has worked out the
   * answer is a direction is choosing between directions. The ambiguity that
   * matters is WITHIN a domain: north versus south, as in the committed
   * `ambiguous-answer` fixture. Between domains it is just prose.
   */
  const domain = domainOf(puzzle.answer);
  if (domain === null) return [];

  const tokens = new Set(tokenize(clueText));
  return membersOf(domain).filter((member) => tokens.has(member));
}

/**
 * A `key` puzzle's analogue of "the answer can be read off the clue": the key
 * object IS the clue object, or lies (directly or nested) inside it.
 *
 * TICKET-7 (#8). There is no ambiguity rule for keys — a lock names exactly one
 * `keyItemId`, so a decoy key can waste a turn but never be a second answer.
 */
function keyIsFindable(spec: RoomSpec, puzzle: Puzzle): boolean {
  if (puzzle.clueObjectId === puzzle.answer) return true;
  const byId = new Map(spec.objects.map((o) => [o.id, o]));
  const queue = [...(byId.get(puzzle.clueObjectId)?.contains ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === puzzle.answer) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(byId.get(id)?.contains ?? []));
  }
  return false;
}

export function checkDerivation(spec: RoomSpec): DerivationResult {
  const clueTextById = new Map(spec.objects.map((o) => [o.id, o.clueText]));
  const objectIds = new Set(spec.objects.map((o) => o.id));
  const rejections: Rejection[] = [];
  const derivable = new Set<string>();

  for (const puzzle of spec.puzzles) {
    if (puzzle.kind === 'key') {
      // A key id that names no object is `structure.ts`'s `dangling_reference`;
      // not derivable, and not reported twice.
      if (!objectIds.has(puzzle.answer)) continue;
      if (keyIsFindable(spec, puzzle)) {
        derivable.add(puzzle.id);
      } else {
        rejections.push(
          reject(
            'answer_not_derivable',
            `puzzle ${puzzle.id}: key ${puzzle.answer} is not ${puzzle.clueObjectId}, and not inside it`,
            { puzzleId: puzzle.id, objectId: puzzle.clueObjectId },
          ),
        );
      }
      continue;
    }

    /*
     * A `clueObjectId` naming an object that does not exist is a DANGLING
     * REFERENCE, and `structure.ts` already reports it. Treat it as no clue and
     * move on rather than reporting the same broken room twice under two codes —
     * #6 counts codes per generation attempt, and double-reporting would skew
     * which failure looks most common.
     */
    const clueText = clueTextById.get(puzzle.clueObjectId) ?? null;
    const candidates = candidatesFor(puzzle, clueText);
    const answer = puzzle.answer.trim().toLowerCase();
    const found = candidates.some((c) => c.trim().toLowerCase() === answer);

    if (!found) {
      rejections.push(
        reject(
          'answer_not_derivable',
          `puzzle ${puzzle.id}: the answer "${puzzle.answer}" cannot be read out of the clue on ${puzzle.clueObjectId}`,
          { puzzleId: puzzle.id, objectId: puzzle.clueObjectId },
        ),
      );
      continue;
    }

    derivable.add(puzzle.id);

    const competitors = candidates.filter((c) => c.trim().toLowerCase() !== answer);
    if (competitors.length > 0) {
      rejections.push(
        reject(
          'answer_ambiguous',
          `puzzle ${puzzle.id}: the clue on ${puzzle.clueObjectId} also supports ${competitors
            .map((c) => `"${c}"`)
            .join(', ')}`,
          { puzzleId: puzzle.id, objectId: puzzle.clueObjectId },
        ),
      );
    }
  }

  return { rejections, derivable };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}
