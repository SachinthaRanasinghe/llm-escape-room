import { describe, expect, it } from 'vitest';
import { isLocalRaceEnabled } from '@/lib/providers/env';
import { costOf, PRICING } from '@/lib/harness';
import { MAX_REPEATS, parseRaceRequest, pricesFor, RaceError } from './index';

/**
 * The race module's gates that need no network: what a request may ask for, and
 * when the page exists at all. The race itself is `runMatchup` — tested in
 * `lib/harness` — plus the catalogue, tested in `lib/providers/catalogue.test.ts`.
 */

const valid = {
  a: { provider: 'groq', modelId: 'openai/gpt-oss-120b' },
  b: { provider: 'openrouter', modelId: 'nvidia/nemotron-3-super-120b-a12b:free' },
  roomId: 'canonical-study',
  repeats: 1,
};

function refusal(raw: unknown): RaceError {
  try {
    parseRaceRequest(raw);
  } catch (error) {
    if (error instanceof RaceError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('parseRaceRequest', () => {
  it('accepts two picks, a room and a repeat count', () => {
    expect(parseRaceRequest(valid)).toEqual(valid);
  });

  it('refuses a provider it has no adapter for', () => {
    expect(refusal({ ...valid, a: { provider: 'openai', modelId: 'gpt-5' } }).status).toBe(400);
  });

  it('refuses more repeats than the page allows — each one is another full race of calls', () => {
    expect(refusal({ ...valid, repeats: MAX_REPEATS + 1 }).message).toMatch(/repeats/);
    expect(refusal({ ...valid, repeats: -1 }).status).toBe(400);
  });

  it('refuses a model id that could be anything but an id', () => {
    expect(refusal({ ...valid, b: { provider: 'gemini', modelId: '../../etc/passwd?x=1' } }).status).toBe(400);
    expect(refusal({ ...valid, b: { provider: 'gemini', modelId: '' } }).status).toBe(400);
  });

  it('refuses extra fields, so nothing rides along unnoticed', () => {
    expect(refusal({ ...valid, budget: { maxActions: 1000 } }).status).toBe(400);
  });

  it('refuses a body that is not a race at all', () => {
    expect(refusal(null).status).toBe(400);
  });
});

describe('pricesFor', () => {
  const claude = { provider: 'openrouter' as const, modelId: 'anthropic/claude-sonnet-5', price: { promptPerMTok: 2, completionPerMTok: 10 } };
  const free = { provider: 'groq' as const, modelId: 'openai/gpt-oss-120b', price: null };

  it('prices a paid pick at its listed price, so its cost is real rather than an unpriced $0', () => {
    const table = pricesFor([claude, free]);
    expect(costOf(claude, { prompt: 1_000_000, completion: 100_000 }, table)).toEqual({ usd: 3, priced: true });
    expect(costOf(claude, { prompt: 1, completion: 1 }, PRICING).priced).toBe(false);
  });

  it('leaves the free table as it was', () => {
    expect(pricesFor([free])).toEqual(PRICING);
  });
});

describe('isLocalRaceEnabled', () => {
  it('is on under next dev', () => {
    expect(isLocalRaceEnabled({ NODE_ENV: 'development' })).toBe(true);
  });

  it('is off in a production build, so the public site never spends the keys', () => {
    expect(isLocalRaceEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('can be switched on for a production server only on purpose', () => {
    expect(isLocalRaceEnabled({ NODE_ENV: 'production', ENABLE_LOCAL_RACE: '1' })).toBe(true);
    expect(isLocalRaceEnabled({ NODE_ENV: 'production', ENABLE_LOCAL_RACE: 'yes' })).toBe(false);
  });
});
