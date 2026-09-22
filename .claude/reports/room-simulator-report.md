# Implementation Report — Room simulator and action resolution

**Plan**: `.claude/plans/room-simulator.md`
**Branch**: `feature/room-simulator` (stacked on `feature/scaffold-core-schemas-v0`)
**Issue**: [#2](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/2)
**Status**: COMPLETE

## Summary

Built the engine: a `RoomSpec` compiles into an immutable state machine, and every verb in the v0 vocabulary
resolves against it through a pure function returning a `Verdict`. A ledger enforces the three budget caps and
reports exhaustion as an outcome rather than throwing. Malformed payloads come back as a `malformed` verdict and
still cost a turn. The two contract tests are the deliverable: an adversarial sweep proving no answer, lock code
or sealed-away clue can reach a competitor, and a replay of ticket 1's golden log that reproduces all 27
committed verdicts and both committed run summaries exactly.

Ticket 1 was verified complete before any of this was written — `pnpm typecheck` clean, 94/94 tests passing —
and then committed, since its work was still sitting uncommitted in the working tree.

## Tasks completed

- Compiled state + reachability → `lib/sim/state.ts` (CREATE)
- Competitor-facing view, the secrecy boundary → `lib/sim/observation.ts` (CREATE)
- The pure resolution table → `lib/sim/resolve.ts` (CREATE)
- Budget ledger and end reasons → `lib/sim/budget.ts` (CREATE)
- The stateful facade the harness drives → `lib/sim/simulator.ts` (CREATE)
- Narrow public seam → `lib/sim/index.ts` (CREATE)
- Ticket 2 plan → `.claude/plans/room-simulator.md` (CREATE)

**No file outside `lib/sim/` was touched.** `lib/schema/*` and `fixtures/*` are unchanged, so the four tickets
building on ticket 1's corpus are unaffected.

## Tests added

| File | Cases | Covers |
|---|---|---|
| `lib/sim/state.test.ts` | 21 | containment inversion, **the lock-gated reachability rule**, broken-spec rejection (dangling child, double parent, duplicate id, self-containment, cycle), transition immutability |
| `lib/sim/observation.test.ts` | 13 | what `look` shows, what it withholds, lock state without the code, prose and fields agreeing |
| `lib/sim/resolve.test.ts` | 38 | at least one case per row of the verdict table, the full canonical chain, purity and non-mutation |
| `lib/sim/budget.test.ts` | 11 | each cap independently, the cap-order tie-break, charging bad actions, no negative remainder |
| `lib/sim/simulator.test.ts` | 26 | seven malformed payload shapes, turn consumption, counter classification, **competitor independence**, escaped-beats-exhausted |
| `lib/sim/secrecy.test.ts` | 8 | the adversarial sweep, plus the positive control that proves it measures secrecy and not silence |
| `lib/sim/fixture-replay.test.ts` | 9 | all 27 golden verdicts, both committed `RunSummary` records, determinism |

**126 new tests across 7 files, all passing. Suite total 220/220.**
1,264 lines of test against 897 lines of source — 59% test, above the plan's ~35% estimate.

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 — Syntax & types | `pnpm typecheck` | PASS (no lint step, by design) |
| 2 — Ticket units | `pnpm test lib/sim` | PASS — 126/126 across 7 files |
| 3 — Full suite | `pnpm test` | PASS — 220/220 across 13 files, no ticket-1 regression |
| 4 — Build | `pnpm build` | PASS — 2 static routes |

## Deviations from the plan

All deliberate.

1. **`describeRoom(state)` takes no budget argument.** The plan gave it `actionsRemaining`, but `resolve` calls
   it and `resolve` is required to know nothing about the ledger. Extracted `visibleObjects` / `heldObjects` so
   `observe` and `describeRoom` share one source of truth without `resolve` ever touching the budget.
2. **`observe(state, actionsRemaining)` rather than `observe(state)`.** Same cause: `actionsRemaining` lives in
   the ledger, so the facade passes it in rather than the observation layer reaching for it.
3. **`submit_answer` against a `code` puzzle returns `not_permitted`.** Not specified in the ticket. The
   alternative — accepting it — would make the physical lock decorative and give two different action counts for
   the same solution, corrupting the one number the product compares models on. `lib/schema/action.ts` already
   draws the distinction ("`enter_code` … this one is physical"), so this enforces it rather than inventing it.
4. **`take` on something already held is a harmless `ok`, not an error.** It still costs a turn. Penalising it as
   invalid would count a redundant move as interface misuse, which it is not.
5. **`summarise()` throws if the run has not ended.** A `RunSummary` must state `endedBecause`, and there is no
   honest value for a run still in progress. The harness checks `hasEnded()`.
6. **Escaping beats budget exhaustion** when the same action does both. Not in the plan; recording a solved room
   as a budget failure would be a lie about the only outcome the product reports.
7. **Larger than estimated.** The plan cited the ticket's ~800–1,200 lines; actual is ~2,160 lines across
   `lib/sim/`. The overrun is concentrated in tests (59%) and in the explanatory comments on the secrecy and
   reachability rules — worth knowing for sizing, and consistent with ticket 1's overrun for the same reason.

## Decisions taken during planning

Two questions the ticket left open were settled with the user before implementation, and both are load-bearing
for later tickets:

- **Reachability is gated on the LOCK, not on `open`.** An unlocked container's contents are in reach whether or
  not anyone opened it; a locked container's are not. This was settled by the golden log rather than by taste —
  at `seq 5` model-b inspects the `ledger` and receives `ok`, having never opened the `desk` that holds it. The
  stricter gate-on-`open` reading would have turned that committed event into `not_found` and forced a
  regeneration of the corpus that #3, #4 and #8 are being built against. Every chain clue in the canonical room
  still sits behind a code lock, so the chain is as real either way.
- **The v0 verb set is unchanged.** `lib/schema/action.ts` grants this ticket licence to adjust it; the seven
  verbs covered the canonical room end to end, and nothing proved unexpressible, so the licence was not used.
  `fixtures/` is untouched.

## Issues encountered

- **The plan's strict-containment wording contradicted the committed fixture**, caught by reading the log before
  writing code rather than by a failing test afterwards. Resolved as above. This is the one thing in the ticket
  that would have been expensive to get wrong — a silent regeneration of the corpus mid-wave-2.
- **The counter classification was not specified anywhere**, but it is fully determined by
  `fixtures/runs/canonical-run.json`: model-b's `failedAttempts: 2` / `invalidActions: 1` against a log holding
  two `wrong_code`, one `not_found` and one `locked` fixes all three categories, including that `locked` counts
  as neither. It is encoded as one exported table (`VERDICT_TALLY`) with that reasoning above it, and a test
  asserts every member of `VERDICT_CODES` has an entry so a future code cannot go uncounted.
- **The canonical room has no key lock**, so `use` and `not_holding` had no fixture to be tested against. Added a
  minimal hand-built `keyRoom` inside `resolve.test.ts` for those rows. Worth noting for #5: a generator that
  only ever emits code locks would leave `use` exercised by unit tests alone.
- **The replay test passed on first run.** The fixture and the independently-written simulator agreed on all 27
  verdicts and both summaries with no adjustment to either, which is the strongest evidence available that
  ticket 1's corpus is a usable contract rather than plausible-looking data.

## Notes for the reviewer

The two files to read are the contract tests.

- **`secrecy.test.ts`** asserts a narrower invariant than "no secret ever appears", and deliberately so: the
  `ledger`'s clue is *supposed* to say `4471`. The real rule is that a code or answer may reach the competitor
  only as the clue text of an object they can actually reach. The positive control at the bottom — unlock the
  safe, confirm the chart and its clue then *do* appear — exists so the file cannot pass by making the simulator
  silent.
- **`fixture-replay.test.ts`** compares verdict **codes**, not messages. The fixture's prose was hand-authored
  for the replay player and the simulator writes its own; asserting equality would pin the room's voice in two
  places. That is a narrower assertion on purpose, and the file says so.

One boundary worth confirming: `index.ts` deliberately does not re-export the `with*` state transitions. A
harness able to call `withUnlocked` could open a door without spending an action, silently.

### Ready for the next step

All changes complete, all validations pass. Next: `piv-commit`, then `piv-create-pr` (this branch is stacked on
`feature/scaffold-core-schemas-v0`, so that PR should merge first), then `piv-review-pr`.
