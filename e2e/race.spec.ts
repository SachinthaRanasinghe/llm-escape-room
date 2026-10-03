import { expect, test, type Page } from '@playwright/test';
import { comparisonFromArtifact, loadArtifact, replayFromArtifact } from '@/lib/artifact';
import { buildStoppedComparison } from '@/lib/comparison';
import type { CatalogueResponse, RaceMessage, RaceRequest } from '@/lib/race/wire';
import { captureBeacons } from './telemetry';

/**
 * The local race page, with both API routes answered by the test — no key, no
 * provider call, no quota. The race is the canonical published run: its beats
 * are streamed as the live race, and what plays at the end is a real replay
 * through the real player.
 */

const CATALOGUE: CatalogueResponse = {
  providers: [
    {
      provider: 'groq',
      name: 'Groq',
      keyVar: 'GROQ_API_KEY',
      keySet: true,
      models: [
        { modelId: 'openai/gpt-oss-120b', label: 'openai/gpt-oss-120b', contextWindow: 131072, price: null },
        { modelId: 'openai/gpt-oss-20b', label: 'openai/gpt-oss-20b', contextWindow: 131072, price: null },
      ],
      excluded: [{ modelId: 'qwen/qwen3.8-27b', reason: 'Free tier allows 1,000 output tokens per minute, less than one turn' }],
      error: null,
    },
    {
      provider: 'gemini',
      name: 'Google Gemini',
      keyVar: 'GEMINI_API_KEY',
      keySet: true,
      models: [{ modelId: 'gemini-flash-latest', label: 'Gemini Flash Latest', contextWindow: 1048576, price: null }],
      excluded: [],
      error: null,
    },
    {
      provider: 'openrouter',
      name: 'OpenRouter',
      keyVar: 'OPENROUTER_API_KEY',
      keySet: false,
      models: [{ modelId: 'google/gemma-4-31b-it:free', label: 'Google: Gemma 4 31B (free)', contextWindow: 262144, price: null }],
      excluded: [],
      error: null,
    },
  ],
  rooms: [{ id: 'canonical-study', label: "The Cartographer's Study (fixture)" }],
  maxRepeats: 3,
  defaultRepeats: 1,
  hosted: false,
};

const artifact = loadArtifact('canonical');
const { data, renderer } = replayFromArtifact(artifact);

function stream(messages: readonly RaceMessage[]): string {
  return messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
}

const STARTED: RaceMessage = {
  type: 'started',
  runId: 'race-test',
  roomLabel: "The Cartographer's Study (fixture)",
  competitors: [
    { id: 'model-a', provider: 'groq', modelId: 'openai/gpt-oss-120b' },
    { id: 'model-b', provider: 'gemini', modelId: 'gemini-flash-latest' },
  ],
  budget: { maxActions: 14 },
  repeats: 1,
  layout: data.layout,
  renderer,
};

/** Every action of the canonical run, as the server streams them while it runs. */
function beats(): RaceMessage[] {
  return data.lanes.flatMap((lane) =>
    lane.beats.map((beat, i): RaceMessage => ({
      type: 'beat',
      competitorId: lane.competitorId,
      beat,
      ended: i === lane.beats.length - 1 ? lane.endedBecause : null,
    })),
  );
}

/**
 * `/api/race` as a stream the TEST writes to, one message at a time — what a
 * live race looks like from the page. `page.route` can only answer with a whole
 * body, so the page's `fetch` is wrapped instead.
 */
async function openRaceStream(page: Page): Promise<(message: RaceMessage | 'close') => Promise<void>> {
  await page.addInitScript(() => {
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/race')) return real(input, init);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          (window as unknown as { __race: unknown }).__race = {
            push: (line: string) => controller.enqueue(encoder.encode(`${line}\n`)),
            close: () => controller.close(),
          };
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'application/x-ndjson' } }));
    };
  });
  return async (message) => {
    await page.evaluate((line) => {
      const race = (window as unknown as { __race: { push: (l: string) => void; close: () => void } }).__race;
      if (line === 'close') race.close();
      else race.push(line);
    }, message === 'close' ? 'close' : JSON.stringify(message));
  };
}

async function advance(page: Page, ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 1000) await page.clock.runFor(Math.min(1000, left));
}

async function serveCatalogue(page: Page): Promise<void> {
  await page.route('**/api/models**', (route) => route.fulfill({ json: CATALOGUE }));
}

test.beforeEach(async ({ page }) => {
  await captureBeacons(page);
  await serveCatalogue(page);
});

test('offers every free model grouped by provider, and greys out a provider with no key', async ({ page }) => {
  await page.goto('/race');
  const select = page.getByTestId('model-a-select');
  await expect(select).toBeVisible();

  await expect(select.locator('optgroup[label="Groq (2)"] option')).toHaveCount(2);
  await expect(select.locator('optgroup[label="Google Gemini (1)"] option')).toHaveCount(1);
  const openrouter = select.locator('optgroup[label="OpenRouter — set OPENROUTER_API_KEY to use"] option');
  await expect(openrouter).toHaveCount(1);
  await expect(openrouter.first()).toHaveAttribute('disabled', '');

  // Defaults to a cross-provider duel.
  await expect(select).toHaveValue('groq|openai/gpt-oss-120b');
  await expect(page.getByTestId('model-b-select')).toHaveValue('gemini|gemini-flash-latest');

  const notes = page.getByTestId('provider-notes');
  await expect(notes).toContainText('3 free models ready to race');
  await expect(notes).toContainText('OPENROUTER_API_KEY');
  await notes.getByText('1 listed models left out').click();
  await expect(notes).toContainText('qwen/qwen3.8-27b');
});

test('sends the two picks, shows progress, then plays the race with its comparison', async ({ page }) => {
  let sent: RaceRequest | null = null;
  await page.route('**/api/race', async (route) => {
    sent = route.request().postDataJSON() as RaceRequest;
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: stream([
        STARTED,
        { type: 'phase', phase: { kind: 'hero' } },
        { type: 'action', competitorId: 'model-a', actions: 1 },
        ...beats(),
        {
          type: 'done',
          runId: 'race-test',
          savedTo: 'runs/race-test',
          publishCommand: 'node --import tsx scripts/publish.mts --run runs/race-test --room fixtures/rooms/valid/canonical-room.json',
          data,
          renderer,
          comparison: comparisonFromArtifact(artifact),
          providerCalls: 28,
          unpriced: [],
        },
      ]),
    });
  });

  await page.goto('/race');
  await page.getByTestId('model-b-select').selectOption('groq|openai/gpt-oss-20b');
  await page.getByTestId('repeats-select').selectOption('0');
  await page.getByTestId('race-start').click();

  await expect(page.getByTestId('race-live')).toBeVisible();
  expect(sent).toEqual({
    a: { provider: 'groq', modelId: 'openai/gpt-oss-120b' },
    b: { provider: 'groq', modelId: 'openai/gpt-oss-20b' },
    roomId: 'canonical-study',
    repeats: 0,
  });
  await expect(page.getByTestId('race-saved')).toContainText('runs/race-test');
  await expect(page.getByTestId('race-saved')).toContainText('28 provider calls');

  // The comparison waits for the live finish, or for a skip.
  await expect(page.getByTestId('results-heading')).toHaveCount(0);
  await page.getByTestId('skip-to-results').click();
  await expect(page.getByTestId('results-heading')).toBeVisible();

  // The saved run plays again from the start as a normal replay.
  await page.getByTestId('race-replay').click();
  await expect(page.getByTestId('replay')).toBeVisible();
  await page.getByTestId('skip-to-results').click();
  await expect(page.getByTestId('results-heading')).toBeVisible();

  await page.getByTestId('race-again').click();
  await expect(page.getByTestId('race-form')).toBeVisible();
});

test('shows a refused race and a failed one, and keeps the form to try again', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/race', async (route) => {
    calls += 1;
    if (calls === 1) {
      await route.fulfill({ status: 409, json: { error: 'a race is already running — wait for it to finish' } });
      return;
    }
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: stream([
        STARTED,
        { type: 'phase', phase: { kind: 'hero' } },
        {
          type: 'error',
          message: 'openrouter: upstream overloaded (status 200, 4 attempts). Nothing was published.',
          savedTo: 'runs/race-test',
          comparison: null,
        },
      ]),
    });
  });

  await page.goto('/race');
  await page.getByTestId('race-start').click();
  await expect(page.getByTestId('race-error')).toContainText('already running');

  await page.getByTestId('race-start').click();
  await expect(page.getByTestId('race-error')).toContainText('upstream overloaded');
  await expect(page.getByTestId('race-error')).toContainText('runs/race-test');
  await expect(page.getByTestId('race-start')).toBeEnabled();
});

test('says so when the stream ends without a result', async ({ page }) => {
  await page.route('**/api/race', async (route) => {
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body: stream([STARTED, { type: 'phase', phase: { kind: 'hero' } }, { type: 'action', competitorId: 'model-b', actions: 3 }]),
    });
  });
  await page.goto('/race');
  await page.getByTestId('race-start').click();
  await expect(page.getByTestId('race-error')).toContainText('closed before the race finished');
});

test('plays each action in 3D the moment it arrives, and waits while a model thinks', async ({ page }) => {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  const send = await openRaceStream(page);

  await page.goto('/race');
  await page.getByTestId('race-start').click();
  await send(STARTED);
  await send({ type: 'phase', phase: { kind: 'hero' } });

  // The scene is up before any model has answered.
  await expect(page.getByTestId('race-live')).toBeVisible();
  await advance(page, 4000);
  await expect(page.locator('[data-testid=replay-canvas] canvas')).toBeVisible();
  await expect(page.getByTestId('status-model-a')).toHaveText('Thinking about its first move…');

  // Model A answers: its first action plays at once, with its words.
  const [laneA, laneB] = data.lanes;
  await send({ type: 'beat', competitorId: 'model-a', beat: laneA!.beats[0]!, ended: null });
  await advance(page, 1000);
  await expect(page.getByTestId('intent-model-a')).toHaveText(laneA!.beats[0]!.intent!);
  await expect(page.getByTestId('status-model-b')).toHaveText('Thinking about its first move…');

  // Once the beat has played, lane A holds on its verdict until model A answers again.
  await advance(page, 6000);
  await expect(page.getByTestId('thinking-model-a')).toBeVisible();
  await expect(page.getByTestId('actions-model-a')).toContainText(`1 / ${laneA!.maxActions}`);

  await send({ type: 'beat', competitorId: 'model-a', beat: laneA!.beats[1]!, ended: null });
  await send({ type: 'beat', competitorId: 'model-b', beat: laneB!.beats[0]!, ended: null });
  await advance(page, 1000);
  await expect(page.getByTestId('intent-model-a')).toHaveText(laneA!.beats[1]!.intent!);
  await expect(page.getByTestId('intent-model-b')).toHaveText(laneB!.beats[0]!.intent!);
  await expect(page.getByTestId('thinking-model-a')).toHaveCount(0);

  await page.getByTestId('race-cancel').click();
  await expect(page.getByTestId('race-error')).toContainText('cancelled');
});

test('shows the result the moment the main run ends, while the silent repeats still run', async ({ page }) => {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  const send = await openRaceStream(page);

  await page.goto('/race');
  await page.getByTestId('race-start').click();
  await send(STARTED);
  await send({ type: 'phase', phase: { kind: 'hero' } });
  await expect(page.getByTestId('race-live')).toBeVisible();

  // One action each, and both runs end on it.
  const [laneA, laneB] = data.lanes;
  await send({ type: 'beat', competitorId: 'model-a', beat: laneA!.beats[0]!, ended: 'escaped' });
  await send({ type: 'beat', competitorId: 'model-b', beat: laneB!.beats[0]!, ended: 'budget_actions' });
  const early = comparisonFromArtifact(artifact);
  await send({
    type: 'result',
    comparison: { ...early, variance: { kind: 'pending', title: 'Checking for luck…', body: 'Re-running.' } },
  });
  await send({ type: 'phase', phase: { kind: 'repeat', index: 1, of: 1 } });

  // Each lane's one action plays out; the results follow at once — no `done` yet, the repeat is still running.
  await advance(page, 6000);
  await expect(page.getByTestId('results-heading')).toBeVisible();
  await expect(page.getByTestId('variance')).toHaveAttribute('data-kind', 'pending');
  await expect(page.getByTestId('race-progress')).toContainText('silent repeat 1 of 1');

  await page.getByTestId('race-cancel').click();
});

test('keeps the 3D race on screen when a provider stops it, and shows the results so far', async ({ page }) => {
  const [laneA, laneB] = data.lanes;
  const stopped = buildStoppedComparison({
    lanes: [
      { competitorId: 'model-a', label: laneA!.label, provider: 'groq', actions: 2, puzzlesSolved: 0, failedAttempts: 0, invalidActions: 0, tokens: { prompt: 3000, completion: 90 }, costUsd: 0 },
      { competitorId: 'model-b', label: laneB!.label, provider: 'gemini', actions: 1, puzzlesSolved: 0, failedAttempts: 0, invalidActions: 0, tokens: { prompt: 1500, completion: 40 }, costUsd: 0 },
    ],
    maxActions: 14,
    puzzleCount: 3,
    failedCompetitorId: 'model-b',
    status: 429,
    savedTo: 'runs/race-test',
  });
  await page.route('**/api/race', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body: stream([
        STARTED,
        { type: 'phase', phase: { kind: 'hero' } },
        { type: 'beat', competitorId: 'model-a', beat: laneA!.beats[0]!, ended: null },
        { type: 'beat', competitorId: 'model-b', beat: laneB!.beats[0]!, ended: null },
        { type: 'beat', competitorId: 'model-a', beat: laneA!.beats[1]!, ended: null },
        {
          type: 'error',
          message: 'gemini: gave up: quota (status 429, 4 attempts). Nothing was published.',
          savedTo: 'runs/race-test',
          comparison: stopped,
        },
      ]),
    }),
  );

  await page.goto('/race');
  await page.getByTestId('race-start').click();

  await expect(page.getByTestId('race-live')).toBeVisible();
  await expect(page.getByTestId('race-stopped')).toContainText('quota');
  await expect(page.getByTestId('race-form')).toHaveCount(0);

  await page.getByTestId('skip-to-results').click();
  await expect(page.getByTestId('results-heading')).toHaveText(stopped.headline);
  await expect(page.getByTestId('cell-result-model-b')).toHaveText('Provider error after 1 action');
  await expect(page.getByTestId('cell-actions-model-a')).toHaveText('2 / 14');
  await expect(page.getByTestId('variance')).toHaveAttribute('data-kind', 'stopped');

  await page.getByTestId('race-again').click();
  await expect(page.getByTestId('race-form')).toBeVisible();
});

test('on the hosted site, queues the race, follows it by polling, and offers nothing to save', async ({ page }) => {
  const hosted: CatalogueResponse = {
    ...CATALOGUE,
    providers: CATALOGUE.providers.filter((p) => p.keySet),
    maxRepeats: 1,
    hosted: true,
  };
  await page.route('**/api/models**', (route) => route.fulfill({ json: hosted }));
  const raceId = '0b6f2f0e-6c7e-4c1a-9a51-3f1a0f3c2d11';
  await page.route('**/api/race', (route) => route.fulfill({ status: 202, json: { raceId } }));
  const messages: RaceMessage[] = [
    STARTED,
    { type: 'phase', phase: { kind: 'hero' } },
    ...beats(),
    {
      type: 'done',
      runId: 'race-test',
      savedTo: null,
      publishCommand: null,
      data,
      renderer,
      comparison: comparisonFromArtifact(artifact),
      providerCalls: 28,
      unpriced: [],
    },
  ];
  const asked: number[] = [];
  await page.route(new RegExp(`/api/race/${raceId}\\?from=`), (route) => {
    const from = Number(new URL(route.request().url()).searchParams.get('from'));
    asked.push(from);
    // Half the messages on the first poll, the rest on the next: the page must carry on from `next`.
    const half = Math.ceil(messages.length / 2);
    const slice = from === 0 ? messages.slice(0, half) : messages.slice(from);
    return route.fulfill({ json: { messages: slice, next: from + slice.length, finished: from + slice.length === messages.length } });
  });

  await page.goto('/race');
  await expect(page.getByTestId('public-limits')).toBeVisible();
  await expect(page.getByTestId('provider-notes')).not.toContainText('.env');
  await expect(page.getByTestId('repeats-select').locator('option')).toHaveCount(2);
  await page.getByTestId('race-start').click();

  await expect(page.getByTestId('race-saved')).toContainText('Race finished', { timeout: 15_000 });
  await expect(page.getByTestId('race-saved')).toContainText('28 provider calls');
  await expect(page.getByTestId('race-saved')).not.toContainText('Saved to');
  await expect(page.getByText('Publish this run')).toHaveCount(0);
  expect(asked.slice(0, 2)).toEqual([0, Math.ceil(messages.length / 2)]);
});
