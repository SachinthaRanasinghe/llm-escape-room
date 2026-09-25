import { describe, expect, it } from 'vitest';
import { loadCanonicalRun } from '@/fixtures';
import { comparisonFromArtifact } from './comparison';
import { buildArtifact } from './publish';
import { loadArtifact } from './store';
import { canonicalInput, repeatOf, withRepeats } from './testing';

describe('comparisonFromArtifact', () => {
  it('reads the committed canonical artifact into the canonical comparison', () => {
    const data = comparisonFromArtifact(loadArtifact('canonical'));
    expect(data.headline).toBe('competitor-a wins — escaped in 13 actions');
    expect(data.rows.map((r) => [r.competitorId, r.result, r.actions, r.puzzles, r.invalidActions])).toEqual([
      ['model-a', 'Escaped in 13 actions', '13 / 14', '3 of 3', 0],
      ['model-b', 'Out of actions', '14 / 14', '2 of 3', 1],
    ]);
    expect(data.variance.kind).toBe('unrepeated');
  });

  it('discloses the repeats an artifact was published with', () => {
    const hero = loadCanonicalRun();
    const typical = buildArtifact(canonicalInput(withRepeats([repeatOf(hero, 1, 10, null), repeatOf(hero, 2, 10, null)])));
    expect(comparisonFromArtifact(typical).variance.kind).toBe('typical');

    const atypical = buildArtifact(canonicalInput(withRepeats([repeatOf(hero, 1, null, 9)], 1)));
    const variance = comparisonFromArtifact(atypical).variance;
    expect(variance.kind).toBe('atypical');
    expect(variance.body).toContain('competitor-b won in 1 of 1');
    expect(variance.body).toContain('1 more re-run stopped on a provider error and is not counted.');
  });
});
