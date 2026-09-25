'use client';

import { useCallback, useEffect, useRef } from 'react';
import { ReplayPlayer } from '@/components/scene/ReplayPlayer';
import type { ComparisonData } from '@/lib/comparison';
import type { PlaybackProgress, RendererSnapshot, ReplayData } from '@/lib/replay';
import type { TelemetryConfig } from '@/lib/telemetry/config';
import { createWatchTracker, type WatchTracker } from '@/lib/telemetry/tracker';
import { createUmamiTransport } from '@/lib/telemetry/umami';

/**
 * A published run, observed — TICKET-11 (#11).
 *
 * The only client code that sends anything. It wraps the player, turns its
 * `onProgress` reports into the four watch-through events, and posts each one
 * at most once to Umami: the event name and the run's path, nothing else. No
 * cookie, no id, no storage (`lib/telemetry/boundary.test.ts`).
 *
 * `app/run/[id]/page.tsx` renders this only when `UMAMI_WEBSITE_ID` was set at
 * build time; otherwise it renders the bare player and nothing is sent.
 * `/replay` never renders it.
 *
 * ── Strict Mode ────────────────────────────────────────────────────────────
 * In dev, React mounts, unmounts and re-mounts every effect. The tracker lives
 * in a ref, which survives that, and its once-guard makes the second `open()`
 * a no-op — so one page load is one open.
 *
 * Child effects run before this one, so the player's very first report (0 ms,
 * playing) arrives before the tracker exists and is dropped. It would have
 * emitted nothing anyway.
 *
 * `TelemetryConfig` is imported as a TYPE: a value import of `config.ts` would
 * put its environment read in the browser graph.
 */

interface Props {
  readonly data: ReplayData;
  readonly renderer: RendererSnapshot;
  readonly comparison?: ComparisonData;
  readonly runId: string;
  readonly telemetry: TelemetryConfig;
}

export function TrackedReplay({ data, renderer, comparison, runId, telemetry }: Props) {
  const tracker = useRef<WatchTracker | null>(null);

  useEffect(() => {
    tracker.current ??= createWatchTracker(createUmamiTransport(telemetry, { hostname: window.location.hostname, runId }));
    tracker.current.open();
  }, [telemetry, runId]);

  const onProgress = useCallback((progress: PlaybackProgress) => tracker.current?.progress(progress), []);

  return <ReplayPlayer data={data} renderer={renderer} comparison={comparison} onProgress={onProgress} />;
}
