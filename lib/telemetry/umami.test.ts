import { describe, expect, it } from 'vitest';
import { stubFetch } from './testing';
import { buildUmamiPayload, createUmamiTransport, UMAMI_PAYLOAD_KEYS, UMAMI_SEND_URL } from './umami';

const config = { websiteId: '00000000-0000-4000-8000-000000000011' };
const page = { hostname: 'escape.example', runId: 'canonical' };

describe('buildUmamiPayload', () => {
  it('builds the event body', () => {
    expect(buildUmamiPayload(config, 'run-open', page)).toEqual({
      type: 'event',
      payload: { website: config.websiteId, hostname: 'escape.example', url: '/run/canonical', name: 'run-open' },
    });
  });

  it('says exactly four things — no referrer, screen, title, language or data', () => {
    const { payload } = buildUmamiPayload(config, 'run-t30', page);
    expect(Object.keys(payload)).toEqual([...UMAMI_PAYLOAD_KEYS]);
  });

  it('builds the path from the run id, so no query or fragment can leave the page', () => {
    const { payload } = buildUmamiPayload(config, 'run-complete', page);
    expect(payload.url).toBe('/run/canonical');
    expect(payload.url).not.toMatch(/[?#]/);
  });
});

describe('createUmamiTransport', () => {
  it('posts one keepalive JSON beacon per event', async () => {
    const { fetch, calls } = stubFetch([{ status: 200, body: {} }]);
    createUmamiTransport(config, page, { fetch })('run-open');
    await Promise.resolve();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(UMAMI_SEND_URL);
    expect(calls[0].init).toMatchObject({ method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' } });
    expect(calls[0].body).toEqual(buildUmamiPayload(config, 'run-open', page));
  });

  it('swallows a failed beacon: it neither throws nor leaves a rejection behind', async () => {
    const { fetch } = stubFetch([new Error('offline')]);
    const send = createUmamiTransport(config, page, { fetch });
    expect(() => send('run-open')).not.toThrow();
    // An unhandled rejection here would fail the run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
