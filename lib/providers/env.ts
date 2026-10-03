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
  openrouter: 'OPENROUTER_API_KEY',
};

/** Whether `name`'s key is set — for the race page's picker. Never returns the value. */
export function hasProviderKey(
  provider: Provider,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (env[PROVIDER_KEY_VARS[provider]]?.trim() ?? '').length > 0;
}

/**
 * Whether the local race page (`/race`, `/api/race`) may spend these keys.
 *
 * On under `next dev`. Off in a production build unless `ENABLE_LOCAL_RACE=1`,
 * so deploying the public replay site can never expose an endpoint that runs
 * models on the owner's keys for whoever finds it. Read here because this is the
 * one file allowed to read the environment on the harness side.
 */
export function isLocalRaceEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ENABLE_LOCAL_RACE?.trim() === '1' || isPublicRaceEnabled(env);
}

/**
 * Whether this deployment offers the race to the public (`PUBLIC_RACE=1`) —
 * the hosted site (`docs/decisions/public-race.md`). Public mode changes how a
 * race runs, not whether a key can leave the server: the keys are still read
 * only here and only on the server, and the race runs in a Netlify background
 * function that streams nothing but `RaceMessage`s. It also narrows what may be
 * raced (free models only, at most one silent repeat) and rate-limits visitors.
 */
export function isPublicRaceEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.PUBLIC_RACE?.trim() === '1';
}

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
