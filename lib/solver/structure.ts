import type { RoomSpec } from '@/lib/schema/room';
import { reject, type Rejection } from './rejections';

/**
 * The checks that need nothing but the spec: do the references resolve, is the
 * chain ordered coherently, does the exit sit at the end, and do the locks agree
 * with the answers that are supposed to open them.
 *
 * ── What this module deliberately does NOT check ───────────────────────────
 * Containment: dangling children, duplicate object ids, two holders for one
 * object, and cycles. `compileRoom` in `lib/sim/state.ts` already refuses all
 * five, and `verify.ts` catches its `SimulatorError` and converts it to
 * `object_graph_invalid`. Re-implementing those rules here would create a second
 * definition of a valid object graph that could drift from the engine's — and a
 * solver that certifies rooms the simulator then refuses to compile is the worst
 * failure this module has available.
 *
 * Nor does it check solvability, derivability or difficulty. Those need the
 * oracle or the clue text; they are stages 4 and 5.
 */

/**
 * Answer equality, and it MUST stay identical to `matches` in
 * `lib/sim/resolve.ts` (trim, lowercase, compare — nothing else).
 *
 * That function decides whether a competitor's answer is accepted at run time;
 * this one decides whether two answers collide at verification time. Its comment
 * there says so explicitly: "#3 verifies answer UNIQUENESS against this same
 * comparison — a looser match here would let it certify a room whose two puzzles
 * secretly accept the same string."
 *
 * It is duplicated rather than imported because `lib/sim/index.ts` does not
 * export it, and widening that seam to share four characters of string handling
 * would be a worse trade. THE TWO MUST BE CHANGED TOGETHER.
 */
export function answersMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function checkStructure(spec: RoomSpec): Rejection[] {
  const rejections: Rejection[] = [];
  const objectIds = new Set(spec.objects.map((o) => o.id));
  const objectById = new Map(spec.objects.map((o) => [o.id, o]));
  const puzzleIds = new Set(spec.puzzles.map((p) => p.id));

  /* ── Referential ──────────────────────────────────────────────────────── */

  for (const puzzle of spec.puzzles) {
    if (!objectIds.has(puzzle.clueObjectId)) {
      rejections.push(
        reject('dangling_reference', `puzzle ${puzzle.id}: clueObjectId "${puzzle.clueObjectId}" names no object`, {
          puzzleId: puzzle.id,
          objectId: puzzle.clueObjectId,
        }),
      );
    }
    if (!objectIds.has(puzzle.unlocksObjectId)) {
      rejections.push(
        reject(
          'dangling_reference',
          `puzzle ${puzzle.id}: unlocksObjectId "${puzzle.unlocksObjectId}" names no object`,
          { puzzleId: puzzle.id, objectId: puzzle.unlocksObjectId },
        ),
      );
    }
  }

  if (!objectIds.has(spec.exit.objectId)) {
    rejections.push(
      reject('dangling_reference', `exit.objectId "${spec.exit.objectId}" names no object`, {
        objectId: spec.exit.objectId,
      }),
    );
  }
  if (!puzzleIds.has(spec.exit.requiresPuzzleId)) {
    rejections.push(
      reject('dangling_reference', `exit.requiresPuzzleId "${spec.exit.requiresPuzzleId}" names no puzzle`, {
        puzzleId: spec.exit.requiresPuzzleId,
      }),
    );
  }
  for (const id of spec.solution.order) {
    if (!puzzleIds.has(id)) {
      rejections.push(reject('dangling_reference', `solution.order names no puzzle "${id}"`, { puzzleId: id }));
    }
  }

  /* ── Ordering ─────────────────────────────────────────────────────────── */

  if (puzzleIds.size !== spec.puzzles.length) {
    rejections.push(reject('puzzle_order_invalid', 'two puzzles share an id'));
  }

  const orders = spec.puzzles.map((p) => p.order).sort((a, b) => a - b);
  const contiguous = orders.every((order, index) => order === index + 1);
  if (!contiguous) {
    rejections.push(
      reject('puzzle_order_invalid', `puzzle orders must be 1..${spec.puzzles.length}, received ${orders.join(',')}`),
    );
  }

  /*
   * `solution.order` is kept on the spec rather than derived from `order` so
   * that "a generator cannot quietly disagree with the solver about what the
   * intended path was" (`lib/schema/room.ts`). Checking the two agree is what
   * makes carrying both worth the redundancy.
   */
  const byOrder = [...spec.puzzles].sort((a, b) => a.order - b.order).map((p) => p.id);
  if (spec.solution.order.length !== byOrder.length || spec.solution.order.some((id, i) => id !== byOrder[i])) {
    rejections.push(
      reject(
        'puzzle_order_invalid',
        `solution.order [${spec.solution.order.join(',')}] disagrees with puzzle order [${byOrder.join(',')}]`,
      ),
    );
  }

  /* ── Exit ─────────────────────────────────────────────────────────────── */

  const last = spec.solution.order[spec.solution.order.length - 1];
  if (last !== undefined && spec.exit.requiresPuzzleId !== last) {
    /*
     * `resolve.ts` escapes the MOMENT the exit puzzle is solved. If the exit
     * puzzle were not last, every puzzle after it would be unreachable dead
     * weight the competitor never needs — the room would be shorter than it
     * claims, and the action count the whole product compares models on would
     * measure a different room than the one published.
     */
    rejections.push(
      reject(
        'exit_not_last',
        `exit requires ${spec.exit.requiresPuzzleId} but the chain ends at ${last}; puzzles after the exit can never matter`,
        { puzzleId: spec.exit.requiresPuzzleId },
      ),
    );
  }

  /* ── Lock agreement ───────────────────────────────────────────────────── */

  for (const puzzle of spec.puzzles) {
    if (puzzle.kind !== 'code') continue;
    const target = objectById.get(puzzle.unlocksObjectId);
    if (target === undefined) continue; // already reported as dangling

    if (target.lock === null) {
      rejections.push(
        reject('lock_mismatch', `puzzle ${puzzle.id} is a code puzzle but ${target.id} has no lock to enter it into`, {
          puzzleId: puzzle.id,
          objectId: target.id,
        }),
      );
      continue;
    }
    if (target.lock.opensWith !== 'code') {
      rejections.push(
        reject('lock_mismatch', `puzzle ${puzzle.id} is a code puzzle but ${target.id} opens with a key`, {
          puzzleId: puzzle.id,
          objectId: target.id,
        }),
      );
      continue;
    }
    if (!answersMatch(target.lock.code, puzzle.answer)) {
      /*
       * The answer the clue yields and the code the lock accepts are two
       * separate fields, and nothing but this check keeps them the same. A room
       * where they differ looks perfectly solvable on paper and cannot be
       * escaped in practice — the competitor derives the right answer and the
       * lock rejects it.
       */
      rejections.push(
        reject(
          'lock_mismatch',
          `puzzle ${puzzle.id} answers "${puzzle.answer}" but ${target.id} accepts "${target.lock.code}"`,
          { puzzleId: puzzle.id, objectId: target.id },
        ),
      );
    }
  }

  /* ── Answer collision ─────────────────────────────────────────────────── */

  for (let i = 0; i < spec.puzzles.length; i++) {
    for (let j = i + 1; j < spec.puzzles.length; j++) {
      const a = spec.puzzles[i]!;
      const b = spec.puzzles[j]!;
      if (answersMatch(a.answer, b.answer)) {
        rejections.push(
          reject(
            'answer_collision',
            `puzzles ${a.id} and ${b.id} both accept "${a.answer}" — solving one would give the other away`,
            { puzzleId: b.id },
          ),
        );
      }
    }
  }

  return rejections;
}
