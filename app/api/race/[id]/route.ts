import { publicRace } from '@/lib/race';
import { netlifyKv, pollHostedRace } from '@/lib/race/hosted';

/**
 * `GET /api/race/<raceId>?from=<n>` — follow a public race (`lib/race/hosted.ts`).
 *
 * Returns the race's `RaceMessage`s from index `n` on — the same messages the
 * local NDJSON stream carries, nothing more — and whether the race has finished.
 * Only on the public site: the local race streams instead.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!publicRace()) return new Response('Not found', { status: 404 });
  const { id } = await context.params;
  const from = Number(new URL(request.url).searchParams.get('from') ?? '0');
  const poll = await pollHostedRace(id, Number.isInteger(from) && from >= 0 ? from : 0, { kv: netlifyKv() });
  if (poll === null) return Response.json({ error: 'no such race' }, { status: 404 });
  return Response.json(poll, { headers: { 'cache-control': 'no-store' } });
}
