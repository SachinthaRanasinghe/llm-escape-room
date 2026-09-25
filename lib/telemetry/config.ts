import { z } from 'zod';

/**
 * Telemetry config — TICKET-11 (#11). The second, and last, file under `lib/`,
 * `app/` or `components/` that reads `process.env`; the first is
 * `lib/providers/env.ts`. `lib/providers/secrets.test.ts` holds that list.
 *
 * Read ONCE, server-side, at BUILD time by `app/run/[id]/page.tsx`, which hands
 * the result to the client as a prop. That is why the variable is never
 * `NEXT_PUBLIC_`: a client-side read would be a second env site in code that
 * ships to the browser.
 *
 * The Umami website id is a public identifier, not a key — it ships in every
 * page that reports to Umami. The Umami API KEY is not read here: only
 * `scripts/watch-through.mts`, on the harness side, reads it.
 *
 * Unset means telemetry is off, and `/run/<id>` is exactly the player it was
 * before this ticket. Set but not a UUID FAILS THE BUILD: a mistyped id that
 * silently records nothing is the worst failure this could have.
 */

export const TELEMETRY_ENV_VARS = { websiteId: 'UMAMI_WEBSITE_ID' } as const;

export interface TelemetryConfig {
  readonly websiteId: string;
}

export class TelemetryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelemetryConfigError';
  }
}

const WebsiteId = z.uuid();

export function readTelemetryConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TelemetryConfig | null {
  const name = TELEMETRY_ENV_VARS.websiteId;
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) return null;
  // Names the variable, never the value.
  if (!WebsiteId.safeParse(value).success) throw new TelemetryConfigError(`${name} is not a UUID`);
  return { websiteId: value };
}
