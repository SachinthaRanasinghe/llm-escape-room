import { expect as baseExpect, test } from '@playwright/test';

// The arena is a WebGL scene, and headless Chromium renders WebGL on the CPU
// (SwiftShader): creating its context can stall the page for a few seconds
// while the GPU process catches up. What the specs check is unaffected — only
// how long it takes to show — so they wait longer than the default 5s.
const expect = baseExpect.configure({ timeout: 15_000 });
import type { ArenaMessage, ArenaRequest, ArenaStandingsView, ArenaTurnView } from '@/lib/race/arena-wire';
import type { CatalogueResponse } from '@/lib/race/wire';

/**
 * The Energy Cores arena page, with `/api/models` and `/api/arena` answered by
 * the test — no key, no provider call, no quota. A short scripted match is
 * streamed (locally) or polled (hosted), and the page must draw every turn, the
 * board and the standings from it.
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
      excluded: [],
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
  rooms: [],
  maxRepeats: 3,
  defaultRepeats: 1,
  hosted: false,
};

const PLAYERS = [
  { id: 'player-a', provider: 'groq', modelId: 'openai/gpt-oss-120b' },
  { id: 'player-b', provider: 'gemini', modelId: 'gemini-flash-latest' },
  { id: 'player-c', provider: 'groq', modelId: 'openai/gpt-oss-20b' },
] as const;

const SQL_PROMPT = 'Table t has one column x with four rows: 1, 2, NULL, 4.\n\nWhat does this query return?\nSELECT COUNT(x) FROM t;\nAnswer with a single integer.';

function turn(partial: Partial<ArenaTurnView> & Pick<ArenaTurnView, 'seq' | 'round' | 'playerId' | 'action' | 'outcome' | 'cores' | 'centre'>): ArenaTurnView {
  return {
    targetId: null,
    intent: null,
    decisionMessage: '',
    question: null,
    answerGiven: null,
    answerIntent: null,
    correct: null,
    expected: null,
    answerMessage: null,
    eliminated: null,
    latencyMs: 2400,
    ...partial,
  };
}

const TURNS: ArenaTurnView[] = [
  turn({
    seq: 0,
    round: 1,
    playerId: 'player-a',
    action: 'claim',
    intent: 'A free core is the cheapest point on the board.',
    question: { category: 'sql', tier: 'medium', prompt: SQL_PROMPT },
    answerGiven: '3',
    answerIntent: 'COUNT(x) skips the NULL.',
    correct: true,
    expected: '3',
    outcome: 'claimed',
    cores: { 'player-a': 2, 'player-b': 1, 'player-c': 1 },
    centre: 1,
  }),
  turn({
    seq: 1,
    round: 1,
    playerId: 'player-b',
    action: 'steal',
    targetId: 'player-c',
    intent: 'C has a single core: knock them out early.',
    question: { category: 'math', tier: 'hard', prompt: 'What are the last two digits of 7^2026? Answer with a single integer.' },
    answerGiven: '43',
    correct: false,
    expected: '49',
    outcome: 'failed',
    cores: { 'player-a': 2, 'player-b': 1, 'player-c': 1 },
    centre: 1,
  }),
  turn({ seq: 2, round: 1, playerId: 'player-c', action: 'pass', intent: 'Wait for the others to spend themselves.', outcome: 'passed', cores: { 'player-a': 2, 'player-b': 1, 'player-c': 1 }, centre: 1 }),
  turn({
    seq: 3,
    round: 2,
    playerId: 'player-b',
    action: 'steal',
    targetId: 'player-c',
    intent: 'Try C again.',
    question: { category: 'cs', tier: 'hard', prompt: 'How many structurally distinct binary search trees can store the 5 distinct keys 1, 2, 3, 4, 5? Answer with a single integer.' },
    answerGiven: '42',
    correct: true,
    expected: '42',
    outcome: 'stole',
    eliminated: 'player-c',
    cores: { 'player-a': 2, 'player-b': 2, 'player-c': 0 },
    centre: 1,
  }),
  turn({
    seq: 4,
    round: 2,
    playerId: 'player-a',
    action: 'claim',
    intent: 'Take the last centre core to lead.',
    question: { category: 'math', tier: 'medium', prompt: 'What is 2^20 mod 1000? Answer with a single integer.' },
    answerGiven: '576',
    correct: true,
    expected: '576',
    outcome: 'claimed',
    cores: { 'player-a': 3, 'player-b': 2, 'player-c': 0 },
    centre: 0,
  }),
];

const STANDINGS: ArenaStandingsView = {
  endedBecause: 'round_cap',
  roundsPlayed: 3,
  maxRounds: 3,
  winners: ['player-a'],
  outcome: 'win',
  standings: [
    { playerId: 'player-a', provider: 'groq', modelId: 'openai/gpt-oss-120b', cores: 3, eliminatedInRound: null, claims: 2, steals: 0, passes: 0, correct: 2, wrong: 0, invalid: 0, tokens: { prompt: 900, completion: 120 }, latencyMs: 4800, costUsd: 0, turns: 2 },
    { playerId: 'player-b', provider: 'gemini', modelId: 'gemini-flash-latest', cores: 2, eliminatedInRound: null, claims: 0, steals: 1, passes: 0, correct: 1, wrong: 1, invalid: 0, tokens: { prompt: 950, completion: 140 }, latencyMs: 4800, costUsd: 0, turns: 2 },
    { playerId: 'player-c', provider: 'groq', modelId: 'openai/gpt-oss-20b', cores: 0, eliminatedInRound: 2, claims: 0, steals: 0, passes: 1, correct: 0, wrong: 0, invalid: 0, tokens: { prompt: 300, completion: 20 }, latencyMs: 2400, costUsd: 0, turns: 1 },
  ],
};

const MATCH: ArenaMessage[] = [
  { type: 'started', matchId: 'arena-test', players: [...PLAYERS], maxRounds: 3, cores: { 'player-a': 1, 'player-b': 1, 'player-c': 1 }, centre: 2 },
  { type: 'thinking', playerId: 'player-a', phase: 'decide', round: 1, question: null },
  ...TURNS.map((t): ArenaMessage => ({ type: 'turn', turn: t })),
  { type: 'done', matchId: 'arena-test', result: STANDINGS, savedTo: 'runs/arena-test', providerCalls: 9, unpriced: [] },
];

function stream(messages: readonly ArenaMessage[]): string {
  return messages.map((m) => JSON.stringify(m)).join('\n') + '\n';
}

// These specs check what the page shows, not how it moves: reduced motion makes
// playback jump straight to the latest turn. The cinematic has its own spec below.
test.use({ reducedMotion: 'reduce' });

async function expectFinishedMatch(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.getByTestId('arena-board')).toBeVisible();
  await expect(page.getByTestId('arena-turn')).toHaveCount(5);
  await expect(page.getByTestId('base-player-a-cores')).toHaveText('3');
  await expect(page.getByTestId('base-player-b-cores')).toHaveText('2');
  await expect(page.getByTestId('centre-cores')).toHaveText('0');
  await expect(page.getByTestId('base-player-c')).toContainText('ELIMINATED');
  await expect(page.getByTestId('arena-winner')).toHaveText('Winner: openai/gpt-oss-120b');
}

test('offers three model pickers with distinct free defaults', async ({ page }) => {
  await page.route('**/api/models**', (route) => route.fulfill({ json: CATALOGUE }));
  await page.goto('/arena');
  await expect(page.getByTestId('player-a-select')).toHaveValue('groq|openai/gpt-oss-120b');
  await expect(page.getByTestId('player-b-select')).toHaveValue('gemini|gemini-flash-latest');
  await expect(page.getByTestId('player-c-select')).toHaveValue('groq|openai/gpt-oss-20b');
  await expect(page.getByTestId('arena-quota')).toContainText('up to 60 calls');
});

test('sends the three picks, draws every turn on the board, and ends on the standings', async ({ page }) => {
  await page.route('**/api/models**', (route) => route.fulfill({ json: CATALOGUE }));
  let sent: ArenaRequest | null = null;
  await page.route('**/api/arena', async (route) => {
    sent = route.request().postDataJSON() as ArenaRequest;
    await route.fulfill({ contentType: 'application/x-ndjson', body: stream(MATCH) });
  });

  await page.goto('/arena');
  await page.getByTestId('rounds-select').selectOption('3');
  await page.getByTestId('arena-start').click();

  await expectFinishedMatch(page);
  expect(sent).toEqual({
    players: [
      { provider: 'groq', modelId: 'openai/gpt-oss-120b' },
      { provider: 'gemini', modelId: 'gemini-flash-latest' },
      { provider: 'groq', modelId: 'openai/gpt-oss-20b' },
    ],
    rounds: 3,
  });

  // Newest first, intent quoted verbatim.
  const newest = page.getByTestId('arena-turn').first();
  await expect(newest.getByTestId('arena-intent')).toHaveText('“Take the last centre core to lead.”');
  const oldest = page.getByTestId('arena-turn').last();
  await oldest.getByText('medium sql question').click();
  await expect(oldest.getByText('SELECT COUNT(x) FROM t;')).toBeVisible();
  await expect(oldest).toContainText('✓ correct');
  const failed = page.getByTestId('arena-turn').nth(3);
  await expect(failed).toContainText('Failed');
  await expect(failed).toContainText('✗ wrong');

  await expect(page.getByTestId('arena-done')).toContainText('saved to runs/arena-test');
  await page.getByTestId('arena-again').click();
  await expect(page.getByTestId('arena-form')).toBeVisible();
});

test('shows a refused match and keeps the form', async ({ page }) => {
  await page.route('**/api/models**', (route) => route.fulfill({ json: CATALOGUE }));
  await page.route('**/api/arena', (route) => route.fulfill({ status: 409, json: { error: 'a race or match is already running — wait for it to finish' } }));
  await page.goto('/arena');
  await page.getByTestId('arena-start').click();
  await expect(page.getByTestId('arena-error')).toContainText('already running');
  await expect(page.getByTestId('arena-start')).toBeEnabled();
});

test('keeps the board and shows standings so far, with no winner, when a provider stops the match', async ({ page }) => {
  await page.route('**/api/models**', (route) => route.fulfill({ json: CATALOGUE }));
  const partial: ArenaStandingsView = { ...STANDINGS, endedBecause: null, outcome: null, winners: [], roundsPlayed: 1 };
  await page.route('**/api/arena', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body: stream([
        MATCH[0]!,
        { type: 'turn', turn: TURNS[0]! },
        { type: 'error', message: 'arena-test: match aborted after 1 turn(s): player-b: gemini: quota exceeded (status 429, 3 attempts). No winner is named.', savedTo: null, standings: partial },
      ]),
    }),
  );
  await page.goto('/arena');
  await page.getByTestId('arena-start').click();
  await expect(page.getByTestId('arena-error')).toContainText('No winner is named');
  await expect(page.getByTestId('arena-turn')).toHaveCount(1);
  await expect(page.getByTestId('arena-winner')).toContainText('No winner');
});

test('on the hosted site, queues the match and follows it by polling', async ({ page }) => {
  const hosted: CatalogueResponse = { ...CATALOGUE, providers: CATALOGUE.providers.filter((p) => p.keySet), hosted: true };
  await page.route('**/api/models**', (route) => route.fulfill({ json: hosted }));
  const raceId = '0b8f7c62-3c1e-4f43-9d4e-3a4c5e6f7a81';
  await page.route('**/api/arena', (route) => route.fulfill({ status: 202, json: { raceId } }));
  await page.route(new RegExp(`/api/arena/${raceId}\\?from=`), (route) => {
    const from = Number(new URL(route.request().url()).searchParams.get('from'));
    // Half on the first poll, the rest on the next: the page must carry on from `next`.
    const slice = from === 0 ? MATCH.slice(0, 4) : MATCH.slice(from);
    return route.fulfill({ json: { messages: slice, next: from + slice.length, finished: from + slice.length === MATCH.length } });
  });

  await page.goto('/arena');
  await expect(page.getByTestId('arena-quota')).toContainText('watched, not saved');
  await page.getByTestId('arena-start').click();
  await expectFinishedMatch(page);
});

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('replays a turn as a challenge — question, answer, verdict — before the board moves, and can skip to the end', async ({ page }) => {
    await page.route('**/api/models**', (route) => route.fulfill({ json: CATALOGUE }));
    await page.route('**/api/arena', (route) => route.fulfill({ contentType: 'application/x-ndjson', body: stream(MATCH) }));
    await page.goto('/arena');
    await page.getByTestId('arena-start').click();

    // The first turn is replayed: the board still shows the opening while the challenge is up.
    const challenge = page.getByTestId('arena-challenge');
    await expect(challenge).toContainText('SELECT COUNT(x) FROM t;');
    await expect(page.getByTestId('base-player-a-cores')).toHaveText('1');
    await expect(page.getByTestId('arena-action')).toContainText('CLAIM');
    await expect(page.getByTestId('arena-verdict')).toContainText('Correct');
    await expect(page.getByTestId('base-player-a-cores')).toHaveText('2');
    await expect(page.getByTestId('centre-cores')).toHaveText('1');

    // The rest of the match is already in: skip the replay and land on the result.
    await page.getByTestId('arena-skip').click();
    await expectFinishedMatch(page);
  });
});
