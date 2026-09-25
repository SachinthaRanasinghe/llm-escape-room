/**
 * Publish a finished run as a frozen artifact — TICKET-9 (#9).
 *
 * Run with:
 *   node --import tsx scripts/publish.mts --run runs/<runId> --room <path> [--id <slug>] [--out published] [--force]
 *   node --import tsx scripts/publish.mts --canonical [--out published] [--force]
 *
 * Reads `<run>/run.json` and `<run>/events.json` (what `scripts/run.mts` writes)
 * plus the room they were played in — `run.json` records the room's id, not its
 * path, so the room is named explicitly and checked against it. Writes
 * `<out>/<id>.json`: log + run record + a render manifest that freezes the
 * CURRENT renderer. `/run/<id>` plays it after the next build.
 *
 * `--canonical` publishes the golden fixtures with the fixtures' own timestamp,
 * so the committed `published/canonical.json` is reproducible.
 *
 * ── Published means frozen ─────────────────────────────────────────────────
 * An existing artifact is never overwritten without `--force`. Re-publishing
 * re-freezes it with today's renderer and changes a URL someone may already
 * have shared — exactly what the manifest exists to prevent.
 *
 * No network, no environment, no provider: this reads files the harness already
 * wrote. Prints ids and counts only — never an intent, never the room.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '../fixtures';
import {
  ARTIFACT_ID,
  ArtifactError,
  buildArtifact,
  CANONICAL_PUBLISHED_AT,
  type BuildArtifactInput,
} from '../lib/artifact';
import { CURRENT_RENDERER, ReplayError } from '../lib/replay';
import { parseEventLog } from '../lib/schema/event';
import { parseRoomSpec } from '../lib/schema/room';
import { parseRun } from '../lib/schema/run';
import { SchemaError } from '../lib/schema/version';

const USAGE =
  'usage: node --import tsx scripts/publish.mts --run runs/<runId> --room <path> [--id <slug>] [--out published] [--force]\n' +
  '       node --import tsx scripts/publish.mts --canonical [--out published] [--force]';

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    options: {
      run: { type: 'string' },
      room: { type: 'string' },
      id: { type: 'string' },
      out: { type: 'string', default: 'published' },
      canonical: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  });
} catch (error) {
  fail(`${(error as Error).message}\n${USAGE}`, 2);
}
const { values } = parsed;

/** `run-canonical-study-2026-09-24T10-00-00-000Z` → a URL-safe, lowercase slug. */
function slug(runId: string): string {
  return runId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '');
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function inputFromRun(runDir: string, roomPath: string): BuildArtifactInput {
  if (!existsSync(join(runDir, 'run.json'))) {
    const partial = existsSync(join(runDir, 'events.partial.json'));
    fail(
      partial
        ? `${runDir} holds only events.partial.json — the run did not finish; nothing to publish`
        : `${runDir} has no run.json`,
      1,
    );
  }
  const run = parseRun(readJson(join(runDir, 'run.json')));
  const log = parseEventLog(readJson(join(runDir, 'events.json')));
  const room = parseRoomSpec(readJson(roomPath));
  const id = values.id ?? slug(run.runId);
  return { id, run, log, room, renderer: CURRENT_RENDERER, publishedAt: new Date().toISOString() };
}

let input: BuildArtifactInput;
try {
  if (values.canonical) {
    if (values.run !== undefined || values.room !== undefined) fail(`--canonical takes no --run or --room\n${USAGE}`, 2);
    input = {
      id: values.id ?? 'canonical',
      run: loadCanonicalRun(),
      log: loadCanonicalLog(),
      room: loadCanonicalRoom(),
      renderer: CURRENT_RENDERER,
      publishedAt: CANONICAL_PUBLISHED_AT,
    };
  } else {
    if (values.run === undefined || values.room === undefined) fail(`--run and --room are both required\n${USAGE}`, 2);
    input = inputFromRun(values.run, values.room);
  }
} catch (error) {
  if (error instanceof SchemaError || error instanceof SyntaxError) fail(error.message.split('\n')[0]!, 1);
  throw error;
}

if (!ARTIFACT_ID.test(input.id)) fail(`--id "${input.id}" is not a lowercase slug (${ARTIFACT_ID})\n${USAGE}`, 2);

const path = join(values.out!, `${input.id}.json`);
if (existsSync(path) && !values.force) {
  fail(`${path} is already published; a published run is frozen — pass --force only if no one has the URL yet`, 1);
}

try {
  const artifact = buildArtifact(input);
  mkdirSync(values.out!, { recursive: true });
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    `published ${artifact.id}  renderer ${artifact.manifest.rendererVersion}  ` +
      `${artifact.log.length} events  ${artifact.manifest.beatPlan.totalMs} ms  → ${relative(process.cwd(), path)}`,
  );
} catch (error) {
  if (error instanceof ArtifactError || error instanceof ReplayError || error instanceof SchemaError) {
    fail(`nothing published: ${error.message}`, 1);
  }
  throw error;
}
