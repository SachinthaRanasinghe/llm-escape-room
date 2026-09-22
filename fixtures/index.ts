import { parseRoomSpec, type RoomSpec } from '@/lib/schema/room';
import { parseEventLog, type EventLog } from '@/lib/schema/event';
import { parseRun, type Run } from '@/lib/schema/run';

import canonicalRoom from './rooms/valid/canonical-room.json';
import canonicalLog from './logs/canonical-run.json';
import canonicalRun from './runs/canonical-run.json';

import unsolvable from './rooms/invalid/unsolvable.json';
import ambiguousAnswer from './rooms/invalid/ambiguous-answer.json';
import brokenChain from './rooms/invalid/broken-chain.json';
import outOfBandDifficulty from './rooms/invalid/out-of-band-difficulty.json';
import versionMismatch from './rooms/invalid/version-mismatch.json';

/**
 * The golden fixture corpus — TICKET-1's real deliverable.
 *
 * These files are not test data, they are THE CONTRACT. Four tickets build
 * against them simultaneously without a backend existing:
 *
 *   #2 simulator  — resolves actions against `loadCanonicalRoom()`
 *   #3 solver     — proves the valid room, and rejects each invalid one BY REASON
 *   #4 adapters   — compiles the action vocabulary the log demonstrates
 *   #5 replay     — renders `loadCanonicalLog()` with no backend at all
 *
 * Everything is exported through a parse function rather than as raw JSON, so a
 * consumer receives `RoomSpec`, never `any`. If you find yourself importing the
 * JSON directly, that is the bug.
 *
 * Changing a fixture changes four tickets. Regenerate with
 * `scripts/generate-fixtures.mts` rather than hand-editing, so the run summaries
 * cannot drift away from the log they summarise.
 */

export function loadCanonicalRoom(): RoomSpec {
  return parseRoomSpec(canonicalRoom);
}

export function loadCanonicalLog(): EventLog {
  return parseEventLog(canonicalLog);
}

export function loadCanonicalRun(): Run {
  return parseRun(canonicalRun);
}

/**
 * Each entry breaks exactly ONE rule, which is what lets #3 assert WHICH rule it
 * rejected rather than merely that rejection happened.
 *
 * `failsAtParse` marks the boundary between structural and semantic validity:
 * only the version mismatch is caught by the schema. The other four are
 * structurally perfect rooms that no one can escape, and catching them is the
 * solver's entire job.
 */
export const INVALID_ROOMS = [
  {
    name: 'unsolvable',
    reason: 'the clue for puzzle 2 was destroyed, so its answer is not derivable from the room',
    failsAtParse: false,
    raw: unsolvable as unknown,
  },
  {
    name: 'ambiguous-answer',
    reason: 'the final clue supports two different answers, so the room has no unique solution',
    failsAtParse: false,
    raw: ambiguousAnswer as unknown,
  },
  {
    name: 'broken-chain',
    reason: "puzzle 2's clue is not inside what puzzle 1 unlocks, so the chain does not connect",
    failsAtParse: false,
    raw: brokenChain as unknown,
  },
  {
    name: 'out-of-band-difficulty',
    reason: 'declared band is easy but the estimate is far outside any sane action budget',
    failsAtParse: false,
    raw: outOfBandDifficulty as unknown,
  },
  {
    name: 'version-mismatch',
    reason: 'specVersion is 1, which this build must refuse loudly rather than half-parse',
    failsAtParse: true,
    raw: versionMismatch as unknown,
  },
] as const;

export type InvalidRoomName = (typeof INVALID_ROOMS)[number]['name'];

export function loadInvalidRoom(name: InvalidRoomName): unknown {
  const entry = INVALID_ROOMS.find((r) => r.name === name);
  if (!entry) throw new Error(`no invalid fixture named ${name}`);
  return entry.raw;
}
