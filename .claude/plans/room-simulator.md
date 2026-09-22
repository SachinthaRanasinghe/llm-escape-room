# Feature: Room simulator and action resolution

The following plan should be complete, but it is important that you validate documentation and codebase patterns
and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files.

> **The contracts this ticket codes against already exist**, committed by
> [#1](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/1) on `feature/scaffold-core-schemas-v0`.
> Read `lib/schema/*` before writing anything — this ticket adds no schemas, it *implements* the one thing those
> schemas describe but do not do.

## Feature Description

Compile a `RoomSpec` into a state machine and resolve every action in the v0 vocabulary against it, returning a
`Verdict`. Enforce the run budget on actions, tokens and wall clock, recording exhaustion as a failure to escape
rather than throwing. Malformed and illegal actions return a clear verdict **and consume a turn**. The simulator
is the sole authority on room state and the sole channel back to a competitor — it must never leak an answer, a
lock code, or the contents of a locked container into anything a model can see.

## User Story

As the run harness
I want one object that owns room state and answers actions with verdicts
So that two models can race the same room fairly, without either of them — or me — being able to see the answers.

## Problem Statement

`RoomSpec` carries every answer in plaintext. The event log carries every verdict. Between them sits the thing
that decides what a model is told, and nothing in the repo does that yet. Until it exists there is no run, no
log worth writing, and no way to find out whether two models actually diverge — the question the whole product
is built to answer.

Two properties make it load-bearing rather than incidental. **Fairness**: both competitors must meet identical
rules, so resolution has to be deterministic and free of wall-clock reads. **Secrecy**: the simulator holds the
spec and talks to the model, so it is the only place a leak can happen, and a leak would silently invalidate
every result the project ever publishes.

## Solution Statement

A pure core behind a small stateful facade. `compileRoom` turns a `RoomSpec` into a `RoomState` with a
containment index and a reachability rule; `resolve(state, action)` is a pure function returning a verdict and
the next state; a `BudgetLedger` tallies the three caps; `createSimulator` binds them into the object the harness
drives, one instance per competitor.

The verdict semantics are not invented here — they are **read off the golden fixture log**, which already
demonstrates every code the simulator can return. The headline test replays that log action by action and
asserts the simulator agrees with it, then asserts the counters it derives match the committed run record. That
turns ticket 1's fixtures from documentation into an executable specification.

## Out of Scope / Non-Goals

- **Not included: writing `Event` records or the event log.** The simulator returns verdicts; #7 (TICKET-6) is
  what stamps `seq`, `runId`, `at` and appends. Do not import `parseEventLog` here.
- **Not included: any provider call, prompt, or tool-spec.** The simulator never speaks to a model. #4 owns the
  adapters and #7 owns the loop between them.
- **Not included: solving or verifying a room.** Whether a room *can* be escaped is #3's question. The simulator
  assumes the spec it is handed is solvable and does not check.
- **Not included: `costUsd`.** The simulator does not know provider pricing. It tallies everything else and
  returns `Omit<RunSummary, 'costUsd'>`; #7 adds the money.
- **Not changing: `lib/schema/*`.** Per the ticket-2 licence in `lib/schema/action.ts`, the verb set was
  reviewed and **left unchanged** — it covers the canonical room end to end. If resolution proves something
  unexpressible, stop and raise it rather than quietly bumping the union, because four tickets build on it.
- **Not changing: `fixtures/*`.** The fixture corpus is the contract being validated against, not an output.
  A change here means a change to #3, #4 and #8.
- **No lint tooling.** Validation is `pnpm typecheck` + `pnpm test`, per the house convention.

## Feature Metadata

**Feature Type**: New Capability (core engine)
**Estimated Complexity**: Medium-High — the logic is small, the invariants are not
**Primary Systems Affected**: `lib/sim/*` (new); reads `lib/schema/*` and `fixtures/*`
**Dependencies**: zod (already pinned), vitest. **No new packages.**

## Related Work

**Implements**: [#2](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/2) ·
**Epic**: [`llm-escape-room.prd.md`](../../llm-escape-room.prd.md) +
[`architecture.md`](../../architecture.md) + [breakdown](../../docs/tickets/llm-escape-room.md)

**Back-references** (what this ticket consumes):

- [#1](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/1) — `RoomSpec`, `ActionSchema`,
  `VerdictSchema`, `RunSummary`, and the golden fixtures this ticket is tested against.

**Forward-references** (tickets that consume this ticket's output):

- [#7](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/7) run harness — drives the simulator, feeds
  it token counts and elapsed time, and turns its verdicts into events.
- [#8](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/8) gate spike — runs this across ~20
  generated instances per strategy to measure divergence.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: YOU MUST READ THESE BEFORE IMPLEMENTING

- `lib/schema/room.ts` (whole file) — **Why: the shape being compiled, and the secrecy warning this ticket is
  the enforcement of.** Note that `RoomObject.contains` holds ids, `lock` is a nullable discriminated union on
  `opensWith`, and `clueText` is nullable. Note too that the schema does **no** referential checking — a
  `contains` entry naming a missing object is structurally legal, so `compileRoom` must not assume otherwise.
- `lib/schema/action.ts` (whole file) — Why: the seven verbs, their argument names (`targetId`, `itemId`,
  `code`, `puzzleId`, `answer`), the eight `VERDICT_CODES`, and the `Verdict` shape to return. Also the note that
  invalid actions consume a turn.
- `lib/schema/run.ts` (whole file) — Why: `RunSummary` is what `summarise()` must fill, and `END_REASONS`
  fixes the budget vocabulary. Read the comment on `endedBecause`: budget exhaustion is an outcome, not a throw.
- `fixtures/logs/canonical-run.json` (whole file) — **Why: the executable specification.** Every verdict the
  simulator can return appears here at least once, in context. Where this plan and the fixture disagree, the
  fixture is right.
- `fixtures/runs/canonical-run.json` (whole file) — Why: the counters `summarise()` must reproduce, including
  the budget (`maxActions: 14`) that ends model-b.
- `fixtures/index.ts` (whole file) — Why: load through `loadCanonicalRoom()` / `loadCanonicalLog()` /
  `loadCanonicalRun()`, never by importing the JSON. The comment says so explicitly.
- `lib/rng.ts` (whole file) — Why: available if resolution ever needs a coin flip. **It should not.** Read it to
  confirm the determinism idiom, then do not import it.
- `lib/schema/room.test.ts` (lines 1-30) — Why: the house test shape — a typed complete fixture at module scope,
  `describe` per unit, `it` per property.

### New Files to Create

- `lib/sim/state.ts` + `lib/sim/state.test.ts` — `compileRoom`, `RoomState`, reachability, containment index
- `lib/sim/observation.ts` + `lib/sim/observation.test.ts` — the competitor-visible view; the secrecy boundary
- `lib/sim/resolve.ts` + `lib/sim/resolve.test.ts` — the pure per-verb resolution table
- `lib/sim/budget.ts` + `lib/sim/budget.test.ts` — the three-cap ledger and its end reasons
- `lib/sim/simulator.ts` + `lib/sim/simulator.test.ts` — the stateful facade the harness drives
- `lib/sim/secrecy.test.ts` — the adversarial sweep proving no answer, code or hidden clue escapes
- `lib/sim/fixture-replay.test.ts` — replays the golden log and reproduces the committed run summaries
- `lib/sim/index.ts` — the barrel #7 and #8 import from

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Zod 4 — discriminated unions](https://zod.dev/api?id=discriminated-unions)
  - Why: `Action` and `Lock` are both discriminated unions; exhaustive `switch` over the discriminant with a
    `never` fallthrough is how resolution stays total when the union grows.
- [Zod 4 — `safeParse`](https://zod.dev/api?id=safeparse)
  - Why: the facade takes `unknown` and must return a `malformed` verdict instead of throwing. `parseAction`
    throws by design, so the facade uses `ActionSchema.safeParse` directly.
- [TypeScript — exhaustiveness checking](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
  - Why: the `assertNever` default arm is what makes a future verb a compile error rather than a silent `ok`.

### Patterns to Follow

**Comment density (from `lib/schema/room.ts`):** high and explanatory — *why*, not *what*, including explicit
"do not tidy this into X" warnings. These files are read by the two tickets that depend on them.

**Parse, don't cast (from `parseRoomSpec`):** the facade's public entry takes `unknown` and narrows. Internal
functions take already-narrowed types and never re-validate.

**Named error per module (from `SchemaError`):** `SimulatorError extends Error` for *programmer* errors only —
a spec whose `contains` names a missing object, `apply` after the run ended. A *competitor's* mistake is never
an exception; it is a verdict.

**Absence is a value (from `RunSummary.escapeActionCount`):** `null`, never `undefined`, never a missing key.

---

## IMPLEMENTATION PLAN

### Phase 1: State and reachability

The compiled room and the one rule that decides what a competitor can touch. Everything else reads it.

### Phase 2: Resolution

**Depends on:** Phase 1. The pure verdict table, one arm per verb, no state mutation in place.

### Phase 3: Budget and facade

**Depends on:** Phase 2. The ledger, then the stateful object that binds state + resolution + ledger and derives
the run summary.

### Phase 4: The proofs

**Depends on:** Phase 3. The two tests that are this ticket's real deliverable — the secrecy sweep and the
fixture replay. Neither is a unit test; both are contract tests, and either failing means the ticket is not done.

---

## STEP-BY-STEP TASKS

Execute in order, top to bottom. Each task is atomic and independently testable.

### CREATE `lib/sim/state.ts` + `lib/sim/state.test.ts`

- **IMPLEMENT**: `compileRoom(spec: RoomSpec): RoomState`. `RoomState` is a plain readonly record:
  `{ spec, unlocked: ReadonlySet<string>, opened: ReadonlySet<string>, held: ReadonlySet<string>,
  solved: ReadonlySet<string>, escaped: boolean }`, plus a precomputed `holderOf: ReadonlyMap<string, string>`
  built by inverting every object's `contains`.
- **IMPLEMENT**: `isReachable(state, objectId): boolean` — **the single gating rule**:
  an object is reachable when it is top-level (no holder), or when its holder is reachable **and its holder is
  not currently locked**. An object with `lock: null` is never locked; a locked object becomes unlocked by
  entering its code or using its key.
- **IMPLEMENT**: `isLocked(state, objectId)`, `objectById(state, id)`, and pure transition helpers
  (`withUnlocked`, `withOpened`, `withHeld`, `withSolved`, `withEscaped`) that each return a **new** state.
- **GOTCHA**: **reachability is gated on the LOCK, not on `open`.** The golden log settles this: at `seq 5`
  model-b inspects `ledger` and gets `ok`, having never opened the `desk` that contains it — the desk is
  unlocked ("its drawer hanging open"), so its contents are in reach. Gating on `open` instead would turn that
  event into `not_found` and force a regeneration of a corpus four tickets build against. `open` still matters:
  it is what *reveals* contents in the message and what returns `locked`.
- **GOTCHA**: `RoomSpecSchema` does **no** referential checking, so `contains` may name an id that does not
  exist and two objects may both claim the same child. `compileRoom` must throw `SimulatorError` on both — this
  is a broken *spec*, a programmer error, not a competitor's mistake. Guard the containment cycle too: a cycle
  would make `isReachable` recurse forever. Walk to a fixed depth or track visited ids.
- **GOTCHA**: no `Date.now()`, no `Math.random()`, no mutation of the input `RoomSpec`. Two runs of the same
  action sequence must produce byte-identical verdicts, forever.
- **VALIDATE**: `pnpm test lib/sim/state.test.ts` — assert reachability before and after unlocking the safe;
  assert an unlocked container's contents are reachable without `open`; assert a dangling `contains` id and a
  containment cycle each throw `SimulatorError`; assert every `with*` helper leaves the original state untouched.
- **SATISFIES**: AC "compile a `RoomSpec` into a state machine"

### CREATE `lib/sim/observation.ts` + `lib/sim/observation.test.ts`

- **IMPLEMENT**: `observe(state): Observation` — what a competitor is allowed to know:
  `{ theme: { name, description }, visible: Array<{ id, name, description, locked: boolean, opened: boolean }>,
  held: Array<{ id, name }>, puzzlesSolved: number, actionsRemaining: number }`.
- **IMPLEMENT**: `describeRoom(state): string` — the prose `look` returns, built from `visible`.
- **GOTCHA**: **`clueText` is not in an `Observation`.** It is revealed only by a successful `inspect`, one
  object at a time — that is what makes `inspect` a real move rather than a formality, and what makes the puzzle
  chain cost actions.
- **GOTCHA**: build the observation by **listing the fields to include**, never by spreading a `RoomObject` and
  deleting the secrets. A spread is one forgotten `delete` away from publishing a lock code, and the next field
  added to `RoomObject` would leak silently. Write that reasoning into the file.
- **GOTCHA**: `visible` contains only *reachable* objects. An object inside a locked safe is not merely
  uninteresting — a competitor must not learn it exists.
- **VALIDATE**: `pnpm test lib/sim/observation.test.ts` — assert the serialised observation of a fresh canonical
  room contains none of `4471`, `1770`, `north`; assert `sea-chart` is absent before the safe is unlocked and
  present after; assert `look` names the five top-level objects.
- **SATISFIES**: AC "never leaks room internals"

### CREATE `lib/sim/resolve.ts` + `lib/sim/resolve.test.ts`

- **IMPLEMENT**: `resolve(state: RoomState, action: Action): { verdict: Verdict; state: RoomState }` — pure, one
  `switch` arm per verb, `assertNever` in the default. The table:

  | verb | outcome | verdict |
  |---|---|---|
  | `look` | always | `ok` — `describeRoom(state)` |
  | `inspect` | reachable | `ok` — `clueText ?? description` |
  | | unknown or unreachable id | `not_found` |
  | `take` | reachable, `kind === 'portable'` | `ok` — adds to `held` |
  | | not portable | `not_permitted` |
  | | unknown or unreachable id | `not_found` |
  | `open` | reachable, openable kind, not locked | `ok` — adds to `opened`, names contents |
  | | reachable but locked | `locked` |
  | | `portable` / `fixture` | `not_permitted` |
  | | unknown or unreachable id | `not_found` |
  | `use` | holds `itemId`, target has a matching key lock | `ok` — unlocks, may solve a puzzle |
  | | not holding `itemId` | `not_holding` |
  | | target has no lock, or a code lock | `not_permitted` |
  | | holds a *different* key | `locked` |
  | | unknown or unreachable target | `not_found` |
  | `enter_code` | reachable, code lock, code matches | `ok` — unlocks, may solve a puzzle |
  | | code does not match | `wrong_code` |
  | | no lock, or a key lock | `not_permitted` |
  | | unknown or unreachable id | `not_found` |
  | `submit_answer` | puzzle exists, answer matches | `ok` — solves, unlocks `unlocksObjectId` |
  | | answer does not match | `wrong_answer` |
  | | unknown `puzzleId` | `not_found` |

- **IMPLEMENT**: puzzle solving as a consequence, not a separate verb. When `enter_code` or `use` unlocks object
  X, mark solved any unsolved puzzle whose `unlocksObjectId === X`. When `submit_answer` matches, mark that
  puzzle solved and unlock its `unlocksObjectId`. After any resolution, set `escaped` when
  `exit.requiresPuzzleId` is solved.
- **IMPLEMENT**: answer and code comparison **trimmed and case-insensitive**, as `lib/schema/room.ts` promises
  on `Puzzle.answer`. Do not normalise further — stripping punctuation or spaces would quietly widen what counts
  as correct, and #3 verifies answer *uniqueness* against this exact comparison.
- **GOTCHA**: **escape happens the moment the exit puzzle is solved**, not on a later `open` of the door. The
  golden log ends model-a at `submit_answer p3` with `escapeActionCount: 13`; requiring a fourteenth `open door`
  would contradict the committed run record.
- **GOTCHA**: verdict **messages are this module's own prose and will not match the fixture's**, which was
  hand-authored for the replay player. That is fine and expected — see the replay test's comparison rule. Every
  message must still be non-empty and written *to the competitor*, in the room's voice.
- **GOTCHA**: an unreachable-but-existing object returns `not_found`, deliberately indistinguishable from an
  object that does not exist. Saying "that is in the safe" would hand the model a map of the room for free.
  Write the reasoning down; it will look like a bug to a future reader.
- **GOTCHA**: `resolve` must not touch the budget. It does not know how many actions remain and must not care —
  keeping it budget-free is what lets it be tested exhaustively without constructing a ledger.
- **VALIDATE**: `pnpm test lib/sim/resolve.test.ts` — at least one case per row of the table above, plus: the
  same `(state, action)` resolves identically twice; `resolve` never mutates the state passed in; a correct code
  on the safe marks `p1` solved; `submit_answer` on `p3` sets `escaped`.
- **SATISFIES**: AC "resolve every action in the vocabulary and return a verdict"

### CREATE `lib/sim/budget.ts` + `lib/sim/budget.test.ts`

- **IMPLEMENT**: `createLedger(budget: Run['budget'])` and a pure `chargeLedger(ledger, cost: ActionCost)`
  returning `{ ledger, exhausted: EndReason | null }`, where
  `ActionCost = { tokens: { prompt: number; completion: number }; elapsedMs: number }`.
- **IMPLEMENT**: check the caps in `END_REASONS` order — `budget_actions`, then `budget_tokens`, then
  `budget_time` — so a run that trips two at once reports the same reason every time.
- **GOTCHA**: **the ledger is charged for every action, including malformed and illegal ones.** That is the
  ticket's explicit rule: using the interface correctly is part of the task.
- **GOTCHA**: **the simulator does not read the clock.** Wall clock is reported by the harness as
  `cost.elapsedMs` per action and accumulated here. A `Date.now()` inside the simulator would make replays
  non-reproducible and make the two competitors' budgets depend on machine speed.
- **GOTCHA**: exhaustion is reported, never thrown — `lib/schema/run.ts` says so and the PRD counts it as a real
  result. The ledger returns a reason; only the facade decides the run is over.
- **VALIDATE**: `pnpm test lib/sim/budget.test.ts` — exhausting exactly at the cap ends the run (the golden run
  ends model-b at its 14th action with `maxActions: 14`); tokens and time each end it independently; a run
  tripping two caps at once reports `budget_actions`.
- **SATISFIES**: AC "enforce the run budget; budget exhaustion is a recorded failure"

### CREATE `lib/sim/simulator.ts` + `lib/sim/simulator.test.ts`

- **IMPLEMENT**: `createSimulator({ spec, budget, competitorId }): Simulator` with:
  - `observe(): Observation`
  - `apply(raw: unknown, cost: ActionCost): { action: Action | null; verdict: Verdict; ended: EndReason | null }`
  - `summarise(): Omit<RunSummary, 'costUsd'>`
  - `hasEnded(): boolean`
- **IMPLEMENT**: `apply` parses `raw` with `ActionSchema.safeParse`. On failure it returns
  `{ action: null, verdict: { ok: false, code: 'malformed', message: <the Zod issues, readably> }, ... }` and
  **still charges the ledger**. On success it resolves, advances state, charges, and returns.
- **IMPLEMENT**: `summarise()` derives from the tallies: `escaped`, `escapeActionCount` / `escapeMs` (`null`
  unless escaped), `puzzlesSolved`, `failedAttempts`, `invalidActions`, `tokens`, `endedBecause`.
- **IMPLEMENT**: **the counter classification, read off the committed run record.** `fixtures/runs/canonical-run.json`
  gives model-b `failedAttempts: 2`, `invalidActions: 1` against a log containing two `wrong_code`, one
  `not_found` and one `locked`. Therefore:
  - `wrong_answer`, `wrong_code` → `failedAttempts` — the model understood the interface and was wrong.
  - `not_found`, `malformed`, `not_permitted`, `not_holding` → `invalidActions` — the model misused the interface.
  - `locked` → **neither.** Trying a door to see whether it is locked is legitimate play, and model-a does it at
    `seq 5` while scoring zero of both.
  Encode that mapping as one exported `const` table with this reasoning above it, not as scattered `if`s.
- **GOTCHA**: **one simulator per competitor.** Both race the same `RoomSpec`, each against its own fresh state;
  neither sees the other's progress. The golden log shows both independently unlocking the same safe. A shared
  instance would let one model open the other's cabinet, which is the most quietly catastrophic bug available
  in this ticket.
- **GOTCHA**: `apply` after `hasEnded()` is a **programmer** error — throw `SimulatorError`. The harness must not
  keep asking a model for actions after its budget is gone, and silently accepting them would inflate the
  published action count.
- **GOTCHA**: `summarise()` does not return `costUsd`; #7 knows pricing and this does not.
- **VALIDATE**: `pnpm test lib/sim/simulator.test.ts` — a garbage payload (`{}`, `{ name: 'fly' }`, an action
  missing `intent`) returns `malformed` **and** decrements the action budget; two simulators on one spec are
  independent; `apply` after the end throws.
- **SATISFIES**: AC "malformed action returns a clear error and consumes a turn"; "sole authority on state"

### CREATE `lib/sim/secrecy.test.ts`

- **IMPLEMENT**: the adversarial proof the ticket asks for. Collect every string the simulator can emit to a
  competitor from a fresh canonical room — the serialised `observe()`, plus the verdict message of **every verb
  crossed with every object id in the spec** (and, for `enter_code`, a wrong code; for `submit_answer`, a wrong
  answer). Assert that union contains none of: every `lock.code`, every `puzzle.answer`, and the `clueText` of
  every object that is not reachable in a fresh room.
- **IMPLEMENT**: a second assertion that the same sweep run *after* legitimately unlocking the safe reveals
  `sea-chart` and its clue — so the test proves secrecy rather than proving the simulator says nothing.
- **GOTCHA**: build the object-id list from `spec.objects`, not a hand-written array. A future generated room
  adding an object must be swept automatically or the proof rots.
- **GOTCHA**: this test will fail loudly the day someone "helpfully" spreads a `RoomObject` into a message. That
  is the entire point — say so in a comment so it is not weakened when it fires.
- **VALIDATE**: `pnpm test lib/sim/secrecy.test.ts`
- **SATISFIES**: AC "never leaks room internals into what a competitor can see — prove that with a test"

### CREATE `lib/sim/fixture-replay.test.ts`

- **IMPLEMENT**: the contract test. For each competitor in `loadCanonicalRun()`, build a simulator over
  `loadCanonicalRoom()` with the committed budget, then feed it that competitor's actions from
  `loadCanonicalLog()` in `seq` order, charging each event's real `tokens` and `latencyMs`.
- **IMPLEMENT**: assert per event that `verdict.code` and `verdict.ok` match the fixture. Then assert
  `summarise()` equals the committed `RunSummary` minus `costUsd` — model-a escaped in 13 with 3 puzzles and no
  failures; model-b ended `budget_actions` with 2 puzzles, 2 failed attempts and 1 invalid action.
- **GOTCHA**: **compare codes, not messages.** The fixture's prose was hand-authored for the replay player and
  the simulator writes its own. Asserting message equality would force the simulator's voice to be maintained in
  two places and would fail on any wording change. Assert the code, assert the message is non-empty, and leave
  the prose alone. Write that down — it looks like a weakened assertion and is not.
- **GOTCHA**: if this test fails, **the fixture is right and the simulator is wrong** — until a deliberate
  decision says otherwise, because #3, #4 and #8 are being built against that corpus right now.
- **VALIDATE**: `pnpm test lib/sim/fixture-replay.test.ts`
- **SATISFIES**: AC "the simulator is the sole authority on state"; conformance with #1's golden fixtures

### CREATE `lib/sim/index.ts`

- **IMPLEMENT**: the barrel #7 and #8 import from — `createSimulator`, the `Simulator`, `Observation`,
  `ActionCost` types, `compileRoom`, `resolve`, `observe`, `SimulatorError`.
- **GOTCHA**: do **not** re-export `RoomState`'s internal transition helpers. The harness drives the facade; a
  caller reaching in to set `unlocked` directly would bypass every rule in this ticket.
- **VALIDATE**: `pnpm typecheck`

---

## VALIDATION COMMANDS

Run in order. Every one must pass before the ticket is done.

```bash
pnpm typecheck                        # Level 1 — syntax and types
pnpm test lib/sim                     # Level 2 — the ticket's own units
pnpm test                             # Level 3 — nothing in #1 regressed
pnpm build                            # Level 4 — the Next app still builds
```

## TESTING STRATEGY

- **Unit** — one test file per module, colocated, house shape: a typed fixture at module scope, `describe` per
  export, `it` per property.
- **Contract** — `fixture-replay.test.ts` and `secrecy.test.ts`. These are the deliverable. A green unit suite
  with either of these red means the ticket has not landed.
- **Determinism** — every state-touching test asserts the same input twice yields the same output, and that the
  input state was not mutated.
- **Coverage target** — ~35% of lines as tests, per the ticket estimate. Prefer one case per verdict row over
  many cases on `look`.

## ACCEPTANCE CRITERIA

1. `RoomSpec` compiles to a state machine; a structurally-valid but referentially-broken spec throws.
2. Every verb in the v0 vocabulary resolves against room state and returns a `Verdict` with a code from
   `VERDICT_CODES`.
3. An invalid or malformed action returns a clear verdict **and consumes a turn**, counted in `invalidActions`.
4. The budget is enforced on actions, tokens and wall clock; exhaustion is recorded as `endedBecause`, never
   thrown.
5. No answer, lock code, or unreachable object's clue can reach a competitor — proven by `secrecy.test.ts`.
6. The simulator reproduces the golden fixture log's verdicts and the committed run summaries.
7. `pnpm typecheck`, `pnpm test` and `pnpm build` all pass.
