# Decision: the race, open to the public on the hosted site

**Status:** Accepted · **Decided:** 2026-10-03 · **Amends:** `local-race.md` ("Local only")

## Context

The site is deployed on Netlify (`llm-escape-room.netlify.app`). `/race` 404'd there by design: `local-race.md`
kept racing local so the public site could never spend the owner's keys. The ask now is the opposite — let visitors
race models on the owner's provider quota, **without ever revealing a key**.

Two facts of the platform shape the answer:

- A race takes minutes. A Netlify function that streams its response is stopped after **60 seconds**, so the local
  page's one long NDJSON stream cannot work there.
- A function's disk is read-only and gone after the call, so `runs/<runId>/` cannot be written.

## Decision

**Opt-in public mode (`PUBLIC_RACE=1`), run in a background function, followed by polling.**

1. `POST /api/race` runs every check the local race runs (`checkRace`), then the public limits, queues a job in
   **Netlify Blobs** and kicks `netlify/functions/race-background.mts`. It answers `202 { raceId }` at once.
2. The **background function** (up to 15 minutes) claims the queued job — a second kick or a made-up id finds nothing
   to claim — re-runs the checks, and runs the same `runRace` with `persist: false`. Every `RaceMessage` is appended
   to the job's log in Blobs.
3. The page polls `GET /api/race/<raceId>?from=<n>` once a second and feeds the messages to the same handler the
   local stream feeds, so the live 3D view, the early result and the final comparison all work unchanged.
   Cancel is `POST /api/race/<raceId>/cancel`; the function checks for it every few seconds.

Under `next dev` nothing changes: the race still streams and writes `runs/`.

### Keys stay on the server

- The keys are Netlify environment variables, read only by `lib/providers/env.ts`, only in the server handler and
  the background function. None is `NEXT_PUBLIC_`, so none can be compiled into a browser bundle.
- What reaches Blobs — and from there the browser — is the visitor's own request and `RaceMessage`s: the same
  leak-scanned beats and comparisons the local stream sends. Provider errors are redacted by the transport before
  they become messages, and an unexpected error is reported as "The race could not be run", never its text.
- `secrets.test.ts` now also treats `lib/race/hosted` as the race module: only the `app/api/` routes (and the
  background function, outside the swept app) may import it.

### Limits — every race spends the owner's quota

| Limit | Value | Why |
|---|---|---|
| Models | **Free only** | A visitor never spends credit; paid Claude is dropped from the public catalogue and refused if requested by hand |
| Silent repeats | **At most 1** | Each repeat is another full race of calls |
| Concurrency | **One race at a time, site-wide** | Two races on one free key trip the limits for both; a shared lock in Blobs (compare-and-set on its ETag) |
| Per visitor | **3 races per clock hour** | Counted by a salted, day-rotating SHA-256 of the visitor's IP; no IP is stored |
| Site-wide | **40 races per UTC day** | A hard ceiling on what strangers can spend |

A lock is released when its race finishes, and treated as abandoned if its job was never claimed (90 s), its log
stopped moving (5 min), or it is older than the 15-minute function limit. The values are in `PUBLIC_LIMITS`
(`lib/race/hosted.ts`).

### Not offered publicly

Saving and publishing. A public race is watched, not saved: there is no `runs/` folder on a function, and
publishing to `/run/<id>` stays the owner's deliberate CLI step. Forcing a fresh model listing (`?refresh=1`) is
ignored on the public site, since each listing is a provider call.

## Setup (Netlify → Project configuration → Environment variables)

`GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (any that are set are offered) and `PUBLIC_RACE=1`, then
redeploy. Leave `ENABLE_LOCAL_RACE` unset. To close the race again, remove `PUBLIC_RACE` and redeploy: `/race` and
the API routes 404 as before.
