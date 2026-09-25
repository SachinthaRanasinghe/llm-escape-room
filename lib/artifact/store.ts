import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRepeats } from './repeats';
import { ARTIFACT_ID, ArtifactError, parseArtifact, type PublishedArtifact } from './schema';

/**
 * Where published artifacts live: `published/<id>.json`, committed.
 *
 * Read at BUILD time by `app/run/[id]/page.tsx` and by the tests — there is no
 * server and nothing reads this per viewer. `runs/` is gitignored scratch; this
 * directory is what is actually shared.
 *
 * The id is checked against `ARTIFACT_ID` before it is joined to a path, so
 * `../` never reaches the filesystem.
 *
 * A loaded artifact's repeat counts are re-checked against its verdict
 * (`checkRepeats`, TICKET-10 #10), so a hand-edited file fails the build rather
 * than printing a count the data does not support.
 *
 * `process.cwd()`, not an environment read: `next build`, vitest and `tsx`
 * scripts all run from the repo root.
 */

export const PUBLISHED_DIR = join(process.cwd(), 'published');

export function artifactPath(id: string, dir: string = PUBLISHED_DIR): string {
  if (!ARTIFACT_ID.test(id)) throw new ArtifactError('not_found', `not an artifact id: ${JSON.stringify(id)}`);
  return join(dir, `${id}.json`);
}

/** Sorted. Anything that is not `<valid id>.json` — a README, a stray file — is ignored. */
export function listArtifactIds(dir: string = PUBLISHED_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((id) => ARTIFACT_ID.test(id))
    .sort();
}

export function loadArtifact(id: string, dir: string = PUBLISHED_DIR): PublishedArtifact {
  const path = artifactPath(id, dir);
  if (!existsSync(path)) throw new ArtifactError('not_found', id);
  const artifact = parseArtifact(JSON.parse(readFileSync(path, 'utf8')));
  if (artifact.id !== id) throw new ArtifactError('not_found', `${path} holds artifact ${artifact.id}, not ${id}`);
  checkRepeats(artifact);
  return artifact;
}
