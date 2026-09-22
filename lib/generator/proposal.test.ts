import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { narrowProposal } from './proposal';
import { proposalFromSpec } from './testing';
import type { Stamp } from './types';

const canonical = loadCanonicalRoom();
const stamp: Stamp = { seed: canonical.seed, roomId: canonical.roomId, band: canonical.difficulty.band };

/** A fresh, mutable copy of the canonical room as a model would send it. */
function proposal(): any {
  return JSON.parse(JSON.stringify(proposalFromSpec(canonical)));
}

describe('narrowProposal', () => {
  it('round-trips the canonical room exactly', () => {
    const result = narrowProposal(proposal(), stamp);
    expect(result).toEqual({ ok: true, spec: canonical });
  });

  it('reads absent lock, contains and clueText as null, [] and null', () => {
    const p = proposal();
    const window = p.objects.find((o: any) => o.id === 'window');
    delete window.lock;
    delete window.contains;
    delete window.clueText;
    const result = narrowProposal(p, stamp);
    if (!result.ok) throw new Error(result.issues.join('; '));
    expect(result.spec.objects.find((o) => o.id === 'window')).toMatchObject({ lock: null, contains: [], clueText: null });
  });

  it('reads an empty clueText as null', () => {
    const p = proposal();
    p.objects.find((o: any) => o.id === 'window').clueText = '   ';
    const result = narrowProposal(p, stamp);
    expect(result.ok && result.spec.objects.find((o) => o.id === 'window')!.clueText).toBeNull();
  });

  it('coerces numeric answers and codes to strings', () => {
    const p = proposal();
    p.puzzles[0].answer = 4471;
    p.objects.find((o: any) => o.id === 'wall-safe').lock = { opensWith: 'code', code: 4471 };
    const result = narrowProposal(p, stamp);
    if (!result.ok) throw new Error(result.issues.join('; '));
    expect(result.spec).toEqual(canonical);
  });

  it('keeps a leading-zero code that arrives as a string', () => {
    const p = proposal();
    p.puzzles[0].answer = '0471';
    const result = narrowProposal(p, stamp);
    expect(result.ok && result.spec.puzzles[0]!.answer).toBe('0471');
  });

  it('derives order from array position and solution from order when absent', () => {
    const p = proposal();
    for (const puzzle of p.puzzles) delete puzzle.order;
    delete p.solutionOrder;
    const result = narrowProposal(p, stamp);
    expect(result).toEqual({ ok: true, spec: canonical });
  });

  it('strips keys a chatty model adds', () => {
    const p = proposal();
    p.notes = 'I made the safe tricky.';
    p.objects[0].mood = 'dusty';
    expect(narrowProposal(p, stamp)).toEqual({ ok: true, spec: canonical });
  });

  it('ignores stamped fields a model volunteers, in favour of the stamp', () => {
    const p = proposal();
    Object.assign(p, { specVersion: 1, seed: 'model-seed', roomId: 'model-room', band: 'hard' });
    const result = narrowProposal(p, { seed: 's', roomId: 'r', band: 'standard' });
    if (!result.ok) throw new Error(result.issues.join('; '));
    expect(result.spec).toMatchObject({ specVersion: 0, seed: 's', roomId: 'r', difficulty: { band: 'standard' } });
  });

  it('trims strings', () => {
    const p = proposal();
    p.theme.name = '  The Cartographer\'s Study  ';
    expect(narrowProposal(p, stamp)).toEqual({ ok: true, spec: canonical });
  });

  it('refuses a missing theme, naming it, and never throws', () => {
    const p = proposal();
    delete p.theme;
    const result = narrowProposal(p, stamp);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join('\n')).toMatch(/^theme/m);
  });

  it('refuses non-objects without throwing', () => {
    for (const junk of [null, 42, 'room', [], { theme: 1 }]) {
      expect(narrowProposal(junk, stamp).ok).toBe(false);
    }
  });

  it('caps the issue list so feedback stays short', () => {
    const p = proposal();
    p.objects = p.objects.map(() => ({ id: '' }));
    const result = narrowProposal(p, stamp);
    expect(!result.ok && result.issues.length).toBeLessThanOrEqual(10);
  });
});
