import { describe, expect, it } from 'vitest';
import type { ProviderTurn } from '@/lib/providers';
import { EventSchema, RAW_EXCERPT_MAX } from '@/lib/schema/event';
import type { ApplyResult } from '@/lib/sim';
import { buildEvent, describeRejection } from './record';

const context = { runId: 'run-1', competitorId: 'model-a', seq: 4, at: '2026-09-22T10:00:00.000Z' };

function turn(overrides: Partial<ProviderTurn> = {}): ProviderTurn {
  return {
    rawAction: { name: 'look', intent: 'Get my bearings.' },
    toolCall: { callId: 'call_0', toolName: 'look', args: { intent: 'Get my bearings.' } },
    text: null,
    anomaly: null,
    tokens: { prompt: 100, completion: 10 },
    latencyMs: 1200,
    attempts: 1,
    ...overrides,
  };
}

const ok: ApplyResult = {
  action: { name: 'look', intent: 'Get my bearings.' },
  verdict: { ok: true, code: 'ok', message: 'You see a desk.' },
  ended: null,
};
const malformed: ApplyResult = {
  action: null,
  verdict: { ok: false, code: 'malformed', message: 'That is not a valid action.' },
  ended: null,
};

describe('buildEvent', () => {
  it('writes a valid action with no rejected block', () => {
    const event = buildEvent(context, turn(), ok);
    expect(event).toEqual({
      logVersion: 0,
      ...context,
      action: ok.action,
      verdict: ok.verdict,
      latencyMs: 1200,
      tokens: { prompt: 100, completion: 10 },
    });
    expect(Object.keys(event)).not.toContain('rejected');
  });

  it('writes a malformed turn as a null action with a rejected block', () => {
    const event = buildEvent(context, turn({ rawAction: null, toolCall: null, text: 'Hmm.', anomaly: 'no_tool_call' }), malformed);
    expect(event.action).toBeNull();
    expect(event.rejected).toEqual({ kind: 'no_tool_call', raw: 'Hmm.', intent: null });
    expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it('never publishes provider passthrough data', () => {
    const native = { thoughtSignature: 'NATIVE-SENTINEL-abc' };
    const withNative = turn({ toolCall: { callId: 'c', toolName: 'look', args: {}, native } });
    expect(JSON.stringify(buildEvent(context, withNative, ok))).not.toContain('NATIVE-SENTINEL');
  });

  it('rounds a fractional latency', () => {
    expect(buildEvent(context, turn({ latencyMs: 1234.6 }), ok).latencyMs).toBe(1235);
  });
});

describe('describeRejection', () => {
  it.each([
    ['no_tool_call', turn({ rawAction: null, toolCall: null, text: 'I will look.', anomaly: 'no_tool_call' }), 'I will look.'],
    ['no_tool_call with no text', turn({ rawAction: null, toolCall: null, anomaly: 'no_tool_call' }), ''],
    ['provider_rejected_call', turn({ rawAction: { name: '__rejected__' }, toolCall: null, anomaly: 'provider_rejected_call' }), '{"name":"__rejected__"}'],
  ] as const)('%s records what was sent', (_label, t, raw) => {
    expect(describeRejection(t).raw).toBe(raw);
  });

  it('calls a single parseable-but-invalid call invalid_arguments', () => {
    const r = describeRejection(turn({ rawAction: { name: 'look' }, anomaly: null }));
    expect(r).toEqual({ kind: 'invalid_arguments', raw: '{"name":"look"}', intent: null });
  });

  it('lifts an intent the model really wrote', () => {
    const r = describeRejection(turn({ rawAction: { name: 'fly', intent: 'Try the window.' }, anomaly: null }));
    expect(r.intent).toBe('Try the window.');
  });

  it('lifts nothing from two calls, an unparseable string, or an over-long intent', () => {
    const two = turn({ rawAction: [{ name: 'look', intent: 'a' }, { name: 'look', intent: 'b' }], anomaly: 'multiple_tool_calls' });
    expect(describeRejection(two)).toMatchObject({ kind: 'multiple_tool_calls', intent: null });
    const garbled = turn({ rawAction: { name: 'look', intent: '{not json' }, anomaly: 'unparseable_arguments' });
    expect(describeRejection(garbled).kind).toBe('unparseable_arguments');
    const long = turn({ rawAction: { name: 'look', intent: 'x'.repeat(281) }, anomaly: null });
    expect(describeRejection(long).intent).toBeNull();
    const empty = turn({ rawAction: { name: 'look', intent: '' }, anomaly: null });
    expect(describeRejection(empty).intent).toBeNull();
  });

  it('cuts a long payload to the cap and marks the cut', () => {
    const r = describeRejection(turn({ rawAction: { name: 'x'.repeat(5000) }, anomaly: null }));
    expect(r.raw.length).toBe(RAW_EXCERPT_MAX);
    expect(r.raw.endsWith('…')).toBe(true);
  });

  it('survives a payload JSON cannot encode', () => {
    const cyclic: Record<string, unknown> = { name: 'look' };
    cyclic.self = cyclic;
    expect(() => describeRejection(turn({ rawAction: cyclic, anomaly: null }))).not.toThrow();
  });
});
