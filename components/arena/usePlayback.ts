'use client';

import { useCallback, useEffect, useReducer } from 'react';
import type { ArenaTurnView } from '@/lib/race/arena-wire';
import { paceFor, timeline, type Beat } from './choreography';

/**
 * The director: plays received turns one at a time, beat by beat.
 *
 * `played` counts turns fully shown; `step` is the beat of the turn on screen
 * (`turns[played]`), or `null` between turns. Turns that arrive while one is
 * playing wait their turn and speed playback up (`paceFor`), so a burst of
 * hosted-poll messages never leaves the screen minutes behind the match.
 * Reduced motion — or `skip()` — jumps straight to the latest turn.
 */

interface State {
  readonly played: number;
  readonly step: number | null;
}

type Action = { readonly type: 'start' } | { readonly type: 'advance'; readonly steps: number } | { readonly type: 'jump'; readonly to: number } | { readonly type: 'reset' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'start':
      return state.step === null ? { ...state, step: 0 } : state;
    case 'advance':
      if (state.step === null) return state;
      return state.step + 1 < action.steps ? { ...state, step: state.step + 1 } : { played: state.played + 1, step: null };
    case 'jump':
      return { played: Math.max(state.played, action.to), step: null };
    case 'reset':
      return { played: 0, step: null };
  }
}

export interface Playback {
  /** Turns fully played. */
  readonly played: number;
  /** The turn on screen, if one is playing. */
  readonly turn: ArenaTurnView | null;
  readonly beat: Beat | null;
  /** How long the current beat lasts, in ms, after pacing. */
  readonly beatMs: number;
  /** True when every received turn has been shown. */
  readonly caughtUp: boolean;
  readonly skip: () => void;
}

export function usePlayback(turns: readonly ArenaTurnView[], reduced: boolean): Playback {
  const [state, dispatch] = useReducer(reducer, { played: 0, step: null });

  // A new match starts from an empty list.
  useEffect(() => {
    if (turns.length === 0) dispatch({ type: 'reset' });
  }, [turns.length]);

  const turn = state.step === null ? null : (turns[state.played] ?? null);
  const steps = turn === null ? [] : timeline(turn);
  const pace = paceFor(turns.length - state.played - 1);
  const beatMs = state.step === null ? 0 : Math.round((steps[state.step]?.ms ?? 0) * pace);

  useEffect(() => {
    if (reduced) {
      if (state.played < turns.length || state.step !== null) dispatch({ type: 'jump', to: turns.length });
      return;
    }
    if (state.step === null) {
      if (state.played < turns.length) dispatch({ type: 'start' });
      return;
    }
    const id = setTimeout(() => dispatch({ type: 'advance', steps: steps.length }), beatMs);
    return () => clearTimeout(id);
  }, [reduced, state, turns.length, steps.length, beatMs]);

  const skip = useCallback(() => dispatch({ type: 'jump', to: turns.length }), [turns.length]);

  return {
    played: state.played,
    turn,
    beat: state.step === null ? null : (steps[state.step]?.beat ?? null),
    beatMs,
    caughtUp: state.step === null && state.played >= turns.length,
    skip,
  };
}

/** `prefers-reduced-motion`, live. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useReducer((_: boolean, next: boolean) => next, false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
