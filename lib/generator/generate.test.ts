import { describe, expect, it } from 'vitest';
import { loadCanonicalRoom, loadInvalidRoom } from '@/fixtures';
import { ProviderError } from '@/lib/providers';
import { parseRoomSpec, type RoomSpec } from '@/lib/schema/room';
import { GenerationAbortedError, generateRoom } from './generate';
import { narrowProposal } from './proposal';
import { GenerationRecordSchema, type GenerationRecord } from './record';
import { STRATEGIES } from './strategies';
import { proposalFromSpec, scriptedGenerationClient } from './testing';
import type { GeneratorStrategy } from './types';

/**
 * The whole propose → narrow → verify → accept loop, against the REAL solver
 * and a scripted model. No network: the client is a script.
 */

const symbolic = STRATEGIES.symbolic!;
const canonical = loadCanonicalRoom();
const brokenChain = parseRoomSpec(loadInvalidRoom('broken-chain'));

const asText = (spec: RoomSpec) => JSON.stringify(proposalFromSpec(spec));
const VALID = asText(canonical);
const REJECTED = asText(brokenChain);
const MALFORMED = JSON.stringify({ theme: 1 });

function answersOf(...specs: RoomSpec[]): string[] {
  return [...new Set(specs.flatMap((s) => s.puzzles.map((p) => p.answer)))];
}

/** A record must never carry an answer — see `record.ts`. */
function expectAnswerFree(record: GenerationRecord, ...specs: RoomSpec[]): void {
  const text = JSON.stringify(record);
  for (const answer of answersOf(...specs)) expect(text, `record contains answer "${answer}"`).not.toContain(answer);
}

describe('generateRoom', () => {
  it('accepts a valid room on the first attempt', async () => {
    const { client, requests } = scriptedGenerationClient([VALID]);
    const result = await generateRoom({ client, strategy: symbolic, seed: 'happy' });

    if (!result.ok) throw new Error('expected acceptance');
    expect(result.spec).toMatchObject({ seed: 'happy', roomId: 'symbolic-happy', specVersion: 0 });
    expect(result.fingerprint.strategy).toBe('symbolic');
    expect(result.record.accepted).toBe(true);
    expect(result.record.fingerprint).toEqual(result.fingerprint);
    expect(result.record.attempts.map((a) => a.outcome)).toEqual(['accepted']);
    expect(result.record.totals.providerCalls).toBe(1);
    expect(requests).toHaveLength(1);
    expectAnswerFree(result.record, canonical);
  });

  describe('the full funnel', () => {
    const run = async () => {
      const { client, requests } = scriptedGenerationClient(['not json {', MALFORMED, REJECTED, VALID]);
      return { result: await generateRoom({ client, strategy: symbolic, seed: 'funnel' }), requests };
    };

    it('records every attempt with its outcome, and accepts on the fourth', async () => {
      const { result } = await run();
      expect(result.ok).toBe(true);
      const { attempts, totals } = result.record;
      expect(attempts.map((a) => a.outcome)).toEqual(['unparseable_json', 'proposal_malformed', 'rejected', 'accepted']);
      expect(attempts.map((a) => a.index)).toEqual([1, 2, 3, 4]);
      expect(attempts[1]!.malformedIssueCount).toBeGreaterThan(0);
      expect(attempts[2]!.rejections.map((r) => r.code)).toContain('chain_broken');
      expect(totals).toEqual({ attempts: 4, providerCalls: 4, promptTokens: 4000, completionTokens: 2000, latencyMs: 1000 });
      expect(GenerationRecordSchema.safeParse(result.record).success).toBe(true);
      expectAnswerFree(result.record, canonical, brokenChain);
    });

    it('feeds only the previous attempt\'s reasons into the next prompt', async () => {
      const { requests } = await run();
      expect(requests[0]!.prompt).not.toMatch(/rejected by the verifier/);
      expect(requests[1]!.prompt).toMatch(/not a single valid JSON object/);
      expect(requests[2]!.prompt).toMatch(/^- theme/m);
      expect(requests[3]!.prompt).toMatch(/- chain_broken: /);
      // Replaced, not accumulated.
      expect(requests[3]!.prompt).not.toMatch(/not a single valid JSON object/);
      expect(new Set(requests.map((r) => r.system)).size).toBe(1);
    });
  });

  it('returns an outcome, not a throw, when the cap trips — and makes no further call', async () => {
    const { client, requests } = scriptedGenerationClient([REJECTED, REJECTED, REJECTED, VALID]);
    const result = await generateRoom({ client, strategy: symbolic, seed: 'cap', maxAttempts: 3 });

    expect(result.ok).toBe(false);
    expect(result.record.accepted).toBe(false);
    expect(result.record.fingerprint).toBeNull();
    expect(result.record.attempts.map((a) => a.outcome)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(requests).toHaveLength(3);
    expectAnswerFree(result.record, brokenChain);
  });

  it('aborts on a ProviderError, carrying the attempts already spent', async () => {
    const cause = new ProviderError('groq', 503, 4, 'gave up: HTTP 503');
    const { client } = scriptedGenerationClient([REJECTED, cause]);
    const error = await generateRoom({ client, strategy: symbolic, seed: 'abort' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GenerationAbortedError);
    const aborted = error as GenerationAbortedError;
    expect(aborted.cause).toBe(cause);
    expect(aborted.record.attempts).toHaveLength(1);
    expect(aborted.record.accepted).toBe(false);
    expect(aborted.message).toMatch(/after 1 completed attempt/);
    for (const answer of answersOf(brokenChain)) expect(aborted.message).not.toContain(answer);
    expectAnswerFree(aborted.record, brokenChain);
  });

  it('rethrows anything that is not a ProviderError untouched', async () => {
    const bug = new TypeError('a bug, not a provider');
    const { client } = scriptedGenerationClient([bug]);
    await expect(generateRoom({ client, strategy: symbolic, seed: 'bug' })).rejects.toBe(bug);
  });

  it('counts a provider-flagged invalid JSON response, and an empty one, as unparseable', async () => {
    const { client } = scriptedGenerationClient([{ anomaly: 'invalid_json' }, '   ', VALID]);
    const result = await generateRoom({ client, strategy: symbolic, seed: 'anomaly' });
    expect(result.record.attempts.map((a) => a.outcome)).toEqual(['unparseable_json', 'unparseable_json', 'accepted']);
  });

  it('refuses a nonsensical cap before calling anything', async () => {
    const { client, requests } = scriptedGenerationClient([VALID]);
    for (const maxAttempts of [0, -1, 1.5]) {
      await expect(generateRoom({ client, strategy: symbolic, seed: 'x', maxAttempts })).rejects.toThrow(RangeError);
    }
    expect(requests).toHaveLength(0);
  });

  it('is deterministic: same seed and script, same record and same first prompt', async () => {
    const script = [REJECTED, VALID];
    const a = scriptedGenerationClient(script);
    const b = scriptedGenerationClient(script);
    const first = await generateRoom({ client: a.client, strategy: symbolic, seed: 'same' });
    const second = await generateRoom({ client: b.client, strategy: symbolic, seed: 'same' });
    expect(first.record).toEqual(second.record);
    expect(a.requests[0]!.prompt).toBe(b.requests[0]!.prompt);
  });

  it('runs any strategy — a test-only second one goes through the same loop', async () => {
    const other: GeneratorStrategy = {
      name: 'test-only',
      brief: () => ({ chainLength: 3, band: 'standard', finalAnswerDomain: 'direction', codeWidths: [4, 4], decoys: 1, themeHint: 'a test' }),
      system: () => 'Test system. JSON.',
      prompt: (_brief, feedback) => `Test prompt. JSON.${feedback ? ` ${feedback.lines.join(' ')}` : ''}`,
      narrow: narrowProposal,
    };
    const { client, requests } = scriptedGenerationClient([VALID]);
    const result = await generateRoom({ client, strategy: other, seed: 's' });

    expect(result.ok).toBe(true);
    expect(result.record.strategy).toBe('test-only');
    expect(result.record.roomId).toBe('test-only-s');
    expect(result.ok && result.fingerprint.strategy).toBe('test-only');
    expect(requests[0]).toEqual({ system: 'Test system. JSON.', prompt: 'Test prompt. JSON.' });
  });

  it('records which provider and model generated the room', async () => {
    const { client } = scriptedGenerationClient([VALID], { provider: 'gemini', modelId: 'gemini-test' });
    const result = await generateRoom({ client, strategy: symbolic, seed: 'who', roomId: 'custom-id' });
    expect(result.record).toMatchObject({ provider: 'gemini', modelId: 'gemini-test', roomId: 'custom-id' });
  });
});
