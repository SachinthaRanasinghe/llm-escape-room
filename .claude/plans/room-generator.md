# Feature: Room generator (propose → verify → accept) — TICKET-5 / issue #6

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A generation model proposes a candidate room. The solver from TICKET-3 (`verifyRoom`, `lib/solver/verify.ts:48`)
accepts or rejects it. On rejection the loop tries again, telling the model which rules it broke. It stops when a
room certifies or when a retry cap trips. Every accepted room carries a **structural fingerprint**, which makes the
PRD's "≥90% of runs have a chain structure that differs from the previous run" metric measurable. Every attempt,
including rejected ones, is **counted and logged** with its tokens and real provider calls, because rejected
candidates spend quota and TICKET-7 (#8) extrapolates quota from that count.

The generator is **substrate-agnostic**. A strategy object owns everything that depends on the puzzle substrate:
the structural brief, the prompt, the model-facing schema and the narrowing into `RoomSpec`. A registry selects the
strategy by name behind a `--strategy` flag. This ticket ships one real strategy, `symbolic` (digit codes plus
lexicon answers, the only substrate the solver can certify today). TICKET-7 adds `spatial` and `mixed`.

## User Story

As the person running a duel between two models
I want a fresh room for every run that has been proved escapable, unambiguous, properly chained and honest about
its difficulty, together with a count of how many attempts it took
So that every published run uses a room nobody has memorised, no run is wasted on a broken room, and the quota
spent on rejected rooms is measured rather than guessed

## Problem Statement

The solver can judge a room, but nothing produces rooms. The only rooms that exist are one hand-written fixture
and the fuzzer's template rooms (`lib/solver/fuzz.ts:62`), and neither is "freshly generated" in the PRD's sense.
There is also no model channel that can return a room: the TICKET-4 adapters always force exactly one tool call
from the game's action vocabulary (`tool_choice: 'required'` at `lib/providers/groq.ts:158`, `mode: 'ANY'` at
`lib/providers/gemini.ts:203`), so they cannot return a JSON document.

## Solution Statement

```
             seed ──▶ strategy.brief(rng) ──▶ StructuralBrief (chain length, final-answer domain, decoys, theme hint)
                                                  │
 ┌──────────────────── attempt n (1..maxAttempts) ▼ ──────────────────────────────────────────┐
 │ strategy.prompt(brief, feedback[n-1]) ─▶ GenerationClient.complete() ─▶ text (JSON mode)     │
 │   JSON.parse ✗ ─▶ outcome 'unparseable_json'                                                 │
 │   strategy.narrow(json, stamp) ✗ ─▶ outcome 'proposal_malformed' (Zod issues → feedback)     │
 │   verifySpec(spec) ✗ ─▶ outcome 'rejected' (rejection codes → log; codes+messages → feedback) │
 │   verifySpec(spec) ✓ ─▶ outcome 'accepted' ─▶ fingerprint(spec, report) ─▶ return            │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
 cap tripped ─▶ { ok:false, record }          ProviderError ─▶ throw GenerationAbortedError{ cause, record }
```

1. **`lib/providers/generation.ts`** adds `createGenerationClient()`: one **JSON-mode** call per request. It sets
   Groq `response_format: { type: 'json_object' }` and Gemini `generationConfig.responseMimeType:
   'application/json'`. It reuses `postJson` (retries, success-only timing, redaction), and `postJson` stays
   unexported. The dialect-specific compile/decode functions go in `groq.ts` and `gemini.ts`, next to the existing
   ones. That keeps the secrets sweep's "endpoints named only in the two adapters" rule true
   (`lib/providers/secrets.test.ts:78`).
2. **`lib/generator/`** depends only on the `GenerationClient` *type*, so tests drive it with a scripted stub and
   make no network calls.
3. The **model-facing proposal schema** is loose: optional `lock`, `contains` and `clueText`, and derivable
   `order` and `solution`. It is narrowed **into** the strict `RoomSpec`, which is the split `lib/schema/room.ts:10-16`
   reserves for this ticket. Code, not the model, stamps `specVersion`, `seed`, `roomId` and `difficulty.band`.
4. The loop calls `verifySpec` on the narrowed spec. A candidate that fails to narrow never reaches the solver. The
   generator records it under its own outcome, because the solver's closed `REJECTION_CODES` set belongs to
   TICKET-3 and is not extended here.
5. The **persisted attempt log** (`GenerationRecord`) stores rejection **codes and sites only**, never messages. The
   solver's messages quote answers (`lib/solver/derivation.ts:95`, "the answer "4471" cannot be…"). Messages are
   used in memory for the next attempt's feedback and are then dropped.
6. **`scripts/generate-room.mts`** is an opt-in live CLI (same style as `scripts/smoke-providers.mts`). It writes
   `<out>/<roomId>.json` and `<out>/<roomId>.generation.json` under the gitignored `/runs/`.

## Out of Scope / Non-Goals

- **Not included: `spatial` / `mixed` strategies.** TICKET-7 (#8) builds them. No placeholder registrations either.
  An unknown `--strategy` fails with the list of known names.
- **Not included: a variety-rate report** across a directory of rooms. This ticket emits the fingerprint and a
  pure `differsFrom(a, b)`. Scoring the 90% metric over many rooms belongs to TICKET-7 or TICKET-10.
- **Not included: difficulty targeting near the models' ceiling.** TICKET-7's decision rule may send this back.
- **Not changing: the solver.** No new rejection codes, no lexicon domains, no threshold changes in
  `lib/solver/difficulty.ts`. If `symbolic` needs a richer lexicon, that is an Open Question, not a silent edit.
- **Not changing: the competitor adapters.** `createGroqAdapter` / `createGeminiAdapter`, their forced tool mode and
  `equivalence.test.ts` stay as they are. The generation client is a sibling, not a mode flag on `act()`.
- **Not included: key locks / `take`+`use` puzzles** in `symbolic`. Only code locks plus one final `answer` puzzle
  on the door, the canonical fixture's shape.
- **Not included: using the generator from the run harness (TICKET-6, #7)** or publishing anything (TICKET-9).
- **Not included: an equivalence check for the generation client.** It is not competitor-facing, so only one
  model ever sees its prompt.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (small surface, but prompt↔solver fit decides the acceptance rate)
**Primary Systems Affected**: new `lib/generator/`; additive changes to `lib/providers/` (`groq.ts`, `gemini.ts`,
`index.ts`, new `generation.ts`, `secrets.test.ts`); new `scripts/generate-room.mts`; `README.md`
**Dependencies**: none new. `zod` 4.6.5, `node:crypto` (for `createHash`), `node:util` `parseArgs` in the script.

## Related Work

**Implements**: TICKET-5 · [#6](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/6)   ·   **Epic**:
`architecture.md` (*Recommended approach*, *Key decisions · Other calls*, *Spikes 1–2*) +
`docs/tickets/llm-escape-room.md` (TICKET-5, TICKET-7)

**Back-references**:

- `.claude/plans/solver-verifier.md` (§ "What TICKET-5 will import", ~line 805) - Why: the `verifyRoom` call shape
  this ticket must keep; rejection-as-outcome; `fuzz.ts` is deep-importable for this ticket's tests.
- `.claude/plans/provider-adapters.md` (line 107) - Why: says #6 "will reuse the adapter for the generation model".
  **This plan deliberately diverges**: forced tool mode cannot return a room, so it adds a sibling JSON-mode
  client (decided with the user at planning time).
- `.claude/plans/scaffold-core-schemas-v0.md` (line 44) - Why: says the model-output schema is defined here and
  narrowed into `RoomSpec`. Do not add `.optional()` to `RoomSpecSchema`.

**Forward-references**:

- TICKET-7 (#8) adds `spatial`/`mixed` to `STRATEGIES`, reads `GenerationRecord.totals` for quota, and uses
  `differsFrom` for variety. TICKET-6 (#7) may call `generateRoom` for a fresh room instead of a fixture.

### Upstream state — verify before implementing

- TICKET-4 is **implemented but uncommitted** on `feature/provider-adapters` (`git status`: `?? lib/providers/`,
  `M README.md`). Baseline: `pnpm test` → **450 passed / 28 files**. `pnpm typecheck` should be clean.
- **Prerequisite:** commit TICKET-4 first (`piv-commit`), then branch `feature/room-generator` from it. Don't mix
  the two tickets in one diff.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `lib/solver/index.ts` (whole, 45 lines) - Why: the public surface. Import `verifySpec`, `SolverReport`,
  `RejectionCode`, `codesOf`, `DIFFICULTY_RANGES`, `bandFor`, `ANSWER_DOMAINS` from `@/lib/solver` only.
- `lib/solver/verify.ts` (lines 28-65, 67-148) - Why: `SolverResult` discriminated union, the pattern
  `GenerationResult` mirrors. `verifySpec` for an already-narrowed spec.
- `lib/solver/rejections.ts` (whole) - Why: rejection-as-outcome rationale; `Rejection` has optional
  `puzzleId`/`objectId`. The persisted log keeps `{code, puzzleId|null, objectId|null}` (null, not absent, because
  it IS serialised).
- `lib/solver/derivation.ts` (lines 40-80) - Why: exact certifiability rules the `symbolic` prompt must teach. A
  code clue must contain **exactly one digit run of the answer's length**. An answer clue must contain **exactly one
  member of the answer's lexicon domain**, matched as a whole token. Messages quote answers (line 95).
- `lib/solver/lexicon.ts` (lines 51-54) - Why: `ANSWER_DOMAINS` (direction, colour). The prompt lists them.
- `lib/solver/difficulty.ts` (lines 26-30, 56-113) - Why: band ranges, and the estimate rule
  `intended ≤ estimatedActions ≤ 3 × intended`. With a linear chain, intended = 2 × chainLength.
- `lib/solver/fuzz.ts` (lines 62-150) - Why: `buildValidRoom` / `roomFromSeed` produce certifiable rooms of the
  exact `symbolic` shape. Tests turn them into proposal JSON for the stub client. Deep import
  `@/lib/solver/fuzz` (tests only).
- `lib/schema/room.ts` (whole) - Why: the strict target, and the comment at 10-16 saying the loose schema lives in
  #6. `parseRoomSpec` / `RoomSpecError`.
- `lib/schema/version.ts` (lines 16, 49-56) - Why: `SPEC_VERSION`, `SchemaError` (carries `issues`).
- `lib/rng.ts` (lines 60-106) - Why: `createRng(seed)`; `int` is inclusive; `pick` / `shuffle`.
- `lib/providers/types.ts` (whole) - Why: `ProviderError`, `AdapterOptions`, token/latency/attempts conventions the
  generation client mirrors.
- `lib/providers/groq.ts` (lines 115-237) and `lib/providers/gemini.ts` (lines 30-40, 145-277) - Why:
  `compile*Request` / `decode*Response` / `create*Adapter` to mirror function-for-function. `GROQ_ENDPOINT`,
  `geminiEndpoint(modelId)`, `count()`, thought-part filtering, and thinking tokens counted as completion.
- `lib/providers/transport.ts` (lines 29-137) - Why: `postJson`, `DEFAULT_DEPS`, `TransportDeps`, `errorExcerpt`.
- `lib/providers/index.ts` (whole) - Why: the header comment lists what is and is not exported. Add the generation
  client in the same style.
- `lib/providers/testing.ts` (whole) - Why: `testDeps`, `stubFetch`, `fakeClock` for the client's tests.
- `lib/providers/secrets.test.ts` (lines 35-80, 94-146) - Why: sweeps that will automatically cover
  `lib/generator/`. Extend the "adapter output carries no key" block to the generation client.
- `lib/providers/env.ts` - Why: `readProviderKey`. Only `scripts/` calls it; `lib/generator` never reads env.
- `scripts/smoke-providers.mts` (whole) - Why: CLI style: `parseArgs`, `--env-file-if-exists`, never print a key,
  `process.exitCode`.
- `lib/solver/purity.test.ts` (whole) - Why: disk-sweep pattern for `lib/generator/boundary.test.ts`.
- `fixtures/index.ts` (lines 34-36, 51-95) - Why: `loadCanonicalRoom()`, `loadInvalidRoom('broken-chain')` for stub
  scripts.

### New Files to Create

- `lib/providers/generation.ts` - `GenerationClient` type + `createGenerationClient()` facade
- `lib/providers/generation.test.ts` - request compile, decode, errors, key hygiene for both providers
- `lib/generator/types.ts` - `StructuralBrief`, `GeneratorStrategy`, `Stamp`, `NarrowResult`, `AttemptFeedback`
- `lib/generator/proposal.ts` - shared loose `RoomProposalSchema` + `narrowProposal()`
- `lib/generator/proposal.test.ts`
- `lib/generator/strategies/symbolic.ts` - the `symbolic` strategy (brief, prompt, narrow)
- `lib/generator/strategies/symbolic.test.ts`
- `lib/generator/strategies/index.ts` - `STRATEGIES` registry + `resolveStrategy()`
- `lib/generator/fingerprint.ts` - `fingerprintRoom()`, `differsFrom()`
- `lib/generator/fingerprint.test.ts`
- `lib/generator/record.ts` - `GenerationRecordSchema` (Zod, persisted), `parseGenerationRecord()`
- `lib/generator/generate.ts` - `generateRoom()` loop, `GenerationResult`, `GenerationAbortedError`
- `lib/generator/generate.test.ts`
- `lib/generator/testing.ts` - `scriptedGenerationClient()`, `proposalFromSpec()` (test support, not exported)
- `lib/generator/boundary.test.ts` - disk sweep: no env, no fetch, no `Math.random`/`Date.now`, provider imports
  type-only, no answers in a persisted record
- `lib/generator/index.ts` - public surface
- `scripts/generate-room.mts` - opt-in live CLI

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Groq — Structured Outputs / JSON Object Mode](https://console.groq.com/docs/structured-outputs#json-object-mode)
  - Why: `response_format: { type: "json_object" }`. As with OpenAI, the word "JSON" must appear in the messages or
    the request is refused. When the model's output fails JSON validation, Groq returns **400** with
    `error.code: "json_validate_failed"` and the raw text in `error.failed_generation`. Treat that as the model's
    failure (an attempt), not a thrown error. **Verify the exact code in the live smoke.**
- [Gemini API — Structured output](https://ai.google.dev/gemini-api/docs/structured-output)
  - Why: `generationConfig.responseMimeType: "application/json"`. Do **not** send `responseSchema` /
    `responseJsonSchema` in v0: the proposal schema has unions and nullable fields that the OpenAPI subset handles
    unevenly, and Zod on our side is the real gate. `finishReason: "MAX_TOKENS"` yields truncated JSON, which is an
    `unparseable_json` attempt.
- [Zod 4 — `safeParse` / issues](https://zod.dev/basics#handling-errors) and
  [`z.prettifyError`](https://zod.dev/error-formatting#zprettifyerror)
  - Why: turn narrowing issues into short feedback lines (`path message`), the same shape `SchemaError` uses.

### Patterns to Follow

**Outcome, not exception** (`lib/solver/verify.ts:39-41`):

```ts
export type SolverResult =
  | { readonly ok: true; readonly report: SolverReport }
  | { readonly ok: false; readonly rejections: readonly Rejection[] };
```

Mirror it:

```ts
export type GenerationResult =
  | { readonly ok: true; readonly spec: RoomSpec; readonly report: SolverReport; readonly fingerprint: RoomFingerprint; readonly record: GenerationRecord }
  | { readonly ok: false; readonly record: GenerationRecord };
```

**Named error carrying data** (`lib/providers/types.ts:108-123`): `this.name = new.target.name`, readonly fields,
and a message built from fields that holds no secret or answer.

**Null, not absent, in anything serialised** (`lib/schema/room.ts:57-63`, `lib/schema/run.ts:45-47`):
`GenerationRecordSchema` uses `z.strictObject` and `.nullable()`. It never uses `.optional()`.

**Injected deps, no globals** (`lib/providers/transport.ts:29-39`): the generation client takes
`deps?: TransportDeps`. `generateRoom` takes the client as an argument. Nothing reads `Date.now` or
`Math.random` (the rng comes from `createRng(seed)`).

**Mirror function-for-function across providers** (`lib/providers/groq.ts:10-16`): add
`compileGroqJsonRequest` / `decodeGroqJsonResponse` and `compileGeminiJsonRequest` / `decodeGeminiJsonResponse`.

**Header comments** explain *why* in `── Section ──` blocks. Match the density of the neighbouring files. Every
new module opens with a doc comment naming the ticket (`TICKET-5 (#6)`).

**Imports** use `@/lib/...` across modules and `./x` within one. Tests use `vitest` `describe/it/expect` and live
next to the source as `*.test.ts`.

**Naming**: files are kebab/lower (`generate.ts`), types PascalCase, constants SCREAMING_SNAKE
(`STRATEGIES`, `DEFAULT_MAX_ATTEMPTS`), Zod schemas `XxxSchema` with `type Xxx = z.infer<…>`, and the parse
function is `parseXxx`.

---

## IMPLEMENTATION PLAN

### Phase 1: Generation client (providers)

JSON-mode sibling to the forced-tool adapters. It is additive; nothing existing changes behaviour.

### Phase 2: Generator foundation

**Independent of:** Phase 1, except for importing the `GenerationClient` *type*. Stub that type first and the two
phases can run in parallel.

Types, loose proposal schema + narrowing, the `symbolic` strategy, registry, fingerprint, record schema.

### Phase 3: The loop

**Depends on:** Phase 1 (type), Phase 2.

`generateRoom()` with feedback, cap, abort-on-`ProviderError`, and totals.

### Phase 4: CLI, boundaries, docs

**Depends on:** Phase 3.

---

## STEP-BY-STEP TASKS

### Task 1 — ADD `lib/providers/groq.ts`: JSON-mode compile/decode

- **IMPLEMENT**:
  - `export interface JsonRequest { readonly system: string; readonly prompt: string }` goes in `generation.ts`.
    Import it as a type here, or define it in `types.ts` to avoid a cycle (recommended: `types.ts`, beside
    `TurnRequest`).
  - `compileGroqJsonRequest(request: JsonRequest, config: GroqConfig)` →
    `{ model, messages: [{role:'system',content:system},{role:'user',content:prompt}], response_format: { type:
    'json_object' }, ...temperature/top_p only when non-null }`. **No `tools`, no `tool_choice`.**
  - `decodeGroqJsonResponse(status, json, { secrets, attempts })` →
    `{ text: string | null; tokens; anomaly: 'invalid_json' | null }`:
    - `status === 400 && error.code === 'json_validate_failed'` → `{ text: null, anomaly: 'invalid_json', tokens:
      {0,0} }`. **Do not** return `failed_generation`. It is untrusted text, and the generator only needs to know
      the attempt failed.
    - other non-2xx → `throw new ProviderError('groq', status, attempts, errorExcerpt(json, secrets) || …)`
    - 2xx → `text = choices[0].message.content ?? null`, tokens via `count()`.
- **PATTERN**: `lib/providers/groq.ts:124-161` (compile), `:175-214` (decode).
- **GOTCHA**: The word "JSON" must appear in the messages or Groq returns 400. The strategy prompt guarantees it.
  Also add a unit test asserting the compiled messages contain `/JSON/`.
- **GOTCHA**: Keep `GROQ_ENDPOINT` the only place the host is written.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1

### Task 2 — ADD `lib/providers/gemini.ts`: JSON-mode compile/decode

- **IMPLEMENT**:
  - `compileGeminiJsonRequest(request, config)` →
    `{ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', ...temperature/topP when non-null } }`. No `tools`,
    no `toolConfig`.
  - `decodeGeminiJsonResponse(status, json, ctx)`: non-2xx → `ProviderError`. Otherwise join the non-thought
    `text` parts (same filter as `:237`). Tokens: prompt + (candidates + thoughts). If
    `finishReason` is `'MAX_TOKENS'` or `'SAFETY'`, or there is no text, return `anomaly: 'invalid_json'` with
    whatever text there is set to `null`.
- **PATTERN**: `lib/providers/gemini.ts:153-206`, `:220-257`.
- **GOTCHA**: Unlike the adapter, `generationConfig` is **always** present here because `responseMimeType` is
  always set.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1

### Task 3 — CREATE `lib/providers/generation.ts` + UPDATE `lib/providers/types.ts`, `lib/providers/index.ts`

- **IMPLEMENT**:
  - In `types.ts`: `JsonRequest`, `JsonCompletion { readonly text: string | null; readonly anomaly: 'invalid_json'
    | null; readonly tokens: {prompt, completion}; readonly latencyMs: number; readonly attempts: number }`,
    `GenerationClient { readonly provider: Provider; readonly modelId: string; complete(request: JsonRequest):
    Promise<JsonCompletion> }`.
  - In `generation.ts`: `createGenerationClient(model: Pick<Competitor,'provider'|'modelId'|'params'>, apiKey:
    string, deps: TransportDeps = DEFAULT_DEPS): GenerationClient`. Switch on provider with a `never` default
    (mirror `index.ts:36-50`). Groq header `authorization: Bearer`, Gemini `x-goog-api-key`. Endpoint from
    `GROQ_ENDPOINT` / `geminiEndpoint(modelId)`, imported and **not re-typed**. `secrets: [apiKey]`.
  - Header comment: why this is a sibling and not a mode on `act()`. Folding a non-forced mode into the adapter
    would put `tool_choice`-free requests one flag away from a competitor call, and `equivalence.test.ts` pins the
    competitor requests. Also note the generator never plays a run.
  - `index.ts`: export `createGenerationClient` and the types `GenerationClient`, `JsonRequest`, `JsonCompletion`.
    Update the header comment's "What #7 and #6 import" example.
- **PATTERN**: `lib/providers/groq.ts:216-237` facade; `lib/providers/index.ts` export style.
- **GOTCHA**: `secrets.test.ts:78` asserts only `groq.ts` and `gemini.ts` match the hostname regex. Keep the
  hostnames out of `generation.ts`, comments included.
- **VALIDATE**: `pnpm typecheck && pnpm test lib/providers`
- **SATISFIES**: AC #1

### Task 4 — CREATE `lib/providers/generation.test.ts` + UPDATE `lib/providers/secrets.test.ts`

- **IMPLEMENT** (using `testDeps` from `./testing`):
  - Groq: body has `response_format.type === 'json_object'` and no `tools` / `tool_choice`. Messages match
    `/JSON/`. Null params are omitted. 200 → `text` + tokens + `latencyMs` + `attempts: 1`. A 429 then 200 →
    `attempts: 2`. `400 json_validate_failed` → `anomaly: 'invalid_json'`, `text: null`, no throw. 401 →
    `ProviderError`.
  - Gemini: `generationConfig.responseMimeType === 'application/json'`, no `tools` / `toolConfig`. Thought parts
    are excluded from `text`. Thinking tokens are counted as completion. `MAX_TOKENS` → `invalid_json`.
  - `secrets.test.ts`: add `it('generation client output and errors carry no key or endpoint')` to the
    "adapter output carries no key" describe. Use the same `GROQ_KEY` / `GEMINI_KEY` / `clean()` and cover both
    success and echoed-key 401/400.
- **PATTERN**: `lib/providers/groq.test.ts`, `lib/providers/secrets.test.ts:94-146`.
- **VALIDATE**: `pnpm test lib/providers`
- **SATISFIES**: AC #1, AC #8

### Task 5 — CREATE `lib/generator/types.ts`

- **IMPLEMENT**:
  ```ts
  export type StrategyName = string;               // registry keys; TICKET-7 adds 'spatial' | 'mixed'
  export interface StructuralBrief {               // the structure the model is asked to fill in
    readonly chainLength: number;
    readonly band: RoomSpec['difficulty']['band'];
    readonly finalAnswerDomain: AnswerDomain;      // from @/lib/solver
    readonly codeWidths: readonly number[];        // digits per code puzzle, length chainLength-1
    readonly decoys: number;
    readonly themeHint: string;
  }
  export interface Stamp { readonly seed: string; readonly roomId: string; readonly band: Band }
  export interface AttemptFeedback { readonly lines: readonly string[] } // in-memory only; may quote answers
  export type NarrowResult = { ok: true; spec: RoomSpec } | { ok: false; issues: readonly string[] };
  export interface GeneratorStrategy {
    readonly name: StrategyName;
    brief(rng: Rng): StructuralBrief;
    system(): string;
    prompt(brief: StructuralBrief, feedback: AttemptFeedback | null): string;
    narrow(json: unknown, stamp: Stamp): NarrowResult;
  }
  ```
- **GOTCHA**: `StructuralBrief` is intentionally generic enough for `symbolic`. Its fields are a v0 guess, and
  TICKET-7 may widen it. Say so in the comment. Keep `brief` pure over `rng`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #3

### Task 6 — CREATE `lib/generator/proposal.ts` + `proposal.test.ts`

- **IMPLEMENT**:
  - `RoomProposalSchema` is a loose `z.object` (not strict: extra keys from a chatty model are stripped, not fatal).
    Fields: `theme {name, description}`; `objects[]` of `{ id, name, description, kind (ObjectKindSchema), lock?:
    LockSchema | null, contains?: string[], clueText?: string | null }`; `puzzles[]` of `{ id, order?: int,
    kind, clueObjectId, answer: string | number, unlocksObjectId }`; `exit { objectId, requiresPuzzleId }`;
    `estimatedActions: int`; `solutionOrder?: string[]`.
  - Tolerances, each with a one-line why: absent `lock` → `null`, absent `contains` → `[]`, absent `clueText` →
    `null`. A numeric `answer` → `String()`, and a numeric `lock.code` too (models emit `4471` unquoted). Absent
    `order` → array index + 1. Absent `solutionOrder` → puzzle ids sorted by order. Strings are trimmed.
  - `narrowProposal(json, stamp): NarrowResult` builds the candidate
    `{ specVersion: SPEC_VERSION, seed, roomId, theme, objects, puzzles, exit, difficulty: { band: stamp.band,
    estimatedActions }, solution: { order } }` and runs it through `RoomSpecSchema.safeParse`. On failure it returns
    `issues` as `path message` strings (at most 10). It **never throws**.
  - Tests: canonical room → `proposalFromSpec` → `narrowProposal` → deep-equals the canonical room (with the stamp
    matching). Each tolerance is exercised. Missing `theme` → `ok:false` naming `theme`. Extra keys are stripped. A
    model-supplied `specVersion: 1` / `seed` / `band` is **ignored** in favour of the stamp.
- **PATTERN**: `lib/schema/room.ts:10-16` (why the loose schema exists), `lib/schema/version.ts:49-56` (issue
  formatting).
- **GOTCHA**: Build from `ObjectKindSchema` / `LockSchema` exported by `lib/schema/room.ts`. Don't copy the enums.
  Do **not** touch `RoomSpecSchema`.
- **VALIDATE**: `pnpm test lib/generator/proposal`
- **SATISFIES**: AC #2

### Task 7 — CREATE `lib/generator/strategies/symbolic.ts` + `symbolic.test.ts`

- **IMPLEMENT**:
  - `brief(rng)`: `band = 'standard'` (default, overridable via a factory `createSymbolicStrategy({ band })`).
    `chainLength` is chosen so `2 × chainLength` fits `DIFFICULTY_RANGES[band]` **and** stays ≤ 4 (PRD: ~3
    puzzles; watch target). That gives 3–4 for standard and 1–2 for easy; hard is refused unless the range allows
    it, so throw a clear `RangeError` for a band with no length ≤ 4. `finalAnswerDomain = rng.pick(Object.keys(
    ANSWER_DOMAINS))`. `codeWidths[i] = rng.pick([3, 4, 5])`. `decoys = rng.int(1, 3)`.
    `themeHint = rng.pick(THEME_HINTS)`, where `THEME_HINTS` is a local list of ~12 settings (lighthouse, observatory,
    apothecary, …).
  - `system()`: the role and the output contract. "Respond with a single JSON object only."
  - `prompt(brief, feedback)` is deterministic text that teaches the solver's rules as **hard constraints**:
    1. Exactly `chainLength` puzzles, a linear chain: the clue for puzzle N+1 is inside (directly or nested)
       the object puzzle N unlocks. The first clue is reachable without solving anything.
    2. Puzzles 1..N-1 are `kind:"code"`. Each unlocks a container or lock object with
       `lock: {opensWith:"code", code:<answer>}`. The code has exactly `codeWidths[i]` digits and is distinct from
       the others.
    3. The last puzzle is `kind:"answer"`, unlocks the `door` object (kind `door`, `lock:null`), and is
       `exit.requiresPuzzleId`. Its answer is one word from `ANSWER_DOMAINS[finalAnswerDomain]` (list them).
    4. Each clue's `clueText` contains its answer. A code clue contains **no other number with the same number of
       digits**. The final clue mentions **no other** word from that list. Descriptions never reveal a clue.
    5. Exactly `decoys` extra objects, unlocked and non-empty `clueText` that contains no digits and no lexicon word.
    6. `estimatedActions` is between `2×chainLength` and `6×chainLength`.
    7. Unique ids, every referenced id exists, each object has at most one container, no cycles.
    Then an **example of the JSON shape**, built from a *fuzz room*, not the canonical fixture, so the model isn't
    shown a real answer set. Keep it short. When `feedback` is not null, append "Your previous room was rejected
    for:" followed by the feedback lines, and ask for a **complete new room**.
  - `narrow(json, stamp)` delegates to `narrowProposal`.
  - Tests: `brief` is deterministic per seed (same seed → deep-equal) and varies across seeds (≥ 3 distinct
    briefs over 20 seeds). The chain length always fits the band. The prompt contains every
    `ANSWER_DOMAINS[domain]` member, the word `JSON`, `chainLength`, and each code width. The prompt with feedback
    contains the feedback lines. **The prompt of attempt 1 is byte-identical for the same seed.** Property: for 30
    seeds, `buildValidRoom(createRng(seed), { chainLength: brief.chainLength })` → `proposalFromSpec` → `narrow` →
    `verifySpec(...).ok === true`. This proves the narrowing accepts every room of the shape the prompt asks for.
- **PATTERN**: `lib/solver/fuzz.ts:62-150` (the room shape), `lib/solver/lexicon.ts:51`.
- **GOTCHA**: `buildValidRoom`'s band is derived from its own length. When stamping in the property test, use
  `bandFor(2 × chainLength)`, not the brief's band, or out-of-band rejections will be noise.
- **GOTCHA**: `derivation.ts` matches whole tokens, lowercased. "Northern" does not count as "north", but "north."
  does. Say "use the word exactly" in the prompt.
- **VALIDATE**: `pnpm test lib/generator/strategies`
- **SATISFIES**: AC #3, AC #4

### Task 8 — CREATE `lib/generator/strategies/index.ts`

- **IMPLEMENT**: `export const STRATEGIES: Readonly<Record<string, GeneratorStrategy>> = { symbolic:
  createSymbolicStrategy() }`. Also `resolveStrategy(name: string, registry = STRATEGIES): GeneratorStrategy`,
  which throws `Error("unknown strategy \"x\" — known: symbolic")`. The header comment says this is TICKET-7's
  extension point, the same way `lexicon.ts:30-37` names itself.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #3

### Task 9 — CREATE `lib/generator/fingerprint.ts` + `fingerprint.test.ts`

- **IMPLEMENT**:
  - `RoomFingerprintSchema` (strict, persisted inside the record):
    `{ strategy, chainLength, puzzleKinds: ('code'|'answer')[], unlockKinds: ('code'|'key'|'none')[] (per puzzle,
    from the unlocked object's lock), answerShapes: string[] ('digits:4' | 'domain:direction'), maxContainmentDepth,
    objectCount, decoyCount, intendedActions, band, structureHash }`.
  - `decoyCount` counts objects that are not a clue object, not an unlock target, and not an ancestor of either.
  - `structureHash` = `createHash('sha256')` over the **canonical JSON of the structural fields only** (every
    field above except `structureHash` and `strategy`, keys in fixed order), truncated to 16 hex chars.
    **Excludes** ids, names, theme, prose and answers.
  - `fingerprintRoom(spec, report, strategy): RoomFingerprint` and `differsFrom(a, b): boolean`, which compares
    `structureHash`.
  - Tests:
    - The canonical room's fingerprint is hard-coded: chainLength 3, kinds `[code, code, answer]`, shapes
      `[digits:4, digits:4, domain:direction]`, intendedActions 6, band standard, and the literal hash, which
      pins the algorithm like `rng.test.ts`.
    - Renaming every id, rewording every text and changing the answers → **same** hash.
    - Adding a decoy or changing a code width → **different** hash.
    - A 2-puzzle fuzz room vs a 3-puzzle one → `differsFrom` is true.
- **GOTCHA**: `node:crypto` is fine here: `lib/generator` is harness-side and not swept by `purity.test.ts`. Hash
  canonical JSON built by explicit key order, not `JSON.stringify(obj)` on an arbitrary object.
- **VALIDATE**: `pnpm test lib/generator/fingerprint`
- **SATISFIES**: AC #5

### Task 10 — CREATE `lib/generator/record.ts`

- **IMPLEMENT**: `GENERATION_RECORD_VERSION = 0`, and `GenerationRecordSchema` (strict, nullable not optional):
  ```ts
  {
    generationRecordVersion: z.literal(0),
    strategy, seed, roomId, provider: ProviderSchema, modelId,
    maxAttempts: int+,
    brief: StructuralBrief as strict object,
    attempts: [{
      index: int+ (1-based),
      outcome: z.enum(['accepted','rejected','proposal_malformed','unparseable_json']),
      rejections: [{ code: RejectionCodeSchema, puzzleId: string|null, objectId: string|null }],  // codes only
      malformedIssueCount: int>=0,
      tokens: { prompt, completion }, latencyMs: int>=0, providerCalls: int+   // providerCalls = transport attempts
    }],
    totals: { attempts, providerCalls, promptTokens, completionTokens, latencyMs },
    accepted: boolean,
    fingerprint: RoomFingerprintSchema.nullable(),
  }
  ```
  Also add `parseGenerationRecord(raw)`, which throws a `GenerationRecordError extends SchemaError`.
- **GOTCHA**: **No `message` field anywhere.** Rejection messages and Zod issue text can quote answers
  (`derivation.ts:95`). The record is written to disk next to the room and may drift toward a published artifact
  later, so it must be answer-free by construction. `malformedIssueCount` is enough for quota and diagnosis.
- **PATTERN**: `lib/schema/run.ts:84-104`, `lib/schema/version.ts:49`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #6, AC #8

### Task 11 — CREATE `lib/generator/generate.ts`

- **IMPLEMENT**:
  ```ts
  export const DEFAULT_MAX_ATTEMPTS = 5;
  export interface GenerateOptions {
    readonly client: GenerationClient;            // type import from '@/lib/providers'
    readonly strategy: GeneratorStrategy;
    readonly seed: string;
    readonly maxAttempts?: number;                // default 5, must be >= 1
    readonly roomId?: string;                     // default `${strategy.name}-${seed}`
  }
  export async function generateRoom(options): Promise<GenerationResult>
  export class GenerationAbortedError extends Error { readonly record: GenerationRecord; /* cause = ProviderError */ }
  ```
  Loop:
  1. `brief = strategy.brief(createRng(seed))`. It is computed **once**, and every retry repairs the same target
     structure. `stamp = { seed, roomId, band: brief.band }`.
  2. For `n = 1..maxAttempts`: `completion = await client.complete({ system: strategy.system(), prompt:
     strategy.prompt(brief, feedback) })`.
     - `ProviderError` → `throw new GenerationAbortedError(msg, record-so-far, { cause })`. The record so far
       includes the attempts completed; the failed call isn't counted because no usage came back. Any other error
       is rethrown untouched.
     - `anomaly === 'invalid_json'` or `JSON.parse` throws → outcome `unparseable_json`, feedback = `['the
       response was not a single valid JSON object']`.
     - `strategy.narrow` `ok:false` → outcome `proposal_malformed`, feedback = the issues (≤10 lines).
     - `verifySpec(spec)` `ok:false` → outcome `rejected`. Persist `{code, puzzleId ?? null, objectId ?? null}`.
       Feedback = `` `${code}: ${message}` `` lines. These may quote answers, which is fine: they go back only to
       the model that wrote the room.
     - `ok:true` → outcome `accepted`, then fingerprint and return.
  3. The cap trips → `{ ok: false, record }` with `accepted: false`, `fingerprint: null`.
  - `record` is built through `parseGenerationRecord` before returning, so a shape bug fails loudly in tests.
  - Totals are summed from attempts. `providerCalls` sums `completion.attempts`, the **real** call count including
    transport retries, which is the number #8 needs.
- **PATTERN**: the solver's intended call shape (`lib/solver/index.ts:4-13`), `SolverResult`.
- **GOTCHA**: Use `verifySpec` (already parsed) rather than `verifyRoom`. The narrow step already ran
  `RoomSpecSchema`. A narrowed spec whose `specVersion` would mismatch is impossible because it is stamped.
- **GOTCHA**: The feedback is **replaced** each attempt (only the previous attempt's reasons), not accumulated.
  That keeps prompt tokens flat across retries.
- **GOTCHA**: No `Date.now` or `Math.random`. `latencyMs` comes from the client.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #2, AC #6, AC #7

### Task 12 — CREATE `lib/generator/testing.ts`

- **IMPLEMENT**:
  - `proposalFromSpec(spec: RoomSpec): Record<string, unknown>` drops `specVersion` / `seed` / `roomId` / `band`,
    flattens `difficulty.estimatedActions` → `estimatedActions` and `solution.order` → `solutionOrder`.
  - `scriptedGenerationClient(script: (string | { anomaly: 'invalid_json' } | Error)[], opts?)` returns
    `{ client, requests }`. Each `complete()` shifts the next entry: a string → `text` with fixed tokens
    `{prompt:1000, completion:500}`, `latencyMs: 250`, `attempts: 1`. An `Error` is thrown. It records every
    `JsonRequest` so tests can assert on the feedback, and throws `'no scripted response left'` when empty.
  - The header comment says it is not exported from `index.ts`, like `lib/providers/testing.ts`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #9

### Task 13 — CREATE `lib/generator/generate.test.ts`

- **IMPLEMENT** (a stubbed provider only, no network):
  - **Happy path**: script = [valid room JSON] → `ok:true`, 1 attempt `accepted`, fingerprint present,
    `record.totals.providerCalls === 1`.
  - **Full funnel**: script = [`'not json {'`, `JSON.stringify({ theme: 1 })`,
    `JSON.stringify(proposalFromSpec(loadInvalidRoom('broken-chain') parsed))`, valid] → accepted on attempt 4.
    Outcomes are exactly `[unparseable_json, proposal_malformed, rejected, accepted]`. Attempt 3's
    rejections contain `chain_broken`. Totals are 4 attempts, 4000 prompt tokens, 1000 ms.
  - **Feedback**: `requests[1].prompt` mentions "not a single valid JSON", `requests[3].prompt` contains
    `chain_broken`, and `requests[0].prompt` contains no "rejected" section. The feedback is replaced, not
    accumulated: `requests[3]` does not contain attempt 1's line.
  - **Cap**: `maxAttempts: 3` and 3 rejections → `ok:false`, 3 attempts, `accepted:false`,
    `fingerprint:null`, and **no 4th request made**.
  - **Abort**: script = [rejected room, `new ProviderError('groq', 503, 4, 'gave up')`] → rejects with
    `GenerationAbortedError`. Its `.record.attempts.length === 1`, `.cause` is the `ProviderError`, and its message
    names no answer.
  - **Invalid-json anomaly** → `unparseable_json`.
  - **Determinism**: two runs with the same seed and script produce deep-equal records and identical attempt-1
    prompts.
  - **Registry**: `resolveStrategy('symbolic')` works, `resolveStrategy('spatial')` throws listing `symbolic`,
    and `generateRoom` with a **test-only second strategy** (a `GeneratorStrategy` literal defined in the test, whose
    `narrow` wraps `narrowProposal` and whose `brief` is fixed) accepts a room. This proves the loop is
    strategy-agnostic. `record.strategy` equals the test strategy's name.
  - **Answer hygiene**: for every accepted and rejected record in this file,
    `JSON.stringify(record)` contains none of the room's answers (including broken-chain's answers `4471`, `1770`,
    `north`).
- **PATTERN**: `lib/sim/secrecy.test.ts` (asserting absence of answers), `lib/providers/groq.test.ts` (scripted
  transport).
- **GOTCHA**: Answers like `4471` could appear in token counts by coincidence. Pick stub token counts that don't
  collide, or assert on the record minus `totals` / `tokens`.
- **VALIDATE**: `pnpm test lib/generator`
- **SATISFIES**: AC #2, AC #3, AC #6, AC #7, AC #8, AC #9

### Task 14 — CREATE `lib/generator/index.ts` + `lib/generator/boundary.test.ts`

- **IMPLEMENT**:
  - `index.ts` exports `generateRoom`, `GenerationAbortedError`, `DEFAULT_MAX_ATTEMPTS`, `STRATEGIES`,
    `resolveStrategy`, `fingerprintRoom`, `differsFrom`, `GenerationRecordSchema`, `parseGenerationRecord`, and the
    types. **Not** `testing.ts`. Explain why in a header comment in the style of `lib/solver/index.ts`.
  - `boundary.test.ts` sweeps `lib/generator/**/*.ts` (non-test) from disk and forbids `process.env`, `fetch(`,
    `http(s)://`, `Math.random`, `Date.now`, and any **value** import from `@/lib/providers`. `import type` is
    allowed: use the regex `/import\s+(?!type\b)[^;]*from\s+['"]@\/lib\/providers/`. It guards the guard (≥ 8 files,
    contains `generate.ts`) and includes a positive control. Mirror `lib/solver/purity.test.ts`.
- **GOTCHA**: `lib/generator` isn't in `secrets.test.ts`'s `ARTIFACT_SIDE`, and should not be added: it is
  harness-side. The env-read sweep (`lib/` is swept) already covers it.
- **VALIDATE**: `pnpm test lib/generator && pnpm test lib/providers/secrets`
- **SATISFIES**: AC #8

### Task 15 — CREATE `scripts/generate-room.mts`

- **IMPLEMENT**:
  - Run with `node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed <s> [--strategy
    symbolic] [--provider groq|gemini] [--model <id>] [--max-attempts 5] [--out runs/rooms]`.
  - Defaults: provider `groq`, model `llama-3.3-70b-versatile` (Gemini: `gemini-flash-latest`), the same as
    `smoke-providers.mts`. The header says model choice is TICKET-7's. `--seed` is required: a missing seed exits 2
    with usage. Don't default to a date, because a seed must be deliberate to be reproducible.
  - `resolveStrategy`, `readProviderKey`, `createGenerationClient`, `generateRoom`.
  - On `ok`, `mkdirSync(out, {recursive})` and write `<roomId>.json` (the `RoomSpec`) and
    `<roomId>.generation.json` (the record), both `JSON.stringify(x, null, 2) + '\n'`. Print a summary: roomId,
    attempts, outcome per attempt, totals and fingerprint. **Never print the spec or any answer.**
  - On `!ok`, write only `.generation.json`, print the summary, and exit 1. On `GenerationAbortedError`, write the
    partial record, print `error.message`, and exit 1.
- **PATTERN**: `scripts/smoke-providers.mts` (whole).
- **GOTCHA**: The `/runs/` default output is gitignored (`.gitignore` "Run artifacts"). Don't write into
  `fixtures/`.
- **VALIDATE**: `pnpm typecheck` and `node --import tsx scripts/generate-room.mts` (no args) → usage + exit 2, no
  network.
- **SATISFIES**: AC #6, AC #10

### Task 16 — UPDATE `README.md`

- **IMPLEMENT**: update the *Status* paragraph (the generator exists). Add a `lib/generator/` paragraph under
  *Contracts* in the neighbouring paragraphs' voice: what it proves, that rejection is counted, that the log
  holds no answers, and the CLI command. Mention that strategies are selected by `--strategy` and that TICKET-7
  adds the others.
- **VALIDATE**: read it back
- **SATISFIES**: AC #11

---

## TESTING STRATEGY

The project uses vitest (`vitest.config.mts`, `{lib,fixtures,scripts}/**/*.test.{ts,tsx}`, 30s timeout), with tests
colocated as `*.test.ts`. There are no live calls in `pnpm test`, and the live path is the opt-in CLI.

### Unit Tests

- `lib/providers/generation.test.ts`: request shape per provider, decode, anomalies, retries through `testDeps`.
- `lib/generator/proposal.test.ts`: every tolerance, stamp precedence, round-trip of the canonical room.
- `lib/generator/strategies/symbolic.test.ts`: brief determinism and variety, prompt content, and the property
  that every room of the brief's shape certifies after narrowing.
- `lib/generator/fingerprint.test.ts`: pinned canonical fingerprint + hash, invariance to prose, ids and answers,
  sensitivity to structure.

### Integration Tests

- `lib/generator/generate.test.ts`: the whole propose → narrow → verify → accept loop against the **real solver**
  and a scripted client, covering the funnel, feedback, cap, abort, determinism, registry and answer hygiene.
- `lib/generator/boundary.test.ts`, `lib/providers/secrets.test.ts`: structural sweeps.

### Edge Cases

- A model emits the code as a number (`4471`) → coerced to a string. A leading-zero code like `"0471"` must stay a
  string: the prompt says "quote codes". Test that a numeric `0471` can't occur (JSON has no leading zeros) and that
  `"0471"` survives.
- A model returns JSON wrapped in ```` ```json ```` fences despite JSON mode → treat as `unparseable_json` (do
  **not** strip fences: the modes guarantee raw JSON, and tolerating fences hides a provider misconfiguration).
  *Assumed; see Open Questions.*
- A model supplies its own `specVersion` / `seed` / `band` → the stamp wins.
- `maxAttempts: 0` or a non-integer → `RangeError` before any call.
- Empty-string `text` with no anomaly → `unparseable_json`.
- Groq `json_validate_failed` → an attempt, not a throw. Groq 401 → an abort.
- A brief for `hard` with a chain cap of 4 → `RangeError` naming the band.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm typecheck
```

(No linter is configured in this repo. Don't add one.)

### Level 2: Unit Tests

```bash
pnpm test lib/providers
pnpm test lib/generator
```

### Level 3: Integration / full suite

```bash
pnpm test   # baseline 450 passed / 28 files — expect ~+70 tests, 34 files, zero failures
```

### Level 4: Manual Validation (opt-in, live, spends free-tier quota)

```bash
node --import tsx scripts/generate-room.mts                         # usage, exit 2, no network
node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed plan-check-1 --provider groq
node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed plan-check-1 --provider gemini
cat runs/rooms/symbolic-plan-check-1.generation.json | head -60     # attempts, codes, totals — no answers
node --import tsx -e "import('./lib/solver/index.ts').then(async s => { const r = JSON.parse((await import('node:fs')).readFileSync('runs/rooms/symbolic-plan-check-1.json','utf8')); console.log(s.verifyRoom(r).ok) })"   # true
```

Record the acceptance rate and attempts-to-accept from ~3 seeds per provider in the execution report. TICKET-7
reads them.

### Level 5: Additional Validation (Optional)

`git diff --stat feature/provider-adapters` shows no change under `lib/solver/`, `lib/schema/` or `lib/sim/`.

---

## ACCEPTANCE CRITERIA

1. [ ] A JSON-mode `GenerationClient` exists for Groq and Gemini, built on `postJson`. `postJson` stays
   unexported, and the competitor adapters and `equivalence.test.ts` are unchanged.
2. [ ] A generation model proposes a candidate. It is narrowed from a loose model-facing schema into the strict
   `RoomSpec` (with no change to `RoomSpecSchema`) and certified by `verifySpec`.
3. [ ] The generator runs any `GeneratorStrategy` selected by name. `symbolic` ships, an unknown name fails with
   the known list, and a test-only second strategy runs through the same loop.
4. [ ] Every room of the `symbolic` brief's shape certifies after narrowing (property test over ≥30 seeds).
5. [ ] Each accepted room carries a `RoomFingerprint` whose `structureHash` ignores prose, ids and answers and
   changes with structure. The canonical fingerprint is pinned.
6. [ ] Every attempt is counted and logged with its outcome, rejection codes, tokens, latency and real provider
   calls. Totals are summed, and the record parses via `GenerationRecordSchema`.
7. [ ] Reject → regenerate with the previous attempt's reasons fed back, until acceptance or the cap (default 5).
   Hitting the cap returns `{ ok:false, record }`. A `ProviderError` throws `GenerationAbortedError` carrying the
   partial record.
8. [ ] No persisted record contains an answer. `lib/generator` reads no env, calls no network directly and imports
   providers type-only. The generation client leaks no key or endpoint.
9. [ ] All generator tests run against a stubbed provider. `pnpm test` makes no network call.
10. [ ] `scripts/generate-room.mts` generates and writes a certified room and its record from a live provider
    (manually verified with at least one provider).
11. [ ] `pnpm typecheck` is clean, `pnpm test` is fully green, and the README is updated.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No type checking errors
- [ ] Manual live run confirms a certified room (acceptance stats recorded)
- [ ] Acceptance criteria all met
- [ ] No diff under `lib/solver`, `lib/schema`, `lib/sim`

---

## OPEN QUESTIONS / ASSUMPTIONS

Decided with the user at planning time (2026-09-22):

- **Model seam** is a JSON-mode `createGenerationClient` sibling in `lib/providers`, not the forced-tool adapter.
- **Strategies**: a registry plus `symbolic` only. Spatial and mixed are TICKET-7's, with no placeholders.
- **Retry loop**: the previous attempt's reasons are fed back, the default cap is 5, the cap returns an outcome,
  and a `ProviderError` throws with the partial record.
- **Outputs**: library + fingerprint + opt-in CLI writing to `runs/rooms/`.

Assumptions made in this plan, to confirm if they bite:

- **Chain length is capped at 4** (PRD "~3 puzzles", 60–90s watch target). The `hard` band is therefore
  unreachable for `symbolic`. TICKET-7 may lift the cap.
- **Code widths 3–5 digits and a two-domain lexicon** are enough variety for the structure hash. If live runs show
  hash collisions between consecutive rooms, widen the brief, not the solver.
- **Fenced JSON is a failure, not tolerated.** If one provider fences routinely in JSON mode, revisit.
- **Groq's error code for invalid JSON-mode output is `json_validate_failed`.** Confirm in the first live run and
  adjust `decodeGroqJsonResponse` if not.
- **The generator model may be one of the competitors.** A model playing a room it wrote could be advantaged. That
  is a fairness question for TICKET-7's model choice and is not enforced here. Flag it in the execution report.
- **TICKET-4 is committed before this starts.** It is currently uncommitted on `feature/provider-adapters`.

## NOTES (open canvas)

### Why a sibling client and not `act()` with a flag

`act()`'s whole value is that both competitors' requests are pinned by `equivalence.test.ts`: forced mode, the same
tools, the same words. A `mode: 'json'` option on the adapter would put a non-forced, tool-free request one boolean
away from the competitor path, and the equivalence test would not notice a harness passing it. A separate factory
with a separate return type (`JsonCompletion`, with no `rawAction`) cannot be handed to the simulator by mistake,
because it doesn't type-check.

### Why the brief is fixed across retries

Retries are repairs of one target structure, not a lottery over structures. If each attempt re-rolled the brief, a
rejected 4-puzzle room could be "fixed" by a 3-puzzle room, and the attempt count would measure luck rather than how
reliably a model can hit a spec. That is the number TICKET-7 needs for the quota extrapolation. It also makes
`(seed, strategy)` → brief reproducible even though the model's text is not.

### Why the persisted log carries codes only

The solver's messages are written for humans debugging a test, and several quote the answer
(`answer_not_derivable`: "the answer "4471" cannot be read…"). The record sits next to the room on disk now, and the
publication path (TICKET-9) will be tempted to include it as provenance. Making it answer-free by construction is
cheaper than remembering to scrub it later. The feedback path, where answers are fine because the recipient
authored them, is in-memory only.

### Where acceptance rate will actually be won or lost

The derivation rules are strict and literal: one same-width digit run per code clue, and one lexicon member per
final clue. Most first-attempt rejections will be `answer_ambiguous` (a clue mentioning a year alongside a
four-digit code) and `chain_broken` (the model leaving a clue on the floor). The prompt states both rules concretely
and the feedback names them. If live acceptance within 5 attempts is poor, the next lever is a *skeleton* strategy.
In that design code emits the object/puzzle graph and the model writes only prose and answers, which is structurally
unbreakable. Architecture's "cheaper reject-and-repair loop" is that lever, and it plugs into the same
`GeneratorStrategy` interface, which is TICKET-7's call.

### Size estimate

About 450 source lines + ~450 test lines + ~90 CLI lines, inside the ticket's 500–900 (35% tests) once the README is
counted. It lands a little over, mostly from the providers tests.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
