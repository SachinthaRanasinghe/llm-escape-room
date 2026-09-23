import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { compileRoom, observe } from '@/lib/sim';
import { SYSTEM_PROMPT, noActionText, openingMessage, verdictText } from './prompt';

const room = loadCanonicalRoom();
const obs = observe(compileRoom(room), 14);
const verdict = { ok: false, code: 'locked', message: 'The safe does not budge.' } as const;

/** Every string a model must earn by playing: answers, lock codes and clue text. */
const SECRETS = [
  ...room.puzzles.map((p) => p.answer),
  ...room.objects.flatMap((o) => (o.lock?.opensWith === 'code' ? [o.lock.code] : [])),
  ...room.objects.map((o) => o.clueText),
];

describe('openingMessage', () => {
  it('names every visible object by id', () => {
    const text = openingMessage(obs);
    for (const object of obs.visible) expect(text).toContain(`[${object.id}]`);
    expect(text).toContain('Actions remaining: 14');
  });

  it('leaks no answer, code or clue', () => {
    const text = openingMessage(obs);
    for (const secret of SECRETS) expect(text, `leaked "${secret}"`).not.toContain(secret);
  });
});

describe('the prompt is the same words for every model', () => {
  it('is byte-identical across calls', () => {
    expect(openingMessage(obs)).toBe(openingMessage(observe(compileRoom(room), 14)));
    expect(verdictText(verdict, obs)).toBe(verdictText({ ...verdict }, obs));
  });

  it('asks for an intent in the system prompt', () => {
    expect(SYSTEM_PROMPT).toContain('intent');
  });

  it('passes the verdict message through verbatim and reminds on a no-action turn', () => {
    expect(verdictText(verdict, obs)).toBe('The safe does not budge.\nActions remaining: 14');
    expect(noActionText(verdict, obs)).toContain('Act by calling exactly one tool.');
  });
});

describe('prompt.ts cannot see the room', () => {
  it('does not import the room schema', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prompt.ts'), 'utf8');
    expect(source).not.toMatch(/RoomSpec|RoomState|schema\/room/);
  });
});
