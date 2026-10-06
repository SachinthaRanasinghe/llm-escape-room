import { publicRace } from '@/lib/race';
import { cancelHostedRace, netlifyKv } from '@/lib/race/hosted';

/**
 * `POST /api/arena/<raceId>/cancel` — stop a public match. The background
 * function checks for the flag every few seconds and refuses the next model call.
 * Only on the public site.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!publicRace()) return new Response('Not found', { status: 404 });
  const { id } = await context.params;
  const cancelled = await cancelHostedRace(id, { kv: netlifyKv() });
  return Response.json({ cancelled }, { status: cancelled ? 200 : 404 });
}
