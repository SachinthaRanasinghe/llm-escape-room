# Implementation Report — Headless run harness and event log writer, TICKET-6 / #7

**Plan**: `.claude/plans/run-harness.md`   **Branch**: `feature/run-harness` (cut from `fac68c1`; plan commit
`e536b2a`)   **Status**: COMPLETE. The live matchup (Level 4) has not been run: there is no `.env` on this machine.

## Summary

`lib/harness/` runs the duel. Each competitor gets its own simulator and transcript. The loop asks its adapter for
one action per turn, applies the raw action through the simulator, and writes one semantic `Event`. It then feeds
the verdict back to that competitor, and repeats until the simulator says the run has ended.

- **Duel.** Both competitors race concurrently, with a shared stop flag. The log is merged by resolution time, and
  the `Run` record gets `costUsd` added.
- **Matchup.** A matchup is a hero run plus N silent repeats (default 3), run one after another. `typicalOfRepeats`
  is true when the hero's winner is among the most common winners of the repeats.
- **Schema.** `Event` v0 was widened so a malformed turn is still one event: `action: null` plus a `rejected`
  block. `scripts/run.mts` is the opt-in live CLI.

## Tasks completed

1. `Event.action` nullable + `REJECTION_KINDS`, `RAW_EXCERPT_MAX`, `RejectedSchema` + `superRefine` →
   `lib/schema/event.ts` (UPDATE). Test-only narrowing →
   - `fixtures/index.test.ts`
   - `lib/sim/fixture-replay.test.ts`
   - `lib/providers/equivalence.test.ts`

   Also `scripts/generate-fixtures.mts` (UPDATE)
2. Malformed-turn schema tests → `lib/schema/event.test.ts` (UPDATE)
3. `HarnessDeps`, `DEFAULT_BUDGET`, `DEFAULT_REPEATS`, `DuelOptions` → `lib/harness/types.ts` (CREATE)
4. `SYSTEM_PROMPT`, `openingMessage`, `verdictText`, `noActionText` → `lib/harness/prompt.ts` (CREATE), with tests
5. `buildEvent`, `describeRejection` → `lib/harness/record.ts` (CREATE), with tests
6. `scriptedAdapter`, `turnsFromLog`, `fixedClock` → `lib/harness/testing.ts` (CREATE)
7. `runCompetitor`, `CompetitorAbortedError` → `lib/harness/competitor.ts` (CREATE), with tests
8. `PRICING`, `costOf` → `lib/harness/pricing.ts` (CREATE), with tests
9. `runDuel`, `mergeLog`, `DuelAbortedError` → `lib/harness/duel.ts` (CREATE), with tests
10. `outcomeOf`, `isTypical` → `lib/harness/typicality.ts` (CREATE), with tests
11. `runMatchup` → `lib/harness/matchup.ts` (CREATE), with tests
12. Public surface → `lib/harness/index.ts` (CREATE)
13. Boundary sweep → `lib/harness/boundary.test.ts` (CREATE)
14. Golden contract test → `lib/harness/contract.test.ts` (CREATE)
15. CLI → `scripts/run.mts` (CREATE)
16. Docs → `README.md` (UPDATE)

## Tests added

| File | Tests | Covers |
|---|---|---|
| `lib/schema/event.test.ts` | +8 | Null action + `rejected` parses. Either one without the other fails. Raw cap. Empty lifted intent refused. Unknown kind refused. Counts toward seq. Golden log untouched. |
| `lib/harness/prompt.test.ts` | 6 | Every visible id shown. No answer, lock code or clue text leaks. Byte-identical output. Verdict passed through verbatim. `prompt.ts` cannot import the room. |
| `lib/harness/record.test.ts` | 12 | Valid action has no `rejected`. All five rejection kinds. Intent lifted only when truthful. Raw cut to cap with `…`. Gemini `native` never published. Fractional latency rounded. Cyclic payload survives. |
| `lib/harness/competitor.test.ts` | 9 | Contiguous seq and a `tool_call`/`tool_result` transcript. A no-call turn is a charged `malformed` event with a reminder. A double call still answered. Action and token budgets stop without an extra call. Adapter latency charged. Stop flag. `ProviderError` wrapped with the partial log and the calls spent. Bugs rethrown. |
| `lib/harness/pricing.test.ts` | 4 | Free = 0 and priced. Unknown flagged. Per-million arithmetic. Rounding. |
| `lib/harness/duel.test.ts` | 10 | **Isolation**: A's unlocked safe is still `locked` for B. Merged, ordered, contiguous log. Valid `Run`. Cost and `unpriced`. Abort stops the survivor and keeps both partial logs. Bugs not disguised as aborts. Four pre-call validation refusals. Determinism. |
| `lib/harness/typicality.test.ts` | 10 | Winner, fewer actions, tie, none, golden run. Typical, atypical, tied mode, tie/none as outcomes, no repeats → null. |
| `lib/harness/matchup.test.ts` | 9 | Hero + `-r1…` ids. Typical / atypical. A dropped repeat is judged on the rest. Hero failure runs no repeat. 0 repeats → null. All dropped → null. Bad `repeats` refused before any call. |
| `lib/harness/contract.test.ts` | 5 | **The golden log replayed through the real harness reproduces the committed summaries exactly**. The event semantics match per competitor. The key set matches. The log parses and has no seq breaks. |
| `lib/harness/boundary.test.ts` | 22 | Per file: no env, fetch, URL, `Math.random` or clock reads. Providers imported by type only (plus `ProviderError` from `types`). The room imported by type only. Guard-the-guard. Positive control. |

## Validation results

- **`pnpm typecheck`:** clean.
- **`pnpm test`:** **646 passed / 43 files**. The baseline at `fac68c1` was 551 / 34, so this adds 95.
- **CLI offline checks** (no network, nothing written):
  - bad `--a` → exit 2;
  - `--repeats -1` → exit 2;
  - an unknown flag → exit 2;
  - an uncertified room → `not certified: chain_broken`, exit 2;
  - a missing room file → exit 2;
  - no keys → `GROQ_API_KEY is not set`, exit 1.
- **`git diff fac68c1 -- lib/sim lib/providers lib/solver lib/generator fixtures`:** test files only. Also changed:
  one optional-chaining line in `scripts/generate-fixtures.mts`. No fixture JSON touched.
- **Not run:** Level 4 (live matchup), because there is no `.env` on this machine.

## Deviations from the plan

1. **`scripts/generate-fixtures.mts` got a one-line change** (`e.action.name` → `e.action?.name`). The plan expected
   type fallout only in tests, but the widened `Event` type also reaches this script. There is no behaviour change,
   and the fixtures were not regenerated.
2. **`record.ts` / `index.ts` / `types.ts` comments avoid naming the clock APIs.** The boundary sweep is textual and
   flagged them. The comments were reworded, and the sweep was kept strict.
3. **`matchup.test.ts` uses a per-duel scripted adapter.** It starts a new script whenever the transcript is only
   the opening message. After a provider failure, how many turns the surviving competitor completes before it sees
   the stop flag is a microtask race. The first version of the test depended on it and failed, and the per-duel
   script makes the test independent of that race. The harness behaviour did not change.
4. **Test counts:** 95 new tests against the plan's estimate of about 80, because the boundary sweep emits two tests
   per file.
5. **The CLI is `scripts/run.mts`, not `scripts/run.ts`**, matching the other scripts, as the plan's Task 15 noted.

## Issues encountered

- **⚠️ The simulator does not tell models object or puzzle ids after the opening message. This needs a decision
  before the live runs mean much.**
  - `openingMessage` lists the top-level objects with ids. After that, the simulator's prose names things by display
    name only. An `open` says "Inside is sea chart", never `sea-chart`, and `look` returns names only.
  - `Observation` never exposes puzzle ids, and `submit_answer` needs one (`p3`).
  - A live model therefore has to guess ids for contained objects and for the final puzzle. That will inflate
    `invalidActions` for reasons unrelated to reasoning.
  - The golden log and the contract test are unaffected, because the scripted actions already know the ids.
  - Per the plan (`lib/sim` is not to be changed; raise gaps in the facade), this was **left unfixed**. The likely
    fix is in `lib/sim`: include ids in `open`/`look` verdict prose, and expose answerable puzzle ids. That changes
    what models see, so it's a decision for the user (or TICKET-7, #8), and it should land before any spike numbers
    are trusted.
- **⚠️ `.env.example` in the working tree contains values for `GROQ_API_KEY` and `GEMINI_API_KEY`.** The file is
  tracked (`!.env.example` in `.gitignore`), and this change was not made by the implementation. It was **left
  unstaged**, and it must not be committed. Move the keys to `.env` (ignored) and restore `.env.example` with
  `git checkout -- .env.example`. If the values are real keys that were ever pushed, rotate them.
- **Unverified until Level 4:**
  - A-G1: whether Gemini accepts consecutive `user` contents after a turn with no tool call.
  - Whether real models escape the canonical room inside 14 actions.

  To close these, run the following. Then record, for T7: escapes, invalid-action counts, provider calls, and
  whether Gemini accepted the transcript.

  ```bash
  node --env-file-if-exists=.env --import tsx scripts/run.mts --repeats 0
  node --env-file-if-exists=.env --import tsx scripts/run.mts --repeats 2
  node --env-file-if-exists=.env --import tsx scripts/run.mts --a gemini:gemini-flash-latest --b groq:llama-3.3-70b-versatile --repeats 0
  ```
