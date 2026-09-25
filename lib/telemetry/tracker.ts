import type { PlaybackProgress } from '@/lib/replay';
import { T30_MS, type TelemetryEvent } from './events';

/**
 * The watch tracker — TICKET-11 (#11). Turns the player's progress reports into
 * at-most-once events. Pure: no clock, no network, no DOM. The sender is
 * injected, so it is tested in node and wired to Umami by
 * `components/telemetry/TrackedReplay.tsx`.
 *
 * ── At most once, whatever happens ─────────────────────────────────────────
 * An event is marked sent BEFORE the sender runs, and a sender that throws is
 * swallowed rather than retried: a retry could count one viewer twice, which
 * would inflate the very metric this exists to measure honestly. The same
 * guard absorbs React Strict Mode's dev double-mount (two `open()` calls) and a
 * restart (the clock going back to 0 after `run-complete`).
 *
 * ── Order within one report ────────────────────────────────────────────────
 * skip, then t30, then complete. A single report at the end of a short replay
 * can cross both thresholds, and the funnel must stay monotonic: nothing
 * completes without first surviving 30 seconds.
 */

export interface WatchTracker {
  open(): void;
  progress(p: PlaybackProgress): void;
}

export function createWatchTracker(send: (event: TelemetryEvent) => void): WatchTracker {
  const sent = new Set<TelemetryEvent>();

  const emit = (event: TelemetryEvent): void => {
    if (sent.has(event)) return;
    sent.add(event);
    try {
      send(event);
    } catch {
      // Telemetry never breaks playback, and never retries.
    }
  };

  return {
    open: () => emit('run-open'),
    progress: (p) => {
      if (p.skipped) emit('run-skip');
      if (p.tMs >= T30_MS) emit('run-t30');
      if (p.state === 'ended') emit('run-complete');
    },
  };
}
