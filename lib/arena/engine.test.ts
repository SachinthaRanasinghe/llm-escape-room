import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/rng';
import { ArenaError, createArena, turnOrder, type Arena } from './engine';
import { BANK } from './questions/bank';
import { PLAYER_IDS, TOTAL_CORES, type PlayerId } from './schema';

const claim = { name: 'claim', intent: 'Take the free core.' };
const pass = { name: 'pass', intent: 'Wait it out.' };
const steal = (targetId: string) => ({ name: 'steal', targetId, intent: `Rob ${targetId}.` });
const answer = (text: string) => ({ name: 'answer', answer: text, intent: 'My answer.' });

function arena(maxRounds = 10): Arena {
  return createArena({ seed: 'engine-test', maxRounds });
}

/** Plays one turn for whoever is up: decide, then — if a question was drawn — answer it right or wrong. */
function turn(game: Arena, decision: unknown, right = true) {
  const { playerId } = game.current()!;
  const decided = game.decide(playerId, decision);
  if (decided.question === null) return { playerId, decided, answered: null };
  const answered = game.answer(playerId, answer(right ? decided.question.display : 'definitely wrong'));
  return { playerId, decided, answered };
}

function total(game: Arena): number {
  const { centre, cores } = game.snapshot();
  return centre + PLAYER_IDS.reduce((sum, id) => sum + cores[id], 0);
}

describe('opening and turn order', () => {
  it('starts with one core each and two in the centre', () => {
    const game = arena();
    expect(game.snapshot()).toEqual({
      round: 1,
      centre: 2,
      cores: { 'player-a': 1, 'player-b': 1, 'player-c': 1 },
      eliminated: { 'player-a': null, 'player-b': null, 'player-c': null },
    });
    expect(game.current()).toEqual({ round: 1, playerId: 'player-a', phase: 'decide' });
  });

  it('rotates who starts each round', () => {
    expect(turnOrder(1)).toEqual(['player-a', 'player-b', 'player-c']);
    expect(turnOrder(2)).toEqual(['player-b', 'player-c', 'player-a']);
    expect(turnOrder(3)).toEqual(['player-c', 'player-a', 'player-b']);
    expect(turnOrder(4)).toEqual(turnOrder(1));

    const game = arena();
    const seen: PlayerId[] = [];
    for (let i = 0; i < 9; i++) seen.push(turn(game, pass).playerId);
    expect(seen).toEqual([...turnOrder(1), ...turnOrder(2), ...turnOrder(3)]);
  });
});

describe('claim', () => {
  it('a correct medium answer moves a core from the centre', () => {
    const game = arena();
    const { decided, answered } = turn(game, claim);
    expect(decided.question!.tier).toBe('medium');
    expect(decided.verdict.message).not.toContain(decided.question!.display.length > 2 ? decided.question!.display : '\u0000');
    expect(answered!.outcome).toBe('claimed');
    expect(game.snapshot().cores['player-a']).toBe(2);
    expect(game.snapshot().centre).toBe(1);
    expect(game.tally('player-a')).toMatchObject({ claims: 1, correct: 1 });
  });

  it('a wrong answer wastes the turn and moves nothing', () => {
    const game = arena();
    const { answered } = turn(game, claim, false);
    expect(answered!.verdict.code).toBe('wrong_answer');
    expect(answered!.outcome).toBe('failed');
    expect(answered!.verdict.message).not.toContain(answered!.expected);
    expect(game.snapshot().centre).toBe(2);
    expect(game.tally('player-a')).toMatchObject({ wrong: 1, invalid: 0 });
    expect(game.current()!.playerId).toBe('player-b');
  });

  it('is not permitted once the centre is empty', () => {
    const game = arena();
    turn(game, claim);
    turn(game, claim);
    const { decided } = turn(game, claim);
    expect(decided.verdict.code).toBe('not_permitted');
    expect(decided.outcome).toBe('wasted');
    expect(game.tally('player-c').invalid).toBe(1);
  });
});

describe('steal', () => {
  it('a correct hard answer moves a core between players and eliminates on the last one', () => {
    const game = arena();
    const { decided, answered } = turn(game, steal('player-b'));
    expect(decided.question!.tier).toBe('hard');
    expect(answered!.outcome).toBe('stole');
    expect(answered!.eliminated).toBe('player-b');
    expect(game.snapshot().eliminated['player-b']).toBe(1);
    // player-b is skipped.
    expect(game.current()!.playerId).toBe('player-c');
  });

  it('a wrong answer leaves the target alone', () => {
    const game = arena();
    turn(game, steal('player-c'), false);
    expect(game.snapshot().cores['player-c']).toBe(1);
  });

  it.each([
    ['yourself', 'player-a'],
    ['an unknown id', 'player-d'],
    ['a display name', 'Player B'],
  ])('is not permitted against %s', (_, target) => {
    const game = arena();
    const { decided } = turn(game, steal(target));
    expect(decided.verdict.code).toBe('not_permitted');
    expect(decided.question).toBeNull();
  });

  it('is not permitted against an eliminated player', () => {
    const game = arena();
    turn(game, steal('player-b'));
    const { decided } = turn(game, steal('player-b'));
    expect(decided.verdict.code).toBe('not_permitted');
    expect(decided.verdict.message).toContain('eliminated');
  });
});

describe('malformed calls cost the turn', () => {
  it.each([null, [claim, pass], { name: 'claim' }, { ...claim, extra: 1 }, { name: 'answer', answer: '1', intent: 'x' }])(
    'decide(%j) is malformed',
    (raw) => {
      const game = arena();
      const result = game.decide('player-a', raw);
      expect(result.verdict.code).toBe('malformed');
      expect(result.outcome).toBe('wasted');
      expect(game.tally('player-a').invalid).toBe(1);
      expect(game.current()!.playerId).toBe('player-b');
    },
  );

  it('a malformed answer fails the action and counts invalid, not wrong', () => {
    const game = arena();
    game.decide('player-a', claim);
    const result = game.answer('player-a', { name: 'answer', intent: 'no answer field' });
    expect(result.verdict.code).toBe('malformed');
    expect(result.outcome).toBe('failed');
    expect(game.tally('player-a')).toMatchObject({ invalid: 1, wrong: 0 });
    expect(game.snapshot().centre).toBe(2);
  });

  it('a pass is legal play, counted as neither failed nor invalid', () => {
    const game = arena();
    turn(game, pass);
    expect(game.tally('player-a')).toMatchObject({ passes: 1, invalid: 0, wrong: 0 });
  });
});

describe('the end', () => {
  it('ends the moment one player is left, mid-round', () => {
    const game = arena();
    turn(game, steal('player-b'));
    expect(game.hasEnded()).toBe(false);
    // Every remaining turn is a successful steal from the other survivor, until one is alone.
    while (!game.hasEnded()) {
      const { playerId } = game.current()!;
      const target = PLAYER_IDS.find((id) => id !== playerId && game.snapshot().eliminated[id] === null)!;
      turn(game, steal(target));
    }
    expect(game.endedBecause()).toBe('last_standing');
    expect(PLAYER_IDS.filter((id) => game.snapshot().eliminated[id] === null)).toHaveLength(1);
    expect(game.current()).toBeNull();
  });

  it('ends after the last turn of the last round', () => {
    const game = arena(2);
    for (let i = 0; i < 5; i++) turn(game, pass);
    expect(game.hasEnded()).toBe(false);
    turn(game, pass);
    expect(game.endedBecause()).toBe('round_cap');
    expect(game.snapshot().round).toBe(2);
  });

  it('can be stopped for time between turns, not mid-question', () => {
    const game = arena();
    game.decide('player-a', claim);
    expect(() => game.stopForTime()).toThrow(ArenaError);
    game.answer('player-a', answer('x'));
    game.stopForTime();
    expect(game.endedBecause()).toBe('time_cap');
  });
});

describe('protocol misuse is the caller\'s bug', () => {
  it('throws for out-of-turn calls, answering without a question, and acting after the end', () => {
    const game = arena(1);
    expect(() => game.decide('player-b', pass)).toThrow(ArenaError);
    expect(() => game.answer('player-a', answer('1'))).toThrow(ArenaError);
    game.decide('player-a', claim);
    expect(() => game.decide('player-a', pass)).toThrow(ArenaError);
    game.answer('player-a', answer('1'));
    turn(game, pass);
    turn(game, pass);
    expect(game.hasEnded()).toBe(true);
    expect(() => game.decide('player-a', pass)).toThrow(ArenaError);
  });

  it('refuses a non-positive round cap', () => {
    expect(() => createArena({ seed: 's', maxRounds: 0 })).toThrow(RangeError);
  });
});

describe('invariants under a long random game', () => {
  it('conserves the five cores and never lets an eliminated player act', () => {
    const rng = createRng('engine-property');
    const inputs = [claim, pass, steal('player-a'), steal('player-b'), steal('player-c'), steal('nobody'), null, { name: 'claim' }];
    let games = 0;
    let turns = 0;
    while (turns < 500) {
      const game = createArena({ seed: `property-${games++}`, maxRounds: 10 });
      while (!game.hasEnded()) {
        const { playerId } = game.current()!;
        expect(game.snapshot().eliminated[playerId]).toBeNull();
        const decided = game.decide(playerId, rng.pick(inputs));
        expect(total(game)).toBe(TOTAL_CORES);
        if (decided.question !== null) {
          game.answer(playerId, rng.next() < 0.5 ? answer(decided.question.display) : rng.next() < 0.5 ? answer('nope') : null);
          expect(total(game)).toBe(TOTAL_CORES);
        }
        turns += 1;
      }
      const alive = PLAYER_IDS.filter((id) => game.snapshot().eliminated[id] === null);
      for (const id of PLAYER_IDS) expect(game.snapshot().cores[id] === 0).toBe(!alive.includes(id));
    }
  });
});

describe('secrecy', () => {
  it('no observation ever carries an answer key', () => {
    const game = arena();
    game.decide('player-a', claim);
    const views = PLAYER_IDS.map((id) => JSON.stringify(game.observe(id)));
    const pending = game.observe('player-a').pending!;
    const question = BANK.find((q) => q.id === pending.question.id)!;
    for (const view of views) {
      expect(view).not.toContain('"key"');
      expect(view).not.toContain('"display"');
    }
    // Only the answering player sees the question.
    expect(views[0]).toContain(question.prompt.slice(0, 20).replace(/"/g, '\\"'));
    expect(game.observe('player-b').pending).toBeNull();
  });
});
