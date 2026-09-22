import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY, postJson, retryAfterMs } from './transport';
import { ProviderError } from './types';
import { testDeps } from './testing';

const URL_ = 'https://provider.test/v1/chat';
const KEY = 'sk_TEST_SECRET_0123456789';
const headers = { authorization: `Bearer ${KEY}` };

describe('postJson', () => {
  it('returns the body, one attempt, and the latency of that attempt', async () => {
    const { deps, calls } = testDeps([{ status: 200, body: { ok: true } }], 250);
    const result = await postJson('groq', URL_, headers, { a: 1 }, deps);
    expect(result).toEqual({ status: 200, json: { ok: true }, latencyMs: 250, attempts: 1 });
    expect(calls[0]!.body).toEqual({ a: 1 });
    expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('honours retry-after in seconds, and times only the attempt that succeeded', async () => {
    let t = 0;
    const { deps, slept } = testDeps([
      { status: 429, body: {}, headers: { 'retry-after': '2' } },
      { status: 200, body: { ok: true } },
    ]);
    // First attempt takes 900ms, second 300ms: only the 300 is think-time.
    const steps = [0, 900, 900, 1200];
    const timed = { ...deps, now: () => steps[t++]! };
    const result = await postJson('groq', URL_, headers, {}, timed);
    expect(slept).toEqual([2000]);
    expect(result.attempts).toBe(2);
    expect(result.latencyMs).toBe(300);
  });

  it('gives up after maxRetries with a ProviderError carrying status and attempts', async () => {
    const { deps } = testDeps(Array.from({ length: 4 }, () => ({ status: 503, body: {} })));
    const error = await postJson('gemini', URL_, headers, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ provider: 'gemini', status: 503, attempts: 4 });
  });

  it('backs off exponentially without retry-after, capped at maxDelayMs', async () => {
    const { deps, slept } = testDeps(Array.from({ length: 4 }, () => ({ status: 500, body: {} })));
    await postJson('groq', URL_, headers, {}, deps, { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 3000 }).catch(
      () => undefined,
    );
    expect(slept).toEqual([1000, 2000, 3000]);
  });

  it('honours retry-after as an HTTP date', () => {
    const now = Date.parse('2026-09-22T10:00:00Z');
    expect(retryAfterMs('Tue, 22 Sep 2026 10:00:05 GMT', now)).toBe(5000);
    expect(retryAfterMs('soon', now)).toBeNull();
    expect(retryAfterMs(null, now)).toBeNull();
  });

  it('retries a thrown network error', async () => {
    const { deps } = testDeps([new Error('ECONNRESET'), { status: 200, body: { ok: 1 } }]);
    const result = await postJson('groq', URL_, headers, {}, deps);
    expect(result.attempts).toBe(2);
  });

  it('returns a 400 without retrying — deciding what it means is the adapter’s job', async () => {
    const { deps, calls } = testDeps([{ status: 400, body: { error: { message: 'bad' } } }]);
    const result = await postJson('groq', URL_, headers, {}, deps);
    expect(result.status).toBe(400);
    expect(calls).toHaveLength(1);
  });

  it('never lets a key echoed by the provider into the error', async () => {
    const echo = { error: { message: `Invalid API key ${KEY}` } };
    const { deps } = testDeps(Array.from({ length: DEFAULT_RETRY.maxRetries + 1 }, () => ({ status: 503, body: echo })));
    const error = (await postJson('groq', URL_, headers, {}, deps).catch((e: unknown) => e)) as ProviderError;
    expect(error.message).toContain('Invalid API key ***');
    for (const rendered of [error.message, String(error), JSON.stringify(error), error.stack ?? '']) {
      expect(rendered).not.toContain(KEY);
      expect(rendered).not.toContain(URL_);
    }
  });
});
