# Implementation Report — Room generator (propose → verify → accept), TICKET-5 / #6

**Plan**: `.claude/plans/room-generator.md`   **Branch**: `feature/room-generator` (stacked on
`feature/provider-adapters` @ `f4b7fdd`)   **Status**: COMPLETE. Live generation has not been run (no `.env`
on this machine; see Issues).

## Summary

`lib/generator/` wraps the solver in a propose → narrow → verify → accept loop. A model writes a room as JSON, a
strategy narrows it into a strict `RoomSpec`, and `verifySpec` certifies or rejects it. The rejection reasons go
into the next prompt, up to a cap (default 5).

Every attempt is recorded in an answer-free `GenerationRecord` with its outcome, rejection codes, tokens, latency
and real provider calls. Each accepted room gets a `RoomFingerprint` whose `structureHash` ignores ids, prose and
answers.

Models are reached through a new JSON-mode `createGenerationClient` in `lib/providers`, a sibling of the forced-tool
adapters rather than a mode of them. Strategies are selected by name, and `symbolic` ships. An opt-in CLI,
`scripts/generate-room.mts`, writes a room and its record under `runs/rooms/`.

## Tasks completed

1. JSON-mode compile/decode for Groq → `lib/providers/groq.ts` (UPDATE)
2. JSON-mode compile/decode for Gemini → `lib/providers/gemini.ts` (UPDATE)
3. `GenerationClient` / `JsonRequest` / `JsonCompletion` types → `lib/providers/types.ts` (UPDATE). Facade →
   `lib/providers/generation.ts` (CREATE). Exports → `lib/providers/index.ts` (UPDATE)
4. Client tests → `lib/providers/generation.test.ts` (CREATE). Key hygiene case → `lib/providers/secrets.test.ts`
   (UPDATE)
5. Strategy seam types → `lib/generator/types.ts` (CREATE)
6. Loose proposal schema + `narrowProposal` → `lib/generator/proposal.ts` (CREATE), with tests
7. `symbolic` strategy → `lib/generator/strategies/symbolic.ts` (CREATE), with tests
8. Registry → `lib/generator/strategies/index.ts` (CREATE)
9. Fingerprint → `lib/generator/fingerprint.ts` (CREATE), with tests
10. Record schema → `lib/generator/record.ts` (CREATE)
11. Loop → `lib/generator/generate.ts` (CREATE)
12. Test support → `lib/generator/testing.ts` (CREATE)
13. Loop tests → `lib/generator/generate.test.ts` (CREATE)
14. Public surface → `lib/generator/index.ts`. Sweep → `lib/generator/boundary.test.ts` (CREATE)
15. CLI → `scripts/generate-room.mts` (CREATE)
16. Docs → `README.md` (UPDATE)

## Tests added

| File | Tests | Covers |
|---|---|---|
| `lib/providers/generation.test.ts` | 13 | Both providers:<br>• JSON mode on, no tools/tool_choice<br>• null params omitted<br>• decode<br>• `json_validate_failed` and `MAX_TOKENS` are attempts, not throws<br>• non-2xx throws<br>• retry counted as a real call<br>• Gemini key in header |
| `lib/providers/secrets.test.ts` | +1 | Generation client output and echoed-key errors carry no key or endpoint |
| `lib/generator/proposal.test.ts` | 12 | • Canonical round-trip<br>• every tolerance (absent lock/contains/clueText, numeric codes, derived order/solution, stripped keys, trim)<br>• stamp beats model-supplied fields<br>• issue cap<br>• never throws |
| `lib/generator/strategies/symbolic.test.ts` | 39 | • Brief determinism and variety<br>• chain fits band within the cap<br>• `hard` refused<br>• prompt content, `JSON` present, byte-identical per seed<br>• feedback appended<br>• **property**: for 30 seeds, a room of the brief's shape narrows and certifies<br>• registry |
| `lib/generator/fingerprint.test.ts` | 5 | • Canonical fingerprint pinned, hash included (`f432b72bc8427487`)<br>• invariant to ids, prose and answers<br>• sensitive to decoys, code width and chain length |
| `lib/generator/generate.test.ts` | 11 | • Happy path<br>• full funnel `unparseable_json → proposal_malformed → rejected → accepted` with totals<br>• feedback replaced, not accumulated<br>• cap returns an outcome and makes no extra call<br>• `ProviderError` → `GenerationAbortedError` with the partial record<br>• other errors rethrown<br>• invalid-json anomaly<br>• bad cap refused before any call<br>• determinism<br>• test-only second strategy<br>• provider/model recorded<br>• **no answer in any record** |
| `lib/generator/boundary.test.ts` | 20 | • Disk sweep: no env, fetch, URL, `Math.random`, `Date.now`<br>• providers imported by type only (one pinned exception)<br>• guard-the-guard<br>• positive control |

## Validation results

- `pnpm typecheck`: clean.
- `pnpm test`: **551 passed / 34 files**. The baseline was 450 / 28, so this adds 101 tests.
- CLI offline checks:
  - no args → usage, exit 2
  - `--strategy spatial` → "unknown strategy "spatial" — known: symbolic", exit 2
  - no key → `GROQ_API_KEY is not set`, exit 1, no network call
- `git diff HEAD -- lib/solver lib/schema lib/sim fixtures`: empty. `equivalence.test.ts` is untouched and passing.
- **Not run**: Level 4 live generation. There is no `.env` / API key on this machine.

## Deviations from the plan

1. **One value import from providers.** The plan's boundary rule was "type-only imports from `@/lib/providers`",
   but `generate.ts` needs `ProviderError` as a class for `instanceof`. It imports it from
   `@/lib/providers/types`, which holds no transport code. `boundary.test.ts` allows exactly that path, and its
   positive control proves `@/lib/providers` and `@/lib/providers/transport` value imports are still caught.
2. **`JsonCompletion` and friends live in `types.ts`**, as the plan's Task 1 recommended, rather than in
   `generation.ts`, to avoid an import cycle with `groq.ts` / `gemini.ts`.
3. **Gemini JSON decode also treats `SAFETY` / `RECITATION` finishes as `invalid_json`**, not only
   `MAX_TOKENS`. All three withhold or cut off the document, and all three are the model's outcome rather than a
   transport fault.
4. **The `symbolic` prompt's shape example is hand-written** in `symbolic.ts`, with placeholder answers
   (`123`, `WORD`). The plan said to build it from a fuzz room, but `lib/solver/fuzz.ts` is test support and
   `lib/solver/index.ts` says nothing on a real path should build rooms from a seed.
5. **Test-count estimate.** The plan estimated ~70 new tests; there are 101. The property test is parametrised
   per seed and the boundary sweep emits two tests per file.

## Issues encountered

- **No live validation.** AC #10 (a certified room from a real provider via the CLI) is unverified. Two
  assumptions in the plan are waiting on it:
  - Groq's invalid-JSON error code is `json_validate_failed`.
  - The prompt yields rooms that certify within 5 attempts.

  To close AC #10, run:

  ```bash
  node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed plan-check-1 --provider groq
  node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed plan-check-1 --provider gemini
  ```

  Then record attempts-to-accept for ~3 seeds per provider. TICKET-7 needs those numbers.
- **Brief adherence is not enforced.** The loop certifies whatever room the model returns. A model that ignores
  the brief (wrong chain length or answer domain) is still accepted if the room is valid. The fingerprint records
  what was actually built, so variety measurement stays honest, but the seed only steers the structure; it doesn't
  guarantee it. A `brief_mismatch` outcome would be a small follow-up if live runs show drift. It was left out
  because it isn't in the plan and would need a new outcome in the record schema.
- **Branching.** TICKET-4 was committed first (`f4b7fdd`, "feat: provider adapters and tool-spec equivalence",
  closes #4), as the user chose, and this branch was cut from it. The plan commit is `ba952c9`.
