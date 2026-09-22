import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Convention this ticket establishes: Vitest owns `*.test.ts(x)` (fast, unit),
 * Playwright owns `*.spec.ts` (renders a real browser). The two runners never
 * pick up each other's files. Playwright is not installed yet — TICKET-8 (#5)
 * is the first ticket that will want it — but the split is declared now so the
 * naming convention is in place before there is anything to rename.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['{lib,fixtures,scripts}/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
