# AI Escape Room — PRD

**Status:** Draft · **Date:** 2026-09-22 · **Author:** Sachintha Ranasinghe
**Type:** Product intent. Contains no engineering decisions — those belong to the architecture spec (`plan-architecture`).

---

## 1. Problem Statement

People who follow model releases have no way to *see* how a model actually behaves when it has to reason across a sequence of dependent steps. They get a leaderboard number, or an argument on X. Neither shows them anything.

The gap is legibility, not data. A score of 0.71 on a static benchmark tells you nothing about where the model broke, and it can't be trusted anyway — the test set may already be in the training data. Meanwhile the moment everyone actually wants to watch, one model solving what another can't, happens invisibly inside an API call.

**Cost of not solving it:** the conversation about model capability stays anecdotal and unfalsifiable. Nothing changes if this isn't built; there is no bleeding user. This is an opportunity, not a wound — and the PRD is written honestly on that basis.

## 2. Evidence

| Claim | Status |
|---|---|
| Static benchmark scores don't predict multi-step agent behavior | **Assumption (widely held)** — validate by running the room and checking whether ranking differs from public leaderboard ranking |
| Builder currently evaluates models by ad-hoc manual prompting | **Observed** — stated directly by the primary user (who is the builder) |
| Models are only now reliably capable of sustained multi-step tool-use loops | **Assumption** — validate in the first spike; if models can't sustain a chained room, the product has no substrate |
| People will watch two models compete and share it | **Unvalidated — the core bet.** No prior evidence collected. This is what the MVP exists to test |
| Freshly generated rooms resist contamination | **Assumption** — plausible but unproven; generated puzzles may still be structurally memorized |

> No user research, competitor teardown, or analytics informed this document. Every row above marked *Assumption* is a guess until a run produces data.

## 3. Thesis — why build this

**The watchable part is the product.** Not a leaderboard with a 3D skin — a duel you can actually witness, where a model's reasoning appears next to its character as it acts, so a viewer can point at the exact moment one model lost the thread and the other didn't.

Three things make this the right thing to build now:

1. **Models finally sustain the loop.** A chained escape room was not a meaningful test two years ago because models collapsed before puzzle two. Now the interesting question has moved from *can it* to *how does it* — and nothing renders that.
2. **Fresh generation is the only honest format left.** Every static benchmark is contaminated or heading there. A room generated per-run can't be memorized, which is what makes a result worth arguing about.
3. **Legibility is the unmet need.** Existing evals produce tables. This produces a 90-second thing you can send someone, where the evidence is visible rather than cited.

**Why it beats the cope:** the builder's current method is throwing prompts at two models and eyeballing the difference — unsystematic, incomparable between runs, and impossible to show anyone. This gives the same curiosity a fair, identical, repeatable arena and an artifact at the end.

**The honest risk in the thesis:** the entertainment value depends entirely on the two models *diverging*. If both escape cleanly, or both stall immediately, there is no drama and no share — no matter how well the system works.

## 4. Hypothesis

> **We believe** that watching two LLMs race through an identical, freshly generated escape room — as characters in a 3D world, with each model's reasoning surfaced as it acts — **will cause** people who follow model releases **to** watch a run end to end and share it, **resulting in** unprompted external pull: requests for specific matchups and people running their own.
>
> **We'll know we're RIGHT if**, within two weeks of the first public run: viewers watch past the 30-second mark at a meaningful rate, the run draws unprompted "run X vs Y next" replies, **and** the builder re-runs it on the next model release without external prompting.
>
> **We'll know we're WRONG if** viewers drop inside the first 30 seconds; **or** runs aren't interesting — both models solve everything cleanly, both fail at the first puzzle, or generated rooms feel repetitive despite being new; **or** a run costs more than free-tier quota allows, making repeat runs impossible.

The wrong condition has two independent halves: **nobody watches** (demand failure) and **nothing interesting happens** (format failure). They need different fixes, so they're tracked separately.

## 5. Target User & JTBD

**Primary user: the builder (solo).** Building for himself first — he is the user, so the bet can be proven or killed on himself in weeks rather than validated with strangers.

**Secondary (the audience the share lands on):** developers and AI-curious people who follow model releases and already argue about which model is smarter.

**Job to be done:**
> *When a new model drops, or I'm curious whether one model is genuinely sharper than another, I want to watch them go head-to-head in a fair fight I can see, so I can form — and show someone — an opinion grounded in something more than vibes.*

**Non-users (explicitly not for):**
- **Non-agentic model comparison** — not for writing quality, chat, knowledge, creativity, or tone. Strictly multi-step reasoning under a chained task.
- **Academic eval researchers** — no claim to statistical rigor, reproducibility guarantees, or peer-review methodology.
- **Enterprise model procurement** — no accounts, SLAs, or compliance reporting.
- **Human players** — the rooms are not playable by people.

**Constraints:**
- **Near-zero running cost is hard.** A run must complete within free-tier provider quota. This caps model calls per run and rules out live per-viewer inference. *(Which providers → architecture decision.)*
- **Watch length target: 60–90 seconds** — built for a feed, not a second monitor.
- **The 3D environment ships in the MVP**, not after. A text log cannot test whether people want to watch.

## 6. MVP — the thinnest line that proves the bet

A single shareable run, end to end:

1. **One room archetype**, generated fresh per run: a short chain of ~3 puzzles where each answer unlocks the object holding the next clue.
2. **Two models**, same generated room, same starting information, same action vocabulary.
3. **A 3D side-by-side view** where each model is a character that moves and interacts, with its reasoning surfaced alongside as it acts.
4. **The run is recorded, not streamed** — it replays deterministically from its event log, so viewers cost nothing and the result is a URL.
5. **A post-run comparison** of how each model performed.

**Measurement in the MVP** is limited to what's visible and cheap: escape time, actions taken, puzzles solved, failed attempts, invalid actions, tokens and cost. **Deferred:** hints, injected unexpected events / adaptability scoring, tool-call analytics, accuracy grading. The original concept listed all of these; MVP keeps only the ones a viewer can see on screen.

**Explicitly not in the MVP:** tournaments, difficulty tiers, more than two models, multiple room archetypes, a hint system, adaptive mid-run events, accounts.

**Door check** *(feeds the spike-vs-build call in the architecture stage)*
- **One-way doors — spike before committing:** the puzzle/room generation schema (everything downstream depends on its shape), and the recorded event format the replay renders from. Both are expensive to change once runs exist.
- **Two-way doors — just build:** model/provider choice, visual styling, the comparison layout, room theming.

## 7. Success Metrics

| Metric | Target | How measured |
|---|---|---|
| **Watch-through** — viewers reaching the end of a run | ≥ 50% of opens | Replay player telemetry |
| **Unprompted matchup requests** — people asking for specific models | ≥ 5 within 2 weeks of first public run | Replies/messages on the posted run |
| **Divergence rate** — runs where the two models' outcomes differ meaningfully (one fails, or escape times differ by >25%) | ≥ 60% of runs | Run records |
| **Room variety** — runs whose puzzle chain structure differs from the previous run | ≥ 90% | Generator output comparison |
| **Builder re-run** — a run started within 7 days of a new model release, unprompted | Happens at least twice | Run history |
| **Cost per run** (guardrail) | Within free-tier quota; $0 marginal | Provider usage |
| **Run watch length** (guardrail) | 60–90 seconds | Replay duration |

Divergence rate is the one to watch first — it is the leading indicator of whether the format is entertaining at all, and it's measurable before anyone else sees the thing.

## 8. Non-goals

- Not a human-playable game.
- Not a general model benchmark — no claims outside chained multi-step reasoning.
- Not a rigorous academic eval; no statistical significance claims from single runs.
- Not live inference per viewer.
- No tournaments, ELO, difficulty tiers, or multi-provider matrices in v1 — all post-validation.
- No model fine-tuning, training, or prompt optimization for competitors.
- Not a procurement or vendor-comparison tool.

## 9. Open Questions

- [ ] **Can a generator produce puzzles with machine-checkable answers that are hard enough to separate two frontier models, yet solvable inside a 90-second run?** This is the make-or-break unknown. — *TBD, needs a spike.*
- [ ] **Does free-tier quota actually permit a full two-model run?** If a chained room needs more calls than the quota allows, either the format or the cost constraint has to give. — *TBD, needs validation.*
- [ ] **Is surfaced reasoning readable at 60–90 seconds?** Models produce far more text than fits; what gets shown, and does condensing it misrepresent the model? — *TBD.*
- [ ] **How many runs before a result means anything?** Models are nondeterministic; an identical room does not guarantee a fair single-run comparison. — *TBD, needs validation.*
- [ ] **Does prompt/tool-interface framing bias the outcome toward one model?** Identical rooms aren't identical conditions if one model's format suits the harness better. — *TBD.*
- [ ] **Is "freshly generated" genuinely contamination-proof**, or do generated puzzles collapse into memorized structures? — *TBD.*
- [ ] **Does divergence need engineering?** If models rarely diverge naturally, does the generator need to deliberately target difficulty near the models' ceiling? — *TBD.*
- [ ] **Which two models for the first public matchup, and who decides fairness of the pairing?** — *TBD.*
