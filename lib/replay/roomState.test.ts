import { describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { buildSceneLayout } from './layout';
import { laneStateAt } from './roomState';
import { beat, lane, layoutFixture } from './testing';
import { buildReplay } from './timeline';

const layout = buildSceneLayout(loadCanonicalRoom());
const data = buildReplay({ log: loadCanonicalLog(), run: loadCanonicalRun(), layout });
const [a, b] = data.lanes;

describe('laneStateAt on the golden fixtures', () => {
  it('shows model-a escaped once its last verdict lands, and not a moment before', () => {
    const end = laneStateAt(a, layout, a.beats.length - 1, true);
    expect(end.escaped).toBe(true);
    for (const id of ['desk', 'wall-safe', 'cabinet', 'door']) expect(end.opened).toContain(id);
    expect(end.held).toContain('ledger');
    expect(end.unlocked).toEqual(['cabinet', 'door', 'wall-safe']);
    expect(laneStateAt(a, layout, a.beats.length - 1, false).escaped).toBe(false);
  });

  it('leaves model-b inside with the cabinet open', () => {
    const end = laneStateAt(b, layout, b.beats.length - 1, true);
    expect(end.escaped).toBe(false);
    expect(end.opened).toContain('cabinet');
    expect(end.opened).not.toContain('door');
  });

  it('is empty before the first beat lands', () => {
    expect(laneStateAt(a, layout, -1, true)).toEqual({ opened: [], unlocked: [], held: [], escaped: false });
    expect(laneStateAt(a, layout, 0, false)).toEqual({ opened: [], unlocked: [], held: [], escaped: false });
  });
});

describe('laneStateAt ignores what did not happen', () => {
  const lay = layoutFixture();

  it('does not open a locked safe', () => {
    const l = lane(1, {
      beats: [beat({ verb: 'open', targetId: 'safe', verdict: { ok: false, code: 'locked', message: 'No.' } })],
    });
    expect(laneStateAt(l, lay, 0, true).opened).toEqual([]);
  });

  it('does nothing for an object that does not exist', () => {
    const l = lane(1, { beats: [beat({ verb: 'open', targetId: null, rawTargetId: 'bookshelf' })] });
    expect(laneStateAt(l, lay, 0, true)).toEqual({ opened: [], unlocked: [], held: [], escaped: false });
  });

  it('escapes on a key used on the exit', () => {
    const l = lane(1, { beats: [beat({ verb: 'use', heldItemId: 'key', targetId: 'door' })] });
    expect(laneStateAt(l, lay, 0, true)).toMatchObject({ escaped: true, opened: ['door'], unlocked: ['door'] });
  });

  it('trusts the run when it says the lane escaped', () => {
    const l = lane(2, { escaped: true, endedBecause: 'escaped' });
    expect(laneStateAt(l, lay, 1, true).escaped).toBe(true);
    expect(laneStateAt(l, lay, 0, true).escaped).toBe(false);
  });
});
