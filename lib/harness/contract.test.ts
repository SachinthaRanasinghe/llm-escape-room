import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import type { ProviderAdapter } from '@/lib/providers';
import { findSeqBreaks, parseEventLog, type Event } from '@/lib/schema/event';
import { runDuel } from './duel';
import { fixedClock, scriptedAdapter, turnsFromLog } from './testing';

/**
 * THE CONTRACT TEST — the harness against TICKET-1's golden corpus.
 *
 * `fixtures/index.ts` calls the corpus "not test data, THE CONTRACT", and the
 * replay player (#5) is built against the committed log. This file feeds the
 * golden actions — with their real tokens and latencies — through the real
 * harness and the real simulator, as if two models had sent them, and asserts
 * that what comes out is the log and the run record already committed.
 *
 * If this fails, THE FIXTURE IS RIGHT AND THE HARNESS IS WRONG, for the same
 * reason `lib/sim/fixture-replay.test.ts` gives.
 *
 * Verdict MESSAGES are not compared: the fixture's prose was hand-written in the
 * room's voice, and the simulator writes its own (see `fixture-replay.test.ts`).
 * Nor is `at`: the golden clock is synthetic. Both are checked for shape.
 */

const room = loadCanonicalRoom();
const log = loadCanonicalLog();
const committed = loadCanonicalRun();

async function replay() {
  const adapters: Record<string, ProviderAdapter> = {};
  for (const competitor of committed.competitors) {
    adapters[competitor.id] = scriptedAdapter(turnsFromLog(log, competitor.id), competitor).adapter;
  }
  return runDuel({
    runId: committed.runId,
    spec: room,
    competitors: committed.competitors,
    adapters,
    budget: committed.budget,
    deps: fixedClock(),
  });
}

function semantics(events: readonly Event[], competitorId: string) {
  return events
    .filter((e) => e.competitorId === competitorId)
    .sort((a, b) => a.seq - b.seq)
    .map((e) => ({ seq: e.seq, action: e.action, code: e.verdict.code, ok: e.verdict.ok, latencyMs: e.latencyMs, tokens: e.tokens }));
}

describe('the harness reproduces the golden run', () => {
  it('derives the committed summaries exactly, cost included', async () => {
    const { run, unpriced } = await replay();
    expect(run.summaries).toEqual(committed.summaries);
    expect(run).toMatchObject({ runId: committed.runId, roomId: committed.roomId, competitors: committed.competitors, budget: committed.budget });
    // `competitor-a/b` are placeholder model ids, so their $0 is flagged as a guess.
    expect(unpriced).toEqual(['model-a', 'model-b']);
  });

  it.each(committed.competitors.map((c) => [c.id] as const))('writes the golden event sequence for %s', async (id) => {
    const { events } = await replay();
    expect(semantics(events, id)).toEqual(semantics(log, id));
  });

  it('writes events with exactly the golden key set', async () => {
    const { events } = await replay();
    const golden = Object.keys(log[0]!).sort();
    for (const event of events) expect(Object.keys(event).sort()).toEqual(golden);
  });

  it('writes a log the renderer can read', async () => {
    const { events, run } = await replay();
    expect(parseEventLog(events)).toEqual(events);
    expect(findSeqBreaks(events)).toEqual([]);
    expect(events).toHaveLength(log.length);
    for (const event of events) {
      expect(Number.isNaN(Date.parse(event.at))).toBe(false);
      expect(event.verdict.message.length).toBeGreaterThan(0);
    }
    expect(Date.parse(events[0]!.at)).toBeGreaterThanOrEqual(Date.parse(run.startedAt));
  });
});
