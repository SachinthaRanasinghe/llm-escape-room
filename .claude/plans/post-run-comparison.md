# Feature: Post-run comparison and variance disclosure (TICKET-10, #10)

The following plan should be complete, but it's important that you validate documentation and codebase patterns and
task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files etc.

## Feature Description

When a published run (`/run/[id]`) finishes playing, the page reveals a **post-run comparison**: per model, escape
time, actions, puzzles solved, failed attempts, invalid actions, tokens and cost, with the winner (fewest actions to
escape) marked. Next to it, in plain full-width text and never in a tooltip, the page says:

1. **Whether the published hero run was typical of its silent repeats**, with the counts behind that answer ("the
   same room was re-run 3 more times without being shown, and competitor-a won in 2 of 3"), or plainly that it has
   not been checked.
2. **The nondeterminism limitation**: the room and rules are identical, but a model's choices are not reproducible,
   so one run is one sample.

A "Skip to results" control reveals the comparison without watching the whole run.

To state counts rather than a bare boolean, the published artifact gains a small **`repeats` block**: completed
repeats, dropped repeats, and a tally of their outcomes. `scripts/publish.mts` fills it from the harness's
`matchup.json` and the repeat run records.

## User Story

As a viewer who just watched two models race through a room,
I want to see how each model did side by side, and whether this result is what usually happens in this room,
So that I can judge the result on its merits and not dismiss it (or over-trust it) as a lucky sample.

## Problem Statement

The run page currently plays the replay and stops. The summaries (`run.summaries`) and the typicality verdict
(`run.typicalOfRepeats`) are inside the artifact but never shown. A bare `typicalOfRepeats: true` could not be
disclosed honestly anyway: "typical" means very different things after 1 repeat and after 5, and "not typical"
should say what usually happens instead. The PRD's open question "how many runs before a result means anything?"
and the architecture's publication-unit decision (one hero run plus silent repeats) both depend on this page being
honest about variance.

## Solution Statement

- **Move the pure outcome logic** (`outcomeOf`, `isTypical`) out of `lib/harness/typicality.ts` into a new pure
  module, `lib/comparison/outcome.ts`, and add tally-based helpers. `lib/artifact` is forbidden from importing
  `lib/harness` (`lib/artifact/boundary.test.ts:50`, "a re-run"), yet it needs the same definition of outcome to
  build and check the repeats block. `lib/harness/typicality.ts` becomes a re-export shim, so harness callers and
  tests are unchanged and there is still **one** definition of "outcome" and "typical".
- **Widen artifact v0 in place** with a required `repeats` block (`{ completed, dropped, outcomes: [{ outcome,
  count }] }`). Nothing but `published/canonical.json` exists at `ARTIFACT_VERSION = 0`, and that file is
  regenerated. `buildArtifact` takes the repeat `Run`s plus a dropped count and **derives** the block. A shared
  check refuses any artifact whose block disagrees with `run.typicalOfRepeats`, so the page can never state a count
  that contradicts the verdict. The new error reason is `repeats_mismatch`.
- **A pure view-model builder**, `buildComparison` in `lib/comparison/comparison.ts`, turns run + repeats + actions
  taken + puzzle count into `ComparisonData`: plain, serialisable rows, the result line, the variance statement and
  the limitation text. Every user-facing sentence is produced and unit-tested here, not in JSX.
- **The server page** computes `ComparisonData` through `comparisonFromArtifact` (in `lib/artifact`) and passes it
  as a plain prop to `ReplayPlayer`. The player reveals `<Comparison>` once `state === 'ended'` or once the viewer
  presses "Skip to results", and it stays revealed through restarts.
- `/replay`, the live preview, passes no `comparison` and is unchanged.

## Out of Scope / Non-Goals

- Not included: a comparison on `/replay` (the live renderer preview). The `comparison` prop is optional and
  `/replay` doesn't pass it.
- Not included: publishing the repeats' **logs** or replaying them. Only outcome counts are published.
- Not included: why a repeat was dropped. `DroppedRepeat.reason` is a redacted provider error message; only the
  **count** is published, so no provider text reaches the artifact.
- Not included: watch-through telemetry (TICKET-11), statistical confidence intervals, charts, or share images.
- Not changing: the definition of outcome and typical (`lib/harness/typicality.ts` semantics move verbatim), the
  beat plan, the render manifest, `ARTIFACT_VERSION`'s number, `Run`/`RunSummary` schemas, or the harness's
  matchup output format.
- Not changing: TICKET-7's uncommitted work (`docs/decisions/substrate.md`, `lib/providers/{index,transport,
  transport.test}.ts`, `scripts/spike-substrate.mts`). Keep it out of this ticket's commit.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**: `lib/artifact` (schema, publish, store), new `lib/comparison`, new
`components/comparison`, `components/scene/ReplayPlayer.tsx`, `app/run/[id]/page.tsx`, `scripts/publish.mts`,
`published/canonical.json`
**Dependencies**: none new (React 19.2, Next 16.3.2, Zod 4.6.5, vitest 4, Playwright 1.63, all already installed)

## Related Work

**Implements**: TICKET-10 — [#10](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/10)   ·   **Epic**:
`docs/tickets/llm-escape-room.md` (breakdown) + `architecture.md` (decisions) + `llm-escape-room.prd.md` (intent)

**Back-references**:

- `.claude/plans/published-artifact-v0.md`: TICKET-9. It defines the artifact envelope this plan widens, the
  "build by listing, never spreading" rule, the strict-schema and leak-scan discipline, and the server→client prop
  boundary. **It must be committed before this branch is cut.**
- `.claude/plans/run-harness.md`: TICKET-6. It defines `outcomeOf`/`isTypical` (moved here verbatim),
  `runMatchup`, and the `runs/<id>/{run,events,matchup}.json` + `repeats/<id>.run.json` layout `publish.mts` reads.
- `.claude/plans/replay-player-v0.md`: TICKET-8. It defines the player, the `usePlayback` state machine,
  `replay.module.css` tokens, and the "chrome stays restrained" motion rule.

**Forward-references**:

- (none yet) TICKET-11 (telemetry) will hook the same player. Its "completion" event could fire on the same
  `ended` transition this plan uses for the reveal.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` (around line 293) -
  Why: props from a server page to a client component must be React-serialisable. `ComparisonData` must be plain
  JSON (no class instances, no functions, no `Map`).
- `lib/harness/typicality.ts` (whole file, 52 lines) - Why: the logic you **move** into
  `lib/comparison/outcome.ts`, doc comment included. Keep its semantics exactly: outcome by fewest
  `escapeActionCount`, typical = in the mode, ties for mode count as typical.
- `lib/harness/typicality.test.ts` - Why: must keep passing unchanged against the shim; also the `summary()`/`run()`
  builder pattern to mirror in new tests.
- `lib/harness/index.ts:34-35` - Why: re-exports `outcomeOf`, `isTypical`, `Outcome`. These must keep working.
- `lib/harness/matchup.ts:43-50, 83-89` - Why: `MatchupResult`, `DroppedRepeat`, and where `typicalOfRepeats` is
  set. The artifact must reproduce the same verdict from the published tally.
- `scripts/run.mts:15-16, 156-166` - Why: the on-disk layout `publish.mts` reads:
  `repeats/<repeatRunId>.run.json`, `repeats/<repeatRunId>.events.json`, and `matchup.json` =
  `{ heroRunId, repeatRunIds, dropped: DroppedRepeat[], providerCalls }`.
- `lib/schema/run.ts` (whole file) - Why: `Run`, `RunSummary`, `END_REASONS`, and the `typicalOfRepeats` doc.
- `lib/schema/version.ts:36-43` - Why: `ARTIFACT_VERSION` doc. Add a note that v0 was widened in place (precedent:
  lines 16-18).
- `lib/artifact/schema.ts` (whole file) - Why: `z.strictObject` everywhere, `PublishedArtifactSchema`,
  `ARTIFACT_ERROR_REASONS`, `ArtifactError`.
- `lib/artifact/publish.ts` (whole file) - Why: `buildArtifact` lists every field. Add `repeats` by listing it, and
  keep the three validations (buildReplay → parseArtifact → findLeaks).
- `lib/artifact/store.ts:36-42` - Why: `loadArtifact`. Add the repeats consistency check here too, so a
  hand-edited file fails the build.
- `lib/artifact/replay.ts` - Why: pattern for a pure "artifact → what the page needs" function
  (`replayFromArtifact`), which `comparisonFromArtifact` mirrors.
- `lib/artifact/testing.ts` - Why: `canonicalInput()` must gain a default `repeats`.
- `lib/artifact/publish.test.ts:14` - Why: asserts the envelope's exact key list. Add `'repeats'`.
- `lib/artifact/boundary.test.ts:45-54` - Why: FORBIDDEN list. `lib/comparison` is **not** forbidden for
  `lib/artifact`; `lib/harness` is.
- `lib/artifact/canonical.test.ts` - Why: "every committed artifact parses and plays". Add the repeats check.
- `lib/replay/boundary.test.ts` (whole file) - Why: the sweep pattern to MIRROR for `lib/comparison/boundary.test.ts`.
- `lib/providers/secrets.test.ts:39` - Why: `ARTIFACT_SIDE`. Add `'lib/comparison'`. (`components` already covers
  `components/comparison`.)
- `lib/replay/labels.ts:59-66, 101-111` - Why: `END_LABEL` ("Out of actions" etc.) and `formatThink` (`'25.4 s'`).
  Reuse both; don't redefine them.
- `lib/replay/types.ts:73-84` - Why: `ReplayLane.label` is `competitor.modelId` (`lib/replay/timeline.ts:129`). The
  comparison uses the same label so names match the lane panels.
- `components/scene/ReplayPlayer.tsx` (whole file) - Why: where the reveal state and the `comparison` prop go.
- `components/scene/Controls.tsx` - Why: button markup and classes to mirror for "Skip to results".
- `components/scene/usePlayback.ts:30-38, 74-78` - Why: `PlaybackState` is `'playing' | 'paused' | 'ended'`;
  `restart` resets to `playing`.
- `components/scene/replay.module.css` (whole file) - Why: design tokens (`--bg`, `--surface`, `--text`, `--muted`,
  `--rule`, `--lane-a/b`, `--success`, `--failure`, `--fade`), the reduced-motion rule, and the 720px breakpoint.
  The comparison CSS reuses these variables, which cascade from `.root`.
- `app/run/[id]/page.tsx` (whole file) - Why: the server page to wire.
- `scripts/publish.mts` (whole file) - Why: CLI to extend; its error-handling and exit-code conventions.
- `e2e/run.spec.ts` (whole file) - Why: `freezeClock`/`advance` helpers and the frozen-plan timing pattern.
- `published/README.md` - Why: generated-artifact rules. Update its contents list.

### New Files to Create

- `lib/comparison/outcome.ts` - `Outcome`, `outcomeOf`, `isTypical` (moved), plus `outcomeKey`, `tallyOutcomes`,
  `typicalOf`
- `lib/comparison/outcome.test.ts` - tests for the new tally helpers
- `lib/comparison/comparison.ts` - `ComparisonData` types + `buildComparison` + formatters
- `lib/comparison/comparison.test.ts` - view-model and exact-sentence tests
- `lib/comparison/index.ts` - barrel
- `lib/comparison/boundary.test.ts` - purity sweep over `lib/comparison` and `components/comparison`
- `lib/artifact/repeats.ts` - `buildRepeatRecord` (derive + validate) and `checkRepeats` (consistency)
- `lib/artifact/repeats.test.ts`
- `lib/artifact/comparison.ts` - `comparisonFromArtifact(artifact): ComparisonData`
- `lib/artifact/comparison.test.ts`
- `components/comparison/Comparison.tsx` - the results section
- `components/comparison/comparison.module.css`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
  - Section: passing props from server to client ("Props passed to Client Components need to be serializable")
  - Why: `ComparisonData` crosses that boundary.
- [Zod 4 discriminated unions](https://zod.dev/api#discriminated-unions)
  - Why: `OutcomeSchema` is `z.discriminatedUnion('kind', [...])` of strict objects.
- [MDN `<table>` accessibility: `<caption>`, `scope`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/table#accessibility)
  - Why: the comparison is a real data table (metrics as rows, models as columns), not a div grid.
- [Playwright clock](https://playwright.dev/docs/clock)
  - Why: e2e reuses `install({ time: 0 })` + `pauseAt` + `runFor`.

### Patterns to Follow

**Naming Conventions:** camelCase functions, PascalCase types/components, `SCREAMING_SNAKE` const tables, kebab
file names are NOT used. Files are camelCase or single words (`typicality.ts`, `comparison.ts`). Test files sit
next to source as `*.test.ts`; e2e as `e2e/*.spec.ts`. `data-testid` is kebab-case with competitor-id suffixes
(`status-model-a`).

**Module doc comments:** every module opens with a `/** … */` block naming the ticket, `TICKET-10 (#10)`, and using
`── Heading ──` sub-sections to explain *why*. Match that density (see `lib/artifact/publish.ts:9-29`).

**Build by listing, never by spreading** (`lib/artifact/publish.ts:17-20`): every artifact field and every
`ComparisonRow` field is named explicitly. Never write `...summary` or `...run`.

**Absence is a value** (`lib/schema/run.ts:45`): nullable fields, not optional ones. `escapeMs: number | null`
renders as `—`.

**Errors:** machine-readable reason + detail:
```ts
throw new ArtifactError('repeats_mismatch', `repeat ${r.runId} played room ${r.roomId}, hero ${hero.roomId}`);
```
Add `'repeats_mismatch'` to `ARTIFACT_ERROR_REASONS` (`lib/artifact/schema.ts:156`).

**CLI failure** (`scripts/publish.mts:47-50, 137-141`): `fail(message, 1)` for bad input, `2` for usage errors;
`ArtifactError` is already caught into `nothing published: …`.

**Boundary sweeps** (`lib/replay/boundary.test.ts`): walk the source directories, exclude `*.test.ts` and
`testing.ts`, include a guard-the-guard test that the walk found the expected files, and assert FORBIDDEN regexes
per file.

**Client components** (`components/scene/*.tsx`): start with `'use client';`, import `styles from './x.module.css'`,
and only `import type` from `lib/*` modules that value-import schemas. (`lib/comparison` value-imports only
`lib/replay` labels, which is client-safe.)

**CSS** (`components/scene/replay.module.css:1-11`): restrained chrome, opacity-only transitions using `var(--fade)`,
system font stack, tabular numerals for numbers, and a `@media (max-width: 720px)` block. No
`text-overflow`/line-clamp on sentences.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation: one definition of outcome, reachable from `lib/artifact`

Move `outcomeOf`/`isTypical` to `lib/comparison/outcome.ts`, add tally helpers, and turn the harness file into a
re-export shim.

### Phase 2: Artifact contract: the `repeats` block

Schema, derivation and validation (`lib/artifact/repeats.ts`), `buildArtifact` input, the loader check, the CLI, and
regenerating `published/canonical.json`.

### Phase 3: View-model

**Depends on:** Phase 1 (outcome helpers). **Independent of:** Phase 2, except `comparisonFromArtifact`
(Task 13), which needs both.

`buildComparison` and every user-facing sentence, unit-tested.

### Phase 4: UI and integration

**Depends on:** Phases 2 and 3.

`Comparison.tsx`, the reveal and skip behaviour in `ReplayPlayer`, and wiring the server page.

### Phase 5: Proofs and docs

Boundary sweep, secrets sweep, e2e, and docs.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

**Pre-flight:** TICKET-9 must be committed first. Confirm with `git log --oneline -1` that the top commit is the
TICKET-9 feat commit, then `git switch -c feature/post-run-comparison` from `feature/published-artifact-v0`. If
TICKET-9 is still uncommitted, stop and ask the user (don't commit it yourself unasked). Run the baseline: `pnpm
typecheck && pnpm test`, and note the pass count (expected ~926).

### 1. CREATE `lib/comparison/outcome.ts`

- **IMPLEMENT**:
  - Move verbatim from `lib/harness/typicality.ts`: `Outcome` type, `outcomeOf(run)`, `isTypical(hero, repeats)`,
    and the doc comment. Retitle the doc comment "TICKET-6 (#7); moved here in TICKET-10 (#10) so `lib/artifact` can
    reach it without importing the harness".
  - ADD:
    ```ts
    export interface OutcomeCount { readonly outcome: Outcome; readonly count: number }
    /** Stable key: `winner:<id>` | `tie` | `none`. Exported (was private `keyOf`). */
    export function outcomeKey(outcome: Outcome): string
    /** Tally of repeat outcomes, ORDERED: count desc, then key asc, so the published array is deterministic. */
    export function tallyOutcomes(runs: readonly Run[]): OutcomeCount[]
    /** The tally-based form of `isTypical`. `null` when the tally is empty. */
    export function typicalOf(hero: Outcome, tally: readonly OutcomeCount[]): boolean | null
    ```
  - Reimplement `isTypical(hero, repeats)` as `typicalOf(outcomeOf(hero), tallyOutcomes(repeats))` so both forms
    agree by construction.
- **PATTERN**: `lib/harness/typicality.ts` (whole file)
- **IMPORTS**: `import type { Run } from '@/lib/schema/run';` only
- **GOTCHA**: Keep the tie-for-mode rule: when two outcomes share the top count, either counts as typical. Pure
  functions only: no `Date`, no `Math.random` (the boundary test in Task 17 enforces this).
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #2 (one definition of typical, reachable by the artifact)

### 2. REFACTOR `lib/harness/typicality.ts` → re-export shim

- **IMPLEMENT**: Replace the body with a short doc comment ("moved to `lib/comparison/outcome.ts` in TICKET-10;
  re-exported so harness callers are unchanged") plus
  `export { outcomeOf, isTypical, type Outcome } from '@/lib/comparison/outcome';`. Leave `lib/harness/index.ts`
  and `lib/harness/typicality.test.ts` **untouched**. The existing test is now the regression proof that the move
  changed nothing.
- **GOTCHA**: `lib/harness/boundary.test.ts` forbids env, clock and endpoints only. Importing `lib/comparison` is
  allowed. Run it.
- **VALIDATE**: `pnpm vitest run lib/harness`
- **SATISFIES**: AC #7 (no regression)

### 3. CREATE `lib/comparison/outcome.test.ts`

- **IMPLEMENT**: Mirror the `summary()`/`run()` builders from `lib/harness/typicality.test.ts:8-32`. Cases:
  - `tallyOutcomes([])` → `[]`.
  - `[A, A, B]` → `[{winner a, 2}, {winner b, 1}]`.
  - The ordering tie-break is by key (`[B, A]` → a first).
  - A mix of `tie` and `none` outcomes.
  - `typicalOf` agrees with `isTypical` on a table of cases, including the 1–1–1 split (typical) and 0 repeats
    (`null`).
  - `outcomeKey` round-trips for all three kinds.
- **VALIDATE**: `pnpm vitest run lib/comparison/outcome.test.ts`
- **SATISFIES**: AC #2

### 4. UPDATE `lib/artifact/schema.ts`: `OutcomeSchema`, `RepeatsSchema`, envelope field, error reason

- **IMPLEMENT**:
  ```ts
  export const OutcomeSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('winner'), competitorId: z.string().min(1) }),
    z.strictObject({ kind: z.literal('tie') }),
    z.strictObject({ kind: z.literal('none') }),
  ]);
  export const RepeatsSchema = z.strictObject({
    /** Silent repeats that finished — what `run.typicalOfRepeats` was judged on. */
    completed: z.number().int().nonnegative(),
    /** Repeats that stopped on a provider failure. Counted, never explained: the reason is provider text. */
    dropped: z.number().int().nonnegative(),
    /** `tallyOutcomes` order: count desc, then key. Sums to `completed`. */
    outcomes: z.array(z.strictObject({ outcome: OutcomeSchema, count: z.number().int().positive() })),
  });
  export type RepeatRecord = z.infer<typeof RepeatsSchema>;
  ```
  - Add `repeats: RepeatsSchema` to `PublishedArtifactSchema` **after `run`**. It's required, not optional:
    absence is a value (`{ completed: 0, dropped: 0, outcomes: [] }`).
  - Update the `run` field's doc comment to point at `repeats`.
  - Add `'repeats_mismatch'` to `ARTIFACT_ERROR_REASONS`.
  - Add a type-level assertion in `schema.test.ts` that `z.infer<typeof OutcomeSchema>` is assignable both ways
    with `Outcome` from `@/lib/comparison`, mirroring the existing type-agreement test there.
- **PATTERN**: `lib/artifact/schema.ts:44-59` (strict nested objects), `:156-162` (reasons)
- **GOTCHA**: Zod 4 `z.discriminatedUnion` accepts `z.strictObject` members. The "unknown key refused at six
  nesting levels" test in `schema.test.ts` should still pass; add one more level: an extra key inside
  `repeats.outcomes[0].outcome` is refused.
- **VALIDATE**: `pnpm typecheck` (expect `publish.ts` to fail until Task 6; that's fine), then
  `pnpm vitest run lib/artifact/schema.test.ts` after Task 6.
- **SATISFIES**: AC #2, AC #5

### 5. UPDATE `lib/schema/version.ts`: record the in-place widening

- **IMPLEMENT**: Append to the `ARTIFACT_VERSION` doc (lines 36-42): "TICKET-10 (#10) widened v0 in place with a
  required `repeats` block. Nothing but the regenerated `published/canonical.json` had been published at v0, so a
  bump would have migrated nothing." Leave the number at `0`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #8 (docs)

### 6. CREATE `lib/artifact/repeats.ts` + UPDATE `lib/artifact/publish.ts` + `lib/artifact/testing.ts`

- **IMPLEMENT** `repeats.ts`:
  ```ts
  export interface RepeatInput { readonly runs: readonly Run[]; readonly dropped: number }
  /** Derive the block from the repeat runs. Refuses repeats that are not the same matchup. */
  export function buildRepeatRecord(hero: Run, input: RepeatInput): RepeatRecord
  /** Refuse an artifact whose repeats block disagrees with itself or with `run.typicalOfRepeats`. */
  export function checkRepeats(artifact: Pick<PublishedArtifact, 'id' | 'run' | 'repeats'>): void
  ```
  - `buildRepeatRecord` throws `ArtifactError('repeats_mismatch', …)` when:
    - a repeat's `roomId` differs from the hero's;
    - a repeat's sorted competitor ids differ from the hero's;
    - a repeat's `runId` equals the hero's;
    - `dropped` is not a non-negative integer.
  - It returns `{ completed: runs.length, dropped, outcomes: tallyOutcomes(runs) }`, built by listing.
  - `checkRepeats` throws `repeats_mismatch` when:
    - `sum(counts) !== completed`;
    - any `winner.competitorId` isn't in `run.competitors`;
    - an outcome key repeats;
    - `typicalOf(outcomeOf(run), outcomes) !== run.typicalOfRepeats`. With 0 completed this requires `null`, which
      also catches "typical: true with no repeats".
  - Doc comment: a count that contradicts the verdict is the worst thing this page could show, so both the builder
    and the loader refuse it.
- **IMPLEMENT** `publish.ts`:
  - Add `readonly repeats: RepeatInput` to `BuildArtifactInput`.
  - In `buildArtifact`, compute `const repeats = buildRepeatRecord(run, input.repeats)`, list `repeats` in the
    `parseArtifact({...})` object after `run`, then call `checkRepeats(artifact)` right after `parseArtifact` and
    before `findLeaks`.
  - Update the "Validated three times" comment to "four".
- **IMPLEMENT** `testing.ts`:
  - `canonicalInput` defaults `repeats: { runs: [], dropped: 0 }`.
  - Add `export function repeatOf(hero: Run, index: number, summaries: Run['summaries']): Run`. It returns
    `{ ...hero, runId: \`${hero.runId}-r${index}\`, summaries, typicalOfRepeats: null }`. The spread is fine in
    test support.
  - Add `export function withRepeats(repeats: readonly Run[], dropped = 0): Partial<BuildArtifactInput>`. It sets
    the hero's `typicalOfRepeats` via `isTypical` from `@/lib/comparison`, so fixtures are consistent by
    construction.
- **PATTERN**: `lib/artifact/publish.ts:48-80`; `lib/artifact/testing.ts:10-20`
- **IMPORTS**: `repeats.ts`: `import { outcomeOf, tallyOutcomes, typicalOf } from '@/lib/comparison/outcome';`,
  `import type { Run } from '@/lib/schema/run';`, and `ArtifactError`, `type PublishedArtifact`,
  `type RepeatRecord` from `./schema`.
- **GOTCHA**: Import from `@/lib/comparison/outcome`, never `@/lib/harness`: `lib/artifact/boundary.test.ts:50`
  fails on any harness import. Export `buildRepeatRecord`, `checkRepeats`, `type RepeatInput`,
  `type RepeatRecord` and `RepeatsSchema` from `lib/artifact/index.ts`.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/artifact`. Expect only `publish.test.ts:14` (the envelope
  key list) and the canonical tests to fail; fix them in Tasks 7-9.
- **SATISFIES**: AC #2, AC #5

### 7. CREATE `lib/artifact/repeats.test.ts`

- **IMPLEMENT**:
  - `buildRepeatRecord`:
    - zero repeats → `{0,0,[]}`;
    - three repeats `[A,A,B]` → the ordered tally;
    - dropped is carried;
    - each of the mismatch cases (room, competitors, duplicate runId, `dropped: -1`, `dropped: 1.5`) →
      `ArtifactError` with `reason === 'repeats_mismatch'`.
  - `checkRepeats`:
    - passes on a `withRepeats` artifact;
    - refuses a sum mismatch, an unknown winner id, a duplicate outcome key, `typicalOfRepeats: true` with 0
      completed, and a flipped verdict (typical tally with `false`).
  - End-to-end: `buildArtifact(canonicalInput(withRepeats([...])))` round-trips through `parseArtifact`.
- **PATTERN**: `lib/artifact/publish.test.ts` refusal tests (`expect(() => …).toThrow(expect.objectContaining({ reason: '…' }))`, or
  whatever form that file uses; match it)
- **VALIDATE**: `pnpm vitest run lib/artifact/repeats.test.ts`
- **SATISFIES**: AC #2, AC #5

### 8. UPDATE `lib/artifact/store.ts`, `lib/artifact/publish.test.ts`, `lib/artifact/canonical.test.ts`

- **IMPLEMENT**:
  - `store.ts` `loadArtifact`: after the id check, call `checkRepeats(artifact)`. Add a line to its doc comment.
  - `publish.test.ts:14`: add `'repeats'` to the sorted key list. Add a test that `artifact.repeats` holds no
    provider text: build with `dropped: 2` and assert the JSON has no `reason` key.
  - `canonical.test.ts`: for every committed artifact, `checkRepeats` doesn't throw. For `canonical`,
    `repeats` deep-equals `{ completed: 0, dropped: 0, outcomes: [] }`.
  - `store.test.ts`: add a case where a temp-dir artifact with an inconsistent `repeats` fails `loadArtifact` with
    `repeats_mismatch`. Mirror that file's existing temp-dir pattern.
- **VALIDATE**: `pnpm vitest run lib/artifact` (canonical fails until Task 10)
- **SATISFIES**: AC #5

### 9. UPDATE `scripts/publish.mts`: read the matchup

- **IMPLEMENT** in `inputFromRun`:
  - If `<runDir>/matchup.json` exists:
    - parse it and check it's an object whose `heroRunId === run.runId`, `repeatRunIds: string[]` and
      `dropped: unknown[]`;
    - on a bad shape, `fail('<runDir>/matchup.json is malformed: …', 1)`;
    - for each id, `parseRun(readJson(join(runDir, 'repeats', \`${id}.run.json\`)))`, with a missing file failing
      at code 1 naming the id;
    - `repeats = { runs, dropped: matchup.dropped.length }`.
  - If there's no `matchup.json` (older run directories, e.g. `runs/spike/*`), use `repeats = { runs: [],
    dropped: 0 }`. `checkRepeats` then refuses the publish if `run.typicalOfRepeats !== null`, which is correct.
  - `--canonical`: `repeats: { runs: [], dropped: 0 }`.
  - Print `repeats <completed> (+<dropped> dropped)` in the success line.
  - Update the header comment (lines 8-12) to say `matchup.json` and `repeats/` are read when present.
- **GOTCHA**: never print `dropped[].reason`. `DroppedRepeat.reason` is provider error text. Read only `.length`.
- **VALIDATE**:
  - `node --import tsx scripts/publish.mts --run runs/smoke-canonical-t7b --room fixtures/rooms/valid/canonical-room.json --out "$SCRATCH" --id smoke-t10`
    (its matchup has 0 repeats) → exit 0. Here `$SCRATCH` is the session scratchpad; never write to `published/`.
  - `node --import tsx scripts/publish.mts --run runs/spike/symbolic/1 --room runs/spike/symbolic/1/room.json --out "$SCRATCH"`
    → exit 0 (no matchup).
- **SATISFIES**: AC #2

### 10. REGENERATE `published/canonical.json`

- **IMPLEMENT**: `node --import tsx scripts/publish.mts --canonical --force`. The only diff is a new `"repeats":
  {"completed": 0, "dropped": 0, "outcomes": []}` after `run`. Check with `git diff --stat published/`.
- **VALIDATE**: `pnpm vitest run lib/artifact lib/providers/secrets.test.ts`, all green; `freeze.test.ts` still
  deep-equal.
- **SATISFIES**: AC #5, AC #7

### 11. CREATE `lib/comparison/comparison.ts`: view-model and every sentence

- **IMPLEMENT** types (all `readonly`, all plain JSON):
  ```ts
  export interface ComparisonRow {
    competitorId: string; label: string; provider: Provider;
    escaped: boolean; isWinner: boolean;
    result: string;            // 'Escaped in 13 actions' | END_LABEL[endedBecause]
    escapeTime: string;        // formatThink(escapeMs) | '—'
    actions: string;           // '13 / 14' (actionsTaken / budget.maxActions)
    puzzles: string;           // '3 of 3'
    failedAttempts: number; invalidActions: number;
    tokens: string;            // '22,151'
    tokensDetail: string;      // '21,580 in · 571 out'
    cost: string;              // '$0.00' | '<$0.01' | '$0.12'
  }
  export type VarianceKind = 'unrepeated' | 'all_dropped' | 'typical' | 'atypical';
  export interface ComparisonData {
    rows: readonly ComparisonRow[];
    headline: string;
    variance: { kind: VarianceKind; title: string; body: string };
    limitation: string;
    escapeTimeNote: string;
  }
  export interface ComparisonInput {
    run: Run; repeats: { completed: number; dropped: number; outcomes: readonly OutcomeCount[] };
    actionsTaken: Readonly<Record<string, number>>; puzzleCount: number;
  }
  export function buildComparison(input: ComparisonInput): ComparisonData
  ```
- **Exact strings** (tests assert them verbatim; `n` = completed, `d` = dropped, `k` = hero-outcome count, `m` = the
  top count, `plural(n,'time')`):
  - Outcome phrase: `winner` → `` `${label} won` ``; `tie` → `'they tied'`; `none` → `'neither escaped'`.
  - `headline`:
    - winner → `` `${label} wins — escaped in ${a} actions` ``;
    - tie → `` `A tie — both escaped in ${a} actions` ``;
    - none → `'Neither model escaped'`.
  - `variance`:
    - `unrepeated` (`n=0,d=0`): title `'Not checked for luck'`, body
      `'This room has not been re-run yet, so there is no telling whether this result is typical. Treat it as one sample.'`
    - `all_dropped` (`n=0,d>0`): title `'Not checked for luck'`, body
      `` `All ${d} silent re-run${s} of this room stopped on a provider error, so there is no telling whether this result is typical. Treat it as one sample.` ``
    - `typical`: title `'Typical of its silent repeats'`, body
      `` `The same room was re-run ${n} more ${time(s)} without being shown, and ${heroPhrase} in ${k} of ${n}.` ``
      If another outcome also has count `m`, append
      `` ` ${otherPhrase[0] capitalised} just as often, so this is not a clear pattern.` ``
    - `atypical`: title `'Not typical of its silent repeats'`, body
      `` `The same room was re-run ${n} more ${time(s)} without being shown. ${HeroPhrase} in ${k} of ${n}; ${modePhrase} in ${m} of ${n}.` ``
    - For both `typical` and `atypical`, when `d>0` append
      `` ` ${d} more re-run${s} stopped on a provider error and ${d===1?'is':'are'} not counted.` ``
  - `limitation`:
    `'Models are nondeterministic. The room, the rules and the action budget are identical for both models, but the same model in the same room can choose differently on another run — one run is one sample, not a verdict.'`
  - `escapeTimeNote`:
    `'Escape time is each model’s total think-time as measured through its provider, so it depends on the serving stack as well as the model. The winner is decided by actions.'`
- **Rules**:
  - `isWinner` comes from `outcomeOf(run)`, never from `escapeMs`.
  - Rows follow `run.competitors` order, looking up the summary by `competitorId`. A missing summary throws
    `RangeError`: an artifact that parsed should never hit that.
  - `variance.kind` must agree with `run.typicalOfRepeats` (`true` → typical, `false` → atypical, `null` →
    unrepeated or all_dropped). Throw if it doesn't; it's a programming error, since `checkRepeats` has run.
  - Numbers use `toLocaleString('en-US')` explicitly, so the output is identical on server and in tests.
  - `cost`: `0` → `'$0.00'`; `>0 && <0.005` → `'<$0.01'`; otherwise `` `$${c.toFixed(2)}` ``.
- **PATTERN**: `lib/replay/labels.ts` (label tables + `formatThink`); build by listing
- **IMPORTS**: `import { END_LABEL, formatThink } from '@/lib/replay';` (a value import from the client-safe
  barrel); `import type { Provider, Run } from '@/lib/schema/run';`;
  `import { outcomeKey, outcomeOf, type Outcome, type OutcomeCount } from './outcome';`
- **GOTCHA**: The canonical fixture has **a 14-action budget and a 13-action escape for model-a**. model-b took
  14 actions (log count) and ended `budget_actions`. So "Actions" for a non-escaper comes from `actionsTaken`, not
  from `escapeActionCount`, which is `null`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1, AC #2, AC #3

### 12. CREATE `lib/comparison/comparison.test.ts` + `lib/comparison/index.ts`

- **IMPLEMENT** barrel: export `buildComparison`, the types, and the outcome helpers.
- **IMPLEMENT** tests:
  - **Canonical run** (from `loadCanonicalRun()`, `actionsTaken {model-a:13, model-b:14}`, `puzzleCount 3`,
    `repeats {0,0,[]}`):
    - model-a row: `result 'Escaped in 13 actions'`, `escapeTime '25.4 s'`, `actions '13 / 14'`,
      `puzzles '3 of 3'`, `tokens '22,151'`, `tokensDetail '21,580 in · 571 out'`, `cost '$0.00'`,
      `isWinner true`;
    - model-b row: `result 'Out of actions'`, `escapeTime '—'`, `actions '14 / 14'`, `puzzles '2 of 3'`,
      `failedAttempts 2`, `invalidActions 1`, `tokens '24,846'`, `isWinner false`;
    - `headline 'competitor-a wins — escaped in 13 actions'`;
    - `variance.kind 'unrepeated'` with its exact body;
    - `limitation` exact.
  - **Every variance branch** with exact bodies:
    - typical 2 of 3;
    - typical 1–1–1 split (the "just as often" clause);
    - atypical 0 of 3 against a mode of 3;
    - dropped suffix, singular and plural;
    - `all_dropped`;
    - `n=1` singular "1 more time".
  - Tie headline, none headline, cost formatting cases (`0`, `0.001`, `0.123`).
  - **Disagreement throws**: `typicalOfRepeats true` with a tally where the hero isn't the mode.
  - **Serialisable**: `JSON.parse(JSON.stringify(data))` deep-equals `data`.
  - **No leaks**: `findLeaks(JSON.stringify(data))` is empty. Importing `findLeaks` from `@/lib/artifact/scan`
    in a test is fine.
- **PATTERN**: `lib/replay/labels.test.ts`, `lib/harness/typicality.test.ts:8-32`
- **VALIDATE**: `pnpm vitest run lib/comparison`
- **SATISFIES**: AC #1, AC #2, AC #3

### 13. CREATE `lib/artifact/comparison.ts` + test

- **IMPLEMENT**:
  - `comparisonFromArtifact(artifact: PublishedArtifact): ComparisonData`. It computes `actionsTaken` by counting
    `artifact.log` events per `competitorId` (every event is one attempted action, invalid ones included, per
    `architecture.md`), and `puzzleCount = Object.keys(artifact.manifest.layout.puzzleTargets).length`.
  - It calls `buildComparison({ run, repeats: artifact.repeats, actionsTaken, puzzleCount })`.
  - Export it from `lib/artifact/index.ts`.
  - Test: `comparisonFromArtifact(loadArtifact('canonical'))` matches the canonical expectations from Task 12.
    A `withRepeats` artifact yields `typical`/`atypical` as built.
- **PATTERN**: `lib/artifact/replay.ts` (artifact → page input)
- **GOTCHA**: Only `artifact.*` is read, never `CURRENT_RENDERER`, the fixtures or the room.
  `boundary.test.ts`'s first sweep covers this file automatically.
- **VALIDATE**: `pnpm vitest run lib/artifact/comparison.test.ts lib/artifact/boundary.test.ts`
- **SATISFIES**: AC #1, AC #2

### 14. CREATE `components/comparison/Comparison.tsx` + `comparison.module.css`

- **IMPLEMENT** (`'use client';`, props `{ data: ComparisonData; headingRef?: RefObject<HTMLHeadingElement | null> }`):
  ```
  <section className={styles.results} data-testid="results" aria-labelledby="results-heading">
    <h2 id="results-heading" ref={headingRef} tabIndex={-1}>{data.headline}</h2>
    <table className={styles.table}>
      <caption className={styles.caption}>How each model did</caption>
      <thead><tr><th scope="col">Metric</th>{rows.map(r => <th scope="col" className={lane class}>{r.label}{r.isWinner && <span data-testid="winner"> · winner</span>}</th>)}</tr></thead>
      <tbody> one <tr> per metric: Result, Escape time, Actions, Puzzles solved, Failed attempts,
              Invalid actions, Tokens (value + small tokensDetail), Cost.
              Each cell: data-testid={`cell-${metricKey}-${competitorId}`}. </tbody>
    </table>
    <p className={styles.note}>{data.escapeTimeNote}</p>
    <div className={styles.variance} data-testid="variance" data-kind={data.variance.kind}>
      <h3>{data.variance.title}</h3><p>{data.variance.body}</p>
    </div>
    <p className={styles.limitation} data-testid="limitation">{data.limitation}</p>
  </section>
  ```
  - Lane colours: the column header `<th>` uses the `--lane-a/--lane-b` variables inherited from the player's
    `.root` (colour the text or a 3px top border, as in `.panel`).
  - The variance block is **body-size text, full width, above the fold of the results section**, with a
    left rule in `--muted` (typical/unrepeated) or `--failure` (atypical/all_dropped). No `title=` attributes, no
    tooltips, no disclosure widget.
  - Fade in with `animation: fadeIn var(--fade)` (opacity only); define the `@keyframes` locally.
  - At the 720px breakpoint: 16px padding, and the table stays two model columns (it's only 3 columns wide).
- **PATTERN**: `components/scene/LanePanel.tsx` (markup/testids), `components/scene/replay.module.css` (tokens,
  breakpoint, reduced motion)
- **IMPORTS**: `import type { ComparisonData } from '@/lib/comparison';` (**type-only**), `type RefObject` from
  react, `styles`
- **GOTCHA**:
  - `ComparisonData` is the only input: no `Run`, no artifact.
  - No `text-overflow`/line-clamp on the variance or limitation text: honesty text is never truncated.
  - Use `max-width: 70ch` for readable measure.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #4

### 15. UPDATE `components/scene/ReplayPlayer.tsx`: reveal and skip

- **IMPLEMENT**:
  - Props: add `readonly comparison?: ComparisonData` (type import from `@/lib/comparison`).
  - State: `const [skipped, setSkipped] = useState(false); const revealed = comparison !== undefined && (state === 'ended' || skipped);`.
    Once revealed, keep it revealed: track `const [shown, setShown] = useState(false)` and set it in an effect when
    `revealed` first becomes true, so pressing Restart after the end doesn't hide the results again. Render when
    `shown`.
  - Header: when `comparison && !shown`, render a third button beside `<Controls>`:
    `<button type="button" className={styles.button} onClick={skip} data-testid="skip-to-results">Skip to results</button>`.
    `skip` sets `skipped`, then focuses the results heading (via `headingRef`) after render with
    `requestAnimationFrame(() => headingRef.current?.focus())`, then calls
    `headingRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })`.
  - Render `{shown && comparison && <Comparison data={comparison} headingRef={headingRef} />}` **after** the
    `.stage` div, inside `<main>`.
  - Update the doc comment: `/run/[id]` also passes the comparison, revealed at the end or on skip, so the result
    is never spoiled before the viewer chooses to see it.
- **GOTCHA**:
  - `lib/replay/boundary.test.ts` sweeps `components/scene`: no `Date.now`, no `performance.now`, no fetch. Only
    `requestAnimationFrame` is used here, and it isn't forbidden.
  - The `lib/artifact` boundary forbids `components/**` importing `lib/artifact`, so import `ComparisonData`
    from `@/lib/comparison`, never from `@/lib/artifact`.
  - `/replay` passes no `comparison`, so its UI must be pixel-identical to before: no skip button.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/replay/boundary.test.ts lib/artifact/boundary.test.ts`
- **SATISFIES**: AC #1, AC #4

### 16. UPDATE `app/run/[id]/page.tsx`

- **IMPLEMENT**: `const artifact = load(id); const { data, renderer } = replayFromArtifact(artifact); const comparison = comparisonFromArtifact(artifact);`
  then `<ReplayPlayer data={data} renderer={renderer} comparison={comparison} />`. Import `comparisonFromArtifact`
  from `@/lib/artifact`. Add one paragraph to the doc comment: the comparison is computed at build time from the
  artifact's run and repeats block, and handed down as plain strings.
- **VALIDATE**: `pnpm build`. Expect `● /run/canonical` (SSG) and no errors.
- **SATISFIES**: AC #1

### 17. CREATE `lib/comparison/boundary.test.ts` + UPDATE `lib/providers/secrets.test.ts`

- **IMPLEMENT** the sweep over `lib/comparison` + `components/comparison`, mirroring `lib/replay/boundary.test.ts`:
  - Guard-the-guard: the walk finds `lib/comparison/outcome.ts`, `lib/comparison/comparison.ts` and
    `components/comparison/Comparison.tsx`.
  - FORBIDDEN in every file:
    - `process.env`, `fetch(`, `https?://`, `node:http(s)`;
    - `Math.random`, `Date.now`, `performance.now`;
    - `@/fixtures`;
    - provider, sim, harness, generator or artifact imports;
    - `node:fs`.
  - Every `components/comparison/*.tsx` starts with `'use client'`.
  - `components/comparison` imports from `@/lib/comparison` only with `import type` (regex like
    `ROOM_VALUE_IMPORT`).
  - `secrets.test.ts:39`: add `'lib/comparison'` to `ARTIFACT_SIDE`.
- **VALIDATE**: `pnpm vitest run lib/comparison/boundary.test.ts lib/providers/secrets.test.ts`
- **SATISFIES**: AC #6

### 18. UPDATE `e2e/run.spec.ts`: the page, in a browser

- **IMPLEMENT** new tests (reuse `freezeClock`/`advance` and `plan` from the artifact):
  1. **Hidden until the end, then revealed.**
     - After `goto` + `advance(introMs + 100)`, `results` has count 0 and `skip-to-results` is visible.
     - After `advance(plan.totalMs)`:
       - `results` is visible;
       - `cell-result-model-a` has text `Escaped in 13 actions`;
       - `cell-result-model-b` has text `Out of actions`;
       - `cell-invalid-model-b` has text `1`;
       - `winner` is inside the model-a header;
       - `skip-to-results` has count 0.
  2. **Skip reveals immediately.**
     - Click `skip-to-results` at ~2 s in; `results` is visible;
     - `results-heading` (h2) is focused;
     - the replay keeps playing (`data-state` is still `playing`).
  3. **Honesty text is on the page, not in a tooltip.**
     - `variance` has `data-kind="unrepeated"` and visible text containing `Not checked for luck` and
       `Treat it as one sample.`;
     - `limitation` is visible and contains `Models are nondeterministic`;
     - neither element nor any descendant has a `title` attribute (`locator('[title]')` count 0 inside `results`).
  4. **Restart after the end keeps the results.**
     - Play to the end, click `restart`: `results` is still visible.
- Extend the existing "no request beyond its own origin" test with a click on `skip-to-results`, so the revealed
  table is covered by the network assertion.
- **GOTCHA**: `workers: 1` stays (`playwright.config.ts:17-20`). Keep each playback test at
  `test.setTimeout(150_000)` like the existing ones. Time comes from `plan`, never from `lib/replay/beats.ts`.
- **VALIDATE**: `pnpm e2e`. All `/replay` and `/run` specs pass (8 existing + 4 new).
- **SATISFIES**: AC #1, AC #2, AC #3, AC #4

### 19. UPDATE docs

- **IMPLEMENT**:
  - `published/README.md`: add `repeats` (outcome counts of silent repeats; never the repeat logs, never why a
    repeat dropped) to the list of what a file holds. Add that `scripts/publish.mts` reads `matchup.json` and
    `repeats/*.run.json` when present.
  - `README.md`: one line in the run-page section saying it ends with the comparison and variance disclosure.
  - `lib/schema/migrations/README.md`: the published-artifacts paragraph notes that `repeats` doesn't embed runs,
    so a v1 migration leaves it alone.
  - `docs/tickets/llm-escape-room.md`: leave it alone (not a status tracker).
- **VALIDATE**: `git diff --stat`, docs only
- **SATISFIES**: AC #8

---

## TESTING STRATEGY

### Unit Tests (vitest, `*.test.ts` beside source)

- `lib/comparison/outcome.test.ts`: tally ordering, tally/boolean agreement, mode ties.
- `lib/harness/typicality.test.ts`: **unchanged**, proving the move changed nothing.
- `lib/comparison/comparison.test.ts`: every row field for canonical, and every variance sentence verbatim,
  serialisability and no leaks.
- `lib/artifact/repeats.test.ts`: derivation and every refusal.
- `lib/artifact/{publish,store,canonical,schema,comparison}.test.ts`: envelope key list, loader refusal, committed
  artifact consistency, deeper strictness, and artifact → comparison.
- `lib/comparison/boundary.test.ts`: purity and the client import boundary.

### Integration Tests

- `pnpm build`: SSG of `/run/canonical` runs `loadArtifact` → `checkRepeats` → `comparisonFromArtifact` at build
  time. A bad artifact fails the build.
- `e2e/run.spec.ts`: reveal timing, skip, focus, honesty text visible, no tooltip, no foreign requests.
- CLI manual runs (Task 9) against real `runs/` directories, with and without `matchup.json`.

### Edge Cases

- 0 repeats (canonical): "Not checked for luck", table still shown.
- All repeats dropped: `all_dropped` sentence, with the dropped count.
- One repeat: singular grammar ("1 more time", "in 1 of 1").
- A 1–1–1 split: typical, with the "not a clear pattern" clause.
- Hero atypical, with hero count 0 ("in 0 of 3").
- A tie hero and a none hero: headline and phrases.
- A non-escaper: escape time `—`, actions from the log count.
- Non-zero tiny cost: `<$0.01`.
- An inconsistent hand-edited artifact: build fails with `repeats_mismatch`.
- A repeat from a different room or competitor set: publish refused.
- `/replay` with no comparison: no skip button, no results.
- Restart after reveal: results stay.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

- `pnpm typecheck`

(No linter is configured in `package.json`. Don't add one.)

### Level 2: Unit Tests

- `pnpm vitest run lib/comparison lib/artifact lib/harness`
- `pnpm test` (full suite; expect baseline ~926 + new, 0 failures)

### Level 3: Integration Tests

- `pnpm build` (expect `● /run/canonical`)
- `pnpm e2e`

### Level 4: Manual Validation

- `node --import tsx scripts/publish.mts --canonical --out "$SCRATCH" --force`, then diff against
  `published/canonical.json` (must be identical: determinism).
- `node --import tsx scripts/publish.mts --run runs/smoke-canonical-t7b --room fixtures/rooms/valid/canonical-room.json --out "$SCRATCH" --id smoke-t10`
  → exit 0, success line shows `repeats 0 (+0 dropped)`.
- Hand-edit a scratch copy of the artifact to `"typicalOfRepeats": true`, then run
  `node --import tsx -e "import('./lib/artifact/index.ts').then(m => m.loadArtifact('smoke-t10', process.argv[1]))" "$SCRATCH"`
  → throws `repeats_mismatch`.
- `pnpm dev`, then open `/run/canonical`: press "Skip to results", read the table and the variance and
  limitation text at desktop width and at 375px width, and check `/replay` shows no skip button.

### Level 5: Additional Validation (Optional)

- `grep -rn "lib/harness" lib/artifact lib/comparison components` → no matches outside comments.
- `grep -rn "title=" components/comparison` → none.

---

## ACCEPTANCE CRITERIA

1. [ ] `/run/[id]` shows, per model, escape time, actions, puzzles solved, failed attempts, invalid actions, tokens
   and cost, with the winner marked by fewest actions.
2. [ ] The page states in plain text whether the hero run was typical of its silent repeats, **with the counts**
   (completed, dropped, and how often the hero's outcome and the most common outcome occurred), or plainly that
   it hasn't been checked.
3. [ ] The nondeterminism limitation is stated on the page, along with what escape time actually measures.
4. [ ] None of that text is in a tooltip, title attribute or collapsed widget. It is revealed at the end of
   playback or via "Skip to results", and stays shown after a restart.
5. [ ] The artifact carries a strict, required `repeats` block. `buildArtifact` derives it, and both the builder
   and the loader refuse any block that disagrees with `run.typicalOfRepeats`. `published/canonical.json` is
   regenerated with it.
6. [ ] Boundaries hold: `lib/artifact` doesn't import `lib/harness`; `components/**` doesn't import `lib/artifact`;
   `lib/comparison` and `components/comparison` are pure and client-safe; no provider text reaches the artifact.
7. [ ] `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm e2e` all pass. `lib/harness/typicality.test.ts` passes
   unchanged. `/replay` is unchanged.
8. [ ] Docs updated: `published/README.md`, `README.md`, `lib/schema/version.ts`,
   `lib/schema/migrations/README.md`.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No type errors
- [ ] Manual testing confirms feature works (desktop + 375px, skip + natural end)
- [ ] Acceptance criteria all met
- [ ] TICKET-7's uncommitted files left out of this ticket's commit

---

## OPEN QUESTIONS / ASSUMPTIONS

The user accepted all four defaults from the clarifying round (2026-09-25):

1. **Carry counts in the artifact**, via the `repeats` block. It widens `ARTIFACT_VERSION` 0 in place rather than
   bumping. This is safe because only `published/canonical.json` exists at v0 and it's regenerated. If someone has
   published another artifact locally, `/run/<that-id>` fails the build until it's re-published with `--force`.
2. **Reveal at the end or on skip.** The table, variance statement and limitation appear together, and stay shown
   after restart.
3. **Escape time** shows `escapeMs` (summed provider latency) with an explicit note. The winner is ranked by actions
   via `outcomeOf`.
4. **Scope and branch:** only `/run/[id]`. The canonical artifact ships the `unrepeated` state; typical and atypical
   are proven in unit tests. The work goes on `feature/post-run-comparison`, cut from a **committed**
   `feature/published-artifact-v0`.

Remaining assumptions (confirm only if they bother you):

- The limitation and variance sentences above are the copy. They're tested verbatim, so any wording change is a
  one-file edit in `lib/comparison/comparison.ts` plus its test.
- A repeat is valid if it has the same room and the same competitor ids as the hero. Comparing sampling params or
  budget isn't enforced; the harness already guarantees they match.

## NOTES (open canvas)

**Why move outcome logic instead of duplicating it or loosening the boundary.** `lib/artifact` must not import
`lib/harness`. That rule stops the published side from ever re-running anything, and the harness barrel pulls in
provider types. Duplicating `outcomeOf` would create two definitions of "who won" that could drift, and the whole
disclosure depends on the page and the harness agreeing. Moving it to a neutral pure module, with a shim left
behind, keeps one definition and all three boundaries intact. `lib/comparison` is the natural home because it's
the module whose job is to explain outcomes.

**Why the block is derived and re-checked, not just copied.** The failure this ticket exists to prevent is the page
saying something the data doesn't support. If `publish.mts` copied a tally that disagreed with
`typicalOfRepeats`, the page would say "Typical… won in 1 of 3; the other model won in 2 of 3". So `buildArtifact`
derives the tally from the actual repeat runs, and both build and load re-check it against the verdict.

**Why view-model strings are built in `lib/`, not JSX.** Every honesty sentence gets a verbatim unit test in the node
environment, and it can be leak-scanned. The component only lays out strings. That also keeps the client bundle
free of schema value imports.

**Why the table is metrics-as-rows.** Two models means three columns, which fits at 375px without horizontal
scroll. Models-as-rows would need eight columns.

**Rejected:**
- An always-visible table: it spoils the race, and the PRD's bet is watch-through.
- A tooltip on the "typical" badge: explicitly banned by the ticket.
- Publishing repeat logs: it bloats the artifact and increases leak surface for no page need.
- Ranking by `escapeMs`: it contradicts `typicality.ts`'s reasoning and would make the table disagree with the
  variance statement.

**Sequencing risk.** Task 4 breaks `publish.ts`'s typecheck until Task 6. Do Tasks 4–6 in one sitting. Task 10 must
run after Task 9, or the committed JSON drifts from the CLI.

## AMENDMENTS

