# Decision: replay beat timing and intent typography (spike 3)

**Status:** Draft. The mechanical checks pass. **The owner still has to watch the run.** · **Ticket:** TICKET-8 (#5) ·
**Started:** 2026-09-24
**Plan:** [`.claude/plans/replay-player-v0.md`](../../.claude/plans/replay-player-v0.md)

## Context

`architecture.md` → *Spikes & experiments · 3* asks whether a one-line intent is legible at the beat rate a 60–90
second run implies. The rule is fixed in advance. If it doesn't read, the fix is beat timing and typography, never
summarising the model. The PRD names summarising as a misrepresentation risk.

Two things make it harder than it sounds. There are **two** lanes of text on screen at once. The schema allows
intents of up to 280 characters, although the canonical log's range is 19–70.

## Method

| | |
|---|---|
| Log | TICKET-1's golden fixture: 27 events, model-a 13 (escapes), model-b 14 (runs out of actions) |
| Route | `/replay` (`pnpm dev`) |
| Browser | Chromium 153 (Playwright's headless shell, SwiftShader WebGL) at 1440×900 and 390×844 |
| Mechanical checks | `lib/replay/beats.test.ts` (the watch band and uniform beats), `timeline.test.ts` (every intent kept byte for byte), `e2e/replay.spec.ts` (the intents in the DOM, playback to the end, no horizontal scroll at 390 px) |
| Frames reviewed | Screenshots at t = 7.2 s, 44 s, 44.5 s and 79.5 s, taken under Playwright's fake clock |
| Human watch-through | **Pending.** See the checklist below |

## Starting values (`lib/replay/beats.ts`, `components/scene/replay.module.css`)

| Knob | Value | Why |
|---|---|---|
| `BEAT_MS` | 5000 | 14 actions (today's budget) × 5 s = 70 s of action |
| `INTRO_MS` / `OUTRO_MS` | 3000 / 4000 | Labels in before anyone moves. The end poses are held. |
| `LANE_OFFSET_MS` | 2500 (half a beat) | The two intents change **alternately**, one new line every 2.5 s rather than two every 5 s |
| `WALK` / `ACT` / `HOLD` | 30% / 25% / 45% of the beat | The intent shows at the start of the beat. The verdict lands at `hold` and stays for the remaining 2.25 s. |
| Total, canonical run | **79.5 s** | Inside 60–90. Quick escapes run shorter by design, because the beat never stretches. |
| Intent size | `clamp(1.125rem, 1rem + 0.6vw, 1.5rem)`, weight 500, line-height 1.35, max 36ch | About 22 px at 1440 px wide. The canonical intents fit on 1–2 lines. |
| Long intent (>140 chars) | one step down: `clamp(1rem, 0.92rem + 0.4vw, 1.25rem)` | It wraps and is never truncated. There's no `text-overflow` or line clamp anywhere. |
| `RENDERER_VERSION` | `replay-v0.1` | Bump on any change above |

## What the frames show (mechanical, not a verdict)

- At 1440 px, both intents fit comfortably. The longest canonical intent (70 chars) wraps to two lines. The panel
  keeps a fixed minimum height, so nothing jumps when the lines change.
- The half-beat offset works as intended in the frames. One panel shows a verdict while the other has a fresh
  intent.
- Model-b's `bookshelf` moment (seq 8, ≈ 45.5–50.5 s): the character walks to the room's centre and shrugs, and
  the panel reads *inspects bookshelf*, then *There is no bookshelf in this room.* in red. It's visible without the
  log.
- The end state: model-a has walked out through the open door and faded, and its panel reads *Escaped in 13
  actions*. Model-b stands at the opened cabinet, and its panel reads *Out of actions*.

## To confirm by watching (owner)

1. Can you read **both** intents fully before each changes, at desktop width and on a phone?
2. Do you know where each character is acting before its verdict lands?
3. Does the `bookshelf` moment read as "model-b lost the thread"?
4. Does 79.5 s feel like 60–90 s, or does it drag?
5. Does the half-beat offset read as "model-b is slower"? If it does, set `LANE_OFFSET_MS = 0` (the total becomes
   77 s) and re-check item 1.
6. **Worst case:** temporarily overwrite one beat's `intent` with 280 characters in `app/replay/page.tsx` after
   `buildReplay`, watch it, then revert. The expectation is that it wraps to about 5 lines at the smaller size. At
   a comfortable ~30 chars/s it needs ~9 s, which is more than a beat. That's a known limit (see Consequences).

## Decision

*Pending the watch-through.* If items 1–5 hold, the starting values above are adopted as-is. If they don't, tune
only the knobs in the table, re-run `pnpm test` (the band test fails if the total leaves 60–90 s), bump
`RENDERER_VERSION`, and record the new values here.

**Since TICKET-9 (#9):** a retune bumps `RENDERER_VERSION`'s **minor** and touches only the live renderer —
`/replay` and anything published afterwards. Runs already published carry their own frozen timing, camera and colours
in their render manifest and keep replaying exactly as they were published (`lib/replay/renderer.ts`). The intent
typography is still CSS, not frozen data: if spike 3 retunes it, move those sizes into the renderer snapshot first.

**2026-09-26 — `replay-v1.0` (major):** the scene and chrome were redrawn — a panelled room with a doorway cut
for the exit, detailed props, a jointed character with a visor and a walk cycle, soft shadows, and new
colours, walls (2.6) and camera in the snapshot. Beat timing and intent sizes did not change. Mesh changes are
code, so this is a major bump: `SUPPORTED_RENDERER_MAJORS` is `[1]`, and `published/canonical.json` was
re-frozen with `scripts/publish.mts --canonical --force`. Only its render manifest changed.

**2026-09-26 — in-world HUD (chrome only, no version bump):** the panels under the rooms are gone. Each lane is
now its room, and `components/scene/LaneHud.tsx` lays a HUD over it. The current turn is one card, pinned beside
the object being acted on with a leader line (`anchor.tsx` projects the target through the lane's camera). It
reads as three steps: the model **decides** (the intent, verbatim), **acts** (a plain-words action plus the
tool call), and the **room responds** (the verdict message, verbatim). Finished turns become one line each in
"Recent activity". The model's identity sits at a top corner and a labelled stats rail runs along the bottom.
The intent is still never truncated: the card wraps and grows. Nothing in the scene, the timing or the snapshot
changed, so published runs are unaffected.

**2026-09-26 — `replay-v2.0` (major): cinematic pass.** The room is lit like a set rather than evenly. The pendant is
a soft shadow-casting spot, making a warm pool that falls off into darker corners, with a faint haze cone. The sconces
wash the back wall. Baked gradients darken where walls meet the floor. The floor is varnished (clearcoat), the
wainscot is panelled, and the wallpaper darkens toward the ceiling. The canvas tone-maps with AgX (exposure 1.3)
instead of ACES, so warm highlights roll off instead of flattening to orange. The camera does an establishing sweep
over the intro, drifts slowly, and leans toward its character (`FOLLOW` in `RoomScene.tsx`). It is still a pure
function of the clock, and it holds the snapshot framing under reduced motion. The characters have clearcoat shells,
a glass visor, blinking eyes that narrow on a success and dim on a failure or when out of actions, a chest core that
quickens while acting, hip sway, a trailing antenna and a lane-coloured glow light. Props use wood-grain and
polished-steel materials. An open door throws a light shaft and lights the room. Each verdict sends a shockwave
across the floor in its tone, and a success throws sparks (`VerdictBurst`). A CSS vignette sits over each lane,
below the HUD. The snapshot's camera (4.5 / 5.6 high/back, fov 44, sway 0.3 over 25 s) and floor, wall and
background colours changed too. Beat timing and intent sizes did not. `SUPPORTED_RENDERER_MAJORS` is `[2]`, and
`published/canonical.json` was re-frozen. Only its render manifest changed. None of the new decor is nameable:
light, haze and trim only.

## Consequences

- **280-character intents don't fully read in one beat.** The schema allows them, but the canonical log never goes
  above 70. The fix, if real runs produce long intents, is typography (the size step) or a longer `BEAT_MS`. It's
  never truncation or a summary. Watch the spike's real logs for how long intents actually get.
- **The action budget and the band are coupled.** At 18 actions (if TICKET-7 retunes `maxActions`), 5 s beats give
  99.5 s and `beats.test.ts` fails. That's deliberate: retune `BEAT_MS` (e.g. 4 s → 83.5 s) instead of letting
  it drift.
- **Think-time includes provider queueing.** It's labelled "thought", as the PRD calls it. TICKET-10's comparison
  view should carry that caveat.
- **Playwright's fake clock drives the render loop (A-1 held).** `page.clock.install()` + `runFor` advances
  `requestAnimationFrame`, so the e2e test plays the full run to its end state in about a minute. One side effect
  is that `page.screenshot` advances the fake clock too. Frames captured for review can therefore be a fraction of
  a beat later than asked, and can catch the 180 ms fade-in at low opacity. DOM assertions are exact.
- **WebGL in headless Chromium works on SwiftShader (A-2 held)** with `--use-angle=swiftshader
  --enable-unsafe-swiftshader`.
- **One Canvas with two drei Views worked (the fallback of two Canvases wasn't needed).** The canvas sits above the
  lane columns with pointer events off and is transparent outside each tracked view.
