import { defineConfig, devices } from '@playwright/test';
import { TEST_WEBSITE_ID } from './e2e/telemetry';

/**
 * Playwright owns `*.spec.ts` under `e2e/`; Vitest owns `*.test.ts(x)`. The two
 * runners never pick up each other's files (`vitest.config.mts`). TICKET-8 (#5)
 * is the first ticket with something a browser has to render.
 *
 * Headless Chromium has no GPU, so WebGL runs on SwiftShader — the flags below
 * opt into it explicitly, since newer Chromium no longer falls back silently.
 */

const PORT = 3100;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  // One browser at a time. SwiftShader renders WebGL on the CPU, and two replays
  // playing side by side (a spec file per worker) starve each other until the
  // playback tests time out. TICKET-9 (#9) added the second spec file.
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: `http://localhost:${PORT}/replay`,
    reuseExistingServer: !process.env.CI,
    // TICKET-11 (#11): `/run/<id>` renders its telemetry wrapper only with a
    // website id. `process.env` beats `.env` in Next's load order, so e2e never
    // uses a real id — and the specs intercept every beacon regardless. A dev
    // server you already had running without this is reused as-is, and
    // `e2e/telemetry.spec.ts` says so.
    env: { UMAMI_WEBSITE_ID: TEST_WEBSITE_ID },
    timeout: 120_000,
  },
});
