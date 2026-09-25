# Implementation Report — Published artifact: render manifest freeze + static run URL (TICKET-9, #9)

**Plan**: `.claude/plans/published-artifact-v0.md`   **Branch**: `feature/published-artifact-v0` (cut from
`feature/replay-player-v0`; the ticket branches stack, and `main` holds only the scaffold)   **Status**: COMPLETE

## Summary

A finished run can now be published as one versioned JSON file, `published/<id>.json`. The file holds:

- the event log;
- the run record;
- a **frozen render manifest**: renderer version, beat timing and the computed beat plan, camera plan, palette,
  stage geometry, and the public scene layout.

`/run/[id]` is built statically from those files and plays each one with its own frozen renderer settings. To make
freezing possible, every renderer setting moved into one data snapshot, `lib/replay/renderer.ts`. The player now
takes that snapshot as a prop instead of reading module constants.

Tests show that:

- a published run replays identically after a renderer bump;
- the artifact holds no room secrets and nothing shaped like a URL or key;
- the page makes no request beyond its own origin.

## Tasks completed

- Renderer snapshot → `lib/replay/renderer.ts` (CREATE), `lib/replay/renderer.test.ts` (CREATE)
- Plan-driven beats → `lib/replay/beats.ts`, `lib/replay/types.ts`, `lib/replay/index.ts` (UPDATE)
- Player reads the snapshot:
  - `components/scene/{ReplayPlayer,ReplayStage,RoomScene,Character,SceneObject}.tsx` and `replay.module.css`
    (UPDATE);
  - `components/scene/palette.ts` (REMOVE; its values are now `CURRENT_RENDERER.assets`).
- `/replay` passes `CURRENT_RENDERER` → `app/replay/page.tsx` (UPDATE)
- `ARTIFACT_VERSION` → `lib/schema/version.ts` (UPDATE)
- Artifact library → `lib/artifact/{schema,scan,publish,replay,store,index,testing}.ts` (CREATE)
- Publishing CLI → `scripts/publish.mts` (CREATE), with `published/canonical.json` and `published/README.md`
  (generated, CREATE)
- Static route → `app/run/[id]/page.tsx` (CREATE), `app/page.tsx` (UPDATE)
- Proofs:
  - `lib/artifact/{freeze,canonical,boundary}.test.ts` (CREATE);
  - `lib/providers/secrets.test.ts` (UPDATE: `lib/artifact` added to `ARTIFACT_SIDE`, `published/` added to the JSON
    scan);
  - `e2e/run.spec.ts` (CREATE).
- Docs → `README.md`, `lib/schema/migrations/README.md`, `docs/decisions/replay-legibility.md` (UPDATE)

## Tests added

- `lib/replay/renderer.test.ts` (7):
  - the snapshot is plain JSON;
  - the snapshot comes from the constants rather than duplicating them;
  - version parsing;
  - `planBeats` and `laneAt` follow the timing they're given.
- `lib/artifact/schema.test.ts` (7):
  - an unknown key is refused at six nesting levels;
  - a future version, a bad id (`../x`, uppercase, 65 characters), a bad renderer version and a non-hex colour are
    each refused;
  - type-level agreement with the replay types.
- `lib/artifact/scan.test.ts` (4): each leak kind is found, and a whole key is never re-printed.
- `lib/artifact/publish.test.ts` (9):
  - the envelope has exactly its listed fields;
  - the renderer is frozen as given;
  - the plan and layout are frozen;
  - the room's answers, codes, clues and descriptions never appear in the manifest;
  - `room_mismatch`, `seq_break`, a key-shaped `leak` in an intent, and a bad id are each refused.
- `lib/artifact/replay.test.ts` (5):
  - the result matches the `/replay` pipeline;
  - it is plain JSON;
  - `unsupported_renderer` and `plan_drift` are refused;
  - frozen timing wins over the default.
- `lib/artifact/store.test.ts` (5): listing filters out junk, a bad id is refused before any filesystem access, and
  both not-found cases are reported.
- `lib/artifact/freeze.test.ts` (4), **the renderer-bump test**:
  - `vi.doMock` swaps the live renderer for a bumped one (v0.2, 4 s beats, new camera, colours and wall height);
  - `published/canonical.json` still replays deep-equal, and still at 79.5 s;
  - a positive control shows the swap reached the renderer;
  - a major bump refuses the old artifact;
  - **mutation-checked**: when `replay.ts` was temporarily made to return the live renderer, this test failed.
- `lib/artifact/canonical.test.ts` (5): every committed artifact parses and plays without drift and has no leaks;
  `canonical`'s log, run and layout equal the fixtures, with no room secrets outside the log.
- `lib/artifact/boundary.test.ts` (33): no provider, env, network or re-run imports in `lib/artifact`; `replay.ts`
  never names the live renderer; nothing in `components/` or `lib/replay` imports `lib/artifact`; a positive control.
- `e2e/run.spec.ts` (4):
  - plays the frozen artifact to its end;
  - makes **no request to another host** through a full playback;
  - lane colours come from the manifest;
  - an unknown id returns 404.

## Validation results

- `pnpm typecheck`: pass.
- `pnpm test`: **926 passed / 67 files**, up from 854 / 58 at baseline. Three per-file boundary checks disappeared
  with `palette.ts`.
- `pnpm build`: pass. `/run/[id]` → `● /run/canonical` (SSG).
- `pnpm e2e`: **8 passed** (4 `/replay` + 4 `/run`).
- Level 5: no renderer constants remain in `components/`, and nothing on the client side imports `lib/artifact`.
- Manual CLI checks:
  - `--canonical` is deterministic, and the output is not gitignored;
  - a rerun without `--force` is refused (exit 1);
  - a partial run is refused (exit 1);
  - the real smoke run `runs/smoke-canonical-t7b` published to the scratchpad, not committed (25 events).

## Deviations from the plan

1. **`CANONICAL_PUBLISHED_AT` is exported from `lib/artifact/publish.ts`,** not from a test helper. That way the CLI
   never imports test support.
2. **Added `lib/artifact/testing.ts`** (canonical inputs and the room's secrets) as shared test support.
   `schema.test.ts` derives its valid artifact from `buildArtifact` instead of building it by hand.
3. **The positive control in `freeze.test.ts`** checks the fresh artifact's plan rather than `planBeats()` with no
   timing argument. That default parameter binds the module-internal `DEFAULT_TIMING`, which a mocked export can't
   reach. Production code never relies on the default when it plays an artifact.
4. **The e2e clock is now fully deterministic.** Both specs use `clock.install({ time: 0 })` + `pauseAt`, so fake
   time moves only when a test advances it.
   - A bare `install()` let real page-load time leak into the replay's clock.
   - This exposed a **TICKET-8 test bug**: `replay.spec.ts` expected model-a's seq 2 intent at t = 10.6 s. The beat
     arithmetic puts lane A on seq 1 then; the test only passed when page load added about 2.4 s or more.
   - The expectation is corrected to seq 1, with the arithmetic in a comment.
5. **`playwright.config.ts` sets `workers: 1`.** With a second spec file, Playwright ran the two in parallel. Two
   software-rendered WebGL replays (SwiftShader) starved each other until the playback tests timed out.

## Issues encountered

- Your uncommitted **TICKET-7 work** carried over onto this branch untouched, **and none of it is part of this
  ticket**. It is:
  - `docs/decisions/substrate.md`
  - `lib/providers/{index,transport,transport.test}.ts`
  - `scripts/spike-substrate.mts`
  - the untracked `AGENTS.md` / `CLAUDE.md`

  Keep it out of the TICKET-9 commit.
- `components/scene/palette.ts` was removed with `git rm`, so its deletion is already staged.
- A-1 held: Next 16 prerenders the page's filesystem-backed `generateStaticParams`, and `dynamicParams = false` gives a
  404 in dev.
- A-2 held: `vi.doMock` reaches the renderer module through the `@/lib/replay` barrel.
- **Flag for TICKET-7:** the v0 → v1 migration must now also migrate `published/*.json`. This is recorded in
  `lib/schema/migrations/README.md`, and `canonical.test.ts` will fail until it's done.
