import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { RaceLab } from '@/components/race/RaceLab';
import { raceEnabled } from '@/lib/race';

/**
 * `/race` — pick two free models and race them, locally.
 *
 * The one page that can make a model call, and only through `/api/race`: this
 * server page decides whether it exists at all, and the client component talks
 * to the API routes. A 404 in a production build unless `ENABLE_LOCAL_RACE=1`
 * (`lib/providers/env.ts`), so the public replay site never offers it.
 *
 * `connection()` keeps it out of the static build: whether it exists is decided
 * per request, in the process that holds the keys.
 */

export const metadata: Metadata = { title: 'Race two models · LLM Escape Room' };

export default async function RacePage() {
  await connection();
  if (!raceEnabled()) notFound();
  return <RaceLab />;
}
