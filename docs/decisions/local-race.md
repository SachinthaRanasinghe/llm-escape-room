# Decision: a local race page with a live free-model catalogue

**Status:** Accepted · **Decided:** 2026-09-25

## Context

Choosing the two competitors meant editing `--a` / `--b` flags on `scripts/run.mts`, and the only models the
harness could reach were whatever Groq and Gemini happened to serve. The ask: let a person pick **any two free
models** in the browser and race them.

Two constraints from `architecture.md` shape the answer. The published site has **no server**, and the replay is
**one-way**: it "cannot reach a provider even in principle". And every run must stay on **free-tier quota**.

## Options weighed

| Option | For | Against |
|---|---|---|
| **Local race page** (`/race` + two route handlers, on under `next dev` only) | Model choice in the browser; the public site stays static and key-free | A server-side call path now exists inside the Next app |
| Public live racing | Anyone can race | Visitors spend the owner's quota; needs a deployed server, rate limits, abuse handling; reverses "no server" |
| Terminal picker only | No change to the app's shape | Not a browser interface |

For providers: Groq and Gemini only (no new sign-up, ~14 playable models) versus adding **OpenRouter**, one
free key that reaches most free open-weight models, versus every free provider (four new keys, four new
dialects to prove equivalent).

## Decision

**A local race page, and OpenRouter as a third provider.**

- `/race` lets you pick two models from a catalogue read **live** from each provider, a room, and a number of
  silent repeats. `POST /api/race` runs the same `runMatchup` as `scripts/run.mts`, streams progress as NDJSON,
  writes the same files under `runs/<runId>/`, and ends by building the artifact **in memory**, with every
  publish check including the leak scan, so the page plays the result in the existing player. Publishing to
  `/run/<id>` is still the deliberate CLI step, and the page prints the command.
- **Watched live.** The main run plays in the 3D scene as it happens. The harness reports each action the moment
  the room judges it (`DuelOptions.onEvent`, which cannot change or break the run), and `/api/race` streams it as
  a `beat` — the same `ReplayBeat` the published replay draws, leak-scanned first. The page's `LivePlayer` gives
  each lane its own clock that runs only as far as the beats that have arrived: a lane holds on its last verdict,
  marked "thinking", until its model answers, and plays faster to catch up when a quick provider gets ahead. The
  silent repeats send no beats. Once the race is saved, "Watch the replay" plays the recorded run at the normal
  pace, as `/run/<id>` would.
- **Results on the same page, even when a provider stops the race.** A finished race reveals the published run's
  results table under the live scene — the moment the main run's last verdict lands, not after the silent
  repeats: `runMatchup`'s `onHero` hands over the main run before any repeat starts, and `/api/race` sends it as
  a `result` message whose variance note says the check for luck is still running (`buildEarlyComparison`). The
  `done` message's comparison then replaces it with the settled note. A main run that a provider stops part-way (a free-tier 429, say) keeps the
  scene too: the lanes play the moves already made, and the same table shows the results so far — each partial log
  played back through a fresh simulator — with no winner and a plain statement of why it cannot be published
  (`lib/comparison/stopped.ts`).
- **Local only.** `/race`, `/api/models` and `/api/race` 404 in a production build unless `ENABLE_LOCAL_RACE=1`
  (`lib/providers/env.ts`), so deploying the replay site can never expose an endpoint that spends the keys.
  `/run/<id>` stays statically built and one-way.
- **Only the catalogue can be raced.** A pick is checked against the live catalogue before a key is read,
  so an OpenRouter key with credit cannot be talked into running an arbitrary paid model. The catalogue is free
  models plus Claude (see the amendment below).
- **OpenRouter shares Groq's dialect.** Its request body is byte-for-byte `compileGroqRequest`, so it inherits
  the tool-spec equivalence proof. `equivalence.test.ts` pins that it sends exactly Groq's keys and decodes every
  golden-log action the same way Gemini does. Its one extra behaviour is retrying transient upstream failures
  that arrive inside a 200 (such as "service temporarily overloaded"), which the status-based transport cannot see.

### What "free and can play" means

A competitor must write text and accept a **forced** tool call, the fairness setting every adapter sends.
OpenRouter's listing states price and tool support, so its rule is exact: zero prompt and completion price,
`tools` and `tool_choice` both supported, text output only. Groq and Gemini publish neither, so their rules are
name-based (no speech, image, music, embedding or guard models), and `CATALOGUE_EXCLUSIONS` records what a live
probe (one forced tool call per model, 2026-09-25) found that a listing cannot show:

| Excluded | Why |
|---|---|
| Groq `qwen/qwen3.8-27b` | Free tier allows 1,000 output tokens per minute, less than one turn |
| Groq `*safeguard*` | A safety-policy classifier, not a chat model |
| Gemini `gemini-2.*` | Still listed, but refused to new API projects |
| Gemini `*-pro*` | No free-tier quota |
| OpenRouter `openrouter/*` | A router that picks a different model per call, so there is no fixed opponent |

The page lists these with their reasons instead of dropping them silently.

## Consequences

- **Some free models play badly for serving reasons, and that is scored, not hidden.** In the first live race,
  OpenRouter served `nvidia/nemotron-3-super-120b-a12b:free` through an upstream that ignores forced tool choice.
  The model wrote its calls as text, and 10 of its 14 turns were scored `no_tool_call`. Parsing text for one
  model would forgive a mistake the others are charged for, so the rule stands. The comparison shows invalid
  actions for exactly this reason.
- **Quota.** A free OpenRouter key allows 50 requests a day (1,000 with $10 of credit). One race is up to 14 calls
  per model plus retries, so the page defaults to **one** silent repeat, not the CLI's three, and says why.
- One race at a time per server process, since two concurrent races on one free key trip the limits for both.
- `secrets.test.ts` now also sweeps for the OpenRouter host and key shape and Google's newer `AQ.` key shape, and
  enforces that only the `/race` server page and the `app/api/` routes import `lib/race`. The browser gets
  `lib/race/wire.ts`, which is types only. `lib/artifact/scan.ts` refuses the new key shapes in any artifact.

## Amendment: Claude, paid (2026-09-26)

Claude has no free tier on any provider, so the free-only rule kept it off the page. The ask was to race it
anyway, without an Anthropic API key.

- **Through OpenRouter, on the existing adapter.** OpenRouter serves `anthropic/claude-*`, so no new provider,
  dialect or key is needed; the request is still byte-for-byte `compileGroqRequest`, with the same forced
  `tool_choice`, so Claude plays by the same rules. Racing it needs credit on the OpenRouter key.
- **Only Claude is let through.** `PAID_MODELS` (`lib/providers/catalogue.ts`) admits `anthropic/claude-*` with a
  stated price and forced-tool support; every other paid model is still dropped. The `:batch` variants are
  excluded with a reason: they answer asynchronously, not turn by turn.
- **Priced at the live listed price.** Each catalogue entry carries `price` (USD per million tokens, `null` when
  free). `prepareRace` builds a price table from the picks and passes it to the harness as `DuelOptions.prices`,
  so a Claude run's `costUsd` is what was spent rather than an unpriced $0 guess. `PRICING` stays free-only; a
  Claude run from `scripts/run.mts` is reported unpriced, as any unknown model is.
- **Never the default, always labelled.** The picker puts Claude in its own "paid" group with its price, never
  picks it by default, and shows what a paid pick costs and that each silent repeat is another full race of calls.

## Amendment: open to the public on the hosted site (2026-10-03)

"Local only" is now the default rather than the rule. With `PUBLIC_RACE=1` the deployed site offers `/race` to
every visitor — free models only, rate-limited, run in a Netlify background function and followed by polling, with
the keys still read only on the server. See `public-race.md`.
