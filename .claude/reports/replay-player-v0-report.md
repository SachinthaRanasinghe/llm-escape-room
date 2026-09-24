# Implementation Report — Replay player v0 on a synthetic log (TICKET-8, #5)

**Plan**: `.claude/plans/replay-player-v0.md`   **Branch**: `feature/replay-player-v0` (cut from
`feature/substrate-spike-v1` @ `94c104b`)   **Status**: COMPLETE. The spike-3 watch-through by the owner is still
pending, as the plan requires.

## Summary

The static route `/replay` plays TICKET-1's golden log as a side-by-side React Three Fiber scene. There are two
copies of the room in one `<Canvas>` (two drei `<View>`s), with a primitive character in each. Each character walks
to its target, acts, and reacts to the verdict on a uniform 5 s beat: 79.5 s for the canonical run. A DOM panel per
lane shows the intent word for word, the action, the verdict, and real think-time plus a running total as stats.
The server page projects the `RoomSpec` into a public `SceneLayout`, so only `ReplayData` reaches the client.
Boundary tests enforce that.

## Tasks completed

- 0 Branch → `feature/replay-player-v0`
- 1 Deps + scripts → `package.json`, `pnpm-lock.yaml` (UPDATE): `three@0.186.0`, `@react-three/fiber@9.8.0`,
  `@react-three/drei@10.7.8`, `@types/three@0.186.0`, `@playwright/test@1.63.0`, and the `e2e` script
- 2 → `lib/replay/types.ts` (CREATE)
- 3 → `lib/replay/testing.ts` (CREATE)
- 4 → `lib/replay/layout.ts` + `layout.test.ts` (CREATE)
- 5 → `lib/replay/labels.ts` + `labels.test.ts` (CREATE)
- 6 → `lib/replay/timeline.ts` + `timeline.test.ts` (CREATE)
- 7 → `lib/replay/beats.ts` + `beats.test.ts` (CREATE)
- 8 → `lib/replay/roomState.ts` + `roomState.test.ts` (CREATE)
- 9 → `lib/replay/index.ts`, `lib/replay/fixture.test.ts` (CREATE)
- 10 → `components/scene/{usePlayback.ts, palette.ts, SceneObject.tsx, Character.tsx, RoomScene.tsx,
  ReplayStage.tsx, LanePanel.tsx, Controls.tsx, ReplayPlayer.tsx, replay.module.css}` (CREATE)
- 11 → `app/replay/page.tsx` (CREATE); `app/page.tsx`, `app/layout.tsx` (UPDATE)
- 12 → `lib/replay/boundary.test.ts` (CREATE); `lib/providers/secrets.test.ts` (UPDATE: `components` added to
  `SWEPT_DIRS`, and `lib/replay` + `components` to `ARTIFACT_SIDE`)
- 13 → `playwright.config.ts`, `e2e/replay.spec.ts` (CREATE)
- 14 → `docs/decisions/replay-legibility.md` (CREATE, status Draft, awaiting the owner)
- 15 → `README.md` (UPDATE)
- Extra → `.gitignore` (UPDATE: `/test-results/`, `/playwright-report/`, `/blob-report/`)

## Tests added

Vitest: **112 new tests** (742 → 854), all passing.

| File | Tests | Covers |
|---|---|---|
| `layout.test.ts` | 11 | exact key set per object; no answer, code, clue or description in the JSON and no secret keys; parents; the exit centre-back; spacing and walls for 0/1/3/8 objects; determinism |
| `labels.test.ts` | 17 | every verb, verdict, rejection and end reason labelled; `VERDICT_TONE` agrees with `VERDICT_TALLY` per code; `describeAction` per verb; unknown target shown verbatim; `formatThink` |
| `timeline.test.ts` | 18 | lanes and outcomes; seq order; **every canonical intent byte-for-byte**; U+2019 kept; whitespace kept; `bookshelf` unknown target; `submit_answer` → door; think-time sums; merge-order independence; rejected turns with and without an intent; each `ReplayError.reason` |
| `beats.test.ts` | 11 | canonical 79.5 s in the band; a full budget in the band; a quick escape runs short; uniform beats whatever the latency; exact phase boundaries; lane offset; early finisher; clamping; settled |
| `roomState.test.ts` | 7 | model-a escapes only once settled; model-b stays in; failed or unknown actions change nothing; a key used on the exit escapes; run fallback |
| `fixture.test.ts` | 4 | JSON round-trip; band; end states; model-a finishes first |
| `boundary.test.ts` | 44 | sweeps 17 files: no env, network, randomness, `Date.now`/`performance.now`, fixtures, providers or sim import, and no room value import; `'use client'` on every scene file; positive controls |

Playwright (`pnpm e2e`): **4 of 4 passed**:
- a WebGL canvas with both lanes and no console errors;
- intents verbatim under the fake clock, lane by lane, with think-time;
- plays to the end (`Escaped in 13 actions` / `Out of actions`), then restarts;
- 390 px wide with no horizontal scroll.

## Validation results

- `pnpm typecheck`: pass
- `pnpm test`: 58 files, **854 passed**
- `pnpm build`: pass; `/replay` is prerendered static (○)
- `grep -rlE '"clueText"|"opensWith"|clueText:|opensWith:' .next/static`: no matches (no `RoomSpec` shape in the
  client chunks)
- `pnpm e2e`: 4 passed (~1.3 min)
- `git diff 94c104b --stat -- lib/schema lib/sim lib/solver lib/generator lib/harness lib/spike fixtures scripts`:
  only `scripts/spike-substrate.mts`, which is the **owner's pre-existing uncommitted edit, not this ticket's**
  (see Issues)

## Deviations from the plan

- **`BeatPlan` gained `beatCounts`, and `laneAt(plan, laneIndex, tMs)` drops the `beatCount` argument.** The plan
  carries the counts, so callers can't pass a mismatched one.
- **Added `beatStartMs` and `isSettled` to `beats.ts`.** The character's exit walk and the room-state "settled" fold
  both needed them. Keeping them here avoids re-deriving the arithmetic in components.
- **Phase boundaries are computed in whole milliseconds** (`Math.round(BEAT_MS × fraction)`) rather than float
  fractions. The float version put `hold` at progress 1.2e-16 instead of 0.
- **`VERDICT_TONE` has a fourth tone, `neutral`, for `locked`.** The plan's draft list called `locked` and
  `not_holding` failures. The real `VERDICT_TALLY` (`lib/sim/simulator.ts:48`) scores `locked` as `none` and
  `not_holding` as `invalid`, and the tone mirrors the tally, as the plan's own GOTCHA required. The plan was
  amended before implementation.
- **`lib/replay/boundary.test.ts` also forbids `@/lib/sim` imports** (added to the plan before implementation).
  `VERDICT_TONE` is a copy of the tally, checked in a test.
- **The timeline tests always use two-competitor runs.** `RunSchema.competitors` is `.min(2)`, so the planned
  single-competitor `runFixture(['a'])` doesn't parse.
- **The `clock` is passed to the scene as props (`timeRef`), not React context.** That sidesteps assumption A-3
  entirely.
- **The canvas sits above the lane columns (`zIndex: 2`, pointer events off)**, not behind them. It's transparent
  outside the tracked views, so the panels show through. Behind the opaque lane backgrounds it would have been
  hidden.
- **Camera moved closer** than planned (`[0, 5.6, 6.2]`, fov 42, looking at `(0, 0.3, -1.4)`), after the first
  screenshots showed the room filling only the top half of each view.
- **Contained objects are revealed on top of an opened holder**, drawn as a small box. The plan only said "not
  drawn until held".
- **`.gitignore` gained the Playwright output dirs.** Not in the plan, but the first e2e run created
  `test-results/`.
- **Added a `palette.ts`** for three.js colours, since materials can't read CSS custom properties. The lane colours
  are duplicated in the CSS and cross-referenced in comments.

## Issues encountered

- **Uncommitted work that isn't this ticket's is in the tree:** `docs/decisions/substrate.md`,
  `lib/providers/index.ts`, `lib/providers/transport.ts`, `lib/providers/transport.test.ts` and
  `scripts/spike-substrate.mts` were modified by the owner (TICKET-7 spike work) while this ran. They were **not
  touched**, and they must be excluded when committing this ticket (stage paths explicitly, never `git add -A`).
  That work is also why the baseline was 742, not the plan's 741.
- **`AGENTS.md` / `CLAUDE.md` were generated by `next dev`** (Playwright's `webServer` started it). They tell agents
  to consult `node_modules/next/dist/docs/`, and I did: `next/dynamic` with `ssr: false` inside a Client Component
  and `dynamic = 'force-static'` both match this Next 16.3.2's docs. Whether to commit them is the owner's call.
  The block says `next dev` re-creates them if removed.
- **`page.screenshot` advances Playwright's fake clock**, so review frames can land slightly late. DOM assertions
  are exact (checked at t = 7.2 / 20 / 44.5 s). Recorded in the legibility note.
- **R3F logs `THREE.Clock: This module has been deprecated`** from three 0.186. It's a warning from the library,
  not an error, and it doesn't trip the no-console-errors test.
- The play-to-end e2e test takes ~60 s under SwiftShader, so its timeout was raised to 150 s.

### Ready for the next step

All planned tasks are done and every validation passes. The one thing left open is the owner's spike-3
watch-through (`docs/decisions/replay-legibility.md` → *To confirm by watching*). Next: `piv-commit`, staging this
ticket's paths only, then `piv-create-pr`, then `piv-review-pr`.
