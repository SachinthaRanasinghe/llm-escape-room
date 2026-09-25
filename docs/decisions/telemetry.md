# Decision: watch-through telemetry

**Status:** Accepted · **Ticket:** TICKET-11 (#11) · **Decided:** 2026-09-25
**Plan:** [`.claude/plans/watch-through-telemetry.md`](../../.claude/plans/watch-through-telemetry.md)

## Context

The PRD's first success metric is **watch-through: ≥ 50% of opens** reach the end of a run. Its demand-failure
wrong-condition is **"viewers drop inside the first 30 seconds"**. Neither could be observed. `architecture.md` →
*Missing pieces* and *Open questions* left the telemetry home "deliberately unchosen".

Three constraints shape the choice. The MVP has **no server, no database and no auth**. The marginal cost must be
**$0**. And the published page is **one-way**: it cannot reach a provider, and until this ticket it requested
nothing beyond its own origin.

## Options weighed

| Option | For | Against |
|---|---|---|
| **Umami Cloud** | Free tier, cookie-free (no consent banner), custom events, any static host, readable API | A third-party host on the page |
| Vercel Web Analytics | Zero setup if hosted on Vercel | Locks in a host that isn't chosen yet; custom events likely need a paid plan, which clashes with $0 |
| GoatCounter | Free, cookie-free | No real custom events: each event becomes a fake page path |
| Own endpoint + KV | Everything on our own origin | Breaks "no server, no database" |

## Decision

**Umami Cloud, posting directly to `https://cloud.umami.is/api/send`, with no tracker script.** The page never
loads Umami's `script.js`, which would send referrer, screen, language and title unasked. Each beacon is built
field by field and carries exactly **`website`, `hostname`, `url`, `name`**. `url` is `/run/<id>`, built from the
run id, so no query string or fragment leaves the page. No cookie, no visitor id, no storage. Umami derives
country and browser server-side from the request, and drops bots (`isbot`), including headless browsers.

### Events

| Event | Fires when | Measures |
|---|---|---|
| `run-open` | the player mounts on `/run/<id>` | opens (the denominator) |
| `run-t30` | the **replay clock** reaches 30 000 ms. Paused time does not count | 30-second survival |
| `run-complete` | playback reaches its end on its own | watch-through |
| `run-skip` | "Skip to results" is pressed | reported alone. **Never** counted as complete |

Each fires **at most once per page load**, so a restart counts nothing again. A viewer who skips and then lets
the replay play on to the end sends both `run-skip` and `run-complete`: they did watch it through. `/replay`,
the live renderer preview, sends nothing.

### Boundaries that moved

- `lib/telemetry/config.ts` joins `lib/providers/env.ts` as the **only other** environment reader. It reads
  `UMAMI_WEBSITE_ID` at **build time** in the `/run/[id]` server page. That id is public, not a key. Unset turns
  telemetry off, and the page is exactly the pre-telemetry player. An invalid id fails the build.
- `components/scene` stays network-free and clock-free. It gains an `onProgress` callback only.
  `components/telemetry/TrackedReplay.tsx` is the only client code that sends anything.
- The published page may contact **one** foreign host, `cloud.umami.is`, and only as a POST to `/api/send`
  (`e2e/run.spec.ts`).
- The Umami **API key** is read only by `scripts/watch-through.mts`, on the harness side.

Enforced by `lib/telemetry/boundary.test.ts`, `lib/providers/secrets.test.ts`, `lib/replay/boundary.test.ts` and
`e2e/telemetry.spec.ts`.

### Known imprecision

- `run-t30` is reported at the first panel change at or after 30 s. That is less than one beat late, and
  immaterial for a survival metric.
- A viewer who closes the tab before 30 s, or before the end, simply never sends that event. That is exactly
  the drop the metric exists to see.
- Umami's `isbot` filtering and ad-blockers undercount all four events alike. The ratios hold better than the
  absolute counts.

## Consequences

- Turn it on by setting `UMAMI_WEBSITE_ID` in the environment that runs `next build` for the public site. **Not**
  in a local `.env`, or your own dev views are counted. Changing it needs a rebuild.
- Read it with `node --env-file-if-exists=.env --import tsx scripts/watch-through.mts [--id <runId>] [--since
  YYYY-MM-DD]`. It prints opens → t30 → complete, skips, and ✓/✗ against the 50% target.
- Swapping providers later touches `lib/telemetry/umami.ts`, `readout.ts` and the allowed host in the e2e spec.
  The tracker, the events and the player hook are provider-neutral.
