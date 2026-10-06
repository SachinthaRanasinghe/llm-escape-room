import type { Question } from './types';

/**
 * The committed question bank — `docs/decisions/arena.md`.
 *
 * Chosen over questions generated per match: a generated question needs a
 * second model to vouch for its answer, and then the result rests on that
 * model being right. These are written once, reviewed, and proved by
 * `bank.test.ts` — every code snippet is executed and every computable answer
 * recomputed — so the engine judges against keys that are known to be correct.
 *
 * ── The bar ────────────────────────────────────────────────────────────────
 * A claim draws a MEDIUM question, a steal a HARD one. Every prompt ends by
 * saying what form the answer takes, and every answer is short and exact. A
 * match draws at most 30 questions of one tier (3 players × 10 rounds), so each
 * tier holds at least 30 and none repeats within a match.
 *
 * ── Adding a question ──────────────────────────────────────────────────────
 * Give it a unique id (`<tier initial>-<category>-<n>`), keep the answer
 * unambiguous, and — if it can be computed — add its reference check to
 * `bank.test.ts`. A JS `code` question is checked by running it.
 */

const ORDERS_TABLE = [
  'Table orders:',
  '| id | customer | amount |',
  '| 1  | ann      | 30     |',
  '| 2  | bob      | 20     |',
  '| 3  | ann      | 50     |',
  '| 4  | cat      | 10     |',
  '| 5  | bob      | 40     |',
].join('\n');

const EMP_TABLE = [
  'Table emp:',
  '| name | dept | salary |',
  '| a    | x    | 100    |',
  '| b    | x    | 200    |',
  '| c    | y    | 150    |',
  '| d    | y    | 150    |',
  '| e    | z    | 50     |',
].join('\n');

const INTEGER = 'Answer with a single integer.';
const OUTPUT = 'Answer with exactly what it prints.';

export const BANK: readonly Question[] = [
  /* ── Medium · math ─────────────────────────────────────────────────────── */
  {
    id: 'm-math-1',
    category: 'math',
    tier: 'medium',
    prompt: `How many trailing zeros does 100! (100 factorial) have? ${INTEGER}`,
    key: { kind: 'number', value: 24 },
    display: '24',
  },
  {
    id: 'm-math-2',
    category: 'math',
    tier: 'medium',
    prompt: `What is the sum of all integers from 1 to 200 inclusive that are divisible by 3 or by 5? ${INTEGER}`,
    key: { kind: 'number', value: 9368 },
    display: '9368',
  },
  {
    id: 'm-math-3',
    category: 'math',
    tier: 'medium',
    prompt: `What is 2^20 mod 1000? ${INTEGER}`,
    key: { kind: 'number', value: 576 },
    display: '576',
  },
  {
    id: 'm-math-4',
    category: 'math',
    tier: 'medium',
    prompt: `How many positive divisors does 360 have? ${INTEGER}`,
    key: { kind: 'number', value: 24 },
    display: '24',
  },
  {
    id: 'm-math-5',
    category: 'math',
    tier: 'medium',
    prompt: `In how many ways can a committee of 3 people be chosen from a group of 10, where order does not matter? ${INTEGER}`,
    key: { kind: 'number', value: 120 },
    display: '120',
  },

  /* ── Medium · code ─────────────────────────────────────────────────────── */
  {
    id: 'm-code-1',
    category: 'code',
    tier: 'medium',
    prompt: ['What does this JavaScript print?', '```js', 'const a = [3, 1, 2];', 'const b = a;', 'b.push(4);', 'console.log(a.length);', '```', INTEGER].join('\n'),
    key: { kind: 'number', value: 4 },
    display: '4',
  },
  {
    id: 'm-code-2',
    category: 'code',
    tier: 'medium',
    prompt: [
      'What does this JavaScript print?',
      '```js',
      'let s = 0;',
      'for (let i = 0; i < 10; i++) {',
      '  if (i % 3 === 0) continue;',
      '  s += i;',
      '}',
      'console.log(s);',
      '```',
      INTEGER,
    ].join('\n'),
    key: { kind: 'number', value: 27 },
    display: '27',
  },
  {
    id: 'm-code-3',
    category: 'code',
    tier: 'medium',
    prompt: ['What does this JavaScript print?', '```js', "console.log([10, 9, 1, 2].sort().join(','));", '```', 'Answer as a comma-separated list, exactly as printed.'].join('\n'),
    key: { kind: 'list', items: ['1', '10', '2', '9'], ordered: true },
    display: '1,10,2,9',
  },
  {
    id: 'm-code-4',
    category: 'code',
    tier: 'medium',
    prompt: ['What does this JavaScript print?', '```js', 'const f = (n) => (n <= 1 ? n : f(n - 1) + f(n - 2));', 'console.log(f(10));', '```', INTEGER].join('\n'),
    key: { kind: 'number', value: 55 },
    display: '55',
  },
  {
    id: 'm-code-5',
    category: 'code',
    tier: 'medium',
    prompt: ['What does this JavaScript print?', '```js', 'console.log(typeof null + typeof undefined);', '```', OUTPUT].join('\n'),
    key: { kind: 'text', accept: ['objectundefined'] },
    display: 'objectundefined',
  },

  /* ── Medium · algorithms ───────────────────────────────────────────────── */
  {
    id: 'm-algorithms-1',
    category: 'algorithms',
    tier: 'medium',
    prompt: `Binary search on a sorted array of 1000 distinct elements: in the worst case, how many array elements must be examined to find a value or conclude it is absent? ${INTEGER}`,
    key: { kind: 'number', value: 10 },
    display: '10',
  },
  {
    id: 'm-algorithms-2',
    category: 'algorithms',
    tier: 'medium',
    prompt:
      'A stack starts empty. Operations in order: push 1, push 2, pop, push 3, push 4, pop, pop, push 5. Which values remain on the stack, from bottom to top? Answer as a comma-separated list.',
    key: { kind: 'list', items: ['1', '5'], ordered: true },
    display: '1,5',
  },
  {
    id: 'm-algorithms-3',
    category: 'algorithms',
    tier: 'medium',
    prompt: `How many edges does a minimum spanning tree of a connected undirected graph with 12 vertices have? ${INTEGER}`,
    key: { kind: 'number', value: 11 },
    display: '11',
  },
  {
    id: 'm-algorithms-4',
    category: 'algorithms',
    tier: 'medium',
    prompt:
      'Insert the keys 50, 30, 70, 20, 40, 60, 80, in that order, into an empty unbalanced binary search tree. What is its post-order traversal? Answer as a comma-separated list.',
    key: { kind: 'list', items: ['20', '40', '30', '60', '80', '70', '50'], ordered: true },
    display: '20,40,30,60,80,70,50',
  },
  {
    id: 'm-algorithms-5',
    category: 'algorithms',
    tier: 'medium',
    prompt:
      'An undirected graph has edges A-B, A-C, B-D, C-D, D-E. Run a recursive depth-first search from A, visiting neighbours in alphabetical order. In what order are the vertices first visited? Answer as a comma-separated list.',
    key: { kind: 'list', items: ['A', 'B', 'D', 'C', 'E'], ordered: true },
    display: 'A,B,D,C,E',
  },

  /* ── Medium · logic ────────────────────────────────────────────────────── */
  {
    id: 'm-logic-1',
    category: 'logic',
    tier: 'medium',
    prompt: 'All bloops are razzies. All razzies are lazzies. Some lazzies are not bloops. Must it be true that all bloops are lazzies? Answer yes or no.',
    key: { kind: 'text', accept: ['yes'] },
    display: 'yes',
  },
  {
    id: 'm-logic-2',
    category: 'logic',
    tier: 'medium',
    prompt: `A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How many cents does the ball cost? ${INTEGER}`,
    key: { kind: 'number', value: 5 },
    display: '5',
  },
  {
    id: 'm-logic-3',
    category: 'logic',
    tier: 'medium',
    prompt: `If 5 machines take 5 minutes to make 5 widgets, how many minutes do 100 machines take to make 100 widgets? ${INTEGER}`,
    key: { kind: 'number', value: 5 },
    display: '5',
  },
  {
    id: 'm-logic-4',
    category: 'logic',
    tier: 'medium',
    prompt: `What is the next number in the sequence 2, 6, 12, 20, 30, 42, …? ${INTEGER}`,
    key: { kind: 'number', value: 56 },
    display: '56',
  },
  {
    id: 'm-logic-5',
    category: 'logic',
    tier: 'medium',
    prompt: 'Alice is older than Bob. Carol is younger than Bob. Dave is older than Alice. Who is the second youngest? Answer with a single name.',
    key: { kind: 'text', accept: ['Bob'] },
    display: 'Bob',
  },

  /* ── Medium · SQL ──────────────────────────────────────────────────────── */
  {
    id: 'm-sql-1',
    category: 'sql',
    tier: 'medium',
    prompt: `${ORDERS_TABLE}\n\nWhat does this query return?\nSELECT COUNT(*) FROM orders WHERE amount > 25;\n${INTEGER}`,
    key: { kind: 'number', value: 3 },
    display: '3',
  },
  {
    id: 'm-sql-2',
    category: 'sql',
    tier: 'medium',
    prompt: `${ORDERS_TABLE}\n\nWhat does this query return?\nSELECT customer FROM orders GROUP BY customer ORDER BY SUM(amount) DESC LIMIT 1;\nAnswer with the single value returned.`,
    key: { kind: 'text', accept: ['ann'] },
    display: 'ann',
  },
  {
    id: 'm-sql-3',
    category: 'sql',
    tier: 'medium',
    prompt: `${ORDERS_TABLE}\n\nWhat does this query return?\nSELECT SUM(amount) FROM orders WHERE customer <> 'ann';\n${INTEGER}`,
    key: { kind: 'number', value: 70 },
    display: '70',
  },
  {
    id: 'm-sql-4',
    category: 'sql',
    tier: 'medium',
    prompt: `Table t has one column x with four rows: 1, 2, NULL, 4.\n\nWhat does this query return?\nSELECT COUNT(x) FROM t;\n${INTEGER}`,
    key: { kind: 'number', value: 3 },
    display: '3',
  },
  {
    id: 'm-sql-5',
    category: 'sql',
    tier: 'medium',
    prompt: `Table a has one column id with rows 1, 2, 3. Table b has one column id with rows 2, 3, 4.\n\nWhat does this query return?\nSELECT COUNT(*) FROM a LEFT JOIN b ON a.id = b.id WHERE b.id IS NULL;\n${INTEGER}`,
    key: { kind: 'number', value: 1 },
    display: '1',
  },

  /* ── Medium · computer science ─────────────────────────────────────────── */
  {
    id: 'm-cs-1',
    category: 'cs',
    tier: 'medium',
    prompt: `How many edges does the complete graph K7 have? ${INTEGER}`,
    key: { kind: 'number', value: 21 },
    display: '21',
  },
  {
    id: 'm-cs-2',
    category: 'cs',
    tier: 'medium',
    prompt: `How many bits long is an IPv6 address? ${INTEGER}`,
    key: { kind: 'number', value: 128 },
    display: '128',
  },
  {
    id: 'm-cs-3',
    category: 'cs',
    tier: 'medium',
    prompt: `What decimal value does the 8-bit two's complement number 11111010 represent? ${INTEGER}`,
    key: { kind: 'number', value: -6 },
    display: '-6',
  },
  {
    id: 'm-cs-4',
    category: 'cs',
    tier: 'medium',
    prompt: `What is 0x1F + 0x21 in decimal? ${INTEGER}`,
    key: { kind: 'number', value: 64 },
    display: '64',
  },
  {
    id: 'm-cs-5',
    category: 'cs',
    tier: 'medium',
    prompt: 'What is the worst-case time complexity of quicksort on n elements? Answer in Big-O notation, like O(n).',
    key: { kind: 'text', accept: ['O(n^2)', 'O(n²)', 'O(n*n)', 'O(n**2)'] },
    display: 'O(n^2)',
  },

  /* ── Hard · math ───────────────────────────────────────────────────────── */
  {
    id: 'h-math-1',
    category: 'math',
    tier: 'hard',
    prompt: `How many integers from 1 to 1000 inclusive are divisible by none of 2, 3 and 5? ${INTEGER}`,
    key: { kind: 'number', value: 266 },
    display: '266',
  },
  {
    id: 'h-math-2',
    category: 'math',
    tier: 'hard',
    prompt: `What are the last two digits of 7^2026? ${INTEGER}`,
    key: { kind: 'number', value: 49 },
    display: '49',
  },
  {
    id: 'h-math-3',
    category: 'math',
    tier: 'hard',
    prompt: `How many lattice paths go from (0,0) to (6,6) using unit steps right or up and never pass above the line y = x? ${INTEGER}`,
    key: { kind: 'number', value: 132 },
    display: '132',
  },
  {
    id: 'h-math-4',
    category: 'math',
    tier: 'hard',
    prompt: `What is the sum of the decimal digits of 2^100? ${INTEGER}`,
    key: { kind: 'number', value: 115 },
    display: '115',
  },
  {
    id: 'h-math-5',
    category: 'math',
    tier: 'hard',
    prompt: `How many permutations of 6 distinct elements leave no element in its original position? ${INTEGER}`,
    key: { kind: 'number', value: 265 },
    display: '265',
  },

  /* ── Hard · code ───────────────────────────────────────────────────────── */
  {
    id: 'h-code-1',
    category: 'code',
    tier: 'hard',
    prompt: [
      'What does this JavaScript print?',
      '```js',
      'var fs = [];',
      'for (var i = 0; i < 3; i++) fs.push(() => i);',
      'const gs = [];',
      'for (let j = 0; j < 3; j++) gs.push(() => j);',
      "console.log(fs.map((f) => f()).join('') + gs.map((g) => g()).join(''));",
      '```',
      OUTPUT,
    ].join('\n'),
    key: { kind: 'text', accept: ['333012'] },
    display: '333012',
  },
  {
    id: 'h-code-2',
    category: 'code',
    tier: 'hard',
    prompt: [
      'What does this JavaScript print?',
      '```js',
      'const m = new Map();',
      'const a = (n) => {',
      '  if (n < 2) return n;',
      '  if (m.has(n)) return m.get(n);',
      '  const v = a(n - 1) + 2 * a(n - 2);',
      '  m.set(n, v);',
      '  return v;',
      '};',
      'console.log(a(10));',
      '```',
      INTEGER,
    ].join('\n'),
    key: { kind: 'number', value: 341 },
    display: '341',
  },
  {
    id: 'h-code-3',
    category: 'code',
    tier: 'hard',
    prompt: [
      'What does this JavaScript print?',
      '```js',
      "const counts = {};",
      "for (const c of 'mississippi') counts[c] = (counts[c] || 0) + 1;",
      'const out = Object.entries(counts)',
      '  .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))',
      '  .map(([c, n]) => c + n)',
      "  .join('');",
      'console.log(out);',
      '```',
      OUTPUT,
    ].join('\n'),
    key: { kind: 'text', accept: ['i4s4p2m1'] },
    display: 'i4s4p2m1',
  },
  {
    id: 'h-code-4',
    category: 'code',
    tier: 'hard',
    prompt: ['What does this JavaScript print?', '```js', 'console.log(0.1 + 0.2 === 0.3, [] + {}, [1, 2] + [3]);', '```', OUTPUT].join('\n'),
    key: { kind: 'text', accept: ['false [object Object] 1,23'] },
    display: 'false [object Object] 1,23',
  },
  {
    id: 'h-code-5',
    category: 'code',
    tier: 'hard',
    prompt: [
      'What does this JavaScript print?',
      '```js',
      'function* gen() {',
      '  let x = 1;',
      '  while (true) {',
      '    const y = yield x;',
      '    x = y === undefined ? x * 2 : y;',
      '  }',
      '}',
      'const g = gen();',
      'const r = [g.next().value, g.next().value, g.next(10).value, g.next().value];',
      "console.log(r.join(','));",
      '```',
      'Answer as a comma-separated list, exactly as printed.',
    ].join('\n'),
    key: { kind: 'list', items: ['1', '2', '10', '20'], ordered: true },
    display: '1,2,10,20',
  },

  /* ── Hard · algorithms ─────────────────────────────────────────────────── */
  {
    id: 'h-algorithms-1',
    category: 'algorithms',
    tier: 'hard',
    prompt: `What is the minimum number of comparisons that suffices, in the worst case, to find both the minimum and the maximum of 100 distinct numbers? ${INTEGER}`,
    key: { kind: 'number', value: 148 },
    display: '148',
  },
  {
    id: 'h-algorithms-2',
    category: 'algorithms',
    tier: 'hard',
    prompt: `What is the Levenshtein edit distance (insertions, deletions and substitutions, each costing 1) between "intention" and "execution"? ${INTEGER}`,
    key: { kind: 'number', value: 5 },
    display: '5',
  },
  {
    id: 'h-algorithms-3',
    category: 'algorithms',
    tier: 'hard',
    prompt: `What is the length of the longest strictly increasing subsequence of [10, 9, 2, 5, 3, 7, 101, 18, 4, 8, 6, 12]? ${INTEGER}`,
    key: { kind: 'number', value: 5 },
    display: '5',
  },
  {
    id: 'h-algorithms-4',
    category: 'algorithms',
    tier: 'hard',
    prompt: `A directed acyclic graph has vertices A, B, C, D, E, F and edges A→B, A→C, B→D, C→D, D→E. F has no edges. How many distinct topological orderings does it have? ${INTEGER}`,
    key: { kind: 'number', value: 12 },
    display: '12',
  },
  {
    id: 'h-algorithms-5',
    category: 'algorithms',
    tier: 'hard',
    prompt: `0/1 knapsack with capacity 10. Items as (weight, value): (5, 10), (4, 40), (6, 30), (3, 50). What is the maximum total value that fits? ${INTEGER}`,
    key: { kind: 'number', value: 90 },
    display: '90',
  },

  /* ── Hard · logic ──────────────────────────────────────────────────────── */
  {
    id: 'h-logic-1',
    category: 'logic',
    tier: 'hard',
    prompt:
      'On an island, knights always tell the truth and knaves always lie. A says: "B is a knave." B says: "A and C are the same type." What is C? Answer knight or knave.',
    key: { kind: 'text', accept: ['knave'] },
    display: 'knave',
  },
  {
    id: 'h-logic-2',
    category: 'logic',
    tier: 'hard',
    prompt:
      'Three boxes are labelled "apples", "oranges" and "mixed", and every label is wrong. You draw one fruit from the box labelled "mixed" and it is an apple. What does the box labelled "oranges" contain? Answer apples, oranges or mixed.',
    key: { kind: 'text', accept: ['mixed'] },
    display: 'mixed',
  },
  {
    id: 'h-logic-3',
    category: 'logic',
    tier: 'hard',
    prompt: `150 doors start closed. On pass k (k = 1 to 150) you toggle every k-th door. How many doors are open after the last pass? ${INTEGER}`,
    key: { kind: 'number', value: 12 },
    display: '12',
  },
  {
    id: 'h-logic-4',
    category: 'logic',
    tier: 'hard',
    prompt: `Among 80 identical-looking coins exactly one is heavier. Using only a two-pan balance, what is the minimum number of weighings that guarantees finding it? ${INTEGER}`,
    key: { kind: 'number', value: 4 },
    display: '4',
  },
  {
    id: 'h-logic-5',
    category: 'logic',
    tier: 'hard',
    prompt: `A says "Exactly one of us three is lying." B says "Exactly two of us three are lying." C says "All three of us are lying." How many of them are lying? ${INTEGER}`,
    key: { kind: 'number', value: 2 },
    display: '2',
  },

  /* ── Hard · SQL ────────────────────────────────────────────────────────── */
  {
    id: 'h-sql-1',
    category: 'sql',
    tier: 'hard',
    prompt: `${EMP_TABLE}\n\nWhat does this query return?\nSELECT COUNT(*) FROM emp e WHERE salary > (SELECT AVG(salary) FROM emp WHERE dept = e.dept);\n${INTEGER}`,
    key: { kind: 'number', value: 1 },
    display: '1',
  },
  {
    id: 'h-sql-2',
    category: 'sql',
    tier: 'hard',
    prompt: `${EMP_TABLE}\n\nWhat does this query return?\nSELECT dept FROM emp GROUP BY dept HAVING COUNT(*) > 1 AND MAX(salary) = MIN(salary);\nAnswer with the single value returned.`,
    key: { kind: 'text', accept: ['y'] },
    display: 'y',
  },
  {
    id: 'h-sql-3',
    category: 'sql',
    tier: 'hard',
    prompt: `${EMP_TABLE}\n\nWhat does this query return?\nSELECT name FROM (SELECT name, DENSE_RANK() OVER (ORDER BY salary DESC) AS r FROM emp) t WHERE r = 2 ORDER BY name;\nAnswer as a comma-separated list, in order.`,
    key: { kind: 'list', items: ['c', 'd'], ordered: true },
    display: 'c,d',
  },
  {
    id: 'h-sql-4',
    category: 'sql',
    tier: 'hard',
    prompt: `Table a has one column id with rows 1, 1, 2, NULL. Table b has one column id with rows 1, NULL.\n\nWhat does this query return?\nSELECT COUNT(*) FROM a JOIN b ON a.id = b.id;\n${INTEGER}`,
    key: { kind: 'number', value: 2 },
    display: '2',
  },
  {
    id: 'h-sql-5',
    category: 'sql',
    tier: 'hard',
    prompt: `Table a has one column x with rows 1, 2, NULL.\n\nWhat does this query return?\nSELECT COUNT(*) FROM a WHERE x NOT IN (SELECT x FROM a WHERE x = 2 OR x IS NULL);\n${INTEGER}`,
    key: { kind: 'number', value: 0 },
    display: '0',
  },

  /* ── Hard · computer science ───────────────────────────────────────────── */
  {
    id: 'h-cs-1',
    category: 'cs',
    tier: 'hard',
    prompt: `How many structurally distinct binary search trees can store the 5 distinct keys 1, 2, 3, 4, 5? ${INTEGER}`,
    key: { kind: 'number', value: 42 },
    display: '42',
  },
  {
    id: 'h-cs-2',
    category: 'cs',
    tier: 'hard',
    prompt: `A system has 32-bit virtual addresses, 4 KiB pages and a single-level page table with 4-byte entries. How many KiB does one full page table occupy? ${INTEGER}`,
    key: { kind: 'number', value: 4096 },
    display: '4096',
  },
  {
    id: 'h-cs-3',
    category: 'cs',
    tier: 'hard',
    prompt: `An LRU cache with 3 frames, initially empty, serves the reference string 1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5. How many page faults occur? ${INTEGER}`,
    key: { kind: 'number', value: 10 },
    display: '10',
  },
  {
    id: 'h-cs-4',
    category: 'cs',
    tier: 'hard',
    prompt: `What is the Hamming distance between the bit strings 10110110 and 01101101? ${INTEGER}`,
    key: { kind: 'number', value: 6 },
    display: '6',
  },
  {
    id: 'h-cs-5',
    category: 'cs',
    tier: 'hard',
    prompt: `What is the minimum number of 2-input NAND gates needed to build a 2-input XOR gate? ${INTEGER}`,
    key: { kind: 'number', value: 4 },
    display: '4',
  },
];
