import { describe, expect, it } from 'vitest';
import { LOG_VERSION } from './version';
import { EventLogError, EventSchema, findSeqBreaks, parseEventLog, type Event } from './event';

function event(overrides: Partial<Event> = {}): Event {
  return {
    logVersion: LOG_VERSION,
    runId: 'run-1',
    competitorId: 'model-a',
    seq: 0,
    action: { name: 'look', intent: 'Get my bearings.' },
    verdict: { ok: true, code: 'ok', message: 'You see a desk and a wall safe.' },
    latencyMs: 1840,
    tokens: { prompt: 900, completion: 40 },
    at: '2026-09-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('EventSchema', () => {
  it('accepts a complete event', () => {
    const e = event();
    expect(EventSchema.parse(e)).toEqual(e);
  });

  it('rejects a future log version LOUDLY', () => {
    expect(EventSchema.safeParse({ ...event(), logVersion: LOG_VERSION + 1 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(EventSchema.safeParse({ ...event(), beat: 3 }).success).toBe(false);
  });

  it('carries no pacing fields — beats belong to the render manifest (#9)', () => {
    const keys = Object.keys(event());
    expect(keys).not.toContain('beat');
    expect(keys).not.toContain('screenMs');
    expect(keys).not.toContain('camera');
  });

  it('reads intent from the action, never duplicated at the event level', () => {
    const e = event();
    expect(e.action.intent).toBe('Get my bearings.');
    expect(Object.keys(e)).not.toContain('intent');
  });

  it('rejects negative or fractional latency', () => {
    expect(EventSchema.safeParse(event({ latencyMs: -1 })).success).toBe(false);
    expect(EventSchema.safeParse(event({ latencyMs: 12.5 })).success).toBe(false);
  });

  it('rejects a negative sequence number', () => {
    expect(EventSchema.safeParse(event({ seq: -1 })).success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    expect(EventSchema.safeParse(event({ at: '22 Sep 2026' })).success).toBe(false);
  });

  it('records a failed action as a normal event, not an absence', () => {
    const failed = event({
      seq: 4,
      action: { name: 'enter_code', targetId: 'safe', code: '1234', intent: 'Try the desk number.' },
      verdict: { ok: false, code: 'wrong_code', message: 'The keypad buzzes.' },
    });
    expect(EventSchema.parse(failed)).toEqual(failed);
  });

  it('records a malformed action, which still consumed a turn', () => {
    const malformed = event({
      seq: 5,
      action: { name: 'open', targetId: 'nothing-here', intent: 'Open the hatch I imagined.' },
      verdict: { ok: false, code: 'not_found', message: 'There is no such object.' },
    });
    expect(EventSchema.parse(malformed)).toEqual(malformed);
  });
});

describe('parseEventLog', () => {
  it('parses an ordered log', () => {
    const log = [event({ seq: 0 }), event({ seq: 1 })];
    expect(parseEventLog(log)).toEqual(log);
  });

  it('throws EventLogError naming the expected version', () => {
    try {
      parseEventLog([{ ...event(), logVersion: 99 }]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EventLogError);
      expect((error as EventLogError).message).toContain(`logVersion ${LOG_VERSION}`);
    }
  });
});

describe('findSeqBreaks', () => {
  it('passes a contiguous log for two competitors', () => {
    const log = [
      event({ competitorId: 'model-a', seq: 0 }),
      event({ competitorId: 'model-b', seq: 0 }),
      event({ competitorId: 'model-a', seq: 1 }),
      event({ competitorId: 'model-b', seq: 1 }),
    ];
    expect(findSeqBreaks(log)).toEqual([]);
  });

  it('names the competitor with a gap', () => {
    const log = [
      event({ competitorId: 'model-a', seq: 0 }),
      event({ competitorId: 'model-a', seq: 2 }),
      event({ competitorId: 'model-b', seq: 0 }),
    ];
    expect(findSeqBreaks(log)).toEqual(['model-a']);
  });

  it('names the competitor with a duplicate', () => {
    const log = [
      event({ competitorId: 'model-a', seq: 0 }),
      event({ competitorId: 'model-a', seq: 0 }),
    ];
    expect(findSeqBreaks(log)).toEqual(['model-a']);
  });

  it('accepts an empty log', () => {
    expect(findSeqBreaks([])).toEqual([]);
  });
});
