'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  describeCall,
  describeDoing,
  describeEnd,
  describeOutcome,
  formatThink,
  isSettled,
  laneStateAt,
  NO_INTENT,
  VERDICT_TONE,
  type LaneMoment,
  type ReplayBeat,
  type ReplayLane,
  type SceneLayout,
  type VerdictTone,
} from '@/lib/replay';
import type { ActionName } from '@/lib/schema/action';
import type { Anchor, AnchorStore } from './anchor';
import styles from './replay.module.css';

/**
 * One lane's heads-up display, drawn over its room rather than below it.
 *
 * ── What goes where ────────────────────────────────────────────────────────
 * The edges carry the race: who this is (top outer corner), that the room is an
 * identical, independent copy (top inner corner), the numbers — each with its
 * label — along the bottom rail, and a short recent-activity list above it.
 *
 * The middle carries the one thing happening now, as a card pinned beside the
 * object being acted on (`anchor.tsx` says where that is on screen) with a
 * leader line to it: the model DECIDES (its intent), ACTS (the action, and the
 * tool call it sent), and the ROOM RESPONDS (the simulator's message) — the
 * step in progress lit, the response landing at `hold`. Finished turns shrink
 * to one line each in recent activity.
 *
 * ── The model's words and the room's words are quoted, never edited ───────
 * `beat.intent` is the one public sentence the prompt asks for with every
 * action ("viewers see it beside your character") — not hidden reasoning, of
 * which the log has none. It and `beat.verdict.message` are rendered as-is:
 * no truncation, no line clamp. A long one wraps; the card grows.
 */

interface Props {
  readonly lane: ReplayLane;
  readonly layout: SceneLayout;
  readonly moment: LaneMoment;
  readonly colourClass: string;
  /** The lane's letter: A, B. */
  readonly letter: string;
  /** Which edge of the stage this lane's identity sits on. */
  readonly side: 'left' | 'right';
  readonly mode: 'replay' | 'live';
  readonly anchor: AnchorStore;
  /** Live only: the lane has caught up with its model, which is still choosing its next action. */
  readonly thinking?: boolean;
  /** Live only: how the lane ended, when the log's end reason does not say (a race a provider stopped). */
  readonly endLabel?: string;
}

const TONE_WORD: Readonly<Record<VerdictTone, string>> = {
  success: 'Success',
  neutral: '',
  failure: 'Wrong',
  invalid: 'Invalid',
};

export function LaneHud({ lane, layout, moment, colourClass, letter, side, mode, anchor, thinking = false, endLabel }: Props) {
  const id = lane.competitorId;
  const beat = moment.beatIndex >= 0 ? lane.beats[moment.beatIndex] : undefined;
  const done = moment.phase === 'done';
  const settled = isSettled(moment);
  const current = done ? undefined : beat;
  const escaped = done && lane.escaped && !endLabel;

  // Locks opened so far, out of the ones the room's puzzles guard.
  const locks = useMemo(() => [...new Set(Object.values(layout.puzzleTargets))], [layout]);
  const solved = useMemo(() => {
    const { unlocked } = laneStateAt(lane, layout, moment.beatIndex, settled);
    return locks.filter((lock) => unlocked.includes(lock)).length;
  }, [lane, layout, moment.beatIndex, settled, locks]);

  const used = done ? lane.beats.length : beat ? beat.seq + 1 : 0;
  const history = done ? lane.beats : beat ? lane.beats.slice(0, settled ? moment.beatIndex + 1 : moment.beatIndex) : [];

  // ── Pinning the card ──
  const pin = useSyncExternalStore(anchor.subscribe, anchor.get, noAnchor);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [top, setTop] = useState<HTMLElement | null>(null);
  const [bottom, setBottom] = useState<HTMLElement | null>(null);
  const box = useElementSize(root);
  const size = useElementSize(card);
  // The card keeps clear of the identity card above and the activity and rail below.
  const clear = {
    top: useElementSize(top).h + 22,
    bottom: useElementSize(bottom).h + 18,
  };
  const pinned = current !== undefined && pin !== null;
  const spot = place(pinned ? pin : null, box, size, clear, done ? 'low' : 'high');

  const badge = done
    ? escaped
      ? { text: 'Escaped', tone: styles.badgeWin }
      : {
          text: endLabel ? 'Stopped' : 'Out of actions',
          tone: styles.badgeLose,
        }
    : !beat
      ? {
          text: thinking ? 'Thinking' : mode === 'live' ? 'Starting' : 'Ready',
          tone: '',
        }
      : {
          text: thinking ? 'Thinking' : mode === 'live' ? 'Live' : 'Replay',
          tone: mode === 'live' ? styles.badgeLive : styles.badgePlay,
        };

  return (
    <section
      ref={setRoot}
      className={`${styles.hud} ${colourClass} ${side === 'right' ? styles.hudRight : ''}`}
      data-testid={`panel-${id}`}
      aria-label={`Model ${letter}: ${lane.label}`}
    >
      <header ref={setTop} className={`${styles.idCard} ${styles.glass}`}>
        <span className={styles.avatar} aria-hidden="true">
          {letter}
        </span>
        <span className={styles.idText}>
          <span className={styles.idKicker}>Model {letter}</span>
          <span className={styles.idName}>{lane.label}</span>
          <span className={styles.idProvider}>{lane.provider}</span>
        </span>
        <span className={`${styles.badge} ${badge.tone}`}>{badge.text}</span>
      </header>

      <p className={styles.roomTag}>
        <span>Identical room</span>
        <span aria-hidden="true">·</span>
        <span>Independent run</span>
      </p>

      {pinned && spot.line && (
        <svg className={styles.leader} width={box.w} height={box.h} aria-hidden="true">
          <line x1={spot.line.x1} y1={spot.line.y1} x2={spot.line.x2} y2={spot.line.y2} />
          <circle cx={spot.line.x1} cy={spot.line.y1} r="4" />
          <circle className={styles.leaderPulse} cx={spot.line.x1} cy={spot.line.y1} r="10" />
        </svg>
      )}

      <div
        ref={setCard}
        className={`${styles.card} ${styles.glass} ${spot.ready ? '' : styles.cardHidden}`}
        style={{
          transform: `translate3d(${Math.round(spot.x)}px, ${Math.round(spot.y)}px, 0)`,
        }}
        aria-live="polite"
      >
        {done ? (
          <ResultCard
            lane={lane}
            id={id}
            escaped={escaped}
            endLabel={endLabel}
            used={used}
            solved={solved}
            locks={locks.length}
          />
        ) : current ? (
          <TurnCard key={current.seq} beat={current} lane={lane} layout={layout} moment={moment} thinking={thinking} />
        ) : (
          <div className={styles.cardInner}>
            <p className={styles.introStatus} data-testid={`status-${id}`}>
              {thinking ? 'Thinking about its first move…' : 'Ready'}
            </p>
            <span className={styles.stepLabel}>What the model is told first</span>
            <p className={styles.reply}>
              {layout.themeName}. You can see:{' '}
              {layout.objects
                .filter((o) => o.parentId === null)
                .map((o) => o.name)
                .join(', ')}
              .
            </p>
            <p className={styles.introMeta}>{lane.maxActions} actions to get out.</p>
          </div>
        )}
      </div>

      <div ref={setBottom} className={styles.bottom}>
        <Activity
          history={history}
          layout={layout}
          now={current && !settled ? current : undefined}
          thinking={thinking && !done}
        />

        <footer className={`${styles.rail} ${styles.glass}`}>
          <dl className={styles.stats}>
            <Stat label="Actions used" value={`${used} / ${lane.maxActions}`} testId={`actions-${id}`} />
            <Stat label="Remaining" value={`${lane.maxActions - used}`} />
            <Stat
              label="Think time"
              value={beat ? formatThink(beat.thinkMs) : '—'}
              extra={beat ? `this turn · ${formatThink(beat.cumulativeThinkMs)} total` : undefined}
              testId={`think-${id}`}
            />
            <Stat label="Locks opened" value={`${solved} of ${locks.length}`} />
          </dl>
          <div className={styles.pips} aria-hidden="true">
            {Array.from({ length: lane.maxActions }, (_, i) => (
              <span
                key={i}
                className={`${styles.pip} ${i < used - (current ? 1 : 0) ? styles.pipDone : ''} ${current && i === current.seq ? styles.pipNow : ''}`}
              />
            ))}
          </div>
        </footer>
      </div>
    </section>
  );
}

function noAnchor(): Anchor | null {
  return null;
}

/** The current turn, as three steps: decides → acts → the room responds. */
function TurnCard({
  beat,
  lane,
  layout,
  moment,
  thinking,
}: {
  beat: ReplayBeat;
  lane: ReplayLane;
  layout: SceneLayout;
  moment: LaneMoment;
  thinking: boolean;
}) {
  const settled = isSettled(moment);
  const tone = VERDICT_TONE[beat.verdict.code];
  const call = describeCall(beat);
  const id = lane.competitorId;
  return (
    <div className={`${styles.cardInner} ${settled ? styles[tone] : ''}`}>
      <div className={`${styles.step} ${moment.phase === 'walk' ? styles.stepNow : ''}`}>
        <span className={styles.stepLabel}>
          <Icon name="spark" /> Decides
          <span className={styles.stepAside}>Turn {beat.seq + 1}</span>
        </span>
        {beat.intent === null ? (
          <p className={styles.noIntent} data-testid={`intent-${id}`}>
            {NO_INTENT}
          </p>
        ) : (
          <blockquote className={styles.hudIntent} data-testid={`intent-${id}`}>
            {beat.intent}
          </blockquote>
        )}
      </div>

      <div className={`${styles.step} ${moment.phase === 'act' ? styles.stepNow : ''}`}>
        <span className={styles.stepLabel}>
          <Icon name={beat.verb ?? 'none'} /> Action
        </span>
        <p className={styles.doing}>{describeDoing(beat, layout)}</p>
        {call && <code className={styles.call}>{call}</code>}
      </div>

      <div className={`${styles.step} ${styles.response} ${settled ? styles.stepNow : ''}`}>
        <span className={styles.stepLabel}>
          <Icon name={settled ? tone : 'wait'} /> Room response
          {settled && TONE_WORD[tone] && <span className={styles.toneWord}>{TONE_WORD[tone]}</span>}
        </span>
        {settled ? (
          <p className={styles.reply}>{beat.verdict.message}</p>
        ) : (
          <span className={styles.typing} aria-label="The room is responding">
            <span />
            <span />
            <span />
          </span>
        )}
        {settled && <span className={styles.remaining}>{lane.maxActions - beat.seq - 1} actions left</span>}
      </div>

      {thinking && (
        <p className={styles.next} data-testid={`thinking-${id}`}>
          Choosing its next action…
        </p>
      )}
    </div>
  );
}

function ResultCard({
  lane,
  id,
  escaped,
  endLabel,
  used,
  solved,
  locks,
}: {
  lane: ReplayLane;
  id: string;
  escaped: boolean;
  endLabel?: string;
  used: number;
  solved: number;
  locks: number;
}) {
  const think = lane.beats.at(-1)?.cumulativeThinkMs ?? 0;
  return (
    <div className={`${styles.cardInner} ${styles.result} ${escaped ? styles.success : styles.failure}`}>
      <span className={styles.resultKicker}>
        <Icon name={escaped ? 'trophy' : 'flag'} /> {escaped ? 'Escaped' : endLabel ? 'Stopped' : 'Run over'}
      </span>
      <p className={styles.resultHeadline} data-testid={`status-${id}`}>
        {endLabel ?? describeEnd(lane)}
      </p>
      <p className={styles.resultLine}>
        {lane.label} {escaped ? 'escaped the room.' : 'did not get out.'}
      </p>
      <dl className={styles.resultStats}>
        <Stat label="Actions used" value={`${used} / ${lane.maxActions}`} />
        <Stat label="Think time" value={formatThink(think)} />
        <Stat label="Locks opened" value={`${solved} of ${locks}`} />
      </dl>
    </div>
  );
}

/** Finished turns, one line each, newest last, and what is under way now. */
function Activity({
  history,
  layout,
  now,
  thinking,
}: {
  history: readonly ReplayBeat[];
  layout: SceneLayout;
  now?: ReplayBeat;
  thinking: boolean;
}) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [history.length, now, thinking]);
  if (history.length === 0 && !now && !thinking) return null;
  return (
    <aside className={`${styles.activity} ${styles.glass}`} aria-label="Recent activity">
      <span className={styles.activityTitle}>Recent activity</span>
      <ol ref={list} className={styles.activityList}>
        {history.map((b) => {
          const tone = VERDICT_TONE[b.verdict.code];
          return (
            <li key={b.seq} className={styles[tone]}>
              <Icon name={tone} />
              <span>{describeOutcome(b, layout)}</span>
            </li>
          );
        })}
        {(now || thinking) && (
          <li className={styles.activityNow}>
            <Icon name="arrow" />
            <span>{now ? describeDoing(now, layout) : 'Choosing next action'}</span>
          </li>
        )}
      </ol>
    </aside>
  );
}

function Stat({ label, value, extra, testId }: { label: string; value: string; extra?: string; testId?: string }) {
  return (
    <div className={styles.stat} data-testid={testId}>
      <dt>{label}</dt>
      <dd>
        {value}
        {extra && <span className={styles.statExtra}>{extra}</span>}
      </dd>
    </div>
  );
}

// ── Placement ──────────────────────────────────────────────────────────────

interface Size {
  readonly w: number;
  readonly h: number;
}

function useElementSize(element: HTMLElement | null): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const w = element.offsetWidth;
      const h = element.offsetHeight;
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

const MARGIN = 12;
/** How far from the object the card stands, so it never sits on the robot in front of it. */
const GAP = 44;

interface Spot {
  readonly x: number;
  readonly y: number;
  readonly ready: boolean;
  readonly line: { x1: number; y1: number; x2: number; y2: number } | null;
}

/**
 * Where the card goes: beside its anchor on whichever side has room, kept clear
 * of the identity card and the rail. With nothing to pin to, it sits centred,
 * `high` or `low` — the briefing above the characters standing on the rug, the
 * result below the exit an escapee walks out through.
 */
function place(anchor: Anchor | null, box: Size, card: Size, clear: { top: number; bottom: number }, unpinned: 'high' | 'low'): Spot {
  const ready = box.w > 0 && card.w > 0;
  const maxY = Math.max(clear.top, box.h - clear.bottom - card.h);
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), Math.max(MARGIN, box.w - MARGIN - card.w));
  const clampY = (y: number) => Math.min(Math.max(y, clear.top), maxY);

  if (!anchor) {
    const x = clampX((box.w - card.w) / 2);
    const y = unpinned === 'low' ? maxY - 16 : clear.top;
    return { x, y, ready, line: null };
  }

  const ax = anchor.x * box.w;
  const ay = anchor.y * box.h;
  const roomRight = box.w - MARGIN - (ax + GAP);
  const roomLeft = ax - GAP - MARGIN;
  const right = roomRight >= card.w || roomRight >= roomLeft;
  const x = clampX(right ? ax + GAP : ax - GAP - card.w);
  const y = clampY(ay - card.h * 0.55);

  // A leader from the object to the nearest point of the card, unless the card had to sit on top of it.
  const nx = Math.min(Math.max(ax, x), x + card.w);
  const ny = Math.min(Math.max(ay, y), y + card.h);
  const inside = nx === ax && ny === ay;
  const onScreen = anchor.x >= 0 && anchor.x <= 1 && anchor.y >= 0 && anchor.y <= 1;
  return {
    x,
    y,
    ready,
    line: inside || !onScreen ? null : { x1: ax, y1: ay, x2: nx, y2: ny },
  };
}

// ── Icons ──────────────────────────────────────────────────────────────────

type IconName = ActionName | VerdictTone | 'spark' | 'wait' | 'none' | 'trophy' | 'flag' | 'arrow';

const PATHS: Readonly<Record<IconName, string>> = {
  spark: 'M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z',
  look: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  inspect: 'M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.6 10.6 14.5 14.5',
  take: 'M4 8.5V4.2a1.2 1.2 0 0 1 2.4 0V8M6.4 7V3a1.2 1.2 0 0 1 2.4 0v4M8.8 7.2V4a1.2 1.2 0 0 1 2.4 0v5.5c0 3-2 5-4.5 5S3 13 2.3 11l-.8-2.2a1.1 1.1 0 0 1 2-.9L4 8.5',
  open: 'M3 14.5V2.5h7v12M10 3.5l3.5 1.2v9.8M8 8.5v.5M1.5 14.5h13',
  use: 'M5.5 10.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6ZM8.5 7.5h6M12.5 7.5v2.5M10.5 7.5v1.8',
  enter_code:
    'M3 2.5h10v11H3ZM5.5 5h.01M8 5h.01M10.5 5h.01M5.5 7.7h.01M8 7.7h.01M10.5 7.7h.01M5.5 10.4h.01M8 10.4h.01M10.5 10.4h.01',
  submit_answer: 'M2 3.5h12v7.5H7l-3 2.5V11H2Z',
  success: 'M3 8.5 6.5 12 13 4.5',
  failure: 'M4 4l8 8M12 4l-8 8',
  invalid: 'M8 2.5 14.5 13.5H1.5ZM8 6.5v3.2M8 11.6h.01',
  neutral: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  wait: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.3 1.5',
  none: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM3.5 12.5l9-9',
  trophy: 'M5 2.5h6v3.5a3 3 0 0 1-6 0ZM5 3.5H2.5a2.5 2.5 0 0 0 2.6 3.4M11 3.5h2.5a2.5 2.5 0 0 1-2.6 3.4M8 9v3M5.5 13.5h5',
  flag: 'M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5',
  arrow: 'M3 8h9.5M9 4.5 12.5 8 9 11.5',
};

function Icon({ name }: { name: IconName }) {
  return (
    <svg className={styles.icon} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
