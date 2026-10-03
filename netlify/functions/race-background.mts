import { netlifyKv, runHostedRace } from '../../lib/race/hosted';

/**
 * The public race's runner (`lib/race/hosted.ts`, `docs/decisions/public-race.md`).
 *
 * A background function: Netlify answers the caller 202 at once and lets this
 * run for up to 15 minutes — long enough for a race, which a streamed response
 * (60 seconds) is not. `POST /api/race` kicks it with a race id after every
 * check and limit has passed; it claims the queued job (a second kick, or a
 * made-up id, finds nothing to claim) and writes each message to Blobs.
 *
 * It holds the provider keys' call path, like the `app/api/` routes: the keys
 * are read from the site's environment by `lib/providers/env.ts` and never
 * written anywhere.
 */
export default async function handler(request: Request): Promise<void> {
  const body = (await request.json().catch(() => null)) as { raceId?: unknown } | null;
  if (typeof body?.raceId !== 'string') return;
  await runHostedRace(body.raceId, { kv: netlifyKv() });
}

/** Served at `/.netlify/functions/race-background`; Netlify answers 202 and runs it for up to 15 minutes. */
export const config = { background: true };
