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
vocabulary, the solver certifies a room before it is ever run, and the provider adapters hand both
models provably the same task. The replay player is the remaining wave-2 work and can be built
against the fixtures.

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
