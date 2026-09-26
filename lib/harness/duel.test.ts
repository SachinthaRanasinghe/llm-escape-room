import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { ProviderError } from '@/lib/providers';
import { findSeqBreaks, parseEventLog } from '@/lib/schema/event';
import { parseRun, type Competitor } from '@/lib/schema/run';
import { CompetitorAbortedError } from './competitor';
import { DuelAbortedError, runDuel } from './duel';
import { fixedClock, scriptedAdapter, type ScriptedTurn } from './testing';
import { DEFAULT_BUDGET } from './types';

const spec = loadCanonicalRoom();
const params = { temperature: 0, topP: null };
const a: Competitor = { id: 'model-a', provider: 'groq', modelId: 'llama-3.3-70b-versatile', params };
const b: Competitor = { id: 'model-b', provider: 'groq', modelId: 'mystery-model', params };
const budget = { ...DEFAULT_BUDGET, maxActions: 4 };

const act = (rawAction: Record<string, unknown>): ScriptedTurn => ({ rawAction });
const look = act({ name: 'look', intent: 'Look.' });
const readLedger = act({ name: 'inspect', targetId: 'ledger', intent: 'Read the ledger.' });
const unlockSafe = act({ name: 'enter_code', targetId: 'wall-safe', code: '4471', intent: 'The ledger total.' });
const openSafe = act({ name: 'open', targetId: 'wall-safe', intent: 'Open the safe.' });

function duel(scriptA: (ScriptedTurn | Error)[], scriptB: (ScriptedTurn | Error)[], competitors = [a, b]) {
  const sa = scriptedAdapter(scriptA, { provider: a.provider, modelId: a.modelId });
  const sb = scriptedAdapter(scriptB, { provider: b.provider, modelId: b.modelId });
  const result = runDuel({
    runId: 'run-duel',
    spec,
    competitors,
    adapters: { [a.id]: sa.adapter, [b.id]: sb.adapter },
    budget,
    deps: fixedClock(),
  });
  return { result, requestsA: sa.requests, requestsB: sb.requests };
}

describe('runDuel', () => {
  it('gives each competitor its own room — one unlocking the safe opens nothing for the other', async () => {
    const { result } = duel([readLedger, unlockSafe, openSafe, look], [look, look, openSafe, look]);
    const { events } = await result;
    const openedBy = (id: string) => events.find((e) => e.competitorId === id && e.action?.name === 'open')!;
    expect(openedBy('model-a').verdict.code).toBe('ok');
    expect(openedBy('model-b').verdict.code).toBe('locked');
  });

  it('writes one merged, ordered, contiguous log and a valid run record', async () => {
    const { result } = duel([look, look, look, look], [look, look, look, look]);
    const { run, events } = await result;

    expect(parseEventLog(events)).toEqual(events);
    expect(findSeqBreaks(events)).toEqual([]);
    expect(events).toHaveLength(8);
    const times = events.map((e) => Date.parse(e.at));
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(new Set(events.map((e) => e.competitorId))).toEqual(new Set(['model-a', 'model-b']));

    expect(parseRun(run)).toEqual(run);
    expect(run).toMatchObject({ runId: 'run-duel', roomId: spec.roomId, budget, typicalOfRepeats: null });
    expect(run.summaries.map((s) => s.competitorId)).toEqual(['model-a', 'model-b']);
  });

  it('adds cost, and names the competitors whose price is a guess', async () => {
    const { result } = duel([look, look, look, look], [look, look, look, look]);
    const { run, unpriced, providerCalls } = await result;
    expect(run.summaries.every((s) => s.costUsd === 0)).toBe(true);
    expect(unpriced).toEqual(['model-b']);
    expect(providerCalls).toEqual({ 'model-a': 4, 'model-b': 4 });
  });

  it('aborts on a provider failure, stops the other competitor, and keeps the partial log', async () => {
    const dead = new ProviderError('groq', 503, 4, 'gave up');
    const { result, requestsB } = duel([look, dead], [look, look, look, look]);
    const error = await result.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DuelAbortedError);
    const aborted = error as DuelAbortedError;
    expect(aborted.cause).toBeInstanceOf(CompetitorAbortedError);
    expect(requestsB.length).toBeLessThan(4);
    expect(aborted.events.filter((e) => e.competitorId === 'model-a')).toHaveLength(1);
    expect(aborted.events.some((e) => e.competitorId === 'model-b')).toBe(true);
    expect(aborted.providerCalls).toBe(1 + 4 + requestsB.length);
  });

  it('rethrows a bug as itself, not as a provider abort', async () => {
    const { result } = duel([look, new TypeError('bug')], [look, look, look, look]);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });

  it.each([
    ['one competitor', [a]],
    ['duplicate ids', [a, { ...b, id: 'model-a' }]],
    ['a missing adapter', [a, { ...b, id: 'model-c' }]],
    ['an adapter for a different model', [a, { ...b, modelId: 'other' }]],
  ] as const)('refuses %s before calling any model', async (_label, competitors) => {
    const { result, requestsA, requestsB } = duel([look], [look], [...competitors]);
    await expect(result).rejects.toBeInstanceOf(RangeError);
    expect(requestsA.length + requestsB.length).toBe(0);
  });

  it('reports every logged action to a watcher as it happens, with the end on the action that ended the run', async () => {
    const sa = scriptedAdapter([readLedger, unlockSafe, openSafe, look], { provider: a.provider, modelId: a.modelId });
    const sb = scriptedAdapter([look, look, look, look], { provider: b.provider, modelId: b.modelId });
    const seen: { competitorId: string; seq: number; ended: string | null }[] = [];
    const { events } = await runDuel({
      runId: 'run-duel',
      spec,
      competitors: [a, b],
      adapters: { [a.id]: sa.adapter, [b.id]: sb.adapter },
      budget,
      deps: fixedClock(),
      onEvent: (event, ended) => seen.push({ competitorId: event.competitorId, seq: event.seq, ended }),
    });
    expect(seen).toHaveLength(events.length);
    for (const id of [a.id, b.id]) {
      const mine = seen.filter((s) => s.competitorId === id);
      expect(mine.map((s) => s.seq)).toEqual([0, 1, 2, 3]);
      expect(mine.map((s) => s.ended)).toEqual([null, null, null, 'budget_actions']);
    }
  });

  it('cannot be broken by a watcher that throws', async () => {
    const sa = scriptedAdapter([look, look, look, look], { provider: a.provider, modelId: a.modelId });
    const sb = scriptedAdapter([look, look, look, look], { provider: b.provider, modelId: b.modelId });
    const { events } = await runDuel({
      runId: 'run-duel',
      spec,
      competitors: [a, b],
      adapters: { [a.id]: sa.adapter, [b.id]: sb.adapter },
      budget,
      deps: fixedClock(),
      onEvent: () => {
        throw new Error('watcher bug');
      },
    });
    expect(events).toHaveLength(8);
  });

  it('is deterministic for the same scripts and clock', async () => {
    const first = await duel([readLedger, unlockSafe, openSafe, look], [look, look, openSafe, look]).result;
    const second = await duel([readLedger, unlockSafe, openSafe, look], [look, look, openSafe, look]).result;
    expect(second).toEqual(first);
  });
});
