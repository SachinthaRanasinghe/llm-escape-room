# Implementation Report — Watch-through telemetry (TICKET-11, #11)

**Plan**: `.claude/plans/watch-through-telemetry.md`   **Branch**: `feature/watch-through-telemetry`   **Status**: COMPLETE (manual Umami check pending, since it needs the user's account)

## Summary
Published runs (`/run/<id>`) now post four anonymous, at-most-once events to Umami Cloud: `run-open`, `run-t30`
(30 s on the replay clock), `run-complete` and `run-skip`. Each beacon carries exactly four fields. Telemetry is on
only when `UMAMI_WEBSITE_ID` is set at `next build`, and an invalid id fails the build. `scripts/watch-through.mts`
reads the counts back and prints each run's funnel against the PRD's ≥ 50% target. The scene player stays
network-free and gains only an `onProgress` callback.

## Tasks completed
- Phase 0: committed TICKET-10 (`a919ab7`, user-approved) and branched → `feature/watch-through-telemetry`
- `PlaybackProgress` type → `lib/replay/types.ts` (UPDATE)
- Event vocabulary → `lib/telemetry/events.ts` (CREATE)
- Watch tracker → `lib/telemetry/tracker.ts` (CREATE)
- Build-time config → `lib/telemetry/config.ts` (CREATE)
- Payload + transport → `lib/telemetry/umami.ts`, `lib/telemetry/testing.ts` (CREATE)
- Funnel → `lib/telemetry/funnel.ts` (CREATE)
- Read API client → `lib/telemetry/readout.ts` (CREATE)
- Barrel → `lib/telemetry/index.ts` (CREATE)
- Boundary sweep → `lib/telemetry/boundary.test.ts` (CREATE)
- Secrets sweep: second env reader + `lib/telemetry` on the artifact side → `lib/providers/secrets.test.ts` (UPDATE)
- `onProgress` → `components/scene/ReplayPlayer.tsx` (UPDATE)
- Client wrapper → `components/telemetry/TrackedReplay.tsx` (CREATE)
- Server page switch → `app/run/[id]/page.tsx` (UPDATE)
- Readout CLI → `scripts/watch-through.mts` (CREATE)
- E2E server env → `playwright.config.ts` (UPDATE), helper `e2e/telemetry.ts` (CREATE)
- Own-origin test allows exactly `cloud.umami.is` → `e2e/run.spec.ts` (UPDATE)
- Event semantics in a browser → `e2e/telemetry.spec.ts` (CREATE)
- ADR → `docs/decisions/telemetry.md` (CREATE)
- Docs → `architecture.md`, `.env.example`, `README.md`, `docs/tickets/llm-escape-room.md` (UPDATE)

## Tests added
- `lib/telemetry/tracker.test.ts` (8): once-guards, the t30 threshold, paused time, restart, skip vs complete,
  single-report ordering, a throwing sender
- `lib/telemetry/config.test.ts` (3): unset/blank → off, UUID trimmed, invalid throws naming only the variable
- `lib/telemetry/umami.test.ts` (5): exact payload, the four-key privacy contract, path from run id, keepalive
  POST, swallowed rejection
- `lib/telemetry/funnel.test.ts` (4): null rates at 0 opens, inclusive 50%, below target, unknown keys
- `lib/telemetry/readout.test.ts` (4): URL/query/auth header, event filtering, http error without the key,
  shape error
- `lib/telemetry/boundary.test.ts`: env / network / host / import / identifying-API sweeps, client-safe
  imports, positive controls
- `e2e/telemetry.spec.ts` (6): one open under Strict Mode and t30 at the replay-clock mark; paused time ignored;
  complete once through a restart; skip is not complete; the four-field payload; `/replay` sends nothing

## Validation results
- `pnpm typecheck`: pass
- `pnpm test`: 78 files, 1022 tests, all pass
- `pnpm build` without the variable: pass. With a valid test UUID: pass. With `UMAMI_WEBSITE_ID=nope`: fails, as
  intended, with `TelemetryConfigError: UMAMI_WEBSITE_ID is not a UUID` (exit 1)
- `pnpm e2e`: `run.spec.ts` 7/7, `telemetry.spec.ts` 6/6, `replay.spec.ts` 5/5
- `scripts/watch-through.mts` with no env: exit 2, "UMAMI_API_KEY is not set". Bad `--since`: exit 2 with usage
- Level 4 manual check against real Umami Cloud: **not run** (needs the user's Umami site and API key)

## Deviations from the plan
1. **Every `e2e/run.spec.ts` test intercepts beacons** (a `beforeEach`), not only the own-origin test. Otherwise
   the other tests would post real beacons to Umami.
2. **`e2e/telemetry.ts` holds `captureBeacons` and `names`** as well as the test id, shared by both specs.
3. **`ReplayPlayer` updates its latest-callback ref in an effect**, not by assignment during render. This follows
   React's rule against writing refs during render. The effect is declared before the reporting effect, so it
   runs first.
4. **Bundle vs page.** With no `UMAMI_WEBSITE_ID`, the rendered page is the bare player and sends nothing, but
   `TrackedReplay`'s code (including the Umami URL string) is still in a client chunk as dead code. The plan's
   "byte-for-byte" holds for the rendered page, not the bundle. Splitting it out with `next/dynamic` wasn't worth
   the complexity.
5. **The boundary test is slightly stricter** than planned: it also forbids `indexedDB`, `crypto.randomUUID`, and
   client imports of `funnel`.

## Issues encountered
- None blocking. `timeout` isn't available on macOS; e2e ran without it.
- Still open for the user: create the Umami Cloud site, set `UMAMI_WEBSITE_ID` in the public build environment,
  and do the Level 4 check. If the read API returns 401 with `Authorization: Bearer`, switch
  `lib/telemetry/readout.ts` to `x-umami-api-key`.
