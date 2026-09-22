import type { PortableParam, PortableSpec } from './vocabulary';

/**
 * The drift finder — the comparison `equivalence.test.ts` is built on.
 *
 * `architecture.md`: "An equivalence check proves the compiled tool specs are
 * genuinely the same task before any result is published … Without it the
 * fairness claim is an assertion." Each provider's compiled tools are normalised
 * back into a `PortableSpec`, and this reports every place two of them differ.
 *
 * Returns ALL differences rather than stopping at the first, for the same reason
 * `findSeqBreaks` does in `lib/schema/event.ts`: a reviewer fixing drift wants
 * the whole list, not one at a time. Never throws — drift is a result.
 */

export interface Drift {
  /** e.g. `tools.use.params.itemId.maxLength`. */
  readonly path: string;
  readonly left: unknown;
  readonly right: unknown;
}

const PARAM_FIELDS: readonly (keyof PortableParam)[] = ['type', 'description', 'minLength', 'maxLength'];

export function findSpecDrift(left: PortableSpec, right: PortableSpec): Drift[] {
  const drift: Drift[] = [];
  const leftNames = left.tools.map((tool) => tool.name);
  const rightNames = right.tools.map((tool) => tool.name);

  // Order is not meaningful to a model, but a reordering means someone edited
  // one compiler and not the other — worth hearing about.
  if (leftNames.join() !== rightNames.join()) {
    drift.push({ path: 'tools[order]', left: leftNames, right: rightNames });
  }

  const rightByName = new Map(right.tools.map((tool) => [tool.name, tool]));
  const leftByName = new Map(left.tools.map((tool) => [tool.name, tool]));

  for (const name of rightNames) {
    if (!leftByName.has(name)) drift.push({ path: `tools.${name}`, left: undefined, right: name });
  }

  for (const tool of left.tools) {
    const other = rightByName.get(tool.name);
    const at = `tools.${tool.name}`;
    if (other === undefined) {
      drift.push({ path: at, left: tool.name, right: undefined });
      continue;
    }

    if (tool.description !== other.description) {
      drift.push({ path: `${at}.description`, left: tool.description, right: other.description });
    }

    const leftRequired = [...tool.required].sort();
    const rightRequired = [...other.required].sort();
    if (leftRequired.join() !== rightRequired.join()) {
      drift.push({ path: `${at}.required`, left: leftRequired, right: rightRequired });
    }

    const keys = new Set([...Object.keys(tool.params), ...Object.keys(other.params)]);
    for (const key of [...keys].sort()) {
      const a = tool.params[key];
      const b = other.params[key];
      if (a === undefined || b === undefined) {
        drift.push({ path: `${at}.params.${key}`, left: a, right: b });
        continue;
      }
      for (const field of PARAM_FIELDS) {
        if (a[field] !== b[field]) {
          drift.push({ path: `${at}.params.${key}.${field}`, left: a[field], right: b[field] });
        }
      }
    }
  }

  return drift;
}
