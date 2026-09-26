import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { ProviderError, type ProviderAdapter, type TurnRequest } from '@/lib/providers';
import type { Competitor } from '@/lib/schema/run';
import { DuelAbortedError } from './duel';
import { runMatchup } from './matchup';
import { fixedClock, scriptedAdapter, type ScriptedTurn } from './testing';
import { DEFAULT_BUDGET } from './types';

const spec = loadCanonicalRoom();
const params = { temperature: 0, topP: null };
const a: Competitor = { id: 'model-a', provider: 'groq', modelId: 'stub-a', params };
const b: Competitor = { id: 'model-b', provider: 'groq', modelId: 'stub-b', params };

const act = (rawAction: Record<string, unknown>): ScriptedTurn => ({ rawAction });
const look = act({ name: 'look', intent: 'Look.' });

/** An escape from the canonical room in eight actions — well inside the budget. */
const ESCAPE: ScriptedTurn[] = [
  act({ name: 'inspect', targetId: 'ledger', intent: 'i' }),
  act({ name: 'enter_code', targetId: 'wall-safe', code: '4471', intent: 'i' }),
  act({ name: 'open', targetId: 'wall-safe', intent: 'i' }),
  act({ name: 'inspect', targetId: 'sea-chart', intent: 'i' }),
  act({ name: 'enter_code', targetId: 'cabinet', code: '1770', intent: 'i' }),
  act({ name: 'open', targetId: 'cabinet', intent: 'i' }),
  act({ name: 'inspect', targetId: 'logbook', intent: 'i' }),
  act({ name: 'submit_answer', puzzleId: 'p3', answer: 'north', intent: 'i' }),
];
const WANDER: ScriptedTurn[] = Array.from({ length: DEFAULT_BUDGET.maxActions }, () => look);

type Duel = 'a' | 'b' | 'dead';

/**
 * One adapter per competitor holding a separate script per duel. A new duel is
 * recognised by its transcript being just the opening message, so a competitor
 * that is stopped mid-duel cannot shift the next duel's script — how far the
 * survivor of a provider failure gets before it sees the stop flag is a race the
 * tests must not depend on.
 */
function perDuelAdapter(scripts: readonly (ScriptedTurn | Error)[][], modelId: string) {
  const requests: TurnRequest[] = [];
  let duel = -1;
  let current = scriptedAdapter([]).adapter;
  const adapter: ProviderAdapter = {
    provider: 'groq',
    modelId,
    async act(request) {
      requests.push(request);
      if (request.transcript.length === 1) {
        duel += 1;
        current = scriptedAdapter(scripts[duel] ?? [], { provider: 'groq', modelId }).adapter;
      }
      return current.act(request);
    },
  };
  return { adapter, requests };
}

function adapters(duels: readonly Duel[]) {
  const partFor = (who: 'a' | 'b', duel: Duel): (ScriptedTurn | Error)[] => {
    if (duel === 'dead') return who === 'a' ? [new ProviderError('groq', 503, 4, 'gave up')] : WANDER;
    return duel === who ? ESCAPE : WANDER;
  };
  const sa = perDuelAdapter(duels.map((d) => partFor('a', d)), 'stub-a');
  const sb = perDuelAdapter(duels.map((d) => partFor('b', d)), 'stub-b');
  return { adapters: { 'model-a': sa.adapter, 'model-b': sb.adapter } as Record<string, ProviderAdapter>, requestsA: sa.requests };
}

function matchup(duels: readonly Duel[], repeats: number) {
  const { adapters: map, requestsA } = adapters(duels);
  const result = runMatchup({ runId: 'm', spec, competitors: [a, b], adapters: map, repeats, deps: fixedClock() });
  return { result, requestsA };
}

describe('runMatchup', () => {
  it('hands over the main run before the first repeat starts', async () => {
    const { adapters: map, requestsA } = adapters(['a', 'b']);
    const seen: { runId: string; requestsSoFar: number }[] = [];
    await runMatchup({
      runId: 'm',
      spec,
      competitors: [a, b],
      adapters: map,
      repeats: 1,
      deps: fixedClock(),
      onHero: (hero) => seen.push({ runId: hero.run.runId, requestsSoFar: requestsA.length }),
    });
    expect(seen).toEqual([{ runId: 'm', requestsSoFar: ESCAPE.length }]);
    expect(requestsA.length).toBeGreaterThan(ESCAPE.length);
  });

  it('runs the hero then numbered repeats, and calls a hero that agrees typical', async () => {
    const { hero, repeats, dropped } = await matchup(['a', 'a', 'a'], 2).result;
    expect(hero.run.runId).toBe('m');
    expect(repeats.map((r) => r.run.runId)).toEqual(['m-r1', 'm-r2']);
    expect(dropped).toEqual([]);
    expect(hero.run.typicalOfRepeats).toBe(true);
    expect(repeats.every((r) => r.run.typicalOfRepeats === null)).toBe(true);
  });

  it('calls a hero atypical when the repeats went the other way', async () => {
    const { hero } = await matchup(['a', 'b', 'b'], 2).result;
    expect(hero.run.typicalOfRepeats).toBe(false);
  });

  it('drops a repeat whose provider died and judges on the rest', async () => {
    const { hero, repeats, dropped, providerCalls } = await matchup(['a', 'dead', 'a'], 2).result;
    expect(repeats.map((r) => r.run.runId)).toEqual(['m-r2']);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ runId: 'm-r1' });
    expect(dropped[0]!.reason).toContain('gave up');
    expect(hero.run.typicalOfRepeats).toBe(true);
    expect(providerCalls).toBeGreaterThan(0);
  });

  it('publishes nothing and runs no repeat when the hero dies', async () => {
    const { result, requestsA } = matchup(['dead', 'a'], 1);
    await expect(result).rejects.toBeInstanceOf(DuelAbortedError);
    expect(requestsA).toHaveLength(1);
  });

  it('leaves typicality null with no repeats', async () => {
    const { hero, repeats } = await matchup(['a'], 0).result;
    expect(repeats).toEqual([]);
    expect(hero.run.typicalOfRepeats).toBeNull();
  });

  it('is null when every repeat was dropped', async () => {
    const { hero } = await matchup(['a', 'dead'], 1).result;
    expect(hero.run.typicalOfRepeats).toBeNull();
  });

  it.each([-1, 1.5, Number.NaN])('refuses repeats = %s before calling any model', async (repeats) => {
    const { result, requestsA } = matchup(['a'], repeats);
    await expect(result).rejects.toBeInstanceOf(RangeError);
    expect(requestsA).toHaveLength(0);
  });
});
