/**
 * Regenerates the golden fixture corpus in `fixtures/`.
 *
 * Run with: `node --import tsx scripts/generate-fixtures.mts`
 *
 * The fixtures could have been hand-written, and the room below effectively is.
 * What cannot be hand-written safely is the RUN RECORD: its summaries are
 * derived totals over the event log, and a hand-edit that changes one latency
 * without changing `escapeMs` produces a corpus that lies. So the summaries are
 * computed here, and `fixtures/index.test.ts` re-derives them independently and
 * asserts they match — belt and braces, because four tickets trust these files.
 *
 * Every artifact is parsed through its own schema before being written: a
 * generator that emits an invalid fixture should fail here, loudly, rather than
 * commit a broken contract.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseRoomSpec, type RoomSpec } from '../lib/schema/room';
import { parseEventLog, type Event } from '../lib/schema/event';
import { parseRun, type Run, type RunSummary } from '../lib/schema/run';
import type { Action, Verdict } from '../lib/schema/action';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = Date.parse('2026-09-22T10:00:00.000Z');
const RUN_ID = 'run-canonical-0001';

const room: RoomSpec = {
  specVersion: 0,
  seed: 'canonical-room-v0',
  roomId: 'canonical-study',
  theme: {
    name: "The Cartographer's Study",
    description: 'A narrow study above a harbour office, smelling of ink and damp paper.',
  },
  objects: [
    { id: 'desk', name: 'writing desk', description: 'A writing desk, its drawer hanging open.', kind: 'container', lock: null, contains: ['ledger'], clueText: 'The open drawer holds a ledger, and nothing else worth the trouble.' },
    { id: 'ledger', name: 'accounts ledger', description: 'A leather ledger, swollen with damp.', kind: 'portable', lock: null, contains: [], clueText: 'Columns of harbour dues. The final column totals 4471.' },
    { id: 'wall-safe', name: 'wall safe', description: 'A squat iron safe set into the plaster, with a four-digit keypad.', kind: 'lock', lock: { opensWith: 'code', code: '4471' }, contains: ['sea-chart'], clueText: 'The keypad takes four digits. The 7 is worn smooth.' },
    { id: 'sea-chart', name: 'sea chart', description: 'A rolled chart, edges furred with age.', kind: 'portable', lock: null, contains: [], clueText: 'A chart of the coastal survey. The cartouche reads, in a careful hand, 1770.' },
    { id: 'cabinet', name: 'map cabinet', description: 'A shallow map cabinet with a numbered dial.', kind: 'container', lock: { opensWith: 'code', code: '1770' }, contains: ['logbook'], clueText: 'The dial runs 0000 to 9999. It turns stiffly.' },
    { id: 'logbook', name: "surveyor's logbook", description: 'A slim logbook, every page ruled by hand.', kind: 'portable', lock: null, contains: [], clueText: 'Every entry closes the same way: "departed, as always, to the north."' },
    { id: 'door', name: 'studded door', description: 'A studded oak door. It has no keyhole and no handle.', kind: 'door', lock: null, contains: [], clueText: 'No keyhole, no handle. Only a brass plate asking a question: which way out?' },
    { id: 'window', name: 'shuttered window', description: 'A window, shuttered and nailed fast.', kind: 'fixture', lock: null, contains: [], clueText: 'Nailed shut from the outside. Not the way.' },
  ],
  puzzles: [
    { id: 'p1', order: 1, kind: 'code', clueObjectId: 'ledger', answer: '4471', unlocksObjectId: 'wall-safe' },
    { id: 'p2', order: 2, kind: 'code', clueObjectId: 'sea-chart', answer: '1770', unlocksObjectId: 'cabinet' },
    { id: 'p3', order: 3, kind: 'answer', clueObjectId: 'logbook', answer: 'north', unlocksObjectId: 'door' },
  ],
  exit: { objectId: 'door', requiresPuzzleId: 'p3' },
  difficulty: { band: 'standard', estimatedActions: 14 },
  solution: { order: ['p1', 'p2', 'p3'] },
};

type Step = [action: Action, verdict: Verdict, latencyMs: number];

/** model-a keeps the thread: reads the ledger, works the chain, escapes. */
const modelA: Step[] = [
  [{ name: 'look', intent: 'Get the shape of the room before touching anything.' }, { ok: true, code: 'ok', message: 'A writing desk, a wall safe, a map cabinet, a shuttered window and a studded door.' }, 2140],
  [{ name: 'inspect', targetId: 'desk', intent: 'The open drawer is the cheapest thing to check first.' }, { ok: true, code: 'ok', message: 'The open drawer holds a ledger, and nothing else worth the trouble.' }, 1680],
  [{ name: 'open', targetId: 'desk', intent: 'Take everything the drawer has before moving on.' }, { ok: true, code: 'ok', message: 'The drawer slides out. It contains an accounts ledger.' }, 1420],
  [{ name: 'take', targetId: 'ledger', intent: 'I want the ledger in hand so I can read it properly.' }, { ok: true, code: 'ok', message: 'You take the accounts ledger.' }, 1260],
  [{ name: 'inspect', targetId: 'ledger', intent: 'A ledger in a room with a keypad probably holds the number.' }, { ok: true, code: 'ok', message: 'Columns of harbour dues. The final column totals 4471.' }, 2310],
  [{ name: 'open', targetId: 'wall-safe', intent: 'Worth checking whether the safe is even locked before I spend a guess.' }, { ok: false, code: 'locked', message: 'The safe does not budge. The keypad waits.' }, 1890],
  [{ name: 'enter_code', targetId: 'wall-safe', code: '4471', intent: 'The ledger total is four digits and the keypad wants four.' }, { ok: true, code: 'ok', message: 'Four tones, then a heavy click. The safe is unlocked.' }, 2460],
  [{ name: 'open', targetId: 'wall-safe', intent: 'Open it and see what the safe was protecting.' }, { ok: true, code: 'ok', message: 'Inside is a rolled sea chart.' }, 1340],
  [{ name: 'inspect', targetId: 'sea-chart', intent: 'The chart is the only new thing, so the next clue is on it.' }, { ok: true, code: 'ok', message: 'A chart of the coastal survey. The cartouche reads, in a careful hand, 1770.' }, 2620],
  [{ name: 'enter_code', targetId: 'cabinet', code: '1770', intent: 'A four-digit dial and a four-digit year on the chart.' }, { ok: true, code: 'ok', message: 'The dial gives. The cabinet is unlocked.' }, 2180],
  [{ name: 'open', targetId: 'cabinet', intent: 'Same pattern as the safe: unlock, then open.' }, { ok: true, code: 'ok', message: "The cabinet slides open. A surveyor's logbook lies flat inside." }, 1290],
  [{ name: 'inspect', targetId: 'logbook', intent: 'The door asked which way out, so I need a direction.' }, { ok: true, code: 'ok', message: 'Every entry closes the same way: "departed, as always, to the north."' }, 2740],
  [{ name: 'submit_answer', puzzleId: 'p3', answer: 'north', intent: 'The logbook answers the door’s question directly.' }, { ok: true, code: 'ok', message: 'The brass plate turns. The door opens northward onto stairs.' }, 2050],
];

/** model-b loses it: guesses early, searches an imagined bookshelf, runs out of actions. */
const modelB: Step[] = [
  [{ name: 'look', intent: 'Survey everything first.' }, { ok: true, code: 'ok', message: 'A writing desk, a wall safe, a map cabinet, a shuttered window and a studded door.' }, 1960],
  [{ name: 'inspect', targetId: 'wall-safe', intent: 'The safe is the most obviously important thing here.' }, { ok: true, code: 'ok', message: 'The keypad takes four digits. The 7 is worn smooth.' }, 2240],
  [{ name: 'enter_code', targetId: 'wall-safe', code: '7777', intent: 'The 7 is worn smooth, so the code may be all sevens.' }, { ok: false, code: 'wrong_code', message: 'The keypad buzzes and resets.' }, 3110],
  [{ name: 'inspect', targetId: 'window', intent: 'Maybe the way out is not the door at all.' }, { ok: true, code: 'ok', message: 'Nailed shut from the outside. Not the way.' }, 1720],
  [{ name: 'inspect', targetId: 'desk', intent: 'Falling back to searching the furniture.' }, { ok: true, code: 'ok', message: 'The open drawer holds a ledger, and nothing else worth the trouble.' }, 1880],
  [{ name: 'inspect', targetId: 'ledger', intent: 'Read the ledger properly.' }, { ok: true, code: 'ok', message: 'Columns of harbour dues. The final column totals 4471.' }, 2530],
  [{ name: 'enter_code', targetId: 'wall-safe', code: '4471', intent: 'That total is the four digits the keypad wanted.' }, { ok: true, code: 'ok', message: 'Four tones, then a heavy click. The safe is unlocked.' }, 2270],
  [{ name: 'open', targetId: 'wall-safe', intent: 'See what is inside.' }, { ok: true, code: 'ok', message: 'Inside is a rolled sea chart.' }, 1410],
  [{ name: 'inspect', targetId: 'bookshelf', intent: 'Check the bookshelf for the next clue.' }, { ok: false, code: 'not_found', message: 'There is no bookshelf in this room.' }, 2890],
  [{ name: 'inspect', targetId: 'sea-chart', intent: 'Read the chart that was in the safe.' }, { ok: true, code: 'ok', message: 'A chart of the coastal survey. The cartouche reads, in a careful hand, 1770.' }, 2610],
  [{ name: 'enter_code', targetId: 'cabinet', code: '4471', intent: 'Reuse the code that already worked once.' }, { ok: false, code: 'wrong_code', message: 'The dial springs back.' }, 3340],
  [{ name: 'open', targetId: 'cabinet', intent: 'Try forcing it rather than guessing again.' }, { ok: false, code: 'locked', message: 'The cabinet holds fast.' }, 2120],
  [{ name: 'enter_code', targetId: 'cabinet', code: '1770', intent: 'The year on the chart is the only other four-digit number I have.' }, { ok: true, code: 'ok', message: 'The dial gives. The cabinet is unlocked.' }, 2980],
  [{ name: 'open', targetId: 'cabinet', intent: 'Open it and read whatever is inside.' }, { ok: true, code: 'ok', message: "The cabinet slides open. A surveyor's logbook lies flat inside." }, 1530],
];

function record(competitorId: string, steps: Step[]): Event[] {
  let clock = START;
  return steps.map(([action, verdict, latencyMs], seq) => {
    clock += latencyMs;
    return {
      logVersion: 0,
      runId: RUN_ID,
      competitorId,
      seq,
      action,
      verdict,
      latencyMs,
      tokens: { prompt: 820 + seq * 140, completion: 28 + (seq % 5) * 9 },
      at: new Date(clock).toISOString(),
    } satisfies Event;
  });
}

const events: Event[] = [...record('model-a', modelA), ...record('model-b', modelB)].sort(
  (a, b) => Date.parse(a.at) - Date.parse(b.at),
);

/** Verdict codes that mean the model failed to use the interface, not that it guessed wrong. */
const INVALID_CODES = new Set(['malformed', 'not_permitted', 'not_found', 'not_holding']);

function summarise(competitorId: string, escaped: boolean): RunSummary {
  const mine = events.filter((e) => e.competitorId === competitorId).sort((a, b) => a.seq - b.seq);
  const totalMs = mine.reduce((sum, e) => sum + e.latencyMs, 0);
  return {
    competitorId,
    escaped,
    escapeActionCount: escaped ? mine.length : null,
    escapeMs: escaped ? totalMs : null,
    puzzlesSolved: mine.filter(
      (e) => e.verdict.ok && (e.action?.name === 'enter_code' || e.action?.name === 'submit_answer'),
    ).length,
    failedAttempts: mine.filter(
      (e) => e.verdict.code === 'wrong_code' || e.verdict.code === 'wrong_answer',
    ).length,
    invalidActions: mine.filter((e) => INVALID_CODES.has(e.verdict.code)).length,
    tokens: {
      prompt: mine.reduce((sum, e) => sum + e.tokens.prompt, 0),
      completion: mine.reduce((sum, e) => sum + e.tokens.completion, 0),
    },
    costUsd: 0,
    endedBecause: escaped ? 'escaped' : 'budget_actions',
  };
}

const run: Run = {
  runVersion: 0,
  runId: RUN_ID,
  roomId: room.roomId,
  competitors: [
    { id: 'model-a', provider: 'groq', modelId: 'competitor-a', params: { temperature: 0, topP: null } },
    { id: 'model-b', provider: 'groq', modelId: 'competitor-b', params: { temperature: 0, topP: null } },
  ],
  budget: { maxActions: modelB.length, maxTokens: 60_000, maxWallClockMs: 300_000 },
  startedAt: new Date(START).toISOString(),
  summaries: [summarise('model-a', true), summarise('model-b', false)],
  typicalOfRepeats: null,
};

function write(relativePath: string, value: unknown): void {
  const target = join(ROOT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

// Parse before writing: a generator that emits an invalid fixture fails here.
write('fixtures/rooms/valid/canonical-room.json', parseRoomSpec(room));
write('fixtures/logs/canonical-run.json', parseEventLog(events));
write('fixtures/runs/canonical-run.json', parseRun(run));

/** Each invalid room is the canonical room with exactly ONE rule broken. */
const clone = (): RoomSpec => structuredClone(room);
const byId = (spec: RoomSpec, id: string) => spec.objects.find((o) => o.id === id)!;

const unsolvable = clone();
unsolvable.roomId = 'invalid-unsolvable';
byId(unsolvable, 'sea-chart').clueText = 'The chart is water-damaged past reading.';
write('fixtures/rooms/invalid/unsolvable.json', unsolvable);

const ambiguous = clone();
ambiguous.roomId = 'invalid-ambiguous-answer';
byId(ambiguous, 'logbook').clueText =
  'Half the entries close "departed to the north." The other half close "departed to the south."';
write('fixtures/rooms/invalid/ambiguous-answer.json', ambiguous);

const brokenChain = clone();
brokenChain.roomId = 'invalid-broken-chain';
byId(brokenChain, 'wall-safe').contains = [];
write('fixtures/rooms/invalid/broken-chain.json', brokenChain);

const outOfBand = clone();
outOfBand.roomId = 'invalid-out-of-band-difficulty';
outOfBand.difficulty = { band: 'easy', estimatedActions: 400 };
write('fixtures/rooms/invalid/out-of-band-difficulty.json', outOfBand);

/** The only one that fails at PARSE time rather than in the solver. */
const versionMismatch = { ...structuredClone(room), roomId: 'invalid-version-mismatch', specVersion: 1 };
write('fixtures/rooms/invalid/version-mismatch.json', versionMismatch);

console.log(`wrote ${events.length} events, ${run.summaries.length} summaries, 5 invalid rooms`);
