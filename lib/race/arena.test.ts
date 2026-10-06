import { describe, expect, it } from 'vitest';
import { BANK, PLAYER_IDS } from '@/lib/arena';
import { questionIn, strategyAdapter, type Move } from '@/lib/arena/testing';
import { PRICING } from '@/lib/harness';
import { ProviderError, type TurnRequest } from '@/lib/providers';
import { parseArenaRequest, runArena, type PreparedArena } from './arena';
import type { ArenaMessage } from './arena-wire';
import { RaceError, releaseLocalLock, takeLocalLock } from './index';

/**
 * The arena's server side without the network: request parsing, and `runArena`
 * driven by scripted adapters. The match itself is `runMatch`, tested in
 * `lib/arena`; the catalogue checks are `checkPicks`, shared with the race.
 */

const pick = (modelId: string) => ({ provider: 'groq', modelId });
const valid = { players: [pick('openai/gpt-oss-120b'), pick('openai/gpt-oss-20b'), pick('openai/gpt-oss-20b')], rounds: 10 };

function refusal(raw: unknown): RaceError {
  try {
    parseArenaRequest(raw);
  } catch (error) {
    if (error instanceof RaceError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('parseArenaRequest', () => {
  it('accepts three picks and a round count — the same model three times is a mirror match', () => {
    expect(parseArenaRequest(valid)).toEqual(valid);
  });

  it.each([
    ['two players', { ...valid, players: valid.players.slice(0, 2) }],
    ['four players', { ...valid, players: [...valid.players, pick('x')] }],
    ['too few rounds', { ...valid, rounds: 2 }],
    ['too many rounds', { ...valid, rounds: 11 }],
    ['a fractional round count', { ...valid, rounds: 4.5 }],
    ['a model id with a space', { ...valid, players: [pick('bad id'), valid.players[1], valid.players[2]] }],
    ['an unknown provider', { ...valid, players: [{ provider: 'openai', modelId: 'gpt' }, valid.players[1], valid.players[2]] }],
    ['an extra key', { ...valid, repeats: 1 }],
    ['no body', null],
  ])('refuses %s with a 400', (_, raw) => {
    expect(refusal(raw).status).toBe(400);
  });
});

const prepared: PreparedArena = { request: { ...parseArenaRequest(valid), rounds: 3 }, prices: PRICING };

function solve(request: TurnRequest): Move {
  const prompt = questionIn(request);
  return { rawAction: { name: 'answer', answer: BANK.find((q) => q.prompt === prompt)!.display, intent: 'Worked it out.' } };
}

function adapters(strategy: (request: TurnRequest, call: number) => Move | Error) {
  return (player: { id: string; provider: 'groq' | 'gemini' | 'openrouter'; modelId: string }) =>
    strategyAdapter(strategy, { provider: player.provider, modelId: player.modelId }).adapter;
}

async function collect(strategy: (request: TurnRequest, call: number) => Move | Error, abort = new AbortController()): Promise<ArenaMessage[]> {
  const messages: ArenaMessage[] = [];
  let t = Date.parse('2026-10-06T10:00:00.000Z');
  await runArena(prepared, (m) => messages.push(m), abort.signal, { persist: false, adapterFor: adapters(strategy), now: () => (t += 1000) });
  return messages;
}

describe('runArena', () => {
  it('streams started, then thinking and turn messages, then done — and releases the lock', async () => {
    expect(takeLocalLock()).toBe(true);
    const messages = await collect((request) => (questionIn(request) === null ? { rawAction: { name: 'claim', intent: 'Grab one.' } } : solve(request)));
    expect(messages[0]!.type).toBe('started');
    expect(messages.at(-1)!.type).toBe('done');
    const turns = messages.flatMap((m) => (m.type === 'turn' ? [m.turn] : []));
    expect(turns.slice(0, 2).map((t) => t.outcome)).toEqual(['claimed', 'claimed']);
    expect(turns[0]!.question!.prompt.length).toBeGreaterThan(10);
    expect(turns[0]!.correct).toBe(true);
    expect(turns[0]!.intent).toBe('Grab one.');
    expect(messages.filter((m) => m.type === 'thinking').length).toBeGreaterThan(turns.length);
    const done = messages.at(-1) as Extract<ArenaMessage, { type: 'done' }>;
    expect(done.savedTo).toBeNull();
    expect(done.result.winners.length).toBeGreaterThan(0);
    expect(done.result.standings.map((s) => s.playerId)).toEqual([...PLAYER_IDS]);
    expect(takeLocalLock()).toBe(true);
    releaseLocalLock();
  });

  it('withholds a turn whose intent carries a URL', async () => {
    const messages = await collect(() => ({ rawAction: { name: 'pass', intent: 'see https://example.com' } }));
    const turn = messages.find((m): m is Extract<ArenaMessage, { type: 'turn' }> => m.type === 'turn')!.turn;
    expect(turn.intent).toBeNull();
    expect(turn.decisionMessage).toMatch(/^Withheld/);
    expect(JSON.stringify(messages)).not.toContain('example.com');
  });

  it('ends a match a provider stopped with standings so far and no winner', async () => {
    const messages = await collect((_, call) => (call === 0 ? { rawAction: { name: 'pass', intent: 'Wait.' } } : new ProviderError('groq', 429, 2, 'rate limited')));
    const last = messages.at(-1)!;
    expect(last.type).toBe('error');
    const error = last as Extract<ArenaMessage, { type: 'error' }>;
    expect(error.message).toContain('No winner is named');
    expect(error.standings!.winners).toEqual([]);
    expect(error.standings!.standings.map((s) => s.cores)).toEqual([1, 1, 1]);
  });

  it('a cancelled match says so', async () => {
    const abort = new AbortController();
    abort.abort();
    const messages = await collect(() => ({ rawAction: { name: 'pass', intent: 'Wait.' } }), abort);
    const last = messages.at(-1) as Extract<ArenaMessage, { type: 'error' }>;
    expect(last.type).toBe('error');
    expect(last.message).toBe('Match cancelled. No winner is named.');
  });
});
