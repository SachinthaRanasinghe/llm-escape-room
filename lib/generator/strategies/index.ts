import type { GeneratorStrategy } from '../types';
import { createSymbolicStrategy } from './symbolic';

/**
 * The strategy registry — what `--strategy` selects from.
 *
 * ── This file is TICKET-7's (#8) extension point ───────────────────────────
 * The spike adds `spatial` and `mixed` here and runs each through the same
 * loop. There are deliberately no placeholders for them: an unregistered name
 * fails with the list of real ones, which is more honest than a registered name
 * that throws when used.
 */
export const STRATEGIES: Readonly<Record<string, GeneratorStrategy>> = {
  symbolic: createSymbolicStrategy(),
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
