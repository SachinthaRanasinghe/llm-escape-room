# Implementation Report — Post-run comparison and variance disclosure (TICKET-10, #10)

**Plan**: `.claude/plans/post-run-comparison.md`   **Branch**: `feature/post-run-comparison` (cut from
`feature/published-artifact-v0` at `221c7f8`, the committed TICKET-9)   **Status**: COMPLETE

## Summary

When a published run ends, or the viewer presses "Skip to results", `/run/[id]` shows the post-run comparison. The
comparison has three parts:

- **A table.** Escape time, actions, puzzles solved, failed attempts, invalid actions, tokens and cost for each
  model. The winner is marked by fewest actions.
- **A variance statement** in plain text, with the counts behind it. For example: "The same room was re-run 3 more
  times without being shown, and competitor-a won in 2 of 3". When the run hasn't been checked, it says so plainly.
- **The nondeterminism limitation**, with a note on what escape time measures.

To state counts, the artifact gains a strict, required `repeats` block. `scripts/publish.mts` builds it from the
harness's `matchup.json`. Both publishing and loading refuse a block that contradicts `run.typicalOfRepeats`.

The outcome logic moved from `lib/harness/typicality.ts` into a new pure module, `lib/comparison/outcome.ts`. The
harness and the page therefore share one definition of "who won" and "typical", and `lib/artifact` still never
imports the harness.

## Tasks completed

- Outcome logic, moved and extended:
  - `lib/comparison/outcome.ts` (CREATE);
  - `lib/harness/typicality.ts` (REFACTOR → re-export shim).
- Artifact contract:
  - `lib/artifact/schema.ts` (UPDATE: `OutcomeSchema`, `RepeatsSchema`, `repeats` field, `repeats_mismatch`);
  - `lib/schema/version.ts` (UPDATE: note that v0 was widened in place).
- Derive and validate the repeats block:
  - `lib/artifact/repeats.ts` (CREATE);
  - `lib/artifact/publish.ts`, `lib/artifact/store.ts`, `lib/artifact/testing.ts`, `lib/artifact/index.ts`
    (UPDATE).
- The CLI reads the matchup: `scripts/publish.mts` (UPDATE).
- `published/canonical.json` regenerated. The only diff is the `repeats` block.
- View-model and every sentence:
  - `lib/comparison/comparison.ts`, `lib/comparison/index.ts` (CREATE);
  - `lib/artifact/comparison.ts` (`comparisonFromArtifact`, CREATE).
- UI:
  - `components/comparison/Comparison.tsx` and `comparison.module.css` (CREATE);
  - `components/scene/ReplayPlayer.tsx` (UPDATE: optional `comparison` prop, reveal on end or skip, stays revealed);
  - `app/run/[id]/page.tsx` (UPDATE).
- Docs: `README.md`, `published/README.md`, `lib/schema/migrations/README.md` (UPDATE).

## Tests added

- `lib/comparison/outcome.test.ts`:
  - tally ordering and determinism;
  - tie and none outcomes;
  - `typicalOf` agrees with `isTypical` across 6 cases.
- `lib/comparison/comparison.test.ts` (30):
  - every canonical row field;
  - every variance sentence, verbatim: typical; a split with one rival; a split with several rivals; atypical
    including "0 of 3"; singular and plural dropped; all dropped;
  - a statement that contradicts the verdict throws;
  - tie and none headlines;
  - the winner is judged by actions, not escape time;
  - `formatCost`;
  - the output is plain JSON and carries no leaks.
- `lib/comparison/boundary.test.ts`:
  - purity: no env, network, `node:` built-ins, clock, randomness, fixtures, providers, re-runs or artifact loader;
  - `components/comparison` is `'use client'` and imports `lib/comparison` as types only;
  - **mutation-checked**: planting a `@/lib/harness` import in `comparison.ts` failed the sweep, then it was
    reverted.
- `lib/artifact/repeats.test.ts` (8):
  - derivation;
  - each `buildRepeatRecord` refusal (another room, another competitor, the hero's run id, bad dropped counts);
  - each `checkRepeats` refusal (sum mismatch, unknown winner, outcome counted twice, flipped verdict, missing
    verdict, typical with no repeats);
  - `buildArtifact` enforces the check;
  - a schema round-trip.
- `lib/artifact/comparison.test.ts`: the committed canonical artifact produces the canonical comparison;
  typical and atypical artifacts disclose their counts.
- Updated tests:
  - `publish.test.ts`: the envelope key list; a new test that repeats are counts only, with no repeat run id and
    no `reason`;
  - `store.test.ts`: a hand-edited artifact is refused with `repeats_mismatch`;
  - `canonical.test.ts`: every committed artifact passes `checkRepeats`, and canonical is unrepeated;
  - `schema.test.ts`: unknown keys are refused inside `repeats` and inside an outcome; `OutcomeSchema` and
    `Outcome` agree at the type level.
- `lib/providers/secrets.test.ts`: `lib/comparison` added to `ARTIFACT_SIDE`.
- `e2e/run.spec.ts` (+3):
  - the results are hidden until the end, then show the full table and winner, and survive a restart;
  - Skip reveals them at once, with the heading focused, while the replay keeps playing;
  - the variance and limitation text is visible, with no `[title]`, `<details>` or tooltip anywhere in the results;
  - the existing no-foreign-requests test now also clicks Skip, so the revealed results are covered.
- `e2e/replay.spec.ts` (+1): `/replay` has no skip button and no results.

## Validation results

- `pnpm typecheck`: pass.
- `pnpm test`: **980 passed / 72 files**, up from 926 / 67 at baseline.
- `pnpm build`: pass. `/run/[id]` → `● /run/canonical` (SSG).
- `pnpm e2e`: **12 passed** (4.6 min): 5 `/replay` (4 existing + 1 new) and 7 `/run` (4 existing + 3 new).
- Visual check: `/run/canonical` → Skip → results screenshotted at 1280 px and 375 px. The table, the variance
  statement and the limitation all read in full, with no horizontal overflow at either width.
- Level 4:
  - `--canonical` into the scratchpad is byte-identical to `published/canonical.json`.
  - `runs/smoke-canonical-t7b` (a matchup with 0 repeats) → exit 0, `repeats 0 (+0 dropped)`.
  - `runs/spike/symbolic/1` (no matchup) → exit 0.
  - A synthetic matchup in the scratchpad (2 repeats, 1 dropped carrying a planted provider `reason`) → exit 0,
    with `repeats 2 (+1 dropped)`, a correct tally, and the planted text absent from the artifact.
  - The same directory with `typicalOfRepeats: false` → `nothing published: artifact: repeats_mismatch`, exit 1.
- Level 5: `lib/harness` appears in `lib/artifact`, `lib/comparison` and `components` only in comments. There are
  no `title=` attributes in `components/comparison`.

## Deviations from the plan

1. **Wording for a split with several rivals.** The plan's typical-split clause named one rival outcome. In a
   1–1–1 split there are two, and naming whichever sorts first ("Neither escaped just as often") understates the
   split. The clause now names a single rival, and says "Other outcomes came up just as often, so this is not a
   clear pattern" when there are two or more. Both cases are tested verbatim.
2. **The phrase is never capitalised when it starts with a model id.** At the start of a sentence, "they tied" and
   "neither escaped" are capitalised, but "competitor-a won" is left as the model id was recorded.
3. **The restart check is merged into the end-of-run e2e test** instead of being a fourth new test (see Issues).
4. **The Skip button focuses without scrolling, then scrolls separately** (`focus({ preventScroll: true })`, then
   `scrollIntoView`). This lets reduced motion pick `auto` over `smooth`. It moves focus only after a skip; a
   viewer who watched to the end keeps their place.
5. **Test helpers.** `summaryOf` / `repeatOf(hero, index, a, b)` / `withRepeats` in `lib/artifact/testing.ts` take
   action counts instead of summary arrays, mirroring the `run(a, b)` builder the typicality tests already use.
6. **A `/replay` e2e assertion was added** for the plan's "/replay unchanged" criterion. The plan listed it only
   under manual validation.

## Issues encountered

- **E2E timeouts under a long suite.** The first full run had 2 of 12 tests time out at 150 s. One of them was
  TICKET-9's pre-existing "plays the frozen artifact to its published end". Both are full playbacks running late
  in a 10-minute suite on software-rendered WebGL (SwiftShader), with browser processes loading the machine. Run
  alone, the same test passed in 1.2 minutes. The results section mounts only once revealed, so this ticket adds
  no per-frame work. The fix was to fold the restart check into the end-of-run test, which removes one full
  playback; the suite then has 3 full playbacks, against 2 before this ticket. If this recurs in CI, the follow-up
  is to raise `test.setTimeout` for playback tests, or to share a single playback between assertions.
- The uncommitted **TICKET-7 work** carried over onto this branch untouched, **and none of it is part of this
  ticket**. It is:
  - `docs/decisions/substrate.md`
  - `lib/providers/{index,transport,transport.test}.ts`
  - `scripts/spike-substrate.mts`
  - the untracked `AGENTS.md` / `CLAUDE.md`

  Keep all of it out of the TICKET-10 commit.
