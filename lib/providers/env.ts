import type { Provider } from '@/lib/schema/run';
import { ProviderError } from './types';

/**
 * The only file in `lib/`, `app/` or `fixtures/` that reads `process.env`.
 * `secrets.test.ts` enforces that by sweeping the source on disk.
 *
 * `architecture.md` → Boundaries · Secrets: "Provider keys live in the harness
 * environment only. The published artifact is pure data and ships no key, no
 * endpoint and no inference path." Confining the read to one function is what
 * makes that checkable rather than hoped for.
 *
 * Adapters take the key as an argument and never call this themselves, so they
 * can be tested with a fake key and the harness has exactly one env read on its
 * call path.
 *
 * ── Never prefix these NEXT_PUBLIC_ ────────────────────────────────────────
 * Next inlines `NEXT_PUBLIC_*` variables into client bundles. These names must
 * stay unprefixed so that, even by accident, a key cannot be compiled into the
 * replay page.
 */
export const PROVIDER_KEY_VARS: Readonly<Record<Provider, string>> = {
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
};

export function readProviderKey(
  provider: Provider,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const name = PROVIDER_KEY_VARS[provider];
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    // Names the variable, never a value.
    throw new ProviderError(provider, null, 0, `${name} is not set`);
  }
  return value;
}
