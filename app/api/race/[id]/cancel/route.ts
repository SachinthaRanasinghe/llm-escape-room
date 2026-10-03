import { publicRace } from '@/lib/race';
import { cancelHostedRace, netlifyKv } from '@/lib/race/hosted';

/**
 * `POST /api/race/<raceId>/cancel` — stop a public race. The background function
 * checks for the flag every few seconds; the next model call is refused, and
 * the race ends with an `error` message. Only on the public site.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!publicRace()) return new Response('Not found', { status: 404 });
  const { id } = await context.params;
  const cancelled = await cancelHostedRace(id, { kv: netlifyKv() });
  return Response.json({ cancelled }, { status: cancelled ? 200 : 404 });
}
