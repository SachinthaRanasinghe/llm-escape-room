# Feature: Replay player v0 on a synthetic log (TICKET-8, #5)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Gate status: closed.** All six clarifying questions were answered "defaults" on 2026-09-24. Decisions D1–D6 in
> OPEN QUESTIONS / ASSUMPTIONS are settled. Only A-1 (Playwright's fake clock drives R3F's frame loop) and A-2 (headless
> Chromium gets a WebGL context) remain assumptions, and each has a stated fallback.

## Feature Description

The replay player is the visual half of the product. It reads a semantic event log and plays it back as a
side-by-side 3D scene. There are two copies of the same room, one character in each, and every recorded action
becomes one **beat** of fixed length. During a beat the character walks to the object it targeted and acts on it,
and the verdict lands. Beside each room a DOM panel shows the model's **declared intent, word for word**, the verdict
message, and the model's **real think-time as a stat**. Think-time never changes how long a beat lasts.

v0 is driven entirely by TICKET-1's golden fixtures (`loadCanonicalLog`, `loadCanonicalRun`,
`loadCanonicalRoom`). It has no backend and no provider. It lives at a static `/replay` route.

It also runs architecture spike 3: *is a one-line intent legible at beat pace?* That spike closes with a short
decision note that records the tuned beat and typography.

## User Story

As someone scrolling a feed who has 60–90 seconds to spare
I want to watch two models work through the same room side by side, seeing what each one meant to do as it does it
So that I can point at the moment one model lost the thread, without reading a transcript

## Problem Statement

Every backend piece exists: schemas, simulator, solver, adapters, generator, harness, spike tooling. But nothing
turns a log into something watchable, and the PRD's thesis is that the watchable part *is* the product. Three
specific gaps:

1. **No pacing model.** The log deliberately carries no beat, camera or position (`lib/schema/event.ts:14-24`).
   Pacing has to be derived at replay time, it has to be uniform, and a typical run has to land at 60–90 s.
2. **The log alone can't place things in a scene.** It names `targetId`s but not their kinds. `submit_answer`
   names a `puzzleId`, not an object. Models also name objects that don't exist (`bookshelf`, canonical log,
   model-b seq 8). So the scene needs the room. But `RoomSpec` carries every answer, and TICKET-9's published
   artifact won't include it.
3. **Spike 3 is unanswered.** Nobody knows whether a 20–70 character intent (canonical range; the schema allows 280)
   reads at the chosen beat with two lanes on screen at once.

## Solution Statement

Three layers, split by what they're allowed to touch:

- **`lib/replay/`: pure, node-tested, and has no React.**
  - `layout.ts` → `buildSceneLayout(room)`. Builds a **public projection** of the room by *listing fields, never
    spreading* (mirrors `lib/sim/observation.ts:9-17`): id, name, kind, parent, deterministic floor position, a
    puzzle → object map, and the exit. No lock codes, answers or clue text.
  - `timeline.ts` → `buildReplay({ log, run, layout })`. Validates the log (seq contiguity, run and competitor
    ids), splits it into one lane per competitor ordered by `seq`, and turns each `Event` into a `ReplayBeat`: verb,
    resolved target, intent verbatim or explicitly absent, verdict, think-time and cumulative think-time. The
    result is serialisable JSON.
  - `beats.ts` → the beat scheduler. `BEAT_MS = 5000`, a fixed intro and outro, and a half-beat `LANE_OFFSET_MS` for
    the second lane (see NOTES). `planBeats` gives the absolute times; `laneAt(plan, lane, tMs)` gives each lane's
    beat index, phase and progress at any instant.
  - `roomState.ts` → `laneStateAt(lane, beatIndex)`. What each lane's room looks like at that beat: opened,
    unlocked, held, escaped. It is derived from `ok` verdicts only.
- **`components/scene/`: client-only React Three Fiber.** `ReplayPlayer` owns one playback clock, a ref read inside
  `useFrame`, so React doesn't re-render 60 times a second. `ReplayStage` is one `<Canvas>` with two drei `<View>`s
  (one WebGL context), each showing a `RoomScene` (primitive objects plus a primitive `Character`). `LanePanel` is
  the DOM overlay with the intent, verdict and think-time. `Controls` has play, pause and restart. The chrome
  animates opacity, not transforms.
- **`app/replay/page.tsx`: a server component.** It loads the fixtures, calls `buildSceneLayout` and `buildReplay`
  on the server, and passes only `ReplayData` to the client. The `RoomSpec` never enters the client bundle, and a
  boundary test holds that.

Tests: Vitest for everything in `lib/replay`, including that intents are kept verbatim, the 60–90 s band, and the
secrecy of the projection. Playwright is installed here as the repo's first `*.spec.ts` runner (as
`vitest.config.mts:5-10` expects) for a single browser smoke test.

## Out of Scope / Non-Goals

- **Not included: the render manifest, the published artifact, and `/run/[id]`.** Those are T9 (#9). T9 freezes
  `SceneLayout` and the beat constants into the manifest. This ticket only makes them freezable: pure data with
  named constants.
- **Not included: the comparison view or variance wording.** That's T10 (#10). The lane panel shows a lane's own
  running stats (action n / budget, think-time total) and nothing comparative.
- **Not included: telemetry.** That's T11 (#11).
- **Not included: scrubbing, playback speed, keyboard shortcuts, sharing, or video export.**
- **Not included: GLTF, texture or sound assets, or a font download.** Everything is primitive geometry and the
  system font stack. That keeps the build offline-safe and leaves nothing to freeze in T9 except numbers.
- **Not changing:** anything in `lib/schema`, `lib/sim`, `lib/solver`, `lib/providers`, `lib/generator`,
  `lib/harness`, `lib/spike`, `fixtures/` or `scripts/`. The only file outside this ticket's directories that
  changes is `lib/providers/secrets.test.ts` (adding the new directories to its sweep), plus `app/page.tsx`
  (a link), `app/layout.tsx` (a comment and global background), `package.json`, `README.md`.
- **Not doing: the v1 migration.** T7 Part B owns it. The player reads `Event` through its type and
  `action?.intent ?? rejected?.intent`, so the only v1 impact is `rejected` going from optional to nullable. That's
  a one-line change in `timeline.ts`, called out in NOTES.
- **Not summarising, paraphrasing or truncating intents, ever.** That's the PRD's misrepresentation risk, and
  spike 3's rule.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (first UI, first 3D, first browser test runner; the pure core is Medium)
**Primary Systems Affected**: new `lib/replay/`, new `components/scene/`, new `app/replay/`, new `e2e/`, `package.json`
**Dependencies**: `three@0.186.0`, `@react-three/fiber@9.8.0`, `@react-three/drei@10.7.8`, `@types/three@0.186.0`,
`@playwright/test@1.63.0` (dev). All peer-compatible with `react@19.2.8` (R3F peers `react >=19 <19.4`).

## Related Work

**Implements**: TICKET-8 · [#5](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/5) · **Epic**:
`docs/tickets/llm-escape-room.md`, `architecture.md` (*Recommended approach*, *Key decisions · Stack & libraries*,
*Spikes & experiments · 3*)

**Back-references:**

- `.claude/plans/scaffold-core-schemas-v0.md`. Why: defines the golden fixtures this plays, and says `#5 replay`
  renders `loadCanonicalLog()` with no backend (`fixtures/index.ts:19-24`).
- `.claude/plans/run-harness.md`. Why: A1 added `action: null` + `rejected`, which the player must draw as a fumble
  beat.
- `.claude/plans/substrate-spike-v1.md`. Why: Part B pins v1, and this player has to survive that with a
  one-line change.

**Forward-references:**

- T9 (#9) freezes `SceneLayout`, `BEAT_MS`, `INTRO_MS`, `OUTRO_MS`, `LANE_OFFSET_MS` and `RENDERER_VERSION` into
  the render manifest, and adds `lib/artifact/` to the secrets sweep.
- T10 (#10) mounts the comparison view under the player.
- T11 (#11) hooks telemetry into `ReplayPlayer`'s playback clock (opens, 30 s survival, completion).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `lib/schema/event.ts` (whole file, especially 5-49, 74-102). Why: `Event`, `Rejected`, `findSeqBreaks`, why there's
  no beat in the log, and where intent lives.
- `lib/schema/action.ts` (38-78, 87-114). Why: the seven verbs and their argument fields (`targetId`, `itemId`,
  `code`, `puzzleId`, `answer`), `ActionName`, `VERDICT_CODES`/`VerdictCode`. Intent max is 280 (`:30-33`).
- `lib/schema/room.ts` (38-125). Why: `RoomObject` (`kind`, `contains`, `lock`, `clueText`), `Puzzle.unlocksObjectId`,
  `exit`. The secrecy warning at 30-35.
- `lib/schema/run.ts` (13-56, 58-88). Why: `Competitor` (`id`, `provider`, `modelId`), `RunSummary.endedBecause`,
  `Run.budget.maxActions`.
- `lib/sim/observation.ts` (1-50). Why: **the pattern to mirror for `buildSceneLayout`**, which builds a public view
  by listing fields and never spreading.
- `lib/sim/state.ts`. Why: how "contained in" and "reachable" are computed from `contains`. `layout.ts` needs a parent
  map from the same data (don't import sim; re-derive, since the replay must not depend on the simulator).
- `fixtures/index.ts` (1-45). Why: `loadCanonicalRoom/Log/Run` are the only way in. Never import the JSON directly
  (`:30-31`).
- `fixtures/logs/canonical-run.json`, `fixtures/runs/canonical-run.json`, `fixtures/rooms/valid/canonical-room.json`.
  Why: the data. 27 events: model-a 13 (escapes on `submit_answer p3 → north`), model-b 14 (budget_actions, a
  `not_found` on `bookshelf`, `wrong_code` ×2, `locked` ×1). Think-time 1260–3340 ms.
- `lib/harness/boundary.test.ts` (whole file). Why: **the boundary sweep pattern to mirror**: walk the source from
  disk, a FORBIDDEN table, a guard-the-guard count, and positive controls.
- `lib/providers/secrets.test.ts` (1-60). Why: `SWEPT_DIRS` and `ARTIFACT_SIDE` must gain `components` and
  `lib/replay` / `components`. The comment at `:28-29` asks for exactly this when the artifact side grows.
- `app/layout.tsx`, `app/page.tsx`, `next.config.ts`. Why: bare by design, and their comments hand styling decisions to
  this ticket. `next.config.ts` stays empty.
- `vitest.config.mts`. Why: Vitest owns `*.test.ts(x)` under `{lib,fixtures,scripts}`, Playwright owns `*.spec.ts`.
  Don't widen the Vitest include. `lib/replay` is already covered.
- `tsconfig.json`. Why: `@/*` alias, `jsx: react-jsx`, `strict`, and it includes `**/*.ts(x)` and `.mts` (so
  `playwright.config.ts` and `e2e/*.spec.ts` get typechecked too). TypeScript is `~7.0.2`.
- `pnpm-workspace.yaml`. Why: `allowBuilds`. Add an entry only if `pnpm install` reports a *needed* build script
  from the new deps.

### New Files to Create

- `lib/replay/types.ts`: `SceneLayout`, `SceneObject`, `ReplayBeat`, `ReplayLane`, `ReplayData`, `BeatPlan`,
  `LaneMoment`, `LaneRoomState`.
- `lib/replay/layout.ts` + `layout.test.ts`: `buildSceneLayout(room)`.
- `lib/replay/timeline.ts` + `timeline.test.ts`: `buildReplay`, `ReplayError`.
- `lib/replay/beats.ts` + `beats.test.ts`: constants, `planBeats`, `laneAt`.
- `lib/replay/roomState.ts` + `roomState.test.ts`: `laneStateAt`.
- `lib/replay/labels.ts` + `labels.test.ts`: verb, verdict and rejection display strings (exhaustive
  `Record<…>`s).
- `lib/replay/index.ts`: barrel.
- `lib/replay/testing.ts`: `event()` and `layoutFixture()` builders for the tests.
- `lib/replay/boundary.test.ts`: sweeps `lib/replay` and `components/scene`.
- `lib/replay/fixture.test.ts`: golden integration (canonical fixtures → `ReplayData` → plan).
- `components/scene/ReplayPlayer.tsx`: `'use client'`, owns the clock, lays out the page.
- `components/scene/usePlayback.ts`: rAF-driven clock hook.
- `components/scene/ReplayStage.tsx`: `<Canvas>` plus two `<View>`s.
- `components/scene/RoomScene.tsx`: room shell, lights, camera, objects, character.
- `components/scene/SceneObject.tsx`: a primitive per `ObjectKind`, with state-driven look.
- `components/scene/Character.tsx`: walk, act and react animation from `LaneMoment`.
- `components/scene/LanePanel.tsx`: the DOM overlay for intent, verdict and think-time.
- `components/scene/Controls.tsx`: play/pause and restart.
- `components/scene/replay.module.css`: all chrome styling and the typography tokens.
- `app/replay/page.tsx`: server component with a static route.
- `playwright.config.ts`, `e2e/replay.spec.ts`.
- `docs/decisions/replay-legibility.md`: spike-3 note.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [R3F: Installation](https://r3f.docs.pmnd.rs/getting-started/installation) and [Canvas](https://r3f.docs.pmnd.rs/api/canvas).
  Why: v9 is the React 19 line. `<Canvas>` props `frameloop`, `dpr`, `eventSource`.
- [R3F: Hooks · useFrame](https://r3f.docs.pmnd.rs/api/hooks#useframe). Why: every animation reads the clock ref here,
  so there's no `setState` per frame.
- [R3F: Performance pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls). Why: *"Never setState in useFrame"*, mutate
  refs, and reuse vectors instead of allocating per frame.
- [drei: View](https://drei.docs.pmnd.rs/portals/view). Why: two scenes in one Canvas. You need
  `<Canvas eventSource={containerRef}>` + `<View.Port />`, and `<View>`s placed in the DOM where each lane sits.
  They're tunnelled into the canvas. Each View has its own camera (`<PerspectiveCamera makeDefault>` inside it).
- [drei: PerspectiveCamera](https://drei.docs.pmnd.rs/cameras/perspective-camera). Why: per-View default camera.
- [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components).
  Why: fixtures are loaded in the server component and only serialisable props cross into `'use client'`. The
  JSON import stays server-side.
- [Next.js: `next/dynamic` with `ssr: false`](https://nextjs.org/docs/app/guides/lazy-loading#skipping-ssr). Why:
  `ReplayStage` is loaded client-only, so three.js never runs during prerender. `ssr: false` is only allowed
  inside a Client Component, which `ReplayPlayer` is.
- [Playwright: Clock](https://playwright.dev/docs/clock). Why: `page.clock.install()` fakes `requestAnimationFrame`,
  `performance.now` and `Date`, so a 77 s replay can be tested in seconds. Use `runFor`, not `fastForward`, when rAF
  callbacks must fire.
- [Playwright: Web server](https://playwright.dev/docs/test-webserver). Why: `webServer` starts `next dev` for the
  spec.
- [MDN: prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).
  Why: the chrome's opacity fades drop to instant, and the camera sway is disabled.

### Patterns to Follow

**Module headers are essays.** Every file in this repo opens with a doc comment explaining *why* the module exists
and what it must never do (`lib/schema/event.ts:5-49`, `lib/sim/observation.ts:1-17`). New files do the same, at
the same density. Reference tickets as `TICKET-n (#issue)`.

**Build public views by listing fields (from `lib/sim/observation.ts:9-17`):**

```ts
// Every field below is named explicitly. Do NOT rewrite this as a spread of
// `RoomObject` with the secrets deleted ... a spread is one forgotten `delete`
// away from publishing a lock code
export interface VisibleObject {
  readonly id: string;
  readonly name: string;
  ...
}
```

`SceneObject` does exactly this, and `layout.test.ts` asserts the key set exactly.

**Named errors extend a base and carry detail** (`lib/schema/version.ts:50-58`; `EventLogError extends SchemaError`).
`ReplayError extends Error` with `readonly reason: ReplayErrorReason` (a string union) so tests assert *which*
failure. Mirror the "machine-readable reason" habit from the solver's rejections.

**`readonly` everywhere in exported types** (`observation.ts:18-33`).

**Tuples plus derived unions for enumerations** (`ACTION_NAMES`, `VERDICT_CODES`). Label maps are typed
`Record<VerdictCode, …>` / `Record<ActionName, …>` so a v1 verdict added in T7 fails typecheck here rather than
rendering `undefined`.

**Boundary sweep** (`lib/harness/boundary.test.ts`): walk from `import.meta.url`, sort, a `FORBIDDEN` table with
`why`, a guard-the-guard minimum file count plus a named file check, and a positive-control `it` that plants every
pattern.

**Tests**: `describe`/`it` sentences, builders in a `testing.ts` (e.g. `lib/harness/testing.ts`), no
`vi.stubGlobal`, and assertions on exact values.

**Formatting**: 2-space indent, single quotes, semicolons, trailing commas, lines ≤ 120. No linter is configured.
Match by eye.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation (deps, branch, types)

Branch, install, and define the serialisable contract between the server page and the client player.

### Phase 2: Pure core (`lib/replay`)

**Depends on:** Phase 1 (types)

Layout, timeline, beats, room state, labels. All node-tested, and the fixture integration test pins the 60–90 s
band.

### Phase 3: Scene and chrome (`components/scene`, `app/replay`)

**Depends on:** Phase 2 (consumes `ReplayData`, `planBeats`, `laneAt`, `laneStateAt`, labels)

### Phase 4: Boundaries, browser smoke, spike-3 note

**Depends on:** Phase 3. **Independent of:** nothing. The boundary test (Task 12) can be written right after Phase 2
and extended once `components/scene` exists.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 0. Branch

- **IMPLEMENT**: `git switch -c feature/replay-player-v0` from `feature/substrate-spike-v1` (HEAD `94c104b`, the
  stacked pattern every prior ticket used).
- **GOTCHA**: `docs/decisions/substrate.md` has **uncommitted user edits** (spike results in progress). `git switch -c`
  carries them over untouched. **Do not stage, commit, revert or stash that file** in this ticket. Leave it for the
  user, and exclude it explicitly when committing (`git add` paths, never `git add -A`).
- **VALIDATE**: `git branch --show-current` → `feature/replay-player-v0`; `pnpm test` → 741 passed (baseline).
- **SATISFIES**: process.

### 1. UPDATE `package.json` (deps + scripts)

- **IMPLEMENT**: `pnpm add three@0.186.0 @react-three/fiber@9.8.0 @react-three/drei@10.7.8` and
  `pnpm add -D @types/three@0.186.0 @playwright/test@1.63.0`. Pin exact versions (no caret) to match how `next`,
  `react` and `zod` are pinned. Add scripts `"e2e": "playwright test"`. Then `pnpm exec playwright install chromium`.
- **GOTCHA**: if `pnpm install` prints *"Ignored build scripts: …"*, add an entry to `pnpm-workspace.yaml`
  `allowBuilds` **only** for a package whose script is needed at runtime, with a comment saying why (mirror the
  esbuild comment). drei pulls transitive deps. Don't blanket-allow.
- **GOTCHA**: TypeScript is `~7.0.2`. If `@types/three` or drei's types fail under it, check `skipLibCheck: true` is
  still on (it is) before anything else. Don't loosen `strict`.
- **VALIDATE**: `pnpm typecheck && pnpm test` (741, unchanged), `pnpm exec playwright --version` → 1.63.0.
- **SATISFIES**: AC 1 (R3F scene), AC 9 (Playwright).

### 2. CREATE `lib/replay/types.ts`

- **IMPLEMENT**: the serialisable contract. All `readonly`, JSON-safe (no `Map`, `Set`, `Date`, class or function):
  ```ts
  export type Vec2 = readonly [x: number, z: number];

  /** Public projection of one RoomObject. Listed, never spread — see layout.ts. */
  export interface SceneObject {
    readonly id: string;
    readonly name: string;
    readonly kind: ObjectKind;            // type import from '@/lib/schema/room'
    readonly parentId: string | null;     // who `contains` it, if anyone
    readonly position: Vec2;              // floor position; a contained object's is its top-level ancestor's
  }
  export interface SceneLayout {
    readonly roomId: string;
    readonly themeName: string;
    readonly objects: readonly SceneObject[];        // room order
    readonly puzzleTargets: Readonly<Record<string, string>>; // puzzleId → unlocksObjectId
    readonly exitObjectId: string;
    readonly centre: Vec2;                           // where a character goes for look / unknown targets
  }
  export interface ReplayBeat {
    readonly seq: number;
    readonly verb: ActionName | null;                // null = rejected turn
    readonly targetId: string | null;                // resolved object id, or null when there is none / unknown
    readonly heldItemId: string | null;              // `use`'s itemId
    readonly argument: string | null;                // `code` / `answer`, displayed verbatim
    readonly rawTargetId: string | null;             // what the model named, even if unknown (e.g. 'bookshelf')
    readonly intent: string | null;                  // VERBATIM, or null when the model wrote none. Never invented.
    readonly rejection: RejectionKind | null;        // from Event.rejected.kind
    readonly verdict: { readonly ok: boolean; readonly code: VerdictCode; readonly message: string };
    readonly thinkMs: number;                        // Event.latencyMs
    readonly cumulativeThinkMs: number;
  }
  export interface ReplayLane {
    readonly competitorId: string;
    readonly label: string;                          // `${modelId}` from the Run
    readonly provider: Provider;
    readonly beats: readonly ReplayBeat[];           // seq order
    readonly endedBecause: EndReason;
    readonly escaped: boolean;
    readonly maxActions: number;                     // Run.budget.maxActions, for "action 7 / 14"
  }
  export interface ReplayData {
    readonly runId: string;
    readonly layout: SceneLayout;
    readonly lanes: readonly ReplayLane[];           // Run.competitors order
  }
  export type LanePhase = 'intro' | 'walk' | 'act' | 'hold' | 'done';
  export interface LaneMoment {
    readonly beatIndex: number;        // -1 before the first beat; lanes[i].beats.length - 1 once done
    readonly phase: LanePhase;
    readonly progress: number;         // 0..1 within the phase
  }
  export interface BeatPlan {
    readonly beatMs: number;
    readonly introMs: number;
    readonly outroMs: number;
    readonly laneOffsetsMs: readonly number[];   // per lane
    readonly totalMs: number;
  }
  export interface LaneRoomState {
    readonly opened: readonly string[];
    readonly unlocked: readonly string[];
    readonly held: readonly string[];
    readonly escaped: boolean;
  }
  ```
  Export `RejectionKind = (typeof REJECTION_KINDS)[number]` via a type import from `@/lib/schema/event`.
- **IMPORTS**: `import type` only from `@/lib/schema/{room,action,event,run}`.
- **GOTCHA**: **type imports only.** `lib/replay` is shipped to the client, and a value import of `@/lib/schema/room`
  drags Zod and the room schema into the bundle. That's harmless in itself, but Task 12 forbids it so that the
  pattern "room values stay server-side" is mechanical.
- **VALIDATE**: `pnpm typecheck`.
- **SATISFIES**: AC 1, AC 6.

### 3. CREATE `lib/replay/testing.ts`

- **IMPLEMENT**: `event(partial)` → a full valid `Event` (defaults: `logVersion: 0`, runId `run-t`, competitor
  `a`, `action: { name: 'look', intent: 'x' }`, ok verdict, `latencyMs: 1000`, tokens 0/0, a fixed ISO `at`).
  `rejectedEvent(kind, intent)` → `action: null` + `rejected`, verdict `malformed`. `layoutFixture()` → a small
  hand-built `SceneLayout`. `runFixture(ids)` → a minimal valid `Run`. Parse each built value through
  `EventSchema.parse` / `parseRun` so a builder can't drift from the schema.
- **PATTERN**: `lib/harness/testing.ts`, `lib/spike/testing.ts`.
- **GOTCHA**: this is a test helper, so value imports of schemas are fine. It's excluded from the boundary sweep by
  name (Task 12).
- **VALIDATE**: `pnpm typecheck`.
- **SATISFIES**: supports all tests.

### 4. CREATE `lib/replay/layout.ts` + `layout.test.ts`

- **IMPLEMENT**: `buildSceneLayout(room: RoomSpec): SceneLayout`.
  - `parentId`: invert `contains` (the first container listing the id; the solver guarantees no duplicates).
  - `position`: top-level objects (parentId null), in room order, laid out on a deterministic rectangle. Walls at
    `ROOM_HALF = 4`, objects spaced along the back wall and the two side walls (e.g. `wallSlots(n)`, which returns
    evenly spaced `Vec2`s inset 0.8 from the walls). The exit (`room.exit.objectId`) always goes centre-back. A
    contained object takes its **top-level ancestor's** position (walk `parentId` up).
  - `puzzleTargets`: `Object.fromEntries(room.puzzles.map(p => [p.id, p.unlocksObjectId]))`.
  - `centre: [0, 1]` (slightly forward so the character faces the back wall).
  - Build each `SceneObject` with an **object literal listing the five fields**. No spread, no `...rest` destructure.
  - Module header: why it's a projection, why it's listed, and that T9 freezes this into the manifest.
- **PATTERN**: `lib/sim/observation.ts:9-17` (listing), `lib/sim/state.ts` (containment).
- **IMPORTS**: `import type { RoomSpec } from '@/lib/schema/room'`, types from `./types`.
- **GOTCHA**: this file **takes** a `RoomSpec` but is only *called* server-side (`app/replay/page.tsx`). It's still
  type-import-only, so it's harmless if a client file imports it. Task 12 enforces that too.
- **TESTS** (`layout.test.ts`, against `loadCanonicalRoom()`):
  - Every room object appears once, in room order. `Object.keys(o).sort()` equals exactly
    `['id','kind','name','parentId','position']` for every object (the listing guard).
  - **Secrecy:** `JSON.stringify(layout)` contains none of the room's puzzle answers, none of its lock codes
    (`lock.code`), and no `clueText`, and has no `"lock"`, `"clueText"`, `"answer"`, `"code"` or `"description"` key.
    Loop over the room's values, don't hard-code `'4471'`, so a new fixture is covered too.
  - `ledger.parentId === 'desk'`, `sea-chart.parentId === 'wall-safe'`, `logbook.parentId === 'cabinet'`.
    Contained positions equal the parent's.
  - `puzzleTargets.p3 === 'door'` (canonical exit puzzle), `exitObjectId === 'door'`, and the door is centre-back.
  - Top-level positions are pairwise ≥ 1.2 apart and inside `±ROOM_HALF`.
  - Deterministic: two calls deep-equal. Shuffling nothing changes nothing.
  - A room with 1 top-level object and a room with 9 both lay out inside the walls (build via object literal of
    `RoomSpec` shape, then `parseRoomSpec`).
- **VALIDATE**: `pnpm vitest run lib/replay/layout.test.ts`.
- **SATISFIES**: AC 1, AC 6.

### 5. CREATE `lib/replay/labels.ts` + `labels.test.ts`

- **IMPLEMENT**: display strings, one exhaustive map per union:
  - `VERB_LABEL: Record<ActionName, string>`: `look → 'looks around'`, `inspect → 'inspects'`, `take → 'takes'`,
    `open → 'tries to open'`, `use → 'uses'`, `enter_code → 'enters code'`, `submit_answer → 'answers'`.
  - `VERDICT_TONE: Record<VerdictCode, 'success' | 'neutral' | 'failure' | 'invalid'>`. This **mirrors
    `VERDICT_TALLY` at `lib/sim/simulator.ts:48-58`**, which is how `RunSummary` counts: `ok → success`; `locked →
    neutral` (the tally scores it `none`, so checking a lock isn't penalised); `wrong_answer/wrong_code/wrong_key →
    failure`; `not_found/not_holding/malformed/not_permitted → invalid`. Copy the table rather than importing it,
    because `lib/replay` ships to the client and must not value-import the simulator. `labels.test.ts` (a test, so the
    import is allowed there) asserts the two tables agree code by code.
  - `REJECTION_LABEL: Record<RejectionKind, string>`: `no_tool_call → 'did not act'`, `multiple_tool_calls → 'tried
    two actions at once'`, `unparseable_arguments → 'sent garbled arguments'`, `provider_rejected_call → 'sent a call
    the provider rejected'`, `invalid_arguments → 'sent an action the rules refuse'`.
  - `describeAction(beat, layout)` → e.g. `enters code 4471 on wall safe`, `uses brass key on studded door`,
    `inspects bookshelf` (an unknown target shows `rawTargetId` verbatim, so the viewer sees exactly what the model
    named), `answers "north" for studded door`. A rejected beat gives the `REJECTION_LABEL`.
  - `formatThink(ms)` → `'2.5 s'` (1 dp, `toFixed(1)`), `formatThink(12340)` → `'12.3 s'`.
- **TESTS**: every `ActionName`, `VerdictCode` and `RejectionKind` has a non-empty label (iterate the exported
  tuples, so a v1 addition fails here and at typecheck). For every code, `VERDICT_TONE` maps to `VERDICT_TALLY`
  (`none→success|neutral`, `failed→failure`, `invalid→invalid`). `describeAction`
  gets one test per verb. `formatThink(0)`, `(1260)`, `(3340)`.
- **VALIDATE**: `pnpm vitest run lib/replay/labels.test.ts`.
- **SATISFIES**: AC 3, AC 4, AC 7.

### 6. CREATE `lib/replay/timeline.ts` + `timeline.test.ts`

- **IMPLEMENT**: `buildReplay({ log, run, layout }): ReplayData`, plus `class ReplayError extends Error` with `reason:
  'seq_break' | 'run_mismatch' | 'unknown_competitor' | 'missing_summary' | 'empty_lane'` and `detail: string`.
  - Refuse loudly, in this order: any `event.runId !== run.runId` → `run_mismatch`; any `competitorId` not in
    `run.competitors` → `unknown_competitor`; `findSeqBreaks(log)` non-empty → `seq_break` (import `findSeqBreaks` as
    a value from `@/lib/schema/event`, which is allowed); a competitor without a `RunSummary` → `missing_summary`; a
    competitor with zero events → `empty_lane`.
  - Lanes in `run.competitors` order. Within a lane, events sorted by `seq` (the log is merged by `at`, not `seq`).
  - Per event → `ReplayBeat`:
    - `verb = event.action?.name ?? null`
    - `intent = event.action?.intent ?? event.rejected?.intent ?? null`. **Copy the string reference, no trim or
      transform.** Comment why, citing the PRD's misrepresentation risk and `action.ts:21-33`.
    - `rawTargetId`: `targetId` for inspect/take/open/use/enter_code, the `puzzleId`'s mapped object for
      `submit_answer` via `layout.puzzleTargets` (else the puzzleId itself), null for look and rejected.
    - `targetId = rawTargetId` if it names a `layout.objects` id, else `null` (unknown → the character goes to
      `centre`). A contained target stays its own id. The scene resolves its position through `SceneObject.position`.
    - `heldItemId` = `use.itemId` · `argument` = `enter_code.code` / `submit_answer.answer`, else null.
    - `rejection = event.rejected?.kind ?? null`. `verdict` is copied field-by-field.
    - `thinkMs = event.latencyMs`. `cumulativeThinkMs` is a running sum within the lane.
  - Lane: `label = competitor.modelId`, `provider`, `endedBecause`/`escaped` from the summary, and `maxActions` from
    `run.budget.maxActions`.
  - Build with a `switch (action.name)` that's exhaustive (`const _never: never = action`), so a v1 verb breaks the
    build here.
- **PATTERN**: `lib/harness/record.ts` (event → derived record, field by field). Error-with-reason as in
  `lib/solver/rejections.ts`.
- **GOTCHA (v1)**: in T7 Part B `rejected` becomes `nullable` and required. `event.rejected?.intent` still
  typechecks with `null`, and `event.rejected?.kind ?? null` is also safe. Leave a `// v1:` comment on those two
  lines.
- **TESTS**:
  - The canonical fixtures give two lanes, `model-a` (13 beats, escaped) and `model-b` (14, `budget_actions`), in that
    order.
  - **Verbatim:** for every event in the canonical log, the lane beat's `intent` `===` the event's intent (loop over
    the log, don't sample). Plus a unicode case: model-a seq 12 contains `’` (U+2019) and it survives.
  - model-b seq 8: `rawTargetId === 'bookshelf'`, `targetId === null`, verdict `not_found`.
  - model-a seq 12: `submit_answer` → `rawTargetId === targetId === 'door'`, `argument === 'north'`.
  - `cumulativeThinkMs` of model-a's last beat equals the sum of its `latencyMs` (compute from the log).
  - A shuffled log (by `at` reversed) gives an identical `ReplayData`.
  - A rejected event with an intent → `verb null`, `intent` the model's own, `rejection` kind set. Without an intent
    → `intent === null` (**not** `''` and not a placeholder).
  - Each `ReplayError.reason` is produced by its broken input: drop seq 3 → `seq_break`, wrong runId, a stray
    competitor, a run with a summary removed, a competitor in the run with no events.
- **VALIDATE**: `pnpm vitest run lib/replay/timeline.test.ts`.
- **SATISFIES**: AC 3, AC 4, AC 6, AC 7.

### 7. CREATE `lib/replay/beats.ts` + `beats.test.ts`: the beat scheduler

- **IMPLEMENT**:
  ```ts
  /** Every action gets exactly this much screen time. Uniform by design: think-time is a stat, not a duration. */
  export const BEAT_MS = 5000;
  export const INTRO_MS = 3000;   // both rooms visible, labels in, nobody moves
  export const OUTRO_MS = 4000;   // final states held
  /** Lane i starts i × this later, so the two intents change alternately rather than together (spike 3, see NOTES). */
  export const LANE_OFFSET_MS = BEAT_MS / 2;
  /** Within a beat: walk to the target, act, then hold the verdict while the intent is read. */
  export const WALK_FRACTION = 0.3;
  export const ACT_FRACTION = 0.25;   // hold is the remaining 0.45
  export const WATCH_TARGET_MS = { min: 60_000, max: 90_000 } as const;
  /** Bumped whenever any of the above changes; T9 freezes it into the render manifest. */
  export const RENDERER_VERSION = 'replay-v0.1';
  ```
  - `planBeats(data: ReplayData): BeatPlan`. `laneOffsetsMs[i] = i * LANE_OFFSET_MS`.
    `totalMs = INTRO_MS + max_i(offset_i + beats_i * BEAT_MS) + OUTRO_MS`.
  - `laneAt(plan, laneIndex, beatCount, tMs): LaneMoment`. Before `INTRO_MS + offset` → `intro` (beatIndex -1).
    Within beat k → `walk`/`act`/`hold` by fraction, with `progress` 0..1 within the phase. After the lane's last beat
    ends → `done`, `beatIndex = beatCount - 1`, progress 1. Clamp `tMs` to `[0, totalMs]`. Pure arithmetic only, no
    loops over time.
  - Header comment: uniform beat, why think-time isn't duration (`event.ts:58-63`), that these constants are what T9
    freezes, and that the retune procedure is to edit the constants, bump `RENDERER_VERSION` and update the legibility
    note.
- **TESTS**:
  - **The band:** `planBeats(canonical).totalMs` is in `[60_000, 90_000]` (expected 3000 + 2500 + 14·5000 + 4000 =
    79 500). A synthetic run where both lanes use the full `DEFAULT`-sized budget of 14 is in the band too. Comment
    that a quick escape (e.g. 8 actions) may run under 60 s *by design*, because the target is for a *typical* run
    and the beat never stretches to fill.
  - Uniformity: for every beat k in every lane, `end - start === BEAT_MS`, whatever `thinkMs` is (build two lanes
    with wildly different latencies, 10 ms vs 60 000 ms, and assert identical timings).
  - Phase boundaries at exact ms: start of beat → `walk` progress 0, at `WALK_FRACTION·BEAT_MS` → `act`, and so on.
  - Lane 1 is offset by `LANE_OFFSET_MS`. A lane with fewer beats reaches `done` earlier and stays `done`.
  - Clamping at `t < 0` and `t > totalMs`. `WALK_FRACTION + ACT_FRACTION < 1`.
- **VALIDATE**: `pnpm vitest run lib/replay/beats.test.ts`.
- **SATISFIES**: AC 2, AC 4.

### 8. CREATE `lib/replay/roomState.ts` + `roomState.test.ts`

- **IMPLEMENT**: `laneStateAt(lane, layout, beatIndex, settled: boolean): LaneRoomState`. It folds beats `0..beatIndex`
  (the current beat only if `settled`, i.e. its phase is `hold`/`done`, so the safe swings open *when the verdict
  lands*, not at the start of the walk). Only `verdict.ok` beats change state:
  - `open` → `opened += targetId`
  - `enter_code` / `use` → `unlocked += targetId`
  - `take` → `held += targetId`
  - `submit_answer` on `layout.exitObjectId` → `escaped = true`, `opened += exit`
  - `escaped` is also true when the lane's `escaped` is set and the fold reached its last beat. That's the
    belt-and-braces for exits reached by other verbs.
  - Return sorted, deduplicated arrays (stable for React props).
- **TESTS**: model-a at its last beat settled → `escaped`, `opened` ⊇ `desk, wall-safe, cabinet, door`, `held` ⊇
  `ledger`. The same beat unsettled → not yet escaped. model-b end → not escaped, cabinet opened. A failed `open`
  (`locked`) changes nothing. Unknown target (`targetId null`) changes nothing. `beatIndex -1` → all empty.
- **VALIDATE**: `pnpm vitest run lib/replay/roomState.test.ts`.
- **SATISFIES**: AC 1.

### 9. CREATE `lib/replay/index.ts` and `lib/replay/fixture.test.ts`

- **IMPLEMENT**: the barrel re-exports types, `buildSceneLayout`, `buildReplay`, `ReplayError`, beat constants,
  `planBeats`, `laneAt`, `laneStateAt`, and labels. **Not** `testing.ts`.
  `fixture.test.ts`: `loadCanonicalRoom/Log/Run` → `buildSceneLayout` → `buildReplay` → `planBeats`. It asserts:
  - `JSON.parse(JSON.stringify(data))` deep-equals `data` (this is what crosses the server → client boundary);
  - total in band;
  - at `t = totalMs` model-a's moment is `done` and its room state is `escaped`, and model-b is `done` and not escaped.
- **VALIDATE**: `pnpm vitest run lib/replay`.
- **SATISFIES**: AC 2, AC 6, AC 8.

### 10. CREATE `components/scene/*` (the client scene)

Mark every file in this directory as **`'use client'`**. No file here imports `@/fixtures`, `@/lib/schema/room` values,
providers, `process.env`, or `fetch` (enforced by Task 12).

- **`usePlayback.ts`**: `usePlayback(totalMs)` → `{ timeRef, playing, play, pause, restart, beatClock }`. One
  `requestAnimationFrame` loop that advances `timeRef.current` by the rAF timestamp delta while `playing`, and stops
  at `totalMs` (auto-pause at the end). It also exposes a coarse React state `tick` updated **only when some lane's
  `beatIndex` or phase changes** (compute via `laneAt` inside the loop and compare). The DOM panel re-renders about
  4× per beat, not 60×. Starts playing on mount (autoplay is the feed use case). Honours
  `prefers-reduced-motion` only for chrome and camera, never for pacing.
  - **GOTCHA**: use the rAF callback's timestamp argument, not `Date.now`/`performance.now`. That keeps the only
    clock read in one place, and it's what Playwright's clock fakes (A-1).
  - **GOTCHA**: `useFrame` inside the Canvas reads `timeRef.current`. Pass the ref through React context
    (`PlaybackContext`) because drei `View` children are tunnelled, and although context still flows through R3F's
    reconciler bridge in v9, verify it (A-3). If it doesn't, pass `timeRef` as a prop.
- **`ReplayPlayer.tsx`**: props `{ data: ReplayData }`. `useMemo(planBeats)`. Layout is a full-bleed stage with two
  lane columns (CSS grid `1fr 1fr`, stacked vertically under 720 px), a `LanePanel` under or beside each lane's
  View tracking div, and `Controls` in a quiet bar. `ReplayStage` is loaded with
  `dynamic(() => import('./ReplayStage'), { ssr: false })`. Root element `data-testid="replay"` with
  `data-state="playing|paused|ended"`.
- **`ReplayStage.tsx`**: `<Canvas eventSource={containerRef} dpr={[1, 2]} style={{ position: 'absolute', inset: 0,
  pointerEvents: 'none' }}>` with `<View.Port />`. One `<View track={laneRef[i]}>` per lane rendering `RoomScene`.
  `data-testid="replay-canvas"` on the wrapper.
  - **GOTCHA**: drei `View` requires the Canvas to sit *behind* the tracking divs with `eventSource` set to the shared
    container, otherwise nothing renders or events fail. Follow the drei View docs example exactly.
- **`RoomScene.tsx`**: floor plane (`ROOM_HALF`), three low walls (back, left, right, with no front so the camera sees
  in), ambient plus one directional light, and a `PerspectiveCamera makeDefault` at about `[0, 6.5, 7.5]` looking at
  `[0, 0.5, -1]`. It has a subtle sway (±0.15 units over a beat, sine) only when motion isn't reduced. Renders
  `SceneObject` for every **top-level** object, and `Character`. Contained objects are not drawn until they are
  `held`, then they ride on the character (a small box at hand height).
- **`SceneObject.tsx`**: a primitive per `ObjectKind`, with a colour token per kind:
  - `container`: box 1.2×0.8×0.7, with a lid or drawer that rotates or slides when `opened`
  - `lock`: box 0.8×0.8×0.5 with a small emissive keypad face that goes from red to green when `unlocked`, and a
    door that swings when `opened`
  - `door`: tall slab 1.2×2.2×0.15 that swings open when `opened`
  - `fixture`: flat panel on the wall
  - `portable`: small box, drawn only when top-level and not held

  Lerp open and unlock transitions over about 400 ms in `useFrame` (a ref-held target, mutate `rotation` directly).
  `highlighted` (the current beat's target) raises emissive a bit. That's the one "where is it acting" cue.
- **`Character.tsx`**: a capsule body plus a sphere head, coloured per lane (lane A / lane B tokens). In `useFrame`:
  - read `laneAt`;
  - `walk`: lerp position from the previous beat's target position (or `centre` at the start) to this beat's target
    position, which is the target's floor `position` pulled 0.9 toward `centre` so it stands in front, or `centre`
    when `targetId` is null. Ease `easeInOutCubic`, face the direction of travel;
  - `act`: a verb-specific gesture (lean in for inspect and open, reach for take and use, a small bob for
    enter_code and submit_answer, turn in place for look);
  - `hold`: settle, then react by verdict tone. Success is a small hop. Neutral (`locked`) is a short pause and step
    back. Failure is a head shake (±0.2 rad, 2 cycles). Invalid is a shrug (shoulders or scale-y dip).

  A rejected beat (`verb null`) stays in place and does the "invalid" shrug during `act`. When `done` and escaped, the
  character walks through the open exit and fades (opacity on its material). When `done` and not escaped, it stands
  facing the camera.
  - **GOTCHA**: allocate `Vector3`s once (`useMemo`) and reuse them. No `new` inside `useFrame`.
- **`LanePanel.tsx`**: DOM only. Top line: `label` (modelId) and `provider`, plus `Action {n} / {maxActions}`. Main:
  the **intent in quotes**, verbatim, in the intent type style (`.intent`), with `data-testid="intent-{competitorId}"`.
  If `intent === null` it shows `(no intent written)` in a muted style, clearly chrome and not model text. Below:
  `describeAction(beat, layout)` and the verdict `message` coloured by tone. Stats row: `thought {formatThink(thinkMs)}`
  and `total {formatThink(cumulativeThinkMs)}`, with `data-testid="think-{competitorId}"`. In `intro` it shows the lane
  label and "ready". In `done` it shows `Escaped in {n} actions` or `Out of actions` / `Out of tokens` /
  `Out of time` from `endedBecause`, as a small `Record<EndReason, string>` in `labels.ts` (add it there, with a test).
  The intent updates at the **start of each beat** (it's what the model meant before acting) and stays for the whole
  beat. The verdict line appears at `hold`. Changes cross-fade with **opacity only** (`transition: opacity 180ms`),
  with no slide, scale or bounce.
- **`Controls.tsx`**: two `<button>`s, play/pause (toggles label, `aria-pressed`) and restart. Text labels, no icon
  font. `data-testid="play-toggle"`, `"restart"`.
- **`replay.module.css`**: tokens on the module root. A dark stage by default (the 3D scene is the footage and keeps
  its size and brightness). System font stack
  `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`. Intent: `font-size: clamp(1.125rem, 1rem +
  0.6vw, 1.5rem)`, `line-height: 1.35`, `font-weight: 500`, max width `36ch`, never `text-overflow`/`-webkit-line-clamp`
  (**truncation is banned**). A `.intentLong` class (applied when `intent.length > 140`) steps the size down one
  notch. That's the typography knob spike 3 turns. Stats in `font-variant-numeric: tabular-nums`. Under 720 px, lanes
  stack and the gutter is 16 px, with no horizontal scroll. `@media (prefers-reduced-motion: reduce)` sets transitions
  to `0ms`.
- **VALIDATE**: `pnpm typecheck` (Next's type plugin plus R3F JSX types).
- **SATISFIES**: AC 1, AC 3, AC 4, AC 5.

### 11. CREATE `app/replay/page.tsx`; UPDATE `app/page.tsx`, `app/layout.tsx`

- **IMPLEMENT**: `app/replay/page.tsx` is a **server component** (no `'use client'`). `export const dynamic =
  'force-static'`, and `metadata = { title: 'Replay · LLM Escape Room' }`. In the body:
  `const room = loadCanonicalRoom(); const data = buildReplay({ log: loadCanonicalLog(), run: loadCanonicalRun(),
  layout: buildSceneLayout(room) }); return <ReplayPlayer data={data} />;`. The header comment says why the room is
  read here and nowhere else, and that T9 replaces the fixtures with an artifact loaded by id at `/run/[id]`.
  `app/page.tsx` gets one `<a href="/replay">Watch the canonical replay</a>` and an updated comment. `app/layout.tsx`
  keeps its bareness but gets `<body style={{ margin: 0 }}>`, and its comment is updated to say T8 decided against
  a global styling system (styles are module-scoped in `components/scene`).
- **GOTCHA**: `ReplayData` must be a plain object. The server → client prop is serialised by React, and `fixture.test.ts`
  (Task 9) already proves the JSON round-trip.
- **VALIDATE**: `pnpm typecheck && pnpm build`. The build output lists `/replay` as static (○). Then
  `grep -rl "4471" .next/static || echo "no lock code in client chunks"`. Expect that the code **may** appear, because
  model-b *types* 4471 and the verdict messages are in the log. So the real check is
  `grep -rl '"clueText"\|"opensWith"' .next/static` → **no matches** (no `RoomSpec` shape in client chunks).
- **SATISFIES**: AC 1, AC 6.

### 12. CREATE `lib/replay/boundary.test.ts`; UPDATE `lib/providers/secrets.test.ts`

- **IMPLEMENT**: mirror `lib/harness/boundary.test.ts`. Walk `lib/replay` (`.ts`, excluding `*.test.ts` and
  `testing.ts`) **and** `components/scene` (`.ts`/`.tsx`), from `ROOT = join(DIR, '..', '..')`.
  - `FORBIDDEN` (all files): `process.env`, `fetch(`, `https?://`, `node:http(s)`, `Math.random` (a replay must
    look the same every time), `Date.now`, `performance.now` ("the only clock is the rAF timestamp in usePlayback").
  - `FIXTURE_IMPORT = /from\s+['"]@\/fixtures/` forbidden everywhere swept ("fixtures are loaded by the server page
    only").
  - `ROOM_VALUE_IMPORT` (copy from the harness sweep) forbidden everywhere swept.
  - `PROVIDER_IMPORT` forbidden (any `@/lib/providers`), and `SIM_IMPORT = /from\s+['"]@\/lib\/sim/` forbidden (the
    replay reads the log and never re-simulates; `VERDICT_TONE` is a copy checked by test).
  - `components/scene/*.tsx` must each begin with `'use client'`.
  - Guard-the-guard: ≥ 12 files, including `beats.ts`, `layout.ts`, `ReplayPlayer.tsx`, `usePlayback.ts`.
  - Positive control that plants each pattern.
  - In `lib/providers/secrets.test.ts`: add `'components'` to `SWEPT_DIRS` and `'lib/replay'`, `'components'` to
    `ARTIFACT_SIDE`. Update the comment at `:28-29` to say T8 added them. Make sure the file regex there matches
    `.tsx` (it's `/\.tsx?$/`, so yes) and the file-count floor still holds.
- **VALIDATE**: `pnpm vitest run lib/replay/boundary.test.ts lib/providers/secrets.test.ts`.
- **SATISFIES**: AC 6.

### 13. CREATE `playwright.config.ts` + `e2e/replay.spec.ts`

- **IMPLEMENT**: config: `testDir: 'e2e'`, `testMatch: '**/*.spec.ts'`, one `chromium` project with
  `launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }` (software WebGL for headless
  runs, A-2), `webServer: { command: 'pnpm dev --port 3100', url: 'http://localhost:3100/replay',
  reuseExistingServer: !process.env.CI, timeout: 120_000 }`, `use.baseURL`. (The config lives at the root, outside
  every sweep, so `process.env.CI` is fine there.)
  Spec, three tests:
  1. **Renders.** `goto('/replay')`. `[data-testid=replay-canvas] canvas` is visible, and
     `page.evaluate(() => !!document.querySelector('canvas')?.getContext('webgl2') ...)` is truthy. Capture
     `pageerror`/`console.error` and assert none. (A WebGL-context-lost warning under SwiftShader fails loudly here.)
  2. **Intents verbatim.** `await page.clock.install()` **before** `goto`. `runFor(INTRO_MS + 100)`. The
     `intent-model-a` text equals model-a seq 0's intent from the fixture (import `loadCanonicalLog` from
     `@/fixtures` in the spec, which runs in Node, and which is allowed and outside the sweeps). `runFor(LANE_OFFSET_MS)`
     → model-b seq 0's. `think-model-a` contains `2.1 s`.
  3. **Plays to the end.** With the clock installed, `runFor(totalMs + 500)` in chunks of 5 000 ms (so rAF fires
     between). `[data-testid=replay]` has `data-state="ended"`. model-a's panel reads `Escaped in 13 actions`.
     model-b's reads `Out of actions`. `restart` returns to the intro.
  - **GOTCHA (A-1)**: if the R3F loop starves or the test times out under `runFor`, the fallback is to assert only the
    DOM (panel text and `data-state`), which `usePlayback`'s rAF loop drives independently of the Canvas. If
    `page.clock` still doesn't advance rAF, drop test 3 to "first two beats" and rely on `fixture.test.ts` for the end
    state. **Record which way it went in the legibility note**, and don't silently weaken it.
  - Import `INTRO_MS`, `LANE_OFFSET_MS`, `planBeats` etc. from `@/lib/replay` so the spec can't drift from the constants.
- **VALIDATE**: `pnpm e2e`.
- **SATISFIES**: AC 1, AC 2, AC 3, AC 4, AC 9.

### 14. Spike 3: watch it, tune it, CREATE `docs/decisions/replay-legibility.md`

- **IMPLEMENT**: `pnpm dev`, open `http://localhost:3000/replay`, and watch the full canonical run **at least twice**,
  once at desktop width and once at 390 px. Checklist:
  1. Can you read both intents fully before each changes? (The canonical max is 70 chars. For the 280-char worst
     case, temporarily overwrite one beat's `intent` in `app/replay/page.tsx` after `buildReplay`, watch it, then
     revert. Add no dev-only switch to the code.)
  2. Do you know *where* each character is acting before the verdict lands?
  3. Is the moment model-b loses the thread (seq 8, `bookshelf`) visible without reading the log?
  4. Does the total feel like 60–90 s?

  If something doesn't read, **tune only** `BEAT_MS`, `WALK/ACT_FRACTION`, `LANE_OFFSET_MS` and the intent
  typography, re-run `beats.test.ts` (the band), and bump `RENDERER_VERSION`. **Never** shorten, summarise or rewrite
  an intent.
  The note follows `docs/decisions/substrate.md`'s shape: Status, Context (spike 3 question and rule), Method (what
  was watched, widths, browser), Result (the verdict for each checklist item), Decision (final constants and type
  sizes as a table), Consequences (e.g. 280-char intents need ~9 s at a comfortable ~30 chars/s, so at a 5 s beat
  they wrap to ~5 lines at the smaller size and remain a known limit), and the Playwright clock outcome (A-1).
- **GOTCHA**: this is a *human* judgement. The implementing agent can do the mechanical parts (screenshots via
  Playwright at a few timestamps, into the scratchpad, not the repo). It **must** mark the verdict as
  `Status: Draft — awaiting watch-through by the owner` unless the user has actually watched it and said so.
- **VALIDATE**: the file exists, and `pnpm test && pnpm e2e` is still green after any tuning.
- **SATISFIES**: AC 5.

### 15. UPDATE `README.md`

- **IMPLEMENT**: under *Status*, T8 is done: `/replay` plays the golden fixture. Under *Contracts*, add a line saying
  the replay reads `ReplayData`, built server-side from the log, run and a public `SceneLayout`, and never from a
  `RoomSpec` on the client. Add a *Running the replay* snippet: `pnpm dev` → `/replay`, `pnpm e2e` (first time:
  `pnpm exec playwright install chromium`). Keep to the README's existing voice and length.
- **VALIDATE**: read it once.
- **SATISFIES**: AC 10.

---

## TESTING STRATEGY

### Unit Tests

Vitest, node environment, `lib/replay/*.test.ts`. About 60–75 new tests:

| File | Est. tests |
|---|---|
| `layout` | 9 |
| `labels` | 10 |
| `timeline` | 14 |
| `beats` | 10 |
| `roomState` | 7 |
| `fixture` | 4 |
| `boundary` | ~2 per swept file + controls |
| `secrets` (existing) | +files swept automatically |

No React component unit tests. The components are thin readers of pure functions that are already tested, and the
browser smoke covers them rendering. That keeps the ticket's ~25% test share honest without adding jsdom/happy-dom.

### Integration Tests

- `lib/replay/fixture.test.ts`: golden fixtures → layout → replay → plan → end states, plus the JSON round-trip.
- `e2e/replay.spec.ts` (Playwright): real Next dev server, real Chromium, real WebGL (SwiftShader), fake clock.
- Existing suites unchanged: `fixtures/index.test.ts`, `lib/providers/secrets.test.ts` (now sweeping more).

### Edge Cases

- An unknown target (`bookshelf`): the character goes to centre and shrugs, the panel shows `inspects bookshelf` and
  `not_found`, and the room state doesn't change.
- A rejected turn with no intent: the panel shows `(no intent written)` as chrome. An empty string must never render as
  if the model wrote nothing in quotes.
- A rejected turn with an intent: the model's intent is shown verbatim plus the rejection label.
- `submit_answer`: the target resolves through `puzzleTargets` to the door. An unknown puzzleId → `rawTargetId` is the
  puzzleId and the target is null.
- Lanes of unequal length (13 vs 14): the shorter lane reaches `done` first and holds its end pose and panel.
- A log merged out of seq order: it's re-sorted per lane.
- Broken logs: each `ReplayError.reason` is covered.
- Extreme think-times (10 ms vs 60 s): identical beat timings.
- A contained object targeted before it's reachable: the target position is the container's.
- Narrow viewport (390 px): lanes stack, no horizontal scroll (checked manually in Task 14, and optionally with
  a Playwright `setViewportSize` assertion that `scrollWidth <= innerWidth`).
- Reduced motion: chrome fades are instant, and the camera sway is off. The beat pacing is unchanged.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm typecheck
```

(No linter is configured. Match the style by eye.)

### Level 2: Unit Tests

```bash
pnpm vitest run lib/replay lib/providers/secrets.test.ts
```

### Level 3: Integration Tests

```bash
pnpm test                       # must stay green: baseline 741 at 94c104b, plus the new tests
pnpm build                      # /replay listed as static
grep -rlE '"clueText"|"opensWith"' .next/static && echo "LEAK" || echo "no RoomSpec shape in client chunks"
pnpm e2e
git diff 94c104b --stat -- lib/schema lib/sim lib/solver lib/generator lib/harness lib/spike fixtures scripts
#   ↑ must be empty
```

### Level 4: Manual Validation

```bash
pnpm dev    # open http://localhost:3000/replay
```

- It autoplays. Both rooms are visible, and the intro shows labels `competitor-a` / `competitor-b`.
- model-a's first intent appears at ~3 s, and model-b's at ~5.5 s. They alternate after that.
- About 40 s in, model-b goes to the middle of the room and shrugs at `bookshelf`.
- model-a walks out of the door at around its 13th beat, and its panel reads `Escaped in 13 actions`.
- The whole run ends at ~79.5 s, and restart works.
- Resize to 390 px wide: the lanes stack and nothing scrolls sideways.
- The spike-3 checklist in Task 14.

### Level 5: Additional Validation (Optional)

- The `agent-browser` skill or Playwright screenshots at t = 3.5 s, 40 s and 79 s into the scratchpad, for the
  legibility note. Don't commit them.

---

## ACCEPTANCE CRITERIA

- [ ] **AC 1:** `/replay` renders a React Three Fiber side-by-side scene of two copies of the room, with one character
      each that walks to its target and animates the interaction. Objects visibly open or unlock on `ok` verdicts.
- [ ] **AC 2:** a beat scheduler gives every action exactly `BEAT_MS` of screen time, and the canonical run's total
      is within 60–90 s (asserted in Vitest; ~79.5 s).
- [ ] **AC 3:** each character's declared intent is shown beside it for its whole beat, **byte-for-byte verbatim**
      (asserted for every canonical event and in the browser). There's no truncation CSS, and a missing intent is
      labelled as missing, never invented.
- [ ] **AC 4:** real think-time (`latencyMs`) and its running total are displayed as stats, and changing think-time
      changes no beat timing (asserted).
- [ ] **AC 5:** spike 3 is closed or drafted in `docs/decisions/replay-legibility.md` with the tuned constants and
      typography. Any fix was to timing or type, never to the model's words.
- [ ] **AC 6:** no backend and no `RoomSpec` on the client. The page builds `ReplayData` server-side from fixtures;
      `lib/replay` and `components/scene` never import fixtures, room values, providers, env or network (boundary
      test); the secrets sweep covers the new directories; and no `RoomSpec` keys are in the client chunks.
- [ ] **AC 7:** rejected (null-action) turns and unknown targets render as explicit fumble or invalid beats (unit
      tested).
- [ ] **AC 8:** `ReplayData` survives a JSON round-trip unchanged, ready for T9 to freeze.
- [ ] **AC 9:** Playwright is installed and `pnpm e2e` passes (render, verbatim intent, play to end, or the documented
      A-1 fallback).
- [ ] **AC 10:** `pnpm typecheck`, `pnpm test` and `pnpm build` are all green, no files outside this ticket's scope
      changed (Level 3 diff), and the README is updated.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration + e2e)
- [ ] No type errors
- [ ] Manual watch-through done (or the legibility note is explicitly marked awaiting the owner)
- [ ] Acceptance criteria all met
- [ ] `docs/decisions/substrate.md` left untouched and uncommitted

---

## OPEN QUESTIONS / ASSUMPTIONS

**Settled at the gate (2026-09-24, "defaults"):**

- **D1: Layout source.** A pure `buildSceneLayout(room)` public projection, built server-side. Only `ReplayData`
  reaches the client, and T9 freezes the layout into the manifest.
- **D2: Beats.** Parallel lanes aligned by `seq`, a fixed uniform `BEAT_MS` (~5 s), and a test for 60–90 s on the
  canonical run. Early finishers hold an end pose. Think-time is shown per action and as a running total, never as
  duration.
- **D3: Look.** One Canvas plus drei `View` ×2, primitive geometry per kind, and the intent as a DOM overlay.
  Intents are never truncated.
- **D4: Scope.** A static `/replay` route and play/pause/restart. No scrub, no speed, and nothing from T9, T10 or
  T11. Rejected turns are drawn as fumbles.
- **D5: Tests.** Vitest for the pure core, Playwright installed with one smoke spec, and spike 3 closed by
  `docs/decisions/replay-legibility.md`.
- **D6: Branch.** `feature/replay-player-v0` cut from `feature/substrate-spike-v1`, with intents read as
  `action?.intent ?? rejected?.intent`.

**Planner's calls within those defaults (flag at review if wrong):**

- **P1: `LANE_OFFSET_MS = BEAT_MS / 2`.** The second lane runs half a beat behind, so the two intents change
  alternately. Each is still on screen for a full uniform beat. This is a legibility call for spike 3, where two
  lanes of text changing at once is the main risk. Set it to `0` to get strict lockstep; the band still holds
  (77 s).
- **P2: `(no intent written)`** is shown for a null intent as clearly styled chrome.
- **P3: Autoplay on load**, because it suits the feed use case.

**Assumptions to verify during execution:**

- **A-1:** Playwright's `page.clock` drives `requestAnimationFrame` enough for R3F and `usePlayback` under `runFor`.
  The fallback is in Task 13, and the outcome gets recorded in the legibility note.
- **A-2:** headless Chromium gets a WebGL context via SwiftShader with the launch flags in Task 13. If not, run that
  one test `headed` locally and mark it `test.skip(!!process.env.CI)` with a comment. Don't delete it.
- **A-3:** React context reaches components inside drei `View` (R3F v9 bridges context). If not, pass `timeRef`
  down as props.

## NOTES (open canvas)

**Why the half-beat lane offset is the interesting spike-3 lever.** At a 5 s beat with both lanes changing
together, a viewer has to read two new lines (up to ~140 chars on the canonical log) in the same instant, while
also watching two characters move. Offsetting lane B by 2.5 s turns that into one new line every 2.5 s, each still
visible for the full 5 s. Neither beat length nor intent text changes, so it's legal under the "timing and
typography only" rule. The race stays honest: seq *k* in lane A and seq *k* in lane B are still half a beat apart,
and the panel says `Action k / 14` in both. If watching shows it reads as "B is slower", set it to `0`. That's a
one-constant change.

**Budget arithmetic.** `INTRO 3 s + OFFSET 2.5 s + 14 × 5 s + OUTRO 4 s = 79.5 s`. `maxActions` is 14 today, and T7
Part B may retune it to ⌈1.25 × p90⌉, never below 14. At 18 actions it would be 99.5 s and break the band.
`beats.test.ts` will then fail, **which is the right outcome**. It forces a deliberate `BEAT_MS` retune (e.g. 4 s →
83.5 s) rather than drifting silently. The test should state that in its failure message.

**Why the intent changes at beat start, not at the verdict.** An intent is what the model meant *before* acting. It
arrives first, the character acts, then the verdict lands in the `hold` phase. The viewer reads the plan, watches the
attempt and sees the outcome, which is the "point at the moment it lost the thread" beat the PRD wants.

**Why not two `<Canvas>`es.** They're simpler, but that means two WebGL contexts, two render loops and double GPU
memory, and T9 or a future video export would have to sync them. `View` gives one loop and one clock. If `View` fights
the layout (it's the fiddliest part of this ticket), two Canvases are an acceptable fallback **for v0 only**. Note it
in the legibility note if taken.

**Why no component unit tests.** Every decision a component makes (which beat, which phase, which state, which label)
is a pure function in `lib/replay` and tested there. The components map numbers to transforms. Testing R3F in
jsdom means mocking WebGL, which tests the mock. The browser smoke is the honest test for that layer.

**T7 v1 impact, concretely.** `Event.rejected` goes from `optional()` to `nullable()`, required. In `timeline.ts`,
`event.rejected?.intent` and `event.rejected?.kind ?? null` both keep working with `null`. `testing.ts`'s
`event()` builder needs `rejected: null` added. That's all. If v1 adds a verb or verdict, the exhaustive `Record`s
and `switch` fail typecheck, which is the intended alarm.

**Where think-time could mislead.** Think-time includes provider queueing, not just "thinking". The label is
`thought 2.5 s` because that's what the PRD calls it, but T10's comparison view should carry the caveat. Out of scope
here, noted for T10.

## AMENDMENTS

- 2026-09-24 — during implementation: `BeatPlan` carries `beatCounts` (so `laneAt` takes no count); `beatStartMs` and
  `isSettled` added to `beats.ts`; phase boundaries in whole ms; the clock is passed as a `timeRef` prop, not context
  (A-3 moot); the canvas sits above the lanes (transparent outside the views), not behind; camera moved closer after
  screenshots. A-1 and A-2 both held. See `.claude/reports/replay-player-v0-report.md`.
