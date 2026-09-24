import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/rng';
import { ANSWER_DOMAINS, DIFFICULTY_RANGES, verifySpec } from '@/lib/solver';
import { mixedRoom } from '@/lib/solver/key-rooms';
import { generateRoom } from '../generate';
import { proposalFromSpec, scriptedGenerationClient } from '../testing';
import { createMixedStrategy } from './mixed';

const mixed = createMixedStrategy();
const seeds = Array.from({ length: 50 }, (_, i) => `mixed-${i}`);

describe('mixed brief', () => {
  it('is deterministic per seed', () => {
    for (const seed of seeds.slice(0, 5)) {
      expect(mixed.brief(createRng(seed))).toEqual(mixed.brief(createRng(seed)));
    }
  });

  it('ends on a spoken answer, with one code width per code link, inside the band', () => {
    for (const seed of seeds) {
      const brief = mixed.brief(createRng(seed));
      const { min, max } = DIFFICULTY_RANGES[brief.band];
      expect(2 * brief.chainLength).toBeGreaterThanOrEqual(min);
      expect(2 * brief.chainLength).toBeLessThanOrEqual(max);
      expect(brief.linkKinds).toHaveLength(brief.chainLength);
      expect(brief.linkKinds.at(-1)).toBe('answer');
      expect(brief.codeWidths).toHaveLength(brief.linkKinds.filter((k) => k === 'code').length);
      expect(Object.keys(ANSWER_DOMAINS)).toContain(brief.finalAnswerDomain);
    }
  });

  it('is genuinely mixed: with two or more links before the answer, never all codes or all keys', () => {
    for (const seed of seeds) {
      const nonFinal = mixed.brief(createRng(seed)).linkKinds.slice(0, -1);
      expect(nonFinal.length).toBeGreaterThanOrEqual(2); // standard → chains of 3 or 4
      expect(nonFinal).toContain('code');
      expect(nonFinal).toContain('key');
    }
  });

  it('serves easy with a two-link chain, and refuses hard with a reason', () => {
    const easy = createMixedStrategy({ band: 'easy' }).brief(createRng('easy'));
    expect(easy.chainLength).toBe(2);
    expect(() => createMixedStrategy({ band: 'hard' }).brief(createRng('x'))).toThrow(/hard/);
  });
});

describe('mixed prompt', () => {
  const brief = mixed.brief(createRng('prompt'));
  const prompt = mixed.prompt(brief, null);

  it('states every link in order, both lock rules, and the final domain', () => {
    brief.linkKinds.slice(0, -1).forEach((kind, i) => {
      expect(prompt).toMatch(new RegExp(`puzzle p${i + 1}: .*"kind": "${kind}"`));
    });
    expect(prompt).toContain('"opensWith": "code"');
    expect(prompt).toContain('"keyItemId"');
    for (const word of ANSWER_DOMAINS[brief.finalAnswerDomain!]!) expect(prompt).toContain(word);
  });

  it('is byte-identical for the same seed on the first attempt', () => {
    expect(mixed.prompt(mixed.brief(createRng('prompt')), null)).toBe(prompt);
  });

  it('says JSON, which Groq JSON mode requires', () => {
    expect(prompt).toMatch(/JSON/);
    expect(mixed.system()).toMatch(/JSON/);
  });
});

describe('mixed end to end, against a scripted model and the real solver', () => {
  it('narrows and certifies a code → key → answer room', () => {
    const narrowed = mixed.narrow(proposalFromSpec(mixedRoom()), { seed: 'm', roomId: 'mixed-m', band: 'standard' });
    if (!narrowed.ok) throw new Error(narrowed.issues.join('; '));
    expect(verifySpec(narrowed.spec).ok).toBe(true);
  });

  it('accepts it through generateRoom and fingerprints the mix', async () => {
    const { client } = scriptedGenerationClient([JSON.stringify(proposalFromSpec(mixedRoom()))]);
    const result = await generateRoom({ client, strategy: mixed, seed: 'mixed-e2e' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fingerprint.strategy).toBe('mixed');
    expect(result.fingerprint.puzzleKinds).toEqual(['code', 'key', 'answer']);
  });
});
