import { loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { STRATEGIES, generateRoom, type GenerationRecord } from '@/lib/generator';
import { proposalFromSpec, scriptedGenerationClient } from '@/lib/generator/testing';
import type { EndReason, Run, RunSummary } from '@/lib/schema/run';
import type { SpikeInstance } from './decide';

/**
 * Test support for the spike analysis — real generation records from the
 * scripted client, and synthetic duels. Not exported from `index.ts`, like every
 * other `testing.ts` here.
 */

/** A record for a room accepted on its first attempt (1000 + 500 tokens, 1 call — `STUB_TOKENS`). */
export async function acceptedRecord(strategy = 'symbolic'): Promise<GenerationRecord> {
  const { client } = scriptedGenerationClient([JSON.stringify(proposalFromSpec(loadCanonicalRoom()))]);
  const result = await generateRoom({ client, strategy: STRATEGIES[strategy]!, seed: `${strategy}-ok` });
  return result.record;
}

/** A record whose cap tripped after two malformed attempts. */
export async function trippedRecord(strategy = 'symbolic'): Promise<GenerationRecord> {
  const bad = JSON.stringify({ theme: 1 });
  const { client } = scriptedGenerationClient([bad, bad]);
  const result = await generateRoom({ client, strategy: STRATEGIES[strategy]!, seed: `${strategy}-bad`, maxAttempts: 2 });
  return result.record;
}

const base = loadCanonicalRun();

export function summary(competitorId: string, escapeActionCount: number | null, endedBecause?: EndReason): RunSummary {
  const escaped = escapeActionCount !== null;
  return {
    competitorId,
    escaped,
    escapeActionCount,
    escapeMs: escaped ? 20_000 : null,
    puzzlesSolved: escaped ? 3 : 1,
    failedAttempts: 1,
    invalidActions: 1,
    tokens: { prompt: 20_000, completion: 1_000 },
    costUsd: 0,
    endedBecause: endedBecause ?? (escaped ? 'escaped' : 'budget_actions'),
  };
}

/** A duel where model-a escaped in `a` actions and model-b in `b` (`null` = stuck). */
export function duel(a: number | null, b: number | null): Run {
  return { ...base, summaries: [summary('model-a', a), summary('model-b', b)] };
}

export function instance(
  strategy: string,
  index: number,
  generation: GenerationRecord | null,
  run: Run | null,
): SpikeInstance {
  return {
    strategy,
    index,
    generation,
    run,
    actions: run === null ? null : { 'model-a': 10, 'model-b': 10 },
    providerCalls: run === null ? null : { 'model-a': 12, 'model-b': 12 },
    aborted: null,
  };
}
