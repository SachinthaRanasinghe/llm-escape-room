import type { Page } from '@playwright/test';

/**
 * Shared by `playwright.config.ts` and the specs — TICKET-11 (#11).
 *
 * The e2e server starts with this fixed test id, so `/run/<id>` renders its
 * telemetry wrapper. Every beacon is intercepted here and never leaves the
 * machine; Umami would drop HeadlessChrome as a bot anyway.
 */

export const TEST_WEBSITE_ID = '00000000-0000-4000-8000-000000000011';
export const TELEMETRY_HOST = 'cloud.umami.is';

export interface Beacon {
  readonly method: string;
  readonly path: string;
  readonly body: { type: string; payload: Record<string, string> };
}

/** Answers every beacon locally (with CORS headers, so the page's fetch resolves) and records it. */
export async function captureBeacons(page: Page): Promise<Beacon[]> {
  const beacons: Beacon[] = [];
  await page.route(`https://${TELEMETRY_HOST}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      beacons.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
    }
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'content-type': 'application/json',
      },
      body: '{}',
    });
  });
  return beacons;
}

export const names = (beacons: readonly Beacon[]): string[] => beacons.map((b) => b.body.payload.name);
