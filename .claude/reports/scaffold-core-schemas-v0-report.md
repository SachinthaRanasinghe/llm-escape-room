# Implementation Report — Scaffold, core schemas (v0) and seeded determinism

**Plan**: `.claude/plans/scaffold-core-schemas-v0.md`
**Branch**: `feature/scaffold-core-schemas-v0`
**Issue**: [#1](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/1)
**Status**: COMPLETE

## Summary

Stood up the repo skeleton (pnpm, TypeScript, Next 16, Vitest, Zod) and defined the v0 contracts every other
ticket codes against: the action vocabulary, the room spec, the event log and the run record, each with a
narrowing parse function and a named error. Added a zero-dependency seeded RNG whose first twenty outputs are
locked by a characterisation test. Committed the golden fixture corpus — one canonical room, one 27-event log of
two models genuinely diverging, one run record, and five rooms each broken in exactly one way — plus the
generator that produces them, so the derived run summaries cannot drift from the log they summarise.

## Tasks completed

- Scaffold → `package.json`, `tsconfig.json`, `vitest.config.mts`, `next.config.ts`, `pnpm-workspace.yaml` (CREATE)
- Next skeleton → `app/layout.tsx`, `app/page.tsx` (CREATE)
- Version seam → `lib/schema/version.ts` (CREATE)
- Migration seam → `lib/schema/migrations/README.md` (CREATE)
- Seeded RNG → `lib/rng.ts` (CREATE)
- Action vocabulary + verdicts → `lib/schema/action.ts` (CREATE)
- Room spec → `lib/schema/room.ts` (CREATE)
- Event log → `lib/schema/event.ts` (CREATE)
- Competitor / Run / RunSummary → `lib/schema/run.ts` (CREATE)
- Fixture corpus → `fixtures/rooms/valid/`, `fixtures/logs/`, `fixtures/runs/`, `fixtures/rooms/invalid/` (CREATE)
- Typed loaders → `fixtures/index.ts` (CREATE)
- Fixture generator → `scripts/generate-fixtures.mts` (CREATE)
- Repo docs → `README.md`, `.gitignore` (UPDATE)

## Tests added

| File | Cases | Covers |
|---|---|---|
| `lib/rng.test.ts` | 15 | golden sequence, seed independence, inclusive `int`, Fisher-Yates permutation, edge arrays |
| `lib/schema/action.test.ts` | 13 | every verb, required `intent`, strict unknown keys, verdict codes |
| `lib/schema/room.test.ts` | 13 | complete room, version fail-loud, null-not-absent, **the structural/semantic boundary** |
| `lib/schema/event.test.ts` | 16 | complete event, no pacing fields, intent not duplicated, `findSeqBreaks` |
| `lib/schema/run.test.ts` | 15 | summaries, budget exhaustion as an outcome, explicit-null variance field |
| `fixtures/index.test.ts` | 22 | corpus parses, room is referentially coherent, **log is interesting**, summaries re-derived |

**94 tests across 6 files, all passing.** 848 lines of test against 920 lines of source (48%).

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 — Syntax & style | `pnpm typecheck` | PASS (no lint step, by design) |
| 2 — Unit tests | `pnpm test` | PASS — 94/94 |
| 3 — Integration | `pnpm test fixtures/index.test.ts` | PASS — 22/22 |
| 4 — Manual | `pnpm build` | PASS — 2 static routes |
| 4 — Manual | fixture loader smoke | PASS — `puzzles: 3`, `events: 27`, `model-a=escaped in 13, model-b=budget_actions` |

## Deviations from the plan

All deliberate. Each is a decision a reviewer should read as intentional.

1. **`intent` is NOT duplicated on `Event`.** The plan listed it on both `Action` and `Event`. It lives only on
   the action, because two copies can disagree and the entire value of an in-band intent is that it cannot drift
   from the action it explains. Read it as `event.action.intent`.
2. **Added a third version constant, `RUN_VERSION`.** The plan named `runVersion` on `Run` but `version.ts` only
   specified `SPEC_VERSION` and `LOG_VERSION`. Summarising a run differently should not invalidate published
   logs, so it is versioned independently.
3. **`package.json` does not set `"type": "module"`.** The plan said it should; the sibling project — the
   convention source — leaves it unset, and its `.mts` config and ESM imports work regardless. Matched the
   sibling.
4. **Added `pnpm-workspace.yaml`.** Not a workspace: pnpm 11 refused to run esbuild's build script (which Vitest
   needs) without approval, and `allowBuilds` lives in that file. The plan's "single package, not a workspace"
   assumption still holds — there is no `packages:` key.
5. **Added `scripts/generate-fixtures.mts`,** which was not in the plan's file list. The run summaries are
   derived totals over the log; a hand-edit to one latency without a matching edit to `escapeMs` would produce a
   corpus that lies. The generator parses every artifact through its own schema before writing, so it fails
   loudly rather than committing a broken contract.
6. **Added a run-record fixture** (`fixtures/runs/canonical-run.json`). The plan listed a room and a log;
   `RunSummary` is one of the ticket's schemas and #10 builds against it, so it needed an example too.
7. **`findSeqBreaks` rather than `assertContiguousSeq`.** Returns the offending competitor ids instead of
   throwing, so a caller can report all of them at once.
8. **Larger than estimated.** The plan estimated ~400–700 lines; actual is ~1,770 lines of TypeScript plus the
   JSON corpus. The overrun is concentrated in tests and in explanatory comments on the contract files, which is
   where this ticket's value sits — but it is an overrun and worth knowing for sizing the next tickets.

## Issues encountered

- **React version trap, caught as planned.** npm's current React is 19.3.0, but `@react-three/fiber@9.7.0` peer
  requires `react >=19 <19.3`. React is pinned at 19.2.8, so #5 stays installable. This was the plan's
  highest-value gotcha and it was real.
- **macOS ships bash 3.2**, which has no associative arrays — unrelated to the deliverable, but it cost a
  scripting retry during issue creation earlier in the session.
- **Nothing in the plan turned out to be wrong.** The four settled decisions and the inherited sibling
  conventions held up without renegotiation.

## Notes for the reviewer

The two assertions most worth reading are in `fixtures/index.test.ts`:

- **"lets the other four parse — they are the SOLVER's problem"** guards the structural/semantic boundary. If a
  future `.refine()` on `RoomSpecSchema` starts catching the semantic faults, #3 loses its ability to be tested
  on *which* rule it rejected, and that test fails to say so.
- **"is INTERESTING, not merely valid"** asserts the fixture log contains a wrong code, a not-found, and a
  locked verdict. #5 can only render states the fixture contains, so a sterile happy-path log would silently
  produce a replay player that cannot show divergence — the thing the product exists to show.
