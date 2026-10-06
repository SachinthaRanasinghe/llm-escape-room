# Decision: Energy Cores, a three-model arena

**Status:** Accepted · **Decided:** 2026-10-06 · **Plan:** `.claude/plans/energy-cores-arena.md`

## Context

The escape room tests chained reasoning in isolation: each model plays alone, against its own simulator. It cannot show
models *interacting*: choosing whom to rob, reacting to being robbed, judging when a risky move is worth it. The ask
was a second game where three models compete in one shared arena, and where every gain has to be earned by solving a
hard question. That way the game tests knowledge, reasoning, strategy and adaptation together, not question-answering
alone.

## The game

Five Energy Cores. Each player starts with one, and two sit in the centre. Over up to 10 rounds, each player on its turn
does exactly one thing:

| Action | What it needs | If the answer is right | If it is wrong |
|---|---|---|---|
| `claim` | a **medium** question | a centre core moves to the player | the turn is wasted, nothing else |
| `steal` | a **hard** question | a core moves from the target to the player | the turn is wasted, nothing else |
| `pass` | — | — | — |

- **Order.** Round *r* plays A, B, C rotated left by *r − 1*: A starts round 1, B round 2, C round 3. Eliminated players are skipped.
- **Elimination.** A player who loses its last core is out for good.
- **End.** The match ends as soon as one player still holds cores, or after the last round, or at a 12-minute wall clock (under the 15-minute background-function limit).
- **Winner.** The player with the most cores wins. An equal top count is recorded as a **tie**. Accuracy and think-time are shown but never break a tie.
- **Invalid moves.** A malformed call, claiming from an empty centre, or stealing from yourself, an eliminated player or an unknown id costs the turn and is counted as invalid. Mistakes are scored the same way as in the room.

## Options weighed

| Question | Chosen | Rejected, and why |
|---|---|---|
| Where questions come from | **A committed bank** (`lib/arena/questions/bank.ts`), graded by code | Generated per match: fresher, but then a second model vouches for each answer, and a wrong "official" answer makes the result unfair. Also costs quota. |
| Turn structure | **Sequential**, with the starting player rotating each round | Simultaneous moves: fairer on order, but two claims on the last core need a tie-break rule nobody can see. |
| Calls per turn | **Two**: decide (offered only `claim`/`steal`/`pass`), then answer (offered only `answer`) | One call with the answer included: half the quota, but a model could answer before seeing the question, and "decide, then solve" would blur. |
| What models know of each other | **Anonymous ids** (`player-a/b/c`), the board, and each rival's action, question kind and result | Model names: a model could target an opponent by reputation rather than by the board. |
| View | **3D floating sky islands with a robot per model** (react-three-fiber, the escape room's robot rig and quality tiers) under a DOM HUD. Each player has a grassy island with a pad and flag. The reserve cores float over a stone shrine on the central island, and rope bridges link the islands so the robots walk across them. It is set at night: a starry sky with the Milky Way, moonlit clouds far below, distant islands with waterfalls, lanterns and fireflies (`SkyIslands.tsx`). Built for legibility: bright, cool moonlight with a rim light, glow only on small accents, and nothing in front of the play. `director.ts` turns playback beats into robot moves, and each turn is replayed beat by beat (`choreography.ts`, `usePlayback.ts`). `ArenaLab` owns one canvas that moves from the lobby preview into the match, so starting a match builds no second WebGL context. A software renderer gets islands, bridges, pads, robots and cores only. Reduced motion jumps straight to the latest turn. | A 2D canvas, a dark sci-fi hall, and daytime and night playgrounds: each replaced on feedback. The playgrounds were too busy, and the night one too bright to read. |

## How it is built

- **`lib/arena/`** is pure. The engine (`engine.ts`) is the only judge. It parses whatever a model sent, and anything that is not a valid call is a verdict, never an exception. `match.ts` drives three adapters it is handed. Each player keeps its own conversation and never sees another player's question. Answer keys never reach a model; `engine.test.ts` and `match.test.ts` check this. `boundary.test.ts` keeps env, network, clocks and unseeded randomness out.
- **Questions:** at least 5 per category per tier (math, code, algorithms, logic, SQL, CS), and at least 30 per tier, so a full match never repeats one. Each match draws from seeded, per-tier decks. `bank.test.ts` runs every JavaScript snippet and recomputes every computable answer, including the SQL ones with NULL semantics. The few that can only be reviewed by hand are listed in that file.
- **Same adapters, same fairness.** `TurnRequest.tools` lets a game send its own tool spec, built with `buildToolSpec` from the arena's Zod schemas. Without it, a request is still the escape room's. `equivalence.test.ts` proves both arena tool sets compile to the same task on Groq, Gemini and OpenRouter, with forced tool calls.
- **Server:** `lib/race/arena.ts` mirrors the race: it uses the live catalogue, `checkPicks`, the local one-at-a-time lock (shared, so a race and a match never run together), leak-scans every turn before it reaches the page, and writes `runs/<matchId>/arena.json` and `events.json` locally.
- **Hosted:** a match is a job on the race's queue (`lib/race/hosted.ts`) with `game: 'arena'`. It is run by the same background function and followed at `GET /api/arena/<id>`.

## Limits

The same as the race (`public-race.md`): **free models only** on the public site, **one race or match at a time**, and a
match counts as one race against the per-visitor and per-day caps. A full match can take up to 60 model calls
(3 players × 10 rounds × 2), about twice a race's. If quota bites, revisit `PUBLIC_LIMITS` before the rules. A
free OpenRouter key's 50 requests a day may not finish a match with three OpenRouter picks, and the page says so.

## Not offered

Publishing a match to a frozen URL, silent repeats, telemetry and replay of a saved match. A match is watched live.
