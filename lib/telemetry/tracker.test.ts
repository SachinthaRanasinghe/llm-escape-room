import { describe, expect, it } from 'vitest';
import type { PlaybackProgress } from '@/lib/replay';
import type { TelemetryEvent } from './events';
import { createWatchTracker } from './tracker';

function track() {
  const sent: TelemetryEvent[] = [];
  return { sent, tracker: createWatchTracker((e) => sent.push(e)) };
}

const at = (tMs: number, state: PlaybackProgress['state'] = 'playing', skipped = false): PlaybackProgress => ({
  tMs,
  state,
  skipped,
});

describe('createWatchTracker', () => {
  it('opens once, however many times the player mounts', () => {
    const { sent, tracker } = track();
    tracker.open();
    tracker.open(); // React Strict Mode's dev double-mount
    expect(sent).toEqual(['run-open']);
  });

  it('marks 30-second survival on the replay clock, not before', () => {
    const { sent, tracker } = track();
    tracker.open();
    tracker.progress(at(29_999));
    expect(sent).toEqual(['run-open']);
    tracker.progress(at(30_000));
    tracker.progress(at(31_000));
    expect(sent).toEqual(['run-open', 'run-t30']);
  });

  it('never counts paused time: no report past the mark means no t30', () => {
    const { sent, tracker } = track();
    tracker.progress(at(10_000, 'paused'));
    expect(sent).toEqual([]);
  });

  it('completes once, and a restart counts nothing again', () => {
    const { sent, tracker } = track();
    tracker.open();
    tracker.progress(at(40_000));
    tracker.progress(at(79_000, 'ended'));
    tracker.progress(at(0)); // restart
    tracker.progress(at(40_000));
    tracker.progress(at(79_000, 'ended'));
    expect(sent).toEqual(['run-open', 'run-t30', 'run-complete']);
  });

  it('reports a skip on its own, and never as a completion', () => {
    const { sent, tracker } = track();
    tracker.progress(at(5_000, 'playing', true));
    expect(sent).toEqual(['run-skip']);
  });

  it('still completes a skipped run that plays on to its end', () => {
    const { sent, tracker } = track();
    tracker.progress(at(5_000, 'playing', true));
    tracker.progress(at(79_000, 'ended', true));
    expect(sent).toEqual(['run-skip', 'run-t30', 'run-complete']);
  });

  it('keeps the funnel monotonic when one report crosses both thresholds', () => {
    const { sent, tracker } = track();
    tracker.progress(at(80_000, 'ended'));
    expect(sent).toEqual(['run-t30', 'run-complete']);
  });

  it('survives a sender that throws, without retrying', () => {
    const attempts: TelemetryEvent[] = [];
    const tracker = createWatchTracker((e) => {
      attempts.push(e);
      throw new Error('network down');
    });
    tracker.open();
    tracker.open();
    tracker.progress(at(30_000));
    expect(attempts).toEqual(['run-open', 'run-t30']);
  });
});
