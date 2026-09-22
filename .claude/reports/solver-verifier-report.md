# Implementation Report — Solver / verifier (pure)

**Plan**: `.claude/plans/solver-verifier.md`
**Branch**: `feature/solver-verifier` (stacked on `feature/room-simulator`)
**Issue**: [#3](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/3)
**Status**: COMPLETE

## Summary

Built the gate that stands in front of the generator: a five-stage pipeline in `lib/solver/` that takes an
untrusted `RoomSpec` and either certifies it or refuses it with a machine-readable code. It proves solvability
by *playing the room through TICKET-2's own `resolve()`* under a knowledge gate — a puzzle is usable only after
an action has been spent inspecting a clue that genuinely yields its answer — so a certified room is one the
engine can really run, not one a second model of the room believes in. Every committed invalid fixture is now
rejected by its own reason, three of them to exactly one code.

## Tasks completed

- Rejection vocabulary → `lib/solver/rejections.ts` (CREATE)
- Closed answer domains → `lib/solver/lexicon.ts` (CREATE)
- Clue → answer extraction, derivability and uniqueness → `lib/solver/derivation.ts` (CREATE)
- Referential, ordering, exit, lock and collision checks → `lib/solver/structure.ts` (CREATE)
- Knowledge-gated BFS over `lib/sim` → `lib/solver/oracle.ts` (CREATE)
- Band thresholds and estimate plausibility → `lib/solver/difficulty.ts` (CREATE)
- The pipeline and both entry points → `lib/solver/verify.ts` (CREATE)
- Narrow public seam → `lib/solver/index.ts` (CREATE)
- Seeded room builder + 8 mutators → `lib/solver/fuzz.ts` (CREATE)
- Status and contracts prose → `README.md` (UPDATE)

**No file outside `lib/solver/` was touched except `README.md`.** `git diff --stat feature/room-simulator --
lib/schema fixtures lib/sim` prints nothing, so the wave-2 contract that #4 and #8 are building against is
byte-identical.

## Tests added

| File | Cases | Covers |
|---|---|---|
| `lexicon.test.ts` | 18 | tokenising, whole-token matching, domain exclusivity, calibration against the canonical clue |
| `derivation.test.ts` | 20 | candidates per kind, the three corpus rooms, **derivable-but-ambiguous** asymmetry, null clues |
| `structure.test.ts` | 21 | every referential/ordering/exit/lock rule, answer collision under the simulator's comparison |
| `oracle.test.ts` | 17 | canonical optimum, **the knowledge gate plus its positive control**, key locks, sealed clues, determinism |
| `difficulty.test.ts` | 18 | every band boundary both sides, estimate floor and ceiling, band failure suppressing the estimate |
| `verify.test.ts` | 13 | parse entry, graph abort, multi-rejection collection, report shape, both doors agreeing |
| `corpus.test.ts` | 14 | **the contract test** — all six committed rooms, three asserted to exactly one code |
| `fuzz.test.ts` | 16 | 200 seeded rooms certify; 8 mutators × 50 seeds each caught by their own code; determinism, non-mutation, never-throws |
| `purity.test.ts` | 14 | directory-read source sweep for network/env/clock/unseeded randomness, import allowlist, fetch-throws run, positive control |

**151 new tests across 9 files, all passing. Suite total 371/371 across 22 files.**
1,120 lines of test against 1,499 lines of source (43%).

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 — Syntax & types | `pnpm typecheck` | PASS (no lint step, by design) |
| 2 — Ticket units | `pnpm test lib/solver` | PASS — 151/151 across 9 files |
| 3 — Integration | `pnpm test lib/solver/corpus.test.ts` | PASS — 14/14 |
| 3 — Full suite | `pnpm test` | PASS — 371/371, **zero regressions** in ticket 1 and 2's 220 |
| 4 — Build | `pnpm build` | PASS — 2 static routes |
| 4 — Manual | fixture verdict script | PASS — output matches the plan exactly |
| 5 — Contract | `git diff --stat feature/room-simulator -- lib/schema fixtures lib/sim` | PASS — empty |

Manual output:

```
canonical: {"min":6,"intended":6,"band":"standard"}
unsolvable               answer_not_derivable,unsolvable
ambiguous-answer         answer_ambiguous
broken-chain             chain_broken
out-of-band-difficulty   difficulty_out_of_band
version-mismatch         spec_version_mismatch
```

## Deviations from the plan

All deliberate, and two of them were forced by tests the plan told me to treat as tripwires.

1. **The estimate-plausibility check measures the INTENDED path, not the shortest one.** The plan specified
   `minActions <= estimatedActions <= 3 * minActions`. That contradicted the plan's own contract assertion, and
   `corpus.test.ts` caught it: `broken-chain` has a 4-action shortcut, so a 3×4 ceiling rejected its estimate of
   14 and produced `difficulty_estimate_implausible` **alongside** `chain_broken` — a difficulty complaint about
   a room whose only defect is its chain. Fixed at the source rather than by loosening the assertion, which is
   what the plan's GOTCHA instructed. The two numbers are equal in any sound room, so nothing else moved.
   `DifficultyInput` consequently carries only `intendedActions`.
2. **The shortcut half of the chain check is suppressed when the containment half already fired.** Without this
   `broken-chain` returned `chain_broken` **twice** — once for the severed containment, once for the shorter
   route — which is one defect counted twice in the per-attempt failure tallies #6 feeds to #8. The shortcut
   check still stands alone for rooms whose containment looks correct but that have a duplicate clue elsewhere.
   Caught by the Level 4 manual script, *after* `corpus.test.ts` had passed only because I had written it with
   `new Set(...)`; that assertion is now a plain array equality, as the plan specified.
3. **`learnedBy` filters on the derivable set.** Not in the plan. One object can be the clue for two puzzles;
   without the filter, inspecting a readable clue would hand over a second answer that clue does not contain,
   and a room with a destroyed clue could be certified through its neighbour.
4. **`checkChain` does not take the compiled `RoomState`.** The plan's signature included it; nothing in the
   check reads it, and carrying a parameter only to `void` it is ceremony. `compileRoom` is now called in
   `verifySpec` for its refusal rather than its result.
5. **Added `bandFor(intendedActions)` and `roomFromSeed(seed)`.** Not in the plan's export list. `bandFor` is
   what lets the fuzzer declare an honest band instead of hard-coding one per chain length; `roomFromSeed` keeps
   the property tests readable. `bandFor` is exported from `index.ts` because #5 will want it when it decides
   what band a generated room should claim.
6. **Added `codesOf(rejections)`.** A one-liner used in nine test files and by #6's attempt log.
7. **Test ratio came in at 43%**, just below the ticket's 45% estimate, because the source carries heavy
   explanatory comments (the knowledge gate, the derivable/unique asymmetry, the calibration provenance). By
   statement count rather than line count the balance is closer.

## Issues encountered

- **The plan's central assumption held.** The canonical room's 6-action optimum, hand-derived during planning,
  was confirmed by the oracle on the first run — as was `broken-chain`'s 4-action shortcut. Every difficulty
  threshold hangs off that number, so it was verified in `oracle.test.ts` before `difficulty.ts` was written,
  exactly as the plan sequenced it. No fixture needed to move.
- **Two defects were found by the tests the plan designated as tripwires**, both in the difficulty/chain
  interaction, and both were genuine mis-specifications rather than over-strict assertions (deviations 1 and 2).
  The second is the more interesting: it passed the contract test and was caught only by the manual script,
  because I had written the assertion loosely. The assertion is now exact.
- **`structure.test.ts` initially contained `lock: [] && null`**, a leftover that evaluated correctly to `null`
  and was therefore invisible to the type checker and the suite. Removed on review rather than left to puzzle a
  future reader.
- **The oracle needed no tuning.** MAX_NODES was never approached — the canonical room explores a few dozen
  states, and the four-puzzle fuzzed rooms a few hundred, against a 50,000 ceiling.

## Notes for the reviewer

Three files carry the ticket's real content.

- **`oracle.ts`** — the knowledge gate is the whole ticket. `oracle.test.ts` contains its positive control:
  remove the gate and `unsolvable.json` certifies, which is the proof that the search measures something. Note
  that state moves only through `resolve()`; the `with*` transitions are never imported, deliberately.
- **`derivation.ts`** — the asymmetry between derivable and unique. Derivability gates the oracle; ambiguity does
  not. That is what keeps `ambiguous-answer` reporting one code, and it will look arbitrary without the comment.
- **`corpus.test.ts`** — three of the four semantic fixtures are asserted to **exactly** one code. `unsolvable`
  is asserted by containment, because it legitimately reports two: the mistake (`answer_not_derivable` on p2)
  and what the mistake did to the room (`unsolvable`). That is the one place the corpus's one-rule-per-fixture
  design reads as two, and `verify.ts` says so at the point it happens.

One boundary worth confirming: `index.ts` deliberately withholds `solveRoom`. Its return value is a complete
escape path — every answer in the room, in order — and the published artifact is served statically to anyone
with the URL.

### Ready for the next step

All changes complete, all validations pass, zero regressions. Next: `piv-commit`, then `piv-create-pr`.

**Branch stacking:** this branch sits on `feature/room-simulator`, which sits on
`feature/scaffold-core-schemas-v0`, and **none of the three has a PR yet** — `main` is still at the docs-only
commit and issues #1, #2 and #3 are all open. Those two PRs should be opened and merged in order before this one.
