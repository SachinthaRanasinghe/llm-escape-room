import { describe, expect, it } from 'vitest';
import { ACTION_NAMES, VERDICT_CODES } from '@/lib/schema/action';
import { REJECTION_KINDS } from '@/lib/schema/event';
import { END_REASONS } from '@/lib/schema/run';
import { VERDICT_TALLY } from '@/lib/sim/simulator';
import {
  describeAction,
  describeCall,
  describeDoing,
  describeOutcome,
  describeEnd,
  formatThink,
  REJECTION_LABEL,
  VERB_LABEL,
  VERDICT_TONE,
} from './labels';
import { beat, lane, layoutFixture } from './testing';

const layout = layoutFixture();

describe('every member of every union has a label', () => {
  it('covers each verb, verdict and rejection kind', () => {
    for (const name of ACTION_NAMES) expect(VERB_LABEL[name]).toBeTruthy();
    for (const code of VERDICT_CODES) expect(VERDICT_TONE[code]).toBeTruthy();
    for (const kind of REJECTION_KINDS) expect(REJECTION_LABEL[kind]).toBeTruthy();
  });

  it('describes every way a lane can end', () => {
    for (const reason of END_REASONS) {
      expect(describeEnd(lane(3, { endedBecause: reason, escaped: reason === 'escaped' }))).toBeTruthy();
    }
    expect(describeEnd(lane(13, { endedBecause: 'escaped', escaped: true }))).toBe('Escaped in 13 actions');
    expect(describeEnd(lane(14))).toBe('Out of actions');
  });
});

describe('VERDICT_TONE agrees with the simulator tally', () => {
  const expected = { none: ['success', 'neutral'], failed: ['failure'], invalid: ['invalid'] } as const;
  for (const code of VERDICT_CODES) {
    it(`${code} is toned the way RunSummary counts it`, () => {
      expect(expected[VERDICT_TALLY[code]]).toContain(VERDICT_TONE[code]);
    });
  }

  it('only `ok` is a success', () => {
    expect(VERDICT_CODES.filter((c) => VERDICT_TONE[c] === 'success')).toEqual(['ok']);
  });
});

describe('describeAction', () => {
  it('names the target by its public name', () => {
    expect(describeAction(beat({ verb: 'look' }), layout)).toBe('looks around');
    expect(describeAction(beat({ verb: 'inspect', targetId: 'safe', rawTargetId: 'safe' }), layout)).toBe(
      'inspects iron safe',
    );
    expect(describeAction(beat({ verb: 'take', targetId: 'key', rawTargetId: 'key' }), layout)).toBe(
      'takes brass key',
    );
    expect(describeAction(beat({ verb: 'open', targetId: 'door', rawTargetId: 'door' }), layout)).toBe(
      'tries to open oak door',
    );
  });

  it('shows the item, the code and the answer verbatim', () => {
    expect(
      describeAction(beat({ verb: 'use', heldItemId: 'key', targetId: 'safe', rawTargetId: 'safe' }), layout),
    ).toBe('uses brass key on iron safe');
    expect(
      describeAction(beat({ verb: 'enter_code', argument: '7777', targetId: 'safe', rawTargetId: 'safe' }), layout),
    ).toBe('enters code 7777 on iron safe');
    expect(
      describeAction(beat({ verb: 'submit_answer', argument: 'north', targetId: 'door', rawTargetId: 'door' }), layout),
    ).toBe('answers "north" for oak door');
  });

  it('shows an unknown target as exactly what the model named', () => {
    expect(describeAction(beat({ verb: 'inspect', targetId: null, rawTargetId: 'bookshelf' }), layout)).toBe(
      'inspects bookshelf',
    );
  });

  it('describes a rejected turn by its kind', () => {
    expect(describeAction(beat({ verb: null, rejection: 'no_tool_call' }), layout)).toBe('did not act');
    expect(describeAction(beat({ verb: null, rejection: 'multiple_tool_calls' }), layout)).toBe(
      'tried two actions at once',
    );
  });
});

describe('formatThink', () => {
  it('shows seconds to one decimal', () => {
    expect(formatThink(0)).toBe('0.0 s');
    expect(formatThink(1260)).toBe('1.3 s');
    expect(formatThink(3340)).toBe('3.3 s');
    expect(formatThink(12_340)).toBe('12.3 s');
  });
});

describe('describeCall', () => {
  it('writes the call as the model sent it, argument verbatim', () => {
    expect(describeCall(beat({ verb: 'look' }))).toBe('look()');
    expect(describeCall(beat({ verb: 'open', targetId: 'door', rawTargetId: 'door' }))).toBe('open(door)');
    expect(describeCall(beat({ verb: 'use', heldItemId: 'key', targetId: 'safe', rawTargetId: 'safe' }))).toBe('use(key, safe)');
    expect(describeCall(beat({ verb: 'enter_code', argument: '7777', targetId: 'safe', rawTargetId: 'safe' }))).toBe(
      'enter_code(safe, "7777")',
    );
  });

  it('keeps an id that does not exist, and has no call for a rejected turn', () => {
    expect(describeCall(beat({ verb: 'inspect', targetId: null, rawTargetId: 'bookshelf' }))).toBe('inspect(bookshelf)');
    expect(describeCall(beat({ verb: null, rejection: 'no_tool_call' }))).toBeNull();
  });
});

describe('describeDoing and describeOutcome', () => {
  const safe = { targetId: 'safe', rawTargetId: 'safe' } as const;
  const no = (code: 'locked' | 'wrong_code' | 'not_found') => ({ ok: false, code, message: 'No.' });

  it('says what is happening now, and what happened, in plain words', () => {
    expect(describeDoing(beat({ verb: 'inspect', ...safe }), layout)).toBe('Inspecting iron safe');
    expect(describeDoing(beat({ verb: 'look' }), layout)).toBe('Looking around the room');
    expect(describeOutcome(beat({ verb: 'take', targetId: 'key', rawTargetId: 'key' }), layout)).toBe('Took brass key');
    expect(describeOutcome(beat({ verb: 'open', ...safe }), layout)).toBe('Opened iron safe');
  });

  it('says why the room refused, from the verdict code', () => {
    expect(describeOutcome(beat({ verb: 'open', ...safe, verdict: no('locked') }), layout)).toBe('Tried to open iron safe — locked');
    expect(describeOutcome(beat({ verb: 'enter_code', argument: '1234', ...safe, verdict: no('wrong_code') }), layout)).toBe(
      'Entered code 1234 on iron safe — wrong code',
    );
    expect(
      describeOutcome(beat({ verb: 'inspect', targetId: null, rawTargetId: 'bookshelf', verdict: no('not_found') }), layout),
    ).toBe('Inspected bookshelf — not in the room');
    expect(describeOutcome(beat({ verb: null, rejection: 'no_tool_call', verdict: no('not_found') }), layout)).toBe('Did not act');
  });
});
