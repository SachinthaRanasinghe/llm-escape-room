# Architecture — LLM Escape Room

**Status:** Decided · **Date:** 2026-09-22 · **Author:** Sachintha Ranasinghe
**Companion to:** [`llm-escape-room.prd.md`](./llm-escape-room.prd.md) — that document owns *what* and *why*; this one owns *how we approach it*.
**Scope:** high-level approach, stack, data shape, boundaries and risks. Not a task plan — per-ticket plans come later.

---

## Problem & goals

The PRD's bet is that a duel between two models is worth *watching* — that legibility, not data, is the missing
thing. Every decision below is judged against three constraints that follow from that: a run has to be **fair**
enough that its result is arguable, **cheap** enough to fit free-tier quota so it can be re-run on every model
release, and **watchable** in 60–90 seconds by someone scrolling a feed.

The leading indicator is divergence. If two models don't behave differently in these rooms, no amount of
rendering saves it. So the architecture is arranged to let us learn that as early and as cheaply as possible.

## Approaches considered

**A. Deterministic simulator, models as players.** The room compiles to a state machine; models act through a
fixed vocabulary; every outcome resolves in code and lands in an append-only log. Fair by construction,
machine-checkable, and free to replay. Cost: a small game engine exists before anything is watchable.

**B. LLM-adjudicated narrative room.** A narrator model decides whether each action worked. Fastest to a demo and
rooms can be arbitrarily rich. Rejected: the adjudicator becomes a hidden third variable, results stop being
verifiable, and the PRD's fairness claim collapses with them.

**C. Deterministic core with LLM flavour at runtime.** State machine owns outcomes, a model writes the prose.
Keeps fairness, buys richness. Rejected for the MVP as an extra per-run generation pass against the quota we are
trying to protect — the same richness is bought once, at generation time, in the chosen approach.

**Recommended and chosen: A.**

## Recommended approach

A run is a **pipeline that ends in a static artifact**, not a service.

A generation model proposes a room spec. A deterministic solver accepts or rejects it — proving it is solvable,
uniquely answerable, and inside the difficulty band — and regenerates until one passes. The accepted spec
compiles into a simulator that is the sole authority on room state.

Two competitors then play that same room through one normalised action vocabulary, compiled down to each
provider's native tool-calling. Every action carries a required one-line **intent** the model writes itself.
The simulator returns a verdict; the harness appends a semantic event. Nothing else writes to the log.

When both runs finish, the harness emits the published artifact: the event log, a frozen render manifest, and a
comparison summary. A static Next.js page loads that artifact and plays it as a side-by-side 3D scene in React
Three Fiber, on a fixed beat per action with each model's real think-time shown as a stat. The replay never talks
to a provider, which is what makes viewing cost nothing.

Runs are seeded, so `(seed, spec version, competitor set)` reproduces a room exactly — the models, not the room,
supply the nondeterminism.

## Key decisions

### Stack & libraries

All TypeScript, matching the setup already in muscle memory from `ai-job-application-agent`: **Next.js + React**,
**Zod** for every schema boundary, **tsx** CLI scripts for the harness, **vitest** for tests, **pnpm**. The
replay renders with **React Three Fiber** over three.js. Alternatives weighed: a Python harness with a TS renderer
(better eval ergonomics for the spike, rejected as two toolchains for a solo project), and plain Vite without
Next (leaner, rejected because the existing conventions are worth more than the framework is heavy).

There is no server, no database and no auth in the MVP. Next is used for its static output and its conventions,
not as a backend.

### Data model

- **RoomSpec** — seed, spec version, theme, objects, and a chain of ~3 puzzles where each answer unlocks the
  object holding the next clue. Includes the solution graph the solver proved.
- **ActionVocabulary** — one Zod schema, compiled per provider into native tool specs. The fairness seam.
- **Competitor** — provider, model id, sampling params.
- **Run** — run id, room spec reference, competitors, budget, outcome.
- **Event** — append-only, one per attempted action: sequence, competitor, action and arguments, declared
  intent, simulator verdict, real latency, tokens. Semantic, not render state.
- **RenderManifest** — a frozen snapshot per published run: renderer version, assets, camera plan, beat timing.
  The log stays the source of truth and can be re-rendered; the manifest guarantees a published run never changes
  under a viewer's feet.
- **RunSummary** — per competitor: escaped, escape time, actions, puzzles solved, failed attempts, invalid
  actions, tokens, cost, plus whether the published run was typical of its silent repeats.

Storage is files, not a database: accepted specs, logs, manifests and summaries as versioned JSON artifacts
served statically. A database is a later problem, and a reversible one.

### Boundaries & contracts

- **Simulator ↔ models.** The only channel. Models never see room internals, only what the simulator returns.
- **Provider adapters.** Groq, Gemini and OpenRouter behind one interface; the normalised vocabulary compiles to
  each (OpenRouter shares Groq's dialect byte for byte). An equivalence check proves the compiled tool specs are
  genuinely the same task before any result is published.
- **Invalid actions.** The simulator returns a clear error and the attempt consumes a turn. Using the interface
  correctly is part of the task; the count is published as a metric, not hidden.
- **Run budget.** Every run is capped on actions, tokens and wall clock. Exhausting the budget is a recorded
  failure to escape, not a crash.
- **Secrets.** Provider keys live in the harness environment only. The published artifact is pure data and ships
  no key, no endpoint and no inference path.
- **Replay ↔ artifact.** One-way. The player reads the artifact; it cannot reach a provider even in principle.
  The published page sends four anonymous watch-through events to one telemetry host, and nothing else leaves it
  (`docs/decisions/telemetry.md`).
- **Local race page.** The one exception to "no server", and local by construction: `/race` and its two route
  handlers run the harness on the owner's keys under `next dev`, and 404 in a production build unless
  `ENABLE_LOCAL_RACE=1`. Only free models from the live catalogue can be raced. The published `/run/<id>` path is
  unchanged (`docs/decisions/local-race.md`).

### Other calls

- **First matchup: two models on a single free provider**, holding serving stack and tool-calling
  implementation constant so the model is the only variable. Cross-lab matchups are the better story and come
  after the claim is clean.
- **Publication unit: one hero run plus silent repeats.** The shareable URL is a single run; the same room is
  replayed headless a few times and the comparison states whether the published outcome was typical. Honest
  about variance without asking anyone to watch four runs.
- **Video export is a second reader of the same log**, not a second pipeline. Deferred, but the log and manifest
  are designed so it never requires a re-run.
- **Puzzle substrate is deliberately undecided** — symbolic, spatial, or mixed. It is the make-or-break unknown
  and goes to a spike rather than a guess.

## Missing pieces

- **The solver/verifier.** Gates the generator; nothing ships before it.
- **The simulator and action vocabulary.** The engine itself.
- **RoomSpec v1 and Event log v1.** Both are one-way doors flagged in the PRD's door check.
- **The tool-spec equivalence check.** Without it the fairness claim is an assertion.
- **The R3F replay player** — scene, character rig, beat scheduler, intent display, think-time stat.
- **The render manifest freeze step.**
- **Watch-through telemetry.** ~~The PRD's first success metric currently has nowhere to land.~~ Decided: Umami
  Cloud. See `docs/decisions/telemetry.md` (TICKET-11).
- **The video export path.** Deferred, but named so it stays deferred rather than forgotten.

## Spikes & experiments

**1. Generator + solver — which puzzle kind separates models.** *The make-or-break one.*
- **Question:** can generated puzzles be machine-checkable, hard enough to separate two frontier models, and
  solvable inside a 90-second run?
- **Spike:** a throwaway generator emitting symbolic, spatial and mixed chains; solver verifies each; run both
  candidate models across ~20 instances, headless, no rendering.
- **Decision rule:** adopt the kind that diverges on ≥60% of instances while both models stay inside the action
  budget. If no kind clears it, the generator must target difficulty near the models' ceiling before anything
  else is built — and if that still fails, the format itself is in question and the PRD's format-failure branch
  has fired.

**2. Free-tier quota — does a full matchup fit.**
- **Question:** does one hero run plus silent repeats, plus rejected generation candidates, fit inside free-tier
  quota?
- **Spike:** instrument the spike-1 harness for calls and tokens; extrapolate to a full publishable matchup.
- **Decision rule:** if it fits, proceed. If not, cut in this order — repeat count, then generation retries via a
  cheaper reject-and-repair loop, then puzzle chain length. The 60–90 second watch target is cut last.

**3. Reasoning readability at beat pace.** Cheap, no quota.
- **Question:** is a one-line intent legible at the beat rate a 60–90 second run implies?
- **Spike:** feed a synthetic log to a rough player and watch it.
- **Decision rule:** if it doesn't read, the fix is beat timing and typography — not summarising the model, which
  the PRD names as a misrepresentation risk.

Run 1 and 2 together; they share a harness. Run 3 in parallel, since it needs no models at all.

## Open questions

- **Which exact two models.** Settled by the quota spike and by which pairing actually diverges.
- **Does divergence need engineering?** If models rarely diverge naturally, the generator has to target
  difficulty near their ceiling. Spike 1 answers whether this is needed.
- **Is "freshly generated" genuinely contamination-proof?** Unproven. Structural-similarity comparison across
  generated rooms would settle it; not gating the MVP.
- **Watch-through telemetry.** ~~Needs a home before the first public run; deliberately unchosen here.~~ Decided:
  Umami Cloud. See `docs/decisions/telemetry.md`.
- **When video export lands.** After the first public run tells us whether a link is enough for a feed.
- **Does the interface framing still bias results** even with equivalent compiled tool specs? The equivalence
  check constrains it; only running both interfaces would prove it, and that was rejected on quota.
