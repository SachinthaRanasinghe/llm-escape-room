# llm-escape-room

Two LLMs race to escape identical, freshly generated escape rooms, and you watch them do it.

Each run generates a new room with a chain of puzzles, where solving one puzzle yields the key,
code or clue that unlocks the object holding the next. Both models get the same generated room,
the same starting information and the same action vocabulary. The run is recorded and replays in
the browser as a side-by-side 3D scene, with each model represented by a character that moves and
interacts, and its reasoning surfaced alongside as it acts.

Rooms are generated per run so the puzzle set, the chain order and the escape path differ every
time, which keeps results from being memorized between runs.

## Status

In build. The v0 contracts and the fixture corpus exist, the simulator resolves every action in the
vocabulary, the solver certifies a room before it is ever run, the provider adapters hand both
models provably the same task, the generator writes fresh rooms that the solver has certified, and
the harness races two models through one of them and writes the event log. The replay player plays
the golden fixture log at `/replay`, and a finished run can be published as a frozen artifact that
plays at `/run/<id>`, ends in a post-run comparison, and reports anonymous watch-through telemetry. Locally,
`/race` races any two free models picked in the browser.

- [`llm-escape-room.prd.md`](./llm-escape-room.prd.md) — problem, hypothesis, MVP scope, success
  metrics, non-goals and open questions.
- [`architecture.md`](./architecture.md) — the approach, stack, data shape, boundaries, and the
  spikes that gate the build.
- [`docs/tickets/llm-escape-room.md`](./docs/tickets/llm-escape-room.md) — the work sliced into
  tickets and waves, mapped to GitHub issues.

## Contracts

`lib/schema/` holds the shapes everything else is built against — a room, an action, an event, a
run — and `fixtures/` holds committed examples of each: one canonical room, one complete event log
of two models diverging, and five rooms each broken in exactly one way.

The fixtures are the contract, not test data. They are what lets the simulator, the solver, the
provider adapters and the replay player be built at the same time without any of them waiting for
a backend to exist. Regenerate them with `node --import tsx scripts/generate-fixtures.mts` rather
than editing by hand, so a run's summary can never drift from the log it summarises.

`lib/solver/` is the gate in front of the generator. Given a room it proves five things before the
room can be used: that someone who starts knowing nothing can escape it, that every answer can be
read off its own clue, that no clue supports a second answer, that each answer genuinely unlocks the
holder of the next clue, and that the declared difficulty is honest. It proves solvability by playing
the room through the simulator itself, so a certified room is one the engine can really run. Rejection
comes back as a machine-readable code, because the generator regenerates in a loop and needs to know
which rule failed.

`lib/providers/` is the fairness seam. The one action vocabulary is compiled into Groq's and Gemini's
native tool-calling formats, and an equivalence test converts each compiled spec back into a neutral
form and proves both models get the same tools, the same words, the same constraints and the same
forced tool-calling mode, and that whatever either calls decodes to the same action. If either side
drifts, `pnpm test` fails. A model's malformed output is never an exception: it reaches the simulator
and costs a turn. Keys are read only in `lib/providers/env.ts`, from `GROQ_API_KEY` and
`GEMINI_API_KEY` (see `.env.example`). To make one live call per provider, run
`node --env-file-if-exists=.env --import tsx scripts/smoke-providers.mts`.

`lib/generator/` is where rooms come from. A model proposes a room as JSON, the proposal is narrowed
into a strict `RoomSpec`, and the solver certifies it or says which rules it broke. Those reasons go
into the next attempt's prompt, up to a retry cap. Every attempt is counted, including the rejected
ones, because they spend quota too. The record keeps rejection codes, tokens and real provider calls,
but never an answer. Each accepted room carries a structural fingerprint that ignores its wording, so
the variety metric compares puzzle skeletons, not prose. What kind of puzzle to ask for is a
strategy selected by name. `symbolic` (digit codes, then one word from a closed list) ships now, and
the gate spike adds the others. To generate one room from a live model, run
`node --env-file-if-exists=.env --import tsx scripts/generate-room.mts --seed <seed>`. It writes the
room and its attempt record under `runs/rooms/`.

`lib/harness/` runs the duel. Both models race the same certified room at the same time, each
against its own simulator, so neither can walk through a door the other opened. Every action a model
attempts becomes one event in an append-only log, including malformed ones. A malformed turn still
costs a turn, so it is logged with what the model actually sent and never with an action or intent the
harness made up. The run record adds what the simulator cannot know: what the run cost. A matchup
is one published run plus silent repeats of the same room, and the record says whether the published
outcome was typical of them. If a provider fails during the published run, nothing is published; a
repeat whose provider fails is dropped. A contract test replays the golden log through the harness
and must reproduce the committed run exactly. To run a live matchup against the fixture room, run
`node --env-file-if-exists=.env --import tsx scripts/run.mts` (add `--room runs/rooms/<id>.json` for a
generated one). It writes the run, its log and its repeats under `runs/<runId>/`.

`lib/replay/` and `components/scene/` are the replay player. The server page reads the fixtures, projects
the room into a public layout (names, kinds and positions, never an answer), and hands the client only
that and the log, turned into one lane per model. Every action gets the same five-second beat, so a
typical run lasts 60 to 90 seconds. Each model's real think-time is shown as a stat and never changes
the pacing. The intent is quoted exactly as the model wrote it, never trimmed, cut or summarised. A
boundary test keeps the client side away from the fixtures, the room schema, the providers, the
network and any clock but the frame timestamp. To watch it, run `pnpm dev` and open `/replay`. To run
the browser test, run `pnpm e2e` (the first time, `pnpm exec playwright install chromium`).

`lib/artifact/` publishes a run. `node --import tsx scripts/publish.mts --run runs/<runId> --room <path>`
writes `published/<id>.json`: the event log, the run record, and a **render manifest** that freezes
everything about how the run looks — renderer version, beat timing and the computed beat plan, camera,
colours, stage proportions and the public room layout. `/run/<id>` is built from it at build time and
plays that frozen snapshot, so a published run replays identically however the renderer is retuned
afterwards; `/replay` stays the live preview of the current renderer. Published is frozen: the script
will not overwrite an artifact without `--force`. The artifact never holds the room spec, and tests
scan every committed artifact for anything shaped like a URL or a key, keep `lib/artifact` away from the
providers, and check in a browser that a published run requests nothing beyond its own origin.
`published/canonical.json` is the golden fixture run (`scripts/publish.mts --canonical`).

When a published run ends (or the viewer presses "Skip to results"), `/run/<id>` shows the **post-run
comparison**: escape time, actions, puzzles solved, failed attempts, invalid actions, tokens and cost per
model, the winner by fewest actions, and — as plain text, never a tooltip — whether the run was typical of
its silent repeats, with the counts, plus the nondeterminism limitation. The script counts the repeats
named in the run's `matchup.json` into the artifact's `repeats` block; build and load both refuse counts
that contradict the run's typicality verdict. `lib/comparison/` holds the one definition of "who won" and
"typical" that the harness and the page share.

A published run reports **watch-through telemetry** to Umami Cloud, the PRD's first success metric
(`docs/decisions/telemetry.md`). There are four anonymous events, each sent at most once per page load:
`run-open`, `run-t30` (30 seconds on the replay clock, so paused time does not count), `run-complete`
(playback reached its end) and `run-skip` ("Skip to results", never counted as complete). A beacon says
only the site id, the host, `/run/<id>` and the event name. There is no cookie and no visitor id, and
`/replay` sends nothing. Telemetry is on only when `UMAMI_WEBSITE_ID` is set for `next build`: set it in
the environment that builds the public site, not in a local `.env`. To read the funnel back against the
≥ 50% target, run `node --env-file-if-exists=.env --import tsx scripts/watch-through.mts` with
`UMAMI_API_KEY` set.

**Race any two free models from the browser.** Run `pnpm dev` and open `/race`. Pick two models, a room and
a number of silent repeats, and press Start. The models are listed live from Groq, Google Gemini and
OpenRouter, and only models that are free and can be forced to make a tool call are offered, so every model
plays by the same rules. Models a provider lists but that cannot play (retired, no free quota, a limit smaller
than one turn) are listed separately with the reason. A race makes live calls on the keys in `.env` and takes
a few minutes. Progress streams in as it runs, then the replay and comparison play on the same page. The run
is saved under `runs/<runId>/`, and the page shows the `scripts/publish.mts` command that turns it into a
`/run/<id>` URL. OpenRouter needs `OPENROUTER_API_KEY` (free); its models are listed even before the key is
set. The page and its API routes exist only under `next dev`. A production build returns 404 for them unless
`ENABLE_LOCAL_RACE=1`, so the public replay site never spends your keys (`docs/decisions/local-race.md`). From
the terminal, `scripts/run.mts --a <provider>:<model> --b <provider>:<model>` takes the same provider names.

**Race on the hosted site.** With `PUBLIC_RACE=1` and the provider keys set as Netlify environment variables, `/race`
is open to every visitor on the deployed site: free models only, at most one silent repeat, one race at a time,
3 races per visitor an hour and 40 a day. The race runs in a Netlify background function
(`netlify/functions/race-background.mts`) and the page follows it by polling, because a streamed response is cut off
after 60 seconds. Keys stay on the server; nothing is saved. See `docs/decisions/public-race.md`.

**Energy Cores — a three-model arena.** Open `/arena`, pick three models, and they fight over five Energy Cores: one
each to start, two in the centre. On its turn a model claims a centre core, steals one from a rival, or passes, but a
claim only works if it then answers a medium question correctly and a steal a hard one (math, code, algorithms, logic,
SQL, computer science). A player who loses its last core is out. Most cores after 10 rounds wins, and an equal count is
a tie. The questions come from a committed bank in `lib/arena/questions/` that grades by code. Its test runs every code
snippet and recomputes every answer it can. The engine in `lib/arena/` is the only judge, the three models get identical
tools (proven by the same equivalence test), and the page is gated, rate-limited and queued exactly like `/race`.
Each turn is one or two model calls, so a 10-round match can take up to 60. From the terminal:
`node --env-file-if-exists=.env --import tsx scripts/arena.mts --a <provider>:<model> --b … --c …`. See
`docs/decisions/arena.md`.

The schemas are **v0 and deliberately unpinned**: the room spec and the event log are one-way
doors, so they are promoted to v1 only once the gate spike has settled which puzzle substrate
actually separates two models. Expect exactly one migration.

## What the MVP covers

- One room archetype, generated fresh per run, with a chain of roughly three linked puzzles
- Two models running the same room under identical conditions
- A side-by-side 3D replay with per-model reasoning shown as each action happens
- Runs recorded as event logs and replayed deterministically from a URL, so viewing costs nothing
- Per-run measurement: escape time, actions taken, puzzles solved, failed attempts, invalid
  actions, tokens and cost
- A post-run comparison of how each model performed

Deferred until the MVP proves out: hints, injected mid-run events and adaptability scoring,
tool-call analytics, difficulty tiers, tournaments, and more than two models per run.

## Constraints

- A full two-model run must complete within free-tier provider quota
- Target watch length for a run is 60 to 90 seconds
- Replay is served from a recorded log; no per-viewer inference

## Open questions

Tracked in the PRD. The two that gate everything else: whether generated puzzles can be made hard
enough to separate two frontier models while still solvable inside a 90-second run, and whether a
full run fits inside free-tier quota.
