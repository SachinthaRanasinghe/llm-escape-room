# Feature: Watch-through telemetry (TICKET-11, #11)

The following plan should be complete, but it's important that you validate documentation and codebase patterns and
task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files etc.

## Feature Description

A published run (`/run/<id>`) records four anonymous, cookie-free events to **Umami Cloud**:

| Event | Fires when | Counts toward |
|---|---|---|
| `run-open` | the player mounts on `/run/<id>` | the denominator (opens) |
| `run-t30` | the **replay clock** reaches 30 000 ms of playback (paused time does not count) | 30-second survival: the PRD's demand wrong-condition |
| `run-complete` | playback reaches `ended` on its own | watch-through: the PRD's first success metric (≥ 50% of opens) |
| `run-skip` | the viewer presses "Skip to results" | reported on its own line; it **never** counts as complete |

Each event fires **at most once per page load**. Restarting doesn't count an event again. There is no visitor id and
no cookie. The `/replay` live preview sends nothing. Telemetry is **off** unless `UMAMI_WEBSITE_ID` is set when
`next build` runs.

A script, `scripts/watch-through.mts`, reads the counts back from the Umami Cloud API and prints each published run's
funnel (opens → t30 → complete, plus skips) and whether watch-through clears the PRD's 50% target.

## User Story

As the builder, after posting a run publicly,
I want to know how many viewers opened it, how many were still watching at 30 seconds, and how many watched to the end,
So that I can tell whether the demand half of the hypothesis held ("watch past 30 s at a meaningful rate",
"watch-through ≥ 50% of opens") before I spend quota on the next matchup.

## Problem Statement

The PRD's first success metric and its demand-failure wrong-condition ("viewers drop inside the first 30 seconds")
can't be observed. `architecture.md` → *Missing pieces* / *Open questions* leaves the telemetry home unchosen. The
replay is also deliberately unable to reach the network: `lib/replay/boundary.test.ts` bans `fetch(` and URLs in
`components/scene`, and `e2e/run.spec.ts` asserts that `/run/canonical` requests nothing beyond its own origin. Any
telemetry has to be added *without* weakening what those guarantees protect: no provider, no key, and no inference
path reachable from the page.

## Solution Statement

**Decision (made in planning, record it as an ADR):** Umami Cloud is the telemetry home. It is free, cookie-free
(so no consent banner) and works on any static host. The page does **not** load Umami's tracker script. It posts
directly to `https://cloud.umami.is/api/send` with a hand-built payload that has a fixed set of fields.

The work splits into layers so every existing boundary stays true:

1. **`lib/telemetry/` (pure + one transport).** An event-name vocabulary, a pure **watch tracker** state machine
   that turns playback progress into at-most-once events, a pure Umami **payload builder** with a fixed field set,
   a fire-and-forget **transport** that takes `fetch` by injection, a **config reader** (the second, and only other,
   allowed `process.env` read in `lib/`), and a **readout** client plus a pure **funnel** summariser for the script.
2. **`components/scene/ReplayPlayer.tsx` gets one optional prop, `onProgress`.** It stays network-free. It reports
   `{ tMs, state, skipped }` whenever the panels' `moments`, the playback `state` or `skipped` change. That happens
   about four times a beat, never per frame. The scene still reads no clock except rAF.
3. **`components/telemetry/TrackedReplay.tsx`** (client) wraps `ReplayPlayer`, owns one tracker per page load, and
   sends events through the transport. This is the only client code that touches the network.
4. **`app/run/[id]/page.tsx`** (server, build time) reads the telemetry config and renders `TrackedReplay`. With no
   config it renders the plain `ReplayPlayer`, so a build without the variable makes **zero** extra requests.
5. **Tests.** A new `lib/telemetry/boundary.test.ts` confines the network, env and URL to named files. The secrets
   sweep's env allowlist grows by exactly one file. `e2e/run.spec.ts`'s own-origin test allows exactly the
   telemetry host. A new `e2e/telemetry.spec.ts` proves the event semantics in a real browser, with a fake clock and
   the beacon intercepted.

## Out of Scope / Non-Goals

- Not included: a dashboard page or any in-app display of the numbers. The script prints them, and Umami's own
  dashboard is the UI.
- Not included: referrer/source attribution ("which post drove views"), UTM handling, per-lane or per-beat drop-off
  curves, and any event beyond the four above. The payload deliberately omits `referrer`, `screen`, `title` and
  `language`.
- Not included: choosing or configuring a deploy host. The variable is read at `next build` wherever that runs.
- Not included: video-export telemetry, `/replay` telemetry, and any unload/`visibilitychange` beacon.
- Not changing: playback pacing, `usePlayback.ts`'s clock, the comparison reveal, the artifact format, or
  `published/*.json`. **No artifact or schema version bump.**
- Not changing: the rule that provider keys are read only in `lib/providers/env.ts`. The Umami **API key** is read
  only in `scripts/watch-through.mts` (the harness side) and never in `lib/` or `app/`.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium (small code, but it crosses three enforced boundaries)
**Primary Systems Affected**: `lib/telemetry/` (new), `components/telemetry/` (new), `components/scene/ReplayPlayer.tsx`,
`lib/replay/types.ts`, `app/run/[id]/page.tsx`, `lib/providers/secrets.test.ts`, `e2e/run.spec.ts`,
`playwright.config.ts`, `scripts/watch-through.mts` (new), docs
**Dependencies**: none new in `package.json`. Uses the platform `fetch` and the existing `zod` 4.6.5. External
service: Umami Cloud (free Hobby tier; confirm current limits when creating the site).

## Related Work

**Implements**: TICKET-11, [#11](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/11)   ·   **Epic**:
`architecture.md` + `docs/tickets/llm-escape-room.md` (wave 5). This ticket **resolves** the architecture's open
question "Watch-through telemetry … deliberately unchosen here".

**Back-references**:

- `.claude/plans/published-artifact-v0.md`: `/run/[id]` is static, built at build time, `dynamicParams = false`,
  and one-way. Its forward-reference already says "TICKET-11 adds the telemetry hook to the player on `/run/[id]`".
- `.claude/plans/post-run-comparison.md`: added `comparison`, `skipped` and "Skip to results" to `ReplayPlayer`.
  `run-skip` hooks onto that state.
- `.claude/plans/replay-player-v0.md`: `usePlayback` is the single rAF clock. This plan reuses it and adds no clock.
- `.claude/plans/provider-adapters.md`: origin of the secrets sweep and the "only `env.ts` reads env" rule this plan
  extends by one file.

**Forward-references**:

- (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `components/scene/ReplayPlayer.tsx` (whole file, 114 lines). Why: gains `onProgress`. Note `skipped`/`shown`
  state (lines 47-54), `usePlayback(plan)` (line 45) and the `data-state` attribute (line 70).
- `components/scene/usePlayback.ts` (whole file). Why: `timeRef` advances per frame. `moments` changes about four
  times a beat. `state` is `'playing' | 'paused' | 'ended'`. `restart` resets `timeRef` to 0. **Do not modify it.**
- `app/run/[id]/page.tsx` (whole file). Why: the server page that reads config and chooses `TrackedReplay` or
  `ReplayPlayer`. Mirror its doc-comment voice.
- `app/replay/page.tsx`. Why: must stay untouched, so `/replay` never sends telemetry.
- `lib/replay/boundary.test.ts` (whole file). Why: the FORBIDDEN list (lines 50-61) that `components/scene` must
  keep passing, and the structure (walk → sources → "the sweep sees" → "reaches for nothing" → positive control) to
  **mirror** in `lib/telemetry/boundary.test.ts`.
- `lib/providers/secrets.test.ts` (lines 1-100). Why: `readers` allowlist at lines 67-70 becomes two files. The
  JSON-no-URL scan (lines 84-94) must stay green, which is why the Umami URL must never enter `published/`.
- `lib/providers/env.ts` (whole file). Why: the pattern for `lib/telemetry/config.ts`: one exported function,
  `env` injectable with default `process.env`, a doc comment explaining why it is the only reader, and never
  `NEXT_PUBLIC_`.
- `lib/providers/testing.ts` (lines 13-35). Why: `stubFetch(script)` returns `{ fetch, calls }`. Reuse the **shape**
  (not the import; `lib/telemetry` must not import providers) in `lib/telemetry/testing.ts`.
- `lib/artifact/boundary.test.ts` (lines 1-40). Why: a second example of the sweep pattern and of the rule that
  `components/` never imports `lib/artifact`.
- `lib/artifact/store.ts` (lines 32-39). Why: `listArtifactIds()`, which the readout script uses to know which
  `/run/<id>` paths to query.
- `e2e/run.spec.ts` (whole file, esp. `freezeClock`/`advance` at lines 26-37 and the own-origin test). Why: the
  fake-clock pattern the new spec mirrors, and the test to amend.
- `playwright.config.ts`. Why: `webServer` gets an `env` block.
- `scripts/publish.mts` (lines 1-60). Why: script conventions: a doc comment with the "Run with:" line,
  `parseArgs`, a `USAGE` constant, `fail(message, code)`, relative `../lib/...` imports, and printing ids/counts
  only.
- `lib/replay/types.ts`. Why: `PlaybackProgress` is added here as a type (the scene and telemetry both import it
  type-only).
- `docs/decisions/substrate.md`. Why: ADR format to mirror in `docs/decisions/telemetry.md`.
- `.env.example`. Why: comment style for the new variables.
- `vitest.config.mts`. Why: `environment: 'node'`, with no jsdom. All unit tests must be pure (no DOM, no React
  render).

### New Files to Create

- `lib/telemetry/events.ts`: `TELEMETRY_EVENTS`, `TelemetryEvent`, `T30_MS`
- `lib/telemetry/tracker.ts`: `createWatchTracker()`, the pure at-most-once state machine
- `lib/telemetry/umami.ts`: `UMAMI_SEND_URL`, `UMAMI_API_BASE`, `buildUmamiPayload()`, `createUmamiTransport()`
- `lib/telemetry/config.ts`: `TELEMETRY_ENV_VARS`, `readTelemetryConfig()`, `TelemetryConfig`, `TelemetryConfigError`
- `lib/telemetry/funnel.ts`: `summariseFunnel()`, `WATCH_THROUGH_TARGET`
- `lib/telemetry/readout.ts`: `fetchRunEventCounts()`, the Umami Cloud read API client with injected `fetch`
- `lib/telemetry/index.ts`: barrel (mirror `lib/replay/index.ts` / `lib/artifact/index.ts` doc-comment header)
- `lib/telemetry/testing.ts`: `stubFetch` for telemetry tests
- `lib/telemetry/tracker.test.ts`, `umami.test.ts`, `config.test.ts`, `funnel.test.ts`, `readout.test.ts`,
  `boundary.test.ts`
- `components/telemetry/TrackedReplay.tsx`: the client wrapper
- `scripts/watch-through.mts`: the readout CLI
- `e2e/telemetry.spec.ts`: browser proof of the event semantics
- `docs/decisions/telemetry.md`: the ADR

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Umami: Sending stats](https://docs.umami.is/docs/api/sending-stats). Cloud endpoint
  `POST https://cloud.umami.is/api/send`, no auth. Body `{ type: 'event', payload: { website, hostname, url, name, … } }`.
  Needs a real `User-Agent`, which the browser sets. Why: the exact payload we build.
- [Umami source: `/api/send` route](https://github.com/umami-software/umami/blob/master/src/app/api/send/route.ts).
  `payload.website` must be a **UUID**. `url` accepts a path. `name` is a safe string. Requests are **dropped when
  `isbot(userAgent)`**, so HeadlessChrome is never recorded. Why: config validation, and why e2e intercepts
  rather than relying on the network.
- [Umami Cloud: API key](https://docs.umami.is/docs/cloud/api-key). Base `https://api.umami.is/v1`, header
  `Authorization: Bearer <key>`, rate limit 50 calls / 15 s. Why: the readout script. **GOTCHA:** older docs showed
  `x-umami-api-key`. If Bearer returns 401, try that header and update the plan's AMENDMENTS.
- [Umami source: metrics route](https://github.com/umami-software/umami/blob/master/src/app/api/websites/%5BwebsiteId%5D/metrics/route.ts)
  and [`FILTER_COLUMNS`](https://github.com/umami-software/umami/blob/master/src/lib/constants.ts).
  `GET /websites/:websiteId/metrics?type=event&startAt=<ms>&endAt=<ms>&path=/run/<id>` returns `[{ x: eventName, y:
  count }]`. `path` is a supported filter. Why: the readout query.
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md` → *Environment Variable Load Order*.
  `process.env` beats `.env`. Why: Playwright's `webServer.env` overrides any real id in a local `.env`.
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md`. Strict
  Mode is on by default in the App Router. In dev, effects mount → unmount → mount. Why: the once-guards must survive
  that.
- `node_modules/next/dist/docs/01-app/02-guides/analytics.md` (around line 215). Next's own example uses
  `fetch(url, { body, method: 'POST', keepalive: true })`. Why: the transport mirrors it.

### Patterns to Follow

**Module headers.** Every file opens with a doc comment that names the ticket (`TICKET-11 (#11)`), says what the
file is for, and cites `architecture.md` / the PRD by section. Section dividers use `── Title ──────` inside the
comment (see `usePlayback.ts`).

**Injectable env** (`lib/providers/env.ts:28-38`):

```ts
export function readProviderKey(
  provider: Provider,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const name = PROVIDER_KEY_VARS[provider];
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    // Names the variable, never a value.
    throw new ProviderError(provider, null, 0, `${name} is not set`);
  }
  return value;
}
```

**Injected fetch** (`lib/providers/testing.ts:21`): `stubFetch(script) → { fetch: typeof fetch; calls }`. Production
code takes `deps: { fetch }` with a default of `globalThis.fetch`.

**Errors:** a domain error class with a machine-readable `reason` (see `ArtifactError` / `ARTIFACT_ERROR_REASONS` in
`lib/artifact/schema.ts`). Messages name the variable or field, **never a value** (keys, ids).

**Source sweeps:** read source from disk, "guards the guard" count assertion, a per-file `it`, and a positive
control that plants each forbidden thing (`lib/replay/boundary.test.ts:62-120`).

**Client components:** first line `'use client';`, props `readonly`, CSS modules only (this ticket adds no CSS).

**Scripts:** `node --import tsx scripts/<name>.mts`, or with env `node --env-file-if-exists=.env --import tsx …`
(README, `smoke-providers.mts`). Relative imports `../lib/...`. `fail(message, code)`.

---

## IMPLEMENTATION PLAN

### Phase 0: Branch

TICKET-10's work is still uncommitted on `feature/post-run-comparison`, and this ticket builds on its `skipped`
state. Commit or merge TICKET-10 first, then `git checkout -b feature/watch-through-telemetry`. Don't mix this
ticket's changes into TICKET-10's uncommitted tree.

### Phase 1: Pure core (`lib/telemetry` without network)

Event vocabulary, tracker, payload builder, config reader, funnel. All of it runs in node with no DOM, and it's
fully unit-tested.

### Phase 2: Transport + readout

**Depends on:** Phase 1 (event names, config type)

The fire-and-forget send transport and the read-API client, both with injected `fetch`. Add the telemetry boundary
sweep and the secrets-sweep amendment.

### Phase 3: Player integration

**Depends on:** Phase 1 (tracker, `PlaybackProgress`)
**Independent of:** Phase 2's readout (only the send transport is needed)

Add `onProgress` to `ReplayPlayer`, the `TrackedReplay` wrapper, and the server page switch.

### Phase 4: Script, e2e, docs

**Depends on:** Phases 2-3

`scripts/watch-through.mts`, the e2e spec and amendment, the Playwright env, README / `.env.example` /
`architecture.md` / ADR.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### ADD `PlaybackProgress` to `lib/replay/types.ts`

- **IMPLEMENT**:
  ```ts
  /** What the player reports to an observer (TICKET-11): replay-clock time, state, and whether results were skipped to. */
  export interface PlaybackProgress {
    readonly tMs: number;
    readonly state: 'playing' | 'paused' | 'ended';
    readonly skipped: boolean;
  }
  ```
  Re-export it as a type from `lib/replay/index.ts`.
- **PATTERN**: existing interfaces in `lib/replay/types.ts`. `PlaybackState` in `usePlayback.ts:31` has the same union.
  Keep that one where it is. Optionally type it as `PlaybackProgress['state']`, but don't move it.
- **GOTCHA**: it goes in `lib/replay` (not `lib/telemetry`) so the scene never imports telemetry. Telemetry imports
  it with `import type`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1, #3

### CREATE `lib/telemetry/events.ts`

- **IMPLEMENT**: `export const TELEMETRY_EVENTS = ['run-open', 'run-t30', 'run-complete', 'run-skip'] as const;`,
  `export type TelemetryEvent = (typeof TELEMETRY_EVENTS)[number];`, `export const T30_MS = 30_000;` The doc comment
  maps each event to the PRD (Success metrics · Watch-through; Hypothesis · WRONG if "viewers drop inside the first 30
  seconds") and states the definitions from the table in *Feature Description*, including "skip never counts as
  complete" and "at most once per page load".
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1

### CREATE `lib/telemetry/tracker.ts` + `tracker.test.ts`

- **IMPLEMENT**: `createWatchTracker(send: (event: TelemetryEvent) => void): { open(): void; progress(p: PlaybackProgress): void }`.
  It holds a `Set<TelemetryEvent>` of events already sent. `emit(e)` sends only when `e` isn't in the set yet.
  - `open()` → `run-open`
  - `progress(p)`: if `p.skipped` → `run-skip`. If `p.tMs >= T30_MS` → `run-t30`. If `p.state === 'ended'` →
    `run-complete`. **Order** inside one call: t30 before complete (a single report at the end of a short replay may
    satisfy both, and the funnel must stay monotonic). Skip is emitted first.
  - `progress` before `open` still works (emits whatever applies). The wrapper always calls `open` first anyway.
  - `send` throwing must not break the tracker. Wrap it in try/catch and still mark the event sent. Never retry,
    because a retry could double-count.
- **TESTS** (vitest, pure): open once even when called twice. t30 not at 29 999, yes at 30 000. Paused progress with
  `tMs` 10 000 then wall-time passes (the test just doesn't call progress) → no t30. A restart (tMs back to 0 after
  complete) emits nothing new. Skip then natural end → both `run-skip` and `run-complete`. Skip alone never emits
  complete. A single call `{ tMs: 80_000, state: 'ended' }` emits `['run-t30', 'run-complete']` in that order. A
  throwing `send` doesn't stop later events.
- **PATTERN**: pure functions + `describe/it` style of `lib/replay/beats.test.ts`.
- **VALIDATE**: `pnpm vitest run lib/telemetry/tracker.test.ts`
- **SATISFIES**: AC #1, #2

### CREATE `lib/telemetry/config.ts` + `config.test.ts`

- **IMPLEMENT**:
  ```ts
  export const TELEMETRY_ENV_VARS = { websiteId: 'UMAMI_WEBSITE_ID' } as const;
  export interface TelemetryConfig { readonly websiteId: string }
  export function readTelemetryConfig(env: Readonly<Record<string, string | undefined>> = process.env): TelemetryConfig | null
  ```
  Unset or blank → `null` (telemetry off). Set but not a UUID (`z.uuid()` from `zod`) → throw
  `TelemetryConfigError` whose message names `UMAMI_WEBSITE_ID` and never echoes the value. A mistyped id that
  silently records nothing is the worst failure here, so it fails the build. The doc comment says this is the
  **second and last** `process.env` reader under `lib/`/`app/`/`components/`, and that it runs server-side at build
  time. The id is public by nature (Umami ids ship in every tracker tag), but it still never gets the `NEXT_PUBLIC_`
  prefix: the server page passes it as a prop, so there's exactly one read.
- **TESTS**: unset → null. Whitespace → null. A valid UUID → `{ websiteId }` (trimmed). `'abc'` → throws
  `TelemetryConfigError`, and the message contains `UMAMI_WEBSITE_ID` but not `abc`.
- **GOTCHA**: `UMAMI_API_KEY` is **not** read here. It is harness-side only (the script).
- **VALIDATE**: `pnpm vitest run lib/telemetry/config.test.ts`
- **SATISFIES**: AC #4, #6

### CREATE `lib/telemetry/umami.ts` (payload builder only for now) + `umami.test.ts`

- **IMPLEMENT**:
  ```ts
  export const UMAMI_SEND_URL = 'https://cloud.umami.is/api/send';
  export const UMAMI_API_BASE = 'https://api.umami.is/v1';
  export const UMAMI_PAYLOAD_KEYS = ['website', 'hostname', 'url', 'name'] as const;
  export function buildUmamiPayload(config: TelemetryConfig, event: TelemetryEvent, page: { hostname: string; runId: string })
    : { type: 'event'; payload: { website: string; hostname: string; url: string; name: TelemetryEvent } }
  ```
  `url` is always `/run/${runId}`, built from the run id and **never** from `location.href`, so no query string or
  fragment ever leaves the page. `hostname` comes from the caller (the wrapper passes `location.hostname`).
- **TESTS**: the exact object for the canonical case. `Object.keys(payload)` equals `UMAMI_PAYLOAD_KEYS` (the privacy
  contract: no referrer, screen, title, language or data). `url` has no `?`/`#` even for an id like `canonical`.
- **VALIDATE**: `pnpm vitest run lib/telemetry/umami.test.ts`
- **SATISFIES**: AC #1, #6

### ADD `createUmamiTransport` to `lib/telemetry/umami.ts` + tests; CREATE `lib/telemetry/testing.ts`

- **IMPLEMENT**: `createUmamiTransport(config, page, deps: { fetch: typeof fetch } = { fetch: globalThis.fetch }) → (event: TelemetryEvent) => void`.
  It calls `deps.fetch(UMAMI_SEND_URL, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildUmamiPayload(...)) })`
  and attaches `.catch(() => {})`. It is **fire-and-forget**: it returns `void`, never awaits, never throws, never
  retries, and never logs the id. A telemetry failure must never touch playback.
  `lib/telemetry/testing.ts`: `stubFetch(status = 200)` → `{ fetch, calls: { url, init }[] }`, plus a
  `stubFetch` variant that rejects. Mirror the shape of `lib/providers/testing.ts:21-35` **without importing it**.
- **TESTS**: one call per send with the right URL, method, `keepalive: true` and parsed body. A rejecting fetch
  → the returned function doesn't throw, and there's no unhandled rejection (await a microtask tick and assert with
  `process.on('unhandledRejection')` or vitest's default failure).
- **GOTCHA**: bind `globalThis.fetch` lazily (`(...a) => globalThis.fetch(...a)`) so importing the module in node
  tests never captures an undefined or illegal-invocation `fetch`.
- **VALIDATE**: `pnpm vitest run lib/telemetry/umami.test.ts`
- **SATISFIES**: AC #1

### CREATE `lib/telemetry/funnel.ts` + `funnel.test.ts`

- **IMPLEMENT**: `WATCH_THROUGH_TARGET = 0.5` (cite PRD §7). `summariseFunnel(counts: Partial<Record<TelemetryEvent, number>>)`
  → `{ opens, t30, complete, skip, survival30: number | null, watchThrough: number | null, meetsTarget: boolean | null }`.
  Rates are `null` when `opens === 0`, never `NaN` and never `0`. Missing counts are 0. Unknown event names in the
  input are ignored.
- **TESTS**: 0 opens → null rates. 10/6/5/2 → 0.6 / 0.5 / `meetsTarget: true` (the boundary is inclusive, "≥ 50%").
  4/10 → false. Unknown keys ignored.
- **VALIDATE**: `pnpm vitest run lib/telemetry/funnel.test.ts`
- **SATISFIES**: AC #5

### CREATE `lib/telemetry/readout.ts` + `readout.test.ts`

- **IMPLEMENT**: `fetchRunEventCounts({ apiKey, websiteId, runId, startAt, endAt }, deps = { fetch })`
  → `Promise<Partial<Record<TelemetryEvent, number>>>`. It sends `GET ${UMAMI_API_BASE}/websites/${websiteId}/metrics?type=event&startAt=…&endAt=…&path=/run/${runId}`
  with `Authorization: Bearer ${apiKey}`. Parse the response with zod `z.array(z.object({ x: z.string(), y: z.number() }))`
  and keep only names in `TELEMETRY_EVENTS`. A non-2xx response, or a body that fails the schema, throws
  `TelemetryReadError` (reason `'http' | 'shape'`, status number). **The message never includes the api key** (mirror
  `redact` in `lib/providers/transport.ts:65` if you echo any response text; simplest is to echo only the status).
  Build the query with `URLSearchParams` so `/run/<id>` is encoded.
- **TESTS**: correct URL + header, via `stubFetch` recording calls. Maps `[{x:'run-open',y:3},{x:'other',y:9}]` →
  `{ 'run-open': 3 }`. 401 → `TelemetryReadError` with reason `http` and status 401, and the message doesn't contain
  the key. `{}` body → reason `shape`.
- **GOTCHA**: rate limit is 50 calls / 15 s. The script queries one run at a time, sequentially. That's fine for the
  MVP's handful of runs; don't parallelise.
- **VALIDATE**: `pnpm vitest run lib/telemetry/readout.test.ts`
- **SATISFIES**: AC #5

### CREATE `lib/telemetry/index.ts`

- **IMPLEMENT**: a barrel with a header listing each export, like `lib/artifact/index.ts:1-12`. The header states
  which parts are client-safe (`events`, `tracker`, `umami`) and which are server/script-only (`config`, `readout`).
  **GOTCHA:** `TrackedReplay.tsx` must import from the specific files (`@/lib/telemetry/tracker`,
  `@/lib/telemetry/umami`), **not** the barrel. Otherwise `config.ts`'s `process.env` read and `readout.ts` get
  pulled into the client bundle graph. The boundary test enforces this.
- **VALIDATE**: `pnpm typecheck`

### CREATE `lib/telemetry/boundary.test.ts`

- **IMPLEMENT**: mirror `lib/replay/boundary.test.ts`. Walk `lib/telemetry` and `components/telemetry` (exclude
  tests and `testing.ts`) and assert:
  1. `process.env` appears **only** in `lib/telemetry/config.ts`.
  2. `fetch(` and `https?://` appear **only** in `lib/telemetry/umami.ts` and `lib/telemetry/readout.ts`. Only
     `umami.ts` names `cloud.umami.is`, and only `umami.ts` names `api.umami.is` (`readout.ts` imports the constant).
  3. No import of `@/lib/providers`, `@/lib/sim`, `@/lib/artifact`, `@/lib/harness`, `@/lib/generator`, `@/fixtures`.
  4. `components/telemetry/*` doesn't import `@/lib/telemetry` (the barrel), `config` or `readout`. It may import
     `tracker`, `umami` and `events` only.
  5. No `Math.random`, `Date.now`, `performance.now`, `document.cookie`, `localStorage`, `sessionStorage`,
     `navigator.sendBeacon` (no visitor ids, no storage, no clock: the only clock is still the player's rAF).
  6. "The sweep sees" guard: at least 7 files, including `lib/telemetry/umami.ts` and
     `components/telemetry/TrackedReplay.tsx`.
  7. A positive control that plants each forbidden pattern.
- **GOTCHA**: `components/telemetry/TrackedReplay.tsx` will read `window.location.hostname`. That's allowed (it isn't
  a URL literal).
- **VALIDATE**: `pnpm vitest run lib/telemetry/boundary.test.ts` (it fails until `TrackedReplay.tsx` exists; write
  the guard assertion now and expect it to go green after the component task)
- **SATISFIES**: AC #6

### UPDATE `lib/providers/secrets.test.ts`

- **IMPLEMENT**: the `readers` expectation (line 69) becomes `['lib/providers/env.ts', 'lib/telemetry/config.ts']`
  (sorted). Extend the header comment: "TICKET-11 (#11) adds `lib/telemetry/config.ts`, which reads the Umami website
  id, a public identifier and not a key, at build time. The Umami API key is read only in
  `scripts/watch-through.mts`." Leave everything else as it is. The JSON scan of `published/` must still pass
  unchanged.
- **GOTCHA**: also add `'lib/telemetry'` to `ARTIFACT_SIDE` so telemetry can never import a provider.
- **VALIDATE**: `pnpm vitest run lib/providers/secrets.test.ts`
- **SATISFIES**: AC #6

### UPDATE `components/scene/ReplayPlayer.tsx`: add `onProgress`

- **IMPLEMENT**: `readonly onProgress?: (progress: PlaybackProgress) => void;` in `Props`. After the existing
  effects:
  ```ts
  const report = useRef(onProgress);
  report.current = onProgress;           // latest callback without re-running the effect
  useEffect(() => {
    report.current?.({ tMs: timeRef.current, state, skipped });
  }, [moments, state, skipped, timeRef]);
  ```
  Extend the doc comment with a paragraph: "`onProgress` (TICKET-11, #11) is how a published run is observed. It
  fires when the panels move (`moments`, about four times a beat), when the state changes, and on a skip. It never
  fires per frame, and it reports the replay clock, not the wall clock, so paused time never counts. The player
  itself sends nothing: `components/telemetry/TrackedReplay.tsx` does."
- **PATTERN**: the effects at lines 50-63.
- **GOTCHA**: don't add a clock, `fetch` or URL here, because `lib/replay/boundary.test.ts` sweeps this file. Don't
  touch `usePlayback.ts`. t30 is therefore reported at the first `moments` change at or after 30 000 ms, a fraction
  of a beat late, which is acceptable and documented in the ADR. Assigning `report.current` during render is the
  standard "latest ref" pattern. If the linter flags it, move it into a `useLayoutEffect`.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/replay/boundary.test.ts`
- **SATISFIES**: AC #1, #2

### CREATE `components/telemetry/TrackedReplay.tsx`

- **IMPLEMENT**: `'use client';`, with props `{ data, renderer, comparison, runId, telemetry: TelemetryConfig }`
  (all readonly; import `TelemetryConfig` **type-only** from `@/lib/telemetry/config`).
  ```tsx
  const tracker = useRef<WatchTracker | null>(null);
  useEffect(() => {
    if (!tracker.current) {
      tracker.current = createWatchTracker(createUmamiTransport(telemetry, { hostname: window.location.hostname, runId }));
    }
    tracker.current.open();
  }, [telemetry, runId]);
  const onProgress = useCallback((p: PlaybackProgress) => tracker.current?.progress(p), []);
  return <ReplayPlayer data={data} renderer={renderer} comparison={comparison} onProgress={onProgress} />;
  ```
  The doc comment explains: this is the only client code that sends anything. It sends four event names and the run
  path, and nothing else. There are no cookies or ids. The tracker's once-guard is what keeps React Strict Mode's
  dev double-mount from double-counting an open.
- **GOTCHA**: create the tracker inside the effect (not during render), because it reads `window`. `ReplayPlayer`'s
  first `onProgress` effect may run **before** this parent effect, since child effects run first. `tracker.current`
  is still null then, so that report is dropped. That's harmless: the first report is `tMs: 0, playing`, which emits
  nothing. `import type` for `TelemetryConfig`: a value import of `config.ts` would put `process.env` in the client
  graph, and the boundary test forbids it.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/telemetry/boundary.test.ts lib/artifact/boundary.test.ts lib/providers/secrets.test.ts`
- **SATISFIES**: AC #1, #2, #6

### UPDATE `app/run/[id]/page.tsx`

- **IMPLEMENT**: `const telemetry = readTelemetryConfig();` (import from `@/lib/telemetry/config`) inside `RunPage`.
  Render `telemetry ? <TrackedReplay … runId={id} telemetry={telemetry} /> : <ReplayPlayer … />`. Add a paragraph
  to the doc comment: TICKET-11 (#11). The Umami website id is read at **build time** here. With it unset, the page
  is byte-for-byte the pre-telemetry player and makes no extra request. An invalid id fails the build.
- **GOTCHA**: the page is statically generated, so the config is baked into the built HTML. Changing the variable
  needs a rebuild (say so in the README). Don't read config in `generateStaticParams` or `generateMetadata`.
- **VALIDATE**: `pnpm typecheck && pnpm build` (without the variable, then `UMAMI_WEBSITE_ID=not-a-uuid pnpm build`
  must fail with a message naming the variable)
- **SATISFIES**: AC #3, #4

### CREATE `scripts/watch-through.mts`

- **IMPLEMENT**: a header in the `scripts/publish.mts` style. Run with
  `node --env-file-if-exists=.env --import tsx scripts/watch-through.mts [--id <runId>] [--since YYYY-MM-DD]`.
  It reads `UMAMI_API_KEY` and `UMAMI_WEBSITE_ID` from `process.env` (scripts are the harness side, so that's
  allowed). A missing variable → `fail('UMAMI_API_KEY is not set', 2)` (names only). Ids come from `--id` or
  `listArtifactIds()`. `startAt` = `--since` (default: 90 days before now), `endAt` = now. It queries each id
  **sequentially** with `fetchRunEventCounts`, runs `summariseFunnel`, and prints one row per run: `id  opens  t30
  (survival%)  complete (watch-through%)  skip  target✓/✗/—`. It prints ids and counts only. A
  `TelemetryReadError` → `fail` with its reason and status, exit 1.
- **PATTERN**: `scripts/publish.mts` (`parseArgs`, `USAGE`, `fail`).
- **GOTCHA**: `listArtifactIds` includes `canonical` (the fixture run). Include it; it's harmless and shows a zero
  row. Percentages print `—` when the rate is null.
- **VALIDATE**: `node --import tsx scripts/watch-through.mts` with no env → exits 2 with the "not set" message.
  `pnpm typecheck`.
- **SATISFIES**: AC #5

### UPDATE `playwright.config.ts`

- **IMPLEMENT**: `webServer.env: { UMAMI_WEBSITE_ID: '00000000-0000-4000-8000-000000000011' }` (a fixed test UUID,
  valid v4 shape) with a comment: process.env beats `.env` (Next load order), so e2e never uses a real id, and every
  beacon is intercepted by the specs anyway. Export the constant from a tiny `e2e/telemetry.ts` helper so the specs
  assert against the same value.
- **GOTCHA**: `reuseExistingServer: !process.env.CI` means that locally, an **already-running** `pnpm dev` without
  the variable gets reused, and the telemetry spec fails. The spec's first assertion should give a clear message:
  "stop your dev server; the e2e server must start with UMAMI_WEBSITE_ID".
- **VALIDATE**: `pnpm e2e --list`
- **SATISFIES**: AC #7

### UPDATE `e2e/run.spec.ts`: own-origin test

- **IMPLEMENT**: in `makes no request beyond its own origin`, `page.route('https://cloud.umami.is/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' }, body: '{}' }))`
  **before** `goto`, so nothing really leaves the machine. The `foreign` filter then allows exactly the host
  `cloud.umami.is` and nothing else: `requests.filter(u => ![originHost, 'cloud.umami.is'].includes(new URL(u).host))`.
  Keep the provider regex assertion. Add: every `cloud.umami.is` request is a POST to `/api/send`. Update the spec's
  header comment (TICKET-11 (#11): "one foreign host is allowed, and it is the telemetry beacon, which the telemetry
  spec pins field by field").
- **GOTCHA**: when Playwright fulfills a cross-origin request, the response still needs CORS headers, or the page's
  `fetch` rejects. The transport swallows that, but return proper headers anyway so no console error is logged. The
  existing `pageerror` checks must stay green.
- **VALIDATE**: `pnpm e2e e2e/run.spec.ts`
- **SATISFIES**: AC #6, #7

### CREATE `e2e/telemetry.spec.ts`

- **IMPLEMENT**: mirror `freezeClock`/`advance` from `e2e/run.spec.ts`. Take the plan from
  `loadArtifact('canonical').manifest.beatPlan` (totalMs is about 79 s, well over 30 s). A `captureBeacons(page)`
  helper routes `https://cloud.umami.is/**` (with CORS headers as above), parses `route.request().postDataJSON()`,
  and pushes it onto an array. Tests:
  1. **Open, then t30 at the replay-clock mark.** `goto('/run/canonical')` → exactly one `run-open`. Advance to
     `29_000` → no `run-t30`. Advance past `30_000 + one beat` → exactly one `run-t30`.
  2. **Paused time doesn't count.** Advance 10 s → click the play/pause control (find its selector in
     `components/scene/Controls.tsx`) → advance 60 s → no `run-t30`, and `data-state` is `paused`.
  3. **Completion, once.** Advance past `plan.totalMs` → one `run-complete`, and `data-state="ended"`. Click
     restart, advance past the end again → still exactly one each of open/t30/complete.
  4. **Skip is its own event.** Click `skip-to-results` at about 5 s → one `run-skip`, no `run-complete` yet.
  5. **Payload contract.** Every beacon has `type === 'event'` and
     `Object.keys(payload).sort()` equal to `['hostname','name','url','website']`, with
     `payload.url === '/run/canonical'` and `payload.website` equal to the test UUID.
  6. **`/replay` sends nothing.** `goto('/replay')`, advance 40 s → zero beacons.
- **GOTCHA**: events arrive asynchronously. Use `await expect.poll(() => names(beacons)).toEqual([...])` rather
  than reading the array right away. React Strict Mode in `next dev` double-mounts, and test 1 is the regression
  test proving the once-guard holds (exactly one `run-open`).
- **VALIDATE**: `pnpm e2e e2e/telemetry.spec.ts`
- **SATISFIES**: AC #1, #2, #3, #7

### CREATE `docs/decisions/telemetry.md` (ADR)

- **IMPLEMENT**: mirror `docs/decisions/substrate.md`'s structure. Cover: context (PRD metric + wrong-condition,
  architecture open question). Options weighed: Umami Cloud / Vercel Web Analytics (host lock-in; custom events
  likely paid, which clashes with the $0 guardrail) / GoatCounter (no real events) / own endpoint + KV (breaks "no
  server, no database"). Decision: Umami Cloud with a direct `/api/send`, no tracker script. The event definitions
  table. The privacy stance (4 fields, no cookie, no id, no storage; Umami derives country/browser server-side from
  the request, and bots are dropped by `isbot`). The boundary changes (one extra env reader, one allowed foreign
  host). Known imprecision: t30 is reported at the next panel change (under one beat late); a viewer who closes the
  tab counts as "not t30" / "not complete", which is exactly the drop we want to see. How to read it:
  `scripts/watch-through.mts`.
- **VALIDATE**: file exists, and the links in it resolve (`ls` the referenced paths)
- **SATISFIES**: AC #8

### UPDATE `architecture.md`, `.env.example`, `README.md`, `docs/tickets/llm-escape-room.md`

- **IMPLEMENT**:
  - `architecture.md`: in *Missing pieces* and *Open questions*, mark watch-through telemetry as **decided → Umami
    Cloud, see `docs/decisions/telemetry.md`** (a one-line edit each; keep the rest of the doc intact). Under
    *Boundaries & contracts* → *Replay ↔ artifact*, add one sentence: the published page sends four anonymous
    events to one telemetry host, and nothing else leaves it.
  - `.env.example`: add a telemetry block. `UMAMI_WEBSITE_ID=`: read at `next build` by
    `lib/telemetry/config.ts`, unset = telemetry off, **set it only in the deploy build environment, not in local
    `.env`**, or your own dev views get counted. `UMAMI_API_KEY=`: read only by `scripts/watch-through.mts`; never
    `NEXT_PUBLIC_`.
  - `README.md`: a short paragraph after the post-run comparison paragraph covering what is recorded, when each
    event fires, that `/replay` sends nothing, how to turn it on (build env), and how to read it
    (`node --env-file-if-exists=.env --import tsx scripts/watch-through.mts`). Update *Status*.
  - `docs/tickets/llm-escape-room.md`: TICKET-11 is no longer "blocked on a decision". Point to the ADR.
- **VALIDATE**: `git diff --stat` shows only these doc files changed in this task
- **SATISFIES**: AC #8

### Close the issue label

- **IMPLEMENT**: after merge, the `blocked-on-decision` label on #11 is stale. Remove it
  (`gh issue edit 11 --remove-label blocked-on-decision`) **only when the user asks**. It's outward-facing, so leave
  it for the PR step.

---

## TESTING STRATEGY

### Unit Tests (vitest, node env, no DOM)

- `tracker.test.ts`: every event rule, the once-guards, ordering, restart, skip vs complete, a throwing sender.
- `config.test.ts`: unset/blank/valid/invalid, and error messages never echo values.
- `umami.test.ts`: the exact payload, the key-set privacy contract, URL built from the run id, transport call shape,
  keepalive, swallowed rejection.
- `funnel.test.ts`: null rates at 0 opens, the inclusive 50% boundary, missing and unknown keys.
- `readout.test.ts`: URL/query/header, filtering to known events, http and shape errors, the key never in the message.

### Structural Tests

- `lib/telemetry/boundary.test.ts` (new), `lib/providers/secrets.test.ts` (amended),
  `lib/replay/boundary.test.ts` (unchanged, must still pass with `onProgress` added),
  `lib/artifact/boundary.test.ts` (unchanged, must pass: `components/telemetry` never imports `lib/artifact`).

### Integration / E2E (Playwright, fake clock, intercepted beacon)

- `e2e/telemetry.spec.ts`: semantics 1-6 above.
- `e2e/run.spec.ts`: the own-origin test allows exactly `cloud.umami.is`, and all existing tests still pass.
- `e2e/replay.spec.ts`: unchanged, must pass (`/replay` has no telemetry).

### Edge Cases

- React Strict Mode dev double-mount → one `run-open` (e2e test 1).
- Restart after complete → no re-count.
- Pause across the 30 s wall-clock mark → no t30.
- Skip, then the replay keeps playing to the end → `run-skip` **and** `run-complete` (they watched to the end).
- A short replay whose single end report crosses both thresholds → t30 before complete.
- Beacon network failure or CORS rejection → playback unaffected, no `pageerror`.
- `UMAMI_WEBSITE_ID` unset → no `TrackedReplay`, no foreign request. Invalid → build fails naming the variable.
- Readout: 0 opens → `—` rates, not `NaN%`.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

- `pnpm typecheck`

### Level 2: Unit Tests

- `pnpm test`
- `pnpm vitest run lib/telemetry lib/providers/secrets.test.ts lib/replay/boundary.test.ts lib/artifact/boundary.test.ts`

### Level 3: Integration Tests

- `pnpm build` (no telemetry var) → succeeds
- `UMAMI_WEBSITE_ID=00000000-0000-4000-8000-000000000011 pnpm build` → succeeds
- `UMAMI_WEBSITE_ID=nope pnpm build` → fails, and the message names `UMAMI_WEBSITE_ID`
- `pnpm e2e` (stop any running `pnpm dev` first)

### Level 4: Manual Validation

- Create the Umami Cloud site (the user's action), set `UMAMI_WEBSITE_ID` in the shell, run `pnpm build && pnpm
  start`, and open `/run/canonical` in a normal (non-headless) browser. In DevTools → Network, check for exactly one
  POST to `cloud.umami.is/api/send` on load, one at about 30 s, and one at the end. Check the Umami dashboard →
  Events for `run-open`, `run-t30` and `run-complete` on path `/run/canonical`.
- `node --env-file-if-exists=.env --import tsx scripts/watch-through.mts --id canonical` with `UMAMI_API_KEY` set →
  one row with non-zero counts. **If it returns 401**, switch the header to `x-umami-api-key` (see the docs GOTCHA)
  and record the change in AMENDMENTS.

### Level 5: Additional Validation (Optional)

- `skills:agent-browser` to drive the Level 4 browser check headfully.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1**: `/run/<id>` records `run-open`, `run-t30` (replay clock ≥ 30 000 ms) and `run-complete` (playback
      ended), plus `run-skip`. Each fires at most once per page load (unit + e2e).
- [ ] **AC #2**: paused time never counts toward t30, and a skip never counts as complete (unit + e2e).
- [ ] **AC #3**: `/replay` sends nothing. A build without `UMAMI_WEBSITE_ID` sends nothing from `/run/<id>` either.
- [ ] **AC #4**: the config is read once, server-side, at build time. An invalid id fails the build, with a message
      that names the variable and not the value.
- [ ] **AC #5**: `scripts/watch-through.mts` prints each published run's opens → t30 → complete funnel, survival and
      watch-through rates, and ✓/✗ against the PRD's ≥ 50% target (funnel + readout unit-tested).
- [ ] **AC #6**: the boundaries still hold. `components/scene` has no network, env or clock. Only
      `lib/telemetry/config.ts` joins `lib/providers/env.ts` as an env reader. The network and URLs are confined to
      `lib/telemetry/umami.ts` and `readout.ts`. The beacon payload is exactly `website, hostname, url, name`. No
      cookie, storage or visitor id.
- [ ] **AC #7**: e2e shows the only foreign host `/run/<id>` contacts is `cloud.umami.is`, and only as a POST to
      `/api/send`.
- [ ] **AC #8**: the ADR exists. `architecture.md`'s open question is marked decided. README and `.env.example`
      explain how to turn telemetry on and read it.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` all green. No artifact or schema version change, and
      `published/*.json` untouched.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + e2e)
- [ ] No type errors
- [ ] Manual testing confirms events land in Umami
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

Decided in planning (2026-09-25):

- Telemetry home: **Umami Cloud**, direct `/api/send`, no tracker script.
- Semantics: **replay-clock t30**, complete = natural end, skip is a separate event, once per page load, `/replay`
  excluded.
- Boundary: **isolate in `lib/telemetry` + `components/telemetry`, allow exactly one foreign host**. The scene stays
  network-free and exposes `onProgress`.
- Readout: **in scope** as `scripts/watch-through.mts`.

Assumptions (confirm before execution if any matter):

- Assumed: a viewer who **skips and then lets playback run to the end** also counts as `run-complete`. The skip
  button reveals results but doesn't stop playback. If you want complete to mean "never skipped", the tracker drops
  `run-complete` once `run-skip` has fired. That's a one-line change.
- Assumed: an invalid `UMAMI_WEBSITE_ID` **fails the build** rather than silently disabling telemetry.
- Assumed: TICKET-10 is committed before this branch starts (Phase 0).
- Assumed: the Umami Cloud API key uses `Authorization: Bearer` (current docs). The fallback is `x-umami-api-key`.
- Needs the user: creating the Umami Cloud account and site, and setting `UMAMI_WEBSITE_ID` in whatever builds the
  public site. The implementation can't do either.
- Not handled: Do Not Track. Umami's own tracker ignores DNT unless opted in, and we send no identifier. If you want
  to honour `navigator.doNotTrack`, it's a two-line guard in `TrackedReplay`.

## NOTES (open canvas)

**Why `onProgress` on `moments` rather than a dedicated 30 s timer.** The replay sweep bans every clock except
`usePlayback`'s rAF, and that's what keeps playback deterministic under Playwright's fake clock. A `setTimeout(30_000)`
would also measure wall time, which contradicts the chosen replay-clock semantics, and it would need pause-awareness
we'd have to rebuild. Hanging off `moments` costs nothing: it already changes about four times a beat, it only
changes while playing, and it reads `timeRef`, which is the replay clock by definition. The cost is that t30 can land
up to one phase late. That doesn't matter for a survival metric.

**Why not load Umami's `script.js`.** It would add a third-party script to a page whose selling point is that it
reaches for nothing. It also auto-tracks pageviews with more fields (referrer, screen, language, title), and it
can't be pinned field by field in a test. Four hand-built fields are auditable.

**Why the config goes through the server page and not `NEXT_PUBLIC_`.** A `NEXT_PUBLIC_` read would be a second
`process.env` site, and it would live in client code. The secrets sweep would need a client-side exception, and the
replay sweep bans `process.env` in `components/scene` anyway. Reading it once in the server page and passing a prop
keeps "who reads the environment" to a list of two files.

**`text/plain` vs `application/json`.** `application/json` triggers a CORS preflight. Umami's own tracker does this
and Umami answers it, so it works. A `text/plain` body would skip the preflight (and would allow `sendBeacon`), but
it relies on Umami parsing JSON regardless of content type, which isn't verified. Stick with the documented path.

**Data flow**

```
build:  env UMAMI_WEBSITE_ID ─▶ readTelemetryConfig() ─▶ RunPage ─▶ <TrackedReplay telemetry runId>
browser: usePlayback(rAF) ─▶ moments/state/skipped ─▶ ReplayPlayer.onProgress({tMs,state,skipped})
         ─▶ WatchTracker (once-guards) ─▶ UmamiTransport ─▶ POST cloud.umami.is/api/send {website,hostname,url,name}
later:  scripts/watch-through.mts ─▶ GET api.umami.is/v1/websites/:id/metrics?type=event&path=/run/<id>
         ─▶ summariseFunnel ─▶ table vs PRD ≥50%
```

**Risk ranking.** (1) The e2e fake clock combined with async beacons. Mitigated with `expect.poll`. (2) Strict Mode
double effects. Mitigated with a ref-held tracker and once-guards, with e2e test 1 as the proof. (3) Umami read-API
details (header, path filter). Mitigated with a Level 4 manual check and a documented fallback. (4) A reused local dev
server without the env. Mitigated with a clear spec message.

## AMENDMENTS

- 2026-09-25 — Implementation deviations, all intentional: (1) run-spec `beforeEach` intercepts beacons in every
  `e2e/run.spec.ts` test, not only the own-origin test, because otherwise the other tests would post real beacons.
  (2) `e2e/telemetry.ts` holds `captureBeacons`/`names` as well as the test id. (3) `ReplayPlayer` updates its
  latest-callback ref in an effect rather than during render. (4) With no `UMAMI_WEBSITE_ID`, the built page
  renders the bare player and sends nothing, but the Umami URL string still sits in a shared client chunk as dead
  code, so "byte-for-byte the pre-telemetry player" is true of the rendered page, not the bundle. (5) The
  telemetry boundary test also forbids `indexedDB`, `crypto.randomUUID`, and client imports of `funnel`.
