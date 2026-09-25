import { describe, expect, it } from 'vitest';
import { fetchRunEventCounts, TelemetryReadError } from './readout';
import { stubFetch } from './testing';

const KEY = 'api_TEST_SECRET_abcdefghijklmnop';
const query = {
  apiKey: KEY,
  websiteId: '00000000-0000-4000-8000-000000000011',
  runId: 'canonical',
  startAt: 1_000,
  endAt: 2_000,
};

describe('fetchRunEventCounts', () => {
  it('asks for this run’s custom events, authorised with the key', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: [] }]);
    await fetchRunEventCounts(query, { fetch });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://api.umami.is/v1/websites/${query.websiteId}/metrics`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'event', startAt: '1000', endAt: '2000', path: '/run/canonical' });
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
  });

  it('keeps only the four telemetry events', async () => {
    const { fetch } = stubFetch([{ status: 200, body: [{ x: 'run-open', y: 3 }, { x: 'other', y: 9 }, { x: 'run-t30', y: 2 }] }]);
    expect(await fetchRunEventCounts(query, { fetch })).toEqual({ 'run-open': 3, 'run-t30': 2 });
  });

  it('refuses a failed response by status, never echoing the key', async () => {
    const { fetch } = stubFetch([{ status: 401, body: { error: `bad key ${KEY}` } }]);
    const error = await fetchRunEventCounts(query, { fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelemetryReadError);
    expect(error).toMatchObject({ reason: 'http', status: 401 });
    expect((error as Error).message).not.toContain(KEY);
  });

  it('refuses a body of the wrong shape', async () => {
    const { fetch } = stubFetch([{ status: 200, body: {} }]);
    await expect(fetchRunEventCounts(query, { fetch })).rejects.toMatchObject({ reason: 'shape' });
  });
});
