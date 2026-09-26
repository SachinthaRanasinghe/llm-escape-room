/**
 * The leak scanner — the other half of "the artifact carries no secret".
 *
 * `schema.ts` refuses any field nobody listed. This refuses anything that LOOKS
 * like a way back to a provider, in any field: a URL, a provider endpoint, or a
 * string shaped like an API key. It runs on every artifact at publish time and on
 * every committed file in `canonical.test.ts`.
 *
 * The patterns are COPIED from `lib/providers/secrets.test.ts`, not imported:
 * the artifact side must never import the providers, and that sweep is what
 * checks it. If a provider is added there, add its key shape here.
 *
 * A URL is refused even inside a model-written intent. That is conservative on
 * purpose — the author decides what to do with such a run, rather than the
 * scanner deciding a URL is harmless.
 */

export const LEAK_KINDS = ['url', 'endpoint', 'key'] as const;
export type LeakKind = (typeof LEAK_KINDS)[number];

export interface Leak {
  readonly kind: LeakKind;
  /** The first few characters only — an error message must never re-print a whole key. */
  readonly match: string;
}

const PATTERNS: readonly { kind: LeakKind; pattern: RegExp }[] = [
  { kind: 'url', pattern: /https?:\/\/[^\s"']*/g },
  { kind: 'endpoint', pattern: /api\.groq\.com|generativelanguage\.googleapis\.com|openrouter\.ai/g },
  { kind: 'key', pattern: /\bgsk_[A-Za-z0-9]{20,}/g },
  { kind: 'key', pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
  // Google's newer API key format.
  { kind: 'key', pattern: /\bAQ\.[0-9A-Za-z_-]{30,}/g },
  { kind: 'key', pattern: /\bsk-or-v1-[0-9a-f]{20,}/g },
];

const SHOWN = 8;

function clip(text: string): string {
  return text.length <= SHOWN ? text : `${text.slice(0, SHOWN)}…`;
}

export function findLeaks(text: string): Leak[] {
  return PATTERNS.flatMap(({ kind, pattern }) => [...text.matchAll(pattern)].map((m) => ({ kind, match: clip(m[0]) })));
}
