import { findSeqBreaks, type Event, type EventLog } from '@/lib/schema/event';
import type { Run } from '@/lib/schema/run';
import type { ReplayBeat, ReplayData, ReplayLane, SceneLayout } from './types';

/**
 * The log, turned into two lanes the player can walk through beat by beat.
 *
 * ── The intent is copied, never touched ────────────────────────────────────
 * `intent` is the product (`lib/schema/action.ts`): the one line a viewer points
 * at when a model loses the thread. The PRD names summarising or paraphrasing it
 * as a misrepresentation risk, and spike 3's rule is that an intent that does not
 * read is fixed with timing and typography, never with its words. So it is
 * assigned by reference below — no trim, no truncation, no normalisation — and
 * `timeline.test.ts` checks every intent in the golden log survives byte for
 * byte. A turn with no intent gets `null`, never a placeholder: the panel labels
 * the absence as chrome, so nothing the model did not write is ever quoted.
 *
 * ── Refuse a broken log loudly ─────────────────────────────────────────────
 * A replay of a log with a gap would show the wrong action count — the metric
 * escape time is measured in. So a log that does not belong to the run, names a
 * competitor the run does not, or is not contiguous per competitor is a
 * `ReplayError` with a machine-readable reason, not a best-effort render.
 */

export const REPLAY_ERROR_REASONS = [
  'run_mismatch',
  'unknown_competitor',
  'seq_break',
  'missing_summary',
  'empty_lane',
] as const;
export type ReplayErrorReason = (typeof REPLAY_ERROR_REASONS)[number];

export class ReplayError extends Error {
  readonly reason: ReplayErrorReason;
  readonly detail: string;

  constructor(reason: ReplayErrorReason, detail: string) {
    super(`cannot replay: ${reason} (${detail})`);
    this.name = 'ReplayError';
    this.reason = reason;
    this.detail = detail;
  }
}

export interface BuildReplayInput {
  readonly log: EventLog;
  readonly run: Run;
  readonly layout: SceneLayout;
}

/** What the model aimed at, as it named it — resolved through the layout only for `submit_answer`. */
function rawTargetOf(event: Event, layout: SceneLayout): string | null {
  const action = event.action;
  if (action === null) return null;
  switch (action.name) {
    case 'look':
      return null;
    case 'inspect':
    case 'take':
    case 'open':
    case 'use':
    case 'enter_code':
      return action.targetId;
    case 'submit_answer':
      return layout.puzzleTargets[action.puzzleId] ?? action.puzzleId;
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

function argumentOf(event: Event): string | null {
  const action = event.action;
  if (action?.name === 'enter_code') return action.code;
  if (action?.name === 'submit_answer') return action.answer;
  return null;
}

/**
 * One event as the player draws it. `buildReplay` uses it for a whole log; the
 * local race page uses it one event at a time to play a race live.
 */
export function beatFromEvent(event: Event, layout: SceneLayout, cumulativeThinkMs: number): ReplayBeat {
  return toBeat(event, layout, new Set(layout.objects.map((o) => o.id)), cumulativeThinkMs);
}

function toBeat(event: Event, layout: SceneLayout, known: ReadonlySet<string>, cumulativeThinkMs: number): ReplayBeat {
  const rawTargetId = rawTargetOf(event, layout);
  return {
    seq: event.seq,
    verb: event.action?.name ?? null,
    targetId: rawTargetId !== null && known.has(rawTargetId) ? rawTargetId : null,
    rawTargetId,
    heldItemId: event.action?.name === 'use' ? event.action.itemId : null,
    argument: argumentOf(event),
    // Verbatim — see the header. v1: `rejected` becomes nullable; `?.` already handles it.
    intent: event.action?.intent ?? event.rejected?.intent ?? null,
    // v1: as above.
    rejection: event.rejected?.kind ?? null,
    verdict: { ok: event.verdict.ok, code: event.verdict.code, message: event.verdict.message },
    thinkMs: event.latencyMs,
    cumulativeThinkMs,
  };
}

export function buildReplay({ log, run, layout }: BuildReplayInput): ReplayData {
  const stray = log.find((e) => e.runId !== run.runId);
  if (stray) throw new ReplayError('run_mismatch', `event runId ${stray.runId}, run ${run.runId}`);

  const ids = new Set(run.competitors.map((c) => c.id));
  const unknown = log.find((e) => !ids.has(e.competitorId));
  if (unknown) throw new ReplayError('unknown_competitor', unknown.competitorId);

  const broken = findSeqBreaks(log);
  if (broken.length > 0) throw new ReplayError('seq_break', broken.join(', '));

  const known = new Set(layout.objects.map((o) => o.id));

  const lanes: ReplayLane[] = run.competitors.map((competitor) => {
    const summary = run.summaries.find((s) => s.competitorId === competitor.id);
    if (!summary) throw new ReplayError('missing_summary', competitor.id);

    // The log is merged by `at`; a lane plays in `seq` order.
    const events = log.filter((e) => e.competitorId === competitor.id).sort((a, b) => a.seq - b.seq);
    if (events.length === 0) throw new ReplayError('empty_lane', competitor.id);

    let cumulative = 0;
    const beats = events.map((event) => {
      cumulative += event.latencyMs;
      return toBeat(event, layout, known, cumulative);
    });

    return {
      competitorId: competitor.id,
      label: competitor.modelId,
      provider: competitor.provider,
      beats,
      endedBecause: summary.endedBecause,
      escaped: summary.escaped,
      maxActions: run.budget.maxActions,
    };
  });

  return { runId: run.runId, layout, lanes };
}
