import { describe, expect, it } from 'vitest';
import { gradeAnswer } from './grade';
import type { AnswerKey } from './types';

const number: AnswerKey = { kind: 'number', value: 24 };
const big: AnswerKey = { kind: 'number', value: 1000 };
const negative: AnswerKey = { kind: 'number', value: -6 };
const text: AnswerKey = { kind: 'text', accept: ['O(n^2)', 'O(n²)'] };
const ordered: AnswerKey = { kind: 'list', items: ['1', '10', '2', '9'], ordered: true };
const unordered: AnswerKey = { kind: 'list', items: ['c', 'd'], ordered: false };

describe('gradeAnswer', () => {
  it.each([
    ['24', true],
    ['24.', true],
    ['`24`', true],
    ['"24"', true],
    [' 24 ', true],
    ['= 24', true],
    ['24.0', true],
    ['25', false],
    ['24 zeros', false],
    ['The answer is 24', false],
    ['', false],
    ['NaN', false],
    ['Infinity', false],
  ])('number: %j → %s', (given, correct) => {
    expect(gradeAnswer(number, given).correct).toBe(correct);
  });

  it('ignores thousands separators and keeps the sign', () => {
    expect(gradeAnswer(big, '1,000').correct).toBe(true);
    expect(gradeAnswer(big, '1_000').correct).toBe(true);
    expect(gradeAnswer(negative, '-6').correct).toBe(true);
    expect(gradeAnswer(negative, '6').correct).toBe(false);
  });

  it('honours a tolerance only when one is set', () => {
    expect(gradeAnswer({ kind: 'number', value: 0.5, tolerance: 0.01 }, '0.505').correct).toBe(true);
    expect(gradeAnswer({ kind: 'number', value: 0.5 }, '0.505').correct).toBe(false);
  });

  it('text: case and whitespace do not matter, content does', () => {
    expect(gradeAnswer(text, 'o(n^2)').correct).toBe(true);
    expect(gradeAnswer(text, 'O( n^2 )').correct).toBe(true);
    expect(gradeAnswer(text, 'O(n²)').correct).toBe(true);
    expect(gradeAnswer(text, 'O(n log n)').correct).toBe(false);
    expect(gradeAnswer(text, '   ').correct).toBe(false);
  });

  it('list: ordered lists keep their order, unordered ones do not', () => {
    expect(gradeAnswer(ordered, '1,10,2,9').correct).toBe(true);
    expect(gradeAnswer(ordered, '1, 10, 2, 9').correct).toBe(true);
    expect(gradeAnswer(ordered, '[1,10,2,9]').correct).toBe(true);
    expect(gradeAnswer(ordered, '1,2,9,10').correct).toBe(false);
    expect(gradeAnswer(ordered, '1,10,2').correct).toBe(false);
    expect(gradeAnswer(unordered, 'd, c').correct).toBe(true);
    expect(gradeAnswer(unordered, 'c').correct).toBe(false);
  });
});
