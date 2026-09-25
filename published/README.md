# Published runs

Each `<id>.json` here is one **frozen, published run** — the thing a `/run/<id>` URL plays. TICKET-9 (#9).

- **Written only by `scripts/publish.mts`. Never hand-edit.** The loader re-derives the beat plan from the frozen
  timing and refuses a file where they disagree, so an edit fails the build.
- **Frozen means frozen.** Each file carries its own render manifest (timing, camera, colours, proportions, layout),
  so it replays identically however the renderer changes. Overwriting one changes a URL someone may already have
  shared, which is why the script demands `--force`.
- **No room, no secret.** A file holds the event log, the run record and the public scene layout — never a
  `RoomSpec`, never a key or endpoint. `lib/artifact/canonical.test.ts` and `lib/providers/secrets.test.ts` scan
  every file here.
- **Never name a file `*.run.json`** — `.gitignore` drops that pattern.
- **Schema bumps migrate these too.** When TICKET-7 (#8) promotes the log and room schemas to v1, these files move
  with `fixtures/` (`lib/schema/migrations/README.md`).

`canonical.json` is the golden fixture run, regenerated with `node --import tsx scripts/publish.mts --canonical --force`
only when the fixtures themselves change.
