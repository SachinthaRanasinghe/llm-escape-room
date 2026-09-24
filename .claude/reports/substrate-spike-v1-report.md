# Implementation Report — TICKET-7 (#8), Part A: substrate spike tooling

**Plan**: `.claude/plans/substrate-spike-v1.md`   **Branch**: `feature/substrate-spike-v1` (cut from
`feature/run-harness` @ `d421ad8`; plan commit `7762ce4`)   **Status**: PARTIAL.

- **Done:** Part A code, tasks A1–A14, plus the live smoke checks.
- **Not done:** the multi-day spike run (A15) and the final decision record (A16). The record is drafted with the
  method and smoke observations; its results sections are still empty.
- **Not started:** Part B, by design, because it waits on the human checkpoint.

## Summary

Every piece of the gate spike is built, tested and smoke-run live:

- **Id visibility.** Competitors can now see object ids after the opening message, and the id of any puzzle they
  must answer with `submit_answer`. On the live canonical duel there were zero `not_found` verdicts.
- **New defaults.** The default models are Groq's free-tier `openai/gpt-oss-120b` and `openai/gpt-oss-20b`.
- **`key` puzzle kind.** v0 is widened in place, end to end: schema, solver, simulator, generator and fingerprint.
  Trying a key that doesn't fit returns a new `wrong_key` verdict, counted as a failed attempt.
- **New strategies.** `spatial` and `mixed` sit beside `symbolic`, and live generation certifies both.
- **`lib/spike`.** A pure module holds the divergence rule, the adoption decision, the quota extrapolation with the
  ordered cuts, and a report builder.
- **Scripts.** A resumable live runner (`scripts/spike-substrate.mts`) and a report CLI
  (`scripts/spike-report.mts`).

## Tasks completed

- **A1** Ids in `look`/`open` text, and a puzzle-id hint on `inspect` of an unsolved `answer` puzzle's clue object
  or target → `lib/sim/observation.ts`, `lib/sim/resolve.ts` (UPDATE)
- **A2** gpt-oss defaults and FREE pricing → `lib/harness/pricing.ts`, `scripts/run.mts`,
  `scripts/generate-room.mts`, `scripts/smoke-providers.mts` (UPDATE)
- **A3** `PUZZLE_KINDS` with `key` → `lib/schema/room.ts`, `lib/schema/version.ts` (note only) (UPDATE)
- **A4** Key lock agreement, key derivability, and the oracle learning a key by reaching it →
  `lib/solver/structure.ts`, `derivation.ts`, `oracle.ts` (UPDATE); `lib/solver/key-rooms.ts`, `key.test.ts`
  (CREATE)
- **A5** `wrong_key` verdict counted as `failed`, and `submit_answer` refused on key puzzles →
  `lib/schema/action.ts`, `lib/sim/simulator.ts`, `lib/sim/resolve.ts` (UPDATE)
- **A6** Brief `linkKinds`/`decoyKeys` and nullable `finalAnswerDomain`; generation record version 1 →
  `lib/generator/types.ts`, `record.ts`, `generate.ts`, `proposal.ts`, `fingerprint.ts` (UPDATE)
- **A7** Shared strategy rules → `lib/generator/strategies/shared.ts` (CREATE), `symbolic.ts` (REFACTOR). The
  symbolic prompt is verified byte-identical across 14 seed/feedback combinations.
- **A8** `lib/generator/strategies/spatial.ts` + test (CREATE)
- **A9** `lib/generator/strategies/mixed.ts` + test (CREATE); registry and exports → `strategies/index.ts`,
  `lib/generator/index.ts` (UPDATE)
- **A10–A12** `lib/spike/divergence.ts`, `decide.ts`, `quota.ts`, `index.ts` and a test for each;
  `boundary.test.ts`; `testing.ts` (CREATE)
- **A13** `scripts/spike-substrate.mts` (CREATE)
- **A14** `lib/spike/report.ts` + test, and `scripts/spike-report.mts` (CREATE)
- **A15** Offline validation, and the live smoke checks: both gpt-oss models, spatial and mixed generation, a
  canonical duel, a spatial duel, and one runner invocation. **The spike run itself is not done.**
- **A16** `docs/decisions/substrate.md` (CREATE, draft)

## Tests added

95 new tests: 741 now, against a baseline of 646. All pass.

- **`lib/sim`:** id labels, the puzzle-id hint (and no hint once solved), `wrong_key`, `submit_answer` refused on a
  key puzzle, and `wrong_key` counted as failed.
- **`lib/solver/key.test.ts`:**
  - An all-key chain certifies at 6 actions: take/use ×3.
  - Refusal cases: key outside its clue object, wrong `keyItemId`, code lock on a key puzzle, non-portable key.
  - A dangling key id is reported once, and a key left on the floor is one `chain_broken`.
  - A mixed chain certifies.
- **`lib/generator`:**
  - Key-link fingerprints, and a key chain telling apart from a mixed one.
  - Spatial and mixed briefs are deterministic, fit the band, and mixed briefs are genuinely mixed.
  - The spatial example shown to the model itself passes the solver.
  - End-to-end `generateRoom` for both new strategies.
  - The registry lists all three.
- **`lib/spike`:**
  - The divergence branches, including the 1.25× boundary.
  - Summaries, adoption at exactly 60%, the `MIN_ELIGIBLE` refusal, tie-breaks and the fallback.
  - Quota arithmetic, `unknown` for unpublished limits, and the cut order.
  - The report over a temp tree (finished, tripped, aborted and pending instances); markdown carries no room
    content; unreadable files are refused.
  - The boundary sweep.
- **`lib/providers/groq.test.ts`:** a 400 carrying `failed_generation` is a turn; a plain 400 still throws.
- **`lib/harness/pricing.test.ts`:** gpt-oss is priced.

## Validation results

- `pnpm typecheck`: clean.
- `pnpm test`: **51 files, 741 passed, 0 failed.**
- There is no linter configured.
- `.env` is untracked and `.env.example` is unchanged. A secret grep of `runs/`, `docs/`, `lib/` and `scripts/`
  finds only the fake keys already in the tests.

**Live (Level 4), 2026-09-23:**

| Check | Result |
|---|---|
| `gpt-oss-120b` forced tool call | ok |
| `gpt-oss-20b` forced tool call | ok |
| Gemini | **503 "high demand" all session** (4 attempts, several tries) |
| Canonical duel | 120b escaped in 11 actions; 20b ran out at 14 with 2/3 puzzles solved; 1 invalid action each, 0 `not_found`; 34 calls |
| `spatial` generation (on Groq) | certified on attempt 2 |
| `mixed` generation (on Groq) | certified on attempt 1 |
| Spatial duel | both models ran out of actions; `wrong_key` and `not_holding` observed; 50 calls |
| Spike runner, 1 instance | stopped cleanly on Gemini's 503, wrote `partial.json`, printed the resume hint |

## Deviations from the plan

1. **Groq 400s carrying `failed_generation` are now the model's turn** (`lib/providers/groq.ts`). The plan said not
   to change the adapters' *request shapes*. This changes response decoding only; the equivalence test is
   unaffected.
   - **Why:** the first live duel aborted, because gpt-oss's unparseable tool call arrives as a 400 with a code
     other than `tool_use_failed`, which the adapter treated as a dead provider.
   - **Consequence if left:** every duel where 20b fumbles would abort and be retried indefinitely, and the spike
     could not produce data. The field, not a list of codes, is the signal. Its content is never read.
2. **`wrong_key` verdict.** It was added to the plan during planning (Task A5), as a *new verdict code*, rather
   than leaving a decoy key scoring `locked`.
3. **`lib/solver/key-rooms.ts`** is new test support, not in the plan. The hand-built key room is shared by the
   solver, simulator and generator tests, alongside `fuzz.ts`. It is not exported from `index.ts`.
4. **`lib/spike/testing.ts`** is new test support. It builds real generation records through the scripted client,
   so the spike tests never hand-write a record.
5. **`lib/spike/report.ts` reads `calls.json`.** The runner writes provider calls per competitor there, because
   `Run` doesn't carry them and the quota needs them.
6. **Smoke generation ran on Groq rather than Gemini**, because Gemini was returning 503. That took a little from
   `gpt-oss-120b`'s daily quota. The spike's default generation model is still Gemini.
7. **A15 and A16 are only partly done.** The ~7-day spike isn't run, and the decision record is a draft.

## Issues encountered

- **Gemini returned 503 "high demand" for the whole session.** The spike runner, as configured, can't start until
  it recovers. If it stays unreliable, the fallback is `--gen groq:openai/gpt-oss-120b`. That costs roughly 4–8K
  tokens per room out of 120b's 200K/day, and should be recorded in the decision record if used.
- **An early signal to watch (n=1):** on a 4-link key room with a 14-action budget, neither model escaped. If
  spatial rooms routinely exhaust both models, spatial will read as "neither escaped" (not diverged). Increasing
  `--max-actions` would be a method change, so decide it before the spike, not after.
- **`runs/spike/symbolic/1/partial.json` exists** from the runner check. It marks that instance pending, and the
  next run retries it.

## Ready for the next step

- **Commit Part A**, then run the spike daily with
  `node --env-file-if-exists=.env --import tsx scripts/spike-substrate.mts`, starting once Gemini answers.
- **When it reports "nothing left":** run `node --import tsx scripts/spike-report.mts`, paste the tables into
  `docs/decisions/substrate.md`, and **review at the checkpoint** before Part B.
