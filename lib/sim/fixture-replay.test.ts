import { describe, expect, it } from 'vitest';
import type { Event } from '@/lib/schema/event';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { createSimulator } from './simulator';

/**
 * THE CONTRACT TEST — the simulator replayed against TICKET-1's golden corpus.
 *
 * `fixtures/index.ts` calls the corpus "not test data, THE CONTRACT", and four
 * tickets are being built against it right now. This file is what makes that
 * true for #2: it feeds the committed log back through the simulator action by
 * action and asserts the simulator agrees with every verdict already published,
 * then asserts the counters it derives match the committed run record exactly.
 *
 * If this fails, THE FIXTURE IS RIGHT AND THE SIMULATOR IS WRONG — until someone
 * makes a deliberate decision otherwise and migrates the corpus, because #3, #4
 * and #8 are all coding against those files.
 *
 * ── Why codes and not messages ─────────────────────────────────────────────
 * The fixture's prose was hand-authored for the replay player, in the room's
 * voice, per event. The simulator writes its own prose from the spec. Asserting
 * message equality would force that voice to be maintained in two places and
 * would break on any wording change, so this asserts the VERDICT CODE — the part
 * that is semantics rather than styling — and separately asserts every message is
 * non-empty. That is a narrower assertion on purpose, not a weakened one.
 */

const room = loadCanonicalRoom();
const log = loadCanonicalLog();
const run = loadCanonicalRun();

function eventsFor(competitorId: string): Event[] {
  return log.filter((event) => event.competitorId === competitorId).sort((a, b) => a.seq - b.seq);
}

describe('the golden log replays through the simulator', () => {
  it('covers both competitors and every event', () => {
    const counted = run.competitors.reduce((total, c) => total + eventsFor(c.id).length, 0);
    expect(counted).toBe(log.length);
    expect(run.competitors.length).toBe(2);
  });

  it.each(run.competitors.map((c) => [c.id] as const))('reproduces every verdict for %s', (competitorId) => {
    const simulator = createSimulator({ spec: room, budget: run.budget, competitorId });

    for (const event of eventsFor(competitorId)) {
      expect(simulator.hasEnded(), `run ended before seq ${event.seq}`).toBe(false);

      const result = simulator.apply(event.action, {
        tokens: event.tokens,
        elapsedMs: event.latencyMs,
      });

      expect(
        result.verdict.code,
        `seq ${event.seq} (${event.action?.name}) expected ${event.verdict.code}, got ${result.verdict.code}`,
      ).toBe(event.verdict.code);
      expect(result.verdict.ok).toBe(event.verdict.ok);
      expect(result.action).not.toBeNull();
      expect(result.verdict.message.length).toBeGreaterThan(0);
    }
  });

  it.each(run.competitors.map((c) => [c.id] as const))('derives the committed summary for %s', (competitorId) => {
    const simulator = createSimulator({ spec: room, budget: run.budget, competitorId });
    for (const event of eventsFor(competitorId)) {
      simulator.apply(event.action, { tokens: event.tokens, elapsedMs: event.latencyMs });
    }

    const committed = run.summaries.find((summary) => summary.competitorId === competitorId);
    expect(committed).toBeDefined();
    const { costUsd, ...expected } = committed!;
    expect(costUsd).toBe(0); // free tier; the simulator does not compute it

    expect(simulator.summarise()).toEqual(expected);
  });

  /**
   * Spelled out rather than left implicit in the loop above, because these are
   * the numbers the whole product compares two models on. If the derivation ever
   * drifts, this says what drifted.
   */
  it('has model-a escaping in 13 actions with three puzzles and no mistakes', () => {
    const simulator = createSimulator({ spec: room, budget: run.budget, competitorId: 'model-a' });
    let ended = null;
    for (const event of eventsFor('model-a')) {
      ended = simulator.apply(event.action, { tokens: event.tokens, elapsedMs: event.latencyMs }).ended;
    }

    expect(ended).toBe('escaped');
    const summary = simulator.summarise();
    expect(summary.escaped).toBe(true);
    expect(summary.escapeActionCount).toBe(13);
    expect(summary.escapeMs).toBe(25_380);
    expect(summary.puzzlesSolved).toBe(3);
    expect(summary.failedAttempts).toBe(0);
    expect(summary.invalidActions).toBe(0);
  });

  it('has model-b running out of actions with two puzzles, two misses and one invalid action', () => {
    const simulator = createSimulator({ spec: room, budget: run.budget, competitorId: 'model-b' });
    let ended = null;
    for (const event of eventsFor('model-b')) {
      ended = simulator.apply(event.action, { tokens: event.tokens, elapsedMs: event.latencyMs }).ended;
    }

    expect(ended).toBe('budget_actions');
    const summary = simulator.summarise();
    expect(summary.escaped).toBe(false);
    expect(summary.escapeActionCount).toBeNull();
    expect(summary.escapeMs).toBeNull();
    expect(summary.puzzlesSolved).toBe(2);
    expect(summary.failedAttempts).toBe(2); // two wrong codes
    expect(summary.invalidActions).toBe(1); // the imagined bookshelf
  });

  /**
   * The behaviour the golden log settles, called out on its own so a future
   * change to the reachability rule fails with a sentence explaining itself
   * rather than as an opaque verdict mismatch.
   */
  it('lets model-b read the ledger without ever opening the desk', () => {
    const events = eventsFor('model-b');
    const readsLedger = events.find((e) => e.action?.name === 'inspect' && e.action.targetId === 'ledger');
    expect(readsLedger?.verdict.code).toBe('ok');
    expect(events.some((e) => e.action?.name === 'open' && e.action.targetId === 'desk')).toBe(false);

    const simulator = createSimulator({ spec: room, budget: run.budget, competitorId: 'model-b' });
    expect(simulator.apply({ name: 'inspect', targetId: 'ledger', intent: 'read it' }, {
      tokens: { prompt: 0, completion: 0 },
      elapsedMs: 0,
    }).verdict.code).toBe('ok');
  });

  it('is deterministic — two replays of the same log agree exactly', () => {
    const replay = (competitorId: string) => {
      const simulator = createSimulator({ spec: room, budget: run.budget, competitorId });
      const codes = eventsFor(competitorId).map(
        (event) => simulator.apply(event.action, { tokens: event.tokens, elapsedMs: event.latencyMs }).verdict.code,
      );
      return { codes, summary: simulator.summarise() };
    };

    expect(replay('model-a')).toEqual(replay('model-a'));
    expect(replay('model-b')).toEqual(replay('model-b'));
  });
});
