import { expect, test, type Page } from '@playwright/test';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { BEAT_MS, buildReplay, buildSceneLayout, INTRO_MS, LANE_OFFSET_MS, planBeats } from '@/lib/replay';

/**
 * The browser smoke test for the replay player — the one layer Vitest cannot
 * reach. Everything the components DECIDE is a pure function tested in
 * `lib/replay`; this checks that they actually render: a WebGL canvas, both
 * lanes, the model's own words, and a run played through to its end.
 *
 * Playwright's fake clock drives `requestAnimationFrame`, which is the replay's
 * only clock (`components/scene/usePlayback.ts`), so the 79.5 s replay plays
 * out in seconds. Time is advanced in chunks so rAF callbacks fire in between.
 */

const log = loadCanonicalLog();
const data = buildReplay({ log, run: loadCanonicalRun(), layout: buildSceneLayout(loadCanonicalRoom()) });
const plan = planBeats(data);

function intentOf(competitorId: string, seq: number): string {
  return log.find((e) => e.competitorId === competitorId && e.seq === seq)!.action!.intent;
}

async function advance(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 1000) await page.clock.runFor(Math.min(1000, left));
}

test('renders a WebGL canvas and both lanes, with no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/replay');
  const canvas = page.locator('[data-testid=replay-canvas] canvas');
  await expect(canvas).toBeVisible();
  const webgl = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  });
  expect(webgl).toBe(true);
  await expect(page.getByTestId('panel-model-a')).toContainText('competitor-a');
  await expect(page.getByTestId('panel-model-b')).toContainText('competitor-b');
  expect(errors).toEqual([]);
});

test('shows each intent verbatim, lane by lane, with real think-time', async ({ page }) => {
  await page.clock.install();
  await page.goto('/replay');
  await expect(page.getByTestId('status-model-a')).toHaveText('Ready');

  await advance(page, INTRO_MS + 100);
  await expect(page.getByTestId('intent-model-a')).toHaveText(intentOf('model-a', 0));
  await expect(page.getByTestId('think-model-a')).toContainText('2.1 s');
  await expect(page.getByTestId('status-model-b')).toHaveText('Ready');

  await advance(page, LANE_OFFSET_MS);
  await expect(page.getByTestId('intent-model-b')).toHaveText(intentOf('model-b', 0));
  await expect(page.getByTestId('think-model-b')).toContainText('2.0 s');

  await advance(page, BEAT_MS);
  await expect(page.getByTestId('intent-model-a')).toHaveText(intentOf('model-a', 2));
});

test('plays to the end, then restarts', async ({ page }) => {
  test.setTimeout(150_000);
  await page.clock.install();
  await page.goto('/replay');
  const root = page.getByTestId('replay');
  await expect(root).toHaveAttribute('data-state', 'playing');

  await advance(page, plan.totalMs + 500);
  await expect(root).toHaveAttribute('data-state', 'ended');
  await expect(page.getByTestId('status-model-a')).toHaveText('Escaped in 13 actions');
  await expect(page.getByTestId('status-model-b')).toHaveText('Out of actions');

  await page.getByTestId('restart').click();
  await expect(root).toHaveAttribute('data-state', 'playing');
  await expect(page.getByTestId('status-model-a')).toHaveText('Ready');
});

test('stacks the lanes on a phone without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/replay');
  await expect(page.getByTestId('panel-model-b')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
