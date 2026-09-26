import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLeaks } from './scan';

describe('findLeaks', () => {
  it('finds nothing in the golden fixtures', () => {
    for (const file of ['logs/canonical-run.json', 'runs/canonical-run.json', 'rooms/valid/canonical-room.json']) {
      expect(findLeaks(readFileSync(join(process.cwd(), 'fixtures', file), 'utf8')), file).toEqual([]);
    }
  });

  it('finds each kind of leak', () => {
    const groq = `gsk_${'a'.repeat(24)}`;
    const gemini = `AIza${'B'.repeat(35)}`;
    expect(findLeaks('see http://example.org/x').map((l) => l.kind)).toEqual(['url']);
    expect(findLeaks('POST to api.groq.com').map((l) => l.kind)).toEqual(['endpoint']);
    expect(findLeaks('generativelanguage.googleapis.com').map((l) => l.kind)).toEqual(['endpoint']);
    expect(findLeaks(`{"k":"${groq}"}`).map((l) => l.kind)).toEqual(['key']);
    expect(findLeaks(`{"k":"${gemini}"}`).map((l) => l.kind)).toEqual(['key']);
    expect(findLeaks(`{"k":"AQ.${'Ab8_-'.repeat(8)}"}`).map((l) => l.kind)).toEqual(['key']);
    expect(findLeaks(`{"k":"sk-or-v1-${'0f'.repeat(32)}"}`).map((l) => l.kind)).toEqual(['key']);
    expect(findLeaks('POST to openrouter.ai').map((l) => l.kind)).toEqual(['endpoint']);
    expect(findLeaks('https://api.groq.com/openai').map((l) => l.kind).sort()).toEqual(['endpoint', 'url']);
  });

  it('never re-prints a whole key', () => {
    const groq = `gsk_${'SECRET'.repeat(5)}`;
    const [leak] = findLeaks(groq);
    expect(leak!.match).not.toContain('SECRETSECRET');
    expect(leak!.match.length).toBeLessThanOrEqual(9);
  });

  it('does not mistake a short gsk_ word for a key', () => {
    expect(findLeaks('the gsk_ prefix')).toEqual([]);
  });
});
