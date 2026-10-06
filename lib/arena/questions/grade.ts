import type { AnswerKey } from './types';

/**
 * Grading — deterministic code, never a model.
 *
 * The prompt tells a model to give only the final answer, and the grader holds
 * it to that: `"The answer is 24"` is wrong, by design, because reading a number
 * out of prose is a judgement call and a judgement call is where one model gets
 * forgiven what another is charged for. What IS forgiven is presentation that
 * cannot change the answer: wrapping quotes or backticks, a trailing full stop,
 * case, and whitespace.
 */

export interface Grade {
  readonly correct: boolean;
  /** The given answer as the grader compared it. */
  readonly normalised: string;
}

const WRAPPERS = /^[`'"]+|[`'"]+$/g;

/** Trim, unwrap, drop one trailing full stop. Shared by every kind. */
function tidy(text: string): string {
  return text.trim().replace(WRAPPERS, '').trim().replace(/\.$/, '').trim();
}

/** Case-insensitive, all whitespace removed. */
export function normaliseText(text: string): string {
  return tidy(text).toLowerCase().replace(/\s+/g, '');
}

function parseNumber(text: string): number | null {
  const cleaned = tidy(text).replace(/^=\s*/, '').replace(/[,_\s]/g, '');
  if (cleaned.length === 0 || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function splitList(text: string): string[] {
  const body = tidy(text).replace(/^\[|\]$/g, '');
  return body.length === 0 ? [] : body.split(',').map(normaliseText);
}

export function gradeAnswer(key: AnswerKey, given: string): Grade {
  switch (key.kind) {
    case 'number': {
      const value = parseNumber(given);
      return {
        correct: value !== null && Math.abs(value - key.value) <= (key.tolerance ?? 0),
        normalised: value === null ? normaliseText(given) : String(value),
      };
    }
    case 'text': {
      const normalised = normaliseText(given);
      return { correct: normalised.length > 0 && key.accept.some((a) => normaliseText(a) === normalised), normalised };
    }
    case 'list': {
      const items = splitList(given);
      const expected = key.items.map(normaliseText);
      const [a, b] = key.ordered ? [items, expected] : [[...items].sort(), [...expected].sort()];
      return { correct: a.length === b.length && a.every((item, i) => item === b[i]), normalised: items.join(',') };
    }
    default: {
      const unreachable: never = key;
      throw new Error(`no grader for ${JSON.stringify(unreachable)}`);
    }
  }
}
