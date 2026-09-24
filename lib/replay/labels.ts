import type { ActionName, VerdictCode } from '@/lib/schema/action';
import type { EndReason } from '@/lib/schema/run';
import type { RejectionKind, ReplayBeat, ReplayLane, SceneLayout } from './types';

/**
 * Every string the player writes itself — as opposed to the model's intent and
 * the simulator's verdict message, which it only ever quotes.
 *
 * Each map is a `Record` over the schema's own union, so when TICKET-7's (#8) v1
 * adds a verb, a verdict or a rejection kind, typecheck fails here rather than a
 * lane rendering `undefined` in front of a viewer.
 *
 * None of this may paraphrase the model. It names what the model DID (`enters
 * code 7777 on wall safe`); what it MEANT is the intent, shown verbatim beside it.
 */

export const VERB_LABEL: Readonly<Record<ActionName, string>> = {
  look: 'looks around',
  inspect: 'inspects',
  take: 'takes',
  open: 'tries to open',
  use: 'uses',
  enter_code: 'enters code',
  submit_answer: 'answers',
};

export type VerdictTone = 'success' | 'neutral' | 'failure' | 'invalid';

/**
 * How a verdict lands on screen. A COPY of `VERDICT_TALLY` in
 * `lib/sim/simulator.ts`, not an import: `lib/replay` ships to the browser and
 * must not pull in the simulator. `labels.test.ts` checks the two agree code by
 * code, so the replay cannot call something a failure that the published summary
 * does not count as one.
 *
 * `locked` is `neutral` because the tally scores it nothing — checking a lock is
 * careful play, not a mistake.
 */
export const VERDICT_TONE: Readonly<Record<VerdictCode, VerdictTone>> = {
  ok: 'success',
  locked: 'neutral',
  wrong_answer: 'failure',
  wrong_code: 'failure',
  wrong_key: 'failure',
  not_found: 'invalid',
  not_holding: 'invalid',
  malformed: 'invalid',
  not_permitted: 'invalid',
};

export const REJECTION_LABEL: Readonly<Record<RejectionKind, string>> = {
  no_tool_call: 'did not act',
  multiple_tool_calls: 'tried two actions at once',
  unparseable_arguments: 'sent garbled arguments',
  provider_rejected_call: 'sent a call the provider rejected',
  invalid_arguments: 'sent an action the rules refuse',
};

export const END_LABEL: Readonly<Record<Exclude<EndReason, 'escaped'>, string>> = {
  budget_actions: 'Out of actions',
  budget_tokens: 'Out of tokens',
  budget_time: 'Out of time',
};

/** Chrome, not model text: shown when a turn carried no intent. Never styled as a quote. */
export const NO_INTENT = '(no intent written)';

function nameOf(id: string | null, layout: SceneLayout): string {
  if (id === null) return 'something';
  return layout.objects.find((o) => o.id === id)?.name ?? id;
}

/**
 * What the character did, in plain words. An unknown target is shown as the id
 * the model actually named, so a viewer sees `inspects bookshelf` — the mistake
 * itself — rather than a tidied version of it.
 */
export function describeAction(beat: ReplayBeat, layout: SceneLayout): string {
  if (beat.verb === null) return beat.rejection ? REJECTION_LABEL[beat.rejection] : 'did not act';
  const target = nameOf(beat.targetId ?? beat.rawTargetId, layout);
  switch (beat.verb) {
    case 'look':
      return VERB_LABEL.look;
    case 'inspect':
    case 'take':
    case 'open':
      return `${VERB_LABEL[beat.verb]} ${target}`;
    case 'use':
      return `${VERB_LABEL.use} ${nameOf(beat.heldItemId, layout)} on ${target}`;
    case 'enter_code':
      return `${VERB_LABEL.enter_code} ${beat.argument ?? ''} on ${target}`;
    case 'submit_answer':
      return `${VERB_LABEL.submit_answer} "${beat.argument ?? ''}" for ${target}`;
    default: {
      const unreachable: never = beat.verb;
      return unreachable;
    }
  }
}

/** How a finished lane is summed up. */
export function describeEnd(lane: ReplayLane): string {
  if (lane.endedBecause === 'escaped') return `Escaped in ${lane.beats.length} actions`;
  return END_LABEL[lane.endedBecause];
}

/** `1260` → `'1.3 s'`. One decimal: enough to see hesitation, not so much it reads as precision. */
export function formatThink(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}
