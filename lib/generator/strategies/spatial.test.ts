import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/rng';
import { DIFFICULTY_RANGES, verifySpec } from '@/lib/solver';
import { keyRoom } from '@/lib/solver/key-rooms';
import { generateRoom } from '../generate';
import { proposalFromSpec, scriptedGenerationClient } from '../testing';
import { MAX_CHAIN_LENGTH } from './shared';
import { SPATIAL_EXAMPLE, createSpatialStrategy } from './spatial';

const spatial = createSpatialStrategy();
const seeds = Array.from({ length: 30 }, (_, i) => `spatial-${i}`);

describe('spatial brief', () => {
  it('is deterministic per seed', () => {
    for (const seed of seeds.slice(0, 5)) {
      expect(spatial.brief(createRng(seed))).toEqual(spatial.brief(createRng(seed)));
    }
  });

  it('varies across seeds', () => {
    const briefs = new Set(seeds.slice(0, 20).map((seed) => JSON.stringify(spatial.brief(createRng(seed)))));
    expect(briefs.size).toBeGreaterThanOrEqual(3);
  });

  it('is all keys, fits the band, and always has a decoy key', () => {
    for (const seed of seeds) {
      const brief = spatial.brief(createRng(seed));
      const { min, max } = DIFFICULTY_RANGES[brief.band];
      expect(2 * brief.chainLength).toBeGreaterThanOrEqual(min);
      expect(2 * brief.chainLength).toBeLessThanOrEqual(max);
      expect(brief.chainLength).toBeLessThanOrEqual(MAX_CHAIN_LENGTH);
      expect(brief.linkKinds).toEqual(Array(brief.chainLength).fill('key'));
      expect(brief.codeWidths).toEqual([]);
      expect(brief.finalAnswerDomain).toBeNull();
      expect(brief.decoyKeys).toBeGreaterThanOrEqual(1);
    }
  });

  it('refuses hard with a reason', () => {
    expect(() => createSpatialStrategy({ band: 'hard' }).brief(createRng('x'))).toThrow(/hard.*chain cap/);
  });
});

describe('spatial prompt', () => {
  const brief = spatial.brief(createRng('prompt'));
  const prompt = spatial.prompt(brief, null);

  it('names the chain length, the key lock shape and the decoy key count', () => {
    expect(prompt).toContain(`Exactly ${brief.chainLength} puzzles`);
    expect(prompt).toContain('"keyItemId"');
    expect(prompt).toContain(`Exactly ${brief.decoyKeys} decoy key(s)`);
    expect(prompt).toContain(brief.themeHint);
  });

  it('asks for no code and no spoken answer', () => {
    expect(prompt).not.toMatch(/"kind": "code"/);
    expect(prompt).not.toMatch(/"kind": "answer"/);
  });

  it('says JSON, which Groq JSON mode requires', () => {
    expect(prompt).toMatch(/JSON/);
    expect(spatial.system()).toMatch(/JSON/);
  });

  it('is byte-identical for the same seed on the first attempt', () => {
    expect(spatial.prompt(spatial.brief(createRng('prompt')), null)).toBe(prompt);
  });

  it('appends feedback only when there is some', () => {
    const withFeedback = spatial.prompt(brief, { lines: ['lock_mismatch: p1'] });
    expect(withFeedback.startsWith(prompt)).toBe(true);
    expect(withFeedback).toContain('- lock_mismatch: p1');
  });
});

describe('spatial end to end, against a scripted model and the real solver', () => {
  it('shows the model an example that itself certifies — never a broken shape to copy', () => {
    const narrowed = spatial.narrow(SPATIAL_EXAMPLE, { seed: 'e', roomId: 'example', band: 'easy' });
    if (!narrowed.ok) throw new Error(narrowed.issues.join('; '));
    expect(verifySpec(narrowed.spec).ok).toBe(true);
  });

  it('narrows and certifies a key chain of the shape it asks for', () => {
    const narrowed = spatial.narrow(proposalFromSpec(keyRoom()), { seed: 's', roomId: 'spatial-s', band: 'standard' });
    if (!narrowed.ok) throw new Error(narrowed.issues.join('; '));
    expect(verifySpec(narrowed.spec).ok).toBe(true);
  });

  it('accepts it through generateRoom and fingerprints every link as a key', async () => {
    const { client } = scriptedGenerationClient([JSON.stringify(proposalFromSpec(keyRoom()))]);
    const result = await generateRoom({ client, strategy: spatial, seed: 'spatial-e2e' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fingerprint.strategy).toBe('spatial');
    expect(result.fingerprint.puzzleKinds.every((k) => k === 'key')).toBe(true);
    expect(result.record.brief.linkKinds.every((k) => k === 'key')).toBe(true);
  });
});
