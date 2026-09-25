import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ReplayPlayer } from '@/components/scene/ReplayPlayer';
import { TrackedReplay } from '@/components/telemetry/TrackedReplay';
import {
  ArtifactError,
  comparisonFromArtifact,
  listArtifactIds,
  loadArtifact,
  replayFromArtifact,
  type PublishedArtifact,
} from '@/lib/artifact';
import { readTelemetryConfig } from '@/lib/telemetry/config';

/**
 * A published run — the URL you send someone. TICKET-9 (#9).
 *
 * A SERVER component, rendered at BUILD time for every `published/<id>.json`.
 * It reads the artifact, turns it into `ReplayData` plus the renderer snapshot
 * FROZEN in its manifest, and hands only those to the client player. There is
 * no room to project — the artifact never carried one — and no provider in
 * reach: `architecture.md` → *Replay ↔ artifact* is one-way.
 *
 * `dynamicParams = false`: an id that was not published at build time is a 404,
 * never rendered on request. There is no server to render it on.
 *
 * A frozen artifact that this build cannot play — an unsupported renderer major,
 * a beat plan that no longer follows from its timing — FAILS THE BUILD. It never
 * falls back to the live renderer: that silent fallback is exactly the "changes
 * under a viewer's feet" bug the manifest exists to prevent.
 *
 * `/replay` is the live preview of the current renderer; this is the frozen one.
 *
 * The post-run comparison (TICKET-10, #10) is computed here too, at build time,
 * from the artifact's run, repeat counts and log, and handed to the player as
 * plain strings — the player reveals it at the end, and decides nothing in it.
 *
 * Watch-through telemetry (TICKET-11, #11): the Umami website id is read here,
 * at BUILD time, and baked into the page. With `UMAMI_WEBSITE_ID` unset the page
 * is the bare player and requests nothing beyond its own origin; with it set,
 * `TrackedReplay` sends four anonymous events. An invalid id fails the build.
 * Changing it needs a rebuild.
 */

export const dynamicParams = false;

export function generateStaticParams(): { id: string }[] {
  return listArtifactIds().map((id) => ({ id }));
}

// Typed by hand rather than with the global `PageProps<'/run/[id]'>`: that helper
// exists only after `next typegen`, and `pnpm typecheck` must pass on a clean clone.
interface Props {
  readonly params: Promise<{ id: string }>;
}

function load(id: string): PublishedArtifact {
  try {
    return loadArtifact(id);
  } catch (error) {
    if (error instanceof ArtifactError && error.reason === 'not_found') notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  return { title: `${load(id).manifest.layout.themeName} · LLM Escape Room` };
}

export default async function RunPage({ params }: Props) {
  const { id } = await params;
  const artifact = load(id);
  const { data, renderer } = replayFromArtifact(artifact);
  const comparison = comparisonFromArtifact(artifact);
  const telemetry = readTelemetryConfig();
  return telemetry ? (
    <TrackedReplay data={data} renderer={renderer} comparison={comparison} runId={id} telemetry={telemetry} />
  ) : (
    <ReplayPlayer data={data} renderer={renderer} comparison={comparison} />
  );
}
