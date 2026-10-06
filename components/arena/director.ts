import type { Cores } from '@/lib/race/arena-wire';
import { OPENING_OWNERS, reassign, type Owner, type PlayerId } from './choreography';

/**
 * What the 3D arena should be doing, kept outside React and outside three.js.
 *
 * `ArenaStage` tells the director what happened, once per playback beat
 * (`approach`, `hack`, `verdict`, `grab`, `eliminate`…). The scene
 * (`Arena3D.tsx`) reads it every frame. Every motion is a tween with a start
 * time and a length, so a pose is a function of the clock: a skipped beat or a
 * late-loading canvas just picks up wherever the tweens say things are.
 *
 * It lives in plain TS because the canvas loads lazily (`next/dynamic`): calls
 * made before three.js arrives are kept, not lost.
 */

export const PLAYERS: readonly PlayerId[] = ['player-a', 'player-b', 'player-c'];

export const LANE_COLOR: Readonly<Record<PlayerId, string>> = {
  'player-a': '#f2a65a',
  'player-b': '#4fd1c5',
  'player-c': '#b794f4',
};
export const CORE_COLOR = '#ffd36b';
export const GOOD = '#5ee49a';
export const BAD = '#ff5d6c';

export interface P2 {
  readonly x: number;
  readonly z: number;
}

/** Where things stand on the arena floor, in world units. The reactor is the origin. */
export const SPOT: Readonly<Record<Owner, P2>> = {
  'player-a': { x: -5.7, z: -0.4 },
  'player-b': { x: 5.7, z: -0.4 },
  'player-c': { x: 0, z: 5.3 },
  centre: { x: 0, z: 0 },
};

/** How close a robot gets to the shrine to claim, and to a rival's island to steal. */
const REACTOR_REACH = 1.95;
const RAID_REACH = 1.75;

function toward(from: P2, to: P2, distance: number): P2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: from.x + (dx / length) * distance, z: from.z + (dz / length) * distance };
}

/** Each robot's place: the middle of its own island. */
export function homeOf(player: PlayerId): P2 {
  return SPOT[player];
}

export type Pose = 'idle' | 'think' | 'hack' | 'cheer' | 'fail' | 'carry' | 'slump' | 'hit' | 'down' | 'win' | 'shield' | 'glitch' | 'alert';

export interface Move {
  readonly from: P2;
  readonly to: P2;
  readonly start: number;
  readonly ms: number;
}

export interface RobotState {
  move: Move;
  pose: Pose;
  poseAt: number;
  /** What it turns to face when standing still. */
  face: Owner | 'camera';
}

export interface CoreState {
  owner: Owner;
  /** Riding on this robot until `carryUntil`, then flying to its slot. */
  carrier: PlayerId | null;
  carryUntil: number;
  /** Bumped when the core should jump to its slot with no flight. */
  snap: number;
}

export interface Burst {
  readonly at: readonly [number, number, number];
  readonly color: string;
  readonly count: number;
  readonly speed: number;
  readonly up?: number;
}

export interface Ring {
  readonly at: P2;
  readonly color: string;
  readonly start: number;
  readonly ms: number;
  readonly radius: number;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function moveProgress(move: Move, now: number): number {
  return move.ms <= 0 ? 1 : clamp01((now - move.start) / move.ms);
}

export function positionAt(move: Move, now: number): P2 {
  const p = easeInOut(moveProgress(move, now));
  return { x: move.from.x + (move.to.x - move.from.x) * p, z: move.from.z + (move.to.z - move.from.z) * p };
}

export function isMoving(move: Move, now: number): boolean {
  return now < move.start + move.ms && Math.hypot(move.to.x - move.from.x, move.to.z - move.from.z) > 0.01;
}

export class ArenaDirector {
  reduced = false;
  robots: Record<PlayerId, RobotState>;
  cores: CoreState[];
  active: PlayerId | null = null;
  out = new Set<PlayerId>();
  winners: PlayerId[] = [];
  victoryAt = -Infinity;
  /** A beam from the actor to its target while it locks on. */
  lock: { from: PlayerId; to: Owner; start: number; until: number } | null = null;
  /** The robot working a challenge: holo terminal up, sparks spiralling. */
  charging: PlayerId | null = null;
  chargingAt = 0;
  shields: Partial<Record<PlayerId, number>> = {};
  flashes: Partial<Record<PlayerId, { at: number; color: string }>> = {};
  eliminatedAt: Partial<Record<PlayerId, number>> = {};
  shake = { at: -Infinity, strength: 0 };
  rings: Ring[] = [];
  /** Particle bursts waiting for the scene to spawn them. */
  bursts: Burst[] = [];
  /** For the wall screens: model names, the round, and what is happening now. */
  labels: Partial<Record<PlayerId, string>> = {};
  round: number | null = null;
  headline: { text: string; lane: PlayerId | null } | null = null;
  /** Screen anchors for the DOM tags, projected by the scene every frame. */
  anchors = new Map<Owner, HTMLElement>();
  /** The next steal/claim's carrier, set by `grab` and consumed by `setBoard`. */
  private pendingCarry: PlayerId | null = null;
  private carryUntil = 0;

  constructor() {
    const now = this.now();
    this.robots = Object.fromEntries(
      PLAYERS.map((p) => [p, { move: { from: homeOf(p), to: homeOf(p), start: now, ms: 0 }, pose: 'idle' as Pose, poseAt: now, face: 'centre' as Owner }]),
    ) as Record<PlayerId, RobotState>;
    this.cores = OPENING_OWNERS.map((owner) => ({ owner, carrier: null, carryUntil: 0, snap: 0 }));
  }

  now(): number {
    return typeof performance === 'undefined' ? 0 : performance.now();
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    if (reduced) this.settle(0);
  }

  // ── Robots ───────────────────────────────────────────────────────────────

  private moveTo(player: PlayerId, to: P2, ms: number): number {
    const now = this.now();
    const robot = this.robots[player];
    const from = positionAt(robot.move, now);
    const duration = this.reduced ? 0 : ms;
    robot.move = { from, to, start: now, ms: duration };
    return now + duration;
  }

  private pose(player: PlayerId, pose: Pose): void {
    const robot = this.robots[player];
    if (this.out.has(player) && pose !== 'down') return;
    robot.pose = pose;
    robot.poseAt = this.now();
  }

  /** Every robot that is still in walks home and stands easy. */
  settle(ms = 900, except: PlayerId | null = null): void {
    const now = this.now();
    for (const p of PLAYERS) {
      if (p === except || this.out.has(p)) continue;
      const robot = this.robots[p];
      const home = homeOf(p);
      if (Math.hypot(robot.move.to.x - home.x, robot.move.to.z - home.z) > 0.01 || (ms === 0 && isMoving(robot.move, now))) this.moveTo(p, home, ms);
      if (ms === 0 || robot.pose === 'hack' || robot.pose === 'think' || robot.pose === 'alert') this.pose(p, 'idle');
      robot.face = 'centre';
    }
  }

  /**
   * Called by the scene every frame: lets timed poses run out, and drops a
   * carried core onto its pad once its carrier is home.
   */
  tick(now: number): void {
    for (const p of PLAYERS) {
      const robot = this.robots[p];
      const since = now - robot.poseAt;
      const atRest = !isMoving(robot.move, now);
      const done =
        (robot.pose === 'carry' && atRest && now >= this.carryUntil) ||
        (robot.pose === 'cheer' && since > 2100) ||
        (robot.pose === 'fail' && since > 2200) ||
        (robot.pose === 'hit' && since > 1100) ||
        (robot.pose === 'shield' && since > 2200) ||
        (robot.pose === 'glitch' && since > 1700) ||
        (robot.pose === 'slump' && atRest && since > 1400 && this.winners.length === 0);
      if (done) this.pose(p, 'idle');
    }
    for (const core of this.cores) {
      if (core.carrier !== null && now >= core.carryUntil) {
        const p = core.carrier;
        core.carrier = null;
        this.burst({ at: [SPOT[p].x, 1, SPOT[p].z], color: CORE_COLOR, count: 45, speed: 2.5, up: 1.5 });
        this.ring(SPOT[p], LANE_COLOR[p], 900, 2);
      }
    }
  }

  /** Walk out to the reactor (a claim) or a rival's pad (a steal), beam locked on. */
  approach(actor: PlayerId, target: Owner, ms: number): void {
    this.settle(Math.min(ms, 900), actor);
    const robot = this.robots[actor];
    const reach = target === 'centre' ? toward(SPOT.centre, SPOT[actor], REACTOR_REACH) : toward(SPOT[target], SPOT[actor], RAID_REACH);
    this.moveTo(actor, reach, ms * 0.9);
    robot.face = target;
    this.pose(actor, 'idle');
    const now = this.now();
    this.lock = { from: actor, to: target, start: now, until: now + ms + 600 };
    if (target !== 'centre') {
      this.robots[target].face = actor;
      this.pose(target, 'alert');
    }
  }

  clearLock(): void {
    this.lock = null;
  }

  /** At the terminal: typing out the answer. */
  hack(actor: PlayerId): void {
    this.pose(actor, 'hack');
    this.setCharging(actor);
  }

  /** A live model call: the robot thinks at home, terminal up. */
  think(player: PlayerId | null): void {
    if (player !== null) {
      this.settle(700, player);
      this.moveTo(player, homeOf(player), 700);
      this.pose(player, 'think');
      this.robots[player].face = 'centre';
    }
    this.setCharging(player);
  }

  setCharging(player: PlayerId | null): void {
    if (player !== this.charging) this.chargingAt = this.now();
    this.charging = player;
  }

  verdict(actor: PlayerId, ok: boolean): void {
    this.setCharging(null);
    this.pose(actor, ok ? 'cheer' : 'fail');
    const at = this.robotPoint(actor, 1.3);
    this.burst({ at, color: ok ? GOOD : BAD, count: ok ? 70 : 50, speed: ok ? 3.2 : 4.5, up: ok ? 2 : 0.5 });
    this.ring(this.robotFloor(actor), ok ? GOOD : BAD, 900, 2.2);
    if (!ok) this.kick(0.12);
  }

  /** The challenge was won: pick the core up and carry it home. */
  grab(actor: PlayerId, from: Owner, ms: number): void {
    this.pose(actor, 'carry');
    this.pendingCarry = actor;
    const arrive = this.moveTo(actor, homeOf(actor), ms * 0.88);
    this.carryUntil = arrive;
    this.robots[actor].face = 'centre';
    if (from !== 'centre') this.impact(from);
    else this.burst({ at: [0, 2.1, 0], color: CORE_COLOR, count: 40, speed: 2.4, up: 1.5 });
  }

  /** The challenge was lost: trudge home empty-handed. */
  retreat(actor: PlayerId, ms: number): void {
    this.pose(actor, 'slump');
    this.moveTo(actor, homeOf(actor), ms * 0.95);
    this.robots[actor].face = 'centre';
    const victim = this.lock?.to;
    if (victim && victim !== 'centre') {
      this.pose(victim, 'shield');
      this.shields[victim] = this.now();
    }
  }

  impact(victim: PlayerId): void {
    this.pose(victim, 'hit');
    this.flashes[victim] = { at: this.now(), color: BAD };
    this.burst({ at: this.robotPoint(victim, 1), color: BAD, count: 60, speed: 5, up: 1 });
    this.ring(SPOT[victim], BAD, 700, 1.8);
    this.kick(0.22);
  }

  shield(player: PlayerId): void {
    this.settle(700, player);
    this.moveTo(player, homeOf(player), 700);
    this.pose(player, 'shield');
    this.shields[player] = this.now();
    this.ring(SPOT[player], LANE_COLOR[player], 900, 1.6);
  }

  glitch(player: PlayerId): void {
    this.settle(700, player);
    this.moveTo(player, homeOf(player), 700);
    this.pose(player, 'glitch');
    this.flashes[player] = { at: this.now(), color: BAD };
    this.burst({ at: this.robotPoint(player, 1.4), color: BAD, count: 30, speed: 2 });
  }

  eliminate(player: PlayerId): void {
    this.out.add(player);
    this.pose(player, 'down');
    this.eliminatedAt[player] = this.now();
    if (this.charging === player) this.setCharging(null);
    const at = this.robotPoint(player, 0.9);
    this.burst({ at, color: BAD, count: 120, speed: 7, up: 2 });
    this.burst({ at, color: '#ffffff', count: 40, speed: 3 });
    this.burst({ at, color: LANE_COLOR[player], count: 60, speed: 5, up: 3 });
    this.ring(SPOT[player], BAD, 1200, 4.5);
    this.ring(SPOT[player], '#ffffff', 800, 2.5);
    this.kick(0.45);
  }

  victory(winners: readonly PlayerId[]): void {
    this.winners = [...winners];
    this.victoryAt = this.now();
    this.clearLock();
    this.setCharging(null);
    for (const p of PLAYERS) {
      if (this.out.has(p)) continue;
      this.moveTo(p, homeOf(p), 900);
      this.robots[p].face = winners.includes(p) ? 'camera' : (winners[0] ?? 'centre');
      this.pose(p, winners.includes(p) ? 'win' : 'slump');
    }
    for (const w of winners) this.ring(SPOT[w], LANE_COLOR[w], 1400, 5);
  }

  setStatus(status: { active: PlayerId | null; out: ReadonlySet<PlayerId>; winners: readonly PlayerId[] }): void {
    this.active = status.active;
    for (const p of PLAYERS) {
      if (status.out.has(p) && !this.out.has(p)) {
        // Out without the animation (a skip, a reload): already down.
        this.out.add(p);
        this.robots[p].pose = 'down';
        this.robots[p].poseAt = this.now() - 10_000;
      } else if (!status.out.has(p) && this.out.has(p)) {
        this.out.delete(p);
        this.pose(p, 'idle');
      }
    }
    if (status.winners.length === 0 && this.winners.length > 0) {
      this.winners = [];
      this.victoryAt = -Infinity;
      this.settle(0);
    }
  }

  // ── Cores ───────────────────────────────────────────────────────────────

  setBoard(cores: Cores, centre: number, instant: boolean): void {
    const next = reassign(
      this.cores.map((c) => c.owner),
      cores,
      centre,
    );
    const now = this.now();
    next.forEach((owner, i) => {
      const core = this.cores[i]!;
      if (core.owner === owner) return;
      core.owner = owner;
      if (instant || this.reduced) {
        core.carrier = null;
        core.snap += 1;
      } else if (this.pendingCarry !== null && owner === this.pendingCarry) {
        core.carrier = owner;
        core.carryUntil = this.carryUntil;
      } else {
        core.carrier = null;
        core.carryUntil = now;
      }
    });
    if (!instant) this.pendingCarry = null;
  }

  // ── Effects ─────────────────────────────────────────────────────────────

  burst(b: Burst): void {
    if (this.reduced) return;
    this.bursts.push(b);
  }

  ring(at: P2, color: string, ms: number, radius: number): void {
    if (this.reduced) return;
    const now = this.now();
    this.rings = [...this.rings.filter((r) => now - r.start < r.ms), { at, color, start: now, ms, radius }];
  }

  kick(strength: number): void {
    if (this.reduced) return;
    this.shake = { at: this.now(), strength };
  }

  robotFloor(player: PlayerId): P2 {
    return positionAt(this.robots[player].move, this.now());
  }

  robotPoint(player: PlayerId, y: number): [number, number, number] {
    const p = this.robotFloor(player);
    return [p.x, y, p.z];
  }

  reset(): void {
    const fresh = new ArenaDirector();
    fresh.reduced = this.reduced;
    fresh.anchors = this.anchors;
    fresh.labels = this.labels;
    Object.assign(this, fresh);
  }
}
