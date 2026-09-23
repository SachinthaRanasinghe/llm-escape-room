# Feature: Headless run harness and event log writer (TICKET-6, #7)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

> **Gate status: closed.** All six clarifying questions are answered (see OPEN QUESTIONS / ASSUMPTIONS). T5 was
> committed (`fac68c1`) and this plan lives on `feature/run-harness`, cut from it. Decisions A1–A6 are settled. Only
> A-G1 and A-G2 remain assumptions, and both are checked at Level 4.

## Feature Description

The harness is the loop that turns two models and one certified room into a run. For each competitor it:

- builds a fresh simulator;
- asks the provider adapter for one action per turn;
- hands the raw action to the simulator;
- writes one semantic `Event` per attempted action;
- feeds the verdict back into that competitor's transcript.

This repeats until the simulator says the run has ended. It then emits a `Run` record with one `RunSummary` per
competitor, including `costUsd`, which only the harness knows.

A matchup is one **hero run** plus **N silent repeats** of the same room. The hero run's `typicalOfRepeats` says
whether its outcome matched what usually happens. A `tsx` CLI runs a matchup against a room file, which defaults to
the canonical fixture, so no generator is needed.

## User Story

As the person publishing a model duel
I want to run two models headless against one certified room and get back an append-only event log plus a run record
So that the replay player has a real log to play, the comparison page has honest numbers, and the gate spike (T7) has a harness to measure divergence and quota with

## Problem Statement

Every piece of the run exists except the loop that connects them:

- the simulator (`lib/sim`, T2);
- the adapters (`lib/providers`, T4);
- the schemas and the golden log (`lib/schema`, `fixtures/`, T1).

No code writes an `Event`, stamps `seq`/`runId`/`at`, adds `costUsd`, or decides `typicalOfRepeats`.

There is also a contract gap. `EventSchema.action` (`lib/schema/event.ts:37`) accepts only a valid `Action`, but the
architecture says a malformed action **consumes a turn and is published as a metric**. A malformed turn therefore
has no representable event today. The harness would have to either drop it, which breaks `findSeqBreaks` and the
published action count, or invent an action, which violates the "never summarise the model" rule.

## Solution Statement

- **Schema, one widening change (A1).** `Event.action` becomes nullable. A new optional `rejected` block records
  why there was no action and what the model actually sent, truncated. A `superRefine` enforces
  `action === null ⇔ rejected present`. The golden log stays valid unchanged because `rejected` is optional.
- **`lib/harness/`**, a pure-ish library whose adapters and clock are both injected. It never reads `process.env`,
  never calls `fetch`, and never reads `Date.now`, which a boundary sweep enforces.
  - `prompt.ts`: the one system prompt and the observation/verdict prose. Built from `Observation`, never
    `RoomSpec`.
  - `record.ts`: builds an `Event` from `ProviderTurn` + `ApplyResult`.
  - `competitor.ts`: the per-competitor turn loop.
  - `duel.ts`: runs both competitors concurrently (A3), merges the log, and emits `Run`.
  - `pricing.ts`: `costUsd`.
  - `typicality.ts`: outcome and modal comparison (A4).
  - `matchup.ts`: hero + N repeats, with drop-on-failure for repeats (A5).
- **`scripts/run.mts`**, the opt-in live CLI. It reads keys through `readProviderKey`, creates adapters, verifies
  the room with the solver first, runs the matchup, and writes JSON under `runs/<runId>/`.
- **Contract test.** A scripted adapter replays the golden log's actions through the real harness and must reproduce
  the committed `RunSummary` for both competitors exactly. This is how "conform to TICKET-1's golden fixture"
  becomes a checkable claim.

## Out of Scope / Non-Goals

- **Not included: the published artifact, render manifest or run URL.** That is T9 (#9). The harness writes
  working files under `runs/` (gitignored), not a publishable bundle.
- **Not included: the comparison view or variance wording.** That is T10 (#10). The harness only fills
  `Run.typicalOfRepeats`.
- **Not included: substrate strategies, the divergence spike, quota extrapolation, or v1 schema pinning.** That is
  T7 (#8). The harness *reports* provider calls per run (in the result object and CLI output) so T7 can count them,
  but adds no persisted quota schema.
- **Not included: invoking the generator.** The CLI takes a room file. `runs/rooms/*.json` from
  `generate-room.mts` works, and so does the fixture default.
- **Not included: model choice.** CLI defaults mirror `smoke-providers.mts` and are placeholders. T7 picks models.
- **Not changing: `lib/sim`, `lib/providers`, `lib/solver`, `lib/generator`, `fixtures/*`.** If the harness needs
  something the facades cannot express, stop and raise it (the `lib/sim/index.ts:14-21` rule).
- **Not changing: `RunSchema` / `RunSummarySchema`.** No new end reason for provider failure (see A5).
- **Not changing: the intent contract.** `IntentSchema` stays 1–280 chars. The harness never rewrites, trims or
  polices an intent beyond what the schema does.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (a concurrency + abort path, one shared-contract change, and a fairness-sensitive prompt)
**Primary Systems Affected**: `lib/schema/event.ts` (widened), new `lib/harness/`, new `scripts/run.mts`, `README.md`
**Dependencies**: none new. It uses zod 4.6.5, vitest 4.1.11, tsx, and Node `node:util` `parseArgs` / `node:fs`.

## Related Work

**Implements**: TICKET-6 — [#7](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/7)   ·   **Epic**: `architecture.md` + `docs/tickets/llm-escape-room.md`

**Back-references**:

- `.claude/plans/scaffold-core-schemas-v0.md`: the event/run schemas and the golden corpus this log must conform to.
- `.claude/plans/room-simulator.md`: its Out-of-Scope says T6 stamps `seq`, `runId`, `at` and adds `costUsd`
  (lines 53–60).
- `.claude/plans/provider-adapters.md`: `ProviderTurn` is what T6 serialises. `native` must never reach the log.
- `.claude/plans/room-generator.md`: the `GenerationAbortedError`, `testing.ts` and `boundary.test.ts` patterns
  mirrored here.

**Forward-references**:

- T7 (#8) runs the spike on this harness and promotes `Event` to v1. The `rejected` block is part of what it pins.
- T8 (#5) must render `action === null` events (show `rejected.intent` if present, else a "no valid action" beat).
- T9 (#9) packages `run.json` + `events.json` into the artifact and must add `lib/harness` to nothing on the
  artifact side. The harness imports providers, so it is harness-side by definition.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `lib/schema/event.ts` (all, 98 lines): the schema being widened. Keep `strictObject`, `LogVersionSchema` and
  `findSeqBreaks` untouched.
- `lib/schema/event.test.ts` (lines 1–80): the `event()` override helper and test style to extend.
- `lib/schema/action.ts` (lines 29–35, 93–114): `IntentSchema` (1..280), `VERDICT_CODES`, `VerdictSchema`.
- `lib/schema/run.ts` (all): `Competitor`, `RunSummary`, `Run`, `END_REASONS`, `typicalOfRepeats` doc (84–92),
  `parseRun`.
- `lib/schema/version.ts`: `LOG_VERSION`, `RUN_VERSION`, `SchemaError`.
- `lib/sim/index.ts` (all): the facade and the usage sketch at lines 8–12. Import only from `@/lib/sim`.
- `lib/sim/simulator.ts` (lines 13–24 one-simulator-per-competitor, 59–73 `ApplyResult`/`Simulator`, 104–156
  `apply`, 165–183 `summarise`): `apply` throws after the run ends, and `summarise` throws before it does.
- `lib/sim/budget.ts` (lines 13–27, 62–84): `ActionCost`, charged every action, and why the sim never reads a clock.
- `lib/sim/observation.ts` (lines 20–35, 66–103): `Observation`, `describeRoom`. This is the secrecy boundary. The
  harness prompt is built only from these.
- `lib/providers/index.ts` (lines 6–23): the turn usage sketch. `lib/providers/types.ts` (lines 23–101, 144–157):
  `TurnRequest`, `TranscriptEntry`, `ToolCall.native` (never log it), `TURN_ANOMALIES`, `ProviderTurn`,
  `ProviderError`.
- `lib/providers/turn.ts` (lines 39–81): what `rawAction`/`toolCall`/`anomaly` look like for each failure shape.
  `multiple_tool_calls` still returns `toolCall = calls[0]`, and `provider_rejected_call` returns `toolCall = null`.
- `lib/providers/groq.ts` (132–163) and `lib/providers/gemini.ts` (161–200): how the transcript is encoded. Neither
  merges consecutive `user` entries.
- `lib/providers/env.ts`: `readProviderKey`. It is called only from `scripts/run.mts`.
- `lib/providers/testing.ts`: `fakeClock` style. **Do not** import it into `lib/harness` source, and write a
  harness-local scripted adapter instead.
- `lib/providers/secrets.test.ts` (lines 12–35, 58–72): sweeps `lib/` for `process.env`. `lib/harness` must pass it
  untouched.
- `lib/generator/generate.ts` (lines 1–10, 63–76, 118–125): the `ProviderError`-from-`types` value import and the
  `*AbortedError` wrapping pattern to mirror.
- `lib/generator/testing.ts` (all): the scripted client pattern to mirror for `scriptedAdapter`.
- `lib/generator/boundary.test.ts` (all): the disk sweep to mirror for `lib/harness/boundary.test.ts`.
- `lib/sim/fixture-replay.test.ts` (lines 28–76): how the golden log is replayed per competitor. The harness
  contract test is the same idea one layer up.
- `scripts/generate-fixtures.mts` (lines 95–115): how the golden log is ordered (per-competitor clock, merged by
  `at`).
- `scripts/generate-room.mts` (all): the CLI shape to mirror (`parseArgs`, `fail(message, code)`, exit 2 usage /
  exit 1 failure, `write()`, never print answers).
- `scripts/smoke-providers.mts` (lines 24–31): default model ids.
- `fixtures/index.ts`: `loadCanonicalRoom`, `loadCanonicalLog`, `loadCanonicalRun`.
- `lib/solver/index.ts`: `verifySpec` (the CLI refuses an uncertified room).
- `README.md` (lines 28–70): the `## Contracts` section. Add one `lib/harness/` paragraph in the same voice.

### New Files to Create

- `lib/harness/types.ts`: `HarnessDeps`, `Matchup`/`DuelOptions` types, `DEFAULT_BUDGET`.
- `lib/harness/prompt.ts`: `SYSTEM_PROMPT`, `openingMessage(obs)`, `verdictText(verdict, obs)`, `noToolCallText(...)`.
- `lib/harness/record.ts`: `buildEvent`, `describeRejection`, `RAW_EXCERPT_MAX`.
- `lib/harness/competitor.ts`: `runCompetitor`.
- `lib/harness/pricing.ts`: `PRICING`, `costOf`.
- `lib/harness/duel.ts`: `runDuel`, `DuelAbortedError`, `mergeLog`.
- `lib/harness/typicality.ts`: `outcomeOf`, `isTypical`.
- `lib/harness/matchup.ts`: `runMatchup`.
- `lib/harness/index.ts`: the public surface (not `testing.ts`).
- `lib/harness/testing.ts`: `scriptedAdapter`, `turnsFromLog`, `fixedClock`.
- Tests: `prompt.test.ts`, `record.test.ts`, `competitor.test.ts`, `pricing.test.ts`, `duel.test.ts`,
  `typicality.test.ts`, `matchup.test.ts`, `contract.test.ts`, `boundary.test.ts`, all in `lib/harness/`.
- `scripts/run.mts`: the opt-in live CLI.
- `.claude/reports/run-harness-report.md`: written at the end by `piv-implement`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Zod 4: `.superRefine` / `.check`](https://zod.dev/api#refinements)
  - Why: the cross-field `action === null ⇔ rejected` rule on a `strictObject`.
- [Zod 4: `.nullable()` / `.optional()`](https://zod.dev/api#optionals)
  - Why: keep the golden log parsing, since `rejected` is optional and `action` is nullable.
- [Node `util.parseArgs`](https://nodejs.org/api/util.html#utilparseargsconfig)
  - Why: the CLI. Mirror `generate-room.mts`.
- [MDN `Promise.allSettled`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled)
  - Why: the duel waits for both competitors to stop before reporting an abort, so no request is orphaned.
- [Gemini API: multi-turn content](https://ai.google.dev/gemini-api/docs/text-generation#multi-turn-conversations)
  - Why: A-G1. Consecutive `user` contents are sent as-is by `gemini.ts`. Confirm at Level 4.

### Patterns to Follow

**Naming:** kebab-less single-word files in `lib/<area>/`, camelCase functions, `SCREAMING_CASE` constants,
`create*`/`run*`/`parse*` verbs, `*Error extends Error` with `this.name = new.target.name`.

**Header doc comments:** every file opens with a `/** … */` block that names the ticket, says what the file is, and
uses `── Section ───` rules for the non-obvious decisions (see `lib/sim/simulator.ts:9-24`). Match that density. The
comments explain *why*, never restate code.

**Parse, don't cast:** everything written is passed through its schema before leaving the module
(`parseEventLog`, `parseRun`), as `generate.ts:94-114` does with `parseGenerationRecord`.

**Outcome vs exception** (`lib/generator/generate.ts:23-28`):

- a model's failure is data (an event with a verdict);
- budget exhaustion is data (`endedBecause`);
- only a `ProviderError` throws, wrapped with the partial record:

```ts
export class GenerationAbortedError extends Error {
  readonly record: GenerationRecord;
  constructor(record: GenerationRecord, cause: ProviderError) {
    super(`generation aborted after ${record.attempts.length} completed attempt(s): ${cause.message}`, { cause });
    this.name = new.target.name;
    this.record = record;
  }
}
```

**Value import rule:** providers are imported by **type** only, except
`import { ProviderError } from '@/lib/providers/types';` (`generate.ts:2-4`). `createAdapter` and
`readProviderKey` are imported only in `scripts/run.mts`.

**Injected clock:** nothing in `lib/` reads `Date.now()`/`performance.now()`. `HarnessDeps.now` returns epoch ms
for `Event.at` / `Run.startedAt`. The script passes `() => Date.now()`.

**Tests:** vitest `describe`/`it`, `it.each` over competitors, real simulator and scripted models, no
`vi.stubGlobal`. Test support lives in a `testing.ts` not exported from `index.ts`.

---

## IMPLEMENTATION PLAN

### Phase 1: Contract (schema widening)

Widen `Event` so a malformed turn is representable. This is the only change outside `lib/harness`.

### Phase 2: Harness core

**Depends on:** Phase 1

Build prompt, record, competitor loop, pricing, duel, typicality and matchup, each with its tests.

### Phase 3: Integration

**Depends on:** Phase 2

Add the public surface, the boundary sweep, the golden contract test, the CLI and the README.

### Phase 4: Validation

Full suite, typecheck, the offline CLI checks, and the (opt-in) live run.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE `lib/schema/event.ts`: nullable action + `rejected`

- **IMPLEMENT**:
  - Add, exported:
    ```ts
    export const REJECTION_KINDS = ['no_tool_call', 'multiple_tool_calls', 'unparseable_arguments', 'provider_rejected_call', 'invalid_arguments'] as const;
    export const RAW_EXCERPT_MAX = 1000;
    export const RejectedSchema = z.strictObject({
      kind: z.enum(REJECTION_KINDS),
      /** What the model sent, JSON-stringified and cut to RAW_EXCERPT_MAX. Model output, never harness prose. */
      raw: z.string().max(RAW_EXCERPT_MAX),
      /** An intent the model DID write, lifted verbatim from its payload when one was there. Never invented. */
      intent: z.string().min(1).max(280).nullable(),
    });
    ```
  - The first four kinds mirror `TURN_ANOMALIES` in `lib/providers/types.ts:57-62`, **copied, not imported**: the
    schema is artifact-side and must not import providers (`secrets.test.ts:69-76`). `invalid_arguments` is a
    single tool call whose arguments parsed as JSON but failed `ActionSchema` (e.g. missing intent, unknown verb).
  - In `EventSchema`, change `action: ActionSchema` to `action: ActionSchema.nullable()`, and add
    `rejected: RejectedSchema.optional()`.
  - Chain a `.superRefine`: when `action === null`, `rejected` must be present; when `action !== null`, `rejected`
    must be absent. Issue message: `a null action needs a rejected block, and only a null action may have one`.
  - Extend the header comment with a `── A malformed turn is still an event ──` section. It should say why: the
    turn was charged, `findSeqBreaks` needs it, and the PRD publishes invalid actions. It should also say that the
    harness never invents an action or an intent.
  - Update the "Intent lives on the action" paragraph: read it as `event.action?.intent ?? event.rejected?.intent`.
- **PATTERN**: `lib/schema/run.ts:45-47` ("absence is a value"). Here `rejected` is optional *only* so the committed
  golden log parses without regeneration. Say so in the comment.
- **IMPORTS**: none new.
- **GOTCHA**: **Settled A1.** Keep
  `EventLogSchema = z.array(EventSchema)` working: a refined object inside `z.array` is fine in zod 4. `Event`
  (`z.infer`) now has `action: Action | null` and `rejected?: …`. Compile errors in existing code that read
  `event.action.name` are likely in `lib/sim/fixture-replay.test.ts` and `fixtures/index.test.ts`. Fix them with a
  non-null assertion **only in tests**, where the golden log is known to be all-valid, with a comment saying so.
  Do **not** touch `fixtures/*.json`.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/schema fixtures lib/sim`
- **SATISFIES**: AC 3, AC 4

### 2. UPDATE `lib/schema/event.test.ts`: cover the widening

- **IMPLEMENT**: Add a `describe('a malformed turn', …)` with these cases:
  - null action plus `rejected` parses;
  - null action without `rejected` fails;
  - a valid action plus `rejected` fails;
  - `raw` longer than `RAW_EXCERPT_MAX` fails;
  - a `rejected.intent` of `''` fails;
  - an unknown `kind` fails;
  - `findSeqBreaks` counts a null-action event like any other.

  Also add one `parseEventLog(loadCanonicalLog())` sanity case if not already covered in `fixtures/index.test.ts`.
- **PATTERN**: `event()` helper at `lib/schema/event.test.ts:5-18`.
- **VALIDATE**: `pnpm vitest run lib/schema/event.test.ts`
- **SATISFIES**: AC 3

### 3. CREATE `lib/harness/types.ts`

- **IMPLEMENT**:
  ```ts
  export interface HarnessDeps { readonly now: () => number }            // epoch ms, for Event.at / Run.startedAt only
  export const DEFAULT_BUDGET: Budget = { maxActions: 14, maxTokens: 60_000, maxWallClockMs: 300_000 };
  export const DEFAULT_REPEATS = 3;
  export interface DuelOptions {
    readonly runId: string;
    readonly spec: RoomSpec;
    readonly competitors: readonly Competitor[];
    readonly adapters: Readonly<Record<string, ProviderAdapter>>;   // keyed by Competitor.id
    readonly budget?: Budget;                                        // default DEFAULT_BUDGET
    readonly deps: HarnessDeps;
  }
  ```
  `Budget` comes from `@/lib/sim`, `Competitor` from `@/lib/schema/run`, and `ProviderAdapter` is a **type** import
  from `@/lib/providers`.
- **GOTCHA**: **Settled A6.** `DEFAULT_BUDGET` equals the golden run's budget (`fixtures/runs/canonical-run.json`).
  The doc comment must say it is a default the CLI overrides, not a derived value, and that T7 may retune it.
  `Date.now` is **not** a default here. The script supplies the clock.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC 1

### 4. CREATE `lib/harness/prompt.ts` + `prompt.test.ts`

- **IMPLEMENT**:
  - `SYSTEM_PROMPT`: one constant string, identical for every competitor (fairness, `types.ts:24`). It says:
    - you are in a locked room;
    - act only by calling exactly one tool per turn;
    - every call needs `intent`, one short sentence in your own words saying why, which is shown to viewers;
    - wrong or invalid actions still cost a turn;
    - you have a limited number of actions.

    It must not mention answers, puzzle count, or anything from a `RoomSpec`.
  - `openingMessage(obs: Observation): string`: the theme name + description, the visible objects as
    `- <name> (id: <id>)[, locked][, open]`, the held items, and `Actions remaining: N`.
  - `verdictText(verdict: Verdict, obs: Observation): string`: `${verdict.message}\nActions remaining: ${obs.actionsRemaining}`.
  - `noActionText(verdict, obs)`: the same plus the fixed line `Act by calling exactly one tool.`
- **PATTERN**: `lib/sim/observation.ts:37-47` (what `visible` omits). The prompt reads only `Observation`, so it
  cannot leak.
- **GOTCHA**:
  - Object ids **must** be shown. The model needs `targetId`, and the golden log uses ids (`wall-safe`).
  - Never import `RoomSpec`/`RoomState` here. The test asserts it textually.
- **TESTS**:
  - `openingMessage(observe(compileRoom(canonical), 14))` contains no puzzle answer and no `clueText` from the
    canonical room (iterate `spec.puzzles[].answer`, `spec.objects[].clueText`, and lock codes);
  - it contains every visible id;
  - `SYSTEM_PROMPT` contains `intent`;
  - calling each function twice with equal input is byte-identical;
  - the source file does not contain `RoomSpec`.
- **VALIDATE**: `pnpm vitest run lib/harness/prompt.test.ts`
- **SATISFIES**: AC 2, AC 9

### 5. CREATE `lib/harness/record.ts` + `record.test.ts`

- **IMPLEMENT**:
  - `describeRejection(turn: ProviderTurn): Rejected`:
    - `kind` is `turn.anomaly ?? 'invalid_arguments'`;
    - `raw` is `excerpt(turn.rawAction === null ? (turn.text ?? '') : JSON.stringify(turn.rawAction))`, where
      `excerpt` cuts to `RAW_EXCERPT_MAX - 1` and appends `…` when cut;
    - `intent` is lifted **only** when `rawAction` is a plain object whose `intent` is a string of 1–280 chars after
      no transformation. Otherwise `null`. `multiple_tool_calls` gives an array, so `intent` is `null`.
  - `buildEvent(ctx: { runId, competitorId, seq, at: string }, turn: ProviderTurn, result: ApplyResult): Event`.
    It returns `EventSchema.parse({...})` with:
    - `action: result.action`;
    - `rejected` present iff `result.action === null`;
    - `latencyMs: turn.latencyMs`, `tokens: turn.tokens`, `verdict: result.verdict`, `logVersion: LOG_VERSION`.
  - Round `latencyMs` with `Math.round` defensively, since the schema needs an int and `performance.now` deltas are
    fractional.
- **PATTERN**: `lib/providers/turn.ts:39-81` for every shape `rawAction` takes.
- **GOTCHA**:
  - `turn.toolCall.native` (Gemini `thoughtSignature`) must never appear. Build the event field by field, never by
    spreading `turn`.
  - `rawAction` for `provider_rejected_call` is `{ name: '__rejected__' }` (`turn.ts:73-81`). Record it as-is. The
    kind carries the meaning.
- **TESTS**: a table over the five kinds:
  - valid action → no `rejected`;
  - lifted intent only when truthful;
  - a 5 000-char raw is cut to ≤ 1000 and ends in `…`;
  - a `native` sentinel string on `toolCall` never appears in `JSON.stringify(event)`;
  - fractional latency is rounded;
  - the output parses with `EventSchema`.
- **VALIDATE**: `pnpm vitest run lib/harness/record.test.ts`
- **SATISFIES**: AC 2, AC 3

### 6. CREATE `lib/harness/testing.ts`

- **IMPLEMENT**:
  - `scriptedAdapter(script: readonly (ScriptedTurn | Error)[], identity = { provider: 'groq', modelId: 'stub' })`
    returns `{ adapter: ProviderAdapter; requests: TurnRequest[] }`. `ScriptedTurn` is
    `Partial<ProviderTurn> & { rawAction: unknown }`, with defaults: `toolCall` synthesised as
    `{ callId: 'call_<n>', toolName: rawAction.name ?? 'unknown', args: rawAction }` when `rawAction` is a
    well-formed object and `anomaly` is null, `text: null`, `tokens {prompt:100, completion:10}`,
    `latencyMs: 1000`, `attempts: 1`. When the script is exhausted, throw
    `new Error('scriptedAdapter: no scripted turn left')`.
  - Snapshot each request: `structuredClone` the transcript at call time, because the loop keeps mutating its array.
  - `turnsFromLog(log: EventLog, competitorId): ScriptedTurn[]` maps the golden log's actions, tokens and latency
    to turns, in `seq` order.
  - `fixedClock(startMs = Date.parse('2026-09-22T10:00:00.000Z'), stepMs = 1000)` returns `HarnessDeps`.
- **PATTERN**: `lib/generator/testing.ts:31-50`.
- **GOTCHA**:
  - Not exported from `index.ts`.
  - `Date.parse` is fine, but `boundary.test.ts` forbids `Date.now`, so don't use it.
  - The adapter's `act` must be `async` so the two competitors genuinely interleave in `duel` tests.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC 7 (test support)

### 7. CREATE `lib/harness/competitor.ts` + `competitor.test.ts`

- **IMPLEMENT**: `runCompetitor({ runId, spec, budget, competitor, adapter, deps, shouldStop }): Promise<CompetitorResult>`

  ```
  sim ← createSimulator({ spec, budget, competitorId: competitor.id })
  transcript ← [{ kind: 'user', text: openingMessage(sim.observe()) }]
  events ← []; providerCalls ← 0
  while !sim.hasEnded():
    if shouldStop(): break                                  // another competitor's provider died (A5)
    turn ← await adapter.act({ system: SYSTEM_PROMPT, transcript: [...transcript] })   // ProviderError propagates, see below
    providerCalls += turn.attempts
    result ← sim.apply(turn.rawAction, { tokens: turn.tokens, elapsedMs: Math.round(turn.latencyMs) })
    events.push(buildEvent({ runId, competitorId, seq: events.length, at: iso(deps.now()) }, turn, result))
    obs ← sim.observe()
    if turn.toolCall !== null:
      transcript.push({ kind: 'tool_call', call: turn.toolCall },
                      { kind: 'tool_result', callId: turn.toolCall.callId, toolName: turn.toolCall.toolName, text: verdictText(result.verdict, obs) })
    else:
      if turn.text !== null && turn.text.trim() !== '': transcript.push({ kind: 'assistant_text', text: turn.text })
      transcript.push({ kind: 'user', text: noActionText(result.verdict, obs) })
  return { events, summary: sim.hasEnded() ? sim.summarise() : null, providerCalls, stopped: !sim.hasEnded() }
  ```

  On a `ProviderError` from `act`, throw `CompetitorAbortedError { competitorId, events, providerCalls, cause }` so
  the partial log survives.
- **PATTERN**: `lib/sim/index.ts:8-12` and `lib/providers/index.ts:11-13` (the canonical loop).
  `generate.ts:120-125` for wrapping `ProviderError` and rethrowing everything else.
- **GOTCHA**:
  - **One simulator per competitor** (`simulator.ts:13-24`). Never share.
  - Pass `elapsedMs = turn.latencyMs` (successful attempt only), **not** a harness clock delta. Backoff is not
    think-time (`transport.ts:8-13`).
  - `at` comes from `deps.now()` **after** `act` resolves.
  - `seq` is `events.length`, so it is contiguous by construction.
  - Hand `rawAction` over unexamined. Only `sim.apply` scores it.
  - **A-G1**: two consecutive `user` entries can occur (e.g. after a `tool_result` in Gemini's encoding, or after a
    turn with no text). `gemini.ts:161-200` does not merge them. Leave it; Level 4 confirms Gemini accepts it. If it
    does not, the fix belongs in the adapter's encoder, not here. Record it in the report.
  - **A5**: `shouldStop` is polled before each call. A stopped competitor has no summary.
- **TESTS**:
  - a valid 3-turn script produces 3 events with seq 0..2, and the transcript alternates tool_call/tool_result
    (assert on `requests[2].transcript`);
  - a `no_tool_call` turn gives an event with `action: null`, `rejected.kind: 'no_tool_call'`,
    `verdict.code: 'malformed'`, it counts in `summary.invalidActions`, and the next request ends with a `user`
    entry containing `Act by calling exactly one tool.`;
  - a `multiple_tool_calls` turn still answers `toolCall` (a transcript `tool_result` exists);
  - hitting `maxActions` ends with `budget_actions` and **no** extra `act` call (script length = maxActions);
  - `shouldStop` returning true stops before the next call, with `stopped: true` and `summary: null`;
  - a `ProviderError` on turn 3 gives `CompetitorAbortedError` with 2 events and correct `providerCalls`;
  - a plain `Error` is rethrown unwrapped;
  - summary tokens equal the sum of event tokens.
- **VALIDATE**: `pnpm vitest run lib/harness/competitor.test.ts`
- **SATISFIES**: AC 1, AC 2, AC 3

### 8. CREATE `lib/harness/pricing.ts` + `pricing.test.ts`

- **IMPLEMENT**:
  - `PRICING: Readonly<Record<Provider, Readonly<Record<string, { promptPerMTok: number; completionPerMTok: number }>>>>`
    lists the free-tier defaults at 0: `groq: { 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant' }`,
    `gemini: { 'gemini-flash-latest' }`.
  - `costOf(competitor, tokens): { usd: number; priced: boolean }`. Unknown model gives `{ usd: 0, priced: false }`.
- **GOTCHA**:
  - **Settled A6.** $0 for an unknown model is a *guess* surfaced by `priced: false`, which the CLI prints as a
    warning. The doc comment cites `run.ts:61-66` (cost is a guardrail).
  - Round to 6 decimals to keep floating noise out of JSON.
- **TESTS**:
  - known free model → 0 and `priced: true`;
  - unknown → `priced: false`;
  - arithmetic with a test-local table entry (inject the table as an optional parameter for the test);
  - never negative.
- **VALIDATE**: `pnpm vitest run lib/harness/pricing.test.ts`
- **SATISFIES**: AC 5

### 9. CREATE `lib/harness/duel.ts` + `duel.test.ts`

- **IMPLEMENT**: `runDuel(options: DuelOptions): Promise<DuelResult>` where
  `DuelResult = { run: Run; events: EventLog; providerCalls: Record<string, number>; unpriced: string[] }`.
  1. Validate before any call. Throw `RangeError` when:
     - there are fewer than 2 competitors (`RunSchema` min 2);
     - competitor ids are duplicated;
     - an adapter is missing for an id;
     - an adapter's `provider`/`modelId` ≠ its competitor's.
  2. `startedAt ← iso(deps.now())`, and a shared `let stop = false`.
  3. `Promise.allSettled(competitors.map(c => runCompetitor({ …, shouldStop: () => stop }).catch(e => { stop = true; throw e; })))`.
     The failure sets `stop` synchronously in its own rejection handler, so the sibling stops at its next poll.
  4. If any settled result is rejected with a `CompetitorAbortedError`, throw
     `DuelAbortedError { runId, events: mergeLog(all partial events), cause }`. Rethrow any other error as-is.
  5. Otherwise `events ← parseEventLog(mergeLog(...))`. Assert `findSeqBreaks(events)` is empty, and throw an
     `Error` if not (a programmer error).
  6. Summaries are `{ ...summary, costUsd: costOf(c, summary.tokens).usd }` in competitor order.
     `run ← parseRun({ runVersion: RUN_VERSION, runId, roomId: spec.roomId, competitors, budget, startedAt, summaries, typicalOfRepeats: null })`.
  - `mergeLog(events)` is a stable sort by `Date.parse(at)`, then competitor index, then `seq`, mirroring
    `generate-fixtures.mts:113-115`.
- **PATTERN**: `GenerationAbortedError` (`generate.ts:63-76`).
- **GOTCHA**:
  - **Settled A3.** The two competitors run concurrently. Use `allSettled`, not `all`: `all` rejects while the
    sibling keeps spending quota with no one listening.
  - **Settled A5.** No `Run` is produced on abort.
  - Competitor order in `run.competitors`/`summaries` is the input order, not finish order.
- **TESTS**:
  - Isolation: competitor A's script unlocks the wall safe; B's script tries `open wall-safe` at the same point and
    gets `locked`.
  - The merged log is sorted by `at`, has both competitors, and passes `findSeqBreaks`.
  - `run` parses and has `typicalOfRepeats: null`.
  - `costUsd` is present, and `unpriced` lists unknown models.
  - A `ProviderError` in A's 2nd turn gives `DuelAbortedError`. B made ≤ 1 further call after the failure (assert
    `requests.length` is small), and the partial events include both competitors' completed events.
  - Each validation `RangeError` is thrown before any `act` (`requests.length === 0`).
  - Same scripts and same fixed clock give a deep-equal `DuelResult` twice (determinism).
- **VALIDATE**: `pnpm vitest run lib/harness/duel.test.ts`
- **SATISFIES**: AC 1, AC 3, AC 4, AC 5

### 10. CREATE `lib/harness/typicality.ts` + `typicality.test.ts`

- **IMPLEMENT**:
  - `type Outcome = { kind: 'winner'; competitorId: string } | { kind: 'tie' } | { kind: 'none' }`.
  - `outcomeOf(run: Run): Outcome`, among `summaries` with `escaped`:
    - none escaped → `none`;
    - otherwise the smallest `escapeActionCount` wins;
    - a tie on count → `tie`.
  - `isTypical(hero: Run, repeats: readonly Run[]): boolean | null`:
    - `repeats.length === 0` → `null`;
    - otherwise count outcomes by a canonical key (`winner:<id>`, `tie`, `none`) and find the modal set (all keys
      sharing the max count);
    - return `true` iff the hero's key is in the modal set.
- **GOTCHA**:
  - **Settled A4.** The winner is judged by action count, not ms. `escapeMs` is summed provider latency, which is
    not the metric the product ranks on (`run.ts:46`). Document that.
  - A tied mode counts as typical for any tied key. Document that too.
- **TESTS**:
  - each outcome kind;
  - hero matches a unanimous repeat set;
  - hero differs from the mode;
  - bimodal repeats with the hero in either mode;
  - no repeats → `null`;
  - a `tie` hero against `tie` repeats → true.
- **VALIDATE**: `pnpm vitest run lib/harness/typicality.test.ts`
- **SATISFIES**: AC 6

### 11. CREATE `lib/harness/matchup.ts` + `matchup.test.ts`

- **IMPLEMENT**:
  - `runMatchup({ runId, spec, competitors, adapters, budget?, repeats = DEFAULT_REPEATS, deps, onProgress? }): Promise<MatchupResult>`.
  - Run the hero duel with `runId`. A `DuelAbortedError` propagates.
  - Then run the repeats **sequentially** (`for` loop, `await`), with ids `${runId}-r${i}` for i = 1..N.
  - A repeat that throws `DuelAbortedError` is recorded in `dropped: { runId, reason }[]` and skipped. Any other
    error propagates.
  - Finally `hero.run` is re-parsed with `typicalOfRepeats: isTypical(hero.run, completed.map(r => r.run))`.
  - Return `{ hero, repeats: completed, dropped, providerCalls: total }`.
  - `onProgress(msg: string)` is an optional hook for the CLI. Counts only, never content.
  - Repeats reuse the **same** adapters (stateless per call).
- **GOTCHA**:
  - **Settled A4/A5.** N = 3 by default. `repeats: 0` gives `typicalOfRepeats: null`.
  - Repeats are sequential even though competitors inside a duel run concurrently: this halves peak request rate on
    the free tier. Document that.
  - Validate `repeats` is a non-negative integer (`RangeError`), as `generate.ts:83-86` does.
- **TESTS**:
  - repeats=2 gives ids `x`, `x-r1`, `x-r2`;
  - `typicalOfRepeats` is true or false per scripted outcomes;
  - repeat 1 aborts → it is dropped, typicality is computed from the 1 remaining repeat, and `dropped` has the
    reason;
  - hero abort → throws and **no** repeat runs;
  - repeats=0 → `null`;
  - negative or fractional repeats → `RangeError` before any call.
- **VALIDATE**: `pnpm vitest run lib/harness/matchup.test.ts`
- **SATISFIES**: AC 6

### 12. CREATE `lib/harness/index.ts`

- **IMPLEMENT**:
  - Export `runMatchup`, `runDuel`, `runCompetitor`, `DuelAbortedError`, `CompetitorAbortedError`, `SYSTEM_PROMPT`,
    `costOf`, `PRICING`, `outcomeOf`, `isTypical`, `DEFAULT_BUDGET`, `DEFAULT_REPEATS`, and types.
  - The header comment gives the usage sketch and a "deliberately NOT exported" section: `testing.ts`, and the
    prompt helpers other than `SYSTEM_PROMPT`.
- **PATTERN**: `lib/sim/index.ts:1-40`, `lib/providers/index.ts:6-35`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC 1

### 13. CREATE `lib/harness/boundary.test.ts`

- **IMPLEMENT**: Mirror `lib/generator/boundary.test.ts` exactly:
  - the same `FORBIDDEN` list (`process.env`, `fetch(`, URLs, `node:http(s)`, `Math.random`, `Date.now`), plus
    `performance.now`;
  - the same `PROVIDER_VALUE_IMPORT` regex, allowing only `@/lib/providers/types`;
  - a guard-the-guard (`sources.length >= 8`, contains `duel.ts`);
  - a positive control.
  - Additionally, no harness file may import `@/lib/schema/room` except as `import type`. The harness passes
    `RoomSpec` through to `createSimulator` and never reads its fields. `prompt.ts` must not import it at all.
- **GOTCHA**: `testing.ts` is swept too and must not use `Date.now`. That is why `fixedClock` takes a `Date.parse`
  literal.
- **VALIDATE**: `pnpm vitest run lib/harness/boundary.test.ts`
- **SATISFIES**: AC 9

### 14. CREATE `lib/harness/contract.test.ts`: the golden conformance test

- **IMPLEMENT**: This is the ticket's contract with T1/T8.
  - For both competitors in `loadCanonicalRun()`, build `scriptedAdapter(turnsFromLog(log, id))` and
    `runDuel({ runId: 'run-canonical-0001', spec: loadCanonicalRoom(), competitors: run.competitors, budget: run.budget, … })`.
  - Assert `result.run.summaries` **equals** `loadCanonicalRun().summaries` exactly, including `costUsd: 0`
    (the canonical model ids `competitor-a/b` are unpriced, so this also asserts they appear in `unpriced`).
  - Assert the per-competitor event sequence of `(seq, action, verdict.code, verdict.ok, latencyMs, tokens)` equals
    the golden log's. Messages are **not** compared (reason: `fixture-replay.test.ts:19-25`).
  - Assert every harness event has exactly the golden event's key set (`Object.keys`), since no valid-action event
    has `rejected`.
  - Assert `parseEventLog` and `findSeqBreaks` pass.
- **GOTCHA**: `run.startedAt` and `at` differ from the golden values unless `fixedClock` is aligned. Compare them
  only for format (ISO) and ordering, not equality.
- **VALIDATE**: `pnpm vitest run lib/harness/contract.test.ts`
- **SATISFIES**: AC 4, AC 7

### 15. CREATE `scripts/run.mts`: the opt-in live CLI

- **IMPLEMENT**, mirroring `scripts/generate-room.mts` in structure:
  - Usage:
    `node --env-file-if-exists=.env --import tsx scripts/run.mts [--room <path>] [--a groq:<model>] [--b groq:<model>] [--repeats 3] [--run-id <id>] [--max-actions 14] [--max-tokens 60000] [--max-ms 300000] [--out runs]`.
  - `--room` defaults to the canonical fixture (`loadCanonicalRoom()`). Otherwise read the file and
    `parseRoomSpec(JSON.parse(...))`. Then run `verifySpec(spec)`. If it is not certified, print the rejection
    **codes only** and exit 2.
  - `--a`/`--b` are parsed as `provider:modelId` with `ProviderSchema`. Defaults: `groq:llama-3.3-70b-versatile` and
    `groq:llama-3.1-8b-instant` (single provider, per `architecture.md` "First matchup"). Competitor ids are
    `model-a`/`model-b`, params `{ temperature: null, topP: null }`.
  - `--run-id` defaults to `run-${spec.roomId}-${new Date().toISOString().replace(/[:.]/g, '-')}`.
  - Bad args exit 2 with the usage string.
  - Adapters: `createAdapter(c, readProviderKey(c.provider))`. A missing key gives a `ProviderError`; print its
    message and exit 1 before any call.
  - `deps = { now: () => Date.now() }`.
  - Writes:
    - `<out>/<runId>/run.json` and `<out>/<runId>/events.json`;
    - `<out>/<runId>/repeats/<repeatId>.run.json` and `<repeatId>.events.json`;
    - `<out>/<runId>/matchup.json` holding `{ heroRunId, repeatRunIds, dropped, providerCalls }`.
  - On `DuelAbortedError` for the hero: write `<out>/<runId>/events.partial.json` and exit 1.
  - Console output is counts only: per competitor `escaped/endedBecause/actions/puzzles/failed/invalid/tokens/cost`,
    then `typicalOfRepeats`, provider calls, and an `unpriced` warning. **Never print a room, a clue, or an answer.**
    Intents are not printed either, which keeps the console short. The log holds them.
- **PATTERN**: `scripts/generate-room.mts:34-111`.
- **GOTCHA**:
  - The ticket says `scripts/run.ts`. Use `.mts` to match every other script (`generate-room.mts`,
    `smoke-providers.mts`), and note it as a deviation.
  - `runs/` is gitignored (`.gitignore` `/runs/`, `*.run.json`).
  - Not collected by vitest: the include is `*.test.ts`.
  - **A-G1**: the live Gemini call is the only check on consecutive `user` entries.
- **VALIDATE** (offline, no network):
  - `node --import tsx scripts/run.mts --a nope:x; echo "exit=$?"` → exit 2;
  - `node --import tsx scripts/run.mts --repeats -1; echo "exit=$?"` → exit 2;
  - `env -u GROQ_API_KEY node --import tsx scripts/run.mts --repeats 0; echo "exit=$?"` → `GROQ_API_KEY is not set`,
    exit 1;
  - `pnpm typecheck`.
- **SATISFIES**: AC 8

### 16. UPDATE `README.md`

- **IMPLEMENT**:
  - In `## Contracts`, after the `lib/generator/` paragraph, add a `lib/harness/` paragraph in the same voice:
    - two models race the same certified room concurrently, each against its own simulator;
    - every attempted action becomes one event, a malformed one included, recording what the model sent and never
      an invented intent;
    - the run record adds cost;
    - a matchup is a hero run plus silent repeats, and the record says whether the hero was typical;
    - include the run command.
  - Update `## Status` with one clause.
- **VALIDATE**: `grep -n "scripts/run.mts" README.md`
- **SATISFIES**: AC 10

---

## TESTING STRATEGY

### Unit Tests

Per-module files in `lib/harness/` against the **real** simulator and a scripted adapter. Fakes are injected
through `adapters` and `deps`, never `vi.stubGlobal`. Roughly 70–90 new tests:

| File | Est. tests |
|---|---|
| `event.test.ts` (schema) | +7 |
| `prompt` | 6 |
| `record` | 10 |
| `competitor` | 9 |
| `pricing` | 4 |
| `duel` | 10 |
| `typicality` | 8 |
| `matchup` | 7 |
| `contract` | 5 |
| `boundary` | ~2 per source file + controls |

### Integration Tests

- `contract.test.ts` is the integration test: golden log → scripted adapters → real harness → real simulator →
  committed summaries, exactly.
- `lib/providers/secrets.test.ts` must still pass unchanged. `lib/harness` reads no env and names no endpoint.
- `lib/sim/fixture-replay.test.ts` and `fixtures/index.test.ts` must still pass after the schema widening.

### Edge Cases

- A model that never calls a tool until the budget ends: `maxActions` events, all `action: null`,
  `invalidActions = maxActions`, `endedBecause: 'budget_actions'`.
- Escape on the same action that exhausts the budget: `escaped` wins (`simulator.ts:144-153`). The harness adds
  nothing.
- A token budget tripped by one huge turn: `budget_tokens`, and no further `act`.
- `multiple_tool_calls`: the event is `malformed`, and the transcript still gets a `tool_result` for `calls[0]`.
- `provider_rejected_call`: `toolCall` is null, so it is handled on the `user` path.
- An `intent` of 281 chars in an otherwise valid call: `malformed` via schema, and `rejected.intent` is `null`
  because it is not truthfully liftable within 280.
- A competitor finishing long before the other: the merge sorts by `at`, and neither waits on the other.
- A `ProviderError` in both competitors at once: a single `DuelAbortedError`, whose `cause` is the first rejection
  in competitor order.
- A room with a different `roomId` than the fixture: `run.roomId` comes from the spec.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm typecheck
```

(No linter is configured in `package.json`. Match the style by eye.)

### Level 2: Unit Tests

```bash
pnpm vitest run lib/schema lib/harness
```

### Level 3: Integration Tests

```bash
pnpm test                                   # full suite: must stay green (baseline 551 at fac68c1) plus the new tests
git diff fac68c1 -- lib/sim lib/providers lib/solver lib/generator fixtures   # must be empty, except test-only non-null assertions from Task 1
```

### Level 4: Manual Validation (opt-in, spends free-tier quota, needs `.env`)

```bash
node --env-file-if-exists=.env --import tsx scripts/run.mts --repeats 0
node --env-file-if-exists=.env --import tsx scripts/run.mts --repeats 2
node --env-file-if-exists=.env --import tsx scripts/run.mts --a gemini:gemini-flash-latest --b groq:llama-3.3-70b-versatile --repeats 0   # A-G1 check
node --import tsx -e "import('./lib/schema/event.ts').then(m=>{const fs=require('node:fs');const d=fs.readdirSync('runs').sort().pop();m.parseEventLog(JSON.parse(fs.readFileSync('runs/'+d+'/events.json','utf8')));console.log('events.json parses')})"
```

Record in the report:

- whether each model escaped;
- the invalid-action counts;
- whether Gemini accepted the transcript (A-G1);
- provider calls per run. T7 wants those.

### Level 5: Additional Validation (Optional)

None needed.

---

## ACCEPTANCE CRITERIA

1. [ ] `runDuel` runs two competitors against one spec, each with its own simulator, and neither's progress affects
   the other (test).
2. [ ] Every event's intent is the model's own: `event.action.intent` from the call, or `rejected.intent` lifted
   verbatim, or `null`. It is never generated, trimmed or summarised by the harness (tests in `record`,
   `competitor`).
3. [ ] The log is append-only and complete. It has one event per charged action, malformed ones included, and
   `findSeqBreaks` is empty. Each event carries seq, competitor, action + args, intent, verdict, real latency (the
   successful attempt) and tokens.
4. [ ] The harness-written log conforms to the golden fixture: same event key set, parses with `parseEventLog`, and
   the golden log still parses after the schema change.
5. [ ] A `RunSummary` per competitor with all fields including `costUsd`, and `run.json` parses with `parseRun`.
6. [ ] Silent repeats: `runMatchup` runs hero + N repeats and sets `typicalOfRepeats` (true, false, or null when
   there are no repeats), and a failed repeat is dropped and reported.
7. [ ] The contract test reproduces the committed canonical summaries exactly through the real harness.
8. [ ] `scripts/run.mts` runs a matchup against the fixture room with no generator involved. Its offline arg/key
   checks exit 2/1 as specified.
9. [ ] Boundary: `lib/harness` has no env read, fetch, URL, `Math.random`, `Date.now` or `performance.now`, and imports
   providers by type only (plus `ProviderError` from `types`). `secrets.test.ts` is unchanged and passing.
10. [ ] `pnpm typecheck` is clean, `pnpm test` is green, and the README is updated.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No type checking errors
- [ ] Manual testing confirms feature works (Level 4, when a key is available; otherwise stated as not run)
- [ ] Acceptance criteria all met
- [ ] Report written to `.claude/reports/run-harness-report.md`

---

## OPEN QUESTIONS / ASSUMPTIONS

Settled by the user on 2026-09-23. Every recommended default was confirmed:

- **Q1 Branching:** T5 was committed first (`fac68c1`), and T6 is built on `feature/run-harness` cut from it.
- **A1 (Q2) Settled:** `Event.action` becomes nullable, with an optional `rejected { kind, raw ≤1000, intent | null }`
  and a `superRefine` tying the two together. This is a v0 widening. The golden log is unchanged.
- **A3 (Q3) Settled:** competitors in one duel run concurrently (`Promise.allSettled` + a shared stop flag), and the
  log is merged by `at`.
- **A4 (Q4) Settled:** one published (hero) run plus 3 silent repeats, run sequentially. The outcome is the winner
  by fewest escape actions, or `tie`/`none`. The hero is typical iff its outcome is in the modal set of the repeats.
- **A5 (Q5) Settled:** a `ProviderError` in the published run aborts it: the partial log is written, no `Run` is
  produced, and the CLI exits 1. A `ProviderError` in a repeat discards that repeat, recorded in `matchup.json`. No
  new `EndReason`.
- **A6 (Q6) Settled:** the default budget is 14 actions / 60 000 tokens / 300 000 ms, overridable on the CLI. The
  pricing table is all free-tier at $0, and an unknown model is $0 and flagged `unpriced`.

Still assumptions, both verified only at Level 4:

- **A-G1: Assumed.** Gemini accepts consecutive `user` contents (after a no-tool turn). This is unverified until
  Level 4. If it fails, the fix is in `gemini.ts`'s encoder (merge adjacent same-role contents) as a follow-up, not
  in the harness.
- **A-G2: Assumed.** The harness surfaces `providerCalls` per run in the result and `matchup.json` only. T7 owns
  any persisted quota schema.

## NOTES (open canvas)

**Why widen the schema instead of a sidecar file.** A sidecar keeps `EventSchema` strict but splits the run in two.
The replay would need to merge them to show a beat for the wasted turn, and `findSeqBreaks` on the main log would
report a gap for every malformed action. That gap is exactly what the function exists to catch. Widening is cheaper
now than ever: T8 hasn't started, and T7 pins v1 anyway.

**Why concurrent within a duel but sequential across repeats.** Concurrency gives both models the same network
conditions and the same time of day, which matters because `latencyMs` is displayed. Two concurrent requests at
different Groq models hit separate per-model rate limits. Running repeats sequentially keeps peak RPM at 2, not 2N.

**Why the harness doesn't read the clock for think-time.** `turn.latencyMs` is the successful attempt only; a
harness-side delta would include 429 backoff and make the unlucky model look hesitant. The harness clock is used
only for `at` and `startedAt`, which are ordering metadata.

**Transcript design.** It is full-history, resent each turn. Prompt tokens grow roughly linearly, which the golden
fixture's `820 + seq·140` already models, and 14 actions fit comfortably in 60k tokens. The verdict message plus
"Actions remaining" is the whole feedback. `look` is how a model refreshes its view, and it costs a turn, which is
the design.

**Rejected: a `brief_mismatch`-style validity check on the room in the harness.** The CLI calls `verifySpec`, which
is the certified-room gate. The library trusts its caller, as the simulator does.

**Risk: nondeterministic interleaving in tests.** Scripted adapters resolve on microtasks, so interleaving is
deterministic for a given script. `mergeLog`'s tiebreak (`at`, competitor index, seq) makes the output independent
of it anyway.

**Confidence: 7/10.** The known unknowns are A1 acceptance, the zod 4 `superRefine` on `strictObject` inside
`z.array` (low risk), and A-G1, which only a live Gemini call answers.

## AMENDMENTS

- 2026-09-23: gate closed. The user confirmed defaults for Q2–Q6, so A1–A6 changed from Assumed to Settled. No
  task changed.
