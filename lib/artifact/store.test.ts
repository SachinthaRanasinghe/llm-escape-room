import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildArtifact } from './publish';
import { ArtifactError } from './schema';
import { artifactPath, listArtifactIds, loadArtifact } from './store';
import { canonicalInput } from './testing';

const dir = mkdtempSync(join(tmpdir(), 'artifact-store-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const artifact = buildArtifact(canonicalInput({ id: 'run-one' }));
writeFileSync(join(dir, 'run-one.json'), JSON.stringify(artifact));
writeFileSync(join(dir, 'wrong-id.json'), JSON.stringify(artifact));
writeFileSync(join(dir, 'README.md'), '# not an artifact');
writeFileSync(join(dir, 'Upper.json'), '{}');

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ArtifactError ? e.reason : `not an ArtifactError: ${String(e)}`;
  }
  return undefined;
}

describe('the published store', () => {
  it('lists valid ids only, sorted', () => {
    expect(listArtifactIds(dir)).toEqual(['run-one', 'wrong-id']);
  });

  it('lists nothing from a directory that does not exist', () => {
    expect(listArtifactIds(join(dir, 'missing'))).toEqual([]);
  });

  it('loads an artifact by id', () => {
    expect(loadArtifact('run-one', dir)).toEqual(artifact);
  });

  it('refuses an id that is not a slug before touching the filesystem', () => {
    for (const id of ['../run-one', 'a/b', 'Upper']) {
      expect(reasonOf(() => artifactPath(id, dir)), id).toBe('not_found');
    }
  });

  it('says not_found for a missing id, and for a file holding a different id', () => {
    expect(reasonOf(() => loadArtifact('nope', dir))).toBe('not_found');
    expect(reasonOf(() => loadArtifact('wrong-id', dir))).toBe('not_found');
  });
});
