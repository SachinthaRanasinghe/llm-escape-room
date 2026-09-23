import type { Verdict } from '@/lib/schema/action';
import type { Observation } from '@/lib/sim';

/**
 * Everything the harness says to a competitor — TICKET-6 (#7).
 *
 * ── One set of words for every model ───────────────────────────────────────
 * The equivalence check (#4) proves both models get the same tools. That proof
 * is worthless if the prose around the tools differs, so the system prompt is a
 * single constant and every per-turn message is a pure function of the
 * simulator's output. Nothing here knows which model it is talking to.
 *
 * ── Built from `Observation`, never from the room ──────────────────────────
 * `lib/sim/observation.ts` is the secrecy boundary: it is the only view of the
 * room a model may read. This file takes an `Observation` and a `Verdict` and
 * nothing else, so it cannot leak a clue or an answer even by accident.
 * `boundary.test.ts` asserts it does not import the room schema at all.
 */

export const SYSTEM_PROMPT = [
  'You are locked in a room and must escape.',
  'Act only by calling exactly one of the tools on each turn.',
  'Every call needs an `intent`: one short sentence, in your own words, saying why you are taking that action. Viewers see it beside your character.',
  'Refer to objects by the id shown in brackets.',
  'Wrong or invalid actions still cost a turn, and you have a limited number of actions.',
].join('\n');

const NO_ACTION_LINE = 'Act by calling exactly one tool.';

function remaining(obs: Observation): string {
  return `Actions remaining: ${obs.actionsRemaining}`;
}

/** The first thing a competitor reads: the theme, what it can see, what it holds. */
export function openingMessage(obs: Observation): string {
  const lines = [`${obs.theme.name}. ${obs.theme.description}`, '', 'You can see:'];
  for (const object of obs.visible) {
    const state = [object.locked ? 'locked' : null, object.opened ? 'open' : null].filter((s) => s !== null);
    lines.push(`- ${object.name} [${object.id}]${state.length > 0 ? `, ${state.join(', ')}` : ''}`);
  }
  if (obs.visible.length === 0) lines.push('- nothing');
  if (obs.held.length > 0) {
    lines.push('', 'You are carrying:');
    for (const item of obs.held) lines.push(`- ${item.name} [${item.id}]`);
  }
  lines.push('', remaining(obs));
  return lines.join('\n');
}

/** The answer to a tool call: the simulator's message verbatim, then the count. */
export function verdictText(verdict: Verdict, obs: Observation): string {
  return `${verdict.message}\n${remaining(obs)}`;
}

/** The answer to a turn with no usable tool call — the same, plus a fixed reminder. */
export function noActionText(verdict: Verdict, obs: Observation): string {
  return `${verdict.message}\n${NO_ACTION_LINE}\n${remaining(obs)}`;
}
