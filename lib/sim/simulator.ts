import { ActionSchema, type Action, type Verdict, type VerdictCode } from '@/lib/schema/action';
import type { RoomSpec } from '@/lib/schema/room';
import type { EndReason, RunSummary } from '@/lib/schema/run';
import { actionsRemaining, chargeLedger, createLedger, type ActionCost, type Budget, type Ledger } from './budget';
import { observe, type Observation } from './observation';
import { resolve } from './resolve';
import { SimulatorError, compileRoom, type RoomState } from './state';

/**
 * The simulator — the sole authority on room state, and the only channel between
 * a competitor and the room.
 *
 * ── One simulator per competitor ───────────────────────────────────────────
 * Both competitors race the SAME `RoomSpec`, each against its own fresh state.
 * Neither can see the other's progress, and neither benefits from it. The golden
 * log shows both models independently unlocking the same safe, which is exactly
 * right: they are solving identical rooms, not sharing one.
 *
 * Sharing an instance between competitors would let one model walk through a door
 * the other opened. That is the most quietly catastrophic bug available in this
 * ticket — every published result would be wrong and nothing would look broken —
 * so `createSimulator` takes one `competitorId` and the harness is expected to
 * build one per racer.
 */

/** How each verdict code scores. Pulled out as a table so the mapping is one readable thing. */
type Tally = 'none' | 'failed' | 'invalid';

/**
 * Read off the committed run record rather than invented here.
 * `fixtures/runs/canonical-run.json` gives model-b `failedAttempts: 2` and
 * `invalidActions: 1` against a log holding two `wrong_code`, one `not_found`
 * and one `locked` — which fixes all three categories at once:
 *
 * - **failed** — the model understood the interface and was wrong about the room.
 * - **invalid** — the model misused the interface itself. Published as a metric,
 *   never hidden; the PRD counts it.
 * - **none** — `locked` is neither. Trying a door to find out whether it is
 *   locked is legitimate play, and model-a does exactly that at `seq 5` while
 *   scoring zero of both. Penalising it would punish careful play.
 */
export const VERDICT_TALLY: Readonly<Record<VerdictCode, Tally>> = {
  ok: 'none',
  locked: 'none',
  wrong_answer: 'failed',
  wrong_code: 'failed',
  not_found: 'invalid',
  not_holding: 'invalid',
  malformed: 'invalid',
  not_permitted: 'invalid',
};

export interface SimulatorOptions {
  readonly spec: RoomSpec;
  readonly budget: Budget;
  readonly competitorId: string;
}

export interface ApplyResult {
  /** `null` when the payload did not parse — there was no action to speak of. */
  readonly action: Action | null;
  readonly verdict: Verdict;
  /** Non-null on the action that ended the run, and only on that one. */
  readonly ended: EndReason | null;
}

export interface Simulator {
  readonly competitorId: string;
  observe(): Observation;
  apply(raw: unknown, cost: ActionCost): ApplyResult;
  summarise(): Omit<RunSummary, 'costUsd'>;
  hasEnded(): boolean;
}

export function createSimulator({ spec, budget, competitorId }: SimulatorOptions): Simulator {
  let state: RoomState = compileRoom(spec);
  let ledger: Ledger = createLedger(budget);
  let ended: EndReason | null = null;
  let failedAttempts = 0;
  let invalidActions = 0;
  let escapeActionCount: number | null = null;
  let escapeMs: number | null = null;

  function hasEnded(): boolean {
    return ended !== null;
  }

  return {
    competitorId,

    observe() {
      return observe(state, actionsRemaining(ledger));
    },

    /**
     * Resolve one attempted action and charge the run for it.
     *
     * `raw` is `unknown` on purpose: what arrives here came out of a language
     * model through a provider adapter, and it is regularly not an action at all.
     * That case is the ticket's explicit requirement — a malformed action returns
     * a clear error AND CONSUMES A TURN — so it is handled as a verdict rather
     * than an exception, and the ledger is charged either way.
     */
    apply(raw: unknown, cost: ActionCost): ApplyResult {
      if (ended !== null) {
        // A programmer error, not a competitor's. The harness must stop asking a
        // model for actions once its run is over; quietly accepting them would
        // inflate the published action count, which is the number every claim
        // about these models rests on.
        throw new SimulatorError(
          `${competitorId}: apply() after the run ended (${ended}). Check hasEnded() before acting.`,
        );
      }

      const parsed = ActionSchema.safeParse(raw);

      let action: Action | null = null;
      let verdict: Verdict;

      if (!parsed.success) {
        // `parseAction` throws by design; here the failure IS the result, so the
        // schema is used directly. The issues go back to the model verbatim —
        // it can only correct a mistake it is told about.
        const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'action'}: ${issue.message}`);
        verdict = {
          ok: false,
          code: 'malformed',
          message: `That is not a valid action. ${detail.join('; ')}`,
        };
      } else {
        action = parsed.data;
        const resolution = resolve(state, action);
        verdict = resolution.verdict;
        state = resolution.state;
      }

      const tally = VERDICT_TALLY[verdict.code];
      if (tally === 'failed') failedAttempts += 1;
      if (tally === 'invalid') invalidActions += 1;

      const charged = chargeLedger(ledger, cost);
      ledger = charged.ledger;

      // Escaping beats running out. A model that solved the room on the action
      // that also exhausted its budget escaped; recording that as a budget
      // failure would be a lie about the only outcome the product reports.
      if (state.escaped) {
        escapeActionCount = ledger.actions;
        escapeMs = ledger.elapsedMs;
        ended = 'escaped';
      } else if (charged.exhausted !== null) {
        ended = charged.exhausted;
      }

      return { action, verdict, ended };
    },

    /**
     * The per-competitor record the harness publishes.
     *
     * `costUsd` is absent deliberately: the simulator does not know what a token
     * costs, and guessing would put a made-up number in a field the PRD tracks as
     * a guardrail. #7 knows the provider and the pricing, and adds it there.
     */
    summarise(): Omit<RunSummary, 'costUsd'> {
      if (ended === null) {
        throw new SimulatorError(
          `${competitorId}: summarise() before the run ended. A RunSummary must state why the run stopped.`,
        );
      }

      return {
        competitorId,
        escaped: state.escaped,
        escapeActionCount,
        escapeMs,
        puzzlesSolved: state.solved.size,
        failedAttempts,
        invalidActions,
        tokens: { prompt: ledger.promptTokens, completion: ledger.completionTokens },
        endedBecause: ended,
      };
    },

    hasEnded,
  };
}
