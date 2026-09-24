import type { Metadata } from 'next';
import { ReplayPlayer } from '@/components/scene/ReplayPlayer';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { buildReplay, buildSceneLayout } from '@/lib/replay';

/**
 * The canonical replay — TICKET-1's golden log, played with no backend.
 *
 * A SERVER component on purpose. This is the one place the room is read: the
 * fixture `RoomSpec` carries every answer, so it is projected into a public
 * `SceneLayout` here and only the resulting `ReplayData` crosses into the client
 * bundle. `lib/replay/boundary.test.ts` forbids the client side from importing
 * the fixtures or the room schema at all.
 *
 * TICKET-9 (#9) replaces this with `/run/[id]`, loading a published artifact
 * (log + frozen render manifest + summary) instead of the fixtures.
 */

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Replay · LLM Escape Room',
};

export default function ReplayPage() {
  const data = buildReplay({
    log: loadCanonicalLog(),
    run: loadCanonicalRun(),
    layout: buildSceneLayout(loadCanonicalRoom()),
  });
  return <ReplayPlayer data={data} />;
}
