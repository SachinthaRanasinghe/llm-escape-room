# Feature: Published artifact — render manifest freeze + static run URL (TICKET-9, #9)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Gate status: closed.** All six clarifying questions were answered "defaults" on 2026-09-24. Decisions D1–D6 in
> OPEN QUESTIONS / ASSUMPTIONS are settled. A-1 (Next 16 prerenders a `generateStaticParams` page that reads
> `published/` with `node:fs`) and A-2 (`vi.doMock` can swap `CURRENT_RENDERER` under a dynamic import) are
> assumptions, and each has a stated fallback.

## Feature Description

This ticket turns a finished run into the thing you send someone. A **published artifact** is one versioned JSON
file, `published/<id>.json`. It holds the event log, the run record (competitors, budget, per-competitor summaries,
`typicalOfRepeats`), and a **frozen render manifest**. The manifest contains the renderer version, beat timing
(the constants plus the computed `BeatPlan`), the camera plan, the assets (palette and colours), the stage
geometry, and the public `SceneLayout`. A static Next route, `/run/[id]`, loads an artifact by id at build time and
plays it with the existing replay player.

The manifest is what guarantees that a published run never changes under a viewer's feet. The log stays the
source of truth and can be re-rendered later. A run that has already been published, though, replays with the
timing, camera and colours it was published with, however much `lib/replay/beats.ts` has been retuned since.

## User Story

As the person running a matchup
I want to publish one finished run as a stable URL
So that anyone I send it to sees exactly the replay I watched, today or after the renderer has changed, at zero
inference cost

## Problem Statement

TICKET-8 built the player, but every value that decides how a run *looks* is a module constant that the next
retune will change:

1. **Timing.** `BEAT_MS`, `INTRO_MS`, `OUTRO_MS`, `LANE_OFFSET_MS`, `WALK_FRACTION` and `ACT_FRACTION` live in
   `lib/replay/beats.ts:40-56`, and `laneAt` reads the fractions directly (`beats.ts:86-87`). Spike 3
   (`docs/decisions/replay-legibility.md`) exists to retune them.
2. **Camera.** Hard-coded in `components/scene/RoomScene.tsx:32-44`: position `[0, 5.6, 6.2]`, fov 42, look-at
   `(0, 0.3, -1.4)`, and a sway of 0.15 over `BEAT_MS * 4`.
3. **Assets.** Colours are in `components/scene/palette.ts`, and the lane colours are duplicated as CSS custom
   properties in `components/scene/replay.module.css:19-20`.
4. **Stage geometry.** `ROOM_HALF` (`lib/replay/layout.ts:34`), `WALL_HEIGHT` (`RoomScene.tsx:32`), and
   `STAND_OFF` / `EXIT_WALK_MS` / `EXIT_FADE_MS` (`Character.tsx:35-38`).
5. **There is no artifact.** `scripts/run.mts` writes `runs/<id>/run.json` and `events.json` into a gitignored
   directory. `run.json` records a `roomId` but not where the room came from. There is no route that loads a run
   by id.
6. **No end-to-end secrecy proof.** `lib/providers/secrets.test.ts:33-35` says explicitly: "When TICKET-9 adds
   `lib/artifact/`, add it to ARTIFACT_SIDE."

## Solution Statement

**Lift every tunable into one data snapshot, freeze it into the artifact, and make the player read the snapshot
instead of the constants.**

- **`lib/replay/renderer.ts` (new, client-safe).** The `RendererSnapshot` type and a `CURRENT_RENDERER` value built
  from today's constants: timing, camera, assets and geometry, plus `RENDERER_VERSION`. `palette.ts`'s values move
  here, so there is one source of truth.
- **`lib/replay/beats.ts` (refactor).** `planBeats(data, timing = CURRENT_RENDERER.timing)`. `BeatPlan` gains
  `walkFraction` and `actFraction`, so `laneAt` depends **only on the plan**. The exported constants stay, so
  `/replay` and the existing tests are unchanged.
- **`components/scene/*` (refactor).** `ReplayPlayer` takes a `renderer: RendererSnapshot` prop and passes it down
  to `ReplayStage` → `RoomScene` / `Character` / `SceneObject`. No component reads a module constant for timing,
  camera, colour or geometry any more. The lane colours reach the CSS as inline custom properties.
- **`lib/artifact/` (new, server- and script-side).**
  - `schema.ts`: `RenderManifestSchema` and `PublishedArtifactSchema`, both Zod strict objects, plus `parseArtifact`
    and `ArtifactError`.
  - `publish.ts`: `buildArtifact(...)`. Pure. It checks the room matches the run, projects the layout, validates
    through `buildReplay`, freezes the plan, and scans for secrets.
  - `replay.ts`: `replayFromArtifact(artifact)`. Pure. It rebuilds `ReplayData` from the frozen layout, re-derives
    the plan from the frozen timing, and refuses on drift or on an unsupported renderer major.
  - `scan.ts`: the URL and key-shape scanner.
  - `store.ts`: `node:fs` reads of `published/`.
- **`scripts/publish.mts` (new).** A CLI that publishes `runs/<id>/` plus `--room <path>` to `published/<slug>.json`.
  It refuses to overwrite an artifact unless `--force` is given. `--canonical` publishes the golden fixtures with a
  fixed timestamp.
- **`app/run/[id]/page.tsx` (new).** A server component. `generateStaticParams` returns the ids from
  `listArtifactIds()`, `dynamicParams = false` makes an unknown id a 404, and the page renders
  `<ReplayPlayer data renderer>` from `replayFromArtifact`.
- **Proofs.**
  - The secrets sweep covers `lib/artifact`, and scans `published/*.json` the same way it scans `fixtures/`.
  - A Vitest **renderer-bump test** mocks `CURRENT_RENDERER` with a bumped snapshot, then shows the committed
    canonical artifact replays deep-equal.
  - A Playwright test shows `/run/canonical` plays to its frozen `totalMs` and makes no cross-origin request.

## Out of Scope / Non-Goals

- **Not included:** the comparison view and the variance statement. That's TICKET-10 (#10). The artifact carries
  `run.summaries` and `typicalOfRepeats` so #10 has the data, but this ticket renders nothing new from them.
- **Not included:** telemetry (TICKET-11, #11), video export, hosting or deploying, and an index page listing runs.
- **Not included:** bundling the silent repeats' logs. Only the hero run is published, and `typicalOfRepeats` is
  the disclosure (`architecture.md` → *Other calls · publication unit*).
- **Not included:** a scan of the built `.next/static` bundle. The source sweeps and the runtime network assertion
  cover it (D5).
- **Not included:** keeping old renderer *geometry code* (versioned mesh components). The data is frozen, and a
  change to geometry semantics is a **major** renderer bump that the loader refuses (D2).
- **Not changing:** the `/replay` route's behaviour. It stays the live preview of `CURRENT_RENDERER` over the
  fixtures.
- **Not changing:** `RoomSpec`, `Event` or `Run` schemas. They stay at v0; TICKET-7 owns the v1 bump.
- **Not changing:** intent handling. It stays verbatim (`lib/replay/timeline.ts:88`).

## Feature Metadata

**Feature Type**: New Capability (plus a data-driven refactor of the renderer)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `lib/replay` (beats, new renderer snapshot), `components/scene` (props instead of
constants), new `lib/artifact`, new `app/run/[id]`, new `scripts/publish.mts`, new committed `published/`
**Dependencies**: none new. It uses Zod 4.6.5, Next 16.3.2, Vitest 4.1.11 and Playwright 1.63.0, which are already
installed.

## Related Work

**Implements**: [TICKET-9 · #9](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/9)   ·   **Epic**:
`docs/tickets/llm-escape-room.md` + `architecture.md` (*Data model · RenderManifest*, *Boundaries & contracts ·
Replay ↔ artifact*, *Secrets*)

**Back-references**:

- `.claude/plans/replay-player-v0.md`: the player this freezes. `ReplayData` was designed as plain JSON "because
  TICKET-9 freezes it" (`lib/replay/types.ts:10-13`).
- `.claude/plans/run-harness.md`: the writer of `runs/<id>/run.json` + `events.json`, which are this ticket's
  input.
- `.claude/plans/provider-adapters.md`: the secrets sweep this extends.
- `.claude/plans/substrate-spike-v1.md`: the v0 → v1 bump. It will now also have to migrate `published/*.json`
  (see OPEN QUESTIONS).

**Forward-references**:

- TICKET-10 (#10) adds the comparison to `app/run/[id]/page.tsx` from `artifact.run`.
- TICKET-11 (#11) adds the telemetry hook to the player on `/run/[id]`.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md`: Next 16 differs from your training data. Read the docs under `node_modules/next/dist/docs/`.
- `lib/replay/beats.ts` (all, 93 lines): the constants and `planBeats` / `laneAt` / `beatStartMs`, which this
  ticket parameterises. The header (lines 1-30) says retunes bump `RENDERER_VERSION` and TICKET-9 freezes them.
- `lib/replay/types.ts` (lines 37-121): `SceneLayout`, `ReplayData`, `BeatPlan` (which gains two fields) and
  `LaneMoment`.
- `lib/replay/timeline.ts` (lines 25-139): `buildReplay` and `ReplayError`, the validation `buildArtifact` reuses.
  Mirror its reason-coded error class for `ArtifactError`.
- `lib/replay/layout.ts` (lines 1-40, 99-119): `buildSceneLayout`, the secrecy boundary. `ROOM_HALF` is at line 34.
- `lib/replay/index.ts`: the barrel. Add the renderer exports here.
- `lib/replay/boundary.test.ts` (all): the client sweep. `lib/replay/renderer.ts` falls inside it automatically,
  and must pass (no env, no fetch, no URL, no clock).
- `lib/replay/beats.test.ts`, `lib/replay/fixture.test.ts`: existing tests that must keep passing unchanged, or with
  one mechanical edit (see Task 3).
- `lib/replay/testing.ts` (lines 1-60+): builders `event`, `lane`, `beat` and `replayData`. Reuse them, and don't
  add a second builder set.
- `components/scene/ReplayPlayer.tsx`, `ReplayStage.tsx`, `RoomScene.tsx` (lines 1-60, 80-100),
  `Character.tsx` (lines 25-100), `SceneObject.tsx` (lines 1-30, 70-115), `palette.ts`, `usePlayback.ts`: every
  place a constant is read (the grep table is in NOTES).
- `components/scene/replay.module.css` (lines 15-25): `--lane-a` / `--lane-b`.
- `app/replay/page.tsx`: the server-component pattern to mirror for `/run/[id]`. Its header says #9 adds
  `/run/[id]`.
- `app/page.tsx`: the placeholder whose comment points at `/run/[id]`. Update its link.
- `lib/schema/version.ts` (all): versioning philosophy (`z.literal`, separate version per contract) and
  `SchemaError`.
- `lib/schema/run.ts` (lines 1-12, 75-104): `RunSchema` and `parseRun`, and the "published together with a render
  manifest" note.
- `lib/schema/event.ts` (lines 14-24): "the frozen beat plan… lives in the render manifest (TICKET-9)".
- `lib/providers/secrets.test.ts` (all): `ARTIFACT_SIDE`, `KEY_SHAPED`, `ENDPOINT`, and the fixture JSON scan
  (lines 85-95) to extend to `published/`.
- `scripts/run.mts` (lines 1-30, 110-150): the CLI conventions to mirror in `publish.mts` (`parseArgs`, `fail(msg,
  code)`, `USAGE`, pretty JSON + trailing newline, "counts only, never answers" printing), and the output layout
  it reads.
- `scripts/generate-fixtures.mts` (lines 1-30): the "parse through its own schema before writing" rule, and the
  fixed `START`/`RUN_ID` pattern for deterministic output.
- `fixtures/index.ts`: `loadCanonicalRoom` / `loadCanonicalLog` / `loadCanonicalRun`.
- `e2e/replay.spec.ts` (all): the Playwright patterns (`page.clock.install()`, chunked `advance`, `data-testid`s).
- `playwright.config.ts`, `vitest.config.mts`: runner split (`*.spec.ts` vs `*.test.ts`). Vitest only collects
  `{lib,fixtures,scripts}/**`.
- `lib/schema/migrations/README.md`: add `published/` to "Scope when the time comes".
- `.gitignore`: `/runs/` and `*.run.json` are ignored. Artifacts must be named `<id>.json`, **never**
  `<id>.run.json`.

### New Files to Create

- `lib/replay/renderer.ts`: `RendererSnapshot` types, `CURRENT_RENDERER`, `rendererMajor()`,
  `SUPPORTED_RENDERER_MAJORS`
- `lib/replay/renderer.test.ts`
- `lib/artifact/schema.ts`: `ARTIFACT_VERSION`, Zod schemas, `parseArtifact`, `ArtifactError`, `ARTIFACT_ID`
- `lib/artifact/scan.ts`: `findLeaks(text)`
- `lib/artifact/publish.ts`: `buildArtifact`
- `lib/artifact/replay.ts`: `replayFromArtifact`
- `lib/artifact/store.ts`: `PUBLISHED_DIR`, `listArtifactIds`, `loadArtifact`, `artifactPath`
- `lib/artifact/index.ts`: the barrel
- `lib/artifact/schema.test.ts`, `scan.test.ts`, `publish.test.ts`, `replay.test.ts`, `freeze.test.ts` (the
  renderer-bump test), `canonical.test.ts` (committed-artifact drift + leak scan), `boundary.test.ts`
- `scripts/publish.mts`
- `published/canonical.json`: generated by the script, never hand-written
- `published/README.md`: what this directory is, and that files are frozen
- `app/run/[id]/page.tsx`
- `e2e/run.spec.ts`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-static-params.md`
  - "Single Dynamic Segment". `params` is a **Promise** in Next 16 and must be awaited.
  - Why: the `/run/[id]` page.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/dynamicParams.md`
  - `false` → an id not in `generateStaticParams` returns 404.
  - Why: an unknown id must not be generated at request time. There is no server.
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md`
  - Why: the defensive `notFound()` in the page, which must be called in the render path.
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` → "Page Props Helper"
  - `PageProps<'/run/[id]'>` needs generated types. **Don't use it**; type `params` explicitly (see Task 13's
    GOTCHA).
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`, if it's present
  - Why: the per-run `<title>`.
- [Vitest `vi.doMock`](https://vitest.dev/api/vi.html#vi-domock) and
  [`vi.resetModules`](https://vitest.dev/api/vi.html#vi-resetmodules)
  - Why: the renderer-bump test swaps `@/lib/replay/renderer` before a dynamic `import()` of the loader.
- [Playwright `page.on('request')`](https://playwright.dev/docs/api/class-page#page-event-request)
  - Why: the no-cross-origin-request assertion.

### Patterns to Follow

**Naming Conventions:** camelCase files in `lib/` (`roomState.ts`), PascalCase components, `SCREAMING_SNAKE`
constants, and `parseX` + `XError extends SchemaError` per schema module (`lib/schema/run.ts:95-104`). Reason-coded
errors carry a `readonly reason` from an `as const` tuple (`lib/replay/timeline.ts:25-45`).

**Error Handling:** mirror `ReplayError`:

```ts
export const ARTIFACT_ERROR_REASONS = ['room_mismatch', 'leak', 'plan_drift', 'unsupported_renderer', 'not_found'] as const;
export type ArtifactErrorReason = (typeof ARTIFACT_ERROR_REASONS)[number];
export class ArtifactError extends Error {
  readonly reason: ArtifactErrorReason;
  readonly detail: string;
  constructor(reason: ArtifactErrorReason, detail: string) {
    super(`artifact: ${reason} (${detail})`);
    this.name = 'ArtifactError';
    this.reason = reason;
    this.detail = detail;
  }
}
```

A schema failure is a separate `ArtifactSchemaError extends SchemaError`, thrown by `parseArtifact`, mirroring
`RunError`.

**Versioning:** `ARTIFACT_VERSION = 0` is written as `z.literal` (`lib/schema/version.ts:37-44`). Put the constant
and `ArtifactVersionSchema` in `lib/schema/version.ts`, next to the three existing ones, with a comment in the same
voice. The artifact envelope is versioned separately from the log, the run and the renderer.

**Build by listing, never spreading:** `lib/replay/layout.ts:21-27`. `buildArtifact` names every top-level field.
It never spreads the `Run`, and it never takes a `RoomSpec` into the output.

**Comments:** every module opens with a `/** … */` header in the house voice: why, not what, `── Section ──` rules,
and ticket cross-references as `TICKET-n (#issue)`. Match `lib/replay/beats.ts:1-30`.

**CLI:** `scripts/run.mts`: `parseArgs`, `fail(message, code)` with exit 2 for usage and 1 for runtime, a `USAGE`
string, `writeFileSync(path, \`${JSON.stringify(value, null, 2)}\n\`)`, and printed output that holds only counts
and ids.

**Tests:** Vitest `describe`/`it`, fixtures via `@/fixtures`, and source-on-disk sweeps with a **positive control**
(`lib/replay/boundary.test.ts:108-123`). E2E through `data-testid`s and Playwright's fake clock.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation (renderer snapshot)

Lift the tunables into `lib/replay/renderer.ts` and make `planBeats`/`laneAt` plan-driven. The behaviour of
`/replay` must be byte-identical after this phase.

### Phase 2: Player reads the snapshot

**Depends on:** Phase 1

Thread `renderer` through `components/scene`, and delete the constant reads. `/replay` passes `CURRENT_RENDERER`.

### Phase 3: Artifact library

**Depends on:** Phase 1 (needs `RendererSnapshot`, `planBeats(data, timing)`)
**Independent of:** Phase 2. It could run in parallel, but it's small enough to run in sequence.

Schema, scan, publish, replay, store, barrel.

### Phase 4: Publishing + route

**Depends on:** Phases 2 and 3

`scripts/publish.mts`, the generated `published/canonical.json`, and `app/run/[id]/page.tsx`.

### Phase 5: Proofs

**Depends on:** Phase 4

The renderer-bump test, the canonical drift and leak test, the extended secrets sweep, the artifact boundary
sweep, and the e2e test.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. CREATE `lib/replay/renderer.ts`

- **IMPLEMENT**:
  ```ts
  export interface BeatTiming {
    readonly beatMs: number; readonly introMs: number; readonly outroMs: number;
    readonly laneOffsetMs: number; readonly walkFraction: number; readonly actFraction: number;
    /** After its last beat, an escaped character walks out and fades. */
    readonly exitWalkMs: number; readonly exitFadeMs: number;
  }
  export interface CameraPlan {
    readonly position: readonly [number, number, number];
    readonly lookAt: readonly [number, number, number];
    readonly fov: number;
    /** Sideways drift; 0 under reduced motion regardless. */
    readonly swayAmplitude: number;
    readonly swayPeriodMs: number;
  }
  export interface RendererAssets {
    readonly laneColours: readonly string[];
    readonly scene: { background; floor; wall; success; failure; locked; unlocked }; // all string
    readonly kindColours: Readonly<Record<ObjectKind, string>>;
  }
  export interface StageGeometry { readonly roomHalf: number; readonly wallHeight: number; readonly standOff: number; }
  export interface RendererSnapshot {
    readonly rendererVersion: string; // 'replay-v<major>.<minor>'
    readonly timing: BeatTiming; readonly camera: CameraPlan;
    readonly assets: RendererAssets; readonly geometry: StageGeometry;
  }
  export const CURRENT_RENDERER: RendererSnapshot = { … };   // values below
  export const SUPPORTED_RENDERER_MAJORS: readonly number[] = [0];
  export function rendererMajor(version: string): number | null; // /^replay-v(\d+)\.(\d+)$/ → major, else null
  ```
  Values: timing comes from the `beats.ts` constants (`BEAT_MS`, `INTRO_MS`, `OUTRO_MS`, `LANE_OFFSET_MS`,
  `WALK_FRACTION`, `ACT_FRACTION`) plus `exitWalkMs: 1500, exitFadeMs: 1000` (`Character.tsx:37-38`). Camera:
  `position [0, 5.6, 6.2]`, `lookAt [0, 0.3, -1.4]`, `fov 42`, `swayAmplitude 0.15`, `swayPeriodMs BEAT_MS * 4`
  (`RoomScene.tsx:33-43`). Assets: the literal values from `components/scene/palette.ts`. Geometry: `roomHalf:
  ROOM_HALF`, `wallHeight 1.6`, `standOff 0.9`. `rendererVersion: RENDERER_VERSION`. Import the constants from
  `./beats` and `./layout`, so the numbers exist once.
  Header comment: this is the **single description of how a run looks**. `/replay` plays `CURRENT_RENDERER`. A
  published run plays its own frozen copy. **Minor bump** = a value in here changed (old artifacts still play
  exactly, because they carry their own values). **Major bump** = geometry or behaviour *code* changed in a way a
  frozen snapshot cannot describe, so old artifacts are refused until a compatible path exists.
- **PATTERN**: `lib/replay/beats.ts` constants and header style. The `ObjectKind` type comes from
  `@/lib/schema/room` as a **type import** (`boundary.test.ts` forbids a value import).
- **IMPORTS**: `import type { ObjectKind } from '@/lib/schema/room'`, and constants from `./beats` and `./layout`.
- **GOTCHA**: `beats.ts` must NOT import `renderer.ts` at module top in a way that creates a cycle. `renderer.ts`
  imports from `beats.ts`, and `beats.ts` imports only the *type* `BeatTiming` from `renderer.ts`. For the default
  parameter in Task 2, define `DEFAULT_TIMING` inside `beats.ts` from its own constants rather than importing
  `CURRENT_RENDERER`. The boundary sweep also forbids the string `https://` in any `lib/replay` file, including
  comments.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/replay/boundary.test.ts`
- **SATISFIES**: AC #1 (the manifest has something to freeze)

### 2. REFACTOR `lib/replay/beats.ts` + `lib/replay/types.ts`

- **IMPLEMENT**:
  - `types.ts`: `BeatPlan` gains `readonly walkFraction: number; readonly actFraction: number;`.
  - `beats.ts`: `export const DEFAULT_TIMING: BeatTiming = { beatMs: BEAT_MS, … exitWalkMs: 1500, exitFadeMs:
    1000 }`. Then `renderer.ts` uses `timing: DEFAULT_TIMING`, which removes the duplication.
  - `planBeats(data, timing: BeatTiming = DEFAULT_TIMING)` uses `timing.*` everywhere and returns `walkFraction` and
    `actFraction` in the plan.
  - `laneAt` reads `plan.walkFraction` / `plan.actFraction` instead of the module constants.
  - Add `exitWalkMs` / `exitFadeMs` to the plan too, so `Character` needs only the plan for time.
  - Update the header's "Retuning" paragraph: TICKET-9 now freezes them through `lib/replay/renderer.ts` into
    `RenderManifest`.
- **PATTERN**: the existing pure arithmetic. No behaviour change for the default timing.
- **GOTCHA**: `beats.test.ts:66` asserts `planBeats(...)` `toEqual({ ...plan })`. That still holds, but any
  `toEqual` against a literal plan object needs the new fields. Grep `beatMs:` in tests.
- **VALIDATE**: `pnpm vitest run lib/replay && pnpm typecheck`
- **SATISFIES**: AC #4 (timing becomes data)

### 3. UPDATE `lib/replay/index.ts` + ADD `lib/replay/renderer.test.ts`

- **IMPLEMENT**: export `CURRENT_RENDERER`, `DEFAULT_TIMING`, `SUPPORTED_RENDERER_MAJORS`, `rendererMajor`, and the
  types (`BeatTiming`, `CameraPlan`, `RendererAssets`, `StageGeometry`, `RendererSnapshot`). Tests:
  - `CURRENT_RENDERER` is JSON-round-trip equal (`JSON.parse(JSON.stringify(x))` deep-equals x): no functions,
    Maps or undefined.
  - Its timing equals the `beats.ts` constants, and `rendererVersion === RENDERER_VERSION`.
  - `rendererMajor('replay-v0.1') === 0`, `rendererMajor('replay-v12.3') === 12`, and `rendererMajor('v0')` /
    `rendererMajor('')` are `null`.
  - `SUPPORTED_RENDERER_MAJORS` includes `rendererMajor(CURRENT_RENDERER.rendererVersion)`, so the current renderer
    can always play what it publishes.
  - `planBeats(data, { ...DEFAULT_TIMING, beatMs: 4000 })` changes `totalMs` and `beatMs`, and `laneAt` phase
    boundaries follow the plan's fractions (walk ends at `round(4000 * walkFraction)`).
- **PATTERN**: `lib/replay/beats.test.ts` using `replayData`/`lane` from `./testing`.
- **VALIDATE**: `pnpm vitest run lib/replay`
- **SATISFIES**: AC #4

### 4. REFACTOR `components/scene/*` to read a `RendererSnapshot` prop

- **IMPLEMENT**:
  - `ReplayPlayer({ data, renderer }: { data: ReplayData; renderer: RendererSnapshot })`:
    `plan = useMemo(() => planBeats(data, renderer.timing), [data, renderer])`. Set `style={{ '--lane-a':
    renderer.assets.laneColours[0], '--lane-b': renderer.assets.laneColours[1] } as CSSProperties}` on the `<main>`,
    and pass `renderer` to `ReplayStage`.
  - `ReplayStage`: take `renderer`, and give lane colour `renderer.assets.laneColours[i % length]` and `renderer` to
    `RoomScene`.
  - `RoomScene`: `CameraRig` takes `camera: CameraPlan`. Sway is `Math.sin((t / camera.swayPeriodMs) * 2π) *
    camera.swayAmplitude`, and position, lookAt and fov come from the plan. Use `renderer.assets.scene.*` for
    background, floor and wall, and `renderer.geometry.roomHalf` / `wallHeight` for the walls. Remove the `BEAT_MS`
    and `ROOM_HALF` imports and the `WALL_HEIGHT` / `SWAY` constants. Pass `renderer` to `SceneObject` and
    `Character`.
  - `Character`: `STAND_OFF` becomes `renderer.geometry.standOff`, and `EXIT_WALK_MS` / `EXIT_FADE_MS` become
    `plan.exitWalkMs` / `plan.exitFadeMs`. `KIND_COLOUR.portable` becomes `renderer.assets.kindColours.portable`.
  - `SceneObject`: `KIND_COLOUR` / `SCENE` become `renderer.assets`. Build `HIGHLIGHT_COLOUR` from
    `assets.scene.success/failure` inside the component (memoised).
  - **DELETE `components/scene/palette.ts`.** Its values now live in `CURRENT_RENDERER.assets`.
  - `replay.module.css:19`: keep `--lane-a/--lane-b` as fallbacks, and change the comment to "overridden inline from
    the renderer snapshot's `assets.laneColours`".
- **PATTERN**: the existing prop threading (`plan`, `timeRef`, `colour`). Keep `'use client';` as line 1 of every
  file (`boundary.test.ts:101-106`).
- **IMPORTS**: `import type { RendererSnapshot, CameraPlan } from '@/lib/replay'`.
- **GOTCHA**:
  - A literal `'#222'` keypad colour (`SceneObject.tsx:112`) and `#000000` (line 66) stay as code (a trivial
    neutral). Note that a change to either is a minor bump **plus** moving them into `assets`.
  - `HIGHLIGHT_INTENSITY` and `OPEN_ANGLE` are geometry/behaviour. Leave them in code. They are covered by the
    "major bump" rule (see NOTES → what is and isn't frozen).
  - After this task, `grep -rnE "BEAT_MS|ROOM_HALF|KIND_COLOUR|LANE_COLOURS|SCENE\\.|palette" components` must
    return nothing.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/replay/boundary.test.ts && grep -rnE "BEAT_MS|ROOM_HALF|KIND_COLOUR|LANE_COLOURS|SCENE\.|from './palette'" components; test $? -eq 1`
- **SATISFIES**: AC #4 (the player reads the frozen values, not constants)

### 5. UPDATE `app/replay/page.tsx`

- **IMPLEMENT**: `<ReplayPlayer data={data} renderer={CURRENT_RENDERER} />`. Update the header: `/replay` is the
  **live preview** of the current renderer over the fixtures, and `/run/[id]` plays frozen published artifacts.
- **VALIDATE**: `pnpm typecheck && pnpm e2e e2e/replay.spec.ts` (all 4 existing tests must pass unchanged, which
  proves the refactor is behaviour-preserving)
- **SATISFIES**: AC #7 (no regressions)

### 6. UPDATE `lib/schema/version.ts`

- **IMPLEMENT**: `export const ARTIFACT_VERSION = 0;` and `export const ArtifactVersionSchema =
  z.literal(ARTIFACT_VERSION);`. The comment should say it versions the *envelope* (which fields a published file
  has), separately from the log, the run and the renderer, because adding e.g. a `repeats` block to the envelope
  shouldn't invalidate a log, and retuning the renderer never changes the envelope.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1 (versioned JSON)

### 7. CREATE `lib/artifact/schema.ts` + `schema.test.ts`

- **IMPLEMENT**:
  ```ts
  /** URL segment and filename. Lowercase slug: no path traversal, no case collisions on macOS. */
  export const ARTIFACT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const Vec2 = z.tuple([z.number(), z.number()]);
  const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
  const Hex = z.string().regex(/^#[0-9a-f]{6}$/i);
  export const SceneLayoutSchema = z.strictObject({ roomId, themeName, objects: z.array(z.strictObject({ id, name,
    kind: z.enum(OBJECT_KINDS), parentId: z.string().nullable(), position: Vec2 })), puzzleTargets: z.record(z.string(),
    z.string()), exitObjectId, centre: Vec2 });
  export const BeatTimingSchema, CameraPlanSchema, RendererAssetsSchema (kindColours: strictObject with every
    ObjectKind key), StageGeometrySchema;
  export const BeatPlanSchema = z.strictObject({ beatMs, introMs, outroMs, laneOffsetsMs: z.array(nonneg int),
    beatCounts: z.array(nonneg int), totalMs, walkFraction, actFraction, exitWalkMs, exitFadeMs });
  export const RenderManifestSchema = z.strictObject({
    rendererVersion: z.string().regex(/^replay-v\d+\.\d+$/),
    timing: BeatTimingSchema, camera: CameraPlanSchema, assets: RendererAssetsSchema, geometry: StageGeometrySchema,
    layout: SceneLayoutSchema, beatPlan: BeatPlanSchema,
  });
  export const PublishedArtifactSchema = z.strictObject({
    artifactVersion: ArtifactVersionSchema,
    id: z.string().regex(ARTIFACT_ID),
    publishedAt: z.iso.datetime(),
    run: RunSchema,
    log: EventLogSchema,
    manifest: RenderManifestSchema,
  });
  export type RenderManifest = z.infer<…>; export type PublishedArtifact = z.infer<…>;
  export class ArtifactSchemaError extends SchemaError {}
  export function parseArtifact(raw: unknown): PublishedArtifact;
  // + ArtifactError / ARTIFACT_ERROR_REASONS (see Patterns)
  ```
  The header explains:
  - **Strict objects everywhere.** An unknown key is refused, which is the mechanical half of "the artifact carries
    no secret". Nothing can ride along in a field nobody listed.
  - **No `RoomSpec`.** The layout is the public projection (`lib/replay/layout.ts`).
  - Both `timing` and `beatPlan` are stored. The plan is what plays, and the timing is how to re-derive and check
    it.
- **PATTERN**: `lib/schema/run.ts` (strictObject, `z.iso.datetime()`, parse + named error). Check the exported name
  of the object-kind tuple in `lib/schema/room.ts` (e.g. `OBJECT_KINDS`) before using it. Its **value** import is
  fine here, because `lib/artifact` isn't in the replay's client sweep.
- **GOTCHA**:
  - Zod v4: `z.record(keySchema, valueSchema)` needs two arguments, and `z.strictObject` is the v4 spelling.
  - The Zod `z.infer` types are mutable while `lib/replay/types.ts` is `readonly`. Assignability from inferred to
    readonly works, which is the direction needed. Assert it in the test with Vitest `expectTypeOf<z.infer<typeof
    SceneLayoutSchema>>().toExtend<SceneLayout>()` (on Vitest 4, use `toMatchTypeOf` if `toExtend` isn't there).
    Do the same for `BeatPlan` and `RendererSnapshot` (manifest minus layout/beatPlan).
- **Tests**:
  - A hand-built minimal artifact from fixtures parses.
  - An extra key at the top level, in `manifest`, in `camera` and in a layout object is each refused.
  - `artifactVersion: 1` is refused.
  - A bad id (`../x`, `Run`, `a/b`, empty, or 65 characters) is refused.
  - A bad `rendererVersion` (`v0.1`) is refused.
  - The type-level `expectTypeOf` checks.
- **VALIDATE**: `pnpm vitest run lib/artifact/schema.test.ts && pnpm typecheck`
- **SATISFIES**: AC #1

### 8. CREATE `lib/artifact/scan.ts` + `scan.test.ts`

- **IMPLEMENT**: `export interface Leak { kind: 'url' | 'endpoint' | 'key'; match: string /* first 12 chars +
  '…' */ }` and `export function findLeaks(text: string): Leak[]`. The patterns are `https?:\/\/`,
  `api\.groq\.com|generativelanguage\.googleapis\.com`, `\bgsk_[A-Za-z0-9]{20,}` and `\bAIza[0-9A-Za-z_-]{30,}`.
  They are **copied** from `lib/providers/secrets.test.ts:52-54`, not imported (the artifact side must never
  import the providers). A comment says so, like `lib/schema/event.ts:60-62`. `match` is truncated so an error
  message never re-prints a whole key.
- **Tests**: clean fixture JSON → `[]`, and each planted pattern is found with the right kind. A truncated `match`
  never contains the full planted key.
- **VALIDATE**: `pnpm vitest run lib/artifact/scan.test.ts`
- **SATISFIES**: AC #3 (no secret)

### 9. CREATE `lib/artifact/publish.ts` + `publish.test.ts`

- **IMPLEMENT**:
  ```ts
  export interface BuildArtifactInput {
    readonly id: string; readonly run: Run; readonly log: EventLog; readonly room: RoomSpec;
    readonly renderer: RendererSnapshot; readonly publishedAt: string; // ISO; injected, like HarnessDeps.now
  }
  export function buildArtifact(input: BuildArtifactInput): PublishedArtifact
  ```
  Steps:
  1. `room.roomId !== run.roomId` → `ArtifactError('room_mismatch', …)`.
  2. `layout = buildSceneLayout(room)`.
  3. `data = buildReplay({ log, run, layout })`, which throws `ReplayError` on a broken log. Let it propagate.
  4. `beatPlan = planBeats(data, renderer.timing)`.
  5. Assemble **by listing**:
     `{ artifactVersion: ARTIFACT_VERSION, id, publishedAt, run, log, manifest: { rendererVersion:
     renderer.rendererVersion, timing: renderer.timing, camera: renderer.camera, assets: renderer.assets,
     geometry: renderer.geometry, layout, beatPlan } }`.
  6. `const artifact = parseArtifact(candidate)`.
  7. `const leaks = findLeaks(JSON.stringify(artifact))`. If there are any, throw `ArtifactError('leak',
     leaks.map(l => l.kind).join(', '))`.
  8. Return `artifact`.
  Header: pure (no fs, no clock), and the room goes in but never comes out (only its projection).
- **Tests** (fixtures + `lib/replay/testing.ts` builders):
  - The canonical inputs produce a parsing artifact whose manifest equals `CURRENT_RENDERER` fields and whose
    `beatPlan` equals `planBeats(buildReplay(...), CURRENT_RENDERER.timing)`.
  - **The room's secrets never appear.** For every `puzzle.answer` and lock `code` in the canonical room, check
    `JSON.stringify(artifact)` doesn't contain it **outside `log`**. The log legitimately contains the models'
    submitted answers, so assert on `JSON.stringify({ ...artifact, log: [] , run: artifact.run })`, i.e. the
    manifest. Also assert `Object.keys(artifact)` is exactly the six keys.
  - A room with a different `roomId` → `room_mismatch`.
  - A log with a seq gap → `ReplayError` `seq_break`.
  - An intent containing `gsk_…` (built with `event({ action: { name: 'look', intent: 'key gsk_' + 'a'.repeat(24)
    } })`) → `ArtifactError` `leak`.
  - An invalid id → `ArtifactSchemaError`.
- **GOTCHA**: read the canonical room fixture for field names (`puzzles[].answer`, lock codes) before writing the
  secrecy assertion. Check `lib/schema/room.ts`. A model's `enter_code` with the right code *is* in the log by
  design: that is what the model did, not a leak.
- **VALIDATE**: `pnpm vitest run lib/artifact/publish.test.ts`
- **SATISFIES**: AC #1, AC #3

### 10. CREATE `lib/artifact/replay.ts` + `replay.test.ts`

- **IMPLEMENT**:
  ```ts
  export interface FrozenReplay { readonly data: ReplayData; readonly renderer: RendererSnapshot; readonly plan: BeatPlan; }
  export function replayFromArtifact(artifact: PublishedArtifact): FrozenReplay
  ```
  Steps:
  1. `major = rendererMajor(manifest.rendererVersion)`. If it's not in `SUPPORTED_RENDERER_MAJORS`, throw
     `ArtifactError('unsupported_renderer', version)`.
  2. `data = buildReplay({ log, run, layout: manifest.layout })`.
  3. `plan = planBeats(data, manifest.timing)`. If it isn't deep-equal to `manifest.beatPlan` (compare via
     `JSON.stringify` of both, since the key order is fixed by construction, or write a small field-wise equality),
     throw `ArtifactError('plan_drift', …)`.
  4. `renderer = { rendererVersion, timing, camera, assets, geometry }` **from the manifest, listed**.
  5. Return `{ data, renderer, plan: manifest.beatPlan }`.
  **This module must never import `CURRENT_RENDERER`** (a comment says so, and the boundary test in Task 17
  enforces it). The only thing it takes from the live renderer is `SUPPORTED_RENDERER_MAJORS`.
- **Tests**:
  - Round trip: `replayFromArtifact(buildArtifact(canonical))` gives `data` deep-equal to the `/replay` pipeline's
    `buildReplay` output, and `renderer` equal to `CURRENT_RENDERER`.
  - An artifact with `rendererVersion: 'replay-v9.0'` → `unsupported_renderer`.
  - A tampered `beatPlan.totalMs` → `plan_drift`.
  - The result is JSON-round-trip equal (it crosses into a client component as props).
- **VALIDATE**: `pnpm vitest run lib/artifact/replay.test.ts`
- **SATISFIES**: AC #2, AC #4

### 11. CREATE `lib/artifact/store.ts`, `lib/artifact/index.ts`, `published/README.md`

- **IMPLEMENT**:
  - `store.ts`:
    - `export const PUBLISHED_DIR = join(process.cwd(), 'published')`.
    - `artifactPath(id, dir = PUBLISHED_DIR)` checks `ARTIFACT_ID` and throws `ArtifactError('not_found', id)` on a
      bad id, **before** touching the filesystem (so `../` never reaches `join`).
    - `listArtifactIds(dir = PUBLISHED_DIR)`: sorted `*.json` basenames in the dir that match `ARTIFACT_ID`,
      excluding `README`. Returns `[]` if the dir is missing.
    - `loadArtifact(id, dir = PUBLISHED_DIR)`: `parseArtifact(JSON.parse(readFileSync(...)))`, and it also asserts
      `artifact.id === id`. A missing file throws `ArtifactError('not_found', id)`.
  - `index.ts`: a barrel exporting schema, scan, publish, replay and store. Its header says: server- and
    script-side only. It uses `node:fs` and value-imports the schemas. It is never imported from `components/`.
  - `published/README.md`: a few lines. Each file is a frozen published run. It's written only by
    `scripts/publish.mts` and never hand-edited. Overwriting one changes a URL someone may already have shared,
    which is why the script demands `--force`. It holds no `RoomSpec` and no secret, which the tests enforce. A
    schema version bump (TICKET-7) must migrate these files along with `fixtures/`.
- **GOTCHA**: `process.cwd()` isn't `process.env`, so the secrets sweep's env rule is unaffected. Vitest, `next
  build` and `tsx` all run from the repo root. Add a test in `replay.test.ts` or a new `store.test.ts` using a
  temporary dir under `os.tmpdir()`, covering: list filters junk, a bad id throws before any fs access, and an id
  mismatch throws.
- **VALIDATE**: `pnpm vitest run lib/artifact && pnpm typecheck`
- **SATISFIES**: AC #2

### 12. CREATE `scripts/publish.mts`, then GENERATE `published/canonical.json`

- **IMPLEMENT**:
  ```
  node --import tsx scripts/publish.mts --run runs/<runId> --room <path> [--id <slug>] [--out published] [--force]
  node --import tsx scripts/publish.mts --canonical [--force]
  ```
  - `--run`: read `<dir>/run.json` → `parseRun`, and `<dir>/events.json` → `parseEventLog`. If the directory only
    has `events.partial.json`, fail with exit 1: "run did not finish; nothing to publish".
  - `--room`: `parseRoomSpec(JSON.parse(readFileSync))`.
  - `--id`: defaults to a slug of `run.runId` (lowercase, `[^a-z0-9-]` → `-`, trimmed to 64). Fail with exit 2 if
    the result doesn't match `ARTIFACT_ID`.
  - `--canonical`: fixtures via `loadCanonicalRun/Log/Room`, id `canonical`, `publishedAt =
    '2026-09-22T10:00:00.000Z'` (the fixtures' `START`), so the output is deterministic. Otherwise `publishedAt =
    new Date().toISOString()`.
  - `renderer = CURRENT_RENDERER`.
  - If the target file exists and there's no `--force`: exit 1 with "already published; a published run is frozen —
    pass --force only if no one has the URL yet".
  - Write pretty JSON with a trailing newline, and print `published <id>  renderer <version>  <n> events
    <totalMs> ms  → <path>`. Print counts only, never intents or room content.
  - Catch `ArtifactError`, `ReplayError` and `SchemaError`, and exit 1 with `error.message` (the `leak` detail is
    kinds only).
  - Then run `node --import tsx scripts/publish.mts --canonical` and commit `published/canonical.json`.
- **PATTERN**: `scripts/run.mts` (`parseArgs`, `fail`, `USAGE`, `write`) and `scripts/generate-fixtures.mts`
  (fixed timestamp, parse before writing).
- **IMPORTS**: relative `../lib/...`, `../fixtures`, like `run.mts`.
- **GOTCHA**: never name the output `*.run.json`, because `.gitignore` would silently drop it. Check that `git
  check-ignore published/canonical.json` prints nothing.
- **VALIDATE**: `node --import tsx scripts/publish.mts --canonical --force && git check-ignore -q published/canonical.json; test $? -eq 1 && node --import tsx scripts/publish.mts --canonical; test $? -eq 1`
  (the first run writes the file, the ignore check must fail, and the rerun without `--force` must refuse)
- **SATISFIES**: AC #1

### 13. CREATE `app/run/[id]/page.tsx`

- **IMPLEMENT**:
  ```tsx
  import type { Metadata } from 'next';
  import { notFound } from 'next/navigation';
  import { ReplayPlayer } from '@/components/scene/ReplayPlayer';
  import { ArtifactError, listArtifactIds, loadArtifact, replayFromArtifact } from '@/lib/artifact';

  export const dynamicParams = false;
  export function generateStaticParams() { return listArtifactIds().map((id) => ({ id })); }

  type Props = { params: Promise<{ id: string }> };

  function load(id: string) {
    try { return loadArtifact(id); }
    catch (e) { if (e instanceof ArtifactError && e.reason === 'not_found') notFound(); throw e; }
  }
  export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    return { title: `${load(id).manifest.layout.themeName} · LLM Escape Room` };
  }
  export default async function RunPage({ params }: Props) {
    const { id } = await params;
    const { data, renderer } = replayFromArtifact(load(id));
    return <ReplayPlayer data={data} renderer={renderer} />;
  }
  ```
  Header: a server component. It reads a published artifact at **build time**. Only `ReplayData` and the frozen
  `RendererSnapshot` cross into the client. There's no room, because there's none in the artifact. It is
  architecture's "Replay ↔ artifact" boundary, and it's one-way.
- **PATTERN**: `app/replay/page.tsx`.
- **GOTCHA**:
  - Next 16 `params` is a `Promise`, so await it (`generate-static-params.md`).
  - Don't use the global `PageProps<'/run/[id]'>`. It exists only after `next typegen`/`dev`/`build`, and `pnpm
    typecheck` on a clean checkout would fail. `next-env.d.ts` is gitignored.
  - `plan_drift` / `unsupported_renderer` must **fail the build loudly** (let it throw). Never fall back to
    `CURRENT_RENDERER`, because that silent fallback is exactly the "changes under a viewer's feet" bug.
  - A2 fallback: if `next build` complains about `node:fs` in `generateStaticParams`, add `export const dynamic =
    'force-static'` (as in `app/replay/page.tsx:19`). If it still fails, use `import('@/published/…')`. That last
    option is unlikely to be needed, and you should record it as an AMENDMENT.
- **VALIDATE**: `pnpm typecheck && pnpm build` (the build output should list `/run/[id]` with `canonical`
  prerendered, marked ● SSG)
- **SATISFIES**: AC #2

### 14. UPDATE `app/page.tsx`

- **IMPLEMENT**: the primary link becomes `/run/canonical` ("Watch the canonical published run"), with a secondary
  link to `/replay` ("live renderer preview"). Update the comment, which currently says TICKET-9 will add this.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #2

### 15. CREATE `lib/artifact/freeze.test.ts` — THE RENDERER-BUMP TEST

- **IMPLEMENT**:
  ```ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  const BUMPED = { ...CURRENT_RENDERER, rendererVersion: 'replay-v0.2',
    timing: { ...CURRENT_RENDERER.timing, beatMs: 4000, laneOffsetMs: 0 },
    camera: { ...CURRENT_RENDERER.camera, fov: 55, position: [0, 7, 8] },
    assets: { ...CURRENT_RENDERER.assets, laneColours: ['#ff0000', '#00ff00'] } };
  ```
  Tests:
  1. **Sanity: the bump is real.** `buildArtifact(canonical inputs with BUMPED).manifest` differs from
     `loadArtifact('canonical').manifest` in `rendererVersion`, `beatPlan.totalMs`, `camera.fov` and `laneColours`.
     Otherwise the next test proves nothing.
  2. **The published run replays identically after a renderer bump.**
     - `const before = replayFromArtifact(loadArtifact('canonical'))` (plain import).
     - Then `vi.resetModules()`, and `vi.doMock('@/lib/replay/renderer', async (orig) => ({ ...(await orig()),
       CURRENT_RENDERER: BUMPED }))`.
     - Also `vi.doMock('@/lib/replay/beats', async (orig) => ({ ...(await orig()), BEAT_MS: 4000, DEFAULT_TIMING:
       BUMPED.timing, RENDERER_VERSION: 'replay-v0.2' }))`.
     - `const { replayFromArtifact: after, loadArtifact: load2 } = await import('@/lib/artifact')`.
     - `expect(after(load2('canonical'))).toEqual(before)`.
     - Also `expect(after(load2('canonical')).plan.totalMs).toBe(79_500)`. The literal pins the published pacing
       independently of any constant.
  3. **Positive control.** Under the same mocks, a *fresh* `buildArtifact` produces `plan.totalMs !== 79_500`.
     This proves the mock actually reached the renderer, so test 2 isn't passing vacuously.
  4. **A major bump is refused, not mis-rendered.** Under `vi.doMock` with `SUPPORTED_RENDERER_MAJORS: [1]`,
     `after(load2('canonical'))` throws `ArtifactError` `unsupported_renderer`.
  `afterEach(() => { vi.doUnmock(...); vi.resetModules(); })`.
  The header explains why a mock and not a real edit: the test must hold on every future commit, including the one
  that really retunes the renderer, and it has to prove the loader can't reach the live constants at all. It is
  stronger than comparing two builds.
- **GOTCHA**:
  - A-2: `vi.doMock` only affects modules imported **after** it, which is why the loader is dynamically
    imported. The `@/` alias must resolve the same specifier the loader uses. `lib/artifact/replay.ts` imports from
    `@/lib/replay`, the barrel, which re-exports from `./renderer` and `./beats`, so mock those module ids. If the
    mock doesn't take because of relative-vs-alias resolution, mock `@/lib/replay` (the barrel) instead, spreading
    the original.
  - If A-2 fails outright, the fallback is to refactor `replayFromArtifact` to take `supportedMajors` as a
    parameter defaulting to the live value, and replace test 2 with a static proof: the source of
    `lib/artifact/replay.ts` doesn't contain `CURRENT_RENDERER`, `DEFAULT_TIMING` or the `BEAT_MS` family, plus a
    `planBeats` call with the default argument omitted is a type error there. Record it as an AMENDMENT.
- **VALIDATE**: `pnpm vitest run lib/artifact/freeze.test.ts`
- **SATISFIES**: AC #4

### 16. CREATE `lib/artifact/canonical.test.ts`

- **IMPLEMENT**: for every id in `listArtifactIds()`:
  - `loadArtifact(id)` parses and `replayFromArtifact` succeeds (no drift, supported renderer).
  - `findLeaks(readFileSync(path, 'utf8'))` is `[]`.
  - The raw file text contains none of the canonical room's answers or lock codes **outside the log**. Scan
    `JSON.stringify({ manifest, run })`.
  For `canonical` specifically:
  - `artifact.log` deep-equals `loadCanonicalLog()`, `artifact.run` deep-equals `loadCanonicalRun()`, and
    `manifest.layout` deep-equals `buildSceneLayout(loadCanonicalRoom())`.
  - The fixtures are the contract. If TICKET-7 migrates them, this test forces `published/canonical.json` to be
    migrated with them (the message says so).
  - **Don't** compare `manifest` renderer fields to `CURRENT_RENDERER`. The artifact is *supposed* to drift from
    the live renderer. The message must say why, so no one "fixes" it later.
  - Also `expect(listArtifactIds()).toContain('canonical')`, which guards the guard.
- **VALIDATE**: `pnpm vitest run lib/artifact/canonical.test.ts`
- **SATISFIES**: AC #1, AC #3

### 17. CREATE `lib/artifact/boundary.test.ts` + UPDATE `lib/providers/secrets.test.ts`

- **IMPLEMENT**:
  - `lib/artifact/boundary.test.ts` sweeps `lib/artifact/**/*.ts` (not tests) from disk and checks:
    - No provider import (`PROVIDER_IMPORT` regex, copied).
    - No `process.env`, and no `fetch(`.
    - No `@/lib/sim`, `@/lib/harness` or `@/lib/generator` import. Publishing reads recorded data and never
      re-runs.
    - `replay.ts` doesn't mention `CURRENT_RENDERER` or `DEFAULT_TIMING`.
    - Nothing under `components/` imports `@/lib/artifact`. The artifact loader is server-side, and the client gets
      props.
    - It includes a guards-the-guard file count and a positive control, mirroring `lib/replay/boundary.test.ts`.
  - `lib/providers/secrets.test.ts`:
    - Add `'lib/artifact'` to `ARTIFACT_SIDE`.
    - Extend the fixture JSON scan into a loop over `['fixtures', 'published']`, requiring `json.length > 0` for
      each.
    - Update the header comment: the published artifact now exists, and this sweep covers it.
- **GOTCHA**: `secrets.test.ts`'s `SWEPT_DIRS` already includes `lib`, so `lib/artifact` is read. Only
  `ARTIFACT_SIDE` needs the entry. Its "reads process.env only in env.ts" test would catch a `process.env` in
  `store.ts`. That's the reason for `process.cwd()`.
- **VALIDATE**: `pnpm vitest run lib/artifact/boundary.test.ts lib/providers/secrets.test.ts`
- **SATISFIES**: AC #3

### 18. CREATE `e2e/run.spec.ts`

- **IMPLEMENT**: read `published/canonical.json` via `node:fs` and `parseArtifact` (e2e runs in Node, like
  `e2e/replay.spec.ts` imports fixtures). Take `plan = artifact.manifest.beatPlan`.
  1. **Plays the frozen artifact.** `/run/canonical` shows a WebGL canvas and both panels. Under
     `page.clock.install()`, advancing `plan.introMs + 100` shows model-a's seq-0 intent verbatim (from
     `artifact.log`). Advancing to `plan.totalMs + 500` gives `data-state="ended"`, "Escaped in 13 actions" and
     "Out of actions". There are no page errors.
  2. **Makes no cross-origin request.** Collect `page.on('request')` URLs through a full playback (clock-advanced).
     Every one must satisfy `new URL(u).origin === new URL(baseURL).origin`. Also assert none match the provider
     endpoints. Also collect `page.on('websocket')`, which in `next dev` is the HMR socket on the same origin.
     Allow same-origin only.
  3. **An unknown id is a 404.** `const res = await page.goto('/run/does-not-exist'); expect(res?.status()).toBe(404)`.
  4. **Lane colours come from the manifest.** The computed `--lane-a` on `[data-testid=replay]` equals
     `artifact.manifest.assets.laneColours[0]`.
- **PATTERN**: `e2e/replay.spec.ts` (`advance` helper; copy it, don't import across spec files).
- **GOTCHA**:
  - `next dev` compiles on demand, so the first `/run/canonical` hit can be slow. The config's 60 s timeout
    covers it.
  - In dev, `dynamicParams = false` still returns 404 for unknown ids. If it doesn't in dev mode, assert `status()
    >= 400`, and note in NOTES that `pnpm build && pnpm start` gives the true 404.
  - Next dev may request `/__nextjs_*` and `/_next/*`. Those are same-origin and allowed.
- **VALIDATE**: `pnpm e2e e2e/run.spec.ts`
- **SATISFIES**: AC #2, AC #3, AC #4

### 19. UPDATE docs: `README.md`, `lib/schema/migrations/README.md`, `docs/decisions/replay-legibility.md`

- **IMPLEMENT**:
  - `README.md`: a short "Publishing a run" section covering the `scripts/publish.mts` usage, `published/`,
    `/run/<id>`, "frozen: re-publishing needs `--force`", and `/replay` as the live preview.
  - `lib/schema/migrations/README.md` → "Scope when the time comes": add `published/*.json` alongside
    `fixtures/`. A v1 bump must migrate the committed artifacts, and the loader has to read them, otherwise every
    shared URL breaks at build.
  - `docs/decisions/replay-legibility.md` → *Decision*: add one line saying retunes now bump `RENDERER_VERSION`'s
    **minor**, and that published runs keep their frozen values (see `lib/replay/renderer.ts`).
- **VALIDATE**: `grep -n "published" README.md lib/schema/migrations/README.md`
- **SATISFIES**: AC #8 (docs)

---

## TESTING STRATEGY

### Unit Tests (Vitest, `lib/**`)

- `lib/replay/renderer.test.ts`: snapshot shape, version parsing, and plan-driven `laneAt`.
- `lib/replay/beats.test.ts` / `fixture.test.ts`: unchanged, and must stay green (the regression proof for Phase 1).
- `lib/artifact/schema.test.ts`: strictness at every level, version literal, id regex, and type-level alignment with
  `lib/replay/types.ts`.
- `lib/artifact/scan.test.ts`: each leak kind, and truncation.
- `lib/artifact/publish.test.ts`: canonical build, room secrets absent from the manifest, and the four failure
  reasons.
- `lib/artifact/replay.test.ts`: round trip, `unsupported_renderer`, `plan_drift`, and JSON-serialisability.
- `lib/artifact/store.test.ts` (or inside `replay.test.ts`): temp-dir listing, id validation before fs, id
  mismatch, and not found.

### Integration Tests

- `lib/artifact/freeze.test.ts`: **the renderer-bump test** (AC #4), with a positive control.
- `lib/artifact/canonical.test.ts`: committed artifacts vs fixtures, and leak-free.
- `lib/artifact/boundary.test.ts` + extended `lib/providers/secrets.test.ts`: structural no-provider/no-secret proofs
  (AC #3).
- `e2e/run.spec.ts`: real browser, frozen timing, same-origin only, and 404.
- `e2e/replay.spec.ts`: unchanged, and proves `/replay` didn't regress.

### Edge Cases

- A log whose models typed a URL or something key-shaped into an intent or `rejected.raw`. Publishing **refuses**
  (`leak`), and the author decides. Tested with a planted `gsk_…` intent.
- `runs/<id>/` with only `events.partial.json`: the script refuses with a clear message.
- A room file for a different room: `room_mismatch`.
- Re-publishing an existing id: refused without `--force`.
- Ids containing `../`, uppercase or `/`: refused before any filesystem access.
- An artifact edited by hand so `beatPlan` no longer matches `timing`: `plan_drift`, and the build fails.
- A future renderer major: `unsupported_renderer`, and the build fails loudly rather than rendering wrong.
- An empty `published/` (a fresh clone with the file deleted): `generateStaticParams` returns `[]`, the route
  builds with no pages, and `canonical.test.ts`'s `toContain('canonical')` fails the test suite.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm typecheck
```

(The project has no linter configured. `tsc --noEmit` is the static gate.)

### Level 2: Unit Tests

```bash
pnpm vitest run lib/replay lib/artifact
```

### Level 3: Integration Tests

```bash
pnpm test                 # full vitest suite, incl. lib/providers/secrets.test.ts
pnpm build                # /run/[id] prerenders `canonical` (● SSG); fails on drift/unsupported renderer
pnpm e2e                  # e2e/replay.spec.ts + e2e/run.spec.ts
```

### Level 4: Manual Validation

```bash
node --import tsx scripts/publish.mts --canonical            # must refuse: already published
git check-ignore published/canonical.json; echo "ignored? exit=$?"   # expect exit 1 (not ignored)
pnpm dev   # open http://localhost:3000/run/canonical and /replay — identical today
```

Then the manual freeze check. In `lib/replay/beats.ts`, temporarily set `BEAT_MS = 4000` and `RENDERER_VERSION =
'replay-v0.2'`. Reload both pages. `/replay` should visibly speed up, and `/run/canonical` should still take 79.5 s.
Revert the edit.

If a real run exists under `runs/` (e.g. `runs/smoke-canonical-t7b/` against the canonical room):

```bash
node --import tsx scripts/publish.mts --run runs/smoke-canonical-t7b --room fixtures/rooms/valid/canonical-room.json --id smoke-t7b --out <scratch dir>
```

Publish to a scratch `--out` so nothing uncurated is committed.

### Level 5: Additional Validation (Optional)

```bash
grep -rnE "BEAT_MS|ROOM_HALF|KIND_COLOUR|LANE_COLOURS|SCENE\.|from './palette'" components   # expect no output
grep -rn "@/lib/artifact" components                                                            # expect no output
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1:** `scripts/publish.mts` emits a published artifact as versioned JSON (`artifactVersion: 0`) holding
  the event log, the run record (summaries + `typicalOfRepeats`) and a frozen render manifest (renderer version,
  timing + computed beat plan, camera plan, assets, geometry, public layout). `published/canonical.json` is
  committed.
- [ ] **AC #2:** `/run/[id]` is a static route. `/run/canonical` prerenders at build and plays the artifact, and an
  unknown id is a 404.
- [ ] **AC #3:** It's asserted that the replay bundle makes no provider call and carries no secret:
  - the artifact schema is strict,
  - `findLeaks` runs at publish time and on every committed artifact,
  - `lib/artifact` is in the secrets sweep's `ARTIFACT_SIDE`,
  - `components/` can't import `lib/artifact`,
  - the e2e test makes only same-origin requests,
  - the manifest carries no room answer or code.
- [ ] **AC #4:** A published run replays identically after the renderer changes. `freeze.test.ts` mocks a
  renderer-version bump (new timing, camera and colours) and `replayFromArtifact` returns a deep-equal result,
  with a positive control. The player reads timing, camera, colours and geometry from the snapshot, not from
  constants.
- [ ] **AC #5:** `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm e2e` all pass.
- [ ] **AC #6:** `/replay` behaves exactly as before, and `e2e/replay.spec.ts` passes unchanged.
- [ ] **AC #7:** No regressions in the existing suites (`lib/replay/*`, `lib/providers/secrets.test.ts`).
- [ ] **AC #8:** README, the migrations README and the legibility decision note are updated.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration + e2e)
- [ ] No type-checking errors
- [ ] Manual freeze check done (the temporary `BEAT_MS` edit was reverted)
- [ ] Acceptance criteria all met
- [ ] `published/canonical.json` generated by the script, not hand-edited, and not gitignored

---

## OPEN QUESTIONS / ASSUMPTIONS

**Decided at the gate (2026-09-24, "defaults"):**

- **D1: storage + loading.** Committed `published/<id>.json`, read by a server component at build time with
  `generateStaticParams` and `dynamicParams = false`. No `public/` + client fetch.
- **D2: what the manifest freezes.** Data: renderer version, timing (constants + computed plan), camera plan,
  assets (palette), stage geometry, and the public layout. Geometry **code** isn't frozen. The loader refuses an
  unsupported renderer **major**.
- **D3: emission.** Pure `buildArtifact` plus the `scripts/publish.mts --run <dir> --room <path>` CLI. The
  "summary" is the full `Run` record. Repeats aren't bundled.
- **D4: canonical + `/replay`.** `published/canonical.json` is generated from the fixtures, and a test pins its
  log, run and layout to the fixtures. `/replay` stays as the live renderer preview.
- **D5: no-provider/no-secret proof.** The source sweeps, strict schema, publish-time and committed-file leak scan,
  and the e2e same-origin assertion. No `.next/static` bundle scan.
- **D6: renderer-bump test.** Vitest, with an injected (mocked) bumped snapshot rather than edits to the real
  constants, plus e2e frozen timing.

**Assumptions:**

- **A-1:** Next 16.3.2 prerenders `app/run/[id]` from `generateStaticParams` that uses `node:fs` at build, and
  `dynamicParams = false` gives a 404 in both `next dev` and `next start`. *Fallback:* see Task 13's GOTCHA
  (`dynamic = 'force-static'`) and Task 18's GOTCHA (`>= 400` in dev).
- **A-2:** `vi.resetModules` + `vi.doMock` + dynamic `import()` reaches `CURRENT_RENDERER` through the
  `@/lib/replay` barrel. *Fallback:* the static-proof variant in Task 15's GOTCHA.
- **A-3:** Schemas stay at v0 for the duration. If TICKET-7 lands v1 first, rebase: run the migration over
  `published/canonical.json` (`canonical.test.ts` will fail and say so). `ARTIFACT_VERSION` doesn't need to move
  just because the log's version did, because the envelope's shape didn't change.
- **A-4:** A URL anywhere in the artifact is refused, **including inside model-written intents**. This is
  conservative. If real runs show models writing URLs in intents, relax `url` to a warning in a follow-up, but
  keep `endpoint` and `key` fatal.

**Flag for TICKET-7 (#8):** the v0 → v1 migration now has three targets: `fixtures/`, `published/*.json`, and the
schemas. Task 19 records this in `lib/schema/migrations/README.md`.

## NOTES (open canvas)

**Every constant read the refactor removes** (from `grep`, 2026-09-24):

| Where | Reads | Becomes |
|---|---|---|
| `RoomScene.tsx:8,40` | `BEAT_MS` (sway period) | `camera.swayPeriodMs` |
| `RoomScene.tsx:32-33,43` | `WALL_HEIGHT`, `SWAY`, position, fov, lookAt | `geometry.wallHeight`, `camera.*` |
| `RoomScene.tsx:82-98` | `SCENE.background/floor/wall`, `ROOM_HALF` | `assets.scene.*`, `geometry.roomHalf` |
| `SceneObject.tsx:7,23-26,76,80,112` | `SCENE.*`, `KIND_COLOUR` | `assets.*` |
| `Character.tsx:16,35-38,188` | `KIND_COLOUR`, `STAND_OFF`, `EXIT_*_MS` | `assets.kindColours`, `geometry.standOff`, `plan.exit*Ms` |
| `ReplayStage.tsx:7,51` | `LANE_COLOURS` | `assets.laneColours` |
| `ReplayPlayer.tsx:26` | `planBeats(data)` | `planBeats(data, renderer.timing)` |
| `beats.ts:86-87` (`laneAt`) | `WALK_FRACTION`, `ACT_FRACTION` | `plan.walkFraction/actFraction` |
| `replay.module.css:19-20` | lane hex | inline `--lane-a/--lane-b` |

**What is and isn't frozen.** Frozen: every number or colour a retune would touch. Spike 3 names exactly these
knobs, which are timing and typography. Not frozen: mesh shapes, gesture curves, `OPEN_ANGLE`,
`HIGHLIGHT_INTENSITY`, and CSS typography sizes. Those are code. The rule is that changing a frozen value is a
**minor** bump, and it's always safe because old artifacts carry their own values. Changing code in a way that
alters how an existing artifact looks is a **major** bump: old artifacts are refused until the author either
keeps a compatibility path or re-publishes them with `--force`. **Intent typography** (CSS `clamp` sizes) is the
one spike-3 knob left in code. Moving it into `assets` is cheap, via inline custom properties like the lane
colours, if the spike retunes it. Don't do it speculatively.

**Why `ReplayData` isn't stored in the artifact.** It's derivable from `log + run + layout` by a pure function
(`buildReplay`), and storing it would create a second copy of the intents that could disagree with the log. That's
the same reason `event.ts` refuses to duplicate `intent`. The log stays the source of truth, and the *derivation*
is protected by the `plan_drift` check and `canonical.test.ts`. If `buildReplay`'s output shape changes, that's a
renderer major bump.

**Why the loader re-derives and compares the plan instead of just trusting `beatPlan`.** It catches a hand-edited
or corrupted artifact at build time, and it catches a `planBeats` arithmetic change, which is a silent re-pacing
of every published run. The comparison fails the build, which is the right place to find out.

**Video export compatibility.** A future exporter reads the same `published/<id>.json`, calls `replayFromArtifact`,
and gets the same `data`, `renderer` and `plan`. Frozen camera and timing are exactly what a deterministic video
render needs. Nothing here designs it out.

**Rejected alternatives.**
- **`public/` + client fetch:** breaks the replay's no-`fetch` sweep, and moves the loading and validation into the
  browser.
- **Storing the room spec and re-projecting on load:** puts every answer into a public file.
- **Versioned renderer code paths (`renderers/v0/…`):** premature with one renderer version in existence.
- **A `.next/static` bundle scan:** declined at the gate. The source sweeps plus the runtime same-origin check cover
  the same risk without a build inside `pnpm test`.

**Confidence: 8/10.** The main risks are A-2 (module mocking through the barrel), which has a fallback, and the
component refactor touching five files where R3F `useFrame` closures must see the new props. Pass `renderer` down
explicitly rather than through context, so the closures capture it the same way they capture `plan` today.

## AMENDMENTS

<!-- append-only; newest at the bottom -->

- 2026-09-24 — Implementation deviations:
  - `CANONICAL_PUBLISHED_AT` lives in `lib/artifact/publish.ts`, not in the test helper, so the script never imports test
    support.
  - `lib/artifact/testing.ts` was added as a shared test helper.
  - `schema.test.ts` builds its valid artifact with `buildArtifact` instead of by hand.
  - The positive control in `freeze.test.ts` checks the fresh artifact's plan. `planBeats`' default parameter binds the
    module-internal `DEFAULT_TIMING`, which a mocked export can't reach.
  - The e2e fake clock is now paused (`install` + `pauseAt`) in both specs, and one TICKET-8 expectation was corrected
    from seq 2 to seq 1. The old one passed only because real page-load time leaked into the clock.
  - `playwright.config.ts` sets `workers: 1`, because two SwiftShader replays running in parallel starve each other.
