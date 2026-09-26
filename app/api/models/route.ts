import { getCatalogue, raceEnabled } from '@/lib/race';

/**
 * `GET /api/models` — the free models the race page can offer, read live from
 * each provider (`lib/providers/catalogue.ts`), plus the rooms to race in.
 * `?refresh=1` skips the five-minute cache.
 *
 * Local only: a 404 in a production build unless `ENABLE_LOCAL_RACE=1`
 * (`lib/providers/env.ts`). Returns names, ids and whether each key is SET —
 * never a key.
 */
export async function GET(request: Request): Promise<Response> {
  if (!raceEnabled()) return new Response('Not found', { status: 404 });
  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  return Response.json(await getCatalogue({ refresh }), { headers: { 'cache-control': 'no-store' } });
}
