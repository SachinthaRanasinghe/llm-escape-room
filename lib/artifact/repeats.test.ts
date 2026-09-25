import { describe, expect, it } from 'vitest';
import { loadCanonicalRun } from '@/fixtures';
import type { Run } from '@/lib/schema/run';
import { buildArtifact } from './publish';
import { buildRepeatRecord, checkRepeats } from './repeats';
import { ArtifactError, parseArtifact, type PublishedArtifact } from './schema';
import { canonicalInput, repeatOf, withRepeats } from './testing';

const hero = loadCanonicalRun();
const A = (i: number) => repeatOf(hero, i, 10, null);
const B = (i: number) => repeatOf(hero, i, null, 12);

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ArtifactError ? e.reason : `not an ArtifactError: ${String(e)}`;
  }
  return undefined;
}

describe('buildRepeatRecord', () => {
  it('is all zeroes without repeats', () => {
    expect(buildRepeatRecord(hero, { runs: [], dropped: 0 })).toEqual({ completed: 0, dropped: 0, outcomes: [] });
  });

  it('counts outcomes from the runs, most common first, and carries the dropped count', () => {
    expect(buildRepeatRecord(hero, { runs: [B(1), A(2), A(3)], dropped: 1 })).toEqual({
      completed: 3,
      dropped: 1,
      outcomes: [
        { outcome: { kind: 'winner', competitorId: 'model-a' }, count: 2 },
        { outcome: { kind: 'winner', competitorId: 'model-b' }, count: 1 },
      ],
    });
  });

  it('refuses repeats that are not the same matchup', () => {
    const otherRoom: Run = { ...A(1), roomId: 'another-room' };
    const otherCompetitor: Run = {
      ...A(1),
      competitors: [hero.competitors[0]!, { ...hero.competitors[1]!, id: 'model-c' }],
    };
    const heroAgain: Run = { ...A(1), runId: hero.runId };
    for (const [name, runs] of [
      ['another room', [otherRoom]],
      ['another competitor', [otherCompetitor]],
      ["the hero's run id", [heroAgain]],
    ] as const) {
      expect(reasonOf(() => buildRepeatRecord(hero, { runs, dropped: 0 })), name).toBe('repeats_mismatch');
    }
  });

  it('refuses a dropped count that is not a count', () => {
    for (const dropped of [-1, 1.5, Number.NaN]) {
      expect(reasonOf(() => buildRepeatRecord(hero, { runs: [], dropped })), String(dropped)).toBe('repeats_mismatch');
    }
  });
});

describe('checkRepeats', () => {
  // The hero (model-a escaped, model-b did not) is typical of A, A, B.
  const artifact = buildArtifact(canonicalInput(withRepeats([A(1), A(2), B(3)])));

  function edited(edit: (a: PublishedArtifact) => void): PublishedArtifact {
    const copy = structuredClone(artifact);
    edit(copy);
    return copy;
  }

  it('passes an artifact built from real repeats', () => {
    expect(() => checkRepeats(artifact)).not.toThrow();
    expect(artifact.run.typicalOfRepeats).toBe(true);
  });

  it('refuses a block that disagrees with itself or with the verdict', () => {
    const broken: [string, PublishedArtifact][] = [
      ['counts do not sum to completed', edited((a) => (a.repeats.completed = 4))],
      [
        'an unknown winner',
        edited((a) => (a.repeats.outcomes[1]!.outcome = { kind: 'winner', competitorId: 'model-z' })),
      ],
      [
        'an outcome counted twice',
        edited((a) => (a.repeats.outcomes[1]!.outcome = { kind: 'winner', competitorId: 'model-a' })),
      ],
      ['a flipped verdict', edited((a) => (a.run.typicalOfRepeats = false))],
      ['no verdict despite repeats', edited((a) => (a.run.typicalOfRepeats = null))],
      [
        'typical with no repeats at all',
        edited((a) => {
          a.repeats = { completed: 0, dropped: 0, outcomes: [] };
          a.run.typicalOfRepeats = true;
        }),
      ],
    ];
    for (const [name, candidate] of broken) {
      expect(reasonOf(() => checkRepeats(candidate)), name).toBe('repeats_mismatch');
    }
  });

  it('is enforced by buildArtifact, not just available', () => {
    const lying = { ...canonicalInput(withRepeats([B(1), B(2)])), run: { ...hero, typicalOfRepeats: true } };
    expect(reasonOf(() => buildArtifact(lying))).toBe('repeats_mismatch');
  });
});

describe('an artifact with repeats', () => {
  it('round-trips through the schema', () => {
    const artifact = buildArtifact(canonicalInput(withRepeats([A(1), B(2), B(3)], 2)));
    expect(parseArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact);
    expect(artifact.run.typicalOfRepeats).toBe(false);
    expect(artifact.repeats).toMatchObject({ completed: 3, dropped: 2 });
  });
});
