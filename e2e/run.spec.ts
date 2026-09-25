import { expect, test, type Page } from '@playwright/test';
import { loadArtifact } from '@/lib/artifact';

/**
 * The published run in a real browser — TICKET-9 (#9).
 *
 * Everything is timed from the artifact's OWN frozen beat plan, never from the
 * live renderer's constants: if `/run/canonical` ever started pacing itself from
 * `lib/replay/beats.ts`, a retune would break these tests, which is the point.
 *
 * And it proves the replay bundle is one-way at runtime: through a full playback,
 * every request the page makes is to its own origin — no provider, no CDN, no
 * endpoint of any kind.
 */

const artifact = loadArtifact('canonical');
const plan = artifact.manifest.beatPlan;

function intentOf(competitorId: string, seq: number): string {
  return artifact.log.find((e) => e.competitorId === competitorId && e.seq === seq)!.action!.intent;
}

/**
 * Fake time that moves ONLY when the test advances it. A bare `clock.install()`
 * keeps flowing in real time, so however long the page takes to load leaks into
 * the replay's clock and a beat-exact assertion passes or fails with machine load.
 */
async function freezeClock(page: Page): Promise<void> {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
}

async function advance(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 1000) await page.clock.runFor(Math.min(1000, left));
}

test('plays the frozen artifact to its published end', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await freezeClock(page);
  await page.goto('/run/canonical');
  await expect(page.getByTestId('status-model-a')).toHaveText('Ready');

  // The canvas mounts on timers (a dynamic import, a resize), so it appears once paused time moves.
  await advance(page, plan.introMs + 100);
  await expect(page.locator('[data-testid=replay-canvas] canvas')).toBeVisible();
  await expect(page.getByTestId('intent-model-a')).toHaveText(intentOf('model-a', 0));

  await advance(page, plan.totalMs);
  await expect(page.getByTestId('replay')).toHaveAttribute('data-state', 'ended');
  await expect(page.getByTestId('status-model-a')).toHaveText('Escaped in 13 actions');
  await expect(page.getByTestId('status-model-b')).toHaveText('Out of actions');
  expect(errors).toEqual([]);
});

test('makes no request beyond its own origin, start to finish', async ({ page, baseURL }) => {
  test.setTimeout(150_000);
  const origin = new URL(baseURL!).origin;
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('websocket', (ws) => requests.push(ws.url()));

  await freezeClock(page);
  await page.goto('/run/canonical');
  await advance(page, plan.totalMs + 500);
  await expect(page.getByTestId('replay')).toHaveAttribute('data-state', 'ended');

  expect(requests.length).toBeGreaterThan(0);
  // `next dev`'s HMR socket is ws:// on the same host — compare host, not scheme.
  const foreign = requests.filter((u) => new URL(u).host !== new URL(origin).host);
  expect(foreign).toEqual([]);
  expect(requests.filter((u) => /groq|googleapis/.test(u))).toEqual([]);
});

test('takes its lane colours from the manifest', async ({ page }) => {
  await page.goto('/run/canonical');
  const laneA = await page
    .getByTestId('replay')
    .evaluate((el) => getComputedStyle(el).getPropertyValue('--lane-a').trim());
  expect(laneA).toBe(artifact.manifest.assets.laneColours[0]);
});

test('an unpublished id is a 404', async ({ page }) => {
  const response = await page.goto('/run/does-not-exist');
  expect(response?.status()).toBe(404);
});
