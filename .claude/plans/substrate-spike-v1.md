# Feature: TICKET-7 — GATE: substrate divergence spike + quota, then pin schemas to v1

The following plan should be complete, but it's important that you validate documentation and codebase patterns and
task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files etc.

**This plan has two parts separated by a HUMAN CHECKPOINT.** Execute Part A, run the spike, draft the decision
record, then **STOP and hand back to the user**. Part B (v1 promotion) runs only after the user has read the
decision record and confirmed that a substrate was adopted. If no substrate clears the rule, Part B does not run
and the ticket closes on the decision record alone. That is a successful outcome for this ticket (issue #8).

## Feature Description

This ticket makes three changes, in order:

1. **It makes live numbers trustworthy.**
   - Competitors today cannot learn object ids past the opening message, or the final puzzle's id. The simulator
     is fixed so they can.
   - The two default Groq models have been retired from, or restricted on, the free tier. Both defaults are
     replaced.
2. **It runs the spike.**
   - Two new generator strategies, `spatial` and `mixed`, sit behind TICKET-5's `--strategy` flag. `spatial`
     needs a new `key` puzzle kind through schema, solver, simulator and generator.
   - A resumable live runner plays about 20 rooms per strategy, headless.
   - A pure analysis module applies the decision rule and extrapolates free-tier quota.
   - A decision record is drafted from the numbers.
3. **It pins the one-way doors (Part B).**
   - `RoomSpec` and `Event` move from v0 to v1 through `lib/schema/migrations/`.
   - The fixtures are regenerated.
   - The spike-derived constants are retuned.

## User Story

As the solo builder of LLM Escape Room
I want to measure which puzzle substrate makes two models diverge, and whether a full matchup fits free-tier quota
So that I either lock the schemas on evidence and build the watchable product on top, or learn cheaply that the
format fails.

## Problem Statement

`architecture.md` → *Spikes 1 and 2* name divergence as the make-or-break unknown. The PRD's metric is
**≥60% of runs where outcomes differ meaningfully**. The substrate was left undecided, and `RoomSpec`/`Event`
were shipped as unpinned v0 until this spike reports. Three problems block honest numbers today:

- **Hidden ids.** Models can't see object ids after the opening message, or puzzle ids at all. See
  `.claude/reports/run-harness-report.md` → *Issues encountered*. `invalidActions` would then measure id-guessing,
  not reasoning.
- **Retired models.** `llama-3.1-8b-instant` was shut down on Groq on 2026-08-16. Groq's models page now marks
  both Llama models as Enterprise, and the free-plan rate-limit table no longer lists them.
- **Only one substrate.** `symbolic` is the only strategy, and the solver cannot certify a key-lock link as a
  puzzle: `structure.ts:154` rejects a `code` puzzle whose target has a key lock, and there is no other kind.

## Solution Statement

- **Simulator.** Echo ids in the `look` and `open` text. On `inspect` of an `answer` puzzle's clue object or its
  target, name the puzzle id. Ids are not secret; answers are.
- **Models.** Switch the Groq defaults to `openai/gpt-oss-120b` vs `openai/gpt-oss-20b`. They are production
  models, on the free plan, share one serving stack, and have identical limits. The generation model stays
  `gemini-flash-latest`, on a separate quota.
- **`key` puzzle kind.** Add it to the still-unpinned v0 `PuzzleSchema`.
  - `answer` = the key item's id.
  - `unlocksObjectId` holds `{opensWith:'key', keyItemId: answer}`.
  - `clueObjectId` = the key itself, or an object that transitively contains it.
  - The puzzle is solved by `use`, which `lib/sim/resolve.ts` already handles.
  - Solver: `structure.ts` checks lock agreement, `derivation.ts` checks the key is findable, and the oracle
    `take`s and `use`s the key without needing an `inspect`.
- **Strategies.**
  - `spatial`: every link is a key link and the door is key-locked. There are decoy keys and nesting.
  - `mixed`: seeded code or key links, then a final `answer` link.
  - `symbolic`: unchanged in behaviour. Its brief gains `linkKinds`.
- **`lib/spike/`** (pure, tested):
  - `divergence.ts`: the per-instance rule.
  - `decide.ts`: the per-strategy verdict against ≥60%.
  - `quota.ts`: the matchup extrapolation, and the cut order repeats → retries → chain length.
- **Scripts.**
  - `scripts/spike-substrate.mts`: the resumable live runner, which writes under `runs/spike/`.
  - `scripts/spike-report.mts`: reads that tree and prints a report plus a markdown table.
- **Decision record.** `docs/decisions/substrate.md`. **Then STOP.**
- **Part B.**
  - Set `SPEC_VERSION = 1` and `LOG_VERSION = 1`.
  - `Event.rejected` changes from optional to nullable, removing the v0 stopgap.
  - Add migration modules, regenerate the fixtures, and retune `DIFFICULTY_RANGES`, `DEFAULT_BUDGET` and
    `MAX_CHAIN_LENGTH`.
  - Default `--strategy` becomes the adopted one.

## Out of Scope / Non-Goals

- **Not included: "generator targets difficulty near the models' ceiling".** That is the rule's fallback branch. If
  no substrate clears 60%, the decision record says so, and the fallback becomes a new ticket that sends TICKET-5
  back. Do not build it here.
- **Not included: harder derivation.** No ciphers, arithmetic or transforms. The solver's rule, that the answer is
  literally in the clue, stays. It is flagged in NOTES as the likely lever if divergence is low.
- **Not included: `brief_mismatch` enforcement.** This is the follow-up from the room-generator report. The
  fingerprint records what was actually built, which is enough for the spike.
- **Not included: silent repeats inside the spike.** Each instance is one duel (`repeats: 0`). Repeats appear only
  in the quota *extrapolation*.
- **Not changing:** `RUN_VERSION`, `RunSchema`, `ActionSchema`, the provider adapters' request shapes, or
  `equivalence.test.ts`. TICKET-8/9 files (`app/`) are not touched.
- **Not changing:** the answer-comparison rule (`answersMatch` / `matches`: trim + lowercase, nothing else).
- **Not included in Part A:** any v1 bump. v0 is widened in place, which `lib/schema/version.ts` explicitly
  allows ("deliberately unpinned").

## Feature Metadata

**Feature Type**: New Capability (spike + schema promotion)
**Estimated Complexity**: High. It touches six modules, and there is a live multi-day run in the middle.
**Primary Systems Affected**: `lib/sim`, `lib/schema`, `lib/solver`, `lib/generator`, `lib/harness` (pricing and
record), new `lib/spike`, `scripts/`, `fixtures/`, `docs/decisions/`
**Dependencies**: No new packages. Live Groq and Gemini free-tier keys are in `.env` (moved there on 2026-09-23).

## Related Work

**Implements**: TICKET-7 → GitHub issue #8. **Epic**: `docs/tickets/llm-escape-room.md`; architecture:
`architecture.md` → *Spikes & experiments 1, 2*, *Missing pieces*.

**Back-references**:

- `.claude/plans/room-generator.md`: the `GeneratorStrategy` seam, the fixed-brief-across-retries rationale, and
  "skeleton strategy" as the reject-and-repair lever.
- `.claude/plans/run-harness.md`: `runDuel`/`runMatchup`, sequential repeats, and full-history transcripts (prompt
  tokens grow linearly).
- `.claude/plans/scaffold-core-schemas-v0.md`: the v0/v1 contract and the migrations seam.
- `.claude/reports/run-harness-report.md`: the id-visibility gap (fixed by Task A1).
- `.claude/reports/room-generator-report.md`: live acceptance was never measured, and the spike measures it.

**Forward-references**:

- (none yet). If the fallback branch fires, a "difficulty near ceiling" ticket links back here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `lib/schema/version.ts` (all): the v0 "deliberately unpinned" contract; Part B edits it.
- `lib/schema/room.ts` (lines 73–84 `PuzzleSchema`, 105–112 difficulty): the `kind` enum widens here.
- `lib/schema/event.ts` (lines 43–48 and 77–108): the `rejected` optional→nullable change in Part B, and the
  superRefine to update.
- `lib/schema/migrations/README.md`: the exact module contract (`from`, `to`, `migrate(raw): unknown`, pure and
  total).
- `lib/sim/resolve.ts` (lines 120–240): `look`/`inspect`/`open`/`use`/`submit_answer` text. Also line 166 (names
  only) and lines 227–238 (`submit_answer` refusing `code` puzzles; extend it to `key`).
- `lib/sim/observation.ts` (lines 79–103): `describeRoom` / `sentenceList`. Add ids here.
- `lib/sim/secrecy.test.ts` (lines 60–140): the adversarial sweep. It must still pass. Ids are fine; clue text,
  answers, and unreachable objects are not.
- `lib/sim/fixture-replay.test.ts` (lines 19–24): compares verdict **codes, not messages**, so text changes are
  safe.
- `lib/harness/prompt.ts` (lines 20–45): the `name [id]` convention to mirror in the simulator text.
- `lib/solver/structure.ts` (lines 138–179): lock agreement. Add the `key` branch.
- `lib/solver/derivation.ts` (lines 51–77, `candidatesFor`; lines 79–125, `checkDerivation`): add `key`
  derivability.
- `lib/solver/oracle.ts` (lines 103–160 `movesFrom`; `learnedBy` after it): key moves. Note lines 142–156 already
  handle `take`/`use` for a key-locked target.
- `lib/solver/difficulty.ts` (lines 26–30): `DIFFICULTY_RANGES`, retuned in Part B.
- `lib/solver/fuzz.ts`: `buildValidRoom`, test support. Mirror it for a hand-built key room in tests.
- `lib/generator/types.ts` (lines 29–38 `StructuralBrief`, 62–72 `GeneratorStrategy`): widen the brief.
- `lib/generator/strategies/symbolic.ts` (all): the strategy to mirror. Extract its shared parts.
- `lib/generator/strategies/index.ts`: the registry and extension point.
- `lib/generator/proposal.ts` (lines 28–54): the model-facing schema. Add `key` to the puzzle `kind`.
- `lib/generator/record.ts` (lines 30, 61–88): the `brief` block is strict. Widen it and bump
  `GENERATION_RECORD_VERSION`.
- `lib/generator/fingerprint.ts` (lines 22–33, 65–70): `puzzleKinds` enum and `answerShape`.
- `lib/generator/boundary.test.ts`: the boundary-sweep pattern to MIRROR for `lib/spike`.
- `lib/generator/strategies/symbolic.test.ts`: the test layout to mirror for the new strategies.
- `lib/harness/matchup.ts`, `duel.ts`: `runDuel` is what the spike calls per instance, and `DuelAbortedError`
  carries `providerCalls`.
- `lib/harness/pricing.ts` (lines 29–32): add the gpt-oss models as FREE.
- `lib/harness/types.ts` (lines 25–28): `DEFAULT_BUDGET`, `DEFAULT_REPEATS`, retuned in Part B.
- `lib/harness/typicality.ts`: `outcomeOf`. Divergence mirrors its judged-by-actions stance.
- `lib/providers/transport.ts` (lines 45–136): 429 is retried 3× with `retry-after`, then it throws
  `ProviderError`. The runner treats that as "quota exhausted, resume later".
- `scripts/run.mts` and `scripts/generate-room.mts`: CLI patterns (`parseArgs`, `fail(msg, code)`, `write`, counts
  only and never room content). MIRROR them for the spike scripts.
- `scripts/smoke-providers.mts` (line 27): default Groq model to update.
- `scripts/generate-fixtures.mts` (all; line 195 hard-codes `specVersion: 1` for the mismatch fixture): the
  Part B regeneration.
- `fixtures/index.ts` (line 83): the mismatch reason text.

### New Files to Create

**Part A**

- `lib/generator/strategies/shared.ts`: theme hints, `chainLengthsFor`, `feedbackLines`, and the id/uniqueness
  constraint lines, extracted from `symbolic.ts`.
- `lib/generator/strategies/spatial.ts` + `spatial.test.ts`
- `lib/generator/strategies/mixed.ts` + `mixed.test.ts`
- `lib/solver/key.test.ts`: key-puzzle certification (valid, key missing, lock mismatch, shortcut).
- `lib/spike/divergence.ts`, `decide.ts`, `quota.ts`, `index.ts`, and a test for each.
- `lib/spike/boundary.test.ts`: no network, env, clock or randomness.
- `scripts/spike-substrate.mts`: the resumable live runner.
- `scripts/spike-report.mts`: the analysis CLI.
- `docs/decisions/substrate.md`: the decision record (drafted at the end of Part A).

**Part B**

- `lib/schema/migrations/room-v0-v1.ts` + `.test.ts`
- `lib/schema/migrations/event-v0-v1.ts` + `.test.ts`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Groq rate limits](https://console.groq.com/docs/rate-limits), the "Free Plan Limits" table. Read on
  2026-09-23: `openai/gpt-oss-120b` and `openai/gpt-oss-20b` both have **30 RPM, 1K RPD, 8K TPM, 200K TPD**.
  Headers `x-ratelimit-remaining-requests` (RPD) and `x-ratelimit-remaining-tokens` (TPM). Why: this is
  `quota.ts`'s limits table. Re-check at execution time: the org's own limits page is authoritative.
- [Groq deprecations](https://console.groq.com/docs/deprecations): `llama-3.1-8b-instant` was shut down
  2026-08-16, and the stated replacement is `openai/gpt-oss-20b`. Why: this forces the model change.
- [Groq models](https://console.groq.com/docs/models): both Llama models are now tagged Enterprise, and gpt-oss
  models are production. Why: the pair choice.
- [Groq tool use](https://console.groq.com/docs/tool-use): all hosted models, including gpt-oss, support tool use.
  The page is silent on `tool_choice: "required"` for gpt-oss, so Task A13's smoke run verifies it.
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits): the page publishes **no numbers**;
  they're shown per project in AI Studio. Why: `quota.ts` carries Gemini limits as `null` (unknown) unless the
  user supplies them. The report must then say "Gemini fit: unknown", not guess.

### Patterns to Follow

**Naming:** kebab-case files, camelCase functions, SCREAMING_SNAKE constants, `XxxSchema` for Zod plus an
inferred `type Xxx`, `parseXxx(raw)` that throws `XxxError extends SchemaError` (`lib/schema/room.ts:125–137`).

**Comments:** every module opens with a `/** … — TICKET-N (#issue). */` header. Its `── Heading ──` sections
explain *why*, and name the tickets that depend on it. This codebase is comment-dense on purpose, so match it.
Use `TICKET-7 (#8)` in new headers.

**Outcomes, not throws:** a rejected room, a tripped cap and an exhausted budget are return values
(`generate.ts:53–61`, `rejections.ts:6–16`). A dead provider is a thrown `ProviderError` wrapped with partial
counts (`GenerationAbortedError`, `DuelAbortedError`). `lib/spike` follows the same rule: an instance that
could not be run is **recorded as `aborted`**, never silently skipped.

**Secrecy:** never print or persist answers or clue text.
- CLIs print counts and codes only (`scripts/run.mts:119`).
- Generation records carry codes, not messages (`record.ts:17–25`).
- Spike artifacts live under gitignored `runs/`.
- The decision record contains **aggregates only**: no room contents, no intents quoted at length.

**Build by listing, never spreading** (`observation.ts:12–18`, `harness/record.ts:9–15`).

**Tests:** vitest, `describe`/`it`, colocated `*.test.ts`, `@/` alias. Scripted clients come from
`lib/generator/testing.ts` and `lib/harness/testing.ts`, which are not exported from `index.ts`.

---

## IMPLEMENTATION PLAN

### Phase A1: Make live numbers honest (simulator ids + model defaults)

Id visibility in `lib/sim`, and gpt-oss defaults and pricing. Everything later depends on this, and none of it
touches the schema.

### Phase A2: The `key` puzzle kind, end to end (v0 widened in place)

**Depends on:** A1 (the simulator changes in `resolve.ts` share a file).

Schema enum → solver (structure, derivation, oracle) → simulator (`submit_answer` refusal) → generator proposal,
fingerprint and record.

### Phase A3: Strategies

**Depends on:** A2.

Extract `shared.ts`, widen `StructuralBrief`, then add `spatial` and `mixed` and register them.

### Phase A4: Spike analysis (pure)

**Independent of:** A2/A3 (it reads only `Run`, `GenerationRecord` and numbers). It can run in parallel.

`lib/spike/{divergence,decide,quota}.ts` + tests + boundary sweep.

### Phase A5: Live spike + decision record → CHECKPOINT

**Depends on:** A1–A4.

Smoke → runner (multi-day, resumable) → report → draft `docs/decisions/substrate.md` → **STOP**.

### Phase B: Promote to v1

**Depends on:** the user's go-ahead at the checkpoint, with the adopted strategy named.

Versions, the `Event.rejected` nullable change, migrations, fixtures, retuned constants, default strategy.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.
Baseline before starting: `pnpm test` → **646 passed**, `pnpm typecheck` clean (verified 2026-09-23).

### ── PART A ──────────────────────────────────────────────────────────────

### Task A1 — UPDATE `lib/sim/observation.ts` + `lib/sim/resolve.ts`: show ids to competitors

- **IMPLEMENT**:
  - `describeRoom`: render each visible object and each held item as `name [id]`, matching the
    `lib/harness/prompt.ts:39` convention: `You see writing desk [desk], brass-bound chest [chest] and …`.
  - `open` success (`resolve.ts:166`): `Inside is sea chart [sea-chart], …`. List **direct children only**, as
    now.
  - `inspect` success: if the target is the `clueObjectId` **or** the `unlocksObjectId` of an **unsolved**
    `kind: 'answer'` puzzle, append ` (Answer it with submit_answer, puzzleId "<id>".)`. It names the puzzle id,
    never the answer. If several puzzles match, name each.
  - `take` / `use` messages may stay name-only, because the id was just supplied by the competitor.
- **PATTERN**: `observation.ts:97–103` (the prose reads the same `visibleObjects` list as the structured
  observation, so the two can't disagree). Keep that property.
- **GOTCHA**:
  - `secrecy.test.ts` sweeps for leaks of unreachable objects. `open` only lists direct children of a container
    that just opened, and those are reachable by `state.ts` rules, *unless* a child is itself locked. Its
    *contents* are then not listed, which is already true.
  - Do not list the children of a locked child.
  - Update the header comment on `observation.ts` ("What `visible` deliberately omits") to say ids are now shown
    and why: `.claude/reports/run-harness-report.md`.
- **ADD tests** in `lib/sim/resolve.test.ts`:
  - The `look` text contains `[desk]`.
  - The `open` text contains each direct child's `[id]`.
  - `inspect` on the canonical sea chart names `"p3"` and does not contain `north`.
  - `inspect` on a code clue does not name a puzzle id.
- **VALIDATE**: `pnpm vitest run lib/sim && pnpm typecheck`
- **SATISFIES**: AC #1

### Task A2 — UPDATE model defaults + pricing to gpt-oss

- **IMPLEMENT**:
  - `lib/harness/pricing.ts`: add `'openai/gpt-oss-120b': FREE, 'openai/gpt-oss-20b': FREE` to `groq`. Keep the
    Llama entries: old run records still reference them.
  - `scripts/run.mts` defaults: `--a groq:openai/gpt-oss-120b`, `--b groq:openai/gpt-oss-20b`. Update the header
    comment and `USAGE`.
  - `scripts/generate-room.mts`: `DEFAULT_MODELS.groq = 'openai/gpt-oss-120b'`. The default `--provider` stays
    `groq`; the spike passes `gemini` explicitly.
  - `scripts/smoke-providers.mts:27`: `'groq-model'` default → `openai/gpt-oss-120b`.
- **GOTCHA**: `competitor()` in `run.mts:81–89` splits on the **first** `:`, and `openai/gpt-oss-120b` contains a
  `/` but no `:`, so parsing is fine. Add a `pricing.test.ts` case asserting both gpt-oss ids are priced.
- **VALIDATE**: `pnpm vitest run lib/harness && pnpm typecheck`
- **SATISFIES**: AC #2

### Task A3 — UPDATE `lib/schema/room.ts`: `PuzzleSchema.kind` gains `'key'` (v0, in place)

- **IMPLEMENT**: `kind: z.enum(['code', 'answer', 'key'])`. Extend the field doc: `key` is solved by `use`-ing the
  item named by `answer` on `unlocksObjectId`, and `answer` is the key's object id. **Do not bump
  `SPEC_VERSION`**: add a line to the `version.ts` header noting v0 was widened in place by TICKET-7 during the
  spike, before pinning.
- **ADD test** in `room.test.ts`: a `key` puzzle parses, and an unknown kind is still refused.
- **GOTCHA**: export a `PUZZLE_KINDS` const tuple and reuse it in `proposal.ts` and `fingerprint.ts`, instead of
  re-typing the enum three times.
- **VALIDATE**: `pnpm vitest run lib/schema && pnpm typecheck` (expect type errors downstream in exhaustive
  switches; fix them in A4–A6, not here, if they are only in solver/generator).
- **SATISFIES**: AC #3

### Task A4 — UPDATE solver for `key` puzzles (`structure.ts`, `derivation.ts`, `oracle.ts`)

- **IMPLEMENT**:
  - **`structure.ts` lock agreement**: for `kind === 'key'`, the target must exist with
    `lock.opensWith === 'key'` and `lock.keyItemId === puzzle.answer` (use `answersMatch`), else `lock_mismatch`.
    Also `lock_mismatch` when the `answer` names no `portable` object (reuse the code; no new rejection code).
  - **`derivation.ts`**: `candidatesFor` for `key` returns `[puzzle.answer]` when
    `clueObjectId === answer` or `clueObjectId` transitively contains the key object; otherwise `[]`.
    `checkDerivation` then raises `answer_not_derivable` as for any kind.
    - This needs the object graph: pass `spec` or a `byId` map into `candidatesFor`, or add a `key` branch in
      `checkDerivation`, whichever keeps `candidatesFor`'s existing signature used by tests intact. Check
      `derivation.test.ts` call sites.
    - Keys have no ambiguity rule: one lock has exactly one `keyItemId`.
  - **`oracle.ts`**:
    - A `key` puzzle needs **no `inspect` to be known**. Treat it as known when the key object is reachable or
      held, and do not emit an `inspect` for it (`movesFrom` lines 121–124).
    - The existing key branch (lines 142–156) then emits `take` → `use`, the same two-actions-per-link cost as
      `inspect` → `enter_code`, which keeps `chainLengthsFor`'s arithmetic valid.
    - Update the `learnedBy` doc to say keys are learned by reaching them.
- **PATTERN**: the "one defect, one code" rule (`verify.ts:178–195`, `derivation.ts:85–91`): a dangling
  `clueObjectId` is already `dangling_reference`, so don't double-report it.
- **GOTCHA**:
  - **Adding a rejection code is a contract change** for `record.ts` (see `rejections.ts:29–30`). Don't add one.
  - The chain check `checkChain` needs puzzle N+1's `clueObjectId` inside what N unlocks. For a key link that
    means the next key (or its holder) sits inside the previously unlocked container, and it works unchanged.
- **CREATE `lib/solver/key.test.ts`**, building rooms by hand like `fuzz.ts`'s `buildValidRoom`. Cases:
  1. A three-link all-key room certifies. `intendedActions === 6`, and the `intendedPath` verbs are
     `take, use, take, use, take, use`.
  2. The key sits outside the clue object → `answer_not_derivable`.
  3. `keyItemId` differs from `answer` → `lock_mismatch`.
  4. The key for link 2 lies on the floor → `chain_broken`, once.
  5. A mixed code → key → answer room certifies.
  6. The existing corpus (`corpus.test.ts`) is unchanged.
- **VALIDATE**: `pnpm vitest run lib/solver && pnpm typecheck`
- **SATISFIES**: AC #3

### Task A5 — UPDATE `lib/sim/resolve.ts` + `lib/schema/action.ts` + `lib/sim/simulator.ts`: key verdicts

- **IMPLEMENT**:
  - At `resolve.ts:227`, widen `if (puzzle.kind === 'code')` to `puzzle.kind !== 'answer'`. For `key`, the message
    is `That has to be opened with something, on the <holder name>.`. Name the holder, never the key.
  - **The wrong key gets its own verdict.** Today `resolve.ts:195` returns `locked` ("That does not fit…"), and
    `VERDICT_TALLY` (`simulator.ts:41`) scores `locked` as `none`. On a spatial room, trying a decoy key would
    count as neither a failed attempt nor an invalid action, so spatial mistakes would be invisible in exactly
    the metrics the spike compares.
    - Add `'wrong_key'` to `VERDICT_CODES` (`lib/schema/action.ts:93`), in v0 in place, like A3.
    - Tally it `'failed'`, the key-lock analogue of `wrong_code`.
    - Return it at line 195.
    - Keep `locked` for "tried a locked thing": the fixture's reasoning at `simulator.ts:33–38` still holds.
  - Update the `VERDICT_TALLY` doc comment to say why `wrong_key` is `failed`.
- **GOTCHA**: `fixture-replay.test.ts` and `fixtures/index.test.ts` must stay green. The golden log contains no
  `use`, so nothing in it changes.
- **ADD test** in `resolve.test.ts` (wrong key → `wrong_key`, and `failedAttempts` increments in
  `simulator.test.ts`). Confirm `secrecy.test.ts` still passes: it submits nonsense to every puzzle id, key
  puzzles included, once fixtures or tests contain one.
- **VALIDATE**: `pnpm vitest run lib/sim`
- **SATISFIES**: AC #3

### Task A6 — UPDATE generator plumbing: `proposal.ts`, `fingerprint.ts`, `types.ts`, `record.ts`

- **IMPLEMENT**:
  - `proposal.ts`: `ProposedPuzzleSchema.kind` uses `PUZZLE_KINDS`. `ProposedLockSchema` already accepts
    `LockSchema`'s key variant.
  - `fingerprint.ts`:
    - `puzzleKinds` uses `z.enum(PUZZLE_KINDS)`.
    - `answerShape` returns `'key'` for key puzzles.
    - **This changes `structureHash` only for rooms containing key puzzles.** Existing hashes are stable because
      `HASHED_KEYS` is unchanged. Assert that in `fingerprint.test.ts` with the canonical room's hash before and
      after.
  - `types.ts` `StructuralBrief`: add `readonly linkKinds: readonly ('code' | 'key' | 'answer')[]` (length =
    `chainLength`) and `readonly decoyKeys: number`. `finalAnswerDomain` becomes `AnswerDomain | null` (null when
    the last link is `key`). `codeWidths` keeps "one entry per `code` link, in order". Update the doc comment,
    which says it's a "v0 guess shaped by symbolic" that TICKET-7 widens.
  - `record.ts`:
    - `GENERATION_RECORD_VERSION = 1`.
    - The `brief` block gains `linkKinds: z.array(z.enum(['code','key','answer']))` and
      `decoyKeys: z.number().int().nonnegative()`, and `finalAnswerDomain` becomes `.nullable()`.
    - `generate.ts:96` writes `generationRecordVersion: 0` literally. Change it to use the constant.
    - `generate.ts:103` spreads `brief` with a `codeWidths` copy; copy `linkKinds` the same way.
  - `symbolic.ts` `brief()`: emit
    `linkKinds: [...Array(chainLength - 1).fill('code'), 'answer']` and `decoyKeys: 0`. Keep the rng draw order
    **identical** so that existing seeds give the same brief, which `symbolic.test.ts` "is deterministic" guards.
    Append new draws only after existing ones, and symbolic needs none.
- **GOTCHA**: no generation record is committed (`runs/` is gitignored), so the record version bump needs no
  migration. Say so in the `record.ts` header.
- **VALIDATE**: `pnpm vitest run lib/generator && pnpm typecheck`
- **SATISFIES**: AC #3, AC #4

### Task A7 — REFACTOR `lib/generator/strategies/symbolic.ts` → extract `shared.ts`

- **IMPLEMENT**: move `THEME_HINTS`, `chainLengthsFor`, `MAX_CHAIN_LENGTH`, `feedbackLines`, and the
  id/containment/uniqueness constraint sentences (symbolic rules 1, 5, 7, 8) into `shared.ts` as small
  line-builder functions. `symbolic.ts` re-exports what `strategies/index.ts` currently re-exports from it.
- **GOTCHA**: `symbolic.test.ts` "is byte-identical for the same seed on the first attempt" must stay green:
  the symbolic prompt text must not change by a single character. Run it before and after.
- **VALIDATE**: `pnpm vitest run lib/generator/strategies`
- **SATISFIES**: AC #4

### Task A8 — CREATE `lib/generator/strategies/spatial.ts` + `spatial.test.ts`

- **IMPLEMENT**: `createSpatialStrategy({ band = 'standard' })`.
  - **`brief(rng)`**:
    - `chainLength` from `chainLengthsFor(band)`.
    - `linkKinds` all `'key'`, `codeWidths: []`, `finalAnswerDomain: null`.
    - `decoys: rng.int(1, 3)`, `decoyKeys: rng.int(1, 2)`, `themeHint: rng.pick(THEME_HINTS)`.
  - **`system()`**: the same register as symbolic's.
  - **`prompt(brief, feedback)`**: hard constraints, each mapped to a rejection code, as symbolic does:
    1. Exactly N puzzles p1..pN, `"kind": "key"`, one linear chain.
    2. Each puzzle's `answer` is the **id** of a `"portable"` key object. The object it unlocks has
       `"lock": {"opensWith":"key","keyItemId": <that id>}`. The final puzzle unlocks `door` (kind `door`), which
       is **key-locked**, and `exit` = `{objectId:"door", requiresPuzzleId:"pN"}`.
    3. `clueObjectId` = the key itself, or the container it lies in.
    4. Key for p1 is reachable at the start (floor or unlocked container, nested ≤2 deep is fine). The key for
       pN+1 is inside what pN unlocks.
    5. Exactly `decoyKeys` extra portable keys that fit nothing, plus `decoys` decoy objects.
    6. Descriptions never say which lock a key fits. `clueText` may describe where it was found.
    7. `estimatedActions` from 2N to 6N.
    8. `solutionOrder`.
  - Include a placeholder JSON `EXAMPLE` of the key shape (shape only, obviously-placeholder ids).
  - **`narrow`**: `narrowProposal`.
- **TESTS** (mirror `symbolic.test.ts`):
  - Deterministic brief per seed.
  - Chain length fits the band.
  - The prompt names N, `keyItemId` and `decoyKeys`.
  - The prompt is byte-identical for the same seed.
  - Narrowing accepts a hand-built certified all-key room via `proposalFromSpec` (`lib/generator/testing.ts`).
  - `generateRoom` with `scriptedGenerationClient` returning that room → `ok: true`, and the fingerprint
    `puzzleKinds` is all `key`.
- **VALIDATE**: `pnpm vitest run lib/generator`
- **SATISFIES**: AC #4

### Task A9 — CREATE `lib/generator/strategies/mixed.ts` + `mixed.test.ts`; register all three

- **IMPLEMENT**:
  - **`brief(rng)`**:
    - `chainLength` from `chainLengthsFor(band)`, which must be ≥2 for mixed. Filter the lengths to ≥2 and throw
      `RangeError` if none remain, like symbolic's `hard` refusal.
    - The first `chainLength-1` links are drawn per link with `rng.pick(['code','key'])`, **re-drawn if all are the
      same kind when chainLength ≥3**, so a mixed room is genuinely mixed. Document the rule. Last link:
      `'answer'`.
    - `codeWidths` has one entry per code link.
    - `finalAnswerDomain` is picked from `ANSWER_DOMAINS`, and `decoyKeys` = `rng.int(0, 1)`.
  - **`prompt`** composes symbolic's code rules, spatial's key rules and symbolic's final-answer rule, per link, in
    chain order.
  - **`strategies/index.ts`**: register `spatial` and `mixed`, re-export the factories, and update the
    extension-point header ("the spike added spatial and mixed").
  - **`lib/generator/index.ts`**: export `createSpatialStrategy` and `createMixedStrategy`.
- **TESTS**:
  - Determinism.
  - Mixed-ness: across 50 seeds with chainLength ≥3, no brief is all-code or all-key.
  - The prompt mentions both `enter_code`-style code rules and key rules when both kinds are present.
  - Scripted `generateRoom` accepts a hand-built code→key→answer room.
  - Registry: the `resolveStrategy` error lists `mixed, spatial, symbolic`. Update the existing registry test.
- **VALIDATE**: `pnpm vitest run lib/generator && pnpm typecheck`
- **SATISFIES**: AC #4

### Task A10 — CREATE `lib/spike/divergence.ts` + test

- **IMPLEMENT**: `divergenceOf(run: Run): InstanceVerdict`, where
  `{ eligible: boolean; diverged: boolean; reason: 'one_escaped' | 'action_gap' | 'same' | 'neither_escaped' | 'ineligible' }`.
  - **Eligible**: no competitor has `endedBecause` of `budget_tokens` or `budget_time`. Divergence is judged on
    action-limited play, per the ticket's "both models inside the action budget". `budget_actions` and `escaped`
    are eligible.
  - **Diverged**:
    - Exactly one escaped → `one_escaped`.
    - Both escaped and `max(a,b) > 1.25 × min(a,b)` on `escapeActionCount` → `action_gap`.
    - Otherwise `same`, or `neither_escaped` when both are stuck.
  - Export `DIVERGENCE_GAP = 1.25`.
  - Uses `escapeActionCount`, **never `escapeMs`**. Cite `typicality.ts:11–16`.
- **TESTS**:
  - Each branch.
  - Boundary: 8 vs 10 is exactly 1.25 → not diverged. 8 vs 11 → diverged.
  - The token-budget case is ineligible.
  - Use `loadCanonicalRun()`: model-a escaped in 13 and model-b did not → `one_escaped`. Verify against the
    fixture.
- **VALIDATE**: `pnpm vitest run lib/spike`
- **SATISFIES**: AC #5

### Task A11 — CREATE `lib/spike/decide.ts` + test

- **IMPLEMENT**:
  - `summariseStrategy(strategy, instances: SpikeInstance[])`, where `SpikeInstance` is
    `{ generation: GenerationRecord; run: Run | null; aborted: string | null }`. It returns:
    - counts: planned, generated (accepted), generation cap tripped, duels completed, aborted, eligible, diverged;
    - `divergenceRate = diverged / eligible`;
    - per-competitor escape rate and median/p90 actions to escape;
    - invalid-action rate per action;
    - median and mean generation attempts-to-accept.
  - `decide(summaries)` → `{ adopted: string | null; reasons: string[] }`.
    - A strategy **clears** when `divergenceRate ≥ 0.6` **and** `eligible ≥ MIN_ELIGIBLE = 15`. The ticket says
      "~20 instances", and fewer than 15 is too few to call.
    - If several clear, adopt the highest `divergenceRate`. Tie-break on the higher generation acceptance (lower
      quota cost), then alphabetically.
    - `adopted: null` means the fallback branch fired, with a reason per strategy.
- **GOTCHA**: rooms whose generation cap tripped are **not** instances for divergence. They are reported as
  generation failures (they feed quota). Aborted duels are excluded from `eligible` but counted and shown.
- **TESTS**: synthetic `Run`s built via `parseRun` (mirror `lib/harness/typicality.test.ts`'s builders). Cover
  clear, not clear, too few eligible, the tie-break, and all-null.
- **VALIDATE**: `pnpm vitest run lib/spike`
- **SATISFIES**: AC #5

### Task A12 — CREATE `lib/spike/quota.ts` + test, `lib/spike/index.ts`, `lib/spike/boundary.test.ts`

- **IMPLEMENT**:
  - `FREE_TIER_LIMITS`: a data table keyed by `provider/model`, each field `number | null`, with
    `{ rpm, rpd, tpm, tpd, source: url, readOn: '2026-09-23' }`. Groq gpt-oss-120b and gpt-oss-20b get
    30 / 1000 / 8000 / 200000. `gemini/gemini-flash-latest` is all `null`: unpublished, see AI Studio.
  - `estimateMatchup(measured, config)`:
    - `measured` comes from the spike: mean tokens and calls per duel per competitor, and mean generation
      attempts, calls and tokens per accepted room, for the adopted strategy.
    - `config` is `{ repeats, maxAttempts, chainLength }`.
    - Returns per-model daily usage: requests and tokens for (1 + repeats) duels, plus generation tokens and calls
      for the generation model. Returns `fits: true | false | 'unknown'` per model: `'unknown'` when any needed
      limit is null. Also returns `peakTpmSeconds`, the minimum wall-clock a duel needs under TPM.
  - `planCuts(measured, limits)`: walk the cut order and return the first fitting config, or the last tried if
    none fits.
    1. `repeats` 3 → 2 → 1 → 0.
    2. `maxAttempts` 5 → 3 → 2.
    3. `chainLength` −1 per step down to 2, scaling duel tokens by `chainLength/measuredChainLength` (linear,
       documented as an approximation).
    4. The 60–90 s watch target is **never** cut here. Say so in a comment.
  - `index.ts` exports these plus `divergenceOf`, `summariseStrategy` and `decide`.
  - `boundary.test.ts` MIRRORS `lib/generator/boundary.test.ts`: forbid `process.env`, `fetch(`, `node:http(s)`,
    `Math.random` and `Date.now`, and forbid value imports from `@/lib/providers`. **Allow `https?://` inside
    `quota.ts` only**: the source URLs are data, not endpoints. Put the exemption in the test with a reason.
- **TESTS**:
  - Arithmetic on hand numbers, e.g. 24k tokens/duel/model × 4 duels = 96k ≤ 200k TPD → fits.
  - 60 duels → does not fit.
  - The cut order: repeats are cut before retries.
  - A null limit → `'unknown'`.
- **VALIDATE**: `pnpm vitest run lib/spike && pnpm typecheck`
- **SATISFIES**: AC #6

### Task A13 — CREATE `scripts/spike-substrate.mts` (resumable live runner)

- **IMPLEMENT**: this is the opt-in live CLI, and its header comment copies the "NOT part of validation … spends
  free-tier quota … answers never printed" block from `scripts/run.mts`.
  - **Flags**:
    - `--strategies symbolic,spatial,mixed`
    - `--instances 20`
    - `--gen gemini:gemini-flash-latest`
    - `--a groq:openai/gpt-oss-120b`, `--b groq:openai/gpt-oss-20b`
    - `--max-attempts 5`, `--max-actions/--max-tokens/--max-ms` (defaults `DEFAULT_BUDGET`)
    - `--out runs/spike`
    - `--pace-ms 0`: sleep between duels
  - **Per instance** `i` of strategy `s`, the seed is `spike-${s}-${i}` (deterministic, reproducible), in
    directory `<out>/<s>/<i>/`:
    1. If `run.json` or `aborted.json` exists, **skip**. This is resumability.
    2. If `room.json` is missing, `generateRoom` with the gen client. Write `generation.json` always, and
       `room.json` only on `ok`. On a tripped cap, write `generation.json` and move on: it is a result.
    3. `runDuel` with `repeats` omitted (just one duel). Write `run.json` + `events.json`.
    4. Order is interleaved round-robin across strategies (i=1 for all strategies, then i=2…). A quota stop
       mid-run then leaves strategies with equal sample sizes, not 20/20/3.
  - **On a `ProviderError`, `GenerationAbortedError` or `DuelAbortedError`**: write `partial.json` with the counts,
    **do not** write `aborted.json`, print
    `quota or provider failure — re-run the same command to resume (<n> done)`, and exit 1. Rerunning retries that
    instance.
    - Write `aborted.json` only for a non-provider failure after the room certified, which should not happen.
      Such an instance then counts as aborted.
  - Print counts only, one line per instance:
    `symbolic #3  gen 2 attempts ✓  duel: a ESCAPED 11 / b stuck 14 → diverged(one_escaped)`.
  - Build adapters and the gen client via `createAdapter`/`createGenerationClient` + `readProviderKey`, like
    `run.mts:133–139`.
- **GOTCHA**:
  - **Quota reality.** 8K TPM per Groq model means one duel of ~14 turns can hit 429s. The transport retries 3×
    honouring `retry-after`, capped at 20 s, and each retry is counted. At 200K TPD per model, **expect about 8
    duels per model per day**. 60 duels therefore take **about 7–8 days** of reruns. Say this in the header, and
    print the tally of instances done and remaining each run.
  - `--pace-ms 60000` keeps a duel under TPM if 429 churn is heavy.
  - The canonical fixture room is **not** part of the spike sample.
- **VALIDATE** (offline): `node --import tsx scripts/spike-substrate.mts --strategies nope` exits 2 with the known
  strategy list. `pnpm typecheck` passes.
- **SATISFIES**: AC #7

### Task A14 — CREATE `scripts/spike-report.mts`

- **IMPLEMENT**:
  - Walk `<out>/<strategy>/<i>/`.
  - Parse with `parseGenerationRecord` and `parseRun`. **Refuse unparseable files loudly** and list the paths.
  - Build `SpikeInstance[]`, then `summariseStrategy` → `decide`. Build `measured` from the adopted strategy, or
    from every strategy if none was adopted, and run `planCuts`.
  - Write `<out>/report.json`.
  - Print a **markdown table** ready to paste into the decision record: strategy | planned | certified | duels |
    eligible | diverged | rate | a-escape% | b-escape% | median actions (a/b) | invalid/action | gen attempts
    (median).
  - Print the quota section: per model, requests and tokens for one matchup, the limits, fit, the cut config if
    needed, and the minimum duel wall-clock under TPM.
  - Aggregates only; no room text.
- **VALIDATE** (offline): add `lib/spike/report.test.ts`. It writes two fake instance dirs into a vitest `tmpdir`
  using fixture-derived records, then imports the report's pure `buildReport(dir)`. Put `buildReport` in
  `lib/spike/report.ts`; that file may use `node:fs` and the boundary test allows `node:fs`. The script stays a
  thin wrapper. Run `pnpm vitest run lib/spike`.
- **SATISFIES**: AC #5, AC #6

### Task A15 — VALIDATE Part A offline, then run LIVE

- **Offline**: `pnpm typecheck && pnpm test`. The count must be ≥ 646 plus the new tests, with zero failures.
- **Live smoke**. It verifies that gpt-oss accepts forced `tool_choice: "required"` and that Gemini generates:
  ```bash
  node --env-file-if-exists=.env --import tsx scripts/smoke-providers.mts
  node --env-file-if-exists=.env --import tsx scripts/smoke-providers.mts --groq-model openai/gpt-oss-20b
  node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed smoke-spatial-1 --strategy spatial --provider gemini
  node --env-file-if-exists=.env --import tsx scripts/run.mts --repeats 0
  ```
  - If gpt-oss refuses forced tool calls, or the account lacks either model, **STOP and ask the user**. Do not
    silently switch pairs.
  - Check the `run.mts` output: `invalid` counts should now be low on the canonical room, because ids are
    visible. Record the numbers.
- **Spike** (repeat daily until done):
  ```bash
  node --env-file-if-exists=.env --import tsx scripts/spike-substrate.mts --instances 20
  ```
- **Report**:
  ```bash
  node --import tsx scripts/spike-report.mts --out runs/spike
  ```
- **SATISFIES**: AC #7

### Task A16 — CREATE `docs/decisions/substrate.md` (draft), then **STOP — HUMAN CHECKPOINT**

- **IMPLEMENT**: an ADR-style record. Sections:
  - **Status**: Proposed.
  - **Context**: link the PRD and architecture spikes.
  - **Method**: the models, the gen model, seeds `spike-<s>-<i>`, budget, the divergence rule with the
    eligibility definition, MIN_ELIGIBLE, and the dates run.
  - **Results**: the pasted table.
  - **Decision**: adopted substrate, or "none, fallback fired".
  - **Quota**: the pasted quota section, the fit verdict and any cuts applied, in the order repeats → retries →
    chain length. "Gemini: unknown" unless the user supplies AI Studio limits.
  - **Proposed v1 changes**: the list for Part B, including whether `'key'` stays in the v1 `PuzzleSchema`
    (kept if spatial or mixed is adopted). **Proposed retuned constants**, each with the rule used:
    - `DEFAULT_BUDGET.maxActions`: the ceiling of 1.25 × the p90 of escaping action counts across both models.
      Never below 14 for the canonical room.
    - `DIFFICULTY_RANGES`: re-fit so the adopted strategy's certified rooms land in `standard`, keeping the
      canonical room (6 intended) in `standard`.
    - `MAX_CHAIN_LENGTH`: unchanged unless the quota cut reduced it.
  - **Consequences**: include "what this does not prove": n≈20, one model pair, one provider.
- **Commit Part A**, via `skills:piv-commit` if requested. Then **report to the user and END THE TURN.** Do not
  start Part B.
- **SATISFIES**: AC #8

### ── PART B (only after the user confirms an adopted substrate) ──────────

### Task B1 — UPDATE `lib/schema/version.ts`, `room.ts`, `event.ts`: pin v1

- **IMPLEMENT**:
  - `SPEC_VERSION = 1` and `LOG_VERSION = 1`, with `RUN_VERSION` unchanged.
  - Rewrite the header from "THESE ARE v0 AND DELIBERATELY UNPINNED" to "PINNED AT v1 by TICKET-7 (#8), see
    `docs/decisions/substrate.md`". Say that any further change is a migration through `lib/schema/migrations/`.
  - `room.ts`: if the decision record drops `'key'` (symbolic adopted), remove it from `PUZZLE_KINDS`, and make
    `spatial`/`mixed` unregistered in `strategies/index.ts` with a comment. Otherwise keep it.
  - `event.ts`: `rejected: RejectedSchema.nullable()`, required. The superRefine becomes
    `(event.action === null) !== (event.rejected !== null)`. Replace the "optional rather than nullable" paragraph
    (lines 43–48) with its v1 resolution.
- **UPDATE** `lib/harness/record.ts:69`: always set `rejected`, as `describeRejection(turn)` or `null`.
- **VALIDATE**: `pnpm typecheck`. Expect fixture/test failures until B3.
- **SATISFIES**: AC #9

### Task B2 — CREATE `lib/schema/migrations/room-v0-v1.ts`, `event-v0-v1.ts` + tests; update README

- **IMPLEMENT**: exactly the README contract: `export const from = 0; export const to = 1; export function
  migrate(raw: unknown): unknown`. Pure and total.
  - room: `{ ...raw, specVersion: 1 }`. It is a no-op on content unless B1 removed `'key'`; then a v0 room with a
    key puzzle **throws** a `RangeError` naming the puzzle id. Total over the v1-expressible subset; document
    this.
  - event (per event, plus a `migrateLog(raw[])`): `{ ...raw, logVersion: 1, rejected: raw.rejected ?? null }`.
  - Tests:
    - Every v0 fixture as committed **before** B3 migrates to something `parseRoomSpec` / `parseEventLog`
      accepts. Capture v0 inputs as inline test data, not by reading the fixtures after B3 rewrites them.
    - Migration is idempotent-safe: calling it on a v1 payload throws or is refused, as documented.
  - README: replace "Empty by design" with the list of migrations and when each ran.
- **VALIDATE**: `pnpm vitest run lib/schema/migrations`
- **SATISFIES**: AC #9

### Task B3 — UPDATE `scripts/generate-fixtures.mts` + `fixtures/index.ts`; regenerate

- **IMPLEMENT**:
  - Room: `specVersion: SPEC_VERSION`.
  - Events: `logVersion: LOG_VERSION` and `rejected: null`.
  - The mismatch fixture (line 195): `specVersion: SPEC_VERSION + 1`.
  - `fixtures/index.ts:83`: the reason text should derive the number from `SPEC_VERSION + 1`, not hard-code `1`.
  - Verdict messages in the golden log should now carry ids, from Task A1. If the script builds messages by
    calling the simulator, regeneration picks this up automatically. If they are hand-written, update them to the
    A1 text so the golden log reads like a real run.
  - Run `node --import tsx scripts/generate-fixtures.mts`, then `git diff --stat fixtures/`.
- **GOTCHA**: `fixtures/index.test.ts` re-derives summaries. Summaries must not change: same actions, verdict
  codes, tokens and latencies. Only version fields, `rejected`, and message text may differ. If a summary number
  changes, something is wrong: stop.
- **VALIDATE**: `pnpm vitest run fixtures lib/sim lib/harness lib/solver`
- **SATISFIES**: AC #10

### Task B4 — UPDATE retuned constants + default strategy

- **IMPLEMENT**:
  - Apply the values the user confirmed in `docs/decisions/substrate.md` to `DEFAULT_BUDGET`
    (`lib/harness/types.ts:25`), `DIFFICULTY_RANGES` (`lib/solver/difficulty.ts:26`) and `MAX_CHAIN_LENGTH`.
  - Rewrite each constant's "calibration, not a measurement" or "may retune" comment to cite the decision record.
  - `scripts/generate-room.mts`: `--strategy` default → the adopted strategy.
- **GOTCHA**: the canonical room (6 intended actions, `standard`) and `fixtures/rooms/invalid/out-of-band-difficulty.json`
  must keep their current verdicts. `corpus.test.ts` enforces this. If a proposed range breaks them, the range is
  wrong, not the fixture (`difficulty.ts:12–18`).
- **VALIDATE**: `pnpm test`
- **SATISFIES**: AC #11

### Task B5 — UPDATE stale "v0 / TICKET-7 will…" comments; finalise the decision record

- **IMPLEMENT**:
  - Run `grep -rn "TICKET-7\|#8\|v0" lib scripts fixtures`, and update every comment that promises future action
    by this ticket. Examples: `types.ts` "TICKET-7 may widen", `strategies/index.ts`, `lexicon.ts`
    "extension point", `harness/types.ts:22`, `run.mts:24–26`.
  - `docs/decisions/substrate.md` → **Status: Accepted**, with the date and the v1 changes as shipped.
- **VALIDATE**: `pnpm typecheck && pnpm test`
- **SATISFIES**: AC #9–#11

---

## TESTING STRATEGY

### Unit Tests

- **Sim**: id text and puzzle-id hints (A1), `submit_answer` on key (A5). Existing `secrecy.test.ts` and
  `fixture-replay.test.ts` must stay green unchanged.
- **Solver**: `key.test.ts` (A4), plus the unchanged `corpus.test.ts` and `fuzz.test.ts`.
- **Generator**:
  - Strategy tests for spatial and mixed (A8, A9).
  - `symbolic.test.ts` byte-identical prompt (A7).
  - Fingerprint hash stability for code-only rooms (A6).
  - Record v1 parse (A6).
- **Spike**: divergence, decide, quota and report tests, plus the boundary sweep (A10–A14).
- **Schema**: `key` kind (A3); v1 events with `rejected: null` (B1); migrations (B2).

### Integration Tests

- `generateRoom` with scripted clients, for all three strategies, through to `verifySpec` acceptance.
- `lib/spike/report.test.ts`: the file tree → report JSON.
- `lib/harness/contract.test.ts` after B3: the regenerated golden log still round-trips through the harness.

### Edge Cases

- A key sitting inside a locked container that is itself the previous link's target (legal: the chain gates it).
- A key that is the clue object itself (`clueObjectId === answer`).
- A decoy key that fits nothing: `use` returns `wrong_key` → `failedAttempts` +1, never `invalidActions`
  (Task A5).
- A divergence ratio of exactly 1.25, which is not diverged.
- A strategy with <15 eligible instances, which cannot be adopted.
- Every Gemini limit `null` → fit is `'unknown'`, never `true`.
- A spike rerun after a mid-duel 429 abort: the same instance is retried, and the room is reused rather than
  regenerated.
- Mixed with chainLength 2: one non-final link, so the "genuinely mixed" rule cannot apply. Document that
  chainLength-2 mixed rooms are code→answer or key→answer.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`pnpm typecheck`. There is no linter configured in `package.json`; don't add one.

### Level 2: Unit Tests

`pnpm test`, and per module `pnpm vitest run lib/spike` (etc.).

### Level 3: Integration Tests

`pnpm vitest run lib/generator lib/spike fixtures lib/harness`

### Level 4: Manual / Live Validation

The Task A15 commands, in order: smoke both gpt-oss models, generate one spatial room on Gemini, one `run.mts
--repeats 0`, then the spike runner (multi-day) and `spike-report.mts`.

### Level 5: Additional Validation

- `git status --short` must never show `.env`.
- `git diff .env.example` must be empty.
- `grep -rn "gsk_\|AQ\." --include=*.json runs/ docs/`: must return nothing. No key in any artifact.

---

## ACCEPTANCE CRITERIA

1. [ ] Competitors see object ids in `look`/`open` text and the puzzle id for `answer` puzzles on `inspect`. No
   answer, clue text or unreachable object leaks (`secrecy.test.ts` green).
2. [ ] Defaults use `openai/gpt-oss-120b` vs `openai/gpt-oss-20b` (Groq), and both are priced (FREE).
3. [ ] The `key` puzzle kind parses, certifies (solver), resolves (sim) and is fingerprinted. No new rejection
   code. A wrong key returns `wrong_key`, which is counted as a failed attempt.
4. [ ] `symbolic`, `spatial` and `mixed` are registered behind `--strategy`, and each has deterministic briefs and
   passes a scripted end-to-end generation. The symbolic prompt is byte-identical to before.
5. [ ] `lib/spike` applies the rule as tested code: eligible = no token or time exhaustion; diverged = one escaped,
   or an action gap >1.25×; adopt at ≥60% with ≥15 eligible.
6. [ ] The quota extrapolation covers hero + repeats + rejected generations, per model. It reports
   `'unknown'` instead of guessing for missing limits, and applies cuts in the order repeats → retries → chain
   length, never the watch target.
7. [ ] The live spike ran ~20 instances per strategy (or the shortfall is stated), resumably, with no key or room
   content in any printed output.
8. [ ] `docs/decisions/substrate.md` exists with real numbers and a decision, including "none adopted". **Part A
   ends here with a checkpoint.**
9. [ ] (B) `SPEC_VERSION = 1` and `LOG_VERSION = 1`. `Event.rejected` is nullable and required. Migration modules
   follow the README contract with tests.
10. [ ] (B) Fixtures are regenerated at v1 with unchanged summaries, and the mismatch fixture is at
    `SPEC_VERSION + 1`.
11. [ ] (B) Retuned constants and the default strategy match the accepted decision record. The corpus verdicts are
    unchanged.
12. [ ] `pnpm typecheck && pnpm test` pass with zero failures at the end of each part.

---

## COMPLETION CHECKLIST

- [ ] Part A tasks A1–A16 done in order, each VALIDATE run
- [ ] Live smoke passed, or the user was asked (gpt-oss tool forcing, model access)
- [ ] Spike complete, report generated, decision record drafted
- [ ] **Checkpoint: user read the record and confirmed Part B** (or closed the ticket on the fallback)
- [ ] Part B tasks B1–B5 done, full suite green
- [ ] No secrets in the diff; `.env` untracked

---

## OPEN QUESTIONS / ASSUMPTIONS

Settled with the user (2026-09-23):

- **S1** Fix id visibility in `lib/sim` in this ticket (Task A1).
- **S2** The spatial substrate is a new `key` puzzle kind, added to v0 in place.
- **S3** Divergence: one duel per instance. Diverged = exactly one escapes, or both escape with an action gap
  >25%.
- **S4** Same-provider pair ("keep current unless a closer pair"). **Changed by research**: the current pair no
  longer exists on the free tier (8B shut down 2026-08-16; both Llamas tagged Enterprise). Using
  `openai/gpt-oss-120b` vs `openai/gpt-oss-20b`: same provider, same family, the free plan's production
  models. **GOTCHA**: this is still a size gap, so the decision record must say divergence may reflect
  capability, not substrate. The substrate *comparison* is still fair, because every strategy faces the same pair.
- **S5** Two parts with a human checkpoint.
- **S6** The spike determines v1's content.

Assumed. Confirm at the checkpoint, when the numbers make them concrete:

- **A1** "Both models inside the action budget" = eligibility excludes token or time exhaustion (Task A10). The
  alternative reading, "the stronger model escapes in ≥X%", would add a second threshold. Its escape rates are in
  the report either way.
- **A2** `MIN_ELIGIBLE = 15` of ~20.
- **A3** `gemini-flash-latest` is the generation model, and its free-tier limits are unknown (not published).
  Supply them from AI Studio for a definite quota verdict.
- **A4** A new `wrong_key` verdict code (Task A5), tallied `failed`, so decoy-key mistakes show up in
  `failedAttempts` instead of vanishing under `locked` (tally `none`). It widens `VERDICT_CODES` in v0 in place,
  and becomes part of v1.

---

## NOTES (open canvas)

**Why `key` is a puzzle kind rather than "spatial clues about directions".** Positional prose resolving to a
direction word needs no schema change, but it isn't spatial: the solver's derivation rule means the word is
literally in the clue, so a model reads it, just as in symbolic. A key link is different in kind. The work is
*search and manipulation*: finding which container, taking, choosing among decoy keys, `use` on the right lock.
That exercises the object graph and the interface, which is where models plausibly differ. It is also
machine-checkable with the solver's existing machinery, because the oracle already had a key branch.

**Why the oracle doesn't need an `inspect` for keys.** A competitor can pick up a key it has never inspected, so
requiring an inspect would make `minActions` overstate the lower bound and could mask a real shortcut. Take + use
is two actions, the same as inspect + enter_code, so `chainLengthsFor` stays valid across strategies and bands
mean the same thing for each.

**The likely outcome, and what it means.** Under "the answer is literally in the clue", every puzzle is a reading
exercise, and differences come from navigation discipline, not reasoning. Two outcomes are plausible:

- The 120B/20B gap produces divergence on every substrate. Adopt the cheapest one to generate.
- No substrate reaches 60%. Fallback: "difficulty near the ceiling", which in this codebase means **derivation
  rules that need a step of inference** (e.g. the code is the sum of two numbers, or a direction is described
  relationally). That requires a new solver capability, so it gets its own ticket. The decision record should
  name it concretely either way.

**Quota arithmetic (to be replaced by measured values).**

- **Tokens per duel.** The golden log models prompt tokens as ~820 + 140·seq. A 14-action competitor therefore
  spends ~24K prompt tokens, plus a few hundred completion tokens per duel. gpt-oss reasoning tokens count as
  completion, so measure them rather than assume.
- **Daily capacity.** At 200K TPD, that's ~8 duels per model per day. The spike's 60 duels therefore take about a
  week. A publishable matchup (hero + 3 repeats) is ~96K tokens per competitor, which fits a day's TPD.
- **TPM.** At 8K, a full duel needs ≥3 minutes of token budget. That's fine for a headless run and irrelevant to
  the watch target, because the replay uses beats, not wall-clock.
- **RPD.** 1K RPD is not the binding limit; TPD is.

**Why round-robin across strategies in the runner.** Quota stops the runner partway through each day. Running
strategy-by-strategy would give 20 symbolic instances before spatial got any, so a truncated spike would compare
unequal samples.

**Why `lib/spike` is pure and in `lib/`.** Nobody should have to trust a spreadsheet: the decision rule is a
function with tests, and the report is re-runnable from the saved artifacts. `scripts/spike-*.mts` are the only
impure parts, the same split as `lib/harness` versus `scripts/run.mts`.

**Why v0 is widened in place instead of bumped twice.** `lib/schema/version.ts` promises downstream tickets
*exactly one* migration. Bumping to v1 for `key` and again after the spike would break that promise. v0 was
declared unpinned precisely so the spike could reshape it.

**Rejected: running spike instances with silent repeats.** That would triple quota to measure something
(per-room variance) the decision rule doesn't use. Variance is TICKET-10's disclosure problem.

**Confidence: 6/10 for one-pass Part A.** Engineering risk is moderate (six modules, but each change follows an
existing seam). Most of the uncertainty is external:
- whether gpt-oss accepts forced tool calls on Groq;
- Gemini's real limits;
- whether live models generate certifiable key rooms within 5 attempts.

**Confidence: 8/10 for Part B**, which is mechanical once the decision exists.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
