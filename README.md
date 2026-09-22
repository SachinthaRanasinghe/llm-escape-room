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

Pre-implementation. The product intent is written; no engineering decisions have been made yet.

- [`llm-escape-room.prd.md`](./llm-escape-room.prd.md) — problem, hypothesis, MVP scope, success
  metrics, non-goals and open questions.

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
