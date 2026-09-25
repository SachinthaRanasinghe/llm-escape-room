import type { EventLog } from '@/lib/schema/event';
import type { RoomSpec } from '@/lib/schema/room';
import type { Run } from '@/lib/schema/run';
import { ARTIFACT_VERSION } from '@/lib/schema/version';
import { buildReplay, buildSceneLayout, planBeats, type RendererSnapshot } from '@/lib/replay';
import { ArtifactError, parseArtifact, type PublishedArtifact } from './schema';
import { findLeaks } from './scan';
import { buildRepeatRecord, checkRepeats, type RepeatInput } from './repeats';

/**
 * A finished run → a published artifact. TICKET-9 (#9).
 *
 * ── The room goes in; only its projection comes out ─────────────────────────
 * The room is needed — the log names object ids but not where they stand — and
 * it carries every answer. So it is projected through `buildSceneLayout`, the
 * replay's secrecy boundary, and the `RoomSpec` itself is never referenced again.
 *
 * ── Built by listing, never by spreading ───────────────────────────────────
 * Every field of the artifact and the manifest is named below — the rule from
 * `lib/replay/layout.ts`. A spread of the renderer or the run would carry along
 * whatever someone adds to either next month.
 *
 * ── Validated four times ───────────────────────────────────────────────────
 * `buildReplay` refuses a log that does not belong to the run or has a gap.
 * `parseArtifact` refuses anything off-schema. `checkRepeats` refuses repeat
 * counts that disagree with `run.typicalOfRepeats` (TICKET-10, #10). `findLeaks`
 * refuses anything shaped like a URL or a key. A run that fails any of them is
 * not published.
 *
 * Pure: no filesystem, no clock. `publishedAt` is passed in, like the harness's
 * `now` — `scripts/publish.mts` passes the real time, tests a fixed one.
 */

/**
 * `published/canonical.json`'s timestamp: the golden fixtures' own start time,
 * so `scripts/publish.mts --canonical` is reproducible byte for byte.
 */
export const CANONICAL_PUBLISHED_AT = '2026-09-22T10:00:00.000Z';

export interface BuildArtifactInput {
  readonly id: string;
  readonly run: Run;
  readonly log: EventLog;
  readonly room: RoomSpec;
  /** The silent repeats — counted into `artifact.repeats`, never published themselves. */
  readonly repeats: RepeatInput;
  /** What to freeze. `scripts/publish.mts` passes `CURRENT_RENDERER`. */
  readonly renderer: RendererSnapshot;
  /** ISO 8601. */
  readonly publishedAt: string;
}

export function buildArtifact({ id, run, log, room, repeats, renderer, publishedAt }: BuildArtifactInput): PublishedArtifact {
  if (room.roomId !== run.roomId) {
    throw new ArtifactError('room_mismatch', `room ${room.roomId}, run ${run.roomId}`);
  }

  const layout = buildSceneLayout(room);
  const data = buildReplay({ log, run, layout });
  const beatPlan = planBeats(data, renderer.timing);
  const record = buildRepeatRecord(run, repeats);

  const artifact = parseArtifact({
    artifactVersion: ARTIFACT_VERSION,
    id,
    publishedAt,
    run,
    repeats: {
      completed: record.completed,
      dropped: record.dropped,
      outcomes: record.outcomes,
    },
    log,
    manifest: {
      rendererVersion: renderer.rendererVersion,
      timing: renderer.timing,
      camera: renderer.camera,
      assets: renderer.assets,
      geometry: renderer.geometry,
      layout,
      beatPlan,
    },
  });
  checkRepeats(artifact);

  const leaks = findLeaks(JSON.stringify(artifact));
  if (leaks.length > 0) {
    // Kinds only: the match itself may be the secret.
    throw new ArtifactError('leak', [...new Set(leaks.map((l) => l.kind))].join(', '));
  }
  return artifact;
}
