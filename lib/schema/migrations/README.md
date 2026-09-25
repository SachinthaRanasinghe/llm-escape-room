# Schema migrations

**Empty by design.** There is nothing to migrate yet, and writing a speculative
migration before the gate spike reports would be guessing at the shape it has to
produce.

## Why this directory exists now

`lib/schema/version.ts` pins `SPEC_VERSION` and `LOG_VERSION` at `0` and writes
them into every schema as a `z.literal`. That makes an unmigrated payload fail
loudly rather than half-parse — which is the right default, but it also means the
moment the gate ticket bumps a version, every committed fixture and every
published run becomes unreadable until something migrates it.

This directory is where that something lands, so TICKET-7 (#8) adds a migration
to an existing seam instead of inventing one under time pressure.

## What a migration module is expected to export

```ts
export const from = 0;
export const to = 1;
export function migrate(raw: unknown): unknown;
```

`migrate` takes a payload that parsed clean under `from` and returns one that
parses clean under `to`. It must be pure and total: given any valid v0 payload it
returns a valid v1 payload, and it never reaches the network or the filesystem.

## Scope when the time comes

Both the schemas **and** the committed fixtures in `fixtures/` have to move
together — the fixtures are the contract four other tickets build against, so a
migration that leaves them on v0 breaks the thing the fixtures exist to provide.

So do the published artifacts in `published/` (TICKET-9, #9). Each one embeds a
v0 run record and a v0 event log, and `/run/[id]` parses them at build time: a
bump that leaves them on v0 breaks every URL anyone has shared, at the next
build. Migrate their `run` and `log` in place; their render manifest does not
change. `lib/artifact/canonical.test.ts` fails until `published/canonical.json`
matches the migrated fixtures.
