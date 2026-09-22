import { describe, expect, it } from 'vitest';
import { ACTION_NAMES, ActionSchema } from '@/lib/schema/action';
import { buildPortableSpec, toRawAction } from './vocabulary';

const spec = buildPortableSpec();

describe('buildPortableSpec', () => {
  it('produces one tool per verb, named and ordered as ACTION_NAMES', () => {
    expect(spec.tools.map((tool) => tool.name)).toEqual([...ACTION_NAMES]);
  });

  it("carries exactly each member's arguments — read from the Zod shape, not from JSON Schema", () => {
    // An independent derivation: if `buildPortableSpec` lost or invented a
    // parameter, both provider compilers would faithfully reproduce the mistake.
    ActionSchema.options.forEach((member, index) => {
      const expected = Object.keys(member.shape).filter((key) => key !== 'name').sort();
      expect(Object.keys(spec.tools[index]!.params).sort()).toEqual(expected);
      expect([...spec.tools[index]!.required].sort()).toEqual(expected);
    });
  });

  it('requires intent on every tool with the schema bounds and one shared description', () => {
    const descriptions = new Set<string>();
    for (const tool of spec.tools) {
      expect(tool.required).toContain('intent');
      expect(tool.params.intent).toMatchObject({ type: 'string', minLength: 1, maxLength: 280 });
      descriptions.add(tool.params.intent!.description);
    }
    expect(descriptions.size).toBe(1);
  });

  it('keeps minLength 1 on every id and answer argument', () => {
    for (const tool of spec.tools) {
      for (const [key, param] of Object.entries(tool.params)) {
        if (key === 'intent') continue;
        expect(param.minLength, `${tool.name}.${key}`).toBe(1);
        expect(param.maxLength, `${tool.name}.${key}`).toBeNull();
      }
    }
  });

  it('gives every tool and every parameter words to read', () => {
    for (const tool of spec.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      for (const param of Object.values(tool.params)) {
        expect(param.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('is derived once and frozen, so no caller can hand one provider an edited copy', () => {
    expect(buildPortableSpec()).toBe(spec);
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.tools)).toBe(true);
    expect(Object.isFrozen(spec.tools[0]!.params.intent)).toBe(true);
  });
});

describe('toRawAction', () => {
  it('rebuilds a parseable action from a well-formed call', () => {
    const raw = toRawAction('inspect', { targetId: 'desk', intent: 'Read it.' });
    expect(ActionSchema.parse(raw)).toEqual({ name: 'inspect', targetId: 'desk', intent: 'Read it.' });
  });

  it('never lets an argument called name override the tool that was called', () => {
    const raw = toRawAction('look', { intent: 'x', name: 'teleport' }) as { name: string };
    expect(raw.name).toBe('look');
  });

  it('wraps unparseable arguments so the simulator scores them malformed', () => {
    expect(ActionSchema.safeParse(toRawAction('look', '{"intent":')).success).toBe(false);
    expect(ActionSchema.safeParse(toRawAction('look', null)).success).toBe(false);
    expect(ActionSchema.safeParse(toRawAction('look', ['x'])).success).toBe(false);
  });

  it('passes a tool outside the vocabulary through for the simulator to refuse', () => {
    expect(ActionSchema.safeParse(toRawAction('teleport', { intent: 'Worth a try.' })).success).toBe(false);
  });
});
