/** Kairo steals movement history, archives a safe past position and lends out a cuttable clock hand. */
import { KAIRO_TEXT as T } from '../../data/text';
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleTo, clamp, dist, norm } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Boss, BossPart } from '../boss';
import { Bullet } from '../bullet';
import { archive, archiveOf } from '../arenas/archive';
import { replayMemory, type MemoryPattern, type TracePoint } from '../arenas/archiveMemory';
import type { World } from '../world';
import type { BossDef } from './registry';

const BASE_HP = 4700;
/** Boss-clock seconds between second-hand ticks, per phase (scaled by pace). */
const TICK = [1.05, 0.95, 0.8];
/** Every n-th tick is a chime: a fan of soft orbs instead of a needle. */
const CHIME = [4, 3, 3];
/** Boss-clock seconds before a tick during which its aim line shows. */
const TICK_WARN = 0.3;
const NEEDLE_SPEED = 160;
/** Total spread of the chime fan (P1, P2+). */
const CHIME_SPREAD = [0.66, 1.0];
/** Outer edge of the P2+ return swing band. */
const SWING_OUTER = 92;
/** Boss-clock delay of the leading "tock" needle after the aimed "tick" (P2+). */
const TOCK = 0.22;
/** Inside this range the ticks hold fire (the pendulum swing covers point-blank). */
const POINT_BLANK = 60;

/** A hard second-hand needle: drawn as a thin hand, deflectable by the blade and fist. */
class SecondNeedle extends Bullet {
  draw(g: Gfx): void {
    const a = Math.atan2(this.vy, this.vx), c = this.team === 'enemy' ? P.red : P.cyan;
    const tx = this.x - Math.cos(a) * 9, ty = this.y - Math.sin(a) * 9;
    g.circle(this.x, this.y, 5, this.team === 'enemy' ? COL.hard : P.cyan, 0.28, 'light');
    g.line(tx, ty, this.x, this.y, 3, P.ink, 0.9, 'top');
    g.line(tx, ty, this.x, this.y, 1, c, 1, 'top');
    g.circle(this.x, this.y, 1.5, P.white, 1, 'top');
  }
}

export class Kairo extends Boss {
  readonly id = 'kairo' as const;
  readonly name = T.name;
  readonly body: BossPart;
  private moveX = 0;
  private moveY = 0;
  private face = 0;
  private pose = 'idle1';
  private recording: TracePoint[] | null = null;
  private lesson: 'trace' | 'shutter' | null = null;
  private openingHaste = true;
  private nextTime: 'haste' | 'slow' = 'haste';
  private history: { x: number; y: number; t: number }[] = [];
  private sampleT = 0;
  private lastPick = '';
  private rewindCd = 6;
  private swingCd = 2;
  private layerCd = 0;
  private tickT = 0;
  private tockT = 0;
  private ticks = 0;
  private tickFlash = 0;
  private ticking = false;
  private intro = false;
  private introProgress = 0;

  constructor(w: World, tier: number) {
    super(w, tier, 320, 128, BASE_HP);
    this.poiseMax *= 1.3;
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, this.x, this.y, 13, 20, 16));
    this.body.conductive = true;
  }

  think(w: World, dt: number): void {
    if (w.state !== 'fight') { this.stop(); archiveOf(w)?.clearHostile(); }
    if (!this.staggered && !this.inTransition && (this.moveX || this.moveY)) {
      w.moveCircle(this.body, this.moveX * dt, this.moveY * dt, { ignore: this.body });
    }
    this.x = this.body.x; this.y = this.body.y;
    this.face = angleTo(this.x, this.y - 20, w.target().hx, w.target().hy);
    this.rewindCd = Math.max(0, this.rewindCd - dt);
    this.swingCd = Math.max(0, this.swingCd - dt);
    this.layerCd = Math.max(0, this.layerCd - dt);
    this.tickFlash = Math.max(0, this.tickFlash - dt);
    this.sampleT -= dt;
    if (this.sampleT <= 0) { this.sampleT = 0.15; this.history.push({ x: this.x, y: this.y, t: this.clock }); }
    while (this.history.length && this.history[0].t < this.clock - 4) this.history.shift();
    this.updateTicks(w, dt);
    const st = archiveOf(w);
    const guard = this.vulnMul < 1 ? T.guard : this.vulnMul > 1 ? T.exposed : '';
    this.status = [st?.time.label, guard, st?.rush?.label || (st?.stored ? T.stored : `${T.replay} ${st?.pending.filter(e => !e.dead).length ?? 0}/2`)].filter(Boolean).join(' · ');
  }

  /**
   * Steady pressure between set pieces: the second hand ticks on the boss clock, so it doubles in
   * haste and keeps full speed while a slow field drags the player. It holds still whenever a
   * set piece needs the player's full attention (rush beats, shutter, stop-watch hold, field charge).
   */
  private updateTicks(w: World, dt: number): void {
    const st = archiveOf(w), rush = st?.rush;
    this.ticking = !!st && w.state === 'fight' && !this.staggered && !this.inTransition && !this.dying && !this.intro
      && st.pauseT <= 0 && !st.time.charging && !st.shutterPending && !st.stops.length && st.hostileCount < 2
      && (!rush || rush.dead || rush.recovering);
    if (!this.ticking) { this.tockT = 0; this.tickT = Math.min(this.tickT, this.period - TICK_WARN - 0.05); return; }
    if (this.tockT > 0) {
      this.tockT -= dt;
      if (this.tockT <= 0 && this.distToTarget() > POINT_BLANK) { this.needle(this.tickAim(true)); w.sfx('click', 0.5, 1.2); }
    }
    this.tickT += dt;
    if (this.tickT < this.period) return;
    this.tickT = 0; this.ticks++; this.tickFlash = 0.12;
    // Point-blank belongs to the pendulum swing; the hand only ticks at range.
    if (this.distToTarget() <= POINT_BLANK) return;
    const chime = this.ticks % (CHIME[this.phase] ?? 3) === 0;
    if (chime) {
      const n = this.phase === 0 ? 4 : 6;
      this.fan(this.x, this.y - 30, this.tickAim(false), n, n === 4 ? CHIME_SPREAD[0] : CHIME_SPREAD[1], 105, { soft: true, frame: 'orb_m', glowColor: P.ice, life: 3.5 });
      w.sfx('lever', 0.5, 1.6);
      return;
    }
    // P1 alternates aimed and leading needles; P2+ and any slow field fire both as a tick-tock pair.
    const pair = this.paired;
    this.needle(this.tickAim(!pair && this.ticks % 2 === 1));
    w.sfx('click', 0.55, 1.5);
    if (pair) this.tockT = TOCK;
  }

  /**
   * Aimed needles go where the player is; leading ones take an intercept course on a moving
   * player, so running in a straight line is not a defence. The aim line shows the real direction.
   */
  private tickAim(lead: boolean): number {
    const t = this.w.target(), x = this.x, y = this.y - 30;
    if (!lead || this.w.decoy) return angleTo(x, y, t.hx, t.hy);
    const p = this.w.player, sp = NEEDLE_SPEED * this.bulletMul * this.w.bossRate;
    const ahead = Math.min(0.8, dist(x, y, p.hx, p.hy) / sp) * this.w.playerRate;
    return angleTo(x, y, p.hx + p.vx * ahead, p.hy + p.vy * ahead);
  }

  private get paired(): boolean { return this.phase >= 1 || archiveOf(this.w)?.time.mode === 'slow'; }
  private get period(): number { return this.tele(TICK[this.phase] ?? 0.8); }
  private get chimeNext(): boolean { return (this.ticks + 1) % (CHIME[this.phase] ?? 3) === 0; }

  private needle(a: number): void {
    const x = this.x, y = this.y - 30, sp = NEEDLE_SPEED * this.bulletMul;
    const b = new SecondNeedle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 'enemy');
    b.soft = false; b.r = 2.5; b.dmg = 1; b.life = 3; b.rotates = true; b.glow = 0;
    this.w.addBullet(b);
  }

  private stop(): void { this.moveX = this.moveY = 0; this.pose = 'idle1'; this.recording = null; }
  onStagger(w: World): void { this.stop(); this.vulnMul = 1; archiveOf(w)?.clearHostile(); archiveOf(w)?.time.interrupt(); }
  onDeath(w: World): void { this.stop(); this.vulnMul = 1; archiveOf(w)?.clearHostile(); archiveOf(w)?.time.interrupt(); }

  *entrance(w: World): Script {
    this.intro = true;
    const start = this.clock;
    try {
      w.sfx('charge', 0.8);
      while (this.clock - start < 2.4) {
        this.introProgress = (this.clock - start) / 2.4;
        yield;
      }
      w.fx.ring(this.x, this.y - 20, 8, 72, P.ice, 0.4, 2); w.sfx('emp');
    } finally {
      this.intro = false; this.introProgress = 0; this.stop(); this.invuln = false;
      this.x = this.body.x = 320; this.y = this.body.y = 128;
    }
  }

  *transition(w: World, phase: number): Script {
    this.stop(); archiveOf(w)?.clearHostile(); archiveOf(w)?.time.interrupt(); this.invuln = true;
    this.nextTime = phase === 1 ? 'slow' : 'haste';
    this.openingHaste = false;
    this.lesson = phase === 1 ? 'shutter' : null;
    try {
      w.fx.label(this.x, this.y - 62, phase === 1 ? T.phase2 : T.phase3, P.ice, 1.2);
      w.fx.ring(this.x, this.y - 20, 10, 90, P.cyan, 0.5, 3);
      yield* this.wait(0.75);
    } finally {
      this.invuln = false; this.vulnMul = 1; this.stop();
      if (phase >= 2) { const st = archiveOf(w); if (st) st.time.cooldown = 0; }
    }
  }

  private get timeReady(): boolean {
    return (this.phase > 0 || this.openingHaste) && !!archiveOf(this.w)?.time.ready;
  }

  private get close(): boolean { return this.swingCd <= 0 && this.distToTarget() < 64; }

  *brain(w: World): Script {
    yield* this.wait(0.5);
    for (;;) {
      const st = archiveOf(w);
      if (!st) { yield* this.approach(0.5); continue; }
      if (st.busy) {
        // Give a return-to-the-past challenge an unobstructed beat of its own.
        if (st.shutterPending) { yield* this.wait(0.2); continue; }
        if (st.time.mode !== 'haste' && this.close && st.hostileCount <= 1) { yield* this.pendulumSwing(); continue; }
        // A second, different original runs over a delayed replay (never more than two at once):
        // P1 only the stop-watch, P2+ the stop-watch or a new trace recording.
        if (st.layerable && this.layerCd <= 0 && st.pauseT <= 0 && st.time.mode !== 'haste'
          && !this.timeReady && !st.time.charging) {
          const echo = st.casts.find(c => !c.dead && !c.friendly)?.pattern.kind;
          const options = (this.phase === 0 ? ['stop'] : ['trace', 'stop']).filter(c => c !== echo && c !== this.lastPick);
          if (!options.length) { yield* this.approach(this.tele(0.3)); continue; }
          const choice = w.rng.pick(options);
          this.lastPick = choice; this.layerCd = 3;
          yield* this.attack(choice);
          continue;
        }
        if (this.phase >= 1 && this.rewindCd <= 0) yield* this.rewind();
        else yield* this.approach(this.tele(0.3));
        continue;
      }
      if (st.time.mode === 'haste') {
        if (st.time.remaining > 1.2 && st.pauseT <= 0) yield* this.hastePursuit();
        else yield* this.approach(this.tele(0.2));
        continue;
      }
      // P2 introduces the shutter; the opening and P3 start with haste instead.
      if (this.lesson) {
        const lesson = this.lesson; this.lesson = null; this.lastPick = lesson;
        yield* this.approach(this.tele(0.45));
        yield* this.attack(lesson);
        continue;
      }
      if (this.timeReady && st.pauseT <= 0) { yield* this.shiftTime(); continue; }
      yield* this.approach(this.tele(0.45));
      if (this.close) { yield* this.pendulumSwing(); continue; }
      const choices = this.phase === 0 ? ['trace', 'hand', 'stop'] : ['trace', 'hand', 'shutter', 'stop'];
      const choice = w.rng.pick(choices.filter(c => c !== this.lastPick));
      this.lastPick = choice;
      yield* this.attack(choice);
    }
  }

  private *attack(choice: string): Script {
    if (choice === 'trace') yield* this.stealFootsteps();
    else if (choice === 'shutter') yield* this.archiveShutter();
    else if (choice === 'stop') yield* this.stopWatch();
    else yield* this.borrowedHand();
    yield* this.wait(this.tele(0.65));
  }

  private steer(press = false): void {
    const t = this.w.target(), d = dist(this.x, this.y, t.x, t.y);
    const [nx, ny] = norm(t.x - this.x, t.y - this.y);
    // While recording she presses in, so a player who keeps running still drags the trace past her.
    const far = press ? 96 : 130, speed = press ? 112 : 96, orbit = press ? 54 : 44;
    const toward = d > far ? 1 : d < 70 ? -0.5 : 0;
    // Keep moving through a cast: acceleration changes her physical presence as well as timers.
    this.moveX = nx * toward * speed - ny * orbit;
    this.moveY = ny * toward * speed + nx * orbit;
    const b = this.w.bounds;
    if (this.x < b.x + 28 && this.moveX < 0 || this.x > b.x + b.w - 28 && this.moveX > 0) this.moveX *= -1;
    if (this.y < b.y + 28 && this.moveY < 0 || this.y > b.y + b.h - 28 && this.moveY > 0) this.moveY *= -1;
  }

  private *approach(seconds: number): Script {
    const end = this.clock + seconds;
    try { while (this.clock < end) { this.steer(); yield; } }
    finally { this.moveX = this.moveY = 0; }
  }

  private *shiftTime(): Script {
    const st = archiveOf(this.w), mode = this.phase === 0 ? 'haste' : this.phase === 1 ? 'slow' : this.nextTime;
    if (!st?.time.begin(mode, this.tele(1.3))) return;
    // Starting the opening wind-up spends its single use, even if the player interrupts it.
    if (this.phase === 0) this.openingHaste = false;
    this.stop(); this.pose = 'attack'; this.w.sfx('charge', 0.8);
    // The escapement guards her while she re-times the room: hits deal 60%.
    this.vulnMul = 0.6;
    let activated = false;
    try {
      while (st.time.charging) yield;
      activated = st.time.mode === mode;
      if (activated) this.nextTime = mode === 'haste' ? 'slow' : 'haste';
    } finally {
      if (!activated) st.time.restore();
      this.vulnMul = 1;
      this.stop();
    }
  }

  private *hastePursuit(): Script {
    const st = archiveOf(this.w);
    if (!st || st.time.mode !== 'haste') return;
    const rush = st.startRush(this.phase, this.pace);
    try {
      while (!rush.dead) {
        // After the last beat she is out of step: hits deal 130% until she recovers.
        if (rush.recovering) { this.moveX = this.moveY = 0; this.pose = 'hurt'; this.vulnMul = 1.3; }
        else { this.steer(); this.pose = 'attack'; }
        yield;
      }
    } finally { rush.cancel(); this.vulnMul = 1; this.stop(); }
  }

  private point(): TracePoint {
    const p = this.w.player;
    return { x: p.x, y: p.y - 4, z: p.z, frame: `${p.dir}_idle` };
  }

  /** Run originals together; each one that completes is recorded for its delayed replay if `replay[i]`. */
  private *playMemory(patterns: MemoryPattern[], warn: number, replay: boolean[] = patterns.map(() => true)): Script {
    const st = archiveOf(this.w);
    if (!st) return;
    const casts = patterns.map(p => st.cast(p, warn));
    const done = casts.map(() => false);
    const still = patterns.some(p => p.kind === 'shutter');
    const settle = (): void => {
      for (let i = 0; i < casts.length; i++) {
        if (done[i] || !casts[i].dead) continue;
        done[i] = true;
        if (casts[i].completed && replay[i]) st.record(replayMemory(patterns[i], this.phase));
      }
    };
    this.pose = 'attack';
    try {
      while (casts.some(c => !c.dead)) {
        if (!still) this.steer();
        else this.moveX = this.moveY = 0;
        settle();
        yield;
      }
      settle();
    } finally { for (const c of casts) c.cancel(); this.moveX = this.moveY = 0; this.pose = 'idle1'; }
  }

  private *stealFootsteps(): Script {
    const w = this.w, path: TracePoint[] = [this.point()];
    const start = this.clock, duration = this.tele(1.8);
    this.recording = path; this.pose = 'attack';
    let next = start + 0.06;
    w.sfx('charge', 0.5);
    try {
      while (this.clock - start < duration) {
        this.steer(true);
        if (this.clock >= next) {
          const p = this.point(), last = path[path.length - 1];
          p.cut = dist(last.x, last.y, p.x, p.y) > 40;
          path.push(p); next = this.clock + 0.06;
        }
        yield;
      }
      const end = this.point(), last = path[path.length - 1];
      end.cut = dist(last.x, last.y, end.x, end.y) > 40; path.push(end);
    } finally { this.recording = null; this.moveX = this.moveY = 0; this.pose = 'idle1'; }
    const p: MemoryPattern = { kind: 'trace', x: path[0].x, y: path[0].y, path,
      duration: Math.max(1.5, duration), copies: this.phase >= 2 ? 2 : 1 };
    yield* this.playMemory([p], this.tele(1.05));
  }

  private *archiveShutter(): Script {
    const w = this.w, st = archiveOf(w), p = w.player;
    const old = st?.pastPlayer() ?? { x: p.x, y: p.y - 4, distance: 0 };
    const pattern: MemoryPattern = { kind: 'shutter', x: old.x, y: old.y, r: 52 };
    const rates = st?.time.rates ?? { player: 1, boss: 1 };
    // Return along the distance actually travelled, including detours around racks. The same
    // warning remains reachable in a slow field and keeps its real duration during haste.
    const journey = Math.max(0, old.distance - 32) / (118 * Math.min(1, p.moveMul) * rates.player) + 0.8;
    const warn = Math.max(this.tele(2.4), Math.max(1.8, journey) * rates.boss);
    w.sfx('telegraph');
    yield* this.playMemory([pattern], warn);
  }

  /**
   * P1: the second hand alone. P2+: the minute hand (longer, thicker, slower) starts on the far
   * side of the player and sweeps the other way, so the two close a wedge; one of them must be
   * jumped or dashed. P3 also replays the minute hand.
   */
  private *borrowedHand(): Script {
    const x = 320, y = 198, span = Math.PI * 1.25;
    const target = angleTo(x, y, this.w.target().hx, this.w.target().hy);
    const second: MemoryPattern = { kind: 'hand', x, y, r: 132, a: target - span / 2, sweep: span, duration: 2.7 };
    this.w.sfx('charge', 0.7);
    if (this.phase === 0) { yield* this.playMemory([second], this.tele(1.15)); return; }
    const minute: MemoryPattern = { kind: 'hand', x, y, r: 196, a: target + span / 2, sweep: -Math.PI, duration: 3.4, hw: 7, minute: true };
    yield* this.playMemory([second, minute], this.tele(1.3), [true, this.phase >= 2]);
  }

  /**
   * Stop-watch: a ring on the player's projected spot; whoever is inside when it closes is held,
   * then struck. From P2 a second ring follows on wherever the player went, unless the first caught them.
   */
  private *stopWatch(): Script {
    const w = this.w, st = archiveOf(w);
    if (!st) return;
    const r = [46, 50, 54][this.phase] ?? 54;
    // The ring lands where a player who keeps going would be when it closes (at most 110 px
    // ahead): running straight on is the mistake, a turn or a stop is the answer.
    const place = (lead: number): [number, number] => {
      const t = w.target(), p = w.player, real = lead * w.playerRate;
      let dx = w.decoy ? 0 : p.vx * real, dy = w.decoy ? 0 : p.vy * real;
      const d = Math.hypot(dx, dy);
      if (d > 110) { dx *= 110 / d; dy *= 110 / d; }
      return w.clampToBounds(t.x + dx, t.y - 4 + dy, r * 0.5);
    };
    // Walking out from the centre stays possible in a slow field: radius / player speed + 0.45 s.
    const reach = (r + 4) / (118 * Math.min(1, w.player.moveMul) * w.playerRate) + 0.45;
    const first = Math.max(this.tele(1.15), reach * w.bossRate);
    let [x, y] = place(first / Math.max(0.1, w.bossRate));
    let s = st.startStop(x, y, r, first);
    this.pose = 'attack';
    try {
      while (!s.dead) { this.steer(); yield; }
      if (this.phase >= 1 && !s.caughtPlayer && !this.staggered) {
        const second = Math.max(this.tele(0.9), reach * w.bossRate);
        [x, y] = place(second / Math.max(0.1, w.bossRate));
        s = st.startStop(x, y, r, second);
        while (!s.dead) { this.steer(); yield; }
      }
    } finally { s.cancel(); this.moveX = this.moveY = 0; this.pose = 'idle1'; }
  }

  /**
   * Close-range answer: the chest pendulum swings a full circle around her (radius 58). From P2
   * it swings back wider 0.35 s later: a band from 58 to 92 px, so stepping just outside the first
   * swing is not enough (step in again after the first, keep going, or dash through the band).
   */
  private *pendulumSwing(): Script {
    const w = this.w, warn = Math.max(this.tele(0.62), w.bossRate * 0.7), r = 58;
    this.stop(); this.pose = 'attack'; this.swingCd = 4.5;
    const x = this.x, y = this.y - 4, back = this.phase >= 1;
    const st = archiveOf(w);
    const h = this.hazard({ k: 'circle', x, y, r }, warn, 0.12);
    const h2 = back ? this.hazard({ k: 'ring', x, y, r: (r + SWING_OUTER) / 2, w: SWING_OUTER - r }, warn + 0.35, 0.12) : null;
    if (st) { st.swing = h; st.swingBack = h2; }
    w.sfx('charge', 0.45, 1.4);
    try {
      yield* this.wait(warn);
      w.fx.ring(x, y, 8, r, P.ice, 0.2, 2); w.sfx('slash', 0.7, 0.7);
      this.pose = 'hurt';
      if (back) {
        yield* this.wait(0.35);
        w.fx.ring(x, y, r, SWING_OUTER, P.ice, 0.2, 2); w.sfx('slash', 0.7, 0.6);
      }
      yield* this.wait(this.tele(0.55));
    } finally { this.pose = 'idle1'; }
  }

  private *rewind(): Script {
    const w = this.w;
    const at = this.history.find(p => p.t >= this.clock - 3) ?? { x: this.x, y: this.y };
    const [x, y] = w.clampToBounds(at.x, at.y, 24);
    this.rewindCd = 7;
    const warn = this.tele(1.0);
    this.hazard({ k: 'circle', x, y: y - 4, r: 24 }, warn, 0.12, h => { h.hitsPlayer = false; h.color = P.cyan; h.marker = true; });
    try {
      this.pose = 'hurt'; w.sfx('charge', 0.5); yield* this.wait(warn);
      this.invuln = true;
      w.fx.ghost('kairo', 'idle1', this.x, this.y + 6, { flipX: Math.cos(this.face) < 0, tint: P.cyan, alpha: 0.6 }, 0.3);
      this.body.x = x; this.body.y = y; w.moveCircle(this.body, 0, 0, { ignore: this.body });
      this.x = this.body.x; this.y = this.body.y;
      w.fx.ring(x, y - 20, 4, 35, P.cyan, 0.25, 2); w.sfx('blink');
      yield* this.wait(0.15);
    } finally { this.invuln = false; this.pose = 'idle1'; }
    yield* this.wait(this.tele(0.7));
  }

  draw(g: Gfx): void {
    g.ellipse(this.x, this.y + 1, 17, 7, P.ink, 0.5);
    const frame = this.body.flash > 0 || this.staggered ? 'hurt' : this.pose === 'idle1' ? (Math.floor(this.clock * 4) % 2 ? 'idle2' : 'idle1') : this.pose;
    if (this.intro) {
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 - this.introProgress * Math.PI * 2;
        const r = 52 * (1 - this.introProgress);
        g.img('kairo', 'idle1', this.x + Math.cos(a) * r, this.y + 6 + Math.sin(a) * r * 0.5,
          { alpha: 0.25 + this.introProgress * 0.15, tint: P.cyan, flipX: true });
      }
    }
    if (archiveOf(this.w)?.time.mode === 'haste' && !this.staggered) {
      const count = Math.min(4, this.history.length);
      for (let i = 0; i < count; i++) {
        const q = this.history[this.history.length - count + i];
        if (dist(q.x, q.y, this.x, this.y) < 3) continue;
        g.img(this.phase >= 1 ? 'kairo_broken' : 'kairo', frame, q.x, q.y + 6,
          { flipX: Math.cos(this.face) < 0, tint: P.amber, alpha: 0.07 + i * 0.045 });
      }
    }
    g.img(this.phase >= 1 ? 'kairo_broken' : 'kairo', frame, this.x, this.y + 6,
      { flipX: Math.cos(this.face) < 0, alpha: this.intro ? this.introProgress : 1, fill: this.body.flash > 0 ? P.pale : undefined });
    g.circle(this.x, this.y - 35, 12, this.phase >= 2 ? P.magenta : P.cyan, 0.14, 'light');
    if (this.vulnMul < 1) g.ring(this.x, this.y - 22, 22, 2, P.ice, 0.7, 'top');
    else if (this.vulnMul > 1) for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + this.clock * 2;
      g.line(this.x + Math.cos(a) * 18, this.y - 22 + Math.sin(a) * 18, this.x + Math.cos(a) * 24, this.y - 22 + Math.sin(a) * 24, 2, P.amber, 0.8, 'top');
    }
    this.drawTicker(g);
    if (this.recording) {
      for (let i = 1; i < this.recording.length; i++) {
        const a = this.recording[i - 1], b = this.recording[i];
        if (!b.cut) g.line(a.x, a.y, b.x, b.y, 1, P.cyan, 0.7, 'top');
        if (i % 3 === 0) g.img('pc_echo', b.frame, b.x, b.y + 4 - b.z, { layer: 'top', tint: P.cyan, alpha: 0.18 });
      }
      g.crisp(T.recording, this.x, this.y - 72, { color: P.cyan, layer: 'top', align: 'center' });
      g.circle(this.w.player.x, this.w.player.y - 9, 8 + Math.sin(this.clock * 8), P.cyan, 0.1, 'light');
    }
    if (this.staggered) g.ring(this.x, this.y - 60, 11, 2, P.amber, 0.8, 'top');
  }

  /** Small dial over her head: the hand advances one step per tick; the chime tick is announced in amber. */
  private drawTicker(g: Gfx): void {
    if (!this.ticking) return;
    const cx = this.x, cy = this.y - 58, period = this.period;
    const chime = this.chimeNext, soon = this.tickT > period - TICK_WARN;
    const color = this.tickFlash > 0 ? P.white : soon ? (chime ? P.amber : P.red) : P.fog;
    g.circle(cx, cy, 6, P.night, 0.8, 'top');
    g.ring(cx, cy, 6, 1, color, 0.9, 'top');
    const a = (this.ticks % 12) * Math.PI / 6 - Math.PI / 2 + clamp(this.tickT / period, 0, 1) * 0.15;
    g.line(cx, cy, cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, 1, color, 1, 'top');
    if (soon && this.distToTarget() > POINT_BLANK) {
      // The real aim lines for the last beat before the tick: one or two needles, or the fan's edges.
      const pair = this.paired, aim = this.tickAim(!pair && !chime && (this.ticks + 1) % 2 === 1), len = 90;
      const edge = (this.phase === 0 ? CHIME_SPREAD[0] : CHIME_SPREAD[1]) / 2;
      const offs = chime ? [-edge, edge] : [0];
      const angles = offs.map(o => aim + o);
      if (!chime && pair) angles.push(this.tickAim(true));
      for (const a of angles) {
        g.line(this.x, this.y - 30, this.x + Math.cos(a) * len, this.y - 30 + Math.sin(a) * len, 1, chime ? P.amber : P.red, 0.45, 'top');
      }
    }
  }
}

export const kairoDef: BossDef = {
  id: 'kairo', arena: archive, spawn: { x: 320, y: 128 }, make: (w, tier) => new Kairo(w, tier),
  drop: 'head_reflex', hint: T.hint, portrait: { key: 'standee', frame: 'kairo' },
  music: { bpm: 120, kick: 'x.......x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.',
    bass: [0, null, 7, null, 0, null, 3, null, 0, null, 10, null, 7, null, 3, null],
    lead: [12, null, null, 19, null, null, 15, null, 12, null, 10, null, null, null, 7, null],
    root: 38, chords: [0, 0, 3, 7], wave: 'triangle' },
};
