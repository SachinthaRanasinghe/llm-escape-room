import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { ProviderError } from '@/lib/providers';
import type { Competitor } from '@/lib/schema/run';
import { CompetitorAbortedError, runCompetitor } from './competitor';
import { fixedClock, scriptedAdapter, type ScriptedTurn } from './testing';
import { DEFAULT_BUDGET } from './types';

const spec = loadCanonicalRoom();
const competitor: Competitor = { id: 'model-a', provider: 'groq', modelId: 'stub-model', params: { temperature: 0, topP: null } };

const look: ScriptedTurn = { rawAction: { name: 'look', intent: 'Get my bearings.' } };
const inspectDesk: ScriptedTurn = { rawAction: { name: 'inspect', targetId: 'desk', intent: 'Check the drawer.' } };
const noCall: ScriptedTurn = { rawAction: null, toolCall: null, text: 'I think I will look around.', anomaly: 'no_tool_call' };

function run(script: (ScriptedTurn | Error)[], budget = DEFAULT_BUDGET, shouldStop?: () => boolean) {
  const { adapter, requests } = scriptedAdapter(script);
  const result = runCompetitor({ runId: 'run-1', spec, budget, competitor, adapter, deps: fixedClock(), shouldStop });
  return { result, requests };
}

const tight = (maxActions: number) => ({ ...DEFAULT_BUDGET, maxActions });

describe('runCompetitor', () => {
  it('logs one event per action with contiguous seq and a tool_call/tool_result transcript', async () => {
    const { result, requests } = run([look, inspectDesk, look], tight(3));
    const { events, summary } = await result;

    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(events.map((e) => e.action?.name)).toEqual(['look', 'inspect', 'look']);
    expect(summary?.endedBecause).toBe('budget_actions');

    const kinds = requests[2]!.transcript.map((entry) => entry.kind);
    expect(kinds).toEqual(['user', 'tool_call', 'tool_result', 'tool_call', 'tool_result']);
    expect(requests.every((r) => r.system === requests[0]!.system)).toBe(true);
  });

  it('logs a turn with no tool call as a malformed event that costs a turn', async () => {
    const { result, requests } = run([noCall, look], tight(2));
    const { events, summary } = await result;

    expect(events[0]).toMatchObject({
      seq: 0,
      action: null,
      rejected: { kind: 'no_tool_call', raw: 'I think I will look around.', intent: null },
      verdict: { code: 'malformed' },
    });
    expect(summary?.invalidActions).toBe(1);

    const next = requests[1]!.transcript;
    expect(next.map((e) => e.kind)).toEqual(['user', 'assistant_text', 'user']);
    const last = next[next.length - 1]!;
    expect(last.kind === 'user' && last.text).toContain('Act by calling exactly one tool.');
  });

  it('still answers the first call of a double call', async () => {
    const double: ScriptedTurn = {
      rawAction: [{ name: 'look', intent: 'a' }, { name: 'look', intent: 'b' }],
      toolCall: { callId: 'c0', toolName: 'look', args: { intent: 'a' } },
      anomaly: 'multiple_tool_calls',
    };
    const { result, requests } = run([double, look], tight(2));
    const { events } = await result;
    expect(events[0]!.rejected?.kind).toBe('multiple_tool_calls');
    expect(requests[1]!.transcript.map((e) => e.kind)).toEqual(['user', 'tool_call', 'tool_result']);
  });

  it('stops at the budget without asking the model again', async () => {
    const { result, requests } = run([look, look, look, look], tight(2));
    const { events, summary } = await result;
    expect(events).toHaveLength(2);
    expect(requests).toHaveLength(2);
    expect(summary?.endedBecause).toBe('budget_actions');
  });

  it('ends on a token budget tripped by one turn', async () => {
    const huge: ScriptedTurn = { ...look, tokens: { prompt: 70_000, completion: 0 } };
    const { result, requests } = run([huge, look]);
    expect((await result).summary?.endedBecause).toBe('budget_tokens');
    expect(requests).toHaveLength(1);
  });

  it('charges the adapter latency and sums the event tokens into the summary', async () => {
    const { result } = run([
      { ...look, tokens: { prompt: 200, completion: 20 }, latencyMs: 1500 },
      { ...inspectDesk, tokens: { prompt: 300, completion: 30 }, latencyMs: 2500 },
    ], tight(2));
    const { events, summary } = await result;
    expect(summary?.tokens).toEqual({ prompt: 500, completion: 50 });
    expect(events.map((e) => e.latencyMs)).toEqual([1500, 2500]);
  });

  it('stops before the next call when told to, with no summary', async () => {
    let calls = 0;
    const { result, requests } = run([look, look, look], DEFAULT_BUDGET, () => ++calls > 2);
    const outcome = await result;
    expect(requests).toHaveLength(2);
    expect(outcome).toMatchObject({ stopped: true, summary: null });
    expect(outcome.events).toHaveLength(2);
  });

  it('wraps a ProviderError with the partial log and the calls spent', async () => {
    const { result } = run([look, look, new ProviderError('groq', 503, 4, 'gave up')]);
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CompetitorAbortedError);
    const aborted = error as CompetitorAbortedError;
    expect(aborted.events).toHaveLength(2);
    expect(aborted.providerCalls).toBe(2 + 4);
    expect(aborted.cause).toBeInstanceOf(ProviderError);
  });

  it('rethrows anything else unwrapped', async () => {
    const { result } = run([look, new TypeError('bug')]);
    await expect(result).rejects.toBeInstanceOf(TypeError);
  });
});
