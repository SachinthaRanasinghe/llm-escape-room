import { describe, expect, it } from 'vitest';
import { QUESTION_CATEGORIES, QUESTION_TIERS } from '../schema';
import { BANK } from './bank';
import { gradeAnswer } from './grade';

/**
 * THE BANK'S PROOF. A wrong key makes a correct model lose, and nothing on the
 * page would look broken — so every answer that can be computed is computed
 * here, independently of the key, and every JavaScript snippet is run.
 *
 * Keys this file cannot recompute (a handful of logic and CS facts) are listed
 * in `UNCHECKED` so the gap is visible; a new question must either get a
 * reference below or join that list on purpose.
 */

/* ── Reference implementations ─────────────────────────────────────────── */

function trailingZeros(n: number): number {
  let zeros = 0;
  for (let p = 5; p <= n; p *= 5) zeros += Math.floor(n / p);
  return zeros;
}

function divisors(n: number): number {
  let count = 0;
  for (let d = 1; d <= n; d++) if (n % d === 0) count++;
  return count;
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function catalan(n: number): number {
  return choose(2 * n, n) / (n + 1);
}

function derangements(n: number): number {
  let a = 1;
  let b = 0;
  for (let i = 2; i <= n; i++) [a, b] = [b, (i - 1) * (a + b)];
  return n === 0 ? 1 : b;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = BigInt(1);
  let b = base % mod;
  let e = exp;
  while (e > BigInt(0)) {
    if (e & BigInt(1)) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= BigInt(1);
  }
  return result;
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length]![b.length]!;
}

function lis(xs: readonly number[]): number {
  const best = xs.map(() => 1);
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < i; j++) if (xs[j]! < xs[i]!) best[i] = Math.max(best[i]!, best[j]! + 1);
  return Math.max(...best);
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

function topoOrders(vertices: readonly string[], edges: readonly [string, string][]): number {
  return permutations(vertices).filter((order) => edges.every(([u, v]) => order.indexOf(u) < order.indexOf(v))).length;
}

function knapsack(capacity: number, items: readonly [number, number][]): number {
  const best = new Array<number>(capacity + 1).fill(0);
  for (const [w, v] of items) for (let c = capacity; c >= w; c--) best[c] = Math.max(best[c]!, best[c - w]! + v);
  return best[capacity]!;
}

function lruFaults(frames: number, refs: readonly number[]): number {
  let cache: number[] = [];
  let faults = 0;
  for (const r of refs) {
    if (cache.includes(r)) cache = [...cache.filter((x) => x !== r), r];
    else {
      faults++;
      cache = [...(cache.length === frames ? cache.slice(1) : cache), r];
    }
  }
  return faults;
}

function openDoors(n: number): number {
  const open = new Array<boolean>(n + 1).fill(false);
  for (let k = 1; k <= n; k++) for (let d = k; d <= n; d += k) open[d] = !open[d];
  return open.filter(Boolean).length;
}

/** Knights and knaves, brute-forced: C's type in every consistent world. */
function knightsC(): string[] {
  const worlds: string[] = [];
  for (const a of [true, false]) for (const b of [true, false]) for (const c of [true, false]) {
    const saysA = !b;
    const saysB = a === c;
    if (saysA === a && saysB === b) worlds.push(c ? 'knight' : 'knave');
  }
  return [...new Set(worlds)];
}

/** "Exactly one / two / all three of us are lying": the liar count in every consistent world. */
function liars(): number[] {
  const counts: number[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const truthful = [0, 1, 2].map((i) => Boolean(mask & (1 << i)));
    const lying = truthful.filter((t) => !t).length;
    const claims = [lying === 1, lying === 2, lying === 3];
    if (claims.every((claim, i) => claim === truthful[i])) counts.push(lying);
  }
  return counts;
}

function bstPostOrder(keys: readonly number[]): number[] {
  type Node = { key: number; left: Node | null; right: Node | null };
  let root: Node | null = null;
  const insert = (node: Node | null, key: number): Node =>
    node === null ? { key, left: null, right: null } : key < node.key ? { ...node, left: insert(node.left, key) } : { ...node, right: insert(node.right, key) };
  for (const key of keys) root = insert(root, key);
  const out: number[] = [];
  const walk = (node: Node | null) => {
    if (node === null) return;
    walk(node.left);
    walk(node.right);
    out.push(node.key);
  };
  walk(root);
  return out;
}

function dfsOrder(edges: readonly [string, string][], start: string): string[] {
  const adj = new Map<string, string[]>();
  for (const [u, v] of edges) {
    adj.set(u, [...(adj.get(u) ?? []), v]);
    adj.set(v, [...(adj.get(v) ?? []), u]);
  }
  const seen: string[] = [];
  const visit = (v: string) => {
    seen.push(v);
    for (const n of [...(adj.get(v) ?? [])].sort()) if (!seen.includes(n)) visit(n);
  };
  visit(start);
  return seen;
}

const ORDERS = [
  { id: 1, customer: 'ann', amount: 30 },
  { id: 2, customer: 'bob', amount: 20 },
  { id: 3, customer: 'ann', amount: 50 },
  { id: 4, customer: 'cat', amount: 10 },
  { id: 5, customer: 'bob', amount: 40 },
];
const EMP = [
  { name: 'a', dept: 'x', salary: 100 },
  { name: 'b', dept: 'x', salary: 200 },
  { name: 'c', dept: 'y', salary: 150 },
  { name: 'd', dept: 'y', salary: 150 },
  { name: 'e', dept: 'z', salary: 50 },
];
const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Each value is what the question's answer must be, computed without reading the key. */
const REFERENCE: Readonly<Record<string, () => unknown>> = {
  'm-math-1': () => trailingZeros(100),
  'm-math-2': () => Array.from({ length: 200 }, (_, i) => i + 1).filter((n) => n % 3 === 0 || n % 5 === 0).reduce((s, n) => s + n, 0),
  'm-math-3': () => Number(modPow(BigInt(2), BigInt(20), BigInt(1000))),
  'm-math-4': () => divisors(360),
  'm-math-5': () => choose(10, 3),
  'm-algorithms-1': () => Math.floor(Math.log2(1000)) + 1,
  'm-algorithms-2': () => {
    const stack: number[] = [];
    stack.push(1, 2);
    stack.pop();
    stack.push(3, 4);
    stack.pop();
    stack.pop();
    stack.push(5);
    return stack.join(',');
  },
  'm-algorithms-3': () => 12 - 1,
  'm-algorithms-4': () => bstPostOrder([50, 30, 70, 20, 40, 60, 80]).join(','),
  'm-algorithms-5': () => dfsOrder([['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D'], ['D', 'E']], 'A').join(','),
  'm-logic-2': () => Math.round(((1.1 - 1.0) / 2) * 100),
  'm-logic-4': () => 7 * 8,
  'm-sql-1': () => ORDERS.filter((o) => o.amount > 25).length,
  'm-sql-2': () => {
    const totals = new Map<string, number>();
    for (const o of ORDERS) totals.set(o.customer, (totals.get(o.customer) ?? 0) + o.amount);
    return [...totals].sort((a, b) => b[1] - a[1])[0]![0];
  },
  'm-sql-3': () => ORDERS.filter((o) => o.customer !== 'ann').reduce((s, o) => s + o.amount, 0),
  'm-sql-4': () => [1, 2, null, 4].filter((x) => x !== null).length,
  'm-sql-5': () => [1, 2, 3].filter((id) => ![2, 3, 4].includes(id)).length,
  'm-cs-1': () => choose(7, 2),
  'm-cs-3': () => (0b11111010 << 24) >> 24,
  'm-cs-4': () => 0x1f + 0x21,
  'h-math-1': () => Array.from({ length: 1000 }, (_, i) => i + 1).filter((n) => n % 2 !== 0 && n % 3 !== 0 && n % 5 !== 0).length,
  'h-math-2': () => Number(modPow(BigInt(7), BigInt(2026), BigInt(100))),
  'h-math-3': () => catalan(6),
  'h-math-4': () => [...(BigInt(2) ** BigInt(100)).toString()].reduce((s, d) => s + Number(d), 0),
  'h-math-5': () => derangements(6),
  'h-algorithms-1': () => Math.ceil((3 * 100) / 2) - 2,
  'h-algorithms-2': () => levenshtein('intention', 'execution'),
  'h-algorithms-3': () => lis([10, 9, 2, 5, 3, 7, 101, 18, 4, 8, 6, 12]),
  'h-algorithms-4': () => topoOrders(['A', 'B', 'C', 'D', 'E', 'F'], [['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D'], ['D', 'E']]),
  'h-algorithms-5': () => knapsack(10, [[5, 10], [4, 40], [6, 30], [3, 50]]),
  'h-logic-1': () => knightsC().join(','),
  'h-logic-3': () => openDoors(150),
  'h-logic-4': () => Math.ceil(Math.log(80) / Math.log(3)),
  'h-logic-5': () => liars().join(','),
  'h-sql-1': () => EMP.filter((e) => e.salary > avg(EMP.filter((o) => o.dept === e.dept).map((o) => o.salary))).length,
  'h-sql-2': () => {
    const depts = [...new Set(EMP.map((e) => e.dept))];
    return depts.filter((d) => {
      const s = EMP.filter((e) => e.dept === d).map((e) => e.salary);
      return s.length > 1 && Math.max(...s) === Math.min(...s);
    }).join(',');
  },
  'h-sql-3': () => {
    const distinct = [...new Set(EMP.map((e) => e.salary))].sort((a, b) => b - a);
    return EMP.filter((e) => distinct.indexOf(e.salary) === 1).map((e) => e.name).sort().join(',');
  },
  // NULL never equals anything, so only the two 1s in a meet the one 1 in b.
  'h-sql-4': () => [1, 1, 2, null].filter((a) => a !== null && [1, null].some((b) => b !== null && b === a)).length,
  // `x NOT IN (2, NULL)` is never TRUE — NULL makes every comparison unknown.
  'h-sql-5': () => {
    const sub = [1, 2, null].filter((x) => x === 2 || x === null);
    const notIn = (x: number | null): boolean | null => {
      if (x === null) return null;
      if (sub.some((s) => s === x)) return false;
      return sub.some((s) => s === null) ? null : true;
    };
    return [1, 2, null].filter((x) => notIn(x) === true).length;
  },
  'h-cs-1': () => catalan(5),
  'h-cs-2': () => (2 ** (32 - 12) * 4) / 1024,
  'h-cs-3': () => lruFaults(3, [1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5]),
  'h-cs-4': () => [...(0b10110110 ^ 0b01101101).toString(2)].filter((b) => b === '1').length,
};

/** Facts a short reference cannot derive without restating the key. Reviewed by hand. */
const UNCHECKED = new Set(['m-logic-1', 'm-logic-3', 'm-logic-5', 'm-cs-2', 'm-cs-5', 'h-logic-2', 'h-cs-5']);

/** Runs a `code` question's snippet and returns what it printed. */
function runSnippet(prompt: string): string {
  const match = /```js\n([\s\S]*?)```/.exec(prompt);
  if (match === null) throw new Error('no ```js block');
  const lines: string[] = [];
  const console = { log: (...args: unknown[]) => lines.push(args.map(String).join(' ')) };
  // Test-only: `new Function` runs a snippet WE committed. Nothing under lib/ evaluates code.
  new Function('console', match[1]!)(console);
  return lines.join('\n');
}

describe('the question bank', () => {
  it('has unique ids and unique prompts', () => {
    expect(new Set(BANK.map((q) => q.id)).size).toBe(BANK.length);
    expect(new Set(BANK.map((q) => q.prompt)).size).toBe(BANK.length);
  });

  it('holds at least 5 per category per tier, and 30 per tier — a full match never repeats', () => {
    for (const tier of QUESTION_TIERS) {
      expect(BANK.filter((q) => q.tier === tier).length).toBeGreaterThanOrEqual(30);
      for (const category of QUESTION_CATEGORIES) {
        expect(BANK.filter((q) => q.tier === tier && q.category === category).length, `${tier}/${category}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('names its ids after tier and category', () => {
    for (const q of BANK) expect(q.id.startsWith(`${q.tier[0]}-${q.category}-`), q.id).toBe(true);
  });

  it.each(BANK.map((q) => [q.id, q] as const))('%s: the displayed answer grades correct against its own key', (_, q) => {
    expect(gradeAnswer(q.key, q.display).correct).toBe(true);
    expect(q.display.length).toBeLessThanOrEqual(200);
  });

  it('tells the model what form the answer takes', () => {
    for (const q of BANK) expect(q.prompt, q.id).toMatch(/Answer (with|as|in|yes|knight|apples)/);
  });

  it('never gives the answer away in a prompt (outside the list of choices it offers)', () => {
    // Text answers are exempt: a name or a word the question must mention ("Bob") is not a leak.
    for (const q of BANK.filter((q) => q.display.length > 2 && q.category !== 'code' && q.key.kind !== 'text')) {
      const body = q.prompt.replace(/Answer [^.]*\.$/, '');
      expect(body.includes(q.display), q.id).toBe(false);
    }
  });
});

describe('every key is independently correct', () => {
  it('every question is either recomputed, run, or listed as reviewed by hand', () => {
    const covered = BANK.filter((q) => q.category === 'code' || q.id in REFERENCE || UNCHECKED.has(q.id));
    expect(BANK.filter((q) => !covered.includes(q)).map((q) => q.id)).toEqual([]);
  });

  it.each(Object.keys(REFERENCE))('%s matches its reference computation', (id) => {
    const q = BANK.find((x) => x.id === id);
    expect(q, id).toBeDefined();
    expect(gradeAnswer(q!.key, String(REFERENCE[id]!())).correct).toBe(true);
  });

  it.each(BANK.filter((q) => q.category === 'code').map((q) => [q.id, q] as const))('%s prints exactly its key', (_, q) => {
    expect(gradeAnswer(q.key, runSnippet(q.prompt)).correct).toBe(true);
  });
});
