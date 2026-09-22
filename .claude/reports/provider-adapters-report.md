# Implementation Report — Provider adapters and tool-spec equivalence

**Plan**: `.claude/plans/provider-adapters.md`
**Branch**: `feature/provider-adapters` (stacked on `feature/solver-verifier`)
**Issue**: [#4](https://github.com/SachinthaRanasinghe/llm-escape-room/issues/4)
**Status**: COMPLETE (live smoke run skipped: there are no keys on this machine)

## Summary

Built `lib/providers/`, the fairness seam. The single `ActionSchema` is converted into a neutral *portable spec*:
7 tools, one per verb, with every description written once. The Groq and Gemini adapters each compile it into
their own format, and each also has the inverse function that converts that format back. `equivalence.test.ts`
compares the three pairs (source↔Groq, source↔Gemini, Groq↔Gemini) and requires zero drift. Every golden-log
action must decode identically from both formats, and both requests must carry identical text under the same
forced tool-calling mode. Five planted mutations prove drift is detected. When a model makes a mistake, the
adapter never throws. The mistake reaches the simulator as a `malformed` action that costs a turn.

## Tasks completed

- Adapter contract, transcript, turn, error → `lib/providers/types.ts` (CREATE)
- Portable spec + single description table + `toRawAction` → `lib/providers/vocabulary.ts` (CREATE)
- Drift finder → `lib/providers/equivalence.ts` (CREATE)
- Retry/backoff/timing/redaction → `lib/providers/transport.ts` (CREATE)
- Shared turn classification → `lib/providers/turn.ts` (CREATE, not in plan; see deviation 1)
- Groq adapter → `lib/providers/groq.ts` (CREATE)
- Gemini adapter → `lib/providers/gemini.ts` (CREATE)
- The only env read → `lib/providers/env.ts` (CREATE)
- Narrow public seam + `createAdapter` → `lib/providers/index.ts` (CREATE)
- Test support → `lib/providers/testing.ts` (CREATE)
- Live smoke → `scripts/smoke-providers.mts` (CREATE)
- `.env.example` (CREATE), `README.md` (UPDATE)

## Tests added

| File | Cases | Covers |
|---|---|---|
| `vocabulary.test.ts` | 10 | 7 tools in `ACTION_NAMES` order, params re-derived from Zod shapes, shared intent description, frozen, `name` can't be overridden, unparseable args are wrapped |
| `transport.test.ts` | 8 | success timing, `retry-after` in seconds and as an HTTP date, only the successful attempt timed, exponential backoff with cap, network error retried, 400 not retried, key echoed by provider redacted, URL never in the error |
| `groq.test.ts` | 17 | tools invert exactly, a stray `enum` is refused, all transcript kinds encoded, null params omitted, each anomaly, `tool_use_failed` becomes a turn, 401 throws with key scrubbed, **adapter → `Simulator.apply` for both a good call and a malformed one** |
| `gemini.test.ts` | 19 | upper-case types / `propertyOrdering`, int64-string lengths, `thoughtSignature` echoed byte for byte, a made-up id is never sent, thinking tokens counted, `MALFORMED_FUNCTION_CALL`, key only in the header, adapter → simulator |
| `equivalence.test.ts` | 16 | **the contract**: zero drift three ways, source fidelity checked independently, 5 positive controls, 30 actions (27 golden + 3 synthetic, all 7 verbs) round-tripped through both formats, the same mistakes handled the same way, identical framing text, mode and sampling params |
| `secrets.test.ts` | 9 | disk scan: env read only in `env.ts`, artifact side never imports providers, endpoints named only in the two adapters, fixture JSON has no URLs or key-shaped strings, adapter output and errors are clean, positive control |

**79 new tests across 6 files, all passing. Suite total 450/450 across 28 files.**
976 lines of tests against 1,403 lines of source, which includes `testing.ts` and the smoke script (~41% tests).

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 — Types | `pnpm typecheck` | PASS (no lint step, by design) |
| 2 — Ticket units | `pnpm test lib/providers` | PASS — 79/79 |
| 3 — Contract + full suite | `pnpm test` | PASS — 450/450, zero regressions in the existing 371 |
| 3 — Build | `pnpm build` | PASS — 2 static routes; nothing in `app/` pulls in providers |
| 4 — Contract untouched | `git diff --stat feature/solver-verifier -- lib/schema fixtures lib/sim lib/solver package.json` | PASS — empty |
| 5 — Env readers | `grep -rln process.env lib app fixtures` (non-test) | PASS — `lib/providers/env.ts` only |
| 4 — Live smoke | `node --env-file-if-exists=.env --import tsx scripts/smoke-providers.mts` | **SKIPPED** — no `.env`; the script ran without keys, skipped both providers and exited 0 |

## Deviations from the plan

1. **Added `lib/providers/turn.ts`.** The plan put the decode logic inside each provider file. Deciding what counts
   as "no call", "two calls" or "unparseable arguments" is itself a fairness rule. If each decoder had its own
   copy, one model could be forgiven a double call that the other is charged for, and no comparison of tool specs
   would catch it. So both decoders reduce their format to a list of `ToolCall`s and pass it to one
   `turnFromCalls`. The same file holds `DecodeContext`, `rejectedTurn` and `count`.
2. **Synthesised call ids use a `local:` prefix with `isSyntheticCallId()`**, not the plan's `call-<n>`. The Gemini
   encoder must leave `id` off any id it made up, because Gemini would reject an id that matches no call it issued.
   A plan-style `call-` prefix could collide with a real provider id. The explicit helper can't.
3. **`AdapterOptions` lives in `types.ts`**, not `groq.ts`, so both adapters and `createAdapter` share one
   definition.
4. **Decoders take a `DecodeContext` object** (`callIndex`, `secrets`, `attempts`) instead of positional
   arguments. That way a `ProviderError` thrown during decode carries the real attempt count from transport and
   doesn't need to be caught and re-thrown.
5. **`vocabulary.ts` calls `z.toJSONSchema(member)` and filters out `name`** instead of `member.omit({ name })`.
   TypeScript can't call `.omit` across the union's members (TS2349). The output is the same.
6. **`createAdapter` takes an optional third `deps` argument.** It isn't in the plan, but it lets the harness
   tests (TICKET-6) inject a stub without importing the per-provider factories.
7. **The Gemini decoder drops `thought: true` text parts** from `text`, so a thinking model's private reasoning
   never appears as its spoken reply. The plan didn't mention thought parts.

## Issues encountered

- **Two plan assumptions are still unconfirmed against the live APIs**, because there were no keys:
  (a) Gemini accepts `minLength`/`maxLength` on `STRING` parameters; (b) Groq's forced-mode parse failure is a
  `400` with `error.code === 'tool_use_failed'`. The canned test data encodes both assumptions. If the smoke run
  disproves (a), drop both lengths from `PortableParam` **for both providers** and add an AMENDMENT to the plan.
  Don't make the Gemini compiler drop them silently, because the equivalence test would then (correctly) fail.
- **The smoke script's default model ids** (`llama-3.3-70b-versatile`, `gemini-flash-latest`) are only defaults
  and haven't been checked against today's free tier. Either can be overridden with `--groq-model` /
  `--gemini-model`. Choosing the models is TICKET-7's job.
- `transport.ts` calls `Date.now()` once, only to convert an HTTP-date `retry-after` into a delay. It never affects
  `latencyMs`, which comes from the injected clock.

## Notes for the reviewer

- **`equivalence.test.ts`** is the deliverable. Read its header first, then the positive-controls block. That
  block is what shows the test measures something real.
- **Strict inversion** in `normaliseGroqTools` / `normaliseGeminiTools`: they throw on any key they don't know.
  If they ignored unknown keys, an `enum` added to one compiler would hand one model a hint and still pass the
  equivalence test.
- **`index.ts` deliberately withholds `postJson`.** A caller with raw transport could send `tool_choice: "auto"`,
  which is the fairness setting, and nothing would notice.

### Ready for the next step

All changes are complete and every offline validation passes. Next: `piv-commit`, then `piv-create-pr`. If keys
are available, run the smoke script first to close the two live assumptions.

**Branch stacking:** this branch sits on `feature/solver-verifier` → `feature/room-simulator` →
`feature/scaffold-core-schemas-v0`. None of them has a PR yet, and `main` is still docs-only.
