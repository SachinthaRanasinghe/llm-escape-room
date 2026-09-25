# Decision: puzzle substrate and free-tier fit

**Status:** Draft — method fixed, **spike not yet run** · **Ticket:** TICKET-7 (#8) · **Started:** 2026-09-23
**Plan:** [`.claude/plans/substrate-spike-v1.md`](../../.claude/plans/substrate-spike-v1.md)

## Context

The PRD's whole bet rests on two models *diverging* in a room. `architecture.md` → *Spikes & experiments* leaves
the puzzle substrate undecided and makes two questions gate everything downstream:

1. **Divergence.** Which substrate — symbolic, spatial or mixed — separates the two models on at least 60% of
   instances, with both models playing inside the action budget?
2. **Quota.** Does one publishable matchup fit the free tier: a hero run, its silent repeats, and the rejected
   generation candidates?

`RoomSpec` and `Event` stay at v0 until this record is accepted. They are then pinned at v1 (plan, Part B).

## Method

| | |
|---|---|
| Substrates | `symbolic`: codes, then a word. `spatial`: every link is a key, with decoy keys. `mixed`: codes and keys interleaved, then a word. All three are in `lib/generator/strategies/`. |
| Instances | 20 per substrate, seeds `spike-<strategy>-<i>`, run interleaved across substrates |
| Generation | `gemini/gemini-flash-lite-latest`, cap of 5 attempts, band `standard` (3–4 links). See the note below. |
| Competitors | `groq/openai/gpt-oss-120b` (model-a) vs `groq/openai/gpt-oss-20b` (model-b), provider defaults for sampling |
| Budget | 14 actions, 60,000 tokens, 300 s per competitor (`DEFAULT_BUDGET`) |
| Per instance | one duel, no silent repeats |
| Diverged | exactly one model escapes, or both escape and the slower needs more than 1.25× the actions (`lib/spike/divergence.ts`) |
| Eligible | neither competitor was stopped by the token or wall-clock budget; running out of actions is a legitimate result |
| Adopt | ≥60% diverged over ≥15 eligible instances. Ties go to the higher divergence rate, then higher generation acceptance, then name (`lib/spike/decide.ts`) |
| Quota | one room + (1 + repeats) duels per model, against published free-tier limits. Cuts are made in the order repeats → generation retries → chain length (`lib/spike/quota.ts`) |

**Model pair.** The Llama pair originally planned is gone: Groq shut down `llama-3.1-8b-instant` on 2026-08-16 and
now lists both Llamas as Enterprise-only. The gpt-oss pair keeps one provider and one serving stack. It is still a
large-versus-small pairing, so **divergence may partly measure model size rather than substrate**. The comparison
*between* substrates is still fair, because every substrate faces the same pair.

**Generation model.** The plan named `gemini-flash-latest`. It returned "503 high demand" throughout 2026-09-23
and 2026-09-24. The alternatives checked:

- A Groq model would spend the competitors' daily tokens.
- `qwen/qwen3.8-27b` is capped at 1,000 output tokens per minute, and a room needs up to ~5,600.
- `gemini-flash-lite-latest` answered, slowly but on its own quota.

The generation model builds the room *before* either competitor sees it, and both play the same certified room,
so this choice cannot favour either competitor. It can change which rooms get built, and how many attempts that
takes.

**Run it:**

```bash
node --env-file-if-exists=.env --import tsx scripts/spike-substrate.mts    # re-run daily until "nothing left"
node --import tsx scripts/spike-report.mts                                 # prints the tables below
```

Groq's free plan allows each model 200K tokens a day, and a duel costs ~20K per competitor. That is about 8–10
duels per model per day, so the 60-duel spike takes about a week of re-runs.

## Smoke observations (2026-09-23) — NOT evidence

These are single runs, made to check that the pipeline works. They are recorded so the numbers below can be
compared with them. They say nothing about divergence.

- **Canonical fixture room**, one duel: 120b escaped in 11 actions; 20b ended on `budget_actions` with 2 of 3 puzzles
  solved. There were no `not_found` verdicts, so the id visibility fix works. Each model had 1 invalid action: a
  tool-call fumble, not an id guess. Tokens: 13.5K+1.0K (120b) and 16.9K+2.1K (20b). 34 provider calls.
- **Generated rooms** (on Groq, because Gemini was returning 503s): `spatial` certified on attempt 2 (4 key links),
  and `mixed` on attempt 1 (3-digit code → key → colour).
- **Spatial room**, one duel: both models ended on `budget_actions`, with 2 and 1 of 4 puzzles solved. `wrong_key`
  and `not_holding` both fired. 50 provider calls.
- **A pipeline finding, fixed in this ticket:** Groq returns HTTP 400 "Parsing failed … failed_generation" when
  gpt-oss writes an unparseable tool call. It used to abort the whole duel as a provider failure. It is now
  counted as the model's own turn (`provider_rejected_call`, invalid), as `tool_use_failed` already was.

## Results

*Pending — paste the `### Results` table from `scripts/spike-report.mts`.*

## Decision

*Pending — paste the `### Decision` section. If nothing clears 60%, the fallback fires: the generator must target
difficulty near the models' ceiling before anything else proceeds. That is a successful outcome for this ticket.*

## Quota

*Pending — paste the `### Quota` section.* Gemini publishes no free-tier numbers, so its fit reads `unknown`
unless its AI Studio limits are added to `FREE_TIER_LIMITS` in `lib/spike/quota.ts`.

## To confirm at the checkpoint

- **Eligibility.** "Both models inside the action budget" is read as *neither model was stopped by the token or
  time budget*. The alternative reading, a minimum escape rate for the stronger model, would add a second
  threshold.
- **`MIN_ELIGIBLE = 15`**, out of about 20 instances.
- **Proposed v1 changes (Part B), once a substrate is adopted:**
  - `SPEC_VERSION` and `LOG_VERSION` go to 1.
  - `Event.rejected` becomes nullable and required.
  - The `key` puzzle kind and the `wrong_key` verdict are kept if spatial or mixed is adopted.
  - Retune `DEFAULT_BUDGET.maxActions` to ⌈1.25 × p90 escape actions⌉, but never below 14. Re-fit
    `DIFFICULTY_RANGES` so the canonical room stays `standard`.

## Consequences

*Pending.* This record will not prove that the result generalises: n≈20 per substrate, one model pair, one
provider.
