import { expect, test, type Page } from '@playwright/test';
import { loadArtifact } from '@/lib/artifact';
import { captureBeacons, names, TEST_WEBSITE_ID, type Beacon } from './telemetry';

/**
 * Watch-through telemetry in a real browser — TICKET-11 (#11).
 *
 * The replay clock is Playwright's fake clock, so "30 seconds of playback" is
 * exactly `advance(page, 30_000)`, and paused time can be made to pass while
 * the replay stands still. Every beacon is answered locally by `captureBeacons`.
 *
 * `next dev` runs React in Strict Mode, which mounts every effect twice: the
 * first test's "exactly one open" is the regression test for the once-guard.
 *
 * Beacons are sent asynchronously, so assertions poll.
 */

const plan = loadArtifact('canonical').manifest.beatPlan;
const BEAT_SLACK_MS = 3_000;

async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
}

async function advance(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 1000) await page.clock.runFor(Math.min(1000, left));
}

async function openRun(page: Page): Promise<Beacon[]> {
  const beacons = await captureBeacons(page);
  await freezeClock(page);
  await page.goto('/run/canonical');
  await expect(page.getByTestId('status-model-a')).toHaveText('Ready');
  await expect
    .poll(() => names(beacons), {
      message: 'no run-open beacon — is a dev server without UMAMI_WEBSITE_ID being reused? Stop it and re-run.',
    })
    .toEqual(['run-open']);
  return beacons;
}

test('opens once, and marks 30 seconds on the replay clock', async ({ page }) => {
  test.setTimeout(120_000);
  const beacons = await openRun(page);

  await advance(page, 29_000);
  expect(names(beacons)).toEqual(['run-open']);

  await advance(page, 1_000 + BEAT_SLACK_MS);
  await expect.poll(() => names(beacons)).toEqual(['run-open', 'run-t30']);
});

test('paused time never counts toward 30 seconds', async ({ page }) => {
  test.setTimeout(120_000);
  const beacons = await openRun(page);

  await advance(page, 10_000);
  await page.getByTestId('play-toggle').click();
  await expect(page.getByTestId('replay')).toHaveAttribute('data-state', 'paused');
  await advance(page, 60_000);

  await expect(page.getByTestId('replay')).toHaveAttribute('data-state', 'paused');
  expect(names(beacons)).toEqual(['run-open']);
});

test('completes once — a restart counts nothing again', async ({ page }) => {
  test.setTimeout(200_000);
  const beacons = await openRun(page);

  await advance(page, plan.totalMs + 500);
  await expect(page.getByTestId('replay')).toHaveAttribute('data-state', 'ended');
  await expect.poll(() => names(beacons)).toEqual(['run-open', 'run-t30', 'run-complete']);

  await page.getByTestId('restart').click();
  await advance(page, plan.totalMs + 500);
  await expect(page.getByTestId('replay')).toHaveAttribute('data-state', 'ended');
  expect(names(beacons)).toEqual(['run-open', 'run-t30', 'run-complete']);
});

test('a skip is its own event, never a completion', async ({ page }) => {
  test.setTimeout(120_000);
  const beacons = await openRun(page);

  await advance(page, 5_000);
  await page.getByTestId('skip-to-results').click();
  await expect(page.getByTestId('results')).toBeVisible();
  await expect.poll(() => names(beacons)).toEqual(['run-open', 'run-skip']);
});

test('a beacon says four things: the site, the host, the run path and the event', async ({ page }) => {
  test.setTimeout(120_000);
  const beacons = await openRun(page);
  await advance(page, 30_000 + BEAT_SLACK_MS);
  await expect.poll(() => beacons.length).toBe(2);

  for (const { method, path, body } of beacons) {
    expect(method).toBe('POST');
    expect(path).toBe('/api/send');
    expect(body.type).toBe('event');
    expect(Object.keys(body.payload).sort()).toEqual(['hostname', 'name', 'url', 'website']);
    expect(body.payload.url).toBe('/run/canonical');
    expect(body.payload.website).toBe(TEST_WEBSITE_ID);
    expect(body.payload.hostname).toBe('localhost');
  }
});

test('the /replay preview sends nothing', async ({ page }) => {
  test.setTimeout(120_000);
  const beacons = await captureBeacons(page);
  await freezeClock(page);
  await page.goto('/replay');
  await expect(page.getByTestId('replay')).toBeVisible();
  await advance(page, 40_000);
  expect(beacons).toEqual([]);
});
