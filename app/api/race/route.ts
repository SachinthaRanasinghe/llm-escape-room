import { parseRaceRequest, prepareRace, publicRace, raceEnabled, RaceError, runRace } from '@/lib/race';
import { netlifyKv, startHostedRace, visitorAddress } from '@/lib/race/hosted';
import type { HostedRaceStarted, RaceMessage } from '@/lib/race/wire';

/**
 * `POST /api/race` — race two models from the free catalogue and stream it.
 *
 * The body is a `RaceRequest`. Anything that can refuse the race — a model not
 * in the catalogue, a key not set, a race already running — is answered with a
 * plain 4xx before a model is called. After that the response is NDJSON, one
 * `RaceMessage` per line, ending in `done` or `error`. A run takes minutes: each
 * model gets up to 14 actions, and the silent repeats run after the main one.
 *
 * Closing the connection cancels the race: the next model call is refused, the
 * duel aborts, and nothing is saved as finished.
 *
 * On the public site (`PUBLIC_RACE=1`) a function cannot stream for minutes, so
 * the race is queued instead: the answer is `202 { raceId }`, the race runs in
 * the background function, and the page follows it at `GET /api/race/<raceId>`
 * (`lib/race/hosted.ts`).
 */
export async function POST(request: Request): Promise<Response> {
  // Before the body is read: a disabled build does not admit the route exists.
  if (!raceEnabled()) return new Response('Not found', { status: 404 });
  if (publicRace()) return startPublic(request);
  let prepared;
  try {
    prepared = await prepareRace(parseRaceRequest(await request.json().catch(() => null)));
  } catch (error) {
    if (error instanceof RaceError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const abort = new AbortController();
  request.signal.addEventListener('abort', () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (message: RaceMessage) => {
        if (abort.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
        } catch {
          abort.abort();
        }
      };
      await runRace(prepared, emit, abort.signal);
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
    const race = parseRaceRequest(await request.json().catch(() => null));
    const raceId = await startHostedRace(race, {
      kv: netlifyKv(),
      address: visitorAddress(request.headers),
      kick: async (id) => {
        // A background function answers 202 at once and keeps running for up to 15 minutes.
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
    return Response.json({ error: 'the race could not be started' }, { status: 500 });
  }
}
