import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { ANSWER_DOMAINS, domainOf, membersOf, tokenize } from './lexicon';

describe('tokenize', () => {
  it('lowercases and splits on whitespace', () => {
    expect(tokenize('Departed To The North')).toEqual(['departed', 'to', 'the', 'north']);
  });

  it('strips trailing punctuation from a token', () => {
    expect(tokenize('to the north.')).toEqual(['to', 'the', 'north']);
  });

  it('strips the quotation marks the canonical clues are written with', () => {
    expect(tokenize('closes: "departed, as always, to the north."')).toContain('north');
  });

  it('keeps digit runs as tokens', () => {
    expect(tokenize('The final column totals 4471.')).toContain('4471');
  });

  it('does not find a token inside a longer word', () => {
    // The whole reason this is a split rather than String.includes.
    expect(tokenize('the northern wall')).not.toContain('north');
    expect(tokenize('the northern wall')).toContain('northern');
  });

  it('drops empty tokens from runs of punctuation', () => {
    expect(tokenize('a -- b')).toEqual(['a', 'b']);
  });

  it('returns nothing for text with no letters or digits', () => {
    expect(tokenize('—  ... !')).toEqual([]);
  });
});

describe('domainOf', () => {
  it('claims a direction', () => {
    expect(domainOf('north')).toBe('direction');
  });

  it('claims a colour', () => {
    expect(domainOf('red')).toBe('colour');
  });

  it('normalises case and surrounding whitespace, exactly as resolve.ts does', () => {
    expect(domainOf('  North ')).toBe('direction');
  });

  it('returns null for a code, which has no prose domain', () => {
    expect(domainOf('4471')).toBeNull();
  });

  it('returns null for a word no domain claims', () => {
    expect(domainOf('departed')).toBeNull();
  });
});

describe('the domain table', () => {
  it('holds only lowercase members', () => {
    for (const [domain, members] of Object.entries(ANSWER_DOMAINS)) {
      for (const member of members) {
        expect(member, `${domain}.${member}`).toBe(member.toLowerCase());
      }
    }
  });

  it('holds no duplicate within a domain', () => {
    for (const [domain, members] of Object.entries(ANSWER_DOMAINS)) {
      expect(new Set(members).size, domain).toBe(members.length);
    }
  });

  it('never puts one word in two domains', () => {
    // domainOf returns ONE domain, and derivation.ts scans only that domain for
    // competitors. A word in two domains would make which competitors get
    // checked depend on object key order.
    const seen = new Map<string, string>();
    for (const [domain, members] of Object.entries(ANSWER_DOMAINS)) {
      for (const member of members) {
        expect(seen.get(member), `${member} is in both ${seen.get(member)} and ${domain}`).toBeUndefined();
        seen.set(member, domain);
      }
    }
  });

  it('exposes members through membersOf', () => {
    expect(membersOf('direction')).toContain('south');
  });
});

describe('the lexicon against the committed corpus', () => {
  it("finds exactly one direction in the canonical room's final clue", () => {
    // The calibration that keeps the lexicon honest: if a future addition makes
    // this clue yield two directions, the canonical room stops certifying.
    const room = loadCanonicalRoom();
    const logbook = room.objects.find((o) => o.id === 'logbook')!;
    const tokens = new Set(tokenize(logbook.clueText!));
    const found = membersOf('direction').filter((d) => tokens.has(d));
    expect(found).toEqual(['north']);
  });

  it('finds no colour in that clue', () => {
    const room = loadCanonicalRoom();
    const logbook = room.objects.find((o) => o.id === 'logbook')!;
    const tokens = new Set(tokenize(logbook.clueText!));
    expect(membersOf('colour').filter((c) => tokens.has(c))).toEqual([]);
  });
});
