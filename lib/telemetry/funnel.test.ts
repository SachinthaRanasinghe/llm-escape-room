import { describe, expect, it } from 'vitest';
import { summariseFunnel } from './funnel';

describe('summariseFunnel', () => {
  it('has no rates at all when nobody opened the run', () => {
    expect(summariseFunnel({})).toEqual({
      opens: 0,
      t30: 0,
      complete: 0,
      skip: 0,
      survival30: null,
      watchThrough: null,
      meetsTarget: null,
    });
  });

  it('meets the target at exactly 50% — the PRD says "≥ 50% of opens"', () => {
    const funnel = summariseFunnel({ 'run-open': 10, 'run-t30': 6, 'run-complete': 5, 'run-skip': 2 });
    expect(funnel).toMatchObject({ opens: 10, t30: 6, complete: 5, skip: 2, survival30: 0.6, watchThrough: 0.5, meetsTarget: true });
  });

  it('misses it below', () => {
    expect(summariseFunnel({ 'run-open': 10, 'run-complete': 4 }).meetsTarget).toBe(false);
  });

  it('ignores event names it does not know', () => {
    expect(summariseFunnel({ 'run-open': 2, pageview: 99 }).opens).toBe(2);
  });
});
