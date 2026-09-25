import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { buildSceneLayout } from '@/lib/replay';
import { checkRepeats } from './repeats';
import { replayFromArtifact } from './replay';
import { findLeaks } from './scan';
import { artifactPath, listArtifactIds, loadArtifact } from './store';
import { canonicalSecrets } from './testing';

/**
 * Every COMMITTED artifact in `published/` — what `/run/[id]` actually builds.
 *
 * Deliberately NOT compared against the live renderer. A published artifact is
 * SUPPOSED to drift from `CURRENT_RENDERER` as the renderer is retuned; that is
 * the whole point of freezing it. What must not drift is its DATA — the log,
 * the run and the room layout — from the fixtures it was published from.
 */

const ids = listArtifactIds();

describe('the published directory', () => {
  it('holds the canonical run', () => {
    // Guards the guards below: an empty directory would pass all of them.
    expect(ids).toContain('canonical');
  });
});

describe.each(ids)('published/%s.json', (id) => {
  const text = readFileSync(artifactPath(id), 'utf8');

  it('parses, and plays under this build without drift', () => {
    expect(() => replayFromArtifact(loadArtifact(id))).not.toThrow();
  });

  it('states repeat counts that agree with its typicality verdict', () => {
    expect(() => checkRepeats(loadArtifact(id))).not.toThrow();
  });

  it('carries no URL, endpoint or key-shaped string', () => {
    expect(findLeaks(text)).toEqual([]);
  });
});

describe('published/canonical.json', () => {
  const artifact = loadArtifact('canonical');
  const MIGRATE = 'the fixtures changed — regenerate with `scripts/publish.mts --canonical --force` (or migrate it with them)';

  it('is the golden fixture run, byte for byte in its data', () => {
    expect(artifact.log, MIGRATE).toEqual(loadCanonicalLog());
    expect(artifact.run, MIGRATE).toEqual(loadCanonicalRun());
    expect(artifact.manifest.layout, MIGRATE).toEqual(buildSceneLayout(loadCanonicalRoom()));
  });

  it('has no silent repeats yet — the page says so rather than implying it was checked', () => {
    expect(artifact.repeats).toEqual({ completed: 0, dropped: 0, outcomes: [] });
    expect(artifact.run.typicalOfRepeats).toBeNull();
  });

  it("holds none of the room's answers, codes, clues or descriptions outside the log", () => {
    const outsideLog = JSON.stringify({ ...artifact, log: [] });
    for (const secret of canonicalSecrets()) expect(outsideLog, secret).not.toContain(secret);
  });
});
