import type { ArenaTurnView, Cores } from '@/lib/race/arena-wire';

/**
 * How one turn is played back on screen — pure, no React, no canvas.
 *
 * A turn reaches the page whole (decide + answer already judged), so the page
 * re-tells it as a short sequence of beats: lock on, show the challenge, reveal
 * the answer, stamp the verdict, then move the core. The board only changes at
 * `execute`; until then it shows the holdings before the turn, so a viewer never
 * sees a result before the question that earned it.
 */

export type PlayerId = keyof Cores;
export type Owner = PlayerId | 'centre';

export type Beat = 'lock' | 'challenge' | 'answer' | 'verdict' | 'execute' | 'eliminate';

export interface Step {
  readonly beat: Beat;
  readonly ms: number;
}

/** The order beats come in; a turn's timeline is always a prefix-respecting subset. */
export const BEAT_ORDER: readonly Beat[] = ['lock', 'challenge', 'answer', 'verdict', 'execute', 'eliminate'];

export function timeline(turn: ArenaTurnView): Step[] {
  if (turn.action === 'pass') return [{ beat: 'lock', ms: 1600 }];
  if (turn.action === 'invalid') return [{ beat: 'lock', ms: 2000 }];
  if (turn.question === null) return [{ beat: 'lock', ms: 1600 }];

  const read = Math.min(5200, Math.max(2400, 1600 + turn.question.prompt.length * 14));
  const worked = turn.outcome === 'claimed' || turn.outcome === 'stole';
  const steps: Step[] = [
    { beat: 'lock', ms: 1300 },
    { beat: 'challenge', ms: read },
    { beat: 'answer', ms: 1500 },
    { beat: 'verdict', ms: 1300 },
    { beat: 'execute', ms: worked ? 1900 : 1000 },
  ];
  if (turn.eliminated !== null) steps.push({ beat: 'eliminate', ms: 2800 });
  return steps;
}

/** True once playback of the current turn has reached (or passed) `beat`. */
export function reached(current: Beat | null, beat: Beat): boolean {
  return current !== null && BEAT_ORDER.indexOf(current) >= BEAT_ORDER.indexOf(beat);
}

/** Speeds playback up when turns are waiting behind the one on screen. */
export function paceFor(backlog: number): number {
  if (backlog >= 3) return 0.3;
  if (backlog >= 1) return 0.6;
  return 1;
}

/** The opening: one core per base, two in the centre. */
export const OPENING_OWNERS: readonly Owner[] = ['player-a', 'player-b', 'player-c', 'centre', 'centre'];

/**
 * Reassigns the five cores to match the counts, moving as few as possible:
 * every owner keeps the cores it already had, up to its new count, and only the
 * surplus moves to whoever is short — so a steal flies exactly one core.
 */
export function reassign(previous: readonly Owner[], cores: Cores, centre: number): Owner[] {
  const want: Record<Owner, number> = { ...cores, centre };
  const kept: Record<Owner, number> = { 'player-a': 0, 'player-b': 0, 'player-c': 0, centre: 0 };
  const next: (Owner | null)[] = previous.map((owner) => {
    if (kept[owner] < want[owner]) {
      kept[owner] += 1;
      return owner;
    }
    return null;
  });
  const short: Owner[] = (Object.keys(want) as Owner[]).flatMap((owner) => Array.from({ length: Math.max(0, want[owner] - kept[owner]) }, () => owner));
  return next.map((owner) => owner ?? short.shift() ?? 'centre');
}

export const LETTER: Readonly<Record<PlayerId, string>> = { 'player-a': 'A', 'player-b': 'B', 'player-c': 'C' };
export const LANE: Readonly<Record<PlayerId, 'a' | 'b' | 'c'>> = { 'player-a': 'a', 'player-b': 'b', 'player-c': 'c' };

/** Where each spot sits on the stage, as fractions of its width and height. */
export const LAYOUT: Readonly<Record<Owner, { readonly x: number; readonly y: number }>> = {
  'player-a': { x: 0.16, y: 0.33 },
  'player-b': { x: 0.84, y: 0.33 },
  'player-c': { x: 0.5, y: 0.74 },
  centre: { x: 0.5, y: 0.45 },
};
