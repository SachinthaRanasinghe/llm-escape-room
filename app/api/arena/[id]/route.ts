import { publicRace } from '@/lib/race';
import { netlifyKv, pollHostedRace } from '@/lib/race/hosted';

/**
 * `GET /api/arena/<raceId>?from=<n>` — follow a public match. The arena shares
 * the race's queue (`lib/race/hosted.ts`), so this is the race's poll under the
 * arena's path. Only on the public site: the local arena streams instead.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!publicRace()) return new Response('Not found', { status: 404 });
  const { id } = await context.params;
  const from = Number(new URL(request.url).searchParams.get('from') ?? '0');
  const poll = await pollHostedRace(id, Number.isInteger(from) && from >= 0 ? from : 0, { kv: netlifyKv() });
  if (poll === null) return Response.json({ error: 'no such match' }, { status: 404 });
  return Response.json(poll, { headers: { 'cache-control': 'no-store' } });
}
