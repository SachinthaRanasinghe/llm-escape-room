import { describe, expect, it } from 'vitest';
import { ProviderError, type TurnRequest } from '@/lib/providers';
import type { Competitor } from '@/lib/schema/run';
import { MatchAbortedError, runMatch, type MatchOptions } from './match';
import { BANK } from './questions/bank';
import { PLAYER_IDS, type PlayerId } from './schema';
import { questionIn, steppingClock, strategyAdapter, type Move } from './testing';
import { ANSWER_TOOLS, DECISION_TOOLS } from './tools';

const players: Competitor[] = PLAYER_IDS.map((id, i) => ({ id, provider: 'groq', modelId: `model-${i}`, params: { temperature: null, topP: null } }));

const pass: Move = { rawAction: { name: 'pass', intent: 'Wait.' } };
const claim: Move = { rawAction: { name: 'claim', intent: 'Free core.' } };
const steal = (targetId: string): Move => ({ rawAction: { name: 'steal', targetId, intent: `Rob ${targetId}.` } });

/** Answers whatever question it is shown with the bank's own answer. */
function solve(request: TurnRequest): Move {
  const prompt = questionIn(request);
  const question = BANK.find((q) => q.prompt === prompt);
  if (question === undefined) throw new Error('solve: no question in this request');
  return { rawAction: { name: 'answer', answer: question.display, intent: 'I worked it out.' } };
}

const wrong: Move = { rawAction: { name: 'answer', answer: 'no idea', intent: 'A guess.' } };

type Strategy = (request: TurnRequest, call: number) => Move | Error;

function setup(strategies: Record<PlayerId, Strategy>, extra: Partial<MatchOptions> = {}) {
  const built = PLAYER_IDS.map((id, i) => strategyAdapter(strategies[id], { provider: 'groq', modelId: `model-${i}` }));
  const options: MatchOptions = {
    matchId: 'arena-test',
    players,
    adapters: Object.fromEntries(PLAYER_IDS.map((id, i) => [id, built[i]!.adapter])),
    deps: steppingClock(),
    ...extra,
  };
  return { options, requests: Object.fromEntries(PLAYER_IDS.map((id, i) => [id, built[i]!.requests])) as Record<PlayerId, TurnRequest[]> };
}

/** Decides with `decide` on a decide call and answers with `answer` on an answer call. */
function play(decide: (request: TurnRequest) => Move, answer: (request: TurnRequest) => Move = solve): Strategy {
  return (request) => (questionIn(request) === null ? decide(request) : answer(request));
}

const passer = play(() => pass);

describe('runMatch', () => {
  it('plays all rounds when everyone passes, and calls three equal holdings a tie', async () => {
    const { options, requests } = setup({ 'player-a': passer, 'player-b': passer, 'player-c': passer });
    const { result, events, providerCalls } = await runMatch(options);
    expect(result.endedBecause).toBe('round_cap');
    expect(result.roundsPlayed).toBe(10);
    expect(events).toHaveLength(30);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(result.outcome).toBe('tie');
    expect(result.winners).toEqual([...PLAYER_IDS]);
    expect(providerCalls).toEqual({ 'player-a': 10, 'player-b': 10, 'player-c': 10 });
    for (const id of PLAYER_IDS) for (const request of requests[id]) expect(request.tools).toEqual(DECISION_TOOLS);
  });

  it('ends the moment one player is left, and names the winner', async () => {
    const hunter = play((request) => steal(/player-b: 1 core/.test(lastText(request)) ? 'player-b' : 'player-c'));
    const { options } = setup({ 'player-a': hunter, 'player-b': passer, 'player-c': passer });
    const { result, events } = await runMatch(options);
    expect(result.endedBecause).toBe('last_standing');
    expect(result.outcome).toBe('win');
    expect(result.winners).toEqual(['player-a']);
    // Round 1: a takes b's only core, c passes. Round 2 (b, c, a): b is skipped, c passes, a takes c's.
    expect(events.map((e) => `${e.playerId}:${e.outcome}`)).toEqual(['player-a:stole', 'player-c:passed', 'player-c:passed', 'player-a:stole']);
    const a = result.standings[0]!;
    expect(a).toMatchObject({ cores: 3, steals: 2, correct: 2, wrong: 0, invalid: 0 });
    expect(result.standings[1]!.eliminatedInRound).toBe(1);
    expect(result.standings[2]!.eliminatedInRound).toBe(2);
    expect(result.roundsPlayed).toBe(2);
  });

  it('offers the answer tools on the answer call, and shows a question only to the one answering it', async () => {
    const { options, requests } = setup({ 'player-a': play(() => claim), 'player-b': play(() => claim, () => wrong), 'player-c': passer });
    const { events } = await runMatch({ ...options, maxRounds: 1 });
    expect(events.map((e) => e.outcome)).toEqual(['claimed', 'failed', 'passed']);
    const answerCalls = requests['player-a'].filter((r) => questionIn(r) !== null);
    expect(answerCalls).toHaveLength(1);
    expect(answerCalls[0]!.tools).toEqual(ANSWER_TOOLS);
    const aQuestion = questionIn(answerCalls[0]!)!;
    for (const other of ['player-b', 'player-c'] as const) {
      expect(JSON.stringify(requests[other])).not.toContain(JSON.stringify(aQuestion).slice(1, 40));
    }
    // b was told what a did — by category and result only.
    const bFirst = requests['player-b'][0]!.transcript.at(-1)!;
    expect(bFirst.kind === 'user' && bFirst.text).toMatch(/player-a tried to claim a centre core \(medium \w+ question\): succeeded\./);
  });

  it('never sends an answer key back to a model', async () => {
    const { options, requests } = setup({ 'player-a': play(() => claim, () => wrong), 'player-b': play(() => steal('player-a'), () => wrong), 'player-c': passer });
    const { events } = await runMatch({ ...options, maxRounds: 3 });
    // A key that is one of the choices its own prompt offers ("knight or knave") is not a leak.
    const keys = events.flatMap((e) => {
      if (e.answer === null || e.answer.expected.length <= 3) return [];
      const prompt = BANK.find((q) => q.id === e.question!.id)!.prompt;
      return prompt.includes(e.answer.expected) ? [] : [e.answer.expected];
    });
    const said = JSON.stringify([...requests['player-a'], ...requests['player-b']].map((r) => r.transcript.filter((t) => t.kind !== 'tool_call')));
    for (const key of keys) expect(said).not.toContain(key);
  });

  it('keeps each conversation one call, one result', async () => {
    const { options, requests } = setup({ 'player-a': play(() => claim), 'player-b': play(() => steal('player-c'), () => wrong), 'player-c': passer });
    await runMatch({ ...options, maxRounds: 3 });
    for (const id of PLAYER_IDS) {
      for (const request of requests[id]) {
        const kinds = request.transcript.map((t) => t.kind);
        expect(kinds.at(-1)).not.toBe('tool_call');
        for (let i = 1; i < kinds.length; i++) expect(`${kinds[i - 1]}>${kinds[i]}`).not.toBe('user>user');
        kinds.forEach((kind, i) => {
          if (kind === 'tool_call') expect(kinds[i + 1]).toBe('tool_result');
        });
      }
    }
  });

  it('records a call with no tool as a wasted turn, with what the model sent', async () => {
    const mute: Strategy = () => ({ rawAction: null, anomaly: 'no_tool_call', toolCall: null, text: 'I would claim.' });
    const { options } = setup({ 'player-a': mute, 'player-b': passer, 'player-c': passer });
    const { events, result } = await runMatch({ ...options, maxRounds: 1 });
    expect(events[0]!.decision.action).toBeNull();
    expect(events[0]!.decision.rejected).toEqual({ kind: 'no_tool_call', raw: 'I would claim.', intent: null });
    expect(events[0]!.outcome).toBe('wasted');
    expect(result.standings[0]!.invalid).toBe(1);
  });

  it('aborts with the turns so far when a provider fails', async () => {
    const failing: Strategy = (request) => (questionIn(request) === null ? claim : new ProviderError('groq', 429, 3, 'rate limited'));
    const { options } = setup({ 'player-a': passer, 'player-b': failing, 'player-c': passer });
    const error = await runMatch(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MatchAbortedError);
    const aborted = error as MatchAbortedError;
    expect(aborted.playerId).toBe('player-b');
    expect(aborted.events).toHaveLength(1);
    expect(aborted.providerCalls).toBe(1 + 1 + 3);
  });

  it('stops when asked, before the next call', async () => {
    let stop = false;
    const { options } = setup({ 'player-a': passer, 'player-b': passer, 'player-c': passer }, { onEvent: () => void (stop = true), shouldStop: () => stop });
    const error = await runMatch(options).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MatchAbortedError);
    expect((error as MatchAbortedError).playerId).toBeNull();
    expect((error as MatchAbortedError).events).toHaveLength(1);
  });

  it('calls time between turns', async () => {
    const { options } = setup({ 'player-a': passer, 'player-b': passer, 'player-c': passer }, { maxWallClockMs: 5_000 });
    const { result, events } = await runMatch(options);
    expect(result.endedBecause).toBe('time_cap');
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(30);
  });

  it('survives a watcher that throws', async () => {
    const { options } = setup(
      { 'player-a': passer, 'player-b': passer, 'player-c': passer },
      {
        onEvent: () => {
          throw new Error('watcher broke');
        },
        onThinking: () => {
          throw new Error('watcher broke');
        },
      },
    );
    await expect(runMatch({ ...options, maxRounds: 1 })).resolves.toMatchObject({ result: { endedBecause: 'round_cap' } });
  });

  it('refuses a match that is not three named players with matching adapters', async () => {
    const { options } = setup({ 'player-a': passer, 'player-b': passer, 'player-c': passer });
    await expect(runMatch({ ...options, players: players.slice(0, 2) })).rejects.toThrow(RangeError);
    await expect(runMatch({ ...options, players: [{ ...players[0]!, id: 'model-a' }, players[1]!, players[2]!] })).rejects.toThrow(RangeError);
    await expect(runMatch({ ...options, players: [{ ...players[0]!, modelId: 'other' }, players[1]!, players[2]!] })).rejects.toThrow(RangeError);
  });
});

function lastText(request: TurnRequest): string {
  const last = request.transcript.at(-1);
  return last !== undefined && 'text' in last ? last.text : '';
}
