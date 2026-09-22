import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom } from '@/fixtures';
import { compileRoom, withHeld, withOpened, withSolved, withUnlocked } from './state';
import { describeRoom, observe } from './observation';

const room = loadCanonicalRoom();
const fresh = compileRoom(room);

/** Every secret the canonical room holds, taken from the spec rather than hard-coded. */
const SECRETS = [
  ...room.objects.flatMap((o) => (o.lock?.opensWith === 'code' ? [o.lock.code] : [])),
  ...room.puzzles.map((p) => p.answer),
];

describe('observe', () => {
  it('shows the reachable top-level objects', () => {
    expect(observe(fresh, 14).visible.map((o) => o.id)).toEqual(['desk', 'wall-safe', 'cabinet', 'door', 'window']);
  });

  it('does not show an object sealed inside a locked container', () => {
    const ids = observe(fresh, 14).visible.map((o) => o.id);
    expect(ids).not.toContain('sea-chart');
    expect(ids).not.toContain('logbook');
  });

  it('does not show the contents of an unlocked container either — open names those', () => {
    expect(observe(fresh, 14).visible.map((o) => o.id)).not.toContain('ledger');
  });

  it('reports lock state without reporting how the lock opens', () => {
    const safe = observe(fresh, 14).visible.find((o) => o.id === 'wall-safe');
    expect(safe?.locked).toBe(true);
    expect(JSON.stringify(safe)).not.toContain('4471');
  });

  it('reports a lock as open once it is unlocked', () => {
    const state = withUnlocked(fresh, 'wall-safe');
    expect(observe(state, 14).visible.find((o) => o.id === 'wall-safe')?.locked).toBe(false);
  });

  it('reports what has been opened', () => {
    const state = withOpened(fresh, 'desk');
    expect(observe(state, 14).visible.find((o) => o.id === 'desk')?.opened).toBe(true);
  });

  it('lists what the competitor is carrying', () => {
    const state = withHeld(fresh, 'ledger');
    expect(observe(state, 14).held).toEqual([{ id: 'ledger', name: 'accounts ledger' }]);
  });

  it('counts solved puzzles and passes the remaining action budget through', () => {
    const state = withSolved(withSolved(fresh, 'p1'), 'p2');
    const seen = observe(state, 6);
    expect(seen.puzzlesSolved).toBe(2);
    expect(seen.actionsRemaining).toBe(6);
  });

  /**
   * The load-bearing one. `clueText` is not a field of `VisibleObject` at all, so
   * this asserts the whole class of leak rather than one instance of it: no clue,
   * no code and no answer can be read out of an observation, whatever the room.
   */
  it('carries no clue text, no lock code and no puzzle answer', () => {
    const serialised = JSON.stringify(observe(fresh, 14));
    for (const secret of SECRETS) {
      expect(serialised).not.toContain(secret);
    }
    for (const object of room.objects) {
      if (object.clueText !== null) expect(serialised).not.toContain(object.clueText);
    }
  });
});

describe('describeRoom', () => {
  it('names every visible object in one sentence', () => {
    const prose = describeRoom(fresh);
    expect(prose).toContain('writing desk');
    expect(prose).toContain('wall safe');
    expect(prose).toContain('map cabinet');
    expect(prose).toContain('studded door');
    expect(prose).toContain('shuttered window');
  });

  it('mentions nothing that is out of reach', () => {
    const prose = describeRoom(fresh);
    expect(prose).not.toContain('sea chart');
    expect(prose).not.toContain('logbook');
  });

  it('mentions what is being carried', () => {
    expect(describeRoom(withHeld(fresh, 'ledger'))).toContain('carrying accounts ledger');
  });

  it('leaks no secret', () => {
    const prose = describeRoom(withUnlocked(fresh, 'wall-safe'));
    for (const secret of SECRETS) {
      expect(prose).not.toContain(secret);
    }
  });
});
