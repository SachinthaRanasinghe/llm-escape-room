import { describe, expect, it } from 'vitest';
import type { Action } from '@/lib/schema/action';
import { loadCanonicalRoom } from '@/fixtures';
import { compileRoom, isReachable, type RoomState } from './state';
import { observe } from './observation';
import { resolve } from './resolve';

/**
 * THE SECRECY PROOF — TICKET-2's headline acceptance criterion.
 *
 * `architecture.md`: "Models never see room internals, only what the simulator
 * returns." That is a claim about every possible action, not about the handful a
 * model happened to try, so this file does not test examples — it sweeps EVERY
 * verb against EVERY object in the room and asserts over the union of everything
 * the simulator said back.
 *
 * ── What "secret" means precisely ──────────────────────────────────────────
 * Not "the string 4471 never appears". The `ledger` is *supposed* to tell you
 * 4471 — that is what a clue is, and a room whose clues said nothing would be
 * unsolvable. The real invariant is narrower and stronger:
 *
 *   A lock code or a puzzle answer may reach the competitor ONLY as the clue text
 *   of an object they can actually reach, revealed by inspecting it.
 *
 * Everything else — observations, failure messages, room descriptions, the clue
 * of anything sealed behind a lock — must be clean.
 *
 * ── When this test fires ───────────────────────────────────────────────────
 * It will fail the day someone spreads a `RoomObject` into a message, or adds a
 * "helpful" hint to a `locked` verdict. That is the entire point. Fix the leak;
 * do not weaken the sweep.
 */

const room = loadCanonicalRoom();

const LOCK_CODES = room.objects.flatMap((object) =>
  object.lock !== null && object.lock.opensWith === 'code' ? [object.lock.code] : [],
);
const ANSWERS = room.puzzles.map((puzzle) => puzzle.answer);
const SECRETS = [...LOCK_CODES, ...ANSWERS];

/**
 * Every action a competitor could attempt against this room, built from the spec
 * rather than hand-listed — a generated room that adds an object is swept
 * automatically, so the proof cannot quietly stop covering the room it guards.
 */
function everyAction(state: RoomState): Action[] {
  const intent = 'sweep';
  const ids = state.spec.objects.map((object) => object.id);
  const actions: Action[] = [{ name: 'look', intent }];

  for (const targetId of ids) {
    actions.push({ name: 'inspect', targetId, intent });
    actions.push({ name: 'take', targetId, intent });
    actions.push({ name: 'open', targetId, intent });
    // A deliberately wrong code: the sweep probes what the simulator says when
    // refusing, which is where a "close, but the first digit is a 4" would leak.
    actions.push({ name: 'enter_code', targetId, code: '0000', intent });
    for (const itemId of ids) {
      actions.push({ name: 'use', itemId, targetId, intent });
    }
  }

  for (const puzzle of state.spec.puzzles) {
    actions.push({ name: 'submit_answer', puzzleId: puzzle.id, answer: 'nonsense', intent });
  }
  // A puzzle id that does not exist, in case not_found ever grows helpful.
  actions.push({ name: 'submit_answer', puzzleId: 'p999', answer: 'nonsense', intent });

  return actions;
}

/** Sweep from one state, returning every message the simulator produced. */
function sweep(state: RoomState): string[] {
  return everyAction(state).map((action) => resolve(state, action).verdict.message);
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function clueTextOfUnreachable(state: RoomState): string[] {
  return state.spec.objects
    .filter((object) => object.clueText !== null && !isReachable(state, object.id))
    .map((object) => object.clueText!);
}

/** The clues a competitor has legitimately earned the right to read in this state. */
function clueTextOfReachable(state: RoomState): Set<string> {
  return new Set(
    state.spec.objects
      .filter((object) => object.clueText !== null && isReachable(state, object.id))
      .map((object) => object.clueText!),
  );
}

describe('secrecy — a fresh room', () => {
  const fresh = compileRoom(room);

  it('has secrets worth guarding, so the assertions below are not vacuous', () => {
    expect(LOCK_CODES).toEqual(expect.arrayContaining(['4471', '1770']));
    expect(ANSWERS).toEqual(expect.arrayContaining(['north']));
    expect(clueTextOfUnreachable(fresh).length).toBeGreaterThan(0);
  });

  it('never reveals a lock code or an answer except as the clue of a reachable object', () => {
    const earned = clueTextOfReachable(fresh);
    for (const message of sweep(fresh)) {
      if (earned.has(message)) continue; // a legitimate inspect of something in reach
      for (const secret of SECRETS) {
        expect(
          contains(message, secret),
          `verdict message leaked the secret "${secret}": ${message}`,
        ).toBe(false);
      }
    }
  });

  it('never reveals the clue of an object sealed behind a lock', () => {
    const hidden = clueTextOfUnreachable(fresh);
    for (const message of sweep(fresh)) {
      for (const clue of hidden) {
        expect(contains(message, clue), `verdict message leaked a hidden clue: ${message}`).toBe(false);
      }
    }
  });

  it('never names an object the competitor cannot reach', () => {
    // The `not_found` message echoes the id the competitor supplied, which tells
    // them nothing they did not already write. What must not appear is the NAME
    // of a hidden object in a message they did not name it in.
    const hiddenNames = room.objects
      .filter((object) => !isReachable(fresh, object.id))
      .map((object) => object.name);
    expect(hiddenNames).toEqual(expect.arrayContaining(['sea chart', "surveyor's logbook"]));

    const openAndLook = [
      resolve(fresh, { name: 'look', intent: 'sweep' }).verdict.message,
      resolve(fresh, { name: 'open', targetId: 'wall-safe', intent: 'sweep' }).verdict.message,
      resolve(fresh, { name: 'inspect', targetId: 'wall-safe', intent: 'sweep' }).verdict.message,
      resolve(fresh, { name: 'enter_code', targetId: 'wall-safe', code: '0000', intent: 'sweep' }).verdict.message,
    ];
    for (const message of openAndLook) {
      for (const name of hiddenNames) {
        expect(contains(message, name), `message named a hidden object: ${message}`).toBe(false);
      }
    }
  });

  it('carries no clue text at all in a structured observation', () => {
    const serialised = JSON.stringify(observe(fresh, 14));
    for (const object of room.objects) {
      if (object.clueText !== null) expect(serialised).not.toContain(object.clueText);
    }
    for (const secret of SECRETS) {
      expect(serialised).not.toContain(secret);
    }
  });
});

describe('secrecy — after the lock is legitimately opened', () => {
  /**
   * The positive control. Without it, a simulator that returned an empty string
   * for everything would pass every assertion above, and this file would be
   * proving silence rather than secrecy.
   */
  const unlocked = resolve(compileRoom(room), {
    name: 'enter_code',
    targetId: 'wall-safe',
    code: '4471',
    intent: 'sweep',
  }).state;

  it('now reveals the chart that was sealed in the safe', () => {
    const verdict = resolve(unlocked, { name: 'inspect', targetId: 'sea-chart', intent: 'sweep' }).verdict;
    expect(verdict.code).toBe('ok');
    expect(verdict.message).toContain('1770');
  });

  it('names the chart when the safe is opened', () => {
    const verdict = resolve(unlocked, { name: 'open', targetId: 'wall-safe', intent: 'sweep' }).verdict;
    expect(verdict.code).toBe('ok');
    expect(contains(verdict.message, 'sea chart')).toBe(true);
  });

  it('still guards everything one lock further in', () => {
    const hidden = clueTextOfUnreachable(unlocked);
    expect(hidden.length).toBeGreaterThan(0); // the logbook is still in the cabinet
    const earned = clueTextOfReachable(unlocked);
    for (const message of sweep(unlocked)) {
      if (earned.has(message)) continue;
      for (const clue of hidden) {
        expect(contains(message, clue), `leaked a still-hidden clue: ${message}`).toBe(false);
      }
    }
  });
});
