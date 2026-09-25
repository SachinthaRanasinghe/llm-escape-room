# Published runs

Each `<id>.json` here is one **frozen, published run** — the thing a `/run/<id>` URL plays. TICKET-9 (#9).

- **Written only by `scripts/publish.mts`. Never hand-edit.** The loader re-derives the beat plan from the frozen
  timing and refuses a file where they disagree, so an edit fails the build.
- **Frozen means frozen.** Each file carries its own render manifest (timing, camera, colours, proportions, layout),
  so it replays identically however the renderer changes. Overwriting one changes a URL someone may already have
  shared, which is why the script demands `--force`.
- **No room, no secret.** A file holds the event log, the run record, the public scene layout and the
  `repeats` block — never a `RoomSpec`, never a key or endpoint. `lib/artifact/canonical.test.ts` and `lib/providers/secrets.test.ts` scan
  every file here.
- **Repeats are counts.** `repeats` holds how many silent repeats finished, how many dropped, and how their
  outcomes tallied — never a repeat's log, and never why one dropped (that is provider text). The script reads
  `<run>/matchup.json` and `<run>/repeats/*.run.json` when present. A tally that contradicts
  `run.typicalOfRepeats` is refused at publish and at build (TICKET-10, #10).
- **Never name a file `*.run.json`** — `.gitignore` drops that pattern.
- **Schema bumps migrate these too.** When TICKET-7 (#8) promotes the log and room schemas to v1, these files move
  with `fixtures/` (`lib/schema/migrations/README.md`).

`canonical.json` is the golden fixture run, regenerated with `node --import tsx scripts/publish.mts --canonical --force`
only when the fixtures themselves change.
