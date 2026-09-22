# Feature: Provider adapters and tool-spec equivalence — TICKET-4 / issue #4

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

One adapter interface with two implementations, **Groq** and **Gemini**, that turn the single `ActionSchema`
(`lib/schema/action.ts:37`) into each provider's native tool-calling format. Each adapter makes **one model call
per turn** and returns a raw action for the simulator, the tokens the call used, and the real latency.

The ticket's real deliverable is the **equivalence check**. Each provider's compiled tool spec is converted back
into a neutral, provider-independent form and asserted deep-equal to the other provider's and to the Zod source.
If one provider's spec drifts, `pnpm test` fails. This is the architecture's fairness seam: *"An equivalence check
proves the compiled tool specs are genuinely the same task before any result is published."*

## User Story

As the person publishing a duel between two models
I want both models to be handed provably the same tools, the same words and the same forced tool-calling mode
So that a difference in the result is a difference between the models, not between two translations of the task

## Problem Statement

`ActionSchema` is defined once, but no model can read a Zod schema. Each provider has its own dialect: Groq uses
OpenAI-style `tools[].function.parameters` as JSON Schema with `arguments` returned as a JSON **string**. Gemini
uses `functionDeclarations[].parameters` as an OpenAPI-subset `Schema` with upper-case types and `args` returned
as an **object**. Two hand-written translations can drift silently: a description can be reworded, a `maxLength`
dropped, a parameter renamed. Each of these changes the task for one model only, and nothing notices. Today the
fairness claim is an assertion.

The harness (TICKET-6, #7) also needs the tokens and wall-clock time of every call. The simulator deliberately
never reads the clock (`lib/sim/budget.ts:13-20`), so latency has to be measured here.

## Solution Statement

A neutral **portable spec** sits between the Zod schema and the providers:

```
ActionSchema ──derive──▶ PortableSpec ──compileGroq──▶ Groq tools ──normaliseGroq──▶ PortableSpec'
                              │                                                          ║ deep-equal
                              └────────compileGemini──▶ Gemini decls ──normaliseGemini──▶ PortableSpec''
```

1. `vocabulary.ts` derives `PortableSpec` from `ActionSchema.options`. Tool names are the verbs. Parameter schemas
   come from `z.toJSONSchema(member.omit({ name: true }))`. Descriptions live in one table keyed by `ActionName`,
   so neither provider can be given different words.
2. `groq.ts` and `gemini.ts` each have a pure `compile*Tools(spec)` and a pure `normalise*Tools(native)` that
   inverts it, plus a pure `compile*Request(turnRequest)` and a pure `decode*Response(json)`.
3. `equivalence.ts` exports `findSpecDrift(a, b): Drift[]`. The contract test asserts zero drift across the three
   pairs (source↔Groq, source↔Gemini, Groq↔Gemini). A positive control asserts drift is found when a compiled spec
   is deliberately mutated.
4. `transport.ts` handles `fetch`, retries with backoff for 429 and 5xx responses (respecting `retry-after`),
   timing of the **successful** attempt, and redaction. A model's bad output is **not** an error: it comes back as
   a `ProviderTurn` with an `anomaly`, and the simulator scores it `malformed`, which costs a turn.
5. `env.ts` is the **only** file in the repo, outside `scripts/`, allowed to read `process.env`. `secrets.test.ts`
   enforces this by scanning the source on disk.

Every choice that affects fairness is written down once and applied to both providers: forced tool calling, a
single call per turn, verbatim verdict text sent back, and the same system and user text.

## Out of Scope / Non-Goals

- **Not included: the turn loop, the prompt wording, the event log, `RunSummary.costUsd`.** All belong to TICKET-6
  (#7). The adapter takes a `system` string and a transcript and makes **one** call. It never builds an
  observation into prose and never talks to the simulator.
- **Not included: choosing the two models.** TICKET-7 (#8) settles that with the quota spike. Model ids are
  constructor arguments. Tests use placeholders like `test-model`. Nothing is hard-coded except in the smoke
  script's `--model` defaults.
- **Not included: live network calls in `pnpm test`.** Every test injects a stub `fetch`. The only live path is
  the opt-in `scripts/smoke-providers.mts`, and it is not part of validation.
- **Not included: the published artifact.** TICKET-9 (#9) owns it. This ticket asserts the preconditions: no key
  or endpoint can leave `lib/providers`, and no artifact-side module can import it.
- **Not included: a provider SDK.** Raw `fetch`, zero new dependencies (decision 3 below).
- **Not included: Gemini's Interactions API.** The docs now lead with `/v1beta/interactions`. We use
  `models/{model}:generateContent`, which is active, stateless and documented.
- **Not changing: `lib/schema/*`, `fixtures/*`, `lib/sim/*`, `lib/solver/*`.** They are the wave-2 contract.
  Tool descriptions live in `lib/providers/vocabulary.ts`, **not** as `.describe()` calls added to `ActionSchema`,
  so the schema and its fixtures stay byte-identical.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium–High (two wire formats, a round-trip proof, retry/timing edge cases)
**Primary Systems Affected**: new `lib/providers/`; new `scripts/smoke-providers.mts`; `README.md`; `.env.example`
**Dependencies**: none new. Zod 4.6.5 `z.toJSONSchema` (verified present and producing clean output), global
`fetch` (Node 22.23.2)

## Related Work

**Implements**: [#4](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/4) · **Epic**:
`docs/tickets/llm-escape-room.md` (TICKET-4) + `architecture.md` → *Boundaries & contracts · Provider adapters*

**Back-references**:

- `.claude/plans/scaffold-core-schemas-v0.md` - Why: defines `ActionSchema`, `PROVIDERS`, `CompetitorSchema.params`
  (null = provider default), and the `SchemaError` pattern
- `.claude/plans/room-simulator.md` - Why: `Simulator.apply(raw: unknown, cost: ActionCost)` is the consumer of
  this ticket's output. A malformed payload is a verdict and not a throw, which is why a model's bad output is
  data here too.
- `.claude/plans/solver-verifier.md` - Why: `purity.test.ts` is the disk-sweep pattern `secrets.test.ts` mirrors.
  It already forbids `@/lib/providers` imports in `lib/solver`.

**Forward-references**:

- (none yet). TICKET-6 (#7) will import `createGroqAdapter` / `createGeminiAdapter` / `ProviderTurn`, and TICKET-5
  (#6) will reuse the adapter for the generation model.

### Upstream state — verified before planning (2026-09-22)

- TICKET-1, -2, -3 complete and committed: `345ac3b`, `b8cf5b8`, `c5f365e` + `5604a8a` (ticket 3 committed at the
  start of this session). `pnpm typecheck` clean, `pnpm test` **371/371 across 22 files**.
- Working branch: `feature/provider-adapters`, stacked on `feature/solver-verifier` →
  `feature/room-simulator` → `feature/scaffold-core-schemas-v0`. No PRs are open. Issues #1–#4 are open.

### Decisions settled at the Phase 2 gate (user accepted defaults)

1. **Scope:** the adapter is one call → `{ rawAction, tokens, latencyMs }`. Prompting and the loop are TICKET-6.
   Stub `fetch` in tests. Opt-in live smoke script.
2. **Tool shape:** **7 tools, one per verb**. Tool name = verb; parameters = that member minus `name`. Tool use is
   **forced**: Groq `tool_choice: "required"` + `parallel_tool_calls: false`; Gemini
   `toolConfig.functionCallingConfig.mode: "ANY"`.
3. **Transport:** raw `fetch`, no SDKs.
4. **Equivalence:** normalise both compiled specs back to `PortableSpec`, then deep-equal them against each other
   and the source. A constraint one provider can't express is dropped from **both**. `parseAction`, run inside
   the simulator, enforces it after the call. A positive control proves drift is detected.
5. **Failures:** no call, several calls, or bad arguments become a raw action + `anomaly` (the simulator scores it
   `malformed` and a turn is consumed). A 429 or 5xx is retried up to 3 times with backoff respecting
   `retry-after`, then a typed `ProviderError` is thrown whose message never contains the key. `latencyMs` counts
   the successful attempt only.
6. **Branch:** stack on ticket 3.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `lib/schema/action.ts` (whole file, 125 lines) - Why: the source of truth. `ActionSchema.options` is ordered
  identically to `ACTION_NAMES` (`:71-79`), which `action.test.ts:28` asserts. `IntentSchema` = 1..280 chars.
  Every member is `z.strictObject`.
- `lib/schema/run.ts` (lines 12-28) - Why: `PROVIDERS = ['groq','gemini']`, `ProviderSchema`, and
  `Competitor.params` `{ temperature, topP }` where **`null` means provider default**, so the field must be
  **omitted** from the request, not sent as `null`.
- `lib/schema/version.ts` (lines 42-56) - Why: `SchemaError` pattern (named subclass, `this.name = new.target.name`).
  `ProviderError` mirrors its naming but extends `Error`, because it carries no Zod issues.
- `lib/sim/budget.ts` (lines 23-27) - Why: `ActionCost = { tokens: { prompt, completion }, elapsedMs }`.
  `ProviderTurn.tokens` must have exactly this shape, and `latencyMs` maps to `elapsedMs`, so TICKET-6 converts
  with no arithmetic.
- `lib/sim/simulator.ts` (lines 59-73, 97-140) - Why: `apply(raw: unknown, …)` runs `ActionSchema.safeParse`. Any
  non-action (`null`, an array, an object with an unknown `name`) becomes a `malformed` verdict that consumes a
  turn. This is why the adapter never throws on model output.
- `lib/sim/observation.ts` (lines 1-47) - Why: the secrecy boundary. The adapter must only ever send what the
  harness hands it. It has no access to a `RoomSpec` and must not import `lib/sim` at all.
- `lib/solver/purity.test.ts` (whole file) - Why: **the pattern to mirror** for `secrets.test.ts`: read the
  directory from disk, `FORBIDDEN` regex table with `why`, "guards the guard" count check, import allowlist,
  positive control.
- `lib/sim/secrecy.test.ts` (lines 1-40) - Why: the house style for contract tests. A long header comment says what
  the invariant *precisely* is and when the test will fire.
- `lib/solver/index.ts`, `lib/sim/index.ts` - Why: the narrow-seam pattern. A header comment gives a usage sketch,
  and there is a "What is deliberately NOT exported" section.
- `fixtures/index.ts` (lines 1-45) + `fixtures/logs/canonical-run.json` - Why: `loadCanonicalLog()` yields 27 real
  actions covering 5+ verbs. The round-trip test encodes each one as a native tool call and decodes it back.
- `vitest.config.mts` - Why: tests match `{lib,fixtures,scripts}/**/*.test.{ts,tsx}`, `@` alias = repo root,
  environment `node`.
- `.gitignore` (lines 1-6) - Why: `.env*` ignored, `!.env.example` allowed. The new `.env.example` is committable.

### New Files to Create

- `lib/providers/types.ts` - `ProviderAdapter`, `TurnRequest`, `TranscriptEntry`, `ProviderTurn`, `TurnAnomaly`,
  `ToolCall`, `ProviderError`
- `lib/providers/vocabulary.ts` - `PortableSpec` / `PortableTool` / `PortableParam` types, `TOOL_DESCRIPTIONS`,
  `buildPortableSpec()`, `toRawAction()`
- `lib/providers/equivalence.ts` - `findSpecDrift()`, `Drift` type
- `lib/providers/transport.ts` - `postJson()` with retry/backoff/timing/redaction; injectable `fetch`, `now`, `sleep`
- `lib/providers/groq.ts` - `compileGroqTools`, `normaliseGroqTools`, `compileGroqRequest`, `decodeGroqResponse`,
  `createGroqAdapter`
- `lib/providers/gemini.ts` - same five for Gemini
- `lib/providers/env.ts` - `readProviderKey(provider, env = process.env)`, `PROVIDER_KEY_VARS`
- `lib/providers/index.ts` - narrow public seam
- `lib/providers/vocabulary.test.ts`
- `lib/providers/transport.test.ts`
- `lib/providers/groq.test.ts`
- `lib/providers/gemini.test.ts`
- `lib/providers/equivalence.test.ts` - **THE CONTRACT TEST** (the filename is named by the ticket)
- `lib/providers/secrets.test.ts`
- `lib/providers/testing.ts` - stub `fetch` builder + canned native responses, shared by tests (not exported from
  `index.ts`)
- `scripts/smoke-providers.mts` - opt-in live check, one call per provider
- `.env.example` - `GROQ_API_KEY=` / `GEMINI_API_KEY=`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Groq API reference — Chat completions](https://console.groq.com/docs/api-reference#chat-create)
  - `POST https://api.groq.com/openai/v1/chat/completions`, `Authorization: Bearer <key>`
  - `tools[] = { type: "function", function: { name, description, parameters } }`, max 128
  - `tool_choice: "none" | "auto" | "required" | { type: "function", function: { name } }`
  - `parallel_tool_calls` (default `true`, **set `false`**), `temperature`, `top_p`, `max_completion_tokens`
  - Response: `choices[0].message.tool_calls[] = { id, type: "function", function: { name, arguments } }`, where
    **`arguments` is a JSON string**. `finish_reason` is `"tool_calls" | "stop" | "length"`.
    `usage.{prompt_tokens, completion_tokens, total_tokens}`.
  - Why: the entire Groq wire format.
- [Groq — Tool use](https://console.groq.com/docs/tool-use)
  - Tool results go back as `{ role: "tool", tool_call_id, name, content }`, and the assistant turn as
    `{ role: "assistant", tool_calls: [...] }`
  - Why: transcript encoding.
- [Gemini API — generateContent](https://ai.google.dev/api/generate-content)
  - `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header
    `x-goog-api-key: <key>`
  - Body: `contents[]`, `systemInstruction`, `tools[].functionDeclarations[] = { name, description, parameters }`,
    `toolConfig.functionCallingConfig = { mode: "ANY", allowedFunctionNames? }`,
    `generationConfig.{ temperature, topP, maxOutputTokens }`
  - Response: `candidates[0].content.parts[].functionCall = { name, args (object), id? }`, `finishReason`
    (`STOP`, `MAX_TOKENS`, `SAFETY`, `MALFORMED_FUNCTION_CALL`, …),
    `usageMetadata.{ promptTokenCount, candidatesTokenCount, thoughtsTokenCount? }`
  - Why: the entire Gemini wire format.
- [Gemini API — Schema object](https://ai.google.dev/api/caching#Schema)
  - `type` is an **upper-case enum** (`OBJECT`, `STRING`, …). Supports `properties`, `required`, `description`,
    `minLength`, `maxLength`, `propertyOrdering`. **No `additionalProperties`.**
  - Why: this is the subset that defines the portable spec (see Task 2 GOTCHA).
- [Gemini API — Function calling · thought signatures](https://ai.google.dev/gemini-api/docs/function-calling)
  - Thinking models return an opaque `thoughtSignature` on the `functionCall` part. On multi-turn calls it **must be
    echoed back verbatim**, or later turns 400 or lose context.
  - Why: this forces `ToolCall.native` (an opaque passthrough) into the transcript type.
- [Zod 4 — JSON Schema](https://zod.dev/json-schema)
  - `z.toJSONSchema(schema)`. Output includes a `$schema` key (strip it) and emits `additionalProperties: false`
    for `strictObject`.
  - Why: the derivation step in `vocabulary.ts`.

### Patterns to Follow

**Module header comment** — every source file opens with a JSDoc block that names the ticket, cites the
architecture sentence it enforces, and has `── Section ──` sub-headings for the non-obvious rules. Example,
`lib/sim/budget.ts:3-20`:

```ts
/**
 * The run budget — actions, tokens and wall clock — as a ledger the facade
 * charges once per action.
 *
 * ── Exhaustion is an outcome, not an exception ─────────────────────────────
 * `lib/schema/run.ts` is explicit and `architecture.md` agrees: ...
 */
```

**Named errors** — `lib/schema/version.ts:48-56`:

```ts
export class SchemaError extends Error {
  readonly issues: z.core.$ZodIssue[];
  constructor(message: string, issues: z.core.$ZodIssue[]) {
    super(`${message}: ...`);
    this.name = new.target.name;
    this.issues = issues;
  }
}
```

`ProviderError` mirrors it: `readonly provider: Provider; readonly status: number | null; readonly attempts:
number`. The message is built from those fields only, **never** from request headers or the URL query.

**Outcome, not exception** — `lib/sim/budget.ts:60` `chargeLedger` returns `{ ledger, exhausted }`. Adapters return
`ProviderTurn` with `anomaly`, and throw only for transport failure after retries.

**Constants as `as const` tuples + derived enum** — `lib/schema/run.ts:13-15`:

```ts
export const PROVIDERS = ['groq', 'gemini'] as const;
export const ProviderSchema = z.enum(PROVIDERS);
```

Mirror this for `TURN_ANOMALIES`.

**Naming**: files kebab/lowercase single word (`transport.ts`), functions `camelCase` verbs (`compileGroqTools`),
types `PascalCase`, constants `SCREAMING_SNAKE`. British spelling in identifiers and prose, matching the codebase:
`normalise`, `summarise`, `behaviour`.

**Imports**: `@/lib/...` for cross-module, `./x` within a module. Type-only imports use `import type`.

**Test style** — `describe` per unit, `it` sentences that state the rule and often the *why*
(`action.test.ts:31`: `'requires intent on every single verb — it is a product feature, not a debug field'`).
Assertion messages are passed as the second arg to `expect` (`purity.test.ts:54`).

**Logging**: none. The codebase has no logger. Do not add `console.*` in `lib/`. Only the smoke script prints.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — types, portable spec, drift finder

`types.ts`, `vocabulary.ts`, `equivalence.ts`. All are pure and need no network. After this phase the neutral
form exists and can be compared.

### Phase 2: Transport

**Depends on:** Phase 1 (`ProviderError` in `types.ts`)
**Independent of:** Phase 3's compile/normalise functions (these are pure and don't touch transport)

`transport.ts`: one `postJson` with retry, backoff, timing and redaction, fully injectable.

### Phase 3: The two providers

**Depends on:** Phases 1 and 2

`groq.ts` then `gemini.ts`, each as four pure functions plus a thin `create*Adapter` that wires them to
`postJson`. The two files are independent of each other. Write Groq first, because its shape is closest to
the JSON Schema that `z.toJSONSchema` emits.

### Phase 4: Seams, secrets and the contract test

**Depends on:** Phase 3

`env.ts`, `index.ts`, `equivalence.test.ts`, `secrets.test.ts`, smoke script, `.env.example`, README.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1 — CREATE `lib/providers/types.ts`

- **IMPLEMENT**:
  ```ts
  export interface TurnRequest {
    /** Identical for both competitors — TICKET-6 builds it once. */
    readonly system: string;
    readonly transcript: readonly TranscriptEntry[];
  }

  /** Provider-neutral conversation. Each adapter encodes it into its own dialect. */
  export type TranscriptEntry =
    | { readonly kind: 'user'; readonly text: string }                 // observation / harness prose
    | { readonly kind: 'assistant_text'; readonly text: string }       // a turn where the model spoke instead of acting
    | { readonly kind: 'tool_call'; readonly call: ToolCall }
    | { readonly kind: 'tool_result'; readonly callId: string; readonly toolName: string; readonly text: string };

  export interface ToolCall {
    /** Provider's id when it gives one; else synthesised `call-<n>` by the adapter. */
    readonly callId: string;
    readonly toolName: string;
    /** Parsed arguments, or the raw string when they were not valid JSON. */
    readonly args: unknown;
    /** Opaque provider data that must round-trip verbatim (Gemini thoughtSignature). Never inspect it. */
    readonly native?: unknown;
  }

  export const TURN_ANOMALIES = ['no_tool_call', 'multiple_tool_calls', 'unparseable_arguments', 'provider_rejected_call'] as const;
  export type TurnAnomaly = (typeof TURN_ANOMALIES)[number];

  export interface ProviderTurn {
    /** Hand straight to `Simulator.apply`. `null`/array/garbage are fine — the simulator scores them `malformed`. */
    readonly rawAction: unknown;
    /** What to append to the transcript. `null` when the model called no tool. */
    readonly toolCall: ToolCall | null;
    /** Free text the model produced, if any. */
    readonly text: string | null;
    readonly anomaly: TurnAnomaly | null;
    /** Same shape as `ActionCost.tokens` in lib/sim/budget.ts. */
    readonly tokens: { readonly prompt: number; readonly completion: number };
    /** Wall-clock ms of the SUCCESSFUL attempt only. Maps to `ActionCost.elapsedMs`. */
    readonly latencyMs: number;
    /** 1 + retries. Recorded so quota analysis (#8) can count real calls. */
    readonly attempts: number;
  }

  export interface ProviderAdapter {
    readonly provider: Provider;
    readonly modelId: string;
    act(request: TurnRequest): Promise<ProviderTurn>;
  }

  export class ProviderError extends Error { provider; status: number | null; attempts; … this.name = new.target.name }
  ```
- **PATTERN**: `lib/schema/run.ts:12-15` (as-const tuple), `lib/schema/version.ts:48-56` (named error)
- **IMPORTS**: `import type { Provider } from '@/lib/schema/run';`
- **GOTCHA**: `ProviderTurn` is what TICKET-6 will partly serialise into an `Event`. It must carry **no** URL, header,
  key or raw response body. `native` is the one opaque field. Document that TICKET-6 must not write it to the
  event log (it has no field for it anyway, because `EventSchema` is strict).
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1 (one adapter interface), AC #4 (tokens + latency shape)

### Task 2 — CREATE `lib/providers/vocabulary.ts`

- **IMPLEMENT**:
  - Types:
    ```ts
    export interface PortableParam { readonly type: 'string'; readonly description: string; readonly minLength: number | null; readonly maxLength: number | null }
    export interface PortableTool { readonly name: ActionName; readonly description: string; readonly params: Readonly<Record<string, PortableParam>>; readonly required: readonly string[] }
    export interface PortableSpec { readonly tools: readonly PortableTool[] }   // ordered as ACTION_NAMES
    ```
  - `TOOL_DESCRIPTIONS: { readonly [N in ActionName]: { tool: string; params: Record<string, string> } }`. Write
    it once, in plain words, and base it on the JSDoc in `action.ts:38-66`. `intent` gets the **same**
    description on all 7 tools: *"One short sentence, in your own words, saying why you are taking this action.
    Shown to viewers beside your character."* The mapped type makes a missing verb a compile error.
  - `buildPortableSpec(): PortableSpec`. For each `member` of `ActionSchema.options`:
    `const json = z.toJSONSchema(member.omit({ name: true }))`. Read `json.properties` and `json.required`. For
    each property, **assert** `type === 'string'`. Throw `Error('unsupported param type …')` otherwise, because
    the portable subset is strings-only and a future non-string param must be a deliberate decision. Copy
    `minLength` / `maxLength` (null when absent). Look up descriptions. Also assert that every param has a
    description and no description names a param that doesn't exist. Memoise in a module-level const.
  - `toRawAction(toolName: string, args: unknown): unknown`. When `args` is a plain object, return
    `{ ...args, name: toolName }` (**name last**, so an args key called `name` can't override the tool). When
    `args` is a string (unparseable), return `{ name: toolName, arguments: args }`, which fails `strictObject`
    → `malformed`. Otherwise return `{ name: toolName, arguments: args }`.
- **PATTERN**: exhaustive record keyed on a union, the same idea as `VERDICT_TALLY` in `lib/sim/simulator.ts:42`
- **IMPORTS**: `import { z } from 'zod'; import { ActionSchema, ACTION_NAMES, type ActionName } from '@/lib/schema/action';`
- **GOTCHA**:
  - The portable subset is **exactly** what Gemini's `Schema` can express: `type`, `description`, `minLength`,
    `maxLength`, `required`. `additionalProperties: false` is **deliberately not** in `PortableSpec`. It's dropped
    for both providers (decision 4), and `strictObject` in the simulator enforces it. Put a `── Why no
    additionalProperties ──` section in the header explaining this.
  - `z.toJSONSchema` output includes `$schema` and `additionalProperties`. Ignore both. Don't copy unknown keys
    through, because an unknown key would reach one provider's spec but not the other's.
  - `.omit` on a `strictObject` returns a strict object. Verified output (session): `use` →
    `properties: { itemId: {type:'string',minLength:1}, targetId: {…}, intent: {type:'string',minLength:1,maxLength:280} }`,
    `required: ['itemId','targetId','intent']`.
  - `look` has only `intent`. Its `params` has one key. It must not be empty.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #2 (compile the single schema), AC #3 (one source of words)

### Task 3 — CREATE `lib/providers/vocabulary.test.ts`

- **IMPLEMENT**: cases:
  - produces exactly 7 tools, named and ordered as `ACTION_NAMES`
  - each tool's param keys equal the Zod member's `shape` keys minus `name` (compute from `ActionSchema.options[i].shape`, **not** from JSON Schema, so this is an independent check)
  - `intent` is required on every tool with `minLength 1`, `maxLength 280`, and has the identical description on all 7
  - every `targetId`/`itemId`/`code`/`answer`/`puzzleId` has `minLength: 1`
  - every tool and param has a non-empty description
  - `toRawAction('look', { intent: 'x' })` → parses with `ActionSchema`; `toRawAction('look', { intent: 'x', name: 'teleport' })` → `name === 'look'`
  - `toRawAction('look', '{"intent":')` → `ActionSchema.safeParse(...).success === false`
  - `buildPortableSpec()` returns the same reference twice (memoised) and is deep-frozen or at least never mutated by callers (`Object.isFrozen` if you freeze it; recommended)
- **PATTERN**: `lib/schema/action.test.ts:14-44`
- **VALIDATE**: `pnpm test lib/providers/vocabulary.test.ts`
- **SATISFIES**: AC #2

### Task 4 — CREATE `lib/providers/equivalence.ts`

- **IMPLEMENT**:
  ```ts
  export interface Drift { readonly path: string; readonly left: unknown; readonly right: unknown }
  export function findSpecDrift(left: PortableSpec, right: PortableSpec): Drift[]
  ```
  Compare the tool lists (count, order, names). For each tool, compare the description, the sorted `required`, and
  the param key set. For each param, compare `type`, `description`, `minLength` and `maxLength`. `path` looks like
  `tools.use.params.itemId.maxLength`. Collect **all** differences, don't stop at the first (same reason
  `findSeqBreaks` returns every offender, `lib/schema/event.ts:75-98`). The header comment quotes
  `architecture.md`: *"Without it the fairness claim is an assertion."*
- **PATTERN**: `lib/schema/event.ts:83-98` (return offenders, never throw)
- **GOTCHA**: `required` order may legitimately differ between providers. Compare sorted copies. Tool **order** is
  not semantically meaningful to a model, but keep it asserted, because a reordering means someone edited one
  compiler and not the other. Label that drift `tools[order]`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #3

### Task 5 — CREATE `lib/providers/transport.ts`

- **IMPLEMENT**:
  ```ts
  export interface TransportDeps {
    readonly fetch: typeof fetch;             // default globalThis.fetch
    readonly now: () => number;               // default () => performance.now()
    readonly sleep: (ms: number) => Promise<void>;
  }
  export const DEFAULT_RETRY = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 20_000 } as const;
  export interface PostResult { readonly status: number; readonly json: unknown; readonly latencyMs: number; readonly attempts: number }
  export async function postJson(provider: Provider, url: string, headers: Record<string,string>, body: unknown, deps: TransportDeps, retry = DEFAULT_RETRY): Promise<PostResult>
  ```
  - Loop: `t0 = now()`, `res = await deps.fetch(url, { method:'POST', headers:{'content-type':'application/json', ...headers}, body: JSON.stringify(body) })`, then parse `json` (tolerate a non-JSON body by parsing it as `null`), then `latencyMs = Math.round(now() - t0)`.
  - `2xx` → return.
  - `429`, `500`, `502`, `503` or `504` → if `attempt <= maxRetries`, wait
    `min(maxDelayMs, retryAfterMs ?? baseDelayMs * 2**(attempt-1))`, then retry. `retry-after` may be seconds or an
    HTTP date. Parse both, and fall back to backoff if it's unparseable.
  - A thrown `fetch` (network error) counts as retryable in the same way.
  - Any other `4xx` → **return** `{status, json, …}` without retrying. The provider module decides whether it is a
    model-output failure (Groq `tool_use_failed`, see Task 7) or a real error.
  - Out of retries → `throw new ProviderError(provider, lastStatus, attempts, 'gave up after N attempts')`.
  - **Redaction**: the error message is built from provider/status/attempts, plus at most 200 chars of the
    provider's error `message` field, passed through `redact(text, secrets)`, which replaces each secret's
    occurrences with `***`. `postJson` takes the header values as secrets. Never include `url` in any message.
    Never attach the `Response` or request.
- **PATTERN**: `lib/sim/budget.ts` "no clock here" discipline. The clock is **injected**, so tests are
  deterministic.
- **IMPORTS**: `import { ProviderError } from './types'; import type { Provider } from '@/lib/schema/run';`
- **GOTCHA**:
  - Only the successful attempt's latency is returned (decision 5). Backoff sleeps are not model think-time and
    must not show up as "hesitation" in the replay.
  - Don't read `process.env` here. Don't `console.*`.
  - `performance` is a global in Node 22, so it needs no import.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #4 (real latency), AC #5 (no key in errors)

### Task 6 — CREATE `lib/providers/testing.ts` + `lib/providers/transport.test.ts`

- **IMPLEMENT** `testing.ts`:
  - `stubFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string,string> } | Error>)`. It
    returns `{ fetch, calls }`, where `calls` records `{ url, init }` for assertions. Each call shifts the next
    response. A leftover or missing response throws.
  - `fakeClock(stepMs = 100)`. Returns `now` advancing by `stepMs` per call, plus `sleep` that records requested
    delays and resolves immediately.
  - `groqToolCallResponse(calls: {id,name,arguments:string}[], usage)` and `geminiFunctionCallResponse(parts,
    usage)`: canned native bodies.
  - The file header states that it is test support and deliberately left out of `index.ts`, like `lib/solver/fuzz.ts`.
- **IMPLEMENT** `transport.test.ts` cases:
  - 200 → returns json, `attempts: 1`, `latencyMs` from the fake clock
  - 429 with `retry-after: 2` → sleeps 2000, then 200 → `attempts: 2`; **latencyMs is the second attempt only**
  - 503 ×4 → throws `ProviderError` with `attempts: 4`, `status: 503`
  - backoff doubles when there is no `retry-after` (1000, 2000, 4000) and is capped at `maxDelayMs`
  - `retry-after` as an HTTP date is honoured
  - a thrown network error is retried
  - 400 is returned, not thrown and not retried
  - **redaction**: a provider error body that echoes the key (`"Invalid API key sk_TEST_SECRET"`) produces an error
    whose `message`, `String(err)` and `JSON.stringify(err)` do not contain `sk_TEST_SECRET`
  - the error message never contains the URL
- **VALIDATE**: `pnpm test lib/providers/transport.test.ts`
- **SATISFIES**: AC #4, AC #5

### Task 7 — CREATE `lib/providers/groq.ts`

- **IMPLEMENT**:
  - `GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'`
  - `compileGroqTools(spec)` → `[{ type:'function', function:{ name, description, parameters:{ type:'object', properties:{ k:{ type:'string', description, minLength?, maxLength? } }, required:[...] } } }]`. Omit `minLength`/`maxLength` when null. **Do not** emit `additionalProperties`.
  - `normaliseGroqTools(tools: unknown): PortableSpec` inverts the above. It reads only the known keys. An
    **unknown key** anywhere (for example `additionalProperties`, `enum`, `pattern`) goes into the spec as
    drift-visible. The easiest way is to throw `Error('unexpected key …')`, so a compiler that starts emitting
    extra keys fails the contract test loudly.
  - `compileGroqRequest(req: TurnRequest, cfg: { modelId, params })` → body:
    - `messages`: `{role:'system',content:system}`, then per entry: `user`→`{role:'user',content}`;
      `assistant_text`→`{role:'assistant',content}`; `tool_call`→`{role:'assistant',content:null,tool_calls:[{id:callId,type:'function',function:{name:toolName,arguments: typeof args==='string'?args:JSON.stringify(args)}}]}`;
      `tool_result`→`{role:'tool',tool_call_id:callId,name:toolName,content:text}`
    - `tools: compileGroqTools(buildPortableSpec())`, `tool_choice:'required'`, `parallel_tool_calls:false`
    - `temperature`/`top_p` **only when non-null**
  - `decodeGroqResponse(status, json, callIndex): Omit<ProviderTurn,'latencyMs'|'attempts'>`:
    - `usage.prompt_tokens`/`completion_tokens` → `tokens` (0 when absent)
    - 0 tool calls → `anomaly:'no_tool_call'`, `rawAction:null`, `text: message.content ?? null`
    - ≥2 → `anomaly:'multiple_tool_calls'`, `rawAction: calls.map(toRawAction)` (an array, so `malformed`),
      `toolCall` = the first call (so the transcript stays well-formed; the harness answers it with the
      `malformed` verdict)
    - 1 call → `JSON.parse(arguments)` in try/catch. On failure: `anomaly:'unparseable_arguments'`, `args` = the
      raw string
    - `callId = id ?? \`call-${callIndex}\``
    - **status 400 with `error.code === 'tool_use_failed'`** → `anomaly:'provider_rejected_call'`,
      `rawAction: { name: '__rejected__', failed_generation: error.failed_generation ?? null }`, `toolCall:null`,
      tokens 0. Any other non-2xx → `throw new ProviderError(...)` (redacted).
  - `createGroqAdapter({ apiKey, modelId, params, deps? })`: `ProviderAdapter`. `act()` = compile → `postJson` with
    header `authorization: Bearer ${apiKey}` → decode → add `latencyMs`/`attempts`. Keep a per-adapter call counter
    for synthesised call ids.
- **PATTERN**: pure functions + thin facade, like `lib/sim/simulator.ts` over `resolve.ts`
- **IMPORTS**: `./vocabulary`, `./transport`, `./types`, `import type { Competitor } from '@/lib/schema/run'` (use
  `Competitor['params']` for `params`)
- **GOTCHA**:
  - Groq returns **400 `tool_use_failed`** when `tool_choice:'required'` and the model's output can't be parsed as
    a tool call. That is the **model's** failure. It must consume a turn (`anomaly`), not throw and not be retried.
    Verify the exact error-body shape in the Groq docs/error reference during implementation (expected
    `{ error: { message, type: 'invalid_request_error', code: 'tool_use_failed', failed_generation } }`). If the
    shape differs, adjust the detector and the canned fixture together.
  - `arguments` is a **string**. Parse it here, never downstream.
  - Don't put the key in the URL.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1, #2, #4

### Task 8 — CREATE `lib/providers/groq.test.ts`

- **IMPLEMENT**: cases:
  - `compileGroqTools` emits 7 tools with `type:'function'` and no `additionalProperties`
  - `normaliseGroqTools(compileGroqTools(spec))` deep-equals `spec`
  - `normaliseGroqTools` throws on an unexpected key (positive control for strict inversion)
  - request: system first, `tool_choice:'required'`, `parallel_tool_calls:false`; `temperature` present when set,
    **absent** (not null) when `null`; a transcript with each entry kind encodes as specified; `tool_call` args
    are stringified
  - decode: single call → `rawAction` parses with `ActionSchema`; tokens mapped; `callId` from the provider
  - decode: no call → `no_tool_call`, `rawAction:null`, `text` kept
  - decode: two calls → `multiple_tool_calls`, `ActionSchema.safeParse(rawAction).success === false`
  - decode: bad JSON args → `unparseable_arguments`, parse fails
  - decode: 400 `tool_use_failed` → `provider_rejected_call`, not thrown
  - decode: 401 → throws `ProviderError`, and the message doesn't contain the key
  - adapter `act()` with a stub fetch: correct URL, `authorization` header, `latencyMs` from the fake clock,
    `attempts`
  - **end-to-end with the simulator**: `createSimulator` on `loadCanonicalRoom()`. The Groq stub returns
    `inspect desk`. `sim.apply(turn.rawAction, { tokens: turn.tokens, elapsedMs: turn.latencyMs })` → verdict
    `ok`. A second stub returns no call → `malformed`, and the action counter advanced. This proves the adapter's
    output plugs straight into the seam. (Importing `lib/sim` **from a test** is fine. Only the source must not.)
- **VALIDATE**: `pnpm test lib/providers/groq.test.ts`
- **SATISFIES**: AC #1, #2, #4

### Task 9 — CREATE `lib/providers/gemini.ts`

- **IMPLEMENT**:
  - `geminiEndpoint(modelId) = \`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent\``
  - `compileGeminiTools(spec)` → `{ functionDeclarations: [{ name, description, parameters: { type:'OBJECT', properties:{ k:{ type:'STRING', description, minLength?:'1', maxLength?:'280' } }, required:[...], propertyOrdering:[...param keys in spec order] } }] }`
  - `normaliseGeminiTools(tools)` inverts it: upper→lower type, `String`→`Number` for lengths. It **accepts
    numbers or strings** for lengths, because the API docs type them as int64-as-string. It ignores
    `propertyOrdering` only after asserting it equals the property key set, and throws on any other unknown key.
  - `compileGeminiRequest(req, cfg)`:
    - `systemInstruction: { parts:[{ text: system }] }`
    - `contents`: `user`→`{role:'user',parts:[{text}]}`; `assistant_text`→`{role:'model',parts:[{text}]}`;
      `tool_call`→`{role:'model',parts:[ call.native ?? { functionCall:{ name, args, id? } } ]}` (echo the native
      part **verbatim** when present, which is how `thoughtSignature` survives);
      `tool_result`→`{role:'user',parts:[{ functionResponse:{ name:toolName, id?:callId, response:{ result:text } } }]}`
    - `tools:[compileGeminiTools(buildPortableSpec())]`, `toolConfig:{ functionCallingConfig:{ mode:'ANY' } }`
    - `generationConfig`: `temperature`/`topP` only when non-null (omit `generationConfig` entirely if empty)
  - `decodeGeminiResponse(status, json, callIndex)`:
    - parts = `candidates?.[0]?.content?.parts ?? []`; calls = parts with `functionCall`
    - tokens: `prompt = promptTokenCount ?? 0`, `completion = (candidatesTokenCount ?? 0) + (thoughtsTokenCount ?? 0)`
    - `finishReason === 'MALFORMED_FUNCTION_CALL'` → `anomaly:'provider_rejected_call'`, `rawAction:{ name:'__rejected__' }`
    - 0 calls → `no_tool_call` (text = joined text parts or null); ≥2 → `multiple_tool_calls`; 1 → `toRawAction(name, args)`
    - `ToolCall.native` = **the whole original part** (it contains `functionCall` and possibly `thoughtSignature`)
    - `callId = functionCall.id ?? \`call-${callIndex}\``
    - non-2xx → `ProviderError`
  - `createGeminiAdapter({ apiKey, modelId, params, deps? })`, with header `x-goog-api-key: ${apiKey}`. **Never
    `?key=` in the URL.**
- **PATTERN**: mirror `groq.ts` function-for-function, so the two files diff cleanly
- **GOTCHA**:
  - Gemini `args` is already an **object**, so no JSON.parse. Groq's is a string. This asymmetry is exactly what
    the round-trip test in Task 12 exists to catch.
  - Echoing `native` means **provider-specific data sits in the neutral transcript**. That is acceptable only as an
    opaque passthrough. A Groq adapter handed a transcript containing a Gemini `native` must ignore it (a
    competitor never switches provider mid-run, but say so in a comment).
  - Thinking tokens count toward `completion`. Otherwise a thinking model looks cheaper than it is, and the token
    budget in `lib/sim/budget.ts` is charged unevenly.
  - Verify during implementation that `minLength`/`maxLength` are accepted on `STRING` schemas by the live API (the
    smoke script, Task 15). If the API rejects them, **drop them from `PortableParam` for both providers** (decision
    4) and record an AMENDMENT. Don't make the Gemini compiler silently drop them, because the equivalence test
    would then (correctly) fail.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1, #2, #4

### Task 10 — CREATE `lib/providers/gemini.test.ts`

- **IMPLEMENT**: the same case list as Task 8, adapted to Gemini, plus:
  - upper-case types and `propertyOrdering` emitted; round-trip normalise equals the spec
  - `null` params → no `generationConfig` key at all
  - `toolConfig.functionCallingConfig.mode === 'ANY'`
  - a `tool_call` entry with `native` containing `thoughtSignature: 'opaque-sig'` is echoed byte-for-byte into
    `contents`
  - `thoughtsTokenCount` is added to `completion`
  - `MALFORMED_FUNCTION_CALL` → `provider_rejected_call`
  - URL contains the model id and **no** `key=`; the header carries the key
  - the end-to-end simulator case, as in Task 8
- **VALIDATE**: `pnpm test lib/providers/gemini.test.ts`
- **SATISFIES**: AC #1, #2, #4

### Task 11 — CREATE `lib/providers/env.ts`

- **IMPLEMENT**:
  ```ts
  export const PROVIDER_KEY_VARS: Readonly<Record<Provider, string>> = { groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY' };
  export function readProviderKey(provider: Provider, env: Readonly<Record<string, string | undefined>> = process.env): string
  ```
  Throws `ProviderError(provider, null, 0, \`${PROVIDER_KEY_VARS[provider]} is not set\`)` when missing or blank.
  The message names the **variable**, never a value. Header comment: *"The only file in lib/ that reads
  process.env. `secrets.test.ts` enforces it. Keys live in the harness environment only (architecture.md →
  Boundaries · Secrets)."* Also note that Next only inlines `NEXT_PUBLIC_*` into client bundles, so these names
  must **never** gain that prefix.
- **GOTCHA**: adapters take `apiKey` as a constructor argument and **do not** call `readProviderKey` themselves.
  That keeps the adapters testable with a fake key, and puts exactly one env read on the harness's call path.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #5

### Task 12 — CREATE `lib/providers/equivalence.test.ts` — THE CONTRACT TEST

- **IMPLEMENT**: header comment in the style of `lib/sim/secrecy.test.ts:8-30`. State the invariant precisely:
  *both models are handed the same tools, the same words, the same constraints, the same forced mode, and their
  answers decode to the same actions.* Then:
  1. **Spec equivalence, three ways**: `findSpecDrift(source, normaliseGroqTools(compileGroqTools(source)))`,
     the same for Gemini, and Groq↔Gemini. Each must equal `[]`. Print drift in the assertion message.
  2. **Source fidelity**: independent of `vocabulary.ts`, walk `ActionSchema.options[i].shape` (minus `name`) and
     assert every key appears in the portable tool, with the same required-ness. This catches a bug in
     `buildPortableSpec` that both compilers would faithfully reproduce.
  3. **Positive controls** (the file is worthless without them): each mutation below applied to a *compiled* spec
     yields non-empty drift at the expected `path`:
     - Gemini `use.itemId.maxLength` removed/changed
     - Groq `inspect` description reworded by one word
     - Groq param renamed `targetId`→`target_id`
     - a tool dropped from the Gemini list
     - `required` shortened on one side
  4. **Decode equivalence (round trip)**: for every action in `loadCanonicalLog()` (27 events), encode it as a
     native tool call in **both** dialects (`groqToolCallResponse` with `arguments: JSON.stringify(argsWithoutName)`,
     `geminiFunctionCallResponse` with `args` as an object), decode it, and assert both `rawAction`s `toEqual` the
     original `event.action` **and each other**. Also assert every `ACTION_NAMES` verb occurs at least once across
     the cases. If the canonical log misses a verb, add a synthetic case for it.
  5. **Request equivalence**: build one `TurnRequest` containing all four entry kinds. Compile it for both
     providers, then extract the ordered list of human-readable texts (system, user texts, tool-result texts). Assert
     the two lists are identical. Assert both force tool use (`tool_choice==='required'` ⇔ `mode==='ANY'`) and
     that both send `temperature` iff the params set it. This covers the "same framing" half of fairness that
     tool specs alone don't.
- **PATTERN**: `lib/sim/secrecy.test.ts` (header + positive control), `lib/solver/corpus.test.ts` (fixture-driven
  contract test)
- **GOTCHA**: "fails the build if they drift" means `pnpm test` in this repo (there is no CI yet). Say so in the
  header comment, and note that a future CI must run `pnpm test`. If a case 3 mutation *doesn't* produce drift,
  the drift finder is broken. Fix `findSpecDrift`, never the assertion.
- **VALIDATE**: `pnpm test lib/providers/equivalence.test.ts`
- **SATISFIES**: AC #3 (the ticket's real deliverable)

### Task 13 — CREATE `lib/providers/secrets.test.ts`

- **IMPLEMENT**: mirror `lib/solver/purity.test.ts`. Sections:
  1. **Env reads are confined**. Walk `lib/**`, `app/**` and `fixtures/**` source (`.ts`/`.tsx`, excluding
     `*.test.ts`) from disk, recursively. `process.env` may appear **only** in `lib/providers/env.ts`. "Guards the
     guard": assert ≥ 30 files swept and `lib/providers/env.ts` among them.
  2. **Nothing on the artifact side can reach the providers**. No file under `lib/schema`, `lib/sim`, `lib/solver`,
     `fixtures` or `app` imports `@/lib/providers` or `../providers`. (TICKET-9's `lib/artifact` should be added to
     this list when it exists. Leave a comment saying so.)
  3. **Endpoints are confined**. The strings `api.groq.com` and `generativelanguage.googleapis.com` appear only in
     `lib/providers/groq.ts` / `gemini.ts` (and the smoke script, which is outside the swept dirs).
  4. **Committed data is clean**. Every `.json` under `fixtures/` contains no `https?://`, no `api.groq.com` or
     `googleapis`, and nothing that looks like a key: `/\bgsk_[A-Za-z0-9]{20,}/` (Groq) or
     `/\bAIza[0-9A-Za-z_-]{30,}/` (Google).
  5. **Adapter output is clean**. Run both adapters through a stub fetch with `apiKey: 'gsk_TEST_SECRET_…'` /
     `'AIzaTEST_SECRET_…'`, including a 401 path. `JSON.stringify(turn)` and `String(error)` contain neither the
     key nor the endpoint host.
  6. **Positive control**. The planted source string `const k = process.env.GROQ_API_KEY; fetch("https://api.groq.com")`
     trips sections 1 and 3's patterns, and a planted `gsk_…` JSON trips section 4.
- **GOTCHA**: `next.config.ts`, `vitest.config.mts` and `scripts/*` are outside the swept dirs on purpose.
  `scripts/` is harness-side, and reading env there is correct. State that in the header.
- **VALIDATE**: `pnpm test lib/providers/secrets.test.ts`
- **SATISFIES**: AC #5 ("a test asserts no key or endpoint can reach a published artifact")

### Task 14 — CREATE `lib/providers/index.ts`

- **IMPLEMENT**: header with the usage sketch:
  ```ts
  const adapter = createGroqAdapter({ apiKey: readProviderKey('groq'), modelId, params });
  const turn = await adapter.act({ system, transcript });
  const { verdict } = sim.apply(turn.rawAction, { tokens: turn.tokens, elapsedMs: turn.latencyMs });
  ```
  Export: `createGroqAdapter`, `createGeminiAdapter`, `createAdapter(competitor, apiKey)` (switch on
  `competitor.provider`, exhaustive `never` check), `readProviderKey`, `PROVIDER_KEY_VARS`, `buildPortableSpec`,
  `findSpecDrift`, `TURN_ANOMALIES`, `ProviderError`, and types `ProviderAdapter`, `ProviderTurn`, `TurnRequest`,
  `TranscriptEntry`, `ToolCall`, `TurnAnomaly`, `PortableSpec`, `Drift`.
  **Deliberately NOT exported** (write the section): `postJson` (a caller with raw transport could bypass forced
  tool mode, which is the fairness setting), the `compile*`/`decode*` internals, and `testing.ts`.
- **PATTERN**: `lib/solver/index.ts`, `lib/sim/index.ts`
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #1

### Task 15 — CREATE `scripts/smoke-providers.mts` + `.env.example`

- **IMPLEMENT**:
  - `.env.example`: two lines, `GROQ_API_KEY=` and `GEMINI_API_KEY=`, each with a comment naming the free-tier
    console URL.
  - Script: for each provider whose key is set (skip others with a printed note), build an adapter. Model from
    `--groq-model` / `--gemini-model` args, with defaults of a current free-tier model id for each (look them up at
    implementation time; don't hard-code in `lib/`). Send one `TurnRequest`: the system text is a minimal
    instruction, and the user text is `describeRoom(compileRoom(loadCanonicalRoom()))` prose. Print
    `provider, modelId, anomaly, rawAction, ActionSchema.safeParse(rawAction).success, tokens, latencyMs, attempts`.
    Never print the key. Exit non-zero on `ProviderError`.
  - Run with: `node --env-file-if-exists=.env --import tsx scripts/smoke-providers.mts`
- **GOTCHA**: this is **not** part of validation and must never run in `pnpm test` (it is `.mts`, not
  `.test.ts`, so vitest won't collect it). It is the one place the live API confirms the Task 9 `minLength`/
  `maxLength` assumption and the Task 7 `tool_use_failed` shape.
- **VALIDATE**: `pnpm typecheck` (the script is covered by `tsconfig` `include: **/*.mts`). The live run is optional.
- **SATISFIES**: AC #1, AC #4 (manual confirmation against real providers)

### Task 16 — UPDATE `README.md`

- **IMPLEMENT**: in *Status*, provider adapters join the "done" sentence, and the replay player is the remaining
  wave-2 work. Add a `lib/providers/` paragraph after the `lib/solver/` one (same register, 5-7 lines). It says
  one vocabulary is compiled to Groq and Gemini, an equivalence test proves both models get the same tools, words
  and forced mode, and fails `pnpm test` if either drifts. It also says keys are read only in `lib/providers/env.ts`
  from `GROQ_API_KEY` / `GEMINI_API_KEY`, and gives the smoke command.
- **PATTERN**: the existing `lib/solver/` paragraph (`README.md`, added in `5604a8a`)
- **VALIDATE**: `git diff README.md` reads cleanly
- **SATISFIES**: documentation

---

## TESTING STRATEGY

### Unit Tests

Every pure function has direct cases: `vocabulary`, `equivalence`, `transport`, and the four per-provider
functions. The network is always a stub `fetch` injected through `deps`, never `vi.stubGlobal`, so tests can't
leak into each other. The clock and sleep are injected via `fakeClock`, so retry tests take no real time.

### Integration Tests

- `equivalence.test.ts`: source ↔ both compilers ↔ both decoders, driven by the golden log.
- `groq.test.ts` / `gemini.test.ts` end-to-end cases: adapter → `Simulator.apply` on the canonical room, for both
  the well-formed and the malformed path.
- `secrets.test.ts`: repo-wide sweep over files on disk.

### Edge Cases

- `null` temperature/topP → field **absent**, not `null`
- model returns text only / 2 calls / bad JSON args / a tool name outside the vocabulary (`teleport`) → each is a
  `malformed` verdict via `rawAction`, with none thrown
- args containing a `name` key can't override the tool name
- Groq 400 `tool_use_failed` → a turn consumed, not an exception
- Gemini `MALFORMED_FUNCTION_CALL` → the same
- missing `usage` / `usageMetadata` → tokens 0, not NaN
- `thoughtsTokenCount` counted
- missing provider call id → synthesised and stable per adapter
- `retry-after` in seconds, as an HTTP date, and garbage
- network exception, then success
- an error body that echoes the key → redacted
- empty transcript (first turn) → valid request for both

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm typecheck
```

(No linter in this repo, by design. This matches tickets 1–3.)

### Level 2: Unit Tests

```bash
pnpm test lib/providers
```

### Level 3: Integration Tests

```bash
pnpm test lib/providers/equivalence.test.ts lib/providers/secrets.test.ts
pnpm test            # full suite: expect 371 + new, zero regressions
pnpm build           # static build still clean — proves nothing in app/ pulled in lib/providers
```

### Level 4: Manual Validation

```bash
# Contract untouched:
git diff --stat feature/solver-verifier -- lib/schema fixtures lib/sim lib/solver   # must print nothing

# Portable spec eyeball:
node --import tsx -e "import {buildPortableSpec} from './lib/providers/index.ts'; console.log(JSON.stringify(buildPortableSpec(), null, 1))"

# Optional live smoke (requires keys in .env):
node --env-file-if-exists=.env --import tsx scripts/smoke-providers.mts
```

Expected smoke output: one line per provider with `anomaly: null`, `parsed: true`, non-zero tokens, and plausible
latency.

### Level 5: Additional Validation (Optional)

```bash
grep -rn "process.env" lib app fixtures --include=*.ts --include=*.tsx | grep -v "\.test\.ts" # only lib/providers/env.ts
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** One `ProviderAdapter` interface; `createGroqAdapter` and `createGeminiAdapter` implement it;
      `createAdapter(competitor, key)` dispatches on `Competitor.provider`
- [ ] **AC #2** Both adapters compile tools from the single `ActionSchema` via `buildPortableSpec()`. There are no
      hand-written parameter lists.
- [ ] **AC #3** `equivalence.test.ts` proves zero drift source↔Groq↔Gemini, identical decoded actions for all
      golden-log actions, and identical framing texts/forced mode. Positive controls prove drift is detected. Drift
      fails `pnpm test`.
- [ ] **AC #4** Every `ProviderTurn` carries `tokens` in `ActionCost` shape and `latencyMs` of the successful attempt;
      `attempts` recorded
- [ ] **AC #5** Keys read only in `lib/providers/env.ts`; `secrets.test.ts` proves no env read, endpoint, key-shaped
      string or provider import can reach `lib/schema`, `lib/sim`, `lib/solver`, `fixtures` or `app`, and that
      adapter outputs and errors never contain the key
- [ ] A model's bad output never throws: it yields a `rawAction` the simulator scores `malformed`
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build` all clean; zero regressions in the existing 371
- [ ] `lib/schema`, `fixtures`, `lib/sim` and `lib/solver` are byte-identical to `feature/solver-verifier`
- [ ] No new dependencies in `package.json`
- [ ] README updated

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No type checking errors
- [ ] Manual validation (contract diff, spec eyeball) done; live smoke run if keys available, else stated as skipped
- [ ] Acceptance criteria all met
- [ ] Execution report written to `.claude/reports/provider-adapters-report.md`

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Settled at the gate (user accepted defaults):** decisions 1–6 under *Related Work*.
- **Assumed — Gemini's `Schema` accepts `minLength`/`maxLength` on `STRING`.** The docs list them. Confirm with the
  smoke script. If it's false, drop both from `PortableParam` for **both** providers and add an AMENDMENT (Task 9
  GOTCHA).
- **Assumed — Groq's forced-mode parse failure is a 400 with `error.code === 'tool_use_failed'`.** Confirm against
  Groq's error docs or the smoke script (Task 7 GOTCHA).
- **Assumed — Gemini `functionResponse.response` takes `{ result: string }`.** Any JSON object is accepted. Keep the
  key name identical in spirit to Groq's `content`. The request-equivalence test compares the text, not the
  envelope.
- **Assumed — no `max_completion_tokens` / `maxOutputTokens` cap is set.** The run budget in `lib/sim/budget.ts`
  already caps tokens across the run. A per-call cap would be a second, provider-specific limit and a fairness
  variable. TICKET-7 can add one symmetrically if quota demands it.
- **Open for TICKET-6, not this ticket:** what to append to the transcript after a `no_tool_call` turn
  (`assistant_text` + a `user` entry carrying the malformed verdict is the obvious answer). The types here support
  it.
- **Framing-bias open question (architecture):** this ticket constrains it with identical tools, words, mode and
  texts, but doesn't prove it absent. That matches the architecture's position. Nothing to do here.

## NOTES (open canvas)

### Why a portable spec instead of comparing Groq JSON to Gemini JSON directly

Comparing two dialects directly requires a mapping between them, and that mapping is a third translation that can
itself be wrong. Normalising both **back** to a form derived from the source makes every compiler prove it's a
faithful inverse of the same thing. It also gives a third comparison (source↔each) that catches a bug both
compilers share. A bug in `buildPortableSpec` itself would pass all three, which is why Task 12 case 2 re-derives
from `ActionSchema.shape` independently.

### Why strict inversion (throw on unknown key) matters

If `normaliseGroqTools` ignored keys it didn't recognise, someone could add `enum: [...]` to the Groq compiler,
giving one model a hint the other doesn't get, and equivalence would still pass. Throwing on the unknown key makes
"a new constraint for one provider" impossible to land without also extending `PortableParam`, and that forces the
question "can the other provider express it?"

### Rejected alternatives

| Option | Why rejected |
|---|---|
| One `act` tool with a union of 7 | Gemini's `oneOf` support is weak; nesting changes the task shape; every native tool-calling example is one tool per verb |
| `.describe()` on `ActionSchema` | Touches the wave-2 contract (`lib/schema`), and descriptions are prompt-layer, not schema-layer |
| `parametersJsonSchema` on Gemini | Passes JSON Schema nearly verbatim, so equivalence would be trivially true while hiding what the model actually sees. `parameters` forces the mapping to be explicit and tested. |
| Provider SDKs | Two dependencies, harder to stub, and the SDKs add their own retry and timeout behaviour that would affect latency differently per provider |
| Snapshot file of compiled specs | A snapshot proves "unchanged", not "equal". The ticket asks for the latter. Could be added later as a change alarm. |
| `vi.stubGlobal('fetch')` | Global state across test files. Injection is cleaner and mirrors how the clock is kept out of `lib/sim`. |

### Latency semantics, precisely

`latencyMs` = `now()` before the successful `fetch` → after its body is parsed. It includes network RTT and queue
time as well as model think-time. That's unavoidable without provider-side timing (Groq offers `usage.total_time`,
but Gemini has no equivalent). Using it for one provider only would be asymmetric. Recording wall-clock for both is
the fair choice, and it's what `EventSchema.latencyMs` documents ("real wall-clock time").

### Sequencing risk

Tasks 7 and 9 each carry one assumption only a live call can confirm. If there are no keys during implementation,
ship with the assumptions recorded, and have the report say the smoke run was skipped. The contract test doesn't
depend on either assumption.

## AMENDMENTS

<!-- append-only; newest at bottom -->
