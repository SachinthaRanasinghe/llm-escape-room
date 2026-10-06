import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ArenaLab } from '@/components/arena/ArenaLab';
import { raceEnabled } from '@/lib/race';

/**
 * `/arena` — three models fight over five Energy Cores (`docs/decisions/arena.md`).
 *
 * Gated exactly like `/race`: it exists under `next dev`, with
 * `ENABLE_LOCAL_RACE=1`, or on the public site with `PUBLIC_RACE=1`, and 404s
 * otherwise. The client component talks only to `/api/models` and `/api/arena`.
 */

export const metadata: Metadata = { title: 'Energy Cores arena · LLM Escape Room' };

export default async function ArenaPage() {
  await connection();
  if (!raceEnabled()) notFound();
  return <ArenaLab />;
}
