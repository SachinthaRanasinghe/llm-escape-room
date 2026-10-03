import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';

import { loadCanonicalRoom } from '@/fixtures';
import { buildArtifact, comparisonFromArtifact, findLeaks, replayFromArtifact } from '@/lib/artifact';
import { buildEarlyComparison, buildStoppedComparison, type ComparisonData } from '@/lib/comparison';
import { CompetitorAbortedError, costOf, DEFAULT_BUDGET, DuelAbortedError, PRICING, runMatchup, type DuelResult, type PriceTable } from '@/lib/harness';
import {
  PROVIDER_KEY_VARS,
  ProviderError,
  createAdapter,
  hasProviderKey,
  isLocalRaceEnabled,
  isPublicRaceEnabled,
  listModels,
  readProviderKey,
  type ProviderAdapter,
} from '@/lib/providers';
import { beatFromEvent, buildSceneLayout, CURRENT_RENDERER } from '@/lib/replay';
import { parseRoomSpec, type RoomSpec } from '@/lib/schema/room';
import type { Event } from '@/lib/schema/event';
import { PROVIDERS, ProviderSchema, type Competitor, type EndReason, type Provider } from '@/lib/schema/run';
import { createSimulator, VERDICT_TALLY } from '@/lib/sim';
import { verifySpec } from '@/lib/solver';
import type { CatalogueEntry, CatalogueResponse, ModelPick, ProviderCatalogue, RaceMessage, RaceRequest, RoomOption } from './wire';

/**
 * The local race — pick two models in the browser, race them, watch it.
 *
 * `scripts/run.mts` with a web front: the same certified room, the same
 * `runMatchup`, the same adapters and budget, and the same files written under
 * `runs/<runId>/`. What it adds is the choice of models from the live catalogue
 * and a progress stream, and at the end it builds the artifact IN MEMORY — with
 * every check `scripts/publish.mts` runs, leak scan included — so the page can
 * play the run at once. Nothing is written to `published/`: publishing a run is
 * still a deliberate CLI step, and the `done` message carries the command.
 *
 * ── Harness side, in a web process ────────────────────────────────────────
 * This module holds the keys' call path, so it is imported only by the route
 * handlers under `app/api/` and the `/race` server page — `secrets.test.ts`
 * enforces that. It never reads the environment itself (`lib/providers/env.ts`
 * does), and it refuses to run at all in a production build unless the owner
 * opted in (`isLocalRaceEnabled`), so the public replay site cannot become an
 * endpoint that spends someone's quota.
 *
 * ── Only the catalogue can be raced ────────────────────────────────────────
 * A pick is checked against the live catalogue before a key is read. An
 * OpenRouter key with credit on it would happily run any paid model; the
 * catalogue offers free models plus Claude (`PAID_MODELS`), which has no free
 * tier, and a hand-crafted request cannot talk it into anything else. A paid
 * pick is costed at its live listed price, so its `costUsd` is what was spent.
 *
 * ── One race at a time ─────────────────────────────────────────────────────
 * Two concurrent races on one free-tier key double the request rate and trip the
 * limits for both. A second request is refused while one runs.
 */

export const MAX_REPEATS = 3;
/** One silent repeat, not the CLI's three: a free OpenRouter key allows 50 requests a day. */
export const DEFAULT_RACE_REPEATS = 1;
/** On the public site every repeat is the owner's quota spent by a stranger: one at most. */
export const PUBLIC_MAX_REPEATS = 1;

const PROVIDER_NAMES: Readonly<Record<Provider, string>> = {
  groq: 'Groq',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
};

export class RaceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

export function raceEnabled(): boolean {
  return isLocalRaceEnabled();
}

/**
 * Whether this deployment is the public, hosted race (`PUBLIC_RACE=1`): free
 * models only, at most one repeat, rate-limited, run in a background function
 * (`lib/race/hosted.ts`) and never written to disk.
 */
export function publicRace(): boolean {
  return isPublicRaceEnabled();
}

/** The public site races free models only — a stranger never spends the owner's credit. */
function forPublic(provider: ProviderCatalogue): ProviderCatalogue {
  return { ...provider, models: provider.models.filter((m) => m.price === null) };
}

/* ── Catalogue ──────────────────────────────────────────────────────────── */

const CATALOGUE_TTL_MS = 5 * 60_000;
let cached: { at: number; providers: readonly ProviderCatalogue[] } | null = null;

async function catalogueFor(provider: Provider): Promise<ProviderCatalogue> {
  const keySet = hasProviderKey(provider);
  const base = { provider, name: PROVIDER_NAMES[provider], keyVar: PROVIDER_KEY_VARS[provider], keySet };
  // OpenRouter lists publicly, so its models show before a key is set. The others need the key to list at all.
  if (!keySet && provider !== 'openrouter') return { ...base, models: [], excluded: [], error: null };
  try {
    const listing = await listModels(provider, keySet ? readProviderKey(provider) : null);
    return {
      ...base,
      models: listing.models.map(({ modelId, label, contextWindow, price }) => ({ modelId, label, contextWindow, price })),
      excluded: listing.excluded.map(({ modelId, reason }) => ({ modelId, reason })),
      error: null,
    };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    return { ...base, models: [], excluded: [], error: error.message };
  }
}

async function providerCatalogues(now: number, refresh: boolean): Promise<readonly ProviderCatalogue[]> {
  if (!refresh && cached !== null && now - cached.at < CATALOGUE_TTL_MS) return cached.providers;
  const providers = await Promise.all(PROVIDERS.map(catalogueFor));
  // A failed listing is not cached, so the next load tries again.
  if (providers.every((p) => p.error === null)) cached = { at: now, providers };
  return providers;
}

export async function getCatalogue(options: { refresh?: boolean } = {}): Promise<CatalogueResponse> {
  const hosted = publicRace();
  // A visitor cannot force a fresh listing on the public site: each one is a provider call on the owner's key.
  const providers = await providerCatalogues(Date.now(), hosted ? false : (options.refresh ?? false));
  return {
    // On the public site a provider without a key is simply not offered — there is no .env to point a visitor at.
    providers: hosted ? providers.filter((p) => p.keySet).map(forPublic) : providers,
    rooms: listRooms().map(({ id, label }) => ({ id, label })),
    maxRepeats: hosted ? PUBLIC_MAX_REPEATS : MAX_REPEATS,
    defaultRepeats: hosted ? Math.min(DEFAULT_RACE_REPEATS, PUBLIC_MAX_REPEATS) : DEFAULT_RACE_REPEATS,
    hosted,
  };
}

/* ── Rooms ──────────────────────────────────────────────────────────────── */

const CANONICAL_ROOM_PATH = 'fixtures/rooms/valid/canonical-room.json';
const GENERATED_ROOMS_DIR = join('runs', 'rooms');

interface RoomEntry extends RoomOption {
  readonly spec: RoomSpec;
  /** Relative to the repo root — what `scripts/publish.mts --room` takes. */
  readonly path: string;
}

/**
 * The canonical fixture room, plus every room `scripts/generate-room.mts` wrote
 * that still parses AND certifies. A room that fails either is left out rather
 * than offered and refused later.
 */
function listRooms(): RoomEntry[] {
  const canonical = loadCanonicalRoom();
  const rooms: RoomEntry[] = [
    { id: canonical.roomId, label: `${canonical.theme.name} (fixture)`, spec: canonical, path: CANONICAL_ROOM_PATH },
  ];
  const dir = join(process.cwd(), GENERATED_ROOMS_DIR);
  if (!existsSync(dir)) return rooms;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const spec = parseRoomSpec(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      if (!verifySpec(spec).ok || rooms.some((r) => r.id === spec.roomId)) continue;
      rooms.push({ id: spec.roomId, label: `${spec.theme.name} (generated)`, spec, path: join(GENERATED_ROOMS_DIR, name) });
    } catch {
      // Not a room — an attempt record, or a half-written file. Not offered.
    }
  }
  return rooms;
}

/* ── The request ────────────────────────────────────────────────────────── */

const PickSchema = z.strictObject({
  provider: ProviderSchema,
  modelId: z.string().min(1).max(200).regex(/^[\w.\-/:@]+$/),
});

const RaceRequestSchema = z.strictObject({
  a: PickSchema,
  b: PickSchema,
  roomId: z.string().min(1).max(200),
  repeats: z.number().int().min(0).max(MAX_REPEATS),
});

export function parseRaceRequest(raw: unknown): RaceRequest {
  const result = RaceRequestSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new RaceError(400, `invalid race request: ${issue?.path.join('.') || 'body'} ${issue?.message ?? ''}`.trim());
  }
  return result.data;
}

/* ── The race ───────────────────────────────────────────────────────────── */

let running = false;

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)
    .replace(/-$/, '');
}

function write(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Counts each competitor's calls for the progress stream, and turns a cancelled
 * race into the one failure the harness already handles: a provider that gave
 * up. The model is never called after a cancel; the duel aborts, and nothing is
 * shown or saved as if it had finished.
 */
function instrument(
  adapter: ProviderAdapter,
  competitorId: string,
  counts: Map<string, number>,
  emit: (message: RaceMessage) => void,
  signal: AbortSignal,
): ProviderAdapter {
  return {
    provider: adapter.provider,
    modelId: adapter.modelId,
    async act(request) {
      if (signal.aborted) throw new ProviderError(adapter.provider, null, 0, 'race cancelled');
      const turn = await adapter.act(request);
      const actions = (counts.get(competitorId) ?? 0) + 1;
      counts.set(competitorId, actions);
      emit({ type: 'action', competitorId, actions });
      return turn;
    },
  };
}

/** A race that passed every check and holds the lock. Hand it to `runRace` exactly once. */
export interface PreparedRace {
  readonly request: RaceRequest;
  readonly room: RoomEntry;
  /** `PRICING` plus the live listed price of each paid pick. */
  readonly prices: PriceTable;
}

type ModelPickPriced = ModelPick & { readonly price: CatalogueEntry['price'] };

/** `PRICING` with a paid pick's listed price added, so `costOf` prices it instead of calling it unpriced. */
export function pricesFor(picks: readonly ModelPickPriced[]): PriceTable {
  const table: Record<Provider, Record<string, NonNullable<CatalogueEntry['price']>>> = {
    groq: { ...PRICING.groq },
    gemini: { ...PRICING.gemini },
    openrouter: { ...PRICING.openrouter },
  };
  for (const pick of picks) if (pick.price !== null) table[pick.provider][pick.modelId] = pick.price;
  return table;
}

/**
 * Every check that can refuse a race, before a key is read or a model called:
 * enabled, not already running, a certified room, both picks in the
 * catalogue with their key set. Throws `RaceError` with the HTTP status to send.
 * On success the lock is TAKEN — `runRace` releases it.
 *
 * The public site does not use this in-memory lock (each request may land on a
 * different function instance); `lib/race/hosted.ts` holds a shared one and
 * calls `checkRace` directly.
 */
export async function prepareRace(request: RaceRequest): Promise<PreparedRace> {
  if (!raceEnabled()) throw new RaceError(404, 'the local race page is disabled in this build');
  if (running) throw new RaceError(409, 'a race is already running — wait for it to finish');
  const prepared = await checkRace(request);
  if (running) throw new RaceError(409, 'a race is already running — wait for it to finish');
  running = true;
  return prepared;
}

/**
 * The checks of `prepareRace` without the lock. On the public site it also
 * refuses a paid model and more than `PUBLIC_MAX_REPEATS` repeats, whatever the
 * request says — the page never offers them, and a hand-made request is held to
 * the same rules.
 */
export async function checkRace(request: RaceRequest): Promise<PreparedRace> {
  if (!raceEnabled()) throw new RaceError(404, 'the race is disabled in this build');
  const hosted = publicRace();
  if (hosted && request.repeats > PUBLIC_MAX_REPEATS) {
    throw new RaceError(400, `the public race allows at most ${PUBLIC_MAX_REPEATS} silent repeat`);
  }

  const room = listRooms().find((r) => r.id === request.roomId);
  if (room === undefined) throw new RaceError(400, `unknown room ${request.roomId}`);
  const certified = verifySpec(room.spec);
  // Codes only: a rejection's message can quote an answer.
  if (!certified.ok) throw new RaceError(400, `room ${room.id} is not certified: ${certified.rejections.map((r) => r.code).join(', ')}`);

  const catalogue = await providerCatalogues(Date.now(), false);
  const priced = [request.a, request.b].map((pick) => {
    const provider = catalogue.find((p) => p.provider === pick.provider)!;
    if (!provider.keySet) {
      throw new RaceError(400, hosted ? `${provider.name} is not available on this site` : `${provider.keyVar} is not set in .env`);
    }
    const entry = provider.models.find((m) => m.modelId === pick.modelId);
    if (entry === undefined) throw new RaceError(400, `${pick.provider}:${pick.modelId} is not in the catalogue`);
    if (hosted && entry.price !== null) throw new RaceError(400, `${pick.provider}:${pick.modelId} is a paid model — the public race offers free models only`);
    return { ...pick, price: entry.price };
  });

  return { request, room, prices: pricesFor(priced) };
}

/**
 * Runs a prepared race to the end, reporting through `emit`, and releases the
 * lock. Never throws: a provider failure, a cancel or a bug ends the stream with
 * an `error` message.
 */
export async function runRace(
  { request, room, prices }: PreparedRace,
  emit: (message: RaceMessage) => void,
  signal: AbortSignal,
  /** `false` on the hosted site: a function's disk is read-only and gone after the call, so nothing is written. */
  { persist = true }: { readonly persist?: boolean } = {},
): Promise<void> {
  let savedTo: string | null = null;
  try {
    const competitors: Competitor[] = [
      { id: 'model-a', provider: request.a.provider, modelId: request.a.modelId, params: { temperature: null, topP: null } },
      { id: 'model-b', provider: request.b.provider, modelId: request.b.modelId, params: { temperature: null, topP: null } },
    ];
    const counts = new Map<string, number>();
    const adapters = Object.fromEntries(
      competitors.map((c) => [c.id, instrument(createAdapter(c, readProviderKey(c.provider)), c.id, counts, emit, signal)]),
    );

    const runId = slug(`race-${room.id}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    const dir = join(process.cwd(), 'runs', runId);
    savedTo = persist ? relative(process.cwd(), dir) : null;

    const layout = buildSceneLayout(room.spec);
    emit({
      type: 'started',
      runId,
      roomLabel: room.label,
      competitors: competitors.map(({ id, provider, modelId }) => ({ id, provider, modelId })),
      budget: { maxActions: DEFAULT_BUDGET.maxActions },
      repeats: request.repeats,
      layout,
      renderer: CURRENT_RENDERER,
    });

    // The main run plays live: each action is sent as a beat the moment the room
    // judges it. Repeats carry `<runId>-rN` and are not watched.
    const thinkMs = new Map<string, number>();
    const onEvent = (event: Event, ended: EndReason | null) => {
      if (event.runId !== runId) return;
      const cumulative = (thinkMs.get(event.competitorId) ?? 0) + event.latencyMs;
      thinkMs.set(event.competitorId, cumulative);
      const beat = beatFromEvent(event, layout, cumulative);
      // The same leak scan the artifact gets: a model that writes a URL or a
      // key-shaped string into an intent does not get it onto the page.
      if (findLeaks(JSON.stringify(beat)).length > 0) {
        const withheld = 'Withheld from the live view: this action contained a URL or key-shaped text.';
        const safe = { ...beat, intent: null, argument: null, rawTargetId: null, verdict: { ...beat.verdict, message: withheld } };
        emit({ type: 'beat', competitorId: event.competitorId, beat: safe, ended });
        return;
      }
      emit({ type: 'beat', competitorId: event.competitorId, beat, ended });
    };

    let result;
    try {
      result = await runMatchup({
        runId,
        spec: room.spec,
        competitors,
        adapters,
        budget: DEFAULT_BUDGET,
        repeats: request.repeats,
        deps: { now: () => Date.now() },
        onEvent,
        prices,
        // The result goes out the moment the main run ends; the repeats only settle its variance note.
        onHero: (hero) => {
          const actionsTaken: Record<string, number> = {};
          for (const event of hero.events) actionsTaken[event.competitorId] = (actionsTaken[event.competitorId] ?? 0) + 1;
          const comparison = buildEarlyComparison({
            run: hero.run,
            actionsTaken,
            puzzleCount: Object.keys(layout.puzzleTargets).length,
            repeatsToRun: request.repeats,
          });
          emit({ type: 'result', comparison });
        },
        onProgress: (message) => {
          // `runMatchup`'s messages: "hero <id>", "repeat i/n <id>", "repeat <id> dropped: …".
          const repeat = /^repeat (\d+)\/(\d+) /.exec(message);
          const dropped = /^repeat \S+-r(\d+) dropped/.exec(message);
          if (message.startsWith('hero ')) {
            counts.clear();
            emit({ type: 'phase', phase: { kind: 'hero' } });
          } else if (repeat !== null) {
            counts.clear();
            emit({ type: 'phase', phase: { kind: 'repeat', index: Number(repeat[1]), of: Number(repeat[2]) } });
          } else if (dropped !== null) {
            emit({ type: 'dropped', index: Number(dropped[1]) });
          }
        },
      });
    } catch (error) {
      if (error instanceof DuelAbortedError) {
        if (persist) write(join(dir, 'events.partial.json'), error.events);
        const cancelled = signal.aborted;
        emit({
          type: 'error',
          message: cancelled ? 'Race cancelled. Nothing was published.' : `${error.message}. Nothing was published.`,
          savedTo,
          comparison: stoppedComparison(error, room.spec, competitors, savedTo, prices),
        });
        return;
      }
      throw error;
    }
    if (signal.aborted) {
      emit({ type: 'error', message: 'Race cancelled during the silent repeats. The main run was not saved.', savedTo: null, comparison: null });
      return;
    }

    if (persist) {
      write(join(dir, 'run.json'), result.hero.run);
      write(join(dir, 'events.json'), result.hero.events);
      for (const repeat of result.repeats) {
        write(join(dir, 'repeats', `${repeat.run.runId}.run.json`), repeat.run);
        write(join(dir, 'repeats', `${repeat.run.runId}.events.json`), repeat.events);
      }
      write(join(dir, 'matchup.json'), {
        heroRunId: result.hero.run.runId,
        repeatRunIds: result.repeats.map((r) => r.run.runId),
        dropped: result.dropped,
        providerCalls: result.providerCalls,
      });
    }

    const artifact = buildArtifact({
      id: slug(runId),
      run: result.hero.run,
      log: result.hero.events,
      room: room.spec,
      repeats: { runs: result.repeats.map((r) => r.run), dropped: result.dropped.length },
      renderer: CURRENT_RENDERER,
      publishedAt: new Date().toISOString(),
    });
    const { data, renderer } = replayFromArtifact(artifact);
    const unpriced = [...new Set([result.hero, ...result.repeats].flatMap((r: DuelResult) => r.unpriced))];

    emit({
      type: 'done',
      runId,
      savedTo,
      publishCommand: savedTo === null ? null : `node --import tsx scripts/publish.mts --run ${savedTo} --room ${room.path}`,
      data,
      renderer,
      comparison: comparisonFromArtifact(artifact),
      providerCalls: result.providerCalls,
      unpriced,
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      emit({ type: 'error', message: error.message, savedTo, comparison: null });
      return;
    }
    // A bug or a refused artifact (a model wrote a URL into an intent). Report the
    // kind of failure — its message names no key, the leak scan prints kinds only.
    emit({ type: 'error', message: error instanceof Error ? error.message : String(error), savedTo, comparison: null });
  } finally {
    running = false;
  }
}

/**
 * The results so far of a main run a provider stopped, for the page's results
 * table. Each competitor's partial log is played back through a fresh simulator
 * — the only judge — so "puzzles solved" is the room's count, not a guess from
 * verdict text.
 */
function stoppedComparison(
  error: DuelAbortedError,
  spec: RoomSpec,
  competitors: readonly Competitor[],
  savedTo: string | null,
  prices: PriceTable,
): ComparisonData {
  const cause = error.cause instanceof CompetitorAbortedError ? error.cause : null;
  const provider = cause?.cause instanceof ProviderError ? cause.cause : null;
  const lanes = competitors.map((competitor) => {
    const events = error.events.filter((e) => e.competitorId === competitor.id).sort((a, b) => a.seq - b.seq);
    const sim = createSimulator({ spec, budget: DEFAULT_BUDGET, competitorId: competitor.id });
    let failedAttempts = 0;
    let invalidActions = 0;
    const tokens = { prompt: 0, completion: 0 };
    for (const event of events) {
      if (!sim.hasEnded()) sim.apply(event.action, { tokens: event.tokens, elapsedMs: event.latencyMs });
      const tally = VERDICT_TALLY[event.verdict.code];
      if (tally === 'failed') failedAttempts += 1;
      if (tally === 'invalid') invalidActions += 1;
      tokens.prompt += event.tokens.prompt;
      tokens.completion += event.tokens.completion;
    }
    return {
      competitorId: competitor.id,
      label: competitor.modelId,
      provider: competitor.provider,
      actions: events.length,
      puzzlesSolved: sim.observe().puzzlesSolved,
      failedAttempts,
      invalidActions,
      tokens,
      costUsd: costOf(competitor, tokens, prices).usd,
    };
  });
  return buildStoppedComparison({
    lanes,
    maxActions: DEFAULT_BUDGET.maxActions,
    puzzleCount: spec.puzzles.length,
    failedCompetitorId: cause?.competitorId ?? null,
    status: provider?.status ?? null,
    savedTo,
  });
}
