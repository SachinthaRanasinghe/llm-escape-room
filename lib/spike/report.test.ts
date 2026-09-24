import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCanonicalLog, loadCanonicalRoom, loadCanonicalRun } from '@/fixtures';
import { SpikeReportError, buildReport } from './report';
import { acceptedRecord, trippedRecord } from './testing';

const ok = await acceptedRecord();
const tripped = await trippedRecord();
const run = loadCanonicalRun();
const events = loadCanonicalLog();

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'spike-report-'));
  roots.push(root);
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return root;
}

function finished(prefix: string): Record<string, unknown> {
  return {
    [`${prefix}/generation.json`]: ok,
    [`${prefix}/room.json`]: loadCanonicalRoom(),
    [`${prefix}/run.json`]: run,
    [`${prefix}/events.json`]: events,
    [`${prefix}/calls.json`]: { providerCalls: { 'model-a': 13, 'model-b': 14 } },
  };
}

describe('buildReport', () => {
  it('reads finished, tripped, aborted and pending instances for what each is', () => {
    const root = tree({
      ...finished('symbolic/1'),
      ...finished('symbolic/2'),
      'symbolic/3/generation.json': tripped,
      'symbolic/4/generation.json': ok,
      'symbolic/4/aborted.json': { reason: 'simulator refused the room' },
      'symbolic/5/partial.json': { providerCalls: 3 },
    });
    const report = buildReport(root);
    const s = report.strategies[0]!;
    expect(s).toMatchObject({ strategy: 'symbolic', planned: 4, certified: 3, capTripped: 1, duels: 2, aborted: 1 });
    expect(s.diverged).toBe(2); // the golden run: model-a escaped, model-b did not
    expect(report.pending).toEqual({ symbolic: 1 });
    // Actions are counted from the log, not trusted from anywhere else.
    expect(s.competitors['model-a']!.invalidPerAction).toBeCloseTo(0 / 13);
  });

  it('extrapolates quota from the duels and generations it read', () => {
    const report = buildReport(tree({ ...finished('spatial/1') }));
    const m = report.quota.measured!;
    const key = Object.keys(m.duel)[0]!;
    expect(m.duel[key]!.calls).toBeGreaterThan(0);
    expect(m.generation.callsPerRoom).toBe(1);
    expect(report.quota.plan).not.toBeNull();
    expect(report.quota.measuredFrom).toBe('all'); // one instance cannot clear MIN_ELIGIBLE
  });

  it('renders markdown with the results, the decision and the quota — and no room content', () => {
    const report = buildReport(tree({ ...finished('mixed/1') }));
    expect(report.markdown).toContain('### Results');
    expect(report.markdown).toContain('| mixed |');
    expect(report.markdown).toContain('### Decision');
    expect(report.markdown).toContain('### Quota');
    const room = loadCanonicalRoom();
    for (const p of room.puzzles) expect(report.markdown).not.toContain(p.answer);
    for (const e of events) expect(report.markdown).not.toContain(e.action?.intent ?? '\u0000');
  });

  it('refuses to report around an unreadable file, naming every one', () => {
    const root = tree({ ...finished('symbolic/1'), 'symbolic/2/generation.json': '{not json', 'spatial/1/run.json': { nope: 1 } });
    expect(() => buildReport(root)).toThrow(SpikeReportError);
    try {
      buildReport(root);
    } catch (error) {
      expect((error as SpikeReportError).paths).toHaveLength(2);
    }
  });
});
