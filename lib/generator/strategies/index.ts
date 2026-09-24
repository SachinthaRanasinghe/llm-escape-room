import type { GeneratorStrategy } from '../types';
import { createMixedStrategy } from './mixed';
import { createSpatialStrategy } from './spatial';
import { createSymbolicStrategy } from './symbolic';

/**
 * The strategy registry — what `--strategy` selects from.
 *
 * ── The three substrates of the TICKET-7 (#8) spike ────────────────────────
 * `symbolic` reads answers off clues, `spatial` finds keys, `mixed` does both.
 * All three run through the same loop against the same solver, so the spike
 * compares substrates rather than code paths. A new substrate is registered
 * here; an unregistered name fails with the list of real ones.
 */
export const STRATEGIES: Readonly<Record<string, GeneratorStrategy>> = {
  symbolic: createSymbolicStrategy(),
  spatial: createSpatialStrategy(),
  mixed: createMixedStrategy(),
};

export function resolveStrategy(
  name: string,
  registry: Readonly<Record<string, GeneratorStrategy>> = STRATEGIES,
): GeneratorStrategy {
  const strategy = Object.hasOwn(registry, name) ? registry[name] : undefined;
  if (strategy === undefined) {
    throw new Error(`unknown strategy "${name}" — known: ${Object.keys(registry).sort().join(', ')}`);
  }
  return strategy;
}

export { createSymbolicStrategy, chainLengthsFor, MAX_CHAIN_LENGTH } from './symbolic';
export type { SymbolicOptions } from './symbolic';
export { createSpatialStrategy } from './spatial';
export type { SpatialOptions } from './spatial';
export { createMixedStrategy } from './mixed';
export type { MixedOptions } from './mixed';
