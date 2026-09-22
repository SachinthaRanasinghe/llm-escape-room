# Feature: Solver / verifier (pure) — TICKET-3 / issue #3

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A pure, offline verifier that takes an untrusted `RoomSpec` and either **certifies** it — proving it is
mechanically escapable, that every puzzle answer is derivable and unique from its clue, that the chain genuinely
gates, and that its declared difficulty is honest — or **rejects it with a machine-readable reason**.

This is the gate the architecture names: *"The solver/verifier. Gates the generator; nothing ships before it."*
TICKET-5's generator is a reject-and-regenerate loop wrapped around this module, and it needs to know **which**
rule failed, not merely that something did. Nothing here talks to a model or the network.

## User Story

As the room generator (and the humans watching it burn quota)
I want every candidate room proved escapable, unambiguous and honestly graded before it is accepted
So that no published matchup is decided by a broken room rather than by the models

## Problem Statement

`RoomSpecSchema` validates **shape only**, deliberately (`lib/schema/room.ts:22-38`). A structurally perfect room
can still be unescapable, can have a clue that supports two different answers, can have a chain that does not
actually gate, and can lie about its difficulty. `fixtures/rooms/invalid/` contains four such rooms, committed
specifically so this ticket has a corpus to be tested against. Until they can be rejected **by reason**, the
generator has no accept/reject signal and the product's "machine-checkable" claim is an assertion.

## Solution Statement

A five-stage pipeline in `lib/solver/`, each stage collecting machine-readable rejections and feeding the next:

1. **Parse** — narrow `unknown` through `parseRoomSpec`; a version mismatch is a rejection, not a throw.
2. **Graph** — referential integrity, then `compileRoom` from `lib/sim`; a `SimulatorError` becomes a rejection.
3. **Structure** — puzzle ordering, `solution.order` agreement, exit placement, code-lock/answer agreement,
   cross-puzzle answer collision under the simulator's own comparison.
4. **Derivation** — per puzzle, extract the candidate answers a competitor could read out of the clue text and
   require the set to be exactly `{answer}`. Codes yield digit-runs; prose answers yield members of the answer's
   own **closed lexicon domain**.
5. **Oracle + difficulty** — a breadth-first search that *plays the room through `lib/sim`'s real `resolve()`*,
   knowledge-gated so an answer cannot be used before its clue has been inspected. Produces `minActions` (any
   route) and `intendedActions` (the `solution.order` route). Chain integrity and the difficulty band are both
   judged against those two numbers.

Because stage 5 drives the same `resolve()` a competitor drives, "solvable" means *solvable under the exact
rules the race is run under* — not under a second, parallel model of the room that could silently drift.

## Out of Scope / Non-Goals

- **Not included: generating rooms.** This module only judges them. TICKET-5 (#6) owns the propose→verify→accept
  loop and the retry cap.
- **Not included: repairing a rejected room.** Rejections are diagnostic; the generator regenerates.
- **Not included: structural-variety metadata** (the PRD's 90% variety metric). That is TICKET-5's, emitted per
  *accepted* room. This plan exposes `minActions` / `intendedActions`, which variety scoring will want, and stops.
- **Not included: LLM or network anything.** No provider import, no fetch, no API key read. A test asserts it.
- **Not included: new puzzle substrates.** Symbolic/spatial/mixed strategies are TICKET-7's (#8). The lexicon is
  built to be *extended* by that ticket, not to anticipate it.
- **Not changing: `lib/schema/*` or `fixtures/*`.** Both are the wave-2 contract for four tickets. The band
  thresholds in this plan were calibrated *to* the committed canonical room precisely so no fixture moves. If
  implementation finds a genuine need to change either, stop and raise it rather than regenerating the corpus.
- **Not changing: `lib/sim/*`.** The solver imports it read-only through `lib/sim/index.ts`.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High — the logic is small but the semantics are subtle; the risk is in the
derivation model and the oracle's knowledge gate, not in line count.
**Primary Systems Affected**: `lib/solver/` (new). Read-only consumers: `lib/sim/`, `lib/schema/`, `fixtures/`.
**Dependencies**: none new. Zod 4.6.5 and Vitest 4.1.11 already present. **No new package is to be added.**

## Related Work

**Implements**: [#3 — TICKET-3 Solver / verifier (pure)](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/3)
**Epic**: [`architecture.md`](../../architecture.md) · [`docs/tickets/llm-escape-room.md`](../../docs/tickets/llm-escape-room.md)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/scaffold-core-schemas-v0.md` — Why: defines `RoomSpec`, the version seam, and the invalid-room
  fixture corpus that is this ticket's test contract.
- `.claude/plans/room-simulator.md` — Why: this plan reuses `compileRoom`, `resolve`, `isReachable` and the
  `matches` normalisation. Two of its decisions are inherited verbatim (see GOTCHAs).

**Forward-references**:

- TICKET-5 (#6) — the generator wraps `verifyRoom()` in a reject-and-regenerate loop and reads `rejections[].code`.
- TICKET-7 (#8) — extends `ANSWER_DOMAINS` and the difficulty bands per substrate, and pins the schema to v1.

### Upstream state — verified before planning

TICKET-1 and TICKET-2 are **code-complete and green** (`pnpm test` 220/220, `pnpm typecheck` clean, both reports
`Status: COMPLETE`). They are **not merged**: `main` is still at `bb75fe5` (docs only), both live on
`feature/room-simulator` stacked on `feature/scaffold-core-schemas-v0`, no PRs exist, and issues #1 and #2 are
still OPEN. That is a shipping gap, not a code gap, and it does not block this ticket — but **branch this work
off `feature/room-simulator`**, not off `main`, or `lib/sim` and `fixtures/` will not exist.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `lib/schema/room.ts` (whole file, esp. lines 22-38) - Why: the type under test, and the explicit
  structural/semantic boundary that defines what this ticket owns. Read the `RoomSpecError` pattern.
- `lib/schema/version.ts` (lines 44-56) - Why: `SchemaError` carries `issues` so failures stay machine-readable.
  The solver's rejection type mirrors that intent.
- `lib/sim/state.ts` (lines 55-120 `compileRoom`, 150-175 `isReachable`) - Why: the object-graph checks this
  module must *catch and convert* rather than duplicate, and **the lock-gated reachability rule** the oracle
  depends on.
- `lib/sim/resolve.ts` (lines 44-56 `matches`, 70-96 `unlockAndSolve`, 100-110 `checkEscape`) - Why: `matches`
  defines answer equality and its comment explicitly says the solver must verify uniqueness *against this same
  comparison*. `checkEscape` is why escape lands the moment the exit puzzle is solved.
- `lib/sim/index.ts` (whole file) - Why: the only legal import surface. Note `withUnlocked` et al. are
  deliberately **not** exported — the oracle must move state by resolving real actions, never by transition.
- `lib/schema/action.ts` (lines 35-80) - Why: the exact `Action` shapes the oracle constructs. Every action needs
  a non-empty `intent` under 280 chars, including the oracle's synthetic ones.
- `lib/rng.ts` (whole file) - Why: the fuzzer's only randomness source. Read the doc comment on why it has no
  upstream dependency.
- `fixtures/index.ts` (lines 48-90 `INVALID_ROOMS`) - Why: the test corpus, its `failsAtParse` flag, and the
  stated design that each entry breaks exactly one rule.
- `fixtures/rooms/valid/canonical-room.json` - Why: the room every threshold in this plan is calibrated against.
- `lib/sim/state.test.ts` (lines 20-55) - Why: the house pattern for hand-building a minimal spec in a test.
- `lib/sim/secrecy.test.ts` - Why: the house pattern for an adversarial contract test with a positive control.
- `lib/sim/fixture-replay.test.ts` - Why: the house pattern for asserting against the committed corpus by
  **code**, not by prose.
- `scripts/generate-fixtures.mts` (lines 1-20) - Why: how fixtures are produced, if you are ever tempted to
  change one. You should not be.

### New Files to Create

- `lib/solver/rejections.ts` - The machine-readable rejection vocabulary and constructor.
- `lib/solver/lexicon.ts` - Closed answer domains for prose puzzles.
- `lib/solver/derivation.ts` - Candidate extraction from clue text; derivability and uniqueness.
- `lib/solver/structure.ts` - Referential, ordering, exit, lock-agreement and answer-collision checks.
- `lib/solver/oracle.ts` - Knowledge-gated BFS over `lib/sim`; `minActions` and `intendedActions`.
- `lib/solver/difficulty.ts` - Band thresholds and estimate plausibility.
- `lib/solver/verify.ts` - The pipeline that orchestrates the five stages.
- `lib/solver/index.ts` - Narrow public seam.
- `lib/solver/fuzz.ts` - Seeded valid-room builder plus targeted mutators. Test support; **not** re-exported
  from `index.ts`.
- `lib/solver/lexicon.test.ts`, `derivation.test.ts`, `structure.test.ts`, `oracle.test.ts`,
  `difficulty.test.ts`, `verify.test.ts`, `corpus.test.ts`, `fuzz.test.ts`, `purity.test.ts`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [`architecture.md`](../../architecture.md) — *Missing pieces* ("gates the generator; nothing ships before it")
  and *Spikes & experiments · 1*. Why: this ticket's reason to exist, and the reason it must stay substrate-open.
- [`docs/tickets/llm-escape-room.md`](../../docs/tickets/llm-escape-room.md) — TICKET-3 and the *Scheduling note*.
  Why: v0 is unpinned until TICKET-7; do not build version-tolerant readers here.
- [`llm-escape-room.prd.md`](../../llm-escape-room.prd.md) — *Success metrics* (60–90s watch length, 60%
  divergence). Why: the difficulty band exists to keep rooms inside the watch target.
- [Zod 4 — `z.enum` and inferred types](https://zod.dev/api#enums) — Why: matches the `VERDICT_CODES` /
  `END_REASONS` pattern used for every other closed vocabulary in this repo.
- [Vitest 4 — `describe` / `it` / `expect`](https://vitest.dev/api/) — Why: the only test API in use; no
  `test.each` is used anywhere in this repo yet, prefer explicit `it` blocks with a loop where a table is needed
  (see `lib/sim/resolve.test.ts`).

### Patterns to Follow

**Closed vocabularies are a `const` tuple + a `z.enum` + an inferred type.** Mirror
`lib/schema/action.ts:95-107` and `lib/schema/run.ts:37-40`:

```ts
export const REJECTION_CODES = ['spec_version_mismatch', /* … */] as const;
export const RejectionCodeSchema = z.enum(REJECTION_CODES);
export type RejectionCode = z.infer<typeof RejectionCodeSchema>;
```

**A result is a discriminated union, never a throw, for an expected failure.** Mirror `lib/sim/resolve.ts`'s
`Resolution` and the run-budget decision in `lib/sim/budget.ts:5-20` — a rejected room is a *normal outcome* of
the generator loop, exactly as budget exhaustion is a normal outcome of a run:

```ts
export type SolverResult =
  | { readonly ok: true; readonly report: SolverReport }
  | { readonly ok: false; readonly rejections: readonly Rejection[] };
```

**Errors that are genuinely programmer errors get a named class.** Mirror `SimulatorError`
(`lib/sim/state.ts:42-49`) and `SchemaError` (`lib/schema/version.ts:44`). The solver should need at most one,
and arguably none — nearly everything is a `Rejection`.

**Purity and immutability.** Mirror `lib/sim/resolve.ts:18-30`: no clock, no `Math.random`, no mutation of
inputs. `lib/rng.ts` is the only randomness, and only in `fuzz.ts`.

**Doc comments carry the *why*, especially where a reader will think it is a bug.** Every file in `lib/sim/`
does this (see the `notFound` comment at `lib/sim/resolve.ts:59-69`). Match that density — this codebase's
comments are load-bearing, not decoration.

**Tests name the invariant, not the function.** `it('is referentially coherent — every id resolves')`, not
`it('works')`. See `fixtures/index.test.ts`.

**Imports use the `@/` alias** for cross-directory (`@/lib/schema/room`, `@/fixtures`) and relative paths within
a directory (`./state`). See any file in `lib/sim/`.

---

## IMPLEMENTATION PLAN

### Phase 1: Vocabulary and the derivation model

The two things everything else is expressed in: what a rejection *is*, and how a candidate answer is read out of
a clue. Build these first because every later stage produces the former and stage 4 depends on the latter.

**Tasks:** rejection codes and constructor; the answer lexicon; candidate extraction for both puzzle kinds.

### Phase 2: The static checks

**Depends on:** Phase 1 (emits `Rejection`s).
**Independent of:** Phase 3 — the oracle needs only the compiled state and the derivability map, not these checks.

Referential integrity, ordering, exit placement, lock agreement, answer collision.

### Phase 3: The oracle

**Depends on:** Phase 1 (needs the derivability map to gate knowledge).

Knowledge-gated BFS over `compileRoom` + `resolve`, producing `minActions`, `intendedActions` and both paths.

### Phase 4: Difficulty, chain integrity and the pipeline

**Depends on:** Phases 2 and 3 (chain and band are judged on the oracle's two numbers).

Band thresholds, estimate plausibility, chain gating, then `verify.ts` wiring all five stages and `index.ts`.

### Phase 5: Testing & validation

**Depends on:** Phase 4.

Unit tests per module, the committed-corpus contract test, the seeded fuzz property tests, and the
no-network/no-LLM purity assertion.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### CREATE `lib/solver/rejections.ts`

- **IMPLEMENT**: `REJECTION_CODES` as a `const` tuple, `RejectionCodeSchema`, `RejectionCode`, a `Rejection`
  interface `{ code, message, puzzleId?: string, objectId?: string }` (use `?:` here rather than the schemas'
  `null`-not-absent rule — this is an in-process diagnostic type, not a serialised contract), and a
  `reject(code, message, where?)` constructor. The codes, exactly:

  `spec_version_mismatch` · `spec_malformed` · `object_graph_invalid` · `dangling_reference` ·
  `puzzle_order_invalid` · `exit_not_last` · `lock_mismatch` · `answer_collision` · `answer_not_derivable` ·
  `answer_ambiguous` · `chain_broken` · `unsolvable` · `difficulty_out_of_band` ·
  `difficulty_estimate_implausible`

- **PATTERN**: `lib/schema/action.ts:95-107` (`VERDICT_CODES`), `lib/sim/simulator.ts:28-47` (an exported table
  with its reasoning written above it).
- **IMPORTS**: `zod`.
- **GOTCHA**: Do not model this as an `Error` subclass. A rejected room is an expected outcome of TICKET-5's
  loop, in the same way budget exhaustion is an expected outcome of a run (`lib/sim/budget.ts:5-20`). Throwing
  would force the generator into try/catch on its happy path.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #2 (machine-readable reasons)

### CREATE `lib/solver/lexicon.ts`

- **IMPLEMENT**: `ANSWER_DOMAINS` — a `Readonly<Record<string, readonly string[]>>` of closed answer domains for
  `kind: 'answer'` puzzles. v0 ships **two, deliberately narrow**: `direction` (north, south, east, west,
  northeast, northwest, southeast, southwest) and `colour` (black, white, red, green, blue, yellow, orange,
  purple, brown, grey). Plus `domainOf(answer): string | null` — the domain containing that answer, or null.
  Plus `tokenize(text): string[]` — lowercase, split on anything that is not a letter or digit, drop empties.
- **PATTERN**: `lib/sim/resolve.ts:44-56` — normalise by trimming and lowercasing, **and no further**. Tokenising
  is a split, not a normalisation: do not stem, strip accents, or singularise.
- **IMPORTS**: none.
- **GOTCHA**: Keep the lexicon **small**. Its only job in v0 is to decide whether a *competing* member of the
  answer's own domain is also present in the clue. A broad lexicon manufactures false ambiguity. Verify against
  the canonical logbook clue — `Every entry closes the same way: "departed, as always, to the north."` — whose
  tokens must yield exactly one `direction` member.
- **GOTCHA**: Token matching is **whole-token only**. `north` must not match inside `northern`. This is why
  `tokenize` exists rather than `String.includes`.
- **GOTCHA**: This file is TICKET-7's (#8) extension point. Write the doc comment so a future substrate adds a
  domain here rather than special-casing `derivation.ts`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #3 (answer uniqueness)

### CREATE `lib/solver/lexicon.test.ts`

- **IMPLEMENT**: `tokenize` splits on punctuation and quotes; `north.` → `north`; `northern` does not yield
  `north`; `domainOf('north') === 'direction'`; `domainOf('4471') === null`; every domain's members are
  lowercase, unique, and appear in no other domain (a word in two domains makes `domainOf` ambiguous).
- **PATTERN**: `lib/sim/state.test.ts` — small, named-invariant `it` blocks.
- **VALIDATE**: `pnpm test lib/solver/lexicon.test.ts`
- **SATISFIES**: AC #3

### CREATE `lib/solver/derivation.ts`

- **IMPLEMENT**: `candidatesFor(puzzle, clueText): string[]` and
  `checkDerivation(spec): { rejections: Rejection[]; derivable: ReadonlySet<string> }` where the set holds the
  ids of puzzles whose answer **is** present in its clue (regardless of uniqueness).

  Extraction rules:
  - `kind: 'code'` — every run of digits in the clue text whose **length equals `puzzle.answer.length`**.
  - `kind: 'answer'` — `domainOf(puzzle.answer)`, then every member of **that domain only** appearing as a whole
    token in the clue text. If the answer is in no domain, there are no candidates.

  Rejections:
  - answer not among the candidates → `answer_not_derivable` (carry `puzzleId`).
  - any candidate other than the answer → `answer_ambiguous` (carry `puzzleId`; name the competitor in the
    message — "the clue also supports 'south'").

- **PATTERN**: `lib/sim/resolve.ts` — a pure function returning data, one concern per branch.
- **IMPORTS**: `type { Puzzle, RoomSpec } from '@/lib/schema/room'`, `./lexicon`, `./rejections`.
- **GOTCHA**: **Scan only the answer's own domain for competitors, never all domains.** Scanning everything
  would flag the word "half" or a stray colour as ambiguity. This is the decision that keeps false rejections
  near zero and it will look like an arbitrary narrowing to a future reader — say so in the comment.
- **GOTCHA**: `clueText` is `string | null` (`lib/schema/room.ts` `RoomObjectSchema`). A `null` clue is
  `answer_not_derivable`, not a crash.
- **GOTCHA**: A puzzle whose `clueObjectId` does not resolve is handled by `structure.ts` as
  `dangling_reference`; here, treat a missing object as no clue text and move on. Do not double-report.
- **VALIDATE**: `pnpm test lib/solver/derivation.test.ts`
- **SATISFIES**: AC #2, AC #3

### CREATE `lib/solver/derivation.test.ts`

- **IMPLEMENT**: Against the canonical room — p1 candidates `['4471']`, p2 `['1770']`, p3 `['north']`, zero
  rejections. Against `loadInvalidRoom('unsolvable')` — p2 candidates `[]`, `answer_not_derivable` on `p2` and
  on nothing else. Against `loadInvalidRoom('ambiguous-answer')` — p3 candidates contain both `north` and
  `south`, `answer_ambiguous` on `p3` and on nothing else. Plus unit cases: a 3-digit answer ignores a 4-digit
  run in the clue; a `null` clue rejects; an answer in no lexicon domain rejects.
- **PATTERN**: `lib/sim/fixture-replay.test.ts` — assert against the committed corpus by code.
- **GOTCHA**: Load invalid fixtures through `loadInvalidRoom(name)` and narrow with `parseRoomSpec` — they are
  typed `unknown` on purpose. Only `version-mismatch` fails that parse.
- **VALIDATE**: `pnpm test lib/solver/derivation.test.ts`
- **SATISFIES**: AC #2, AC #3

### CREATE `lib/solver/structure.ts`

- **IMPLEMENT**: `checkStructure(spec): Rejection[]`, covering:
  - **Referential** — every `puzzle.clueObjectId`, `puzzle.unlocksObjectId`, `exit.objectId` resolves to an
    object; `exit.requiresPuzzleId` and every `solution.order` entry resolves to a puzzle → `dangling_reference`.
  - **Ordering** — `puzzles[].order` is exactly `1..N` with no gaps or repeats; puzzle ids are unique;
    `solution.order` equals the puzzle ids sorted by `order` → `puzzle_order_invalid`.
  - **Exit** — `exit.requiresPuzzleId` is the **last** entry of `solution.order` → `exit_not_last`.
  - **Lock agreement** — for `kind: 'code'`, `unlocksObjectId` must have a `lock` with `opensWith: 'code'` whose
    `code` equals `answer` under the simulator's comparison → `lock_mismatch`.
  - **Answer collision** — no two puzzles share an answer under trim+lowercase equality → `answer_collision`.
- **PATTERN**: `fixtures/index.test.ts:29-52` already asserts referential coherence and chain shape over the
  canonical room by hand — lift that shape into production code.
- **IMPORTS**: `type { RoomSpec } from '@/lib/schema/room'`, `./rejections`.
- **GOTCHA**: The collision comparison must be **exactly** `expected.trim().toLowerCase() === given.trim().toLowerCase()`
  — the same rule as `lib/sim/resolve.ts:55`, whose comment states the solver must verify uniqueness against it.
  Export a local `answersMatch` with a comment pointing at that line rather than importing (it is not exported
  from `lib/sim/index.ts`), and note in the comment that the two must be changed together.
- **GOTCHA**: Do **not** re-implement containment/cycle/duplicate-id checking here. `compileRoom` already does
  it and `verify.ts` converts its `SimulatorError` into `object_graph_invalid`.
- **VALIDATE**: `pnpm test lib/solver/structure.test.ts`
- **SATISFIES**: AC #2, AC #3, AC #4

### CREATE `lib/solver/structure.test.ts`

- **IMPLEMENT**: Canonical room → zero rejections. Then, from a hand-built minimal valid spec (mirror
  `lib/sim/state.test.ts:20-55`), one mutation per case: dangling `clueObjectId`, dangling `exit.objectId`, a
  gap in `order`, a duplicate puzzle id, `solution.order` disagreeing with `order`, exit not last, a `code`
  puzzle whose target has a key lock, a `code` puzzle whose lock code differs from its answer, two puzzles with
  answers differing only in case.
- **VALIDATE**: `pnpm test lib/solver/structure.test.ts`
- **SATISFIES**: AC #2, AC #4

### CREATE `lib/solver/oracle.ts`

- **IMPLEMENT**: `solveRoom(spec, { derivable, respectSolutionOrder }): OraclePath | null` where
  `OraclePath = { actions: Action[]; actionCount: number }`. A breadth-first search over
  `{ state: RoomState, known: Set<puzzleId> }`, expanding these moves, each costing exactly one action and each
  applied by calling `resolve(state, action)` from `lib/sim`:

  - `inspect(clueObjectId)` for any puzzle not yet known whose clue object is reachable **and whose id is in
    `derivable`** → adds the puzzle to `known`.
  - `enter_code(unlocksObjectId, answer)` for a known, unsolved `code` puzzle whose target is reachable.
  - `submit_answer(puzzleId, answer)` for a known, unsolved `answer` puzzle.
  - `take(keyItemId)` then `use(keyItemId, unlocksObjectId)` for a key lock, when the key is reachable.

  When `respectSolutionOrder` is true, a solving move is only expanded for the **next unsolved puzzle in
  `spec.solution.order`**. Goal test: `state.escaped`. Return the shortest path, or `null` if exhausted.

  Also export `minActionsFor(spec, derivable)` and `intendedActionsFor(spec, derivable)` as the two thin wrappers
  `verify.ts` calls.

- **PATTERN**: `lib/sim/index.ts` usage block (lines 8-14) — build, observe, apply. Here it is `compileRoom` +
  `resolve` directly, because the oracle is privileged and does not need the budget facade.
- **IMPORTS**: `{ compileRoom, resolve, isReachable, objectById } from '@/lib/sim'`,
  `type { Action } from '@/lib/schema/action'`, `type { RoomSpec } from '@/lib/schema/room'`.
- **GOTCHA**: **The knowledge gate is the whole point.** Without it every room is trivially solvable, because the
  oracle holds the answers. A puzzle becomes usable only after a successful `inspect` of its clue. Gate on
  *derivability* (answer present in the clue) and **not** on uniqueness — an ambiguous clue still teaches the
  answer, it just teaches more than one, and conflating the two would make `ambiguous-answer` report `unsolvable`
  as well and break the corpus's one-rule-per-fixture design.
- **GOTCHA**: Every synthetic `Action` needs a non-empty `intent` ≤ 280 chars (`lib/schema/action.ts:28-31`).
  Use something honest and short like `'oracle'` — these actions are never published.
- **GOTCHA**: **Never** import or call `withUnlocked` / `withSolved` / `withEscaped`. They are deliberately not
  exported from `lib/sim/index.ts` (`lib/sim/index.ts:16-26`) and an oracle that moved state directly would
  certify rooms the real engine cannot solve. Move state only through `resolve`.
- **GOTCHA**: `open` and `look` are **never** needed — reachability is gated on the lock, not on `open`
  (`lib/sim/state.ts:122-148`), and the oracle has no use for prose. Including them only inflates the branching
  factor. Say so in a comment, because a reader will ask.
- **GOTCHA**: Key the visited set on a canonical string of the *sorted* `unlocked`/`solved`/`held`/`known` sets
  plus `escaped`. `opened` can be omitted from the key since no oracle move depends on it. Cap expansion at a
  generous node limit (e.g. 50,000) and return `null` on overrun rather than hanging — a fuzzed spec must never
  hang the suite.
- **VALIDATE**: `pnpm test lib/solver/oracle.test.ts`
- **SATISFIES**: AC #1 (solvability), AC #5 (difficulty inputs)

### CREATE `lib/solver/oracle.test.ts`

- **IMPLEMENT**: Canonical room → `minActions === 6` and `intendedActions === 6`, and the returned path, replayed
  through a fresh `compileRoom` + `resolve`, ends escaped with every verdict `ok`. `broken-chain` →
  `minActions === 4`, `intendedActions === 6` (the orphaned sea-chart is a top-level shortcut). A room whose
  only clue is sealed inside the lock it opens → `null`. A hand-built key-lock room (mirror the `keyRoom` in
  `lib/sim/resolve.test.ts`) → solved via `take` + `use`. A puzzle absent from `derivable` → `null`.
- **GOTCHA**: The canonical optimum is `inspect ledger` → `enter_code wall-safe 4471` → `inspect sea-chart` →
  `enter_code cabinet 1770` → `inspect logbook` → `submit_answer p3 north`. If your BFS returns fewer than 6,
  the knowledge gate is not working; if more, a move is missing.
- **VALIDATE**: `pnpm test lib/solver/oracle.test.ts`
- **SATISFIES**: AC #1

### CREATE `lib/solver/difficulty.ts`

- **IMPLEMENT**: `DIFFICULTY_RANGES: Readonly<Record<DifficultyBand, { min: number; max: number }>>` =
  `easy 1–4`, `standard 5–12`, `hard 13–25`. Then
  `checkDifficulty(spec, { minActions, intendedActions }): Rejection[]`:
  - `intendedActions` must fall inside the declared band's range → `difficulty_out_of_band`.
  - **Only if that passes**, `minActions <= estimatedActions <= 3 * minActions` →
    `difficulty_estimate_implausible`.
- **PATTERN**: `lib/sim/simulator.ts:28-47` — a table with the reasoning that fixed its values written above it.
- **IMPORTS**: `type { RoomSpec } from '@/lib/schema/room'`, `./rejections`.
- **GOTCHA**: **Write down where these numbers came from.** The band is judged on the *intended* path, not the
  shortest, so that a broken chain reports `chain_broken` alone rather than also tripping the band. The
  thresholds are calibrated so the committed canonical room (intended 6, declared `standard`, estimate 14 ≤ 18)
  certifies **without any fixture changing** — four tickets are building against that corpus. TICKET-7 (#8)
  re-tunes these against real runs; until then they are a calibration, not a measurement, and the comment must
  say so.
- **GOTCHA**: Suppressing the estimate check when the band check already failed is deliberate — it keeps the
  `out-of-band-difficulty` fixture reporting exactly one code.
- **VALIDATE**: `pnpm test lib/solver/difficulty.test.ts`
- **SATISFIES**: AC #5

### CREATE `lib/solver/difficulty.test.ts`

- **IMPLEMENT**: Every band boundary, on both sides. Canonical numbers (intended 6 / est 14 / `standard`) pass.
  `easy` + intended 6 rejects. Estimate below `minActions` rejects. Estimate above `3 * minActions` rejects.
  A band failure suppresses the estimate rejection.
- **VALIDATE**: `pnpm test lib/solver/difficulty.test.ts`
- **SATISFIES**: AC #5

### CREATE `lib/solver/verify.ts`

- **IMPLEMENT**: `SolverReport = { minActions, intendedActions, band, solutionOrder, minPath, intendedPath }`,
  the `SolverResult` union, and two entry points:
  - `verifyRoom(raw: unknown): SolverResult` — parses first; a `RoomSpecError` becomes
    `spec_version_mismatch` when the failing issue path is `specVersion`, otherwise `spec_malformed`.
  - `verifySpec(spec: RoomSpec): SolverResult` — for callers holding a parsed spec.

  Pipeline, collecting rejections and short-circuiting only where a later stage genuinely cannot run:
  1. parse → abort on failure.
  2. `compileRoom` in a try/catch → `object_graph_invalid` and **abort** (nothing downstream can run).
  3. `checkStructure` → collect, continue.
  4. `checkDerivation` → collect, continue; keep the `derivable` set.
  5. `minActionsFor` / `intendedActionsFor`. If `intendedActions` is `null` → `unsolvable`; skip difficulty and
     the shortcut half of the chain check.
  6. **Chain integrity** → `chain_broken` when either: for consecutive `(P_i, P_i+1)` in `solution.order`,
     `P_i+1.clueObjectId` is not transitively contained within `P_i.unlocksObjectId`; or
     `minActions < intendedActions` (an off-chain shortcut exists, so the chain does not gate).
  7. `checkDifficulty`.

  `ok: true` only when the rejection list is empty.

- **PATTERN**: `lib/schema/room.ts:130-140` (`parseRoomSpec`) for the parse-don't-cast entry, and
  `lib/sim/simulator.ts` for a module that composes pure parts behind one seam.
- **IMPORTS**: all sibling modules, `{ parseRoomSpec, RoomSpecError } from '@/lib/schema/room'`,
  `{ compileRoom, SimulatorError } from '@/lib/sim'`.
- **GOTCHA**: Collect **all** rejections rather than failing fast. TICKET-5's loop regenerates on rejection and a
  full list makes a bad generator diagnosable in one pass instead of N.
- **GOTCHA**: The `unsolvable` fixture will legitimately produce **two** codes — `answer_not_derivable` on `p2`
  (the primary) and `unsolvable` (its consequence, since the oracle cannot learn a clue it cannot read). That is
  correct, and the corpus test asserts by *containment* of the primary code. Document it; a future reader will
  otherwise "fix" it.
- **VALIDATE**: `pnpm test lib/solver/verify.test.ts`
- **SATISFIES**: AC #1, #2, #3, #4, #5

### CREATE `lib/solver/index.ts`

- **IMPLEMENT**: Export `verifyRoom`, `verifySpec`, `REJECTION_CODES`, `RejectionCodeSchema`,
  `DIFFICULTY_RANGES`, `ANSWER_DOMAINS`, and the types `SolverResult`, `SolverReport`, `Rejection`,
  `RejectionCode`. Do **not** export `fuzz.ts`, the raw stage functions, or `solveRoom`.
- **PATTERN**: `lib/sim/index.ts` — including its practice of writing down *what is deliberately not exported
  and why*.
- **GOTCHA**: Keeping `solveRoom` internal matters: a caller that could run the oracle directly could publish a
  room's full solution path, which is every answer in order. That is the same class of leak `lib/sim` guards in
  `observation.ts`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #6

### CREATE `lib/solver/corpus.test.ts` — THE CONTRACT TEST

- **IMPLEMENT**: The committed corpus, asserted by code:
  - `loadCanonicalRoom()` → `ok: true`, `report.minActions === 6`, `report.intendedActions === 6`,
    `report.band === 'standard'`, and `report.intendedPath` replays to escape.
  - `unsolvable` → rejected, codes contain `answer_not_derivable` with `puzzleId === 'p2'`.
  - `ambiguous-answer` → rejected, codes are **exactly** `['answer_ambiguous']` with `puzzleId === 'p3'`.
  - `broken-chain` → rejected, codes are **exactly** `['chain_broken']`.
  - `out-of-band-difficulty` → rejected, codes are **exactly** `['difficulty_out_of_band']`.
  - `version-mismatch` → rejected via `verifyRoom` with `spec_version_mismatch`.
  - A loop over `INVALID_ROOMS` asserting every entry is rejected and the canonical room is not.
- **PATTERN**: `lib/sim/fixture-replay.test.ts` — this is that file's counterpart for TICKET-3 and is the
  single most important test in the ticket.
- **GOTCHA**: Three of the four use "exactly", `unsolvable` uses "contains" — see the cascade GOTCHA above. If
  any of the three "exactly" assertions needs loosening during implementation, **stop**: it means a threshold or
  a check is mis-specified, and loosening the test hides it.
- **VALIDATE**: `pnpm test lib/solver/corpus.test.ts`
- **SATISFIES**: AC #1, #2, #3, #4, #5, #7

### CREATE `lib/solver/fuzz.ts`

- **IMPLEMENT**: `buildValidRoom(rng, options?): RoomSpec` — assembles a chain of 1–4 puzzles: for each link, a
  clue object holding a derivable answer (a 4-digit code, or a `direction` member for the final `answer`
  puzzle), a locked container holding the next clue, a `door` exit, plus 0–3 decoy objects. Difficulty band
  derived from the resulting intended length so generated rooms are honest by construction. Plus `MUTATORS`, a
  named table of `(rng, spec) => RoomSpec` each breaking exactly one rule: `eraseClue`, `duplicateAnswer`,
  `severChain`, `inflateEstimate`, `misdeclareBand`, `danglingClueRef`, `reorderSolution`, `sealClueInOwnLock`.
- **PATTERN**: `lib/rng.ts` — `createRng(seed)`, and its doc comment on why there is no upstream dependency.
- **IMPORTS**: `{ createRng, type Rng } from '@/lib/rng'`, schema types.
- **GOTCHA**: `buildValidRoom` must be **deterministic given a seed** and must not mutate its input. No
  `Math.random`, no `Date.now()`.
- **GOTCHA**: Keep decoy objects' `clueText` free of `direction` and `colour` lexicon members, or a decoy will
  manufacture false ambiguity in a room the fuzzer believes is valid — and the property test will fail for the
  wrong reason.
- **GOTCHA**: Not re-exported from `index.ts`. It is test support that ships in `lib/` only because TICKET-5
  will want `buildValidRoom` for its stubbed-provider tests.
- **VALIDATE**: `pnpm test lib/solver/fuzz.test.ts`
- **SATISFIES**: AC #6

### CREATE `lib/solver/fuzz.test.ts` — THE PROPERTY TESTS

- **IMPLEMENT**: Over ~200 seeds (`seed-0` … `seed-199`, fixed, not time-derived):
  - **Property 1** — every `buildValidRoom` output certifies (`ok: true`). Any failure prints the seed.
  - **Property 2** — for every mutator, the mutated room is rejected, **and** the rejection list contains that
    mutator's expected code.
  - **Property 3** — `verifySpec` is deterministic: the same spec twice gives an identical result.
  - **Property 4** — `verifySpec` does not mutate its argument (deep-equal a structured clone taken before).
  - **Property 5** — no seed causes `verifySpec` to throw.
- **PATTERN**: `lib/rng.test.ts` — seeds are fixed and named in the test so a failure is reproducible.
- **GOTCHA**: Keep the seed count low enough that the suite stays fast (`vitest.config.mts` sets a 30s timeout;
  the whole suite currently runs in ~600ms). If 200 seeds is slow, reduce — a fast suite that runs is worth more
  than a thorough one that gets skipped.
- **GOTCHA**: On failure, include the seed in the assertion message. A property test that says "expected true,
  got false" with no seed is not reproducible and therefore not useful.
- **VALIDATE**: `pnpm test lib/solver/fuzz.test.ts`
- **SATISFIES**: AC #6

### CREATE `lib/solver/purity.test.ts`

- **IMPLEMENT**: Assert the ticket's "no LLM, no network" clause structurally: read every `lib/solver/*.ts`
  source file and assert none contains `fetch(`, `process.env`, `https://`, `require('http`, or an import from
  `lib/providers`. Also assert `verifySpec` runs with `globalThis.fetch` stubbed to a throwing function.
- **PATTERN**: `lib/sim/secrecy.test.ts` — an adversarial sweep over source, with the reasoning written down.
- **GOTCHA**: Use `node:fs` + `node:path` with a directory read, not a hard-coded file list, or a future file
  escapes the sweep silently. That is the same failure mode `observation.ts` warns about with spreads.
- **VALIDATE**: `pnpm test lib/solver/purity.test.ts`
- **SATISFIES**: AC #8

### UPDATE `README.md`

- **IMPLEMENT**: In the **Status** section, move the solver from "next wave" to built, and add one short
  paragraph under **Contracts** stating that `lib/solver/` certifies a room before it is ever run, listing the
  five properties it proves.
- **PATTERN**: The existing prose voice — plain, specific, no hype.
- **GOTCHA**: Do not touch the "The schemas are v0 and deliberately unpinned" paragraph. That is still true and
  stays true until TICKET-7.
- **VALIDATE**: `pnpm build`
- **SATISFIES**: AC #9

---

## TESTING STRATEGY

Vitest, `*.test.ts` colocated beside source, matching every other module in this repo. No new runner, no new
dependency. Target ≥45% test-to-source ratio per the ticket; `lib/sim/` came in at 59% and that is the house norm.

### Unit Tests

One file per module, asserting the named invariant rather than the function. Hand-built minimal specs for the
structure and oracle cases (mirror `lib/sim/state.test.ts:20-55`), because the committed fixtures are all
variations of one room and cannot exercise key locks, 1-puzzle chains, or deep containment.

### Integration Tests

`corpus.test.ts` is the integration test: the full pipeline against all six committed rooms, asserting the
**exact** rejection set for three of them. It is the file a reviewer should read first.

### Edge Cases

- A single-puzzle room (`solution.order` length 1; exit puzzle is also the first).
- A clue sealed inside the very lock its answer opens → `unsolvable`, not a hang.
- A key-lock chain (`take` + `use`), which the canonical room cannot exercise — the TICKET-2 report flags this
  same gap at `lib/sim/resolve.test.ts`'s `keyRoom`.
- An answer that is a lexicon member appearing *as a substring* of a longer word in the clue (`northern`).
- A `code` answer whose digit length collides with an unrelated number in the same clue.
- Two puzzles whose answers differ only in case or surrounding whitespace.
- A room where the exit puzzle is solvable before an earlier puzzle → `chain_broken` via the shortcut rule.
- An empty `clueText` (`null`) on a clue object.
- A deeply nested container chain (object in object in object), to confirm transitive containment.
- A spec with 4 puzzles, to confirm nothing assumes exactly 3.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
pnpm typecheck
```

There is no lint step in this project, by design (TICKET-1's report records it). `tsc --noEmit` under `strict`
is the style gate.

### Level 2: Unit Tests

```bash
pnpm test lib/solver
```

### Level 3: Integration Tests

```bash
pnpm test lib/solver/corpus.test.ts
pnpm test
```

The full suite must stay green at **220 existing + new**. Any change in the existing 220 means this ticket
touched something it should not have.

### Level 4: Manual Validation

```bash
pnpm build
```

```bash
node --import tsx -e "
import { verifyRoom } from './lib/solver/index.ts';
import { loadCanonicalRoom, loadInvalidRoom, INVALID_ROOMS } from './fixtures/index.ts';
const good = verifyRoom(loadCanonicalRoom());
console.log('canonical:', good.ok ? JSON.stringify(good.report) : good.rejections);
for (const r of INVALID_ROOMS) {
  const res = verifyRoom(loadInvalidRoom(r.name));
  console.log(r.name.padEnd(24), res.ok ? 'ACCEPTED (BUG)' : res.rejections.map(x => x.code).join(','));
}
"
```

Expected output: canonical accepted with `minActions: 6, intendedActions: 6`; `unsolvable` →
`answer_not_derivable,unsolvable`; `ambiguous-answer` → `answer_ambiguous`; `broken-chain` → `chain_broken`;
`out-of-band-difficulty` → `difficulty_out_of_band`; `version-mismatch` → `spec_version_mismatch`.

### Level 5: Additional Validation (Optional)

```bash
git diff --stat feature/room-simulator -- lib/schema fixtures lib/sim
```

Must print **nothing**. Compare against `feature/room-simulator` (this ticket's branch base), **not** `main` —
`main` is still at the docs-only commit, so diffing against it would show all of TICKET-1 and TICKET-2.
`lib/schema/`, `fixtures/` and `lib/sim/` are the wave-2 contract for four tickets and this ticket touches none
of them.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — Given a `RoomSpec`, the solver proves it is **solvable** by finding an action sequence that
      escapes it, played through `lib/sim`'s real `resolve()` under a knowledge gate.
- [ ] **AC #2** — Rejection is **machine-readable**: a closed `RejectionCode` vocabulary, with `puzzleId` /
      `objectId` where applicable, returned as data rather than thrown.
- [ ] **AC #3** — Each puzzle **answer is unique** — derivable from its clue and the only candidate that clue
      supports — and no two puzzles share an answer under the simulator's comparison.
- [ ] **AC #4** — The **chain is intact**: each answer genuinely unlocks the holder of the next clue, and no
      off-chain shortcut bypasses it.
- [ ] **AC #5** — The room falls inside a **difficulty band**, judged on the intended solution path, with a
      plausibility check on `estimatedActions`.
- [ ] **AC #6** — **Property tests** over hand-written valid specs, hand-written broken specs, and seeded fuzzed
      specs, all reproducible from fixed seeds.
- [ ] **AC #7** — All six committed fixture rooms resolve as specified, three of them to an **exact** single
      rejection code.
- [ ] **AC #8** — **Pure: no LLM, no network**, asserted structurally by a test that sweeps the source.
- [ ] **AC #9** — `pnpm typecheck` clean, `pnpm test` green with zero regressions in the existing 220,
      `pnpm build` passes, README updated.
- [ ] **AC #10** — No file outside `lib/solver/` is modified except `README.md`.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (220 existing + new, zero regressions)
- [ ] No type checking errors
- [ ] Manual Level 4 script prints the expected rejection codes
- [ ] Acceptance criteria all met
- [ ] `git diff --stat feature/room-simulator` confirms `lib/schema/`, `fixtures/` and `lib/sim/` untouched
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Settled at the planning gate** (all four with the user; do not reopen during implementation):

1. **Derivability uses a closed answer lexicon.** Prose answers are checked against `ANSWER_DOMAINS`, scanning
   only the answer's own domain for competitors. Chosen over a `answerDomain` schema field (which would force a
   v0 schema change and a fixture regeneration mid-wave-2) and over a quoted-span heuristic (brittle, pins the
   generator to a prose convention nothing enforces).
2. **The solver reuses `lib/sim`** rather than reimplementing reachability. "Solvable" therefore means solvable
   under the exact rules the race is run under. Consequence: branch off `feature/room-simulator`, not `main`.
3. **The difficulty band is tied to the optimal minimum**, measured on the **intended** (`solution.order`) path,
   with thresholds `easy 1–4 / standard 5–12 / hard 13–25` calibrated so the committed canonical room certifies
   unchanged. Plus `minActions <= estimatedActions <= 3 * minActions`, suppressed when the band check already
   failed.
4. **The fuzzer is hand-rolled on `lib/rng.ts`.** No `fast-check`, no new dependency, no second source of
   randomness.

**Assumptions this plan makes, worth confirming if they bite:**

- **The canonical room's optimum is 6 actions.** Derived by hand from `resolve.ts`'s rules: `inspect ledger`,
  `enter_code wall-safe 4471`, `inspect sea-chart`, `enter_code cabinet 1770`, `inspect logbook`,
  `submit_answer p3 north`. Every band threshold hangs off this number. **Verify it first**, in
  `oracle.test.ts`, before writing `difficulty.ts`. If the oracle says something else, the thresholds move — not
  the fixture.
- **The `unsolvable` fixture yields two rejection codes.** `answer_not_derivable` (primary) plus `unsolvable`
  (its consequence). This is the one place the corpus's "exactly one rule" design does not hold literally, and
  it is correct rather than a bug.
- **A v0 lexicon of two domains is enough.** It covers the committed corpus and the fuzzer. If TICKET-5's
  generator wants richer answers it extends `ANSWER_DOMAINS`; if TICKET-7 changes substrate it may replace the
  derivation strategy wholesale. Neither is this ticket's problem.
- **The difficulty thresholds are a calibration, not a measurement.** They were fitted to one room. TICKET-7
  (#8) re-tunes them against ~20 real instances per strategy. The comment in `difficulty.ts` must say so, or a
  future reader will treat them as empirical.

**Not blocking, but worth doing:** TICKET-1 and TICKET-2 are unmerged with issues #1 and #2 still open and no
PRs. Consider running `piv-create-pr` on `feature/scaffold-core-schemas-v0` and then `feature/room-simulator`
before or alongside this ticket, so wave 2's other branches (#4, #8) are not all stacked on an unreviewed base.

## NOTES (open canvas)

### Why the derivation/oracle split is the crux of this ticket

The naive reading of "prove it is solvable" is a graph search: can you reach the exit? Under that reading every
committed invalid fixture except `broken-chain` is *solvable*, because the solver holds every answer in
plaintext. The room is only genuinely solvable if a competitor who starts knowing nothing can **learn** each
answer by inspecting a clue. That is why derivation feeds the oracle rather than sitting beside it.

The line between them is drawn precisely:

| | gates the oracle? | rejection |
|---|---|---|
| answer absent from clue | **yes** — cannot be learned | `answer_not_derivable` (+ `unsolvable`) |
| clue supports two answers | **no** — it is still learnable | `answer_ambiguous` only |

That asymmetry is what keeps `ambiguous-answer` reporting one code. It looks arbitrary and is not.

### The two action counts, and why both are needed

`minActions` (any route) and `intendedActions` (the `solution.order` route) answer different questions:

- `intendedActions` is the honest difficulty of the room **as designed** — the number the band judges, and
  eventually the number that has to fit the PRD's 60–90 second watch target.
- `minActions` is what a competitor could actually get away with. When it is **less** than `intendedActions`,
  the chain is decorative: a shortcut exists, and the room does not gate the way its author claimed.

`broken-chain` is exactly that case (min 4, intended 6), which is why it gets `chain_broken` rather than a
difficulty complaint. Judging the band on `minActions` — the first reading of the user's chosen rule — would have
made that fixture trip two rules and broken the corpus's design. Measuring the intended path fixes it without
abandoning the rule.

### Rejected alternatives

- **A second, standalone reachability model in `lib/solver/`.** Would have given double-entry bookkeeping: two
  independent implementations catching each other. Rejected because a solver that certifies rooms the simulator
  cannot actually run is the worst available outcome — it would ship broken rooms to a published matchup and
  nothing would look wrong until a model got stuck. One engine, one truth.
- **A `.refine()` on `RoomSpecSchema`.** Tempting and wrong: `lib/schema/room.ts:22-38` explains that catching
  semantic breakage at parse time would destroy the solver's own test corpus, since the four invalid fixtures
  would then fail before the solver ever saw them.
- **`fast-check`.** Real shrinking is genuinely better than hand-rolled fuzzing. Rejected on the same reasoning
  `lib/rng.ts` gives for having no upstream: a reproducibility guarantee with a dependency is one somebody else
  can change, and this repo's fixtures are seed-derived.
- **Exposing `solveRoom` publicly.** Convenient for debugging, but its return value is every answer in order.
  Kept internal, for the same reason `lib/sim/index.ts` withholds the `with*` transitions.

### Sequencing risk

Phase 3 (oracle) is the only phase with real unknowns — the knowledge gate and the BFS state key. Phases 1, 2
and 4 are mechanical. If the oracle proves harder than expected, the fallback is **not** to weaken the knowledge
gate (that hollows out the whole ticket) but to narrow the move set further: `take`/`use` can be dropped
temporarily, since no committed fixture has a key lock, and reinstated with the hand-built `keyRoom` case.

### What TICKET-5 will import

```ts
import { verifyRoom, type SolverResult } from '@/lib/solver';

const result = verifyRoom(candidateFromModel);
if (!result.ok) {
  attempts.push(result.rejections.map((r) => r.code));   // feeds #8's quota analysis
  continue;                                              // regenerate
}
accept(result.report);                                   // minActions feeds variety + watch-length
```

Keep that call shape working. It is the only reason this module exists.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
