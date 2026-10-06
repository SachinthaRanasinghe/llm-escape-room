import { describe, expect, it } from 'vitest';
import { cancelHostedRace, PUBLIC_LIMITS, pollHostedRace, runHostedRace, startHostedRace, visitorAddress, visitorId, type Kv } from './hosted';
import { RaceError } from './index';
import type { RaceMessage, RaceRequest } from './wire';
import type { ArenaMessage, ArenaRequest } from './arena-wire';

/**
 * The public race's queue, limits and log, on an in-memory store with the same
 * compare-and-set rules as Netlify Blobs. No model is called: the race itself is
 * `runRace`, which the local page already exercises.
 */

function memoryKv(): Kv & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const etags = new Map<string, string>();
  let version = 0;
  return {
    data,
    async get<T>(key: string) {
      return data.has(key) ? { value: structuredClone(data.get(key)) as T, etag: etags.get(key)! } : null;
    },
    async set(key, value, condition) {
      if (condition && 'onlyIfNew' in condition && data.has(key)) return false;
      if (condition && 'onlyIfMatch' in condition && etags.get(key) !== condition.onlyIfMatch) return false;
      data.set(key, structuredClone(value));
      etags.set(key, String(++version));
      return true;
    },
    async delete(key) {
      data.delete(key);
      etags.delete(key);
    },
  };
}

const request: RaceRequest = {
  a: { provider: 'groq', modelId: 'openai/gpt-oss-120b' },
  b: { provider: 'gemini', modelId: 'gemini-3-flash' },
  roomId: 'canonical-study',
  repeats: 1,
};

const T0 = Date.UTC(2026, 9, 3, 10, 5);

function harness(start = T0) {
  const kv = memoryKv();
  let clock = start;
  const kicked: string[] = [];
  const options = (address = '203.0.113.7') => ({
    kv,
    address,
    now: () => clock,
    check: async () => undefined,
    kick: async (id: string) => {
      kicked.push(id);
    },
  });
  return {
    kv,
    kicked,
    options,
    advance: (ms: number) => {
      clock += ms;
    },
    now: () => clock,
  };
}

const done: RaceMessage = { type: 'error', message: 'stopped', savedTo: null, comparison: null };

async function refusal(promise: Promise<unknown>): Promise<RaceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RaceError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

async function finish(h: ReturnType<typeof harness>, raceId: string, messages: RaceMessage[] = [done]) {
  await runHostedRace(raceId, {
    kv: h.kv,
    now: h.now,
    race: async (_request, emit) => {
      for (const message of messages) emit(message);
    },
  });
}

describe('startHostedRace', () => {
  it('queues a race, kicks the background function once and answers with its id', async () => {
    const h = harness();
    const id = await startHostedRace(request, h.options());
    expect(h.kicked).toEqual([id]);
    expect((await pollHostedRace(id, 0, { kv: h.kv, now: h.now }))?.finished).toBe(false);
  });

  it('runs one race at a time across the whole site', async () => {
    const h = harness();
    await startHostedRace(request, h.options('198.51.100.1'));
    expect((await refusal(startHostedRace(request, h.options('198.51.100.2')))).status).toBe(409);
  });

  it('frees the slot as soon as the race finishes', async () => {
    const h = harness();
    const first = await startHostedRace(request, h.options('198.51.100.1'));
    await finish(h, first);
    await expect(startHostedRace(request, h.options('198.51.100.2'))).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });

  it('frees a slot whose race was never picked up', async () => {
    const h = harness();
    await startHostedRace(request, h.options('198.51.100.1'));
    h.advance(PUBLIC_LIMITS.queueStaleMs + 1);
    await expect(startHostedRace(request, h.options('198.51.100.2'))).resolves.toBeTypeOf('string');
  });

  it(`allows a visitor ${PUBLIC_LIMITS.perVisitorPerHour} races an hour`, async () => {
    const h = harness();
    for (let i = 0; i < PUBLIC_LIMITS.perVisitorPerHour; i += 1) await finish(h, await startHostedRace(request, h.options()));
    const refused = await refusal(startHostedRace(request, h.options()));
    expect(refused.status).toBe(429);
    // Someone else is not held to this visitor's count.
    await expect(startHostedRace(request, h.options('192.0.2.44'))).resolves.toBeTypeOf('string');
  });

  it(`caps the whole site at ${PUBLIC_LIMITS.perDay} races a day`, async () => {
    const h = harness();
    for (let i = 0; i < PUBLIC_LIMITS.perDay; i += 1) await finish(h, await startHostedRace(request, h.options(`10.0.0.${i}`)));
    expect((await refusal(startHostedRace(request, h.options('192.0.2.1')))).status).toBe(429);
    h.advance(24 * 60 * 60_000);
    await expect(startHostedRace(request, h.options('192.0.2.1'))).resolves.toBeTypeOf('string');
  });

  it('counts nothing and keeps no lock when the background function cannot be started', async () => {
    const h = harness();
    const broken = { ...h.options(), kick: async () => Promise.reject(new Error('down')) };
    expect((await refusal(startHostedRace(request, broken))).status).toBe(502);
    await expect(startHostedRace(request, h.options())).resolves.toBeTypeOf('string');
  });

  it('refuses before counting when the race itself is refused', async () => {
    const h = harness();
    const check = async () => {
      throw new RaceError(400, 'paid model');
    };
    expect((await refusal(startHostedRace(request, { ...h.options(), check }))).status).toBe(400);
    expect([...h.kv.data.keys()]).toEqual([]);
  });
});

describe('runHostedRace', () => {
  it('writes every message to the log and ends finished', async () => {
    const h = harness();
    const id = await startHostedRace(request, h.options());
    const phase: RaceMessage = { type: 'phase', phase: { kind: 'hero' } };
    await finish(h, id, [phase, done]);
    expect(await pollHostedRace(id, 0, { kv: h.kv, now: h.now })).toEqual({ messages: [phase, done], next: 2, finished: true });
    expect(await pollHostedRace(id, 1, { kv: h.kv, now: h.now })).toEqual({ messages: [done], next: 2, finished: true });
  });

  it('runs a job once — a second kick or a made-up id runs nothing', async () => {
    const h = harness();
    const id = await startHostedRace(request, h.options());
    let runs = 0;
    const race = async (_r: RaceRequest, emit: (m: RaceMessage) => void) => {
      runs += 1;
      emit(done);
    };
    await runHostedRace(id, { kv: h.kv, now: h.now, race });
    await runHostedRace(id, { kv: h.kv, now: h.now, race });
    await runHostedRace('00000000-0000-0000-0000-000000000000', { kv: h.kv, now: h.now, race });
    await runHostedRace('../../etc', { kv: h.kv, now: h.now, race });
    expect(runs).toBe(1);
  });

  it('ends with an error message when the race throws, and says nothing more about why', async () => {
    const h = harness();
    const id = await startHostedRace(request, h.options());
    await runHostedRace(id, {
      kv: h.kv,
      now: h.now,
      race: async () => {
        throw new Error('internal detail');
      },
    });
    const poll = await pollHostedRace(id, 0, { kv: h.kv, now: h.now });
    expect(poll?.finished).toBe(true);
    expect(JSON.stringify(poll)).not.toContain('internal detail');
  });

  it('passes a cancel to the race through its abort signal', async () => {
    const h = harness();
    const id = await startHostedRace(request, h.options());
    await runHostedRace(id, {
      kv: h.kv,
      now: h.now,
      race: async (_r, emit, signal) => {
        await cancelHostedRace(id, { kv: h.kv });
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        emit({ type: 'error', message: 'Race cancelled. Nothing was published.', savedTo: null, comparison: null });
      },
    });
    expect((await pollHostedRace(id, 0, { kv: h.kv, now: h.now }))?.messages.at(-1)).toMatchObject({ message: /cancelled/ });
  }, 10_000);
});

describe('pollHostedRace', () => {
  it('knows nothing of a race that was never queued', async () => {
    const h = harness();
    expect(await pollHostedRace('00000000-0000-0000-0000-000000000000', 0, { kv: h.kv })).toBeNull();
    expect(await pollHostedRace('not-an-id', 0, { kv: h.kv })).toBeNull();
  });

  it('ends a race whose background function died', async () => {
    const h = harness();
    const id = await startHostedRace(request, h.options());
    h.advance(PUBLIC_LIMITS.queueStaleMs + 1);
    const poll = await pollHostedRace(id, 0, { kv: h.kv, now: h.now });
    expect(poll?.finished).toBe(true);
    expect(poll?.messages.at(-1)?.type).toBe('error');
  });
});

describe('visitors', () => {
  it('reads the address Netlify reports, then keeps only a day-rotating hash of it', () => {
    expect(visitorAddress(new Headers({ 'x-nf-client-connection-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }))).toBe('203.0.113.7');
    expect(visitorAddress(new Headers({ 'x-forwarded-for': '198.51.100.3, 10.0.0.1' }))).toBe('198.51.100.3');
    const id = visitorId('203.0.113.7', T0);
    expect(id).not.toContain('203');
    expect(visitorId('203.0.113.7', T0 + 24 * 60 * 60_000)).not.toBe(id);
  });
});

describe('the arena on the same queue', () => {
  const arenaRequest: ArenaRequest = {
    players: [
      { provider: 'groq', modelId: 'openai/gpt-oss-120b' },
      { provider: 'groq', modelId: 'openai/gpt-oss-20b' },
      { provider: 'gemini', modelId: 'gemini-3-flash' },
    ],
    rounds: 10,
  };
  const arenaDone: ArenaMessage = { type: 'error', message: 'stopped', savedTo: null, standings: null };

  it('queues an arena job and runs it as a match, never as a race', async () => {
    const h = harness();
    const id = await startHostedRace(arenaRequest, { ...h.options(), game: 'arena' });
    const seen: unknown[] = [];
    await runHostedRace(id, {
      kv: h.kv,
      now: h.now,
      race: async () => {
        throw new Error('a match must not run as a race');
      },
      arena: async (r, emit) => {
        seen.push(r);
        emit(arenaDone);
      },
    });
    expect(seen).toEqual([arenaRequest]);
    expect(await pollHostedRace(id, 0, { kv: h.kv, now: h.now })).toEqual({ messages: [arenaDone], next: 1, finished: true });
  });

  it('reports a failed match in the arena\'s own error shape', async () => {
    const h = harness();
    const id = await startHostedRace(arenaRequest, { ...h.options(), game: 'arena' });
    await runHostedRace(id, {
      kv: h.kv,
      now: h.now,
      arena: async () => {
        throw new Error('internal detail');
      },
    });
    const last = (await pollHostedRace(id, 0, { kv: h.kv, now: h.now }))!.messages.at(-1)!;
    expect(last).toEqual({ type: 'error', message: 'The match could not be run.', savedTo: null, standings: null });
  });

  it('runs a job queued before the arena existed as a race', async () => {
    const h = harness();
    const id = await startHostedRace(request, h.options());
    const job = h.kv.data.get(`job/${id}`) as Record<string, unknown>;
    delete job.game;
    h.kv.data.set(`job/${id}`, job);
    let raced = false;
    await runHostedRace(id, {
      kv: h.kv,
      now: h.now,
      race: async (_r, emit) => {
        raced = true;
        emit(done);
      },
    });
    expect(raced).toBe(true);
  });

  it('shares one lock with the race: a match cannot start while a race runs', async () => {
    const h = harness();
    await startHostedRace(request, h.options());
    const error = await refusal(startHostedRace(arenaRequest, { ...h.options('198.51.100.1'), game: 'arena' }));
    expect(error.status).toBe(409);
  });
});
