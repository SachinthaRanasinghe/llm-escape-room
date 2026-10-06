# Feature: Energy Cores Arena — a 3-player LLM strategy game at `/arena`

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

**AGENTS.md rule:** this is Next.js **16.3.2** with breaking changes. Before writing any route handler or page, read
`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and mirror the existing
`app/api/race/**` files exactly (async `context.params`, `connection()` in server pages). Do not use patterns from memory.

## Feature Description

A second game alongside the escape room. Three LLMs compete for **5 Energy Cores** in a shared arena. At the start,
each player automatically grabs one core (3 held, 2 left in the centre). Then, over up to **10 rounds**, each player
on its turn chooses one action: **claim** a core from the centre, **steal** a core from another player, or **pass**.
A claim or steal only succeeds if the player first answers a question correctly. Questions come from a committed
bank covering math, code-output, algorithms, logic, SQL and CS theory. A claim draws a **medium** question and a
steal draws a **hard** one. A player left with no cores is eliminated. The game ends when one player is left
standing or after round 10. The winner is the player with the most cores, and an equal count is a recorded tie.

Each player has to do the full chain: understand the rules, decide, solve the question, take the action, and
react to what the others did. Viewers watch it live on a 2D arena board, with each model's intent, the question,
its answer and whether it was right.

## User Story

As someone who follows model releases
I want to pick three models and watch them fight over five Energy Cores, where every grab or steal must be earned by solving a hard question
So that I can see which model combines knowledge, reasoning and strategy best, not just which one answers questions best.

## Problem Statement

The escape room tests chained reasoning in isolation: each model plays alone in its own simulator. It cannot show
strategic interaction: choosing a target, reacting to being robbed, or deciding when a risky steal is worth it.
The codebase has no notion of shared state, more than two players, or turn order.

## Solution Statement

A new, self-contained game module `lib/arena/` holds a pure, seeded, deterministic engine (the only judge), a
committed question bank with code-graded exact answers, and a sequential match loop. That loop drives three
`ProviderAdapter`s through the **existing** provider layer. The only change to that layer is to let a
`TurnRequest` carry its own tool spec, which keeps the same forced-tool fairness settings and adds an equivalence
proof for the arena tools. A new `/arena` page and `/api/arena` routes reuse the race's catalogue, checks, local
streaming, and hosted background-function and polling path, including its quota limits. The board is 2D (SVG and
CSS).

## Out of Scope / Non-Goals

- Not included: a 3D arena (follow-up ticket; the 2D board is v1 by decision).
- Not included: publishing a match to a frozen `/run/<id>`-style artifact, silent repeats / typicality, telemetry,
  replay of a saved match.
- Not included: LLM-generated questions (bank only, by decision). No question generator, no LLM grading.
- Not included: defence actions, penalties beyond a wasted turn, power-ups, more or fewer than 3 players.
- Not changing: escape-room behaviour. `ActionSchema`, `lib/sim`, `lib/harness`, the golden fixtures, `/race`,
  `/replay` and `/run/<id>` must behave byte-for-byte as before. The provider change is additive (an optional field
  that defaults to today's spec), and the escape-room equivalence assertions must pass unmodified.
- Not changing: `PUBLIC_LIMITS` values. Arena matches share the race's lock and counters.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: new `lib/arena/`, `lib/providers/{types,vocabulary,groq,gemini}.ts` (additive), `lib/race/{index,hosted}.ts` (small refactors), new `app/arena`, `app/api/arena/**`, new `components/arena/`, `components/race/RaceLab.tsx` (extract `ModelSelect`), `netlify/functions/race-background.mts` (no code change expected), `lib/providers/secrets.test.ts`
**Dependencies**: none new. Zod 4.6.5, React 19, Next 16.3.2, vitest 4, Playwright 1.63 are already installed.

## Related Work

**Implements**: free-form request (no ticket). Consider opening a GitHub issue "Energy Cores arena (3-player)" and
linking it here.   ·   **Epic**: inherits `architecture.md` (deterministic simulator is the sole judge; one
vocabulary compiled per provider with an equivalence proof; malformed output costs a turn; keys only in
`lib/providers/env.ts`; free-tier quota), `docs/decisions/local-race.md` and `docs/decisions/public-race.md`.

**Back-references**:

- `.claude/plans/provider-adapters.md` — the equivalence proof this plan extends to a second tool spec.
- `.claude/plans/run-harness.md` — the competitor loop `lib/arena/match.ts` mirrors.
- `.claude/plans/room-simulator.md` — "malformed is a verdict, not an exception"; verdict tally semantics.
- `.claude/plans/watch-through-telemetry.md` / `lib/race` history — the local stream and hosted poll the arena reuses.

**Forward-references**:

- (none yet). Likely follow-ups: 3D arena scene; published arena artifacts plus replay; more questions; LLM-generated questions with a verifier.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md`: Next 16 warning; read the docs under `node_modules/next/dist/docs/`.
- `architecture.md` (Boundaries & contracts): the rules every new module must keep.
- `lib/schema/action.ts` (all): Zod discriminated union with `strictObject`, the `IntentSchema` 1–280 chars, the verdict code vocabulary. **Mirror the style** for `lib/arena/schema.ts`.
- `lib/schema/event.ts` (lines 47–107): the `rejected` block for malformed turns, `RAW_EXCERPT_MAX`, `superRefine` pairing. The arena event mirrors it.
- `lib/providers/types.ts` (lines 22–27, 85–99, 149–157): `TurnRequest`, `ProviderAdapter`, `ProviderTurn`, `ProviderError`. `TurnRequest` gains an optional `tools`.
- `lib/providers/vocabulary.ts` (all): `PortableSpec`, `deriveTool`, `buildPortableSpec`, `toRawAction`. This is where you generalise to `buildToolSpec(schema, words)`.
- `lib/providers/groq.ts` (lines 134–178): `compileGroqRequest` hard-codes `compileGroqTools(buildPortableSpec())` at line 171. Change it to `request.tools ?? buildPortableSpec()`.
- `lib/providers/gemini.ts` (lines 164–218): `compileGeminiRequest` hard-codes the same at line 214.
- `lib/providers/openrouter.ts` (line 37): `compileOpenRouterRequest = compileGroqRequest`. It inherits the change for free.
- `lib/providers/equivalence.test.ts` (all): the fairness proof. Add an arena section and **do not loosen** existing assertions.
- `lib/providers/turn.ts`: `turnFromCalls`, `rejectedTurn`. The anomalies arrive here; the arena engine scores them `malformed`.
- `lib/harness/competitor.ts` (lines 105–170): the act → apply → log → transcript loop, the `ProviderError` → `CompetitorAbortedError` wrapping, and `onEvent` wrapped in try/catch. `lib/arena/match.ts` mirrors it.
- `lib/harness/record.ts`: how a `ProviderTurn` plus a verdict becomes an event with `rejected` (raw excerpt, lifted intent). Mirror it for `lib/arena/record.ts`.
- `lib/harness/prompt.ts` (all): one constant system prompt, and per-turn text as a pure function of the observation. Mirror it for `lib/arena/prompt.ts`.
- `lib/harness/boundary.test.ts` (all): the source sweep (no env, fetch, `Math.random`, `Date.now`). Copy it for `lib/arena/boundary.test.ts`.
- `lib/harness/pricing.ts`: `costOf(competitor, tokens, prices)` and the `PriceTable` type. Reuse it for arena cost.
- `lib/rng.ts` (all): `createRng(seed)` with `shuffle`/`pick`. It is the only randomness allowed.
- `lib/race/index.ts` (lines 59–200, 249–330): `RaceError`, `raceEnabled`, `publicRace`, `providerCatalogues` (module-private, needs exporting), the in-memory `running` lock, the pick checks inside `checkRace`, `instrument()` (cancel → `ProviderError`), and `pricesFor`.
- `lib/race/index.ts` (lines 327–490): `runRace` with the emit protocol, leak scan of each beat via `findLeaks`, `persist` flag, and error handling. `runArena` mirrors it.
- `lib/race/hosted.ts` (all): job/log/lock in Blobs, `startHostedRace`, `runHostedRace`, `pollHostedRace`, `cancelHostedRace`. Generalise it to two games.
- `lib/race/wire.ts` (all): the types-only browser contract. Create `lib/race/arena-wire.ts` the same way.
- `lib/race/hosted.test.ts` and `lib/race/race.test.ts`: the test style for request parsing and the in-memory `Kv` fake.
- `app/api/race/route.ts`, `app/api/race/[id]/route.ts`, `app/api/race/[id]/cancel/route.ts`, `app/race/page.tsx`: mirror these for the arena.
- `netlify/functions/race-background.mts`: stays the single background runner. It dispatches on the job's game.
- `components/race/RaceLab.tsx` (lines 135–330 stream/poll handler; 534–584 `ModelSelect`; 84–120 pick encoding and `defaultPicks`): the client flow to mirror.
- `components/race/race.module.css`: tokens and glass surfaces (`--ink-*`, `--line`, `--text`, lane colours).
- `app/page.tsx` (nav lines 41–45, CTAs): add the Arena link.
- `lib/providers/secrets.test.ts` (lines 66–117, 245–257): `ARTIFACT_SIDE`, `RACE_IMPORT`, `RACE_HOLDERS`, the wire types-only check. These must cover the new files.
- `lib/artifact/scan.ts` (line 43): `findLeaks(text)`, used to scrub intents and answers before they go on the wire.
- `e2e/race.spec.ts` (all): how the page is tested with `/api/models` and `/api/race` answered by the test, with no keys.
- `scripts/run.mts`: CLI shape (`--a provider:model`) to mirror in `scripts/arena.mts`.

### New Files to Create

- `lib/arena/schema.ts`: Zod schemas: `ArenaActionSchema` (`claim` | `steal` | `pass`), `ArenaAnswerSchema` (`answer`), `ArenaVerdictCode`, `ArenaEventSchema`, `ArenaResultSchema`, `parseArenaEvent(s)`.
- `lib/arena/questions/types.ts`: `Question`, `QuestionCategory`, `QuestionTier`, `AnswerKey`.
- `lib/arena/questions/bank.ts`: the committed bank, at least 30 medium and 30 hard (5 per category per tier).
- `lib/arena/questions/grade.ts`: `gradeAnswer(key, given)` → `{ correct, normalised }`.
- `lib/arena/questions/deck.ts`: `createDeck(seed)` → seeded per-tier shuffled decks, `draw(tier)`, never repeats.
- `lib/arena/engine.ts`: the state machine (sole judge).
- `lib/arena/observation.ts`: per-player public view (secrecy boundary: never an answer key).
- `lib/arena/prompt.ts`: system prompt, turn message, question message, verdict text.
- `lib/arena/tools.ts`: `DECISION_TOOLS` and `ANSWER_TOOLS` `PortableSpec`s built with `buildToolSpec`.
- `lib/arena/record.ts`: `buildArenaEvent(...)`.
- `lib/arena/match.ts`: `runMatch(options)` and `MatchAbortedError`.
- `lib/arena/standings.ts`: standings, winner and tie from final state plus events (shared by server and UI).
- `lib/arena/index.ts`: public surface.
- `lib/arena/testing.ts`: scripted fake adapter (`scriptedAdapter([...turns])`) and fixed clock.
- Tests: `lib/arena/{schema,grade,deck,bank,engine,observation,prompt,match,standings,boundary}.test.ts`.
- `lib/race/arena.ts`: server side: `parseArenaRequest`, `checkArena`, `prepareArena`, `runArena`.
- `lib/race/arena-wire.ts`: types only: `ArenaRequest`, `ArenaMessage`, `ArenaPlayerView`, `ArenaTurnView`, `ArenaStandings`.
- `lib/race/arena.test.ts`.
- `app/arena/page.tsx`, `app/api/arena/route.ts`, `app/api/arena/[id]/route.ts`, `app/api/arena/[id]/cancel/route.ts`.
- `components/race/ModelSelect.tsx` (extracted, shared) and `components/race/picks.ts` (`encodePick`, `decodePick`, `usd`).
- `components/arena/ArenaLab.tsx`, `components/arena/ArenaBoard.tsx`, `components/arena/TurnFeed.tsx`, `components/arena/Standings.tsx`, `components/arena/arena.module.css`.
- `e2e/arena.spec.ts`.
- `scripts/arena.mts`: CLI live match (`--a --b --c provider:model`, `--seed`, `--rounds`).
- `docs/decisions/arena.md`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`: route handler signature in this Next version (async `params`).
- `node_modules/next/dist/docs/01-app/03-api-reference/` (search `connection`): `connection()` to opt a server page out of static build, as `app/race/page.tsx` does.
- [Zod 4 discriminated unions](https://zod.dev/api#discriminated-unions) and [`z.toJSONSchema`](https://zod.dev/json-schema): `vocabulary.ts` derives tool params through `z.toJSONSchema(member)`, and the arena tool spec goes through the same path.
- [OpenAI-style `tool_choice: "required"`](https://console.groq.com/docs/tool-use) and [Gemini function calling `mode: ANY`](https://ai.google.dev/gemini-api/docs/function-calling#function_calling_modes): unchanged fairness settings, now applied to two tool sets.
- [MDN: SVG `<circle>` / CSS transitions](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_transitions) and `prefers-reduced-motion`: board animation.

### Patterns to Follow

**Naming:** kebab-free camelCase TS modules under `lib/<area>/`; `create*` factories (`createSimulator`, `createRng`); `parse*` functions wrapping `safeParse` and throwing a `SchemaError` subclass; `*Error` classes with `this.name = new.target.name`; constants in `SCREAMING_SNAKE`; ids like `player-a`. CSS Modules (`*.module.css`), `data-testid` on interactive elements.

**Comments:** every module opens with a block comment explaining *why* (decision, boundary, fairness), section dividers like `/* ── Section ─── */` and `// ── Heading ──` inside doc comments. Match that density. Comments explain invariants, never restate code.

**Model mistakes are data:** from `lib/sim/simulator.ts`:
```ts
const parsed = ActionSchema.safeParse(raw);
if (!parsed.success) {
  const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'action'}: ${issue.message}`);
  verdict = { ok: false, code: 'malformed', message: `That is not a valid action. ${detail.join('; ')}` };
}
```
The arena engine does the same for both the decision and the answer. Never throw on model output.

**Provider failure aborts, with partial log:** from `lib/harness/competitor.ts`:
```ts
} catch (error) {
  if (error instanceof ProviderError) {
    throw new CompetitorAbortedError(competitor.id, events, providerCalls + error.attempts, error);
  }
  throw error;
}
```

**Watchers cannot break a run:**
```ts
try { options.onEvent?.(event, result.ended); } catch { /* A watcher's failure is the watcher's. */ }
```

**Value import from providers only from `types.ts`:** `import { ProviderError } from '@/lib/providers/types';` (`lib/harness/boundary.test.ts` pins this for the harness; pin the same for the arena).

**Leak scan before the wire:** `if (findLeaks(JSON.stringify(view)).length > 0) { /* withhold intent/answer text */ }` (`lib/race/index.ts` ~line 378).

---

## GAME RULES (normative — the engine implements exactly this)

- **Players:** exactly 3, ids `player-a`, `player-b`, `player-c`, in the order picked. Models see only `Player A/B/C`, never model names (assumption, see Open Questions). Viewers see model ids.
- **Setup (no model call):** each player holds 1 core and the centre holds 2. Recorded as an `opening` entry in `started`, not as an event.
- **Rounds:** 1..`maxRounds` (default **10**). In round `r` (1-based) the order is `[A,B,C]` rotated left by `(r-1) % 3`: round 1 is A,B,C; round 2 is B,C,A; round 3 is C,A,B. Eliminated players are skipped.
- **A turn** has up to two model calls:
  1. **Decide** (tools: `claim`, `steal`, `pass`; each requires `intent`, and `steal` requires `targetId` ∈ `{player-a, player-b, player-c}`).
     - Malformed (no call, two calls, bad args) → verdict `malformed`; the turn ends (wasted). Counted as invalid.
     - `claim` with centre = 0, `steal` targeting self, an eliminated player, or a player with 0 cores, or an unknown id → verdict `not_permitted`; the turn ends (wasted). Counted as invalid.
     - `pass` → verdict `ok`; the turn ends. This is legal play and is not counted.
     - Valid `claim`/`steal` → the engine draws a question (`claim` → medium, `steal` → hard) and the turn proceeds to step 2.
  2. **Answer** (tool: `answer` with `answer` string 1–200 and `intent`).
     - Malformed → `malformed`; the action fails. Counted as invalid.
     - Graded wrong → `wrong_answer`; the action fails (no extra penalty). Counted as failed.
     - Graded right → `ok`; apply it: `claim` moves centre→player; `steal` moves target→player. If the target now holds 0, the target is **eliminated** (permanently, even if the centre still has cores).
- **End:** immediately when exactly one player still holds cores (`last_standing`), or after round `maxRounds` completes (`round_cap`), or when the wall clock passes `maxWallClockMs` (default 12 min, under the 15-min background-function limit) at a turn boundary (`time_cap`).
- **Winner:** most cores. If several players tie on the top count, the outcome is `tie` and `winners` lists them all. Tie-break stats (accuracy, think-time) are shown but never decide.
- **Conservation invariant:** centre + Σ holdings = 5 at every step. Tested.
- **Questions:** drawn from per-tier decks shuffled by `createRng(\`${seed}:medium\`)` / `:hard`. No question repeats in a match. Worst case is 3 × 10 = 30 draws, so each tier needs ≥ 30 questions. If a deck is exhausted (impossible with ≥ 30 per tier, but guard it), throw `ArenaError` (a bug, not a model's fault).
- **What a model sees:** its own transcript only. At the start of its turn, a user message lists the current standings (cores per player, centre, eliminated, round) and **what happened since its last turn**: for each other player's turn, its action and target, the question category and tier, and whether it succeeded. It never sees other players' questions or answers. The question text is shown only to the player answering it. The expected answer is never sent to any model; viewers see it after grading.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — provider seam, schemas, question bank

Make the provider layer able to send a different tool set, still provably the same for every provider. Define the
arena's contracts and its question bank.

### Phase 2: Core — engine and match loop

**Depends on:** Phase 1.

The pure engine, the observation and prompts, and `runMatch` over injected adapters. No network, no env, no clock
reads except `deps.now`.

### Phase 3: Integration — server, routes, hosted path

**Depends on:** Phase 2.

`lib/race/arena.ts` plus the wire types, routes, page gate, the hosted job generalisation, and the CLI script.

### Phase 4: UI

**Depends on:** Phase 3 wire types only (`lib/race/arena-wire.ts`).
**Independent of:** Phase 3's server implementation. It can be built in parallel against the wire types and the e2e mocks.

### Phase 5: Testing, docs, validation

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task 1 — UPDATE `lib/providers/vocabulary.ts`: generalise spec derivation

- **IMPLEMENT**: widen `PortableTool.name` from `ActionName` to `string`. Extract the body of `deriveTool` into an exported, generic
  `buildToolSpec(members: readonly z.ZodObject[], words: Readonly<Record<string, { tool: string; params: Record<string, string> }>>): PortableSpec`
  that keeps every existing check (string-only params, missing description throws, description for a missing param throws, frozen output).
  Re-implement `buildPortableSpec()` as `buildToolSpec(ActionSchema.options, TOOL_DESCRIPTIONS)` plus the existing `ACTION_NAMES` order check and memo.
  Keep `TOOL_DESCRIPTIONS`'s exhaustive mapped type over `ActionName` exactly as is.
- **PATTERN**: `lib/providers/vocabulary.ts:107-165`.
- **IMPORTS**: `z` from `zod` (already).
- **GOTCHA**: `normaliseGroqTools` and `normaliseGeminiTools` cast `name as PortableTool['name']`. With `string` that cast becomes a no-op, so leave it or drop it. The escape-room spec must be **byte-identical** to before. Check by running the existing equivalence test unchanged.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/providers`
- **SATISFIES**: AC #9 (escape room unchanged), AC #3 (fairness)

### Task 2 — UPDATE `lib/providers/types.ts`, `groq.ts`, `gemini.ts`: per-request tool spec

- **IMPLEMENT**: add `readonly tools?: PortableSpec;` to `TurnRequest` with a doc comment: "Default `buildPortableSpec()` — the escape room. Another game passes its own spec built with `buildToolSpec`, and `equivalence.test.ts` proves it too." In `compileGroqRequest` use `compileGroqTools(request.tools ?? buildPortableSpec())`; in `compileGeminiRequest` use `compileGeminiTools(request.tools ?? buildPortableSpec())`. Fairness settings (`tool_choice: 'required'`, `parallel_tool_calls: false`, `mode: 'ANY'`) stay untouched.
- **PATTERN**: `lib/providers/groq.ts:171`, `lib/providers/gemini.ts:214`.
- **IMPORTS**: `import type { PortableSpec } from './vocabulary';` in `types.ts`. This is a type-only import, so no cycle at runtime.
- **GOTCHA**: `toRawAction` already handles any tool name; the arena engine parses with its own schema. Do NOT change `turn.ts`.
- **VALIDATE**: `pnpm typecheck && pnpm vitest run lib/providers`
- **SATISFIES**: AC #3, AC #9

### Task 3 — CREATE `lib/arena/schema.ts`

- **IMPLEMENT**:
  - `PLAYER_IDS = ['player-a','player-b','player-c'] as const`, `PlayerIdSchema`.
  - `ArenaActionSchema` = `z.discriminatedUnion('name', [strictObject({name:'claim', intent}), strictObject({name:'steal', targetId: z.string().min(1), intent}), strictObject({name:'pass', intent})])`. Reuse a local `IntentSchema` identical to `lib/schema/action.ts` (1–280). Copy it rather than export it from `action.ts`, to keep `action.ts` untouched.
  - `ArenaAnswerSchema` = `z.discriminatedUnion('name', [strictObject({ name: 'answer', answer: z.string().min(1).max(200), intent })])`. Use a union of one so `buildToolSpec` takes `.options`.
  - `ARENA_VERDICT_CODES = ['ok','not_permitted','malformed','wrong_answer']`.
  - `QUESTION_CATEGORIES = ['math','code','algorithms','logic','sql','cs'] as const`, `QUESTION_TIERS = ['medium','hard'] as const`.
  - `ArenaEventSchema` (strict, one per **turn**): `matchId`, `seq` (0-based contiguous, global), `round`, `playerId`, `decision: { action: ArenaAction|null, rejected?: Rejected, verdict }`, `question: { id, category, tier } | null`, `answer: { given: ArenaAnswer|null, rejected?: Rejected, verdict, expected: string } | null`, `outcome: 'claimed'|'stole'|'failed'|'passed'|'wasted'`, `targetId: PlayerId|null`, `eliminated: PlayerId|null`, `cores: Record<PlayerId, number>`, `centre: number`, `latencyMs` (sum of both calls), `tokens {prompt, completion}`, `at` (ISO). Reuse `RejectedSchema` from `@/lib/schema/event` (artifact side, pure; allowed).
  - `ARENA_END_REASONS = ['last_standing','round_cap','time_cap']`; `ArenaResultSchema`: `{ matchId, seed, players: Competitor[] (length 3), maxRounds, roundsPlayed, endedBecause, outcome: 'win'|'tie', winners: PlayerId[], standings: [{ playerId, cores, eliminatedInRound: number|null, claims, steals, passes, correct, wrong, invalid, tokens, latencyMs, costUsd }] }`.
  - `class ArenaSchemaError extends SchemaError`, `parseArenaEvent`, `parseArenaResult`.
- **PATTERN**: `lib/schema/action.ts`, `lib/schema/event.ts`, `lib/schema/run.ts`.
- **IMPORTS**: `z`, `SchemaError` from `@/lib/schema/version`, `RejectedSchema` from `@/lib/schema/event`, `CompetitorSchema` from `@/lib/schema/run`.
- **GOTCHA**: `question` on the event must not carry the prompt text or the answer key. `answer.expected` is the human-readable canonical answer, recorded **after** grading. Only the view and the wire layer add prompt text for display.
- **VALIDATE**: `pnpm vitest run lib/arena/schema.test.ts` (write it: valid and invalid samples, superRefine pairing `action===null ⇔ rejected`).
- **SATISFIES**: AC #1, AC #2

### Task 4 — CREATE `lib/arena/questions/{types,grade,deck,bank}.ts`

- **IMPLEMENT**:
  - `AnswerKey = { kind: 'number'; value: number; tolerance?: number } | { kind: 'text'; accept: readonly string[] } | { kind: 'list'; items: readonly string[]; ordered: boolean }`.
  - `Question = { id: string; category; tier; prompt: string; key: AnswerKey; display: string }` (`display` is the canonical answer shown to viewers).
  - `gradeAnswer(key, given)`: normalise by trimming, removing wrapping backticks and quotes, removing a trailing `.`, collapsing whitespace, lowercasing. For `number`: strip `,` and `_`, accept a leading `=`, and use `Number()`; non-finite is wrong; compare `|a-b| <= (tolerance ?? 0)`. For `text`: the normalised string must equal any normalised `accept`. For `list`: split on `,`, normalise items, then compare ordered or as a sorted multiset. Return `{ correct: boolean; normalised: string }`. Pure.
  - `createDeck(seed)`: `{ draw(tier): Question; remaining(tier): number }` using `createRng(\`${seed}:${tier}\`).shuffle(BANK.filter(tier))`.
  - `BANK: readonly Question[]` with **≥ 5 per category per tier** (≥ 60 total). Every prompt must end with an explicit answer-format instruction, e.g. "Answer with a single integer." or "Answer with the exact output." Answers are short, exact and unambiguous. Examples of the bar:
    - medium/math: "How many trailing zeros does 100! have? Answer with a single integer." → 24
    - hard/sql: given a 5-row table inline and a `GROUP BY … HAVING` query → the exact count.
    - hard/code: a 10-line JS or Python snippet → its exact printed output.
    - medium/algorithms: "Minimum number of comparisons in the worst case to find both min and max of 8 numbers?" → 10
    - hard/logic: knights-and-knaves with a unique answer → "B".
    - cs: e.g. "How many edges does a complete graph K7 have?" → 21.
- **PATTERN**: data style of `lib/solver/lexicon.ts` (committed constant data with a test that proves its properties).
- **GOTCHA**: a wrong key silently makes a correct model lose, and that is the worst fairness bug this feature can have. Task 5's bank test must verify every computable answer independently.
- **VALIDATE**: `pnpm vitest run lib/arena/questions`
- **SATISFIES**: AC #4, AC #5

### Task 5 — CREATE `lib/arena/questions/{grade,deck,bank}.test.ts`

- **IMPLEMENT**:
  - grade: table tests for every normalisation rule, and for traps (`"24."`, `` `24` ``, `"24 zeros"` → wrong, `"1,000"` → 1000, empty → wrong, `NaN` → wrong, list ordering).
  - deck: same seed → same sequence (hard-code the first 3 ids for a seed, like `lib/rng.test.ts`); different tiers are independent; no repeats across 30 draws; `draw` past exhaustion throws.
  - bank: unique ids; unique prompts; every category × tier has ≥ 5; every tier has ≥ 30; `gradeAnswer(q.key, q.display).correct === true` for every q; every prompt contains `Answer with`; no prompt contains its `display` verbatim when `display.length > 2` (cheap leak check); every `display` ≤ 200 chars. **Reference checks:** for each `code` question, add a `reference` test that runs the JS snippet (only JS snippets, using `new Function` in the test file only; no `eval` in `lib/`) and compares captured `console.log` output to `display`. For math/algorithm questions, compute the answer with a small TS function in the test where practical (factorial zeros, combinatorics, graph edge counts).
- **VALIDATE**: `pnpm vitest run lib/arena/questions`
- **SATISFIES**: AC #4, AC #5

### Task 6 — CREATE `lib/arena/tools.ts` + extend `lib/providers/equivalence.test.ts`

- **IMPLEMENT**: `DECISION_WORDS` and `ANSWER_WORDS` (tool and param descriptions, kept in this one place), then `export const DECISION_TOOLS = buildToolSpec(ArenaActionSchema.options, DECISION_WORDS)` and `ANSWER_TOOLS = buildToolSpec(ArenaAnswerSchema.options, ANSWER_WORDS)`. Wording:
  - claim: "Take one Energy Core from the centre. You must first answer a medium-difficulty question correctly."
  - steal: "Take one Energy Core from another player. You must first answer a hard question correctly." targetId: "The id of the player to steal from, e.g. player-b."
  - pass: "Do nothing this turn."
  - answer: "Submit your final answer to the question." answer: "Only the final answer, in the format the question asks for."
  - intent: reuse the exact sentence of `INTENT_DESCRIPTION` (copy it; viewers see it).
  In `equivalence.test.ts`, add `describe('the arena tool specs describe the same task')`: for both `DECISION_TOOLS` and `ANSWER_TOOLS`, check source↔Groq, source↔Gemini and Groq↔Gemini with zero drift; `compileGroqRequest({..., tools: DECISION_TOOLS})` sends exactly those tools with `tool_choice: 'required'`; Gemini sends `mode: 'ANY'`; OpenRouter's body equals Groq's; a request **without** `tools` still compiles the escape-room spec (regression).
- **PATTERN**: `lib/providers/equivalence.test.ts` existing describes.
- **IMPORTS**: `buildToolSpec` from `@/lib/providers/vocabulary`. **GOTCHA**: the `lib/arena/` boundary allows only `@/lib/providers/types` and `@/lib/providers/vocabulary`. `vocabulary.ts` imports only `zod` and `lib/schema/action`, with no transport, so it is safe. Pin it in the boundary test (Task 11).
- **VALIDATE**: `pnpm vitest run lib/providers/equivalence.test.ts`
- **SATISFIES**: AC #3

### Task 7 — CREATE `lib/arena/engine.ts` + `observation.ts`

- **IMPLEMENT**: `createArena({ seed, maxRounds })` returns:
  - `observe(playerId): ArenaObservation` with `{ you, round, maxRounds, centre, players: [{ id, cores, eliminated }], pending: { action, question: { id, category, tier, prompt } } | null }`. It never contains a `key` or `display`.
  - `current(): { round, playerId } | null` (whose turn; `null` when ended).
  - `decide(playerId, raw: unknown): DecideResult` with `{ action|null, verdict, question: Question|null }` (`question` non-null only when valid claim/steal). Throws `ArenaError` if it is not this player's turn or if a decision is already pending (a programmer error).
  - `answer(playerId, raw: unknown): AnswerResult` with `{ given|null, verdict, correct, outcome, eliminated, expected }`. Throws if nothing is pending.
  - `endTurn()` (called internally after a terminal step) advances the rotation and skips eliminated players. After the last turn of round `maxRounds`, it sets `ended = 'round_cap'`. After any elimination that leaves one player with cores, it sets `ended = 'last_standing'`.
  - `stopForTime()` sets `ended = 'time_cap'`.
  - `hasEnded()`, `endedBecause()`, `state()` (cores, centre, eliminated, round) for recording, and `tally()` per player (claims/steals/passes/correct/wrong/invalid).
  Pure state transitions, with the counters as closures (mirror `createSimulator`). Verdict messages are what the model reads, e.g. `"Correct. You took a core from player-b. player-b is eliminated."`, `"Wrong answer. The steal failed."`, `"Not permitted: the centre is empty."`, and the malformed message built from Zod issues as in `lib/sim/simulator.ts`. **Never include the expected answer in a verdict message.**
- **PATTERN**: `lib/sim/simulator.ts` (closure state, `ArenaError` on misuse, malformed as verdict), `lib/sim/observation.ts` (secrecy projection).
- **GOTCHA**: steal success must re-check that the target still has ≥ 1 core. That always holds in sequential play, but assert it. Keep the conservation invariant (5 total). Rotation must be computed from the **round's base order**, not from who is alive, so skipping is deterministic.
- **VALIDATE**: `pnpm vitest run lib/arena/engine.test.ts lib/arena/observation.test.ts`
- **SATISFIES**: AC #1, AC #2, AC #6

### Task 8 — CREATE `lib/arena/engine.test.ts`, `observation.test.ts`

- **IMPLEMENT**: opening state (1/1/1, centre 2); rotation order for rounds 1–4; claim success/fail/empty-centre; steal success/fail/self/eliminated/unknown target/zero-core target; elimination on last core; `last_standing` ends immediately mid-round; `round_cap` after round 10; tie detection; malformed decide (null, array, extra key, missing intent) wastes the turn and counts as invalid; malformed answer counts as invalid; `pass` counts as neither; conservation invariant checked after every step of a randomised (seeded) 500-turn property loop with random legal and illegal inputs; misuse throws `ArenaError`; observation never contains any `display` or key from `BANK` (stringify and scan, like `lib/sim/secrecy.test.ts`).
- **VALIDATE**: `pnpm vitest run lib/arena`
- **SATISFIES**: AC #1, AC #2, AC #6

### Task 9 — CREATE `lib/arena/prompt.ts` + `prompt.test.ts`

- **IMPLEMENT**:
  - `ARENA_SYSTEM_PROMPT` (constant, the same for all three): the rules in short plain lines: 5 cores, you are one of Player A/B/C, the actions, claim = medium question and steal = hard question, a wrong answer wastes the turn, losing your last core eliminates you, up to N rounds, most cores wins and a tie is possible, "Act only by calling exactly one tool on each turn", the intent line copied from `lib/harness/prompt.ts`, and "Your id is given in each turn message".
  - `turnMessage(obs, sinceLast: readonly PublicTurn[])`: "Round r of N. You are player-x." plus standings lines plus "Since your last turn:" lines (`player-b tried to steal from player-a (hard sql): succeeded.`) plus "Choose your action."
  - `questionMessage(question)`: `"Question (${tier} ${category}): ${prompt}\nCall answer with only the final answer."`
  - `verdictText(verdict, obs)`.
  - `PublicTurn` = `{ playerId, action: 'claim'|'steal'|'pass'|'invalid', targetId, category|null, tier|null, succeeded: boolean }`, derived from an `ArenaEvent`.
  Pure functions of the observation and events. They never import the bank.
- **PATTERN**: `lib/harness/prompt.ts`.
- **VALIDATE**: `pnpm vitest run lib/arena/prompt.test.ts` (snapshot-free assertions: the system prompt is identical for all players; `turnMessage` never contains a `display`; the since-last list excludes the player's own previous turn).
- **SATISFIES**: AC #3, AC #6

### Task 10 — CREATE `lib/arena/record.ts`, `standings.ts`, `match.ts`, `testing.ts`, `index.ts` (+ tests)

- **IMPLEMENT**:
  - `record.ts`: `buildArenaEvent(ctx, decideTurn, decideResult, answerTurn|null, answerResult|null, state)`. It builds `rejected` blocks from `ProviderTurn.anomaly` and Zod failure exactly as `lib/harness/record.ts` does (raw excerpt cut to `RAW_EXCERPT_MAX`, intent lifted only if valid). Sum latency and tokens of both calls.
  - `standings.ts`: `buildArenaResult({ matchId, seed, players, maxRounds, events, engine, prices })` adds `costUsd` via `costOf` from `@/lib/harness`; and `winnersOf(cores)` gives `{ outcome, winners }`. Also export `partialStandings(events, players)` for an aborted match (no winner).
  - `match.ts`: `runMatch({ matchId, seed, players: readonly Competitor[3], adapters, maxRounds = 10, maxWallClockMs = 720_000, deps: HarnessDeps, prices?, onEvent?: (event, view) => void, onThinking?: (playerId, phase: 'decide'|'answer') => void, shouldStop?: () => boolean }) → Promise<{ result: ArenaResult; events: ArenaEvent[]; providerCalls: Record<string, number> }>`.
    Loop: validate (exactly 3 unique players, an adapter per player, and adapter provider/model matches the competitor, as `runDuel.validate` does). Keep a per-player `transcript: TranscriptEntry[]` seeded empty. While the arena has not ended: if `shouldStop()`, throw `MatchAbortedError('stopped')`; if `deps.now() - start > maxWallClockMs`, call `stopForTime()` and break. Push `{ kind: 'user', text: turnMessage(...) }`. `act({ system, transcript, tools: DECISION_TOOLS })` then `engine.decide(turn.rawAction)`. Push the tool_call and tool_result, or assistant_text plus a user reminder when there was no call (mirror `competitor.ts:146-164`). If a question was drawn: push the tool_result text `verdict.message + '\n' + questionMessage(q)`, then `act({ ..., tools: ANSWER_TOOLS })` then `engine.answer(...)` and push its tool_result. Build the event, push it, call `onEvent` in try/catch. A `ProviderError` throws `MatchAbortedError(matchId, events, calls, cause)` carrying `playerId`.
  - `testing.ts`: `scriptedAdapter(provider, modelId, turns: ProviderTurn[] | ((request) => ProviderTurn))` and `FIXED_DEPS`.
  - `index.ts`: export the engine, schema, tools, `runMatch`, `MatchAbortedError`, `buildArenaResult`, `winnersOf`, `partialStandings`, `QUESTION_COUNT`, and a `questionText(id)` lookup (used server-side to put the prompt into the view).
- **PATTERN**: `lib/harness/competitor.ts`, `lib/harness/duel.ts` (validate, `DuelAbortedError`), `lib/harness/record.ts`, `lib/harness/testing.ts`.
- **IMPORTS**: `import type { ProviderAdapter, TranscriptEntry, ProviderTurn } from '@/lib/providers';` and `import { ProviderError } from '@/lib/providers/types';`. Get `costOf, type PriceTable, type HarnessDeps` from `@/lib/harness`.
- **GOTCHA**: Gemini needs the tool_call `native` round-tripped. Push `turn.toolCall` as is (it carries `native`). Every request must carry `tools` explicitly. Never rely on the default, or the model gets escape-room tools. Assert this in `match.test.ts` by inspecting the requests the scripted adapter received.
- **VALIDATE**: `pnpm vitest run lib/arena` with `match.test.ts` covering: a full scripted 10-round game reaching `round_cap`; `last_standing` ending early; a provider error mid-turn yields `MatchAbortedError` with the partial events; `shouldStop`; time cap with an injected clock; `onEvent` throwing does not break the match; each player's transcript contains only its own questions; the requests used `DECISION_TOOLS` then `ANSWER_TOOLS`.
- **SATISFIES**: AC #1, AC #2, AC #6, AC #7

### Task 11 — CREATE `lib/arena/boundary.test.ts`

- **IMPLEMENT**: copy `lib/harness/boundary.test.ts` (no `process.env`, `fetch`, URLs, `Math.random`, `Date.now`, `performance.now`). Add: provider imports are allowed only as `import type … from '@/lib/providers'`, the value import `@/lib/providers/types`, or `@/lib/providers/vocabulary`. Nothing in `lib/arena` imports `@/lib/race`, `@/lib/sim`, `@/lib/schema/room` or `fixtures`.
- **VALIDATE**: `pnpm vitest run lib/arena/boundary.test.ts`
- **SATISFIES**: AC #8

### Task 12 — REFACTOR `lib/race/index.ts`: share catalogue checks and the local lock

- **IMPLEMENT** (behaviour-preserving):
  - Export `providerCatalogues` (or a thin `liveCatalogue()` wrapper).
  - Extract the pick loop in `checkRace` into `export async function checkPicks(picks: readonly ModelPick[], hosted: boolean): Promise<ModelPickPriced[]>` and use it in `checkRace`.
  - Replace the `let running` flag with `export function takeLocalLock(): boolean` and `export function releaseLocalLock(): void`, used by `prepareRace` and `runRace`'s `finally`, so a race and an arena match can never run at once.
- **GOTCHA**: error messages and statuses must be unchanged. `race.test.ts` and `e2e/race.spec.ts` must still pass.
- **VALIDATE**: `pnpm vitest run lib/race && pnpm typecheck`
- **SATISFIES**: AC #9, AC #10

### Task 13 — CREATE `lib/race/arena-wire.ts` (types only)

- **IMPLEMENT**:
  ```ts
  export interface ArenaRequest { readonly players: readonly [ModelPick, ModelPick, ModelPick]; readonly rounds: number; }
  export interface ArenaPlayerView { readonly id: PlayerId; readonly provider: Provider; readonly modelId: string; }
  export interface ArenaTurnView {
    readonly seq: number; readonly round: number; readonly playerId: string;
    readonly action: 'claim' | 'steal' | 'pass' | 'invalid'; readonly targetId: string | null;
    readonly intent: string | null;           // decision intent, verbatim (or null if withheld/absent)
    readonly decisionMessage: string;          // verdict message
    readonly question: { readonly category: string; readonly tier: 'medium' | 'hard'; readonly prompt: string } | null;
    readonly answerGiven: string | null; readonly answerIntent: string | null;
    readonly correct: boolean | null; readonly expected: string | null;
    readonly outcome: 'claimed' | 'stole' | 'failed' | 'passed' | 'wasted';
    readonly eliminated: string | null;
    readonly cores: Readonly<Record<string, number>>; readonly centre: number;
    readonly latencyMs: number;
  }
  export type ArenaMessage =
    | { type: 'started'; matchId: string; players: readonly ArenaPlayerView[]; maxRounds: number; cores: Record<string, number>; centre: number }
    | { type: 'thinking'; playerId: string; phase: 'decide' | 'answer'; round: number }
    | { type: 'turn'; turn: ArenaTurnView }
    | { type: 'done'; matchId: string; result: ArenaStandingsView; savedTo: string | null; providerCalls: number; unpriced: readonly string[] }
    | { type: 'error'; message: string; savedTo: string | null; standings: ArenaStandingsView | null };
  ```
  `ArenaStandingsView` mirrors `ArenaResult` minus `seed`, with labels. Type imports only, from `@/lib/schema/run` and `./wire`. Do not import `lib/arena` here: `PlayerId` can be a type import from `@/lib/arena/schema`, or just use `string`.
- **VALIDATE**: `pnpm typecheck`
- **SATISFIES**: AC #8

### Task 14 — CREATE `lib/race/arena.ts` (+ `arena.test.ts`)

- **IMPLEMENT**:
  - `ARENA_DEFAULT_ROUNDS = 10`, `ARENA_MAX_ROUNDS = 10`, `ARENA_MIN_ROUNDS = 3`.
  - `parseArenaRequest(raw)`: Zod `strictObject({ players: z.tuple([Pick, Pick, Pick]), rounds: int min 3 max 10 })`, reusing the pick regex from `index.ts` (export `PickSchema` from there) and throwing `RaceError(400, …)`. Three identical picks are allowed (same model three times is a legitimate mirror match).
  - `checkArena(request)`: `raceEnabled()` (404), then `checkPicks(request.players, publicRace())`, then return `{ request, prices: pricesFor(priced) }`.
  - `prepareArena(request)`: `checkArena`, then `takeLocalLock()` (409 "a race is already running").
  - `runArena(prepared, emit, signal, { persist = true })`: build the competitors `player-a/b/c` and the adapters, wrapping each in the same `instrument`-style cancel guard (export `instrument` from `index.ts`, or copy a minimal version that throws `ProviderError(provider, null, 0, 'race cancelled')` when aborted). `matchId = slug('arena-' + iso)`, `seed = matchId`. Emit `started`. Call `runMatch` with `onThinking` → `thinking` and `onEvent` → `turn` (build `ArenaTurnView`, adding `question.prompt` via `questionText(id)`, then **leak-scan** it with `findLeaks`; on a hit, null out `intent`, `answerIntent` and `answerGiven` and replace `decisionMessage` with the withheld text, as `runRace` does). On success, if `persist`, write `runs/<matchId>/arena.json` (result) and `events.json`, then emit `done`. On `MatchAbortedError`, write `events.partial.json` if `persist` and emit `error` with `partialStandings`. Other errors emit `error` as `runRace` does. Always `releaseLocalLock()` in `finally`.
  - Tests: request parsing (a valid tuple, 2 players, 4 players, a bad modelId regex, rounds out of range, extra keys), and `runArena` with `vi.mock`-free injection. To make that possible, accept an optional `deps` parameter `{ createAdapter?, now? }`, defaulting to the real ones, so the test passes scripted adapters and asserts the message sequence `started → thinking/turn… → done`, a leak in an intent being withheld, a cancel yielding `error`, and the lock being released.
- **PATTERN**: `lib/race/index.ts:327-490`.
- **GOTCHA**: this file holds the key path. Update `secrets.test.ts` in Task 17. Never put question keys in messages; `expected` appears only after grading.
- **VALIDATE**: `pnpm vitest run lib/race`
- **SATISFIES**: AC #1, AC #7, AC #10

### Task 15 — UPDATE `lib/race/hosted.ts` (+ tests): two games, one lock and quota

- **IMPLEMENT**: `Job` gains `readonly game?: 'race' | 'arena'` (absent means `'race'`, for jobs queued before deploy) and `request: RaceRequest | ArenaRequest`. `Log.messages: readonly (RaceMessage | ArenaMessage)[]`. `startHostedRace(request, opts)` gains `opts.game` (default `'race'`) and an injectable `check` that dispatches to `checkRace` or `checkArena`. `realRace` dispatches on `job.game`: arena → `checkArena` then `runArena(..., { persist: false })`. `runHostedRace`'s error fallback emits the right `error` shape per game (`{ type: 'error', message, savedTo: null, standings: null }` for the arena). `pollHostedRace` is unchanged except for the message type (make it generic or widen it). Daily, per-visitor and lock limits are shared. Do not change `PUBLIC_LIMITS`.
- **TESTS** (`hosted.test.ts`): an arena job is queued with `game: 'arena'`; `runHostedRace` with an injected `race` gets the arena request; a legacy job without `game` runs as a race; an arena and a race cannot both hold the lock.
- **GOTCHA**: the race's error message shape has `comparison`; the arena's has `standings`. Keep the union discriminated by the game the job holds, and do not emit a race-shaped error to an arena page.
- **VALIDATE**: `pnpm vitest run lib/race/hosted.test.ts`
- **SATISFIES**: AC #10

### Task 16 — CREATE `app/arena/page.tsx`, `app/api/arena/route.ts`, `app/api/arena/[id]/route.ts`, `app/api/arena/[id]/cancel/route.ts`

- **IMPLEMENT**: mirror the race files one to one. The page uses `connection()`, then `notFound()` if `!raceEnabled()`, then renders `<ArenaLab />`, with metadata title `'Energy Cores arena · LLM Escape Room'`. POST: 404 if disabled; on the public site go through `startHostedRace(parseArenaRequest(body), { game: 'arena', check: checkArena, ... })` → 202 `{ raceId }`; locally use `prepareArena`, then an NDJSON stream of `runArena`, with abort on disconnect. GET and cancel call the same `pollHostedRace` and `cancelHostedRace`. Reuse `/api/models` for the catalogue (no new models route).
- **PATTERN**: `app/api/race/route.ts`, `app/api/race/[id]/route.ts`, `app/api/race/[id]/cancel/route.ts`, `app/race/page.tsx`.
- **GOTCHA**: read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` first; `params` is a Promise.
- **VALIDATE**: `pnpm typecheck && pnpm build`
- **SATISFIES**: AC #1, AC #10

### Task 17 — UPDATE `lib/providers/secrets.test.ts`

- **IMPLEMENT**: change `RACE_IMPORT` to `/from\s+['"](@\/lib\/race|(\.\.\/)+race)(\/index|\/hosted|\/arena)?['"]/`. Extend `RACE_HOLDERS` to `^app\/(race\/page\.tsx|arena\/page\.tsx|api\/)`. Add `lib/arena` to `ARTIFACT_SIDE` (it must not import provider *transport*). If the existing provider-import check forbids `@/lib/providers/types` and `@/lib/providers/vocabulary` for ARTIFACT_SIDE, instead add a dedicated assertion that `lib/arena` imports from providers only those two paths and `import type`. Add a types-only check for `lib/race/arena-wire.ts` identical to the `wire.ts` one. Add positive controls: `RACE_IMPORT.test("import { runArena } from '@/lib/race/arena';") === true`, and `RACE_HOLDERS.test('components/arena/ArenaLab.tsx') === false`.
- **VALIDATE**: `pnpm vitest run lib/providers/secrets.test.ts`
- **SATISFIES**: AC #8

### Task 18 — CREATE `scripts/arena.mts`

- **IMPLEMENT**: `node --env-file-if-exists=.env --import tsx scripts/arena.mts --a groq:openai/gpt-oss-120b --b gemini:gemini-flash-latest --c openrouter:<model> [--rounds 10] [--seed s]`. It reads keys via `readProviderKey`, builds adapters with `createAdapter`, runs `runMatch` and prints each turn (round, player, action, category/tier, correct) and the final standings, then writes `runs/<matchId>/arena.json` and `events.json`.
- **PATTERN**: `scripts/run.mts`.
- **VALIDATE**: `node --import tsx scripts/arena.mts --help` exits 0 (implement `--help`).
- **SATISFIES**: Level 4 manual validation

### Task 19 — REFACTOR `components/race/RaceLab.tsx`: extract `ModelSelect` + picks

- **IMPLEMENT**: move `ModelSelect`, `encodePick`, `decodePick`, `usd` and `priceLabel` into `components/race/ModelSelect.tsx` and `components/race/picks.ts`. Widen `lane` to `'a' | 'b' | 'c'`. Add a `[data-lane='c']` colour in `race.module.css` (`--lane-c: #b794f4`). `RaceLab` imports them back, with rendering identical (same `data-testid`s).
- **VALIDATE**: `pnpm typecheck && pnpm e2e e2e/race.spec.ts`
- **SATISFIES**: AC #9

### Task 20 — CREATE `components/arena/*` (2D arena UI)

- **IMPLEMENT**:
  - `ArenaLab.tsx` (`'use client'`): mirror `RaceLab`'s stage machine (`loading → setup → running → done | stopped | error`) and its single `handle(message)` used by **both** the NDJSON stream and the hosted poll (copy the transport block from `RaceLab.tsx:228-290`, pointed at `/api/arena`). Setup has three `ModelSelect`s (lanes a, b, c; defaults from `defaultPicks` extended to 3, falling back to repeating models), a rounds number input (3–10, default 10), a quota note ("Up to 60 model calls: 3 players × 10 rounds × 2 calls; a free OpenRouter key allows 50 a day"), a paid note if a paid pick is chosen (local only), and Start/Cancel. Running and done show the `ArenaBoard`, the `TurnFeed` and an elapsed timer; done adds `Standings` and "Play again".
  - `ArenaBoard.tsx`: an SVG with a 600×520 viewBox. Three bases at triangle corners (A top-left, B top-right, C bottom), coloured with lane colours and labelled with model id and core count, plus a centre ring showing centre cores. Five `<circle>` cores are positioned by owner, and a CSS `transition: transform 600ms` animates a core between positions when ownership changes (each core has a stable index; reassign core indices deterministically from the previous assignment so only the moved core animates). An eliminated base is greyed with an "ELIMINATED" label. The active player's base pulses with a "thinking…" or "solving a hard SQL question…" label from `thinking` messages. Respect `prefers-reduced-motion` (no transition). `role="img"` plus an `aria-label` summarising the state.
  - `TurnFeed.tsx`: newest first. Each item shows round and player chip, action ("steals from Player B"), the intent quoted verbatim in quotes (never trimmed, per the product rule), a collapsible `<details>` with the question category, tier and prompt (`white-space: pre-wrap` for code and SQL), the model's answer, a ✓/✗ badge and "expected: …", plus think time. Use `data-testid="arena-turn"`.
  - `Standings.tsx`: a table by rank with model, cores, eliminated-in-round, correct/wrong/invalid, accuracy %, avg think time, tokens and cost. A headline reads "Winner: <model>" or "Tie: <models>", with the end reason in plain text ("All rounds played", "Last one standing", "Stopped at the time limit"). For an aborted match it shows the partial standings and "No winner — <reason>".
  - `arena.module.css`: reuse the tokens from `race.module.css` (`--ink-*`, `--line`, `--text`, lanes a/b/c). The layout is responsive: board and feed side by side ≥ 960px, stacked below.
- **PATTERN**: `components/race/RaceLab.tsx`, `components/race/race.module.css`, `components/comparison/Comparison.tsx` (results table style).
- **IMPORTS**: browser components may import only types from `@/lib/race/arena-wire`, `@/lib/race/wire`, and pure `@/lib/arena/standings` helpers if needed (pure, no providers). Never import `@/lib/race`, `@/lib/race/arena` or `@/lib/race/hosted`.
- **GOTCHA**: `secrets.test.ts` will fail the build if a component imports the race module.
- **VALIDATE**: `pnpm typecheck && pnpm build`
- **SATISFIES**: AC #1, AC #11

### Task 21 — UPDATE `app/page.tsx` and `README.md`; CREATE `docs/decisions/arena.md`

- **IMPLEMENT**: add `<Link href="/arena">Arena</Link>` to the nav and a third CTA "Three-model arena". README gets a short "**Energy Cores arena.**" paragraph in the style of the race paragraph (rules in two sentences, `/arena`, `scripts/arena.mts`, quota note, same local/hosted gating). The decision doc gives context, options weighed (bank vs generated questions; sequential vs simultaneous; 2D vs 3D; anonymous player ids), the decision, the rules table, the limits, and what is not offered. Add one bullet to `architecture.md` Boundaries: "**Arena.** A second game in `lib/arena/` with its own engine as sole judge, the same provider adapters with its own tool spec proven equivalent; see `docs/decisions/arena.md`."
- **VALIDATE**: `pnpm build`
- **SATISFIES**: AC #12

### Task 22 — CREATE `e2e/arena.spec.ts`

- **IMPLEMENT**: mirror `e2e/race.spec.ts`. Fulfil `/api/models` with a catalogue fixture (3 models). Fulfil `POST /api/arena` with an NDJSON body built from a scripted sequence (`started`, a few `thinking`/`turn` covering a claim success, a steal failure, an elimination, then `done`). Assert three selects render; Start shows the board; core counts update (`data-testid="base-player-b-cores"`); the feed has N `arena-turn` items with verbatim intent text; the standings show the winner; a `<details>` reveals the question prompt. A second test returns `409` JSON and expects the error text. A third serves the hosted `202 { raceId }` plus polls to `/api/arena/<id>?from=n` and checks the same end state.
- **VALIDATE**: `pnpm e2e e2e/arena.spec.ts`
- **SATISFIES**: AC #1, AC #11

---

## TESTING STRATEGY

### Unit Tests (vitest, `*.test.ts`, colocated)

- `lib/arena/schema.test.ts`: schema accept/reject, rejected pairing.
- `lib/arena/questions/*.test.ts`: grading rules, deck determinism (hard-coded first ids), bank integrity, and reference recomputation of code and math answers.
- `lib/arena/engine.test.ts`: every rule in "GAME RULES" plus a conservation property loop.
- `lib/arena/observation.test.ts` and `prompt.test.ts`: secrecy (no answer key ever reaches a model-facing string).
- `lib/arena/match.test.ts`: scripted adapters, end reasons, abort, stop, time cap, tool-spec per call, per-player transcript isolation.
- `lib/arena/boundary.test.ts`: the source sweep.
- `lib/providers/equivalence.test.ts`: arena specs plus the regression that the default is still the escape-room spec.
- `lib/race/arena.test.ts`, `hosted.test.ts`, `race.test.ts`: request parsing, message sequence, leak withholding, shared lock, legacy job.
- `lib/providers/secrets.test.ts`: new import boundaries and positive controls.

### Integration Tests

- `e2e/arena.spec.ts` (Playwright, mocked API, no keys) for local stream, hosted poll and refusal.
- `e2e/race.spec.ts` must still pass after the `ModelSelect` extraction.

### Edge Cases

- Model calls no tool on decide or answer (counts as wasted or failed, and as invalid).
- Model calls `answer` during the decide phase. It is not in the offered tools; if a provider lets it through, `ArenaActionSchema` refuses it → malformed.
- Model calls `steal` with `targetId: "B"` or `"Player B"`. Strict ids mean `not_permitted`. The verdict message lists the valid ids so the model can learn.
- Steal on a target with exactly 1 core → elimination; and if that leaves one survivor, the game ends mid-round.
- Centre empty and all claims impossible → only steal or pass are useful; the game still ends at the cap.
- All three pass every turn → round_cap with a 1/1/1 (+2 centre) tie of three.
- Answers like `"24."`, `` `24` ``, `"The answer is 24"` (→ wrong, by design; the prompt says "only the final answer").
- Gemini `native` thoughtSignature must round-trip across the two-call turn.
- A provider 429 mid-match → abort with partial standings, no winner.
- Cancel during the answer call.
- An intent containing a URL is withheld on the wire.
- Hosted: an arena job and a race job compete for the single lock; a legacy job with no `game`.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm typecheck
```
(No linter is configured in `package.json`; typecheck is the static gate.)

### Level 2: Unit Tests

```bash
pnpm vitest run lib/arena
pnpm vitest run lib/providers
pnpm vitest run lib/race
pnpm test
```

### Level 3: Integration Tests

```bash
pnpm exec playwright install chromium   # first time only
pnpm e2e e2e/arena.spec.ts
pnpm e2e                                 # full suite, incl. race/replay/run/telemetry regressions
pnpm build
```

### Level 4: Manual Validation

1. `pnpm dev`, open `http://localhost:3000/arena`. Pick three free models, 3 rounds, and Start. Watch cores move, read the intents, expand a question, and confirm the standings at the end. Check that `runs/arena-*/arena.json` and `events.json` were written.
2. While it runs, open `/race` in another tab and Start. Expect 409 "a race is already running".
3. Press Cancel mid-match. Expect an error with partial standings and no winner.
4. CLI: `node --env-file-if-exists=.env --import tsx scripts/arena.mts --a groq:openai/gpt-oss-120b --b groq:openai/gpt-oss-20b --c gemini:gemini-flash-latest --rounds 3`.
5. `/race`, `/replay` and `/run/canonical` still behave exactly as before.
6. `pnpm build && pnpm start`, then `/arena` returns 404 (no `ENABLE_LOCAL_RACE`).

### Level 5: Additional Validation (Optional)

- Netlify deploy preview with `PUBLIC_RACE=1`: run one arena match end to end through the background function; confirm `/api/arena/<id>` polling and that a concurrent `/race` start is refused with 409.
- Use the `agent-browser` skill to screenshot the board at 375px and 1280px widths.

---

## ACCEPTANCE CRITERIA

- [ ] AC #1 — `/arena` lets a user pick 3 models from the live catalogue and a round count, start a match, watch it turn by turn on a 2D board, and see final standings with a winner or tie.
- [ ] AC #2 — The engine implements every rule in "GAME RULES" (opening grab, rotation, claim/steal/pass, medium/hard tiers, elimination, last-standing / round-cap / time-cap, most-cores winner, ties), proven by unit tests including the 5-core conservation invariant.
- [ ] AC #3 — All three players receive the identical system prompt and tool specs. `equivalence.test.ts` proves zero drift for the arena decision and answer specs across Groq, Gemini and OpenRouter, with forced tool calls.
- [ ] AC #4 — Questions come only from the committed bank (≥ 5 per category per tier, ≥ 30 per tier, categories math, code, algorithms, logic, SQL, CS), drawn by a seeded deck, never repeated within a match.
- [ ] AC #5 — Grading is deterministic code. Every bank answer self-grades, and computable answers are independently recomputed in tests.
- [ ] AC #6 — No model-facing text (prompts, observations, verdicts) ever contains an answer key, proven by a secrecy test. A model sees only its own questions.
- [ ] AC #7 — Malformed output and illegal actions cost the turn and are counted as invalid; a provider failure aborts with partial standings and no winner; a watcher error cannot break a match.
- [ ] AC #8 — Import boundaries hold: `lib/arena` reads no env and makes no network call; components never import the race module; `arena-wire.ts` is types only (`secrets.test.ts`, `boundary.test.ts`).
- [ ] AC #9 — The escape room is unchanged: the existing equivalence and contract tests, the golden fixtures, and `e2e/race|replay|run|telemetry.spec.ts` all pass without edits to their assertions.
- [ ] AC #10 — Gating and quota match `/race`: 404 in production unless `ENABLE_LOCAL_RACE=1` or `PUBLIC_RACE=1`; on the public site free models only and the shared lock and daily/visitor limits; one race-or-arena at a time locally.
- [ ] AC #11 — `e2e/arena.spec.ts` passes for the local stream, hosted polling and refusal paths.
- [ ] AC #12 — README, `docs/decisions/arena.md` and an `architecture.md` boundary bullet describe the feature.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm e2e` and `pnpm build` all pass.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No type errors
- [ ] Manual testing confirms feature works (at least one live 3-round match)
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

Answered by the user (2026-10-06): sequential A→B→C with the starter rotating; 10-round cap, most cores wins;
committed question bank; claim = medium, steal = hard, wrong = wasted turn, no extra penalty; 2D first;
`/arena` page reusing the existing model infrastructure; escape room untouched.

- Assumed — **two model calls per action** (decide, then answer the drawn question), which is the user's
  "decide → solve → act" flow. Max ≈ 60 calls per match. Confirm before execution if one-call is preferred.
- Assumed — **tie at the cap is a recorded tie** (`outcome: 'tie'`, several winners). No stat-based tie-breaker.
- Assumed — **models see anonymous ids (Player A/B/C), not model names**, so a model cannot target an opponent by reputation. Viewers see names.
- Assumed — **a model sees other players' action, target, question category and tier, and success**, but not their question text or answers.
- Assumed — **eliminated is permanent**. An eliminated player cannot re-claim from the centre.
- Assumed — **a failed steal or claim has no effect on the target**; there is no defence move.
- Assumed — **arena matches share the race's single lock and the public daily and visitor counters** (one match counts as one race), even though a match can spend ~2× a race's calls. Revisit `PUBLIC_LIMITS` if quota bites.
- Assumed — **local matches persist to `runs/<matchId>/`** like races; nothing is publishable.
- Assumed — **3 identical picks are allowed** (mirror match).
- Assumed — **wall-clock cap 12 minutes**, ending the match as `time_cap` with standings decided by cores.
- Risk — **question authoring quality**. Writing 60+ hard, unambiguous, exactly-gradable questions is the bulk of
  the content work, and a wrong key is the worst fairness bug available. Mitigated by reference recomputation in
  `bank.test.ts`; SQL, logic and CS answers still rely on careful authoring and review.

## NOTES (open canvas)

**Why not reuse `runDuel` / `createSimulator`.** Both are built on "one simulator per competitor, never shared"
(`lib/sim/simulator.ts`), which is the opposite of a shared arena. Bending them would put the escape room's
most important invariant at risk. A sibling module with its own engine keeps both games honest.

**Why a per-request `tools` field rather than a second adapter.** The adapters are where fairness lives
(the forced tool choice, the shared decoder `turn.ts`, Gemini's `native` round-trip). A second adapter family would
mean a second equivalence proof over different code. An optional `tools` on the request reuses all of it. The
escape room keeps working because the default is unchanged, and the equivalence test pins both specs.

**Why decide and answer are separate tool sets per call.** If `answer` were offered during the decision call, a model
could "answer" before seeing a question. Offering exactly one phase's tools per call makes the phase structural. It
also keeps `tool_choice: required` meaningful: the answer call must produce an answer.

**Why the event is per turn, not per call.** A viewer reasons in turns ("B tried to steal from A and missed"). The
two calls' latency and tokens are summed, with `rejected` blocks kept per phase so nothing is hidden.

**Sequencing.** Tasks 1–2 (provider seam) are the riskiest for regressions, so run the full `lib/providers` suite
right after. Tasks 3–11 need no network and no UI. Task 19 (`ModelSelect` extraction) can be done at any point
but must be followed by `e2e/race.spec.ts`. Phase 4 can run in parallel with Phase 3 once `arena-wire.ts` exists.

**Quota sketch.** Worst case per match is 3 players × 10 rounds × 2 calls = 60 calls, plus retries. Passing and
invalid decisions cost 1 call, so typical matches are lower. Groq and Gemini free tiers are comfortable; three
OpenRouter free picks on one 50/day key are not. The UI says so.

**Future 3D.** `ArenaTurnView` already carries everything a 3D scene needs (cores and centre after each turn, the
mover, the target). A later `ArenaStage` can consume the same messages.

## AMENDMENTS

- (none yet)
