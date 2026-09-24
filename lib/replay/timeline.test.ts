import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { buildSceneLayout } from './layout';
import { buildReplay, ReplayError, type ReplayErrorReason } from './timeline';
import { event, layoutFixture, rejectedEvent, runFixture, TEST_RUN_ID } from './testing';

const log = loadCanonicalLog();
const run = loadCanonicalRun();
const layout = buildSceneLayout(loadCanonicalRoom());
const data = buildReplay({ log, run, layout });
const [a, b] = data.lanes;

function reasonOf(fn: () => unknown): ReplayErrorReason | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ReplayError) return error.reason;
    throw error;
  }
  return undefined;
}

describe('buildReplay on the golden fixtures', () => {
  it('builds one lane per competitor, in run order, with their outcomes', () => {
    expect(data.runId).toBe(run.runId);
    expect(data.lanes.map((l) => l.competitorId)).toEqual(['model-a', 'model-b']);
    expect(a.beats).toHaveLength(13);
    expect(a.escaped).toBe(true);
    expect(a.endedBecause).toBe('escaped');
    expect(b.beats).toHaveLength(14);
    expect(b.endedBecause).toBe('budget_actions');
    expect(a.label).toBe('competitor-a');
    expect(a.maxActions).toBe(14);
  });

  it('plays each lane in seq order', () => {
    for (const lane of data.lanes) expect(lane.beats.map((x) => x.seq)).toEqual(lane.beats.map((_, i) => i));
  });

  it('keeps EVERY intent byte-for-byte', () => {
    for (const e of log) {
      const lane = data.lanes.find((l) => l.competitorId === e.competitorId)!;
      expect(lane.beats[e.seq].intent).toBe(e.action!.intent);
    }
  });

  it('keeps a typographic apostrophe', () => {
    expect(a.beats[12].intent).toContain('’');
  });

  it('keeps an unknown target as named, but gives it no position', () => {
    const bookshelf = b.beats[8];
    expect(bookshelf.rawTargetId).toBe('bookshelf');
    expect(bookshelf.targetId).toBeNull();
    expect(bookshelf.verdict.code).toBe('not_found');
  });

  it('resolves submit_answer to the object the puzzle unlocks', () => {
    const answer = a.beats[12];
    expect(answer.verb).toBe('submit_answer');
    expect(answer.rawTargetId).toBe('door');
    expect(answer.targetId).toBe('door');
    expect(answer.argument).toBe('north');
  });

  it('carries codes verbatim', () => {
    expect(b.beats[2].argument).toBe('7777');
    expect(b.beats[2].verdict.code).toBe('wrong_code');
  });

  it('sums think-time per lane, and uses the real latency as the stat', () => {
    for (const lane of data.lanes) {
      const events = log.filter((e) => e.competitorId === lane.competitorId);
      expect(lane.beats.at(-1)!.cumulativeThinkMs).toBe(events.reduce((sum, e) => sum + e.latencyMs, 0));
      for (const x of lane.beats) {
        expect(x.thinkMs).toBe(events.find((e) => e.seq === x.seq)!.latencyMs);
      }
    }
  });

  it('does not depend on the order the log was merged in', () => {
    expect(buildReplay({ log: [...log].reverse(), run, layout })).toEqual(data);
  });
});

/** `first` in lane `a`, plus a plain look in lane `b` — a `Run` needs two competitors. */
function pair(first: ReturnType<typeof event>) {
  return [first, event({ competitorId: 'b' })];
}

describe('rejected turns', () => {
  const run2 = runFixture();
  const lay = layoutFixture();

  it("shows the model's own intent when it wrote one", () => {
    const out = buildReplay({ log: pair(rejectedEvent('invalid_arguments', 'Open the safe.')), run: run2, layout: lay });
    const x = out.lanes[0].beats[0];
    expect(x.verb).toBeNull();
    expect(x.intent).toBe('Open the safe.');
    expect(x.rejection).toBe('invalid_arguments');
    expect(x.targetId).toBeNull();
    expect(x.verdict.code).toBe('malformed');
  });

  it('invents nothing when it wrote none', () => {
    const out = buildReplay({ log: pair(rejectedEvent('no_tool_call', null)), run: run2, layout: lay });
    expect(out.lanes[0].beats[0].intent).toBeNull();
    expect(out.lanes[0].beats[0].rejection).toBe('no_tool_call');
  });

  it('keeps an intent with surrounding whitespace exactly', () => {
    const intent = '  spaced  ';
    const out = buildReplay({ log: pair(event({ action: { name: 'look', intent } })), run: run2, layout: lay });
    expect(out.lanes[0].beats[0].intent).toBe(intent);
  });
});

describe('a broken log is refused, with a reason', () => {
  it('seq_break when an action is missing', () => {
    expect(reasonOf(() => buildReplay({ log: log.filter((e) => !(e.competitorId === 'model-a' && e.seq === 3)), run, layout }))).toBe(
      'seq_break',
    );
  });

  it('run_mismatch when an event belongs to another run', () => {
    expect(reasonOf(() => buildReplay({ log: pair(event({ runId: 'other' })), run: runFixture(), layout }))).toBe(
      'run_mismatch',
    );
  });

  it('unknown_competitor when an event names someone not in the run', () => {
    expect(reasonOf(() => buildReplay({ log: [...pair(event()), event({ competitorId: 'z' })], run: runFixture(), layout }))).toBe(
      'unknown_competitor',
    );
  });

  it('missing_summary when a competitor has no summary', () => {
    const r = runFixture();
    expect(reasonOf(() => buildReplay({ log: pair(event()), run: { ...r, summaries: r.summaries.slice(1) }, layout }))).toBe(
      'missing_summary',
    );
  });

  it('empty_lane when a competitor never acted', () => {
    expect(reasonOf(() => buildReplay({ log: [event()], run: runFixture(), layout }))).toBe('empty_lane');
  });

  it('the fixtures use the shared test run id', () => {
    expect(event().runId).toBe(TEST_RUN_ID);
  });
});
