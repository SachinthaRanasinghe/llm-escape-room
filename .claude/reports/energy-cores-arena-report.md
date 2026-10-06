# Implementation Report — Energy Cores arena (3-player LLM strategy game)

**Plan**: `.claude/plans/energy-cores-arena.md`   **Branch**: `feature/energy-cores-arena` (stacked on `feature/watch-through-telemetry`, which `main` does not yet contain)   **Status**: COMPLETE

## Summary

This adds a second game, **Energy Cores**, at `/arena`. Three models from the live catalogue compete for five cores
over up to 10 rounds. They take turns in a fixed order whose starting player rotates each round. Each turn a model
claims a centre core (it must first answer a medium question), steals from a rival (a hard question), or passes.
Losing your last core eliminates you. The game is built as its own pure module, `lib/arena/`: a seeded engine that is
the only judge, a committed question bank graded by code, and a turn loop. It runs on the existing provider adapters
through a new optional `TurnRequest.tools`. The page reuses the race's catalogue, checks, lock, leak scan, local
streaming and hosted queue, and draws the match on a 2D SVG board with a turn feed and standings.

## Tasks completed

1. Generalised tool-spec derivation: `buildToolSpec(members, words)` → `lib/providers/vocabulary.ts` (UPDATE)
2. Per-request tool spec `TurnRequest.tools`: `lib/providers/{types,groq,gemini,index}.ts` (UPDATE)
3. Arena schemas → `lib/arena/schema.ts` (CREATE), plus `schema.test.ts`
4. Question bank: 60 questions, 5 per category per tier → `lib/arena/questions/{types,grade,deck,bank}.ts` (CREATE)
5. Bank, grader and deck tests, including reference recomputation and running every snippet → `lib/arena/questions/*.test.ts` (CREATE)
6. Arena tool specs plus the equivalence proof → `lib/arena/tools.ts` (CREATE), `lib/providers/equivalence.test.ts` (UPDATE)
7. Engine and observation → `lib/arena/{engine,observation}.ts` (CREATE)
8. Engine tests → `lib/arena/engine.test.ts` (CREATE)
9. Prompts → `lib/arena/prompt.ts` plus `prompt.test.ts` (CREATE)
10. Record, standings, match loop, test support, index → `lib/arena/{record,standings,match,testing,index}.ts` plus `match.test.ts` and `standings.test.ts` (CREATE)
11. Boundary sweep → `lib/arena/boundary.test.ts` (CREATE)
12. Shared race helpers (`checkPicks`, `takeLocalLock`/`releaseLocalLock`, `PickSchema`, `slug`, `write`, `providerCatalogues`) → `lib/race/index.ts` (REFACTOR, behaviour unchanged)
13. Wire types → `lib/race/arena-wire.ts` (CREATE)
14. Server side → `lib/race/arena.ts` plus `arena.test.ts` (CREATE)
15. Hosted queue for two games → `lib/race/hosted.ts` and `hosted.test.ts` (UPDATE)
16. Page and routes → `app/arena/page.tsx`, `app/api/arena/route.ts`, `app/api/arena/[id]/route.ts`, `app/api/arena/[id]/cancel/route.ts` (CREATE)
17. Secrets sweep → `lib/providers/secrets.test.ts` (UPDATE)
18. CLI → `scripts/arena.mts` (CREATE)
19. `ModelSelect` and the pick helpers extracted → `components/race/{ModelSelect.tsx,picks.ts}` (CREATE), `RaceLab.tsx` and `race.module.css` (UPDATE)
20. UI → `components/arena/{ArenaLab,ArenaBoard,TurnFeed,Standings}.tsx`, `arena.module.css` (CREATE)
21. Docs → `docs/decisions/arena.md` (CREATE), `README.md`, `architecture.md`, `app/page.tsx` (UPDATE)
22. Browser tests → `e2e/arena.spec.ts` (CREATE)

## Tests added

- `lib/arena/schema.test.ts` (6): the vocabulary, the 200-character answer cap, rejected-block pairing, and an answer existing exactly when a question was asked.
- `lib/arena/questions/grade.test.ts`: every normalisation rule and trap ("24 zeros", `NaN`, ordered and unordered lists).
- `lib/arena/questions/deck.test.ts`: a pinned seeded sequence, independent tiers, no repeats in 30 draws, and an error when a tier runs out.
- `lib/arena/questions/bank.test.ts`: integrity checks, every display answer passing its own grader, **46 reference recomputations** (math, algorithms, SQL with NULL semantics, CS), and **all 10 JS snippets executed** and compared to their keys. 7 facts are explicitly listed as reviewed by hand.
- `lib/arena/engine.test.ts` (25): opening, rotation, claim, steal, elimination, malformed and refused moves, all three end reasons, protocol misuse, a seeded property loop of 500 or more turns conserving 5 cores, and secrecy.
- `lib/arena/prompt.test.ts` (4) and `match.test.ts` (11): round cap and tie, last-standing win, phase tool sets, per-player question isolation, no key ever sent back, one call to one result, no-call turns, provider abort, stop, time cap, a watcher that throws, and validation.
- `lib/arena/standings.test.ts`, `lib/arena/boundary.test.ts`.
- `lib/providers/equivalence.test.ts`: the arena decision and answer specs with zero drift across Groq, Gemini and OpenRouter, a forced mode, and an omitted `tools` still compiling to the escape room.
- `lib/race/arena.test.ts` (14), `lib/race/hosted.test.ts` (+4), `lib/providers/secrets.test.ts` (new holders, `arena-wire` types only, arena provider imports, controls).
- `e2e/arena.spec.ts` (5): defaults, the full local stream, a refusal, a provider stopping the match, and hosted polling.

## Validation results

- `pnpm typecheck`: **pass**
- `pnpm test`: **93 files, 1362 tests, all pass**
- `pnpm build`: **pass** (`/arena`, `/api/arena`, `/api/arena/[id]`, `/api/arena/[id]/cancel` are dynamic, so they 404 unless enabled)
- `pnpm e2e e2e/arena.spec.ts`: **5/5 pass**
- `pnpm e2e` (full): **30 passed, 1 failed (present before this change; see Issues)**. The failure is in `e2e/telemetry.spec.ts` (`completes once…`): a timeout waiting for `/run/canonical` playback to reach `ended`. Re-running that spec alone failed 3 of 6, different tests from the full run, each at its `test.setTimeout`. No file under `app/run`, `components/scene`, `lib/telemetry`, `lib/replay`, `e2e/telemetry*` or `playwright.config.ts` changed, and machine load was 7–9 during the runs. See "Issues encountered" for the baseline comparison.
- `node --import tsx scripts/arena.mts --help`: exits 0.
- **Not run:** a live match against real providers (Level 4 manual step). It spends quota and needs the user's keys.

## Deviations from the plan

- **Observation tests live in `engine.test.ts`** rather than a separate `observation.test.ts`. The secrecy checks need a live engine with a pending question, so they sit with the engine tests.
- **`lib/arena` is not added to `ARTIFACT_SIDE`** in `secrets.test.ts`. That list forbids *any* provider import, and the arena needs provider types and `ProviderError`, exactly as `lib/harness` does (also not in the list). A dedicated assertion instead limits `lib/arena` to type imports, `@/lib/providers/types` and `@/lib/providers/vocabulary`. `lib/arena/boundary.test.ts` checks the same thing.
- **`thinking` messages carry the question's category and tier** on an answer call (not its text), so the board can say "solving a hard sql question…". `ThinkingObserver` gained a fourth argument.
- **The verdict of a turn's last call is delivered with the player's next turn message**, in the same tool result, rather than as a separate user message. This keeps every conversation strictly one call followed by one result, with no consecutive user messages, which Gemini handles best. `match.test.ts` asserts it.
- **`ArenaBoard` takes the board history**, not just the current counts, and folds core ownership over it purely. A ref mutated during render was rejected as fragile under React 19.
- **`m-cs-4`** asks `0x1F + 0x21` (= 64) rather than the plan's example `0xFF + 1`, which is too easy for "medium". The `bank.test.ts` reference covers it.
- **`instrument` stays private** in `lib/race/index.ts`. The arena uses its own `cancellable` guard, because `instrument` emits race-shaped `action` messages.
- **Branch:** stacked on the current feature branch, because `main` does not contain the race work this feature builds on.

## Issues encountered

- `export * from './schema'` in `lib/arena/index.ts` failed under `tsx` for the CLI, with a missing named export at runtime. I replaced it with explicit re-exports.
- BigInt literals in `bank.test.ts` broke `tsc`, because the project targets ES2017. I switched them to `BigInt()` calls.
- The bank's leak check first flagged answers a question legitimately names ("yes" in "Answer yes or no", "Bob" in the logic puzzle). It now ignores the format sentence and text-kind answers.
- **Telemetry e2e timeouts — present before this change, not caused by it.** On an untouched worktree of the pre-change
  commit (`98e9dc3`), under the same machine load, `e2e/telemetry.spec.ts` gave **5 passed, 1 failed**. The failure was
  the same test (`completes once — a restart counts nothing again`) with the same `data-state="ended"` timeout at its
  200 s budget. The test steps the replay clock frame by frame through software-rendered WebGL, so it is sensitive to
  CPU load. Nothing this feature changes is on that page's path. Worth a separate look: give the test a larger
  `setTimeout`, or larger `advance` steps.
