import { describe, expect, it } from 'vitest';
import { costOf, type PriceTable } from './pricing';

const tokens = { prompt: 20_000, completion: 600 };

describe('costOf', () => {
  it('prices a known free-tier model at zero', () => {
    expect(costOf({ provider: 'groq', modelId: 'llama-3.3-70b-versatile' }, tokens)).toEqual({ usd: 0, priced: true });
  });

  it('flags a model nobody priced instead of pretending', () => {
    expect(costOf({ provider: 'groq', modelId: 'competitor-a' }, tokens)).toEqual({ usd: 0, priced: false });
  });

  it('charges per million tokens, prompt and completion separately', () => {
    const table: PriceTable = { groq: { paid: { promptPerMTok: 0.5, completionPerMTok: 2 } }, gemini: {} };
    // 20 000 × 0.5 / 1e6 + 600 × 2 / 1e6 = 0.01 + 0.0012
    expect(costOf({ provider: 'groq', modelId: 'paid' }, tokens, table)).toEqual({ usd: 0.0112, priced: true });
  });

  it('never goes negative and rounds away float noise', () => {
    const table: PriceTable = { groq: { paid: { promptPerMTok: 0.1, completionPerMTok: 0.2 } }, gemini: {} };
    const { usd } = costOf({ provider: 'groq', modelId: 'paid' }, { prompt: 3, completion: 3 }, table);
    expect(usd).toBeGreaterThanOrEqual(0);
    expect(String(usd).length).toBeLessThan(10);
  });
});
