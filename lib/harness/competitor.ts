import type { ProviderAdapter, TranscriptEntry } from '@/lib/providers';
// The one value import from providers, and from `types.ts` only: `instanceof`
// needs the class, and that file holds no transport. `boundary.test.ts` pins it.
import { ProviderError } from '@/lib/providers/types';
import type { Event } from '@/lib/schema/event';
import type { RoomSpec } from '@/lib/schema/room';
import type { Competitor, RunSummary } from '@/lib/schema/run';
import { createSimulator, type Budget } from '@/lib/sim';
import { SYSTEM_PROMPT, noActionText, openingMessage, verdictText } from './prompt';
import { buildEvent } from './record';
import type { HarnessDeps } from './types';

/**
 * One competitor's run — TICKET-6 (#7). The loop `lib/sim/index.ts` sketches:
 *
 *   sim        ← a fresh simulator for THIS competitor
 *   transcript ← [what the room looks like]
 *   until the simulator says the run is over:
 *     turn   ← adapter.act(system, transcript)       one model call
 *     result ← sim.apply(turn.rawAction, its cost)   the only judge
 *     log    ← one event, malformed turns included
 *     transcript ← the call and its verdict
 *
 * ── A fresh simulator per competitor ───────────────────────────────────────
 * `lib/sim/simulator.ts` calls sharing one "the most quietly catastrophic bug
 * available": one model would walk through a door the other opened. The
 * simulator is created here, inside the per-competitor function, so there is no
 * way to hand one in.
 *
 * ── Think-time is the adapter's, not ours ──────────────────────────────────
 * The budget is charged `turn.latencyMs`, the successful attempt only, never a
 * delta of the harness clock. Backoff after a 429 is the provider's queue, not
 * the model hesitating (`lib/providers/transport.ts`).
 *
 * ── Every charged turn is logged ───────────────────────────────────────────
 * `seq` is the length of the log so far, so it is contiguous by construction and
 * the published action count is the number of events. The raw action goes to the
 * simulator unexamined; scoring it is not the harness's job.
 */

export interface CompetitorOptions {
  readonly runId: string;
  readonly spec: RoomSpec;
  readonly budget: Budget;
  readonly competitor: Competitor;
  readonly adapter: ProviderAdapter;
  readonly deps: HarnessDeps;
  /**
   * Polled before every model call. The duel sets it when another competitor's
   * provider has died, so this one stops spending quota on a run that will not be
   * published.
   */
  readonly shouldStop?: () => boolean;
}

export interface CompetitorResult {
  readonly competitorId: string;
  readonly events: readonly Event[];
  /** `null` only when the run was stopped from outside before it ended. */
  readonly summary: Omit<RunSummary, 'costUsd'> | null;
  /** Real provider calls, retries included — the number the quota analysis (#8) needs. */
  readonly providerCalls: number;
  readonly stopped: boolean;
}

/**
 * The provider gave up mid-run. `events` holds every turn that completed, so the
 * partial log can still be written; `cause` is the `ProviderError`.
 */
export class CompetitorAbortedError extends Error {
  readonly competitorId: string;
  readonly events: readonly Event[];
  readonly providerCalls: number;

  constructor(competitorId: string, events: readonly Event[], providerCalls: number, cause: ProviderError) {
    super(`${competitorId}: run aborted after ${events.length} completed action(s): ${cause.message}`, { cause });
    this.name = new.target.name;
    this.competitorId = competitorId;
    this.events = events;
    this.providerCalls = providerCalls;
  }
}

export async function runCompetitor(options: CompetitorOptions): Promise<CompetitorResult> {
  const { runId, spec, budget, competitor, adapter, deps } = options;
  const shouldStop = options.shouldStop ?? (() => false);

  const sim = createSimulator({ spec, budget, competitorId: competitor.id });
  const transcript: TranscriptEntry[] = [{ kind: 'user', text: openingMessage(sim.observe()) }];
  const events: Event[] = [];
  let providerCalls = 0;

  while (!sim.hasEnded()) {
    if (shouldStop()) break;

    let turn;
    try {
      turn = await adapter.act({ system: SYSTEM_PROMPT, transcript: [...transcript] });
    } catch (error) {
      if (error instanceof ProviderError) {
        throw new CompetitorAbortedError(competitor.id, events, providerCalls + error.attempts, error);
      }
      throw error;
    }
    providerCalls += turn.attempts;

    const result = sim.apply(turn.rawAction, {
      tokens: turn.tokens,
      elapsedMs: Math.round(turn.latencyMs),
    });
    events.push(
      buildEvent(
        { runId, competitorId: competitor.id, seq: events.length, at: new Date(deps.now()).toISOString() },
        turn,
        result,
      ),
    );

    const obs = sim.observe();
    if (turn.toolCall !== null) {
      // Answered even on a double call: `turn.ts` hands back the first call so
      // the transcript stays well-formed for the next turn.
      transcript.push(
        { kind: 'tool_call', call: turn.toolCall },
        {
          kind: 'tool_result',
          callId: turn.toolCall.callId,
          toolName: turn.toolCall.toolName,
          text: verdictText(result.verdict, obs),
        },
      );
    } else {
      if (turn.text !== null && turn.text.trim().length > 0) {
        transcript.push({ kind: 'assistant_text', text: turn.text });
      }
      transcript.push({ kind: 'user', text: noActionText(result.verdict, obs) });
    }
  }

  const ended = sim.hasEnded();
  return {
    competitorId: competitor.id,
    events,
    summary: ended ? sim.summarise() : null,
    providerCalls,
    stopped: !ended,
  };
}
