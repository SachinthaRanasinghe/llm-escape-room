import { publicRace, raceEnabled, RaceError } from '@/lib/race';
import { parseArenaRequest, prepareArena, runArena } from '@/lib/race/arena';
import type { ArenaMessage } from '@/lib/race/arena-wire';
import { netlifyKv, startHostedRace, visitorAddress } from '@/lib/race/hosted';
import type { HostedRaceStarted } from '@/lib/race/wire';

/**
 * `POST /api/arena` — run an Energy Cores match between three catalogue models.
 *
 * The body is an `ArenaRequest`. Anything that can refuse the match is answered
 * with a plain 4xx before a model is called. After that, locally, the response is
 * NDJSON, one `ArenaMessage` per line, ending in `done` or `error`; closing the
 * connection cancels the match. On the public site (`PUBLIC_RACE=1`) the match
 * is queued on the race's queue instead: `202 { raceId }`, followed at
 * `GET /api/arena/<raceId>` (`lib/race/hosted.ts`).
 */
export async function POST(request: Request): Promise<Response> {
  if (!raceEnabled()) return new Response('Not found', { status: 404 });
  if (publicRace()) return startPublic(request);
  let prepared;
  try {
    prepared = await prepareArena(parseArenaRequest(await request.json().catch(() => null)));
  } catch (error) {
    if (error instanceof RaceError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (message: ArenaMessage) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          abort.abort();
        }
      };
      await runArena(prepared, emit, abort.signal);
      try {
        controller.close();
      } catch {
        // Already closed by a cancel.
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function startPublic(request: Request): Promise<Response> {
  try {
    const match = parseArenaRequest(await request.json().catch(() => null));
    const raceId = await startHostedRace(match, {
      game: 'arena',
      kv: netlifyKv(),
      address: visitorAddress(request.headers),
      kick: async (id) => {
        // The race's background function runs both games; the job says which.
        const response = await fetch(new URL('/.netlify/functions/race-background', request.url), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ raceId: id }),
        });
        if (response.status !== 202 && !response.ok) throw new Error(`background function answered ${response.status}`);
      },
    });
    return Response.json({ raceId } satisfies HostedRaceStarted, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof RaceError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: 'the match could not be started' }, { status: 500 });
  }
}
