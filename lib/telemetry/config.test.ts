import { describe, expect, it } from 'vitest';
import { readTelemetryConfig, TelemetryConfigError } from './config';

const ID = '00000000-0000-4000-8000-000000000011';

describe('readTelemetryConfig', () => {
  it('is off when the variable is unset or blank', () => {
    expect(readTelemetryConfig({})).toBeNull();
    expect(readTelemetryConfig({ UMAMI_WEBSITE_ID: '   ' })).toBeNull();
  });

  it('reads a UUID, trimmed', () => {
    expect(readTelemetryConfig({ UMAMI_WEBSITE_ID: ` ${ID}\n` })).toEqual({ websiteId: ID });
  });

  it('fails loudly on anything else, naming the variable and never the value', () => {
    expect(() => readTelemetryConfig({ UMAMI_WEBSITE_ID: 'abc-secretish' })).toThrow(TelemetryConfigError);
    try {
      readTelemetryConfig({ UMAMI_WEBSITE_ID: 'abc-secretish' });
    } catch (error) {
      expect((error as Error).message).toContain('UMAMI_WEBSITE_ID');
      expect((error as Error).message).not.toContain('abc-secretish');
    }
  });
});
