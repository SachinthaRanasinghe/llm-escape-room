import { EventSchema, type Event, type Rejected } from '@/lib/schema/event';
import { parseRun, type Run } from '@/lib/schema/run';
import type { ReplayBeat, ReplayData, ReplayLane, SceneLayout } from './types';

/**
 * Test support for the replay — builders for events, runs, layouts and lanes.
 *
 * Deliberately NOT exported from `index.ts`, like `lib/harness/testing.ts`, and
 * excluded from `boundary.test.ts` by name: it value-imports the schemas so a
 * builder cannot drift from them, which the shipped modules must not do.
 */

export const TEST_RUN_ID = 'run-t';
const AT = '2026-09-22T10:00:00.000Z';

/** A full, schema-valid event. Every field can be overridden. */
export function event(partial: Partial<Event> = {}): Event {
  return EventSchema.parse({
    logVersion: 0,
    runId: TEST_RUN_ID,
    competitorId: 'a',
    seq: 0,
    action: { name: 'look', intent: 'Look around.' },
    verdict: { ok: true, code: 'ok', message: 'A room.' },
    latencyMs: 1000,
    tokens: { prompt: 0, completion: 0 },
    at: AT,
    ...partial,
  });
}

/** A turn that produced no valid action — scored `malformed`, as the harness records it. */
export function rejectedEvent(
  kind: Rejected['kind'],
  intent: string | null,
  partial: Partial<Event> = {},
): Event {
  return event({
    action: null,
    rejected: { kind, raw: '{"oops":true}', intent },
    verdict: { ok: false, code: 'malformed', message: 'That was not an action.' },
    ...partial,
  });
}

/** A minimal valid run naming `ids` as competitors, each with a summary. */
export function runFixture(ids: readonly string[] = ['a', 'b'], maxActions = 14): Run {
  return parseRun({
    runVersion: 0,
    runId: TEST_RUN_ID,
    roomId: 'room-t',
    competitors: ids.map((id) => ({
      id,
      provider: 'groq',
      modelId: `model-${id}`,
      params: { temperature: null, topP: null },
    })),
    budget: { maxActions, maxTokens: 60_000, maxWallClockMs: 300_000 },
    startedAt: AT,
    summaries: ids.map((id) => ({
      competitorId: id,
      escaped: false,
      escapeActionCount: null,
      escapeMs: null,
      puzzlesSolved: 0,
      failedAttempts: 0,
      invalidActions: 0,
      tokens: { prompt: 0, completion: 0 },
      costUsd: 0,
      endedBecause: 'budget_actions',
    })),
    typicalOfRepeats: null,
  });
}

/** A small hand-built layout: a safe holding a key, a door that is the exit. */
export function layoutFixture(): SceneLayout {
  return {
    roomId: 'room-t',
    themeName: 'Test room',
    objects: [
      { id: 'safe', name: 'iron safe', kind: 'lock', parentId: null, position: [-2, -3] },
      { id: 'key', name: 'brass key', kind: 'portable', parentId: 'safe', position: [-2, -3] },
      { id: 'door', name: 'oak door', kind: 'door', parentId: null, position: [0, -3.2] },
    ],
    puzzleTargets: { p1: 'safe', p2: 'door' },
    exitObjectId: 'door',
    centre: [0, 1],
  };
}

/** A beat with defaults, for tests that exercise the scheduler or room state directly. */
export function beat(partial: Partial<ReplayBeat> = {}): ReplayBeat {
  return {
    seq: 0,
    verb: 'look',
    targetId: null,
    rawTargetId: null,
    heldItemId: null,
    argument: null,
    intent: 'Look around.',
    rejection: null,
    verdict: { ok: true, code: 'ok', message: 'A room.' },
    thinkMs: 1000,
    cumulativeThinkMs: 1000,
    ...partial,
  };
}

/** A lane of `count` default beats, seq 0..count-1. */
export function lane(count: number, partial: Partial<ReplayLane> = {}): ReplayLane {
  return {
    competitorId: 'a',
    label: 'model-a',
    provider: 'groq',
    beats: Array.from({ length: count }, (_, seq) => beat({ seq })),
    endedBecause: 'budget_actions',
    escaped: false,
    maxActions: 14,
    ...partial,
  };
}

/** Replay data over `lanes`, on the test layout. */
export function replayData(lanes: readonly ReplayLane[]): ReplayData {
  return { runId: TEST_RUN_ID, layout: layoutFixture(), lanes };
}
