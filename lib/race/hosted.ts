import { createHash, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

import { checkRace, RaceError, runRace, type PreparedRace } from './index';
import type { HostedRacePoll, RaceMessage, RaceRequest } from './wire';

/**
 * The public race on the hosted site (`PUBLIC_RACE=1`) —
 * `docs/decisions/public-race.md`.
 *
 * A race takes minutes; a Netlify function that streams a response is cut off
 * after 60 seconds. So the hosted race is split in three:
 *
 *   1. `POST /api/race` runs every check `prepareRace` runs, then the public
 *      limits (one race at a time, per-visitor and per-day caps), queues a job
 *      in Netlify Blobs and kicks the background function. It answers at once
 *      with a race id.
 *   2. `netlify/functions/race-background.mts` claims the job and runs the same
 *      `runRace` the local page streams, with `persist: false`. Each
 *      `RaceMessage` is appended to the job's log in Blobs.
 *   3. The page polls `GET /api/race/<id>?from=<n>` and feeds the messages to
 *      the same handler the local stream feeds.
 *
 * ── The keys never leave the server ───────────────────────────────────────
 * The background function reads them through `lib/providers/env.ts` like every
 * other harness path. What reaches Blobs, and from there the browser, is only
 * `RaceMessage`s — the same leak-scanned beats and comparisons the local stream
 * sends — and the request a visitor already sent. Provider errors are redacted
 * by the transport before they become messages.
 *
 * ── Abuse limits ───────────────────────────────────────────────────────────
 * Anyone can reach this page, and every race spends the owner's free quota.
 * Visitors are counted by a salted, day-rotating hash of their IP (no IP is
 * stored). The counters are compare-and-set on the blob's ETag, so two requests
 * racing for the last slot cannot both win it.
 */

export const PUBLIC_LIMITS = {
  /** Races one visitor may start in a clock hour. */
  perVisitorPerHour: 3,
  /** Races the whole site may run in a UTC day. */
  perDay: 40,
  /** A lock older than this is abandoned: Netlify stops a background function at 15 minutes. */
  lockStaleMs: 16 * 60_000,
  /** A job that was never claimed in this long was never started. */
  queueStaleMs: 90_000,
  /** A running race whose log has not moved in this long has died. */
  runStaleMs: 5 * 60_000,
} as const;

/* ── Storage ────────────────────────────────────────────────────────────── */

export interface Kv {
  get<T>(key: string): Promise<{ readonly value: T; readonly etag: string } | null>;
  /** `false` when the condition failed and nothing was written. */
  set(key: string, value: unknown, condition?: { readonly onlyIfNew: true } | { readonly onlyIfMatch: string }): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/** Netlify Blobs, strongly consistent: a poll must see the write the function just made. */
export function netlifyKv(): Kv {
  const store = getStore({ name: 'public-race', consistency: 'strong' });
  return {
    async get<T>(key: string) {
      const found = await store.getWithMetadata(key, { type: 'json' });
      if (found === null) return null;
      return { value: found.data as T, etag: found.etag ?? '' };
    },
    async set(key, value, condition) {
      const result = await store.setJSON(key, value, condition ?? {});
      return result.modified;
    },
    async delete(key) {
      await store.delete(key);
    },
  };
}

/* ── Records ────────────────────────────────────────────────────────────── */

type JobStatus = 'queued' | 'running' | 'finished';

interface Job {
  readonly request: RaceRequest;
  readonly status: JobStatus;
  readonly createdAt: number;
  readonly cancel: boolean;
}

interface Log {
  readonly messages: readonly RaceMessage[];
  readonly updatedAt: number;
  readonly finished: boolean;
}

interface Lock {
  readonly raceId: string;
  readonly at: number;
}

const jobKey = (raceId: string) => `job/${raceId}`;
const logKey = (raceId: string) => `log/${raceId}`;
const LOCK_KEY = 'lock';
const RACE_ID = /^[0-9a-f-]{36}$/;

export function isRaceId(value: string): boolean {
  return RACE_ID.test(value);
}

/** Read-modify-write on an ETag, retried a few times. `update` returns `null` to leave the record as it is. */
async function casUpdate<T>(kv: Kv, key: string, update: (current: T | null) => T | null): Promise<T | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await kv.get<T>(key);
    const next = update(current?.value ?? null);
    if (next === null) return current?.value ?? null;
    const written = current === null ? await kv.set(key, next, { onlyIfNew: true }) : await kv.set(key, next, { onlyIfMatch: current.etag });
    if (written) return next;
  }
  throw new RaceError(503, 'the race queue is busy — try again in a moment');
}

/* ── Visitors and limits ────────────────────────────────────────────────── */

/** The visitor's address as Netlify reports it. Used only to count, then hashed. */
export function visitorAddress(headers: Headers): string {
  return headers.get('x-nf-client-connection-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function utcHour(now: number): string {
  return new Date(now).toISOString().slice(0, 13);
}

/** A one-way, day-rotating id for a visitor: enough to count, useless to identify. */
export function visitorId(address: string, now: number): string {
  return createHash('sha256').update(`llm-escape-room:${utcDay(now)}:${address}`).digest('hex').slice(0, 32);
}

const dayKey = (now: number) => `count/day/${utcDay(now)}`;
const visitorKey = (visitor: string, now: number) => `count/visitor/${utcHour(now)}/${visitor}`;

async function count(kv: Kv, key: string): Promise<number> {
  return (await kv.get<{ n: number }>(key))?.value.n ?? 0;
}

async function increment(kv: Kv, key: string): Promise<void> {
  await casUpdate<{ n: number }>(kv, key, (current) => ({ n: (current?.n ?? 0) + 1 }));
}

/** Whether a held lock still means a race is running. */
async function lockIsLive(kv: Kv, lock: Lock, now: number): Promise<boolean> {
  if (now - lock.at > PUBLIC_LIMITS.lockStaleMs) return false;
  const job = (await kv.get<Job>(jobKey(lock.raceId)))?.value;
  if (job === undefined || job.status === 'finished') return false;
  if (job.status === 'queued' && now - job.createdAt > PUBLIC_LIMITS.queueStaleMs) return false;
  if (job.status === 'running') {
    const log = (await kv.get<Log>(logKey(lock.raceId)))?.value;
    if (log !== undefined && now - log.updatedAt > PUBLIC_LIMITS.runStaleMs) return false;
  }
  return true;
}

async function takeLock(kv: Kv, raceId: string, now: number): Promise<boolean> {
  const held = await kv.get<Lock>(LOCK_KEY);
  if (held === null) return kv.set(LOCK_KEY, { raceId, at: now }, { onlyIfNew: true });
  if (await lockIsLive(kv, held.value, now)) return false;
  return kv.set(LOCK_KEY, { raceId, at: now }, { onlyIfMatch: held.etag });
}

async function releaseLock(kv: Kv, raceId: string): Promise<void> {
  const held = await kv.get<Lock>(LOCK_KEY);
  if (held !== null && held.value.raceId === raceId) await kv.delete(LOCK_KEY);
}

/* ── 1. Start ───────────────────────────────────────────────────────────── */

export interface StartOptions {
  readonly kv: Kv;
  readonly address: string;
  /** Starts the background function for this race. Throws if it could not be started. */
  readonly kick: (raceId: string) => Promise<void>;
  readonly now?: () => number;
  /** `checkRace` — injectable so tests need no live catalogue. */
  readonly check?: (request: RaceRequest) => Promise<unknown>;
}

/**
 * Every check, then the public limits, then the job. Throws `RaceError` with the
 * status to send. Nothing is counted against a visitor unless the race was
 * actually queued.
 */
export async function startHostedRace(
  request: RaceRequest,
  { kv, address, kick, now = Date.now, check = checkRace }: StartOptions,
): Promise<string> {
  await check(request);

  const at = now();
  const visitor = visitorId(address, at);
  if ((await count(kv, dayKey(at))) >= PUBLIC_LIMITS.perDay) {
    throw new RaceError(429, `This site has run its ${PUBLIC_LIMITS.perDay} races for today. Come back tomorrow (UTC).`);
  }
  if ((await count(kv, visitorKey(visitor, at))) >= PUBLIC_LIMITS.perVisitorPerHour) {
    throw new RaceError(429, `You can start ${PUBLIC_LIMITS.perVisitorPerHour} races an hour. Try again after the hour turns.`);
  }

  const raceId = randomUUID();
  if (!(await takeLock(kv, raceId, at))) {
    throw new RaceError(409, "Another visitor's race is running. One race runs at a time — try again in a few minutes.");
  }

  try {
    await kv.set(jobKey(raceId), { request, status: 'queued', createdAt: at, cancel: false } satisfies Job);
    await kv.set(logKey(raceId), { messages: [], updatedAt: at, finished: false } satisfies Log);
    await increment(kv, dayKey(at));
    await increment(kv, visitorKey(visitor, at));
    await kick(raceId);
  } catch (error) {
    await releaseLock(kv, raceId).catch(() => {});
    if (error instanceof RaceError) throw error;
    throw new RaceError(502, 'the race could not be started — try again in a moment');
  }
  return raceId;
}

/* ── 2. Run (in the background function) ────────────────────────────────── */

const FLUSH_MS = 400;
const CANCEL_CHECK_MS = 3_000;

/**
 * Claims a queued job and runs it to the end, appending every message to the
 * job's log. Never throws: whatever happens, the log ends finished and the lock
 * is released.
 */
export interface RunOptions {
  readonly kv: Kv;
  readonly now?: () => number;
  /** `checkRace` then `runRace` — injectable so tests call no model. */
  readonly race?: (request: RaceRequest, emit: (message: RaceMessage) => void, signal: AbortSignal) => Promise<void>;
}

async function realRace(request: RaceRequest, emit: (message: RaceMessage) => void, signal: AbortSignal): Promise<void> {
  // The checks again, in this process: the catalogue may have changed since the request was queued.
  const prepared: PreparedRace = await checkRace(request);
  await runRace(prepared, emit, signal, { persist: false });
}

export async function runHostedRace(raceId: string, { kv, now = Date.now, race = realRace }: RunOptions): Promise<void> {
  if (!isRaceId(raceId)) return;
  // Claim: only a queued job runs, and only once — a second kick finds it running.
  const found = await kv.get<Job>(jobKey(raceId));
  if (found === null || found.value.status !== 'queued') return;
  if (!(await kv.set(jobKey(raceId), { ...found.value, status: 'running' } satisfies Job, { onlyIfMatch: found.etag }))) return;
  const { request } = found.value;

  const messages: RaceMessage[] = [];
  let finished = false;
  let writing: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): Promise<void> => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const snapshot: Log = { messages: [...messages], updatedAt: now(), finished };
    writing = writing.then(() => kv.set(logKey(raceId), snapshot).then(() => undefined)).catch(() => undefined);
    return writing;
  };
  const emit = (message: RaceMessage) => {
    messages.push(message);
    if (message.type === 'done' || message.type === 'error') finished = true;
    if (timer === null) timer = setTimeout(() => void flush(), FLUSH_MS);
  };

  const abort = new AbortController();
  const watch = setInterval(() => {
    void kv
      .get<Job>(jobKey(raceId))
      .then((job) => {
        if (job?.value.cancel) abort.abort();
      })
      .catch(() => {});
  }, CANCEL_CHECK_MS);

  try {
    await race(request, emit, abort.signal);
  } catch (error) {
    const message = error instanceof RaceError ? error.message : 'The race could not be run.';
    emit({ type: 'error', message, savedTo: null, comparison: null });
  } finally {
    clearInterval(watch);
    if (!finished) emit({ type: 'error', message: 'The race ended without a result.', savedTo: null, comparison: null });
    await flush();
    const job = await kv.get<Job>(jobKey(raceId)).catch(() => null);
    if (job !== null) await kv.set(jobKey(raceId), { ...job.value, status: 'finished' } satisfies Job).catch(() => {});
    await releaseLock(kv, raceId).catch(() => {});
  }
}

/* ── 3. Follow ──────────────────────────────────────────────────────────── */

/** The messages from `from` on. `null` for a race id that was never queued. */
export async function pollHostedRace(
  raceId: string,
  from: number,
  { kv, now = Date.now }: { readonly kv: Kv; readonly now?: () => number },
): Promise<HostedRacePoll | null> {
  if (!isRaceId(raceId)) return null;
  const log = (await kv.get<Log>(logKey(raceId)))?.value;
  if (log === undefined) return null;
  const start = Math.max(0, Math.min(from, log.messages.length));
  const messages = log.messages.slice(start);
  if (log.finished) return { messages, next: log.messages.length, finished: true };

  const job = (await kv.get<Job>(jobKey(raceId)))?.value;
  const stale =
    job === undefined ||
    (job.status === 'queued' && now() - job.createdAt > PUBLIC_LIMITS.queueStaleMs) ||
    (job.status !== 'queued' && now() - log.updatedAt > PUBLIC_LIMITS.runStaleMs);
  if (stale) {
    const dead: RaceMessage = { type: 'error', message: 'The race stopped responding. Nothing was published — start a new race.', savedTo: null, comparison: null };
    return { messages: [...messages, dead], next: log.messages.length + 1, finished: true };
  }
  return { messages, next: log.messages.length, finished: false };
}

/** Asks the running race to stop. The background function notices within a few seconds. */
export async function cancelHostedRace(raceId: string, { kv }: { readonly kv: Kv }): Promise<boolean> {
  if (!isRaceId(raceId)) return false;
  const updated = await casUpdate<Job>(kv, jobKey(raceId), (job) => (job === null || job.cancel ? null : { ...job, cancel: true }));
  return updated !== null;
}
