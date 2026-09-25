import { END_LABEL, formatThink } from '@/lib/replay';
import type { Provider, Run, RunSummary } from '@/lib/schema/run';
import { outcomeKey, outcomeOf, type Outcome, type OutcomeCount } from './outcome';

/**
 * The post-run comparison, as words — TICKET-10 (#10).
 *
 * `buildComparison` turns a run, its repeat counts and two numbers read off the
 * log into `ComparisonData`: every string the results section shows. The
 * component only lays them out, so every sentence here is unit-tested verbatim
 * and leak-scanned, and the client bundle never value-imports a schema.
 *
 * ── Honesty about variance is the point ────────────────────────────────────
 * The ticket's failure mode is a critic dismissing the result as a lucky sample
 * — or a viewer over-trusting one. So the variance statement always carries its
 * counts ("won in 2 of 3"), says plainly when nothing was checked, and admits a
 * split ("just as often, so this is not a clear pattern") rather than rounding
 * it into "typical". It is shown as body text, never in a tooltip.
 *
 * ── Ranked by actions ──────────────────────────────────────────────────────
 * The winner is `outcomeOf`'s — fewest actions to escape — so the table agrees
 * with the typicality statement, which was judged the same way. Escape time is
 * shown, with `escapeTimeNote` saying what it measures.
 *
 * Plain JSON out: it crosses from the server page to a client component. Built
 * by listing, never by spreading a summary.
 */

export interface ComparisonRow {
  readonly competitorId: string;
  /** The model id — the same label the lane panels use. */
  readonly label: string;
  readonly provider: Provider;
  readonly escaped: boolean;
  readonly isWinner: boolean;
  /** `'Escaped in 13 actions'`, or how it stopped: `'Out of actions'`. */
  readonly result: string;
  /** `'25.4 s'`, or `'—'` when it did not escape. */
  readonly escapeTime: string;
  /** `'13 / 14'` — actions taken against the budget. */
  readonly actions: string;
  /** `'3 of 3'`. */
  readonly puzzles: string;
  readonly failedAttempts: number;
  readonly invalidActions: number;
  /** `'22,151'`. */
  readonly tokens: string;
  /** `'21,580 in · 571 out'`. */
  readonly tokensDetail: string;
  /** `'$0.00'`, `'<$0.01'`, `'$0.12'`. */
  readonly cost: string;
}

export type VarianceKind = 'unrepeated' | 'all_dropped' | 'typical' | 'atypical';

export interface VarianceStatement {
  readonly kind: VarianceKind;
  readonly title: string;
  readonly body: string;
}

export interface ComparisonData {
  /** In `run.competitors` order, like the lanes. */
  readonly rows: readonly ComparisonRow[];
  readonly headline: string;
  readonly variance: VarianceStatement;
  readonly limitation: string;
  readonly escapeTimeNote: string;
}

export interface ComparisonInput {
  readonly run: Run;
  /** The artifact's `repeats` block. */
  readonly repeats: {
    readonly completed: number;
    readonly dropped: number;
    readonly outcomes: readonly OutcomeCount[];
  };
  /** Events per competitor — every attempted action, invalid ones included. */
  readonly actionsTaken: Readonly<Record<string, number>>;
  /** Puzzles in the room — public, from the scene layout. */
  readonly puzzleCount: number;
}

export const LIMITATION =
  'Models are nondeterministic. The room, the rules and the action budget are identical for both models, ' +
  'but the same model in the same room can choose differently on another run — one run is one sample, not a verdict.';

export const ESCAPE_TIME_NOTE =
  'Escape time is each model’s total think-time as measured through its provider, so it depends on the serving ' +
  'stack as well as the model. The winner is decided by actions.';

const UNCHECKED = 'Not checked for luck';

const NUMBER = new Intl.NumberFormat('en-US');

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.005) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function summaryOf(run: Run, competitorId: string): RunSummary {
  const summary = run.summaries.find((s) => s.competitorId === competitorId);
  if (!summary) throw new RangeError(`buildComparison: no summary for competitor ${competitorId}`);
  return summary;
}

function labelOf(run: Run, competitorId: string): string {
  return run.competitors.find((c) => c.id === competitorId)?.modelId ?? competitorId;
}

/** `'competitor-a won'` / `'they tied'` — `start` capitalises the words we wrote, never a model id. */
function phrase(run: Run, outcome: Outcome, start = false): string {
  switch (outcome.kind) {
    case 'winner':
      return `${labelOf(run, outcome.competitorId)} won`;
    case 'tie':
      return start ? 'They tied' : 'they tied';
    case 'none':
      return start ? 'Neither escaped' : 'neither escaped';
  }
}

function headlineOf(run: Run, outcome: Outcome): string {
  switch (outcome.kind) {
    case 'winner': {
      const actions = summaryOf(run, outcome.competitorId).escapeActionCount;
      return `${labelOf(run, outcome.competitorId)} wins — escaped in ${actions} actions`;
    }
    case 'tie': {
      const actions = run.summaries.find((s) => s.escaped)?.escapeActionCount;
      return `A tie — both escaped in ${actions} actions`;
    }
    case 'none':
      return 'Neither model escaped';
  }
}

function varianceOf(run: Run, hero: Outcome, repeats: ComparisonInput['repeats']): VarianceStatement {
  const { completed: n, dropped: d, outcomes } = repeats;

  if (n === 0) {
    if (run.typicalOfRepeats !== null) {
      throw new RangeError(`buildComparison: typicalOfRepeats is ${run.typicalOfRepeats} with no completed repeats`);
    }
    const body =
      d === 0
        ? 'This room has not been re-run yet, so there is no telling whether this result is typical. Treat it as one sample.'
        : `All ${plural(d, 'silent re-run')} of this room stopped on a provider error, so there is no telling whether ` +
          'this result is typical. Treat it as one sample.';
    return { kind: d === 0 ? 'unrepeated' : 'all_dropped', title: UNCHECKED, body };
  }

  const heroKey = outcomeKey(hero);
  const k = outcomes.find((o) => outcomeKey(o.outcome) === heroKey)?.count ?? 0;
  const m = Math.max(...outcomes.map((o) => o.count));
  const typical = k === m;
  if (run.typicalOfRepeats !== typical) {
    throw new RangeError(`buildComparison: the tally says typical=${typical}, the run says ${run.typicalOfRepeats}`);
  }

  const reran = `The same room was re-run ${plural(n, 'more time')} without being shown`;
  const droppedNote =
    d === 0 ? '' : ` ${plural(d, 'more re-run')} stopped on a provider error and ${d === 1 ? 'is' : 'are'} not counted.`;

  if (typical) {
    // Name a single rival; with several, naming one would understate the split.
    const rivals = outcomes.filter((o) => o.count === m && outcomeKey(o.outcome) !== heroKey);
    const split =
      rivals.length === 0
        ? ''
        : ` ${rivals.length === 1 ? phrase(run, rivals[0]!.outcome, true) : 'Other outcomes came up'} just as often, ` +
          'so this is not a clear pattern.';
    return {
      kind: 'typical',
      title: 'Typical of its silent repeats',
      body: `${reran}, and ${phrase(run, hero)} in ${k} of ${n}.${split}${droppedNote}`,
    };
  }

  const mode = outcomes.find((o) => o.count === m)!;
  return {
    kind: 'atypical',
    title: 'Not typical of its silent repeats',
    body: `${reran}. ${phrase(run, hero, true)} in ${k} of ${n}; ${phrase(run, mode.outcome)} in ${m} of ${n}.${droppedNote}`,
  };
}

export function buildComparison({ run, repeats, actionsTaken, puzzleCount }: ComparisonInput): ComparisonData {
  const outcome = outcomeOf(run);

  const rows = run.competitors.map((competitor): ComparisonRow => {
    const s = summaryOf(run, competitor.id);
    const taken = actionsTaken[competitor.id] ?? 0;
    return {
      competitorId: competitor.id,
      label: competitor.modelId,
      provider: competitor.provider,
      escaped: s.escaped,
      isWinner: outcome.kind === 'winner' && outcome.competitorId === competitor.id,
      result: s.endedBecause === 'escaped' ? `Escaped in ${s.escapeActionCount ?? taken} actions` : END_LABEL[s.endedBecause],
      escapeTime: s.escapeMs === null ? '—' : formatThink(s.escapeMs),
      actions: `${taken} / ${run.budget.maxActions}`,
      puzzles: `${s.puzzlesSolved} of ${puzzleCount}`,
      failedAttempts: s.failedAttempts,
      invalidActions: s.invalidActions,
      tokens: NUMBER.format(s.tokens.prompt + s.tokens.completion),
      tokensDetail: `${NUMBER.format(s.tokens.prompt)} in · ${NUMBER.format(s.tokens.completion)} out`,
      cost: formatCost(s.costUsd),
    };
  });

  return {
    rows,
    headline: headlineOf(run, outcome),
    variance: varianceOf(run, outcome, repeats),
    limitation: LIMITATION,
    escapeTimeNote: ESCAPE_TIME_NOTE,
  };
}
