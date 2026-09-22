# Feature: Scaffold, core schemas (v0) and seeded determinism

The following plan should be complete, but it is important that you validate documentation and codebase patterns
and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files.

> **This repo has no code yet.** Every "existing pattern" referenced below lives in the sibling project
> `/Users/sachintha/projects/ai-job-application-agent`, which `architecture.md` names as the stack to match. Read
> those files — they are the house style this ticket is establishing here.

## Feature Description

Stand up the repository skeleton and define the schemas every other ticket codes against: `RoomSpec` v0,
`Event` v0, `ActionVocabulary`, `Competitor`, `Run`, `RunSummary`. Add a seeded RNG so `(seed, specVersion)`
reproduces a room exactly. Commit a golden fixture corpus — one valid room, one complete event log, and five
named invalid specs — which is the contract that lets TICKET-2, TICKET-3, TICKET-4 and TICKET-8 proceed in
parallel without any backend existing.

## User Story

As the builder
I want the room, event and run contracts fixed and exemplified by committed fixtures
So that four tickets can be built simultaneously against the same shapes without waiting for each other.

## Problem Statement

Nothing can be built in parallel until the contracts exist. The replay player, the simulator, the solver and the
provider adapters all read or write the same three shapes; if each ticket invents its own, wave 2 produces four
incompatible halves. There is also a scheduling hazard: the PRD names `RoomSpec` and the event log as one-way
doors, so defining them badly now is expensive, but they cannot be defined *well* until the gate spike reports.

## Solution Statement

Ship the schemas as **v0, explicitly unpinned**, with a fail-loud `z.literal(0)` version field and an empty
migrations seam beside them. Commit fixtures rich enough to serve as executable documentation — including an
invalid corpus whose rejection reasons become TICKET-3's test contract. Downstream tickets code against v0 and
expect exactly one migration, applied in TICKET-7 (#8) once the substrate question is settled.

## Out of Scope / Non-Goals

- **Not included: `RenderManifest`.** It belongs to #9 (TICKET-9); defining it now would guess at the renderer.
- **Not included: the generator's model-facing wire schema.** Per the Zod-style decision below, the looser
  model-output schema is defined in #6 (TICKET-5) and narrowed into `RoomSpec`. Do not add `.nullable()` fields
  to `RoomSpec` in anticipation of it.
- **Not included: any simulator logic.** No action *resolution*, no state machine — only the shape of an action
  and of the verdict an action produces. #2 owns resolution.
- **Not included: provider code.** No Groq or Gemini clients, no tool-spec compilation. #4 owns that; this
  ticket only defines the `ActionVocabulary` it will compile *from*.
- **Not included: React Three Fiber or `three`.** #5 (TICKET-8) installs them. This ticket must not, but it
  **must pin React compatibly** — see the GOTCHA in Task 1.
- **Not changing:** nothing. Greenfield.
- **No lint tooling.** The sibling project deliberately has no lint script; validation is typecheck + vitest.
  Do not add ESLint "for completeness".

## Feature Metadata

**Feature Type**: New Capability (foundational)
**Estimated Complexity**: Medium — low algorithmic difficulty, high contract-design consequence
**Primary Systems Affected**: `lib/schema/*`, `lib/rng.ts`, `fixtures/*`, root tooling config
**Dependencies**: zod, vitest, typescript, tsx, next (skeleton only), react/react-dom (pinned, see gotcha)

## Related Work

**Implements**: [#1](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/1) ·
**Epic**: [`llm-escape-room.prd.md`](../../llm-escape-room.prd.md) +
[`architecture.md`](../../architecture.md) + [breakdown](../../docs/tickets/llm-escape-room.md)

**Back-references**: none — this is the first ticket in the repo.

**Forward-references** (tickets that consume this ticket's output):

- [#2](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/2) simulator — consumes `RoomSpec`,
  `ActionVocabulary`, produces `Event`
- [#3](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/3) solver — consumes `RoomSpec` **and the
  invalid fixture corpus as its test contract**
- [#4](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/4) adapters — compiles `ActionVocabulary`
  into provider tool specs
- [#5](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/5) replay player — reads **only** the golden
  fixture event log; this is what makes it parallel-safe
- [#8](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/8) gate — promotes v0 → v1 through the
  migrations seam created here

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: YOU MUST READ THESE BEFORE IMPLEMENTING

All paths are under `/Users/sachintha/projects/ai-job-application-agent` (the sibling project whose conventions
this ticket ports over).

- `lib/schemas/job.ts` (lines 1-80) — **Why: the single most important file to read.** It documents the house
  Zod style *and its deliberate divergences*, the `z.literal` version pattern, and the "parse, don't cast"
  narrowing function. Mirror its comment density: it explains *why* a choice was made, not what the code does.
- `lib/schemas/job.ts` (line 57, `JOB_EXTRACTION_VERSION`) — Why: the exact fail-loud version idiom to copy.
- `lib/schemas/job.ts` (line 73, `JobExtractionError`) — Why: the named-error-per-schema-module pattern.
- `lib/schemas/job.test.ts` (lines 1-30) — Why: test shape — a typed complete fixture object at module scope,
  then `describe`/`it` asserting parse round-trips. Copy this structure.
- `vitest.config.mts` (whole file) — Why: the exact runner config to port, including the comment explaining that
  Vitest owns `*.test.ts` and Playwright owns `*.spec.ts`. Adapt the `include` globs to this repo's dirs.
- `tsconfig.json` (whole file) — Why: strict, `noEmit`, `moduleResolution: bundler`, `@/*` path alias.
- `package.json` (lines 1-40) — Why: **exact version pins, no carets**, on `next`, `react`, `react-dom`, `zod`;
  and note there is **no lint script**. Scripts use `tsx` for CLI entry points.

### New Files to Create

- `package.json` — pins, scripts (`dev`, `build`, `typecheck`, `test`)
- `tsconfig.json` — ported from sibling
- `vitest.config.mts` — ported from sibling, globs adjusted
- `next.config.ts` — minimal
- `app/layout.tsx`, `app/page.tsx` — the thinnest Next skeleton that builds
- `lib/schema/version.ts` — `SPEC_VERSION`, `LOG_VERSION`, shared version literals + error base
- `lib/schema/room.ts` + `lib/schema/room.test.ts` — `RoomSpec` v0
- `lib/schema/action.ts` + `lib/schema/action.test.ts` — `ActionVocabulary` v0, the concrete verb set
- `lib/schema/event.ts` + `lib/schema/event.test.ts` — `Event` v0
- `lib/schema/run.ts` + `lib/schema/run.test.ts` — `Competitor`, `Run`, `RunSummary`
- `lib/schema/migrations/README.md` — the seam #8 will fill; empty by design, explains why it exists
- `lib/rng.ts` + `lib/rng.test.ts` — seeded deterministic RNG
- `fixtures/rooms/valid/canonical-room.json`
- `fixtures/logs/canonical-run.json`
- `fixtures/rooms/invalid/{unsolvable,ambiguous-answer,broken-chain,out-of-band-difficulty,version-mismatch}.json`
- `fixtures/index.ts` + `fixtures/index.test.ts` — typed loaders that parse every fixture through its schema

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Zod 4 — object types](https://zod.dev/api?id=objects)
  - Specific section: `z.object` vs `z.strictObject`
  - Why: this ticket turns on that distinction; the sibling's comment at `lib/schemas/job.ts:26` explains which
    to use where, and this plan applies it to `RoomSpec`.
- [Zod 4 — literals](https://zod.dev/api?id=literals)
  - Why: the version field is `z.literal(0)` so a v1 payload fails loudly rather than half-parsing.
- [Vitest config — `include`](https://vitest.dev/config/#include)
  - Why: the glob must cover `{lib,fixtures,scripts}` and must not swallow `*.spec.ts`.
- [Next.js docs in `node_modules/next/dist/docs/`](https://nextjs.org/docs)
  - Why: **the sibling's `AGENTS.md` warns that this Next major differs from training data and that the local
    docs in `node_modules` are authoritative.** Read them before writing `app/` files, not the web docs.
- [React Three Fiber — installation / peer deps](https://r3f.docs.pmnd.rs/getting-started/installation)
  - Why: not installed here, but it constrains the React pin chosen in this ticket. See Task 1 GOTCHA.

### Patterns to Follow

**Zod style — the two-style split (from `lib/schemas/job.ts:26`):**

- `z.strictObject` + non-optional fields for **internal contracts we own**.
- `z.object` + `.nullable()` (never `.optional()`) for **anything a model emits**.
- `RoomSpec` in this ticket is the **internal contract** — `strictObject`, no optionals. The generator's looser
  model-facing schema is #6's problem and gets narrowed into this one.

**Version idiom (from `lib/schemas/job.ts:57`):**

```ts
/**
 * Bumped when the shape below changes incompatibly. Written as a `z.literal` in
 * the envelope so a payload from a future version fails LOUDLY on read instead of
 * half-parsing — a silent partial read of a changed contract is the failure mode
 * the version exists to prevent.
 */
export const SPEC_VERSION = 0;
```

**Narrowing, not casting (from `parseStoredExtraction` in `lib/schemas/job.ts`):** export a
`parseRoomSpec(raw: unknown): RoomSpec` that throws a named error, rather than letting callers cast.

**Named error per module:** `RoomSpecError`, `EventLogError`, `RunSummaryError`, each `extends Error`, each
carrying the Zod issue list.

**Test shape (from `lib/schemas/job.test.ts`):** a typed complete fixture at module scope, then `describe` per
exported schema, `it` per property. Assert parse round-trips with `toEqual`.

**Comment density:** high, and explanatory. The sibling's schema files spend 25 lines explaining *why* a shape
is the way it is, including a "do not tidy this into X" warning. Match that — these are contract files four
other tickets will read.

---

## IMPLEMENTATION PLAN

### Phase 1: Tooling skeleton

Get a repo that typechecks, tests and builds, with nothing in it.

**Tasks:** package manifest with exact pins · tsconfig · vitest config · minimal Next app · verify all three
commands pass on an empty codebase.

### Phase 2: Version seam and RNG

**Depends on:** Phase 1
**Independent of:** Phase 3 — these two could be done in either order, but the version constants are imported by
every schema, so doing them first avoids churn.

**Tasks:** `lib/schema/version.ts` · `lib/rng.ts` + tests proving determinism · `migrations/README.md`.

### Phase 3: The schemas

**Depends on:** Phase 2 (imports `SPEC_VERSION` / `LOG_VERSION`)

**Tasks:** `action.ts` first (the verb set is referenced by both room and event), then `room.ts`, then
`event.ts`, then `run.ts`. Each with its colocated test.

### Phase 4: The fixture corpus

**Depends on:** Phase 3 (fixtures must parse through the schemas)

This is the ticket's real deliverable. **Tasks:** the canonical valid room · the complete event log · the five
invalid specs · typed loaders · a test that parses every fixture and asserts each invalid one fails for its
*named* reason.

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Each task is atomic and independently testable.

### CREATE `package.json`

- **IMPLEMENT**: name `llm-escape-room`, private, type module. Scripts: `dev` (`next dev`), `build`
  (`next build`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`). Dependencies pinned exactly, no carets:
  `next@16.3.2`, `react@19.2.8`, `react-dom@19.2.8`, `zod@4.6.5`. Dev: `vitest@4.1.11`, `typescript@~7.0.2`,
  `tsx@^4.20.6`, `@types/node@^22`, `@types/react`, `@types/react-dom`.
- **PATTERN**: `ai-job-application-agent/package.json:1-40` — exact pins on runtime deps, carets only on dev
  tooling; **no lint script**.
- **GOTCHA**: **Do not install React `latest` (19.3.0).** `@react-three/fiber@9.7.0`, which #5 installs in wave
  2, peer-requires `react: >=19 <19.3`. Pinning 19.2.8 here keeps that ticket installable. This is the single
  highest-value line in this plan — the failure would surface in a different ticket, days later, and look
  unrelated.
- **GOTCHA**: `vitest@5.0.1` is published but the sibling runs `4.1.11`; stay on 4.x so the ported
  `vitest.config.mts` behaves identically.
- **VALIDATE**: `pnpm install && pnpm typecheck`
- **SATISFIES**: AC #1

### CREATE `tsconfig.json`

- **IMPLEMENT**: port the sibling's config verbatim — `strict`, `noEmit`, `moduleResolution: "bundler"`,
  `resolveJsonModule: true`, `jsx: "react-jsx"`, `paths: { "@/*": ["./*"] }`, the `next` plugin.
- **PATTERN**: `ai-job-application-agent/tsconfig.json`
- **GOTCHA**: `resolveJsonModule` is load-bearing here — the fixture loaders import `.json` directly.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1

### CREATE `vitest.config.mts`

- **IMPLEMENT**: port from the sibling, adjusting `include` to `['{lib,fixtures,scripts}/**/*.test.{ts,tsx}']`.
  Keep `environment: 'node'`, the `@` alias via `fileURLToPath`, and **keep the comment** explaining the
  Vitest-owns-`.test`, Playwright-owns-`.spec` split, so the convention survives into this repo.
- **PATTERN**: `ai-job-application-agent/vitest.config.mts` (whole file)
- **VALIDATE**: `pnpm test` (passes with zero tests found is acceptable at this point)
- **SATISFIES**: AC #1

### CREATE minimal Next skeleton — `next.config.ts`, `app/layout.tsx`, `app/page.tsx`

- **IMPLEMENT**: the thinnest app that builds. `page.tsx` renders a placeholder naming the project; no styling
  system, no fonts, no providers.
- **GOTCHA**: **Read `node_modules/next/dist/docs/` before writing these files.** The sibling's `AGENTS.md`
  states this Next major diverges from training data and that the bundled docs are authoritative. Do not write
  `app/` conventions from memory.
- **GOTCHA**: `next dev` writes an `AGENTS.md` rules block into the repo. Commit it with the work rather than
  fighting it — deleting it only recreates an uncommitted change.
- **VALIDATE**: `pnpm build`
- **SATISFIES**: AC #1

### CREATE `lib/schema/version.ts`

- **IMPLEMENT**: `export const SPEC_VERSION = 0` and `export const LOG_VERSION = 0`, each with the sibling's
  fail-loud explanatory comment. Also a shared `SchemaError extends Error` base carrying Zod issues, which the
  per-module errors extend.
- **IMPLEMENT**: a header comment stating plainly that **these are v0 and deliberately unpinned**, that #8 (the
  gate ticket) promotes them to v1, and that downstream code should expect exactly one migration.
- **PATTERN**: `ai-job-application-agent/lib/schemas/job.ts:57` and `:73`
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #5

### CREATE `lib/schema/migrations/README.md`

- **IMPLEMENT**: an empty-by-design seam. Explain that v0→v1 lands here in #8, that the version literals are
  `z.literal` so an unmigrated payload fails loudly, and what a migration module is expected to export.
- **GOTCHA**: do not write speculative migration code. The seam is documentation plus a directory; #8 fills it.
- **VALIDATE**: file exists; `pnpm typecheck` unaffected
- **SATISFIES**: AC #5

### CREATE `lib/rng.ts` + `lib/rng.test.ts`

- **IMPLEMENT**: a seeded PRNG implemented inline — mulberry32 over a string seed hashed with a small
  deterministic hash (e.g. cyrb128). Export `createRng(seed: string)` returning `{ next(): number,
  int(min, max): number, pick<T>(items: T[]): T, shuffle<T>(items: T[]): T[] }`. No global state; two
  generators from the same seed are independent and identical.
- **IMPORTS**: none — zero dependencies.
- **GOTCHA**: do not reach for `seedrandom` or `pure-rand`. This is ~20 lines, it must be byte-identical across
  Node versions and platforms forever, and owning it means the reproducibility guarantee has no upstream.
- **GOTCHA**: never use `Array.prototype.sort` with a random comparator for `shuffle` — it is biased and not
  reproducible across engines. Use Fisher-Yates driven by `next()`.
- **VALIDATE**: `pnpm test lib/rng.test.ts` — assert the same seed yields an identical first-20 sequence
  (hard-code the expected values so a future change to the algorithm fails loudly), that different seeds
  diverge, and that `shuffle` is a permutation.
- **SATISFIES**: AC #3

### CREATE `lib/schema/action.ts` + `lib/schema/action.test.ts`

- **IMPLEMENT**: the concrete v0 verb set as a discriminated union on `name`, every member carrying a
  **required `intent: string`** (the one-line why the model writes as it acts):
  - `look` — no args; survey the room
  - `inspect` — `{ targetId }`
  - `take` — `{ targetId }`
  - `open` — `{ targetId }`
  - `use` — `{ itemId, targetId }`
  - `enter_code` — `{ targetId, code }`
  - `submit_answer` — `{ puzzleId, answer }`
  Export `ActionSchema`, the inferred `Action` type, and `ACTION_NAMES` as a const array.
- **IMPLEMENT**: also the `Verdict` shape an action resolves to — `{ ok: boolean, code: VerdictCode, message:
  string }` where `VerdictCode` is an enum including at minimum `ok`, `not_found`, `locked`, `wrong_answer`,
  `malformed`, `not_permitted`. #2 resolves these; this ticket only names them.
- **PATTERN**: `z.strictObject` per member (internal contract, we own it). Discriminated union via
  `z.discriminatedUnion('name', [...])`.
- **GOTCHA**: `intent` is required on **every** member — it is the product feature, not a debug field. A test
  must assert that an action without `intent` fails to parse.
- **GOTCHA**: this verb set is concrete but **#2 may need to adjust it**. Say so in a comment so the simulator
  ticket knows it is allowed to, and knows to bump fixtures if it does.
- **VALIDATE**: `pnpm test lib/schema/action.test.ts`
- **SATISFIES**: AC #2

### CREATE `lib/schema/room.ts` + `lib/schema/room.test.ts`

- **IMPLEMENT**: `RoomSpecSchema` as `z.strictObject` with `specVersion: z.literal(SPEC_VERSION)`, `seed`,
  `roomId`, `theme`, `objects[]`, `puzzles[]` (ordered chain: each carries its `answer`, the `holderObjectId`
  whose clue yields it, and the `unlocksObjectId` it opens), `exit`, `difficulty { band, estimatedActions }`,
  and the `solution` graph the solver proves.
- **IMPLEMENT**: `parseRoomSpec(raw: unknown): RoomSpec` throwing `RoomSpecError`.
- **PATTERN**: `strictObject` + no optionals, per the Zod-style decision. Narrowing function mirrors
  `parseStoredExtraction` in `ai-job-application-agent/lib/schemas/job.ts`.
- **GOTCHA**: **do not add `.nullable()` fields here in anticipation of the generator.** The model-facing wire
  schema is #6's, and it narrows *into* this. Write that instruction as a "do not tidy this" comment, matching
  the sibling's convention at `lib/schemas/job.ts:26`.
- **GOTCHA**: `RoomSpec` carries the *answers*. Note in a comment that it must never be serialized into anything
  a competitor model can see — #2 owns that boundary, but the warning belongs on the type.
- **VALIDATE**: `pnpm test lib/schema/room.test.ts`
- **SATISFIES**: AC #2

### CREATE `lib/schema/event.ts` + `lib/schema/event.test.ts`

- **IMPLEMENT**: `EventSchema` as `z.strictObject` — `logVersion: z.literal(LOG_VERSION)`, `runId`,
  `competitorId`, `seq`, `action` (the `ActionSchema` union), `intent`, `verdict`, `latencyMs`, `tokens
  { prompt, completion }`, `at` (ISO string). Plus `EventLogSchema` = ordered array with a test asserting `seq`
  is contiguous per competitor.
- **GOTCHA**: **no beat index, no camera, no position.** Per the timing decision, the log stores real `latencyMs`
  and action counts only; beats are derived by the renderer and the beat plan lives in #9's render manifest.
  Storing pacing here would mean retuning the beat rate invalidates old logs — exactly what the manifest exists
  to prevent. Write that reasoning into the file.
- **VALIDATE**: `pnpm test lib/schema/event.test.ts`
- **SATISFIES**: AC #2

### CREATE `lib/schema/run.ts` + `lib/schema/run.test.ts`

- **IMPLEMENT**: `CompetitorSchema` (`id`, `provider`, `modelId`, `params`), `RunSchema` (`runVersion`, `runId`,
  `roomId`, `competitors`, `budget { maxActions, maxTokens, maxWallClockMs }`, `startedAt`, `summaries`,
  `typicalOfRepeats: z.boolean().nullable()`), and `RunSummarySchema` per competitor: `escaped`,
  `escapeActionCount`, `escapeMs`, `puzzlesSolved`, `failedAttempts`, `invalidActions`, `tokens`, `costUsd`,
  `endedBecause` (`escaped` | `budget_actions` | `budget_tokens` | `budget_time`).
- **GOTCHA**: `endedBecause` must make budget exhaustion a **recorded outcome**, not an exception — #2 depends
  on that distinction and the PRD counts it as a real result.
- **GOTCHA**: `typicalOfRepeats` is nullable because a run may have no repeats yet. It is the field #10 uses to
  disclose variance; do not drop it as unused.
- **VALIDATE**: `pnpm test lib/schema/run.test.ts`
- **SATISFIES**: AC #2

### CREATE the valid fixtures — `fixtures/rooms/valid/canonical-room.json`, `fixtures/logs/canonical-run.json`

- **IMPLEMENT**: one hand-authored room with a real 3-puzzle chain where each answer unlocks the object holding
  the next clue, and one complete event log of two competitors running it — **one escaping, one exhausting its
  action budget**, so the failure path is exemplified, not just the happy path. Every event carries a plausible
  one-line `intent` and a realistic `latencyMs`.
- **GOTCHA**: this log is what #5 builds the entire replay player against. It must be *interesting* — include at
  least one invalid action and one wrong answer, so the renderer has the failure states to display. A sterile
  log produces a renderer that cannot show the thing the product is about.
- **VALIDATE**: parsed by the loader test below
- **SATISFIES**: AC #4

### CREATE the invalid corpus — `fixtures/rooms/invalid/*.json`

- **IMPLEMENT**: five named specs, each broken in exactly one way: `unsolvable` (a puzzle whose clue appears
  nowhere), `ambiguous-answer` (two answers satisfy one puzzle), `broken-chain` (puzzle 2's clue is not inside
  what puzzle 1 unlocks), `out-of-band-difficulty` (`estimatedActions` far above any sane budget),
  `version-mismatch` (`specVersion: 1`).
- **GOTCHA**: each file breaks **one** rule only. #3 uses these to assert its rejection *reason*, not merely
  that rejection happened — a spec broken two ways cannot test which reason fired.
- **GOTCHA**: `version-mismatch` must fail at `parseRoomSpec` (the `z.literal`), while the other four parse fine
  and fail only in #3's solver. Assert that difference explicitly — it is the boundary between schema validity
  and semantic validity.
- **VALIDATE**: covered by the loader test
- **SATISFIES**: AC #4

### CREATE `fixtures/index.ts` + `fixtures/index.test.ts`

- **IMPLEMENT**: typed loaders — `loadCanonicalRoom(): RoomSpec`, `loadCanonicalLog(): Event[]`,
  `loadInvalidRoom(name): unknown`, plus an `INVALID_ROOMS` const listing each name with the reason it is
  expected to be rejected for.
- **IMPLEMENT**: the test asserts the valid room and log parse clean, that `seq` is contiguous per competitor,
  that `version-mismatch` throws `RoomSpecError`, and that the other four invalid specs **parse structurally**
  (documenting that they are the solver's problem, not the schema's).
- **GOTCHA**: export the loaders as typed functions, not raw JSON imports — downstream tickets should get
  `RoomSpec`, not `any`. This is the whole point of the fixtures being a contract.
- **VALIDATE**: `pnpm test fixtures/index.test.ts`
- **SATISFIES**: AC #4

### CREATE `README.md` update + `docs/` note

- **IMPLEMENT**: update the repo README's Status section to reflect that the scaffold and v0 contracts exist, and
  add a short "Contracts" paragraph pointing at `lib/schema/` and `fixtures/` as the parallel-work contract.
- **VALIDATE**: `pnpm typecheck && pnpm test && pnpm build`
- **SATISFIES**: AC #6

---

## TESTING STRATEGY

### Unit Tests

Colocated `*.test.ts` beside each module, per the sibling convention. A typed complete fixture object at module
scope, then `describe` per exported schema. Every schema gets: accepts-valid, rejects-unknown-key (proving
`strictObject`), rejects-wrong-version, and round-trips through `toEqual`.

### Integration Tests

`fixtures/index.test.ts` is the integration test for this ticket: it proves the committed corpus and the schemas
agree. That is the contract four other tickets rely on, so it is the test that must never be skipped.

### Edge Cases

- An action missing `intent` → parse failure (the field is a product feature, not optional).
- `specVersion: 1` → loud failure at `parseRoomSpec`, not a partial parse.
- Non-contiguous `seq` in a log → detected.
- Same RNG seed across two `createRng` instances → identical sequences (hard-coded expected values).
- `shuffle` on an empty array and a single-element array → no throw, correct result.
- A log whose competitor exhausted its budget → `endedBecause: 'budget_actions'`, `escaped: false`, and it
  parses as a valid, complete run.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm typecheck
```

There is intentionally no lint step — the sibling project has none, and this plan does not invent one.

### Level 2: Unit Tests

```bash
pnpm test
```

### Level 3: Integration Tests

```bash
pnpm test fixtures/index.test.ts
```

### Level 4: Manual Validation

```bash
pnpm build          # Next skeleton compiles
pnpm dev            # placeholder page renders
node --import tsx -e "import('./fixtures/index.ts').then(f => console.log(f.loadCanonicalRoom().puzzles.length))"
```

Expect `3` — the canonical room's puzzle chain length.

### Level 5: Additional Validation

```bash
gh issue view 1     # re-read the acceptance criteria and confirm each is met
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — pnpm + TypeScript + Next + vitest + Zod skeleton builds, typechecks and tests clean
- [ ] **AC #2** — `RoomSpec` v0, `Event` v0, `ActionVocabulary`, `Competitor`, `Run`, `RunSummary` exist as Zod
      schemas with inferred types and narrowing parse functions
- [ ] **AC #3** — seeded RNG reproduces identical sequences from the same seed, proven by hard-coded expected values
- [ ] **AC #4** — golden fixture room, complete fixture event log, and five single-fault invalid specs committed,
      all exercised by a loader test
- [ ] **AC #5** — version field present, asserted, fail-loud, with the migrations seam documented
- [ ] **AC #6** — README reflects the new state
- [ ] All validation commands pass with zero errors
- [ ] Code follows the sibling project's conventions (colocated tests, Zod two-style split, high comment density)
- [ ] React pinned to 19.2.x so #5 remains installable

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] `pnpm typecheck && pnpm test && pnpm build` all clean
- [ ] Manual validation prints `3`
- [ ] Acceptance criteria all met
- [ ] Fixtures reviewed for *interestingness*, not just validity (see the fixture GOTCHA)
- [ ] No speculative migration code written

---

## OPEN QUESTIONS / ASSUMPTIONS

**Settled during planning** (asked and answered, no longer open):

1. TICKET-1 ships a **concrete v0 verb set**, not just an action shape.
2. The fixture corpus includes the **five-file invalid corpus**, which becomes #3's test contract.
3. `RoomSpec` is the **internal `strictObject` contract**; the model-facing wire schema is #6's and narrows into it.
4. The log stores **real ms + action count**; beats are derived by the renderer, never stored.

**Assumed — confirm before execution:**

- **Assumed** — version ships as `z.literal(0)` plus an empty `lib/schema/migrations/` seam, rather than a
  migration-capable union from day one. Rationale: matches the sibling's fail-loud idiom while admitting a
  migration is already scheduled for #8.
- **Assumed** — single package, not a pnpm workspace. Inherited from `architecture.md` ("no server, no database,
  no auth in the MVP"; harness is a `tsx` CLI inside the same package). The sibling uses a workspace, so this is
  a deliberate divergence, not an oversight.
- **Assumed** — the seven-verb vocabulary above is the right v0 set. #2 is explicitly permitted to adjust it and
  bump the fixtures; the comment in `action.ts` must say so.
- **Assumed** — `costUsd` stays on `RunSummary` even though the free-tier target is $0 marginal, because the PRD
  tracks cost per run as a guardrail metric.

**Still genuinely open, deferred by design:**

- The v0 → v1 migration's shape — #8 owns it, and cannot know it until the substrate spike reports.
- Whether `difficulty.band` is an enum or a numeric range — #3 and #8 will have opinions; v0 should pick the
  simpler one and let the gate ticket refine it.

---

## NOTES (open canvas)

**Why this ticket is worth over-investing in.** It is the only ticket whose output four other tickets consume
simultaneously. Every hour spent making the fixtures realistic buys parallel throughput in wave 2 — and every
shortcut here shows up as four merge conflicts later. The fixtures are not test data; they are the interface.

**The React pin is the sharpest edge in the plan.** `@react-three/fiber@9.7.0` peer-requires `react >=19 <19.3`
while npm's `latest` React is 19.3.0. An agent installing "the latest React" here produces a repo where #5 cannot
install its own dependencies, and the error surfaces in a different ticket, in a different week, pointing at R3F
rather than at this decision. The sibling project already sits at 19.2.8, which is why matching its pins exactly
is the instruction rather than "install current versions."

**On owning the RNG.** Twenty lines of mulberry32 with a hard-coded expected sequence in the test is a stronger
reproducibility guarantee than any dependency, because the guarantee has no upstream that can change it. The
test that hard-codes the first twenty values is doing real work: it turns "we use a seeded RNG" into "this exact
sequence, forever, or the build fails."

**Alternative weighed and rejected: defining schemas inside the tickets that use them.** It would be faster per
ticket and would avoid guessing at shapes before the engine exists. Rejected because it serialises wave 2 — the
replay player is the thing most worth building early (the PRD's thesis is that the watchable part *is* the
product), and it can only start early if a realistic event log exists before any backend does.

**A note on the failure path in the fixture log.** It is tempting to author a clean escape for both competitors.
Don't. The renderer needs to display wrong answers, invalid actions and budget exhaustion, and if the fixture
never contains them, #5 will ship a player that cannot render the states that make a run interesting — which is
precisely the divergence the whole product exists to show.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty at creation. -->
