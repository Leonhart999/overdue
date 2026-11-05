/**
 * MADAME LUX — holo-idol loan shark on the Neon Bazaar club stage. Floats, splits into clones.
 *
 * P1 (100-65%) : 2 clones. Kiss (heart-shaped soft burst), fan (5 rotating streams), swap (she and a
 *                clone flash and trade places), spot flare (punishes standing in a spotlight).
 * P2 (65-30%)  : 3 clones. Spotlight laser from a stage mark: snapped to 8 directions, 1 s telegraph
 *                with the full reflected path; mirrors bounce it, a reflection that crosses her deals
 *                300 + 75 poise, any segment pops clones. Below 45% the last laser sweeps. Floor full on.
 * P3 (<=30%)   : Encore at the stage centre: heals 2%/s (never above 30%) while spiralling hearts.
 *                Poise gain x3 during the encore; a blackout or a full poise break interrupts it.
 *
 * Real vs clone: only the real Lux casts a shadow in a spotlight (clones turn see-through there),
 * clones flicker now and then, are tied to a projector by a faint beam, can be walked through and
 * glitch out in one hit without touching her HP. Their bullets are real.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleTo, clamp, dist, norm, segDist } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Boss, BossPart, type HitTag } from '../boss';
import { club, findStage, MARKS, STAGE_CENTRE, traceBeam, type BeamPath, type ClubStage, type Hologram, type PopReason, type Projector, type StageListener } from '../arenas/club';
import { shapeHits, type Hit } from '../types';
import type { World } from '../world';
import type { BossDef } from './registry';

type Anim = 'idle' | 'cast' | 'kiss' | 'hurt';

const BASE_HP = 3250;
const HEART = { frame: 'heart', glowColor: P.magenta, r: 3.5, life: 5 };
/** Chest height of the figure above its ground point. */
const CHEST = 30;

interface LaserState {
  path: BeamPath;
  warn: boolean;
  prog: number;
  /** First segment index that crosses Lux (-1 = none). */
  selfIdx: number;
  sweep: number;
  a0: number;
}

class LuxClone extends BossPart implements Hologram {
  state: 'in' | 'live' | 'glitch' = 'in';
  t = 0;
  tx: number;
  ty: number;
  shotT = 0;
  private glitchAt: number;
  constructor(public lux: Lux, public proj: Projector, x: number, y: number) {
    super(lux, x, y, 10, 28, 12);
    this.solid = false;
    this.tx = x; this.ty = y;
    this.glitchAt = 1 + (this.id % 7) * 0.3;
  }
  get live(): boolean { return !this.dead && this.state !== 'glitch'; }

  pop(w: World, why: PopReason): void {
    if (this.dead || this.state === 'glitch') return;
    this.state = 'glitch';
    this.t = 0;
    this.targetable = false;
    if (this.proj.link === this) this.proj.link = null;
    if (why === 'hit' || why === 'beam') this.proj.respawnT = Math.max(this.proj.respawnT, this.lux.phase === 0 ? 5 : 4);
    w.fx.burst(this.hx, this.hy, 12, P.cyan, 90, 0.35, 2);
    w.fx.burst(this.hx, this.hy, 8, P.magenta, 70, 0.3, 2);
    w.sfx('zap', 0.7, 1.3);
    w.sfx('pop');
  }

  hurt(w: World, h: Hit): number {
    if (h.from !== 'enemy') this.pop(w, 'hit');
    return 0;
  }

  update(w: World, dt: number): void {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.state === 'in' && this.t > 0.5) { this.state = 'live'; this.t = 0; }
    if (this.state === 'glitch') { if (this.t > 0.3) this.dead = true; return; }
    if (this.lux.dying) { this.pop(w, 'end'); return; }
    if (!this.lux.staggered) {
      const d = dist(this.x, this.y, this.tx, this.ty);
      if (d > 1) {
        const step = Math.min(d, this.lux.glideSpeed * 1.1 * dt);
        this.x += ((this.tx - this.x) / d) * step;
        this.y += ((this.ty - this.y) / d) * step;
      }
    }
    this.glitchAt -= dt;
    if (this.glitchAt < -0.09) this.glitchAt = 1.2 + w.rng.next() * 2.2;
  }

  /** Short flicker every couple of seconds (one of the clone tells). */
  get flickering(): boolean { return this.glitchAt < 0; }

  draw(g: Gfx, w: World): void { this.lux.drawFigure(g, w, this); }
}

export class Lux extends Boss implements StageListener {
  readonly id = 'lux' as const;
  readonly name = '卢克丝夫人';
  readonly body: BossPart;
  readonly stage: ClubStage | null;
  clones: LuxClone[] = [];
  anim: Anim = 'idle';
  animClock = 0;
  facing = 1;
  encore = false;
  private encoreCd = 0;
  private healShown = 0;
  private laser: LaserState | null = null;
  private lastPick = '';

  constructor(w: World, tier: number, x: number, y: number) {
    super(w, tier, x, y, BASE_HP);
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, x, y, 10, 28, 12));
    this.stage = findStage(w);
    if (this.stage) this.stage.listener = this;
  }

  get r(): number { return this.body.r; }
  get glideSpeed(): number { return [70, 85, 95][this.phase] ?? 95; }
  private liveClones(): LuxClone[] { return this.clones.filter((c) => c.live && c.state === 'live'); }

  // ------------------------------------------------------------------ hits
  modHit(w: World, _part: BossPart, h: Hit): { mul: number; tag: HitTag } {
    // spotlight bonus: player.dmgMul is recomputed inside Player.update, so it is applied here
    const lit = h.from === 'player' && !!this.stage?.inLight(w.player.x, w.player.y);
    return { mul: lit ? 1.25 : 1, tag: 'normal' };
  }

  addPoise(w: World, amount: number): void {
    super.addPoise(w, this.encore ? amount * 3 : amount);
  }

  onBlackout(w: World): void {
    if (this.dying) return;
    if (this.encore && !this.staggered) {
      this.encore = false;
      this.encoreCd = 14;
      w.fx.label(this.x, this.y - 66, '安可中断', P.amber, 1.2);
      this.stagger(w, 2.5);
    }
  }

  onStagger(): void {
    this.encore = false;
    this.laser = null;
    this.anim = 'hurt';
  }
  onStaggerEnd(): void { this.anim = 'idle'; }

  onDeath(w: World): void {
    this.laser = null;
    this.encore = false;
    for (const c of this.clones) c.pop(w, 'end');
    if (this.stage) { this.stage.floorMode = 'off'; this.stage.stopFloor(); }
  }

  // ------------------------------------------------------------------ per-step
  think(w: World, dt: number): void {
    this.animClock += dt;
    const st = this.stage;
    if (st) {
      st.floorMode = this.dying ? 'off' : this.encore ? 'encore' : this.phase === 0 ? 'light' : 'full';
      this.vulnMul = st.dark ? 1.5 : 1;
    }
    if (this.staggered) this.laser = null;
    this.manageClones(w);
    if (this.encore && !this.staggered) {
      const cap = this.maxHp * this.thresholds[1];
      const before = this.hp;
      this.hp = Math.min(Math.max(this.hp, cap), this.hp + 0.02 * this.maxHp * dt);
      this.healShown += this.hp - before;
      if (this.healShown >= 15) { w.fx.number(9001, this.x, this.y - 50, this.healShown, P.acid); this.healShown = 0; }
    } else if (this.phase >= 2 && this.encoreCd > 0) this.encoreCd -= dt;
    // keep the player out of her ground circle
    const p = w.player;
    const d = dist(p.x, p.y, this.x, this.y);
    if (d < this.body.r + p.r && !p.airborne) {
      const [nx, ny] = norm(p.x - this.x, p.y - this.y);
      p.x = this.x + nx * (this.body.r + p.r);
      p.y = this.y + ny * (this.body.r + p.r);
    }
    const t = w.target();
    if (Math.abs(t.x - this.x) > 6) this.facing = t.x < this.x ? -1 : 1;
    this.updateStatus(w);
  }

  private updateStatus(w: World): void {
    const s: string[] = [`分身 ${this.clones.filter((c) => c.live).length}`];
    if (this.stage?.dark) s.push('断电 ×1.5');
    if (this.encore) s.push('安可 回复中');
    if (this.stage?.inLight(w.player.x, w.player.y)) s.push('追光 +25%');
    this.status = s.join(' · ');
  }

  private manageClones(w: World): void {
    const st = this.stage;
    this.clones = this.clones.filter((c) => !c.dead);
    if (!st || this.dying || st.dark || w.state !== 'fight') return;
    const want = [2, 3, 3][this.phase] ?? 3;
    if (this.clones.filter((c) => c.live).length >= want) return;
    const free = st.projectors.filter((p) => p.ready);
    if (!free.length) return;
    const proj = w.rng.pick(free);
    const [x, y] = this.pickSpot();
    const c = new LuxClone(this, proj, x, y);
    c.shotT = w.rng.range(0, 1);
    proj.link = c;
    w.add(c);
    this.clones.push(c);
    w.fx.burst(c.hx, c.hy, 10, P.cyan, 60, 0.35, 1);
    w.sfx('blink', 0.4, 1.3);
  }

  /** A floating spot away from the player, mirrors and the other figures. */
  /** `from`: keep the new spot within ~150 px of it (Lux hops, she does not cross the room). */
  private pickSpot(from?: { x: number; y: number }): [number, number] {
    const w = this.w, p = w.player, rng = w.rng;
    let best: [number, number] = [this.x, this.y], bs = -Infinity;
    for (let i = 0; i < 14; i++) {
      const x = rng.range(64, 576), y = rng.range(86, 250);
      const d = dist(x, y, p.x, p.y);
      let s = -Math.abs(d - (from ? 95 : 130)) + (d < 70 ? -300 : 0);
      let near = 999;
      for (const c of this.clones) if (c.live) near = Math.min(near, dist(x, y, c.tx, c.ty));
      if (!from) near = Math.min(near, dist(x, y, this.x, this.y));
      s += Math.min(near, 120) * 0.6;
      for (const m of this.stage?.mirrors ?? []) if (dist(x, y, m.x, m.y) < 30) s -= 400;
      if (from) s -= Math.max(0, dist(x, y, from.x, from.y) - 150) * 1.5;
      if (s > bs) { bs = s; best = [x, y]; }
    }
    return best;
  }

  private *glideTo(tx: number, ty: number, speed: number, maxT: number): Script {
    const end = this.clock + maxT;
    let last = this.clock;
    while (this.clock < end) {
      const dt = this.clock - last;
      last = this.clock;
      const d = dist(this.x, this.y, tx, ty);
      if (d < 2) break;
      const step = Math.min(d, speed * dt);
      this.w.moveCircle(this, ((tx - this.x) / d) * step, ((ty - this.y) / d) * step, { ignore: this.body });
      this.body.x = this.x; this.body.y = this.y;
      yield;
    }
  }

  private *reposition(dur: number): Script {
    for (const c of this.clones) if (c.live) [c.tx, c.ty] = this.pickSpot();
    const [x, y] = this.pickSpot(this);
    yield* this.glideTo(x, y, this.glideSpeed, dur);
  }

  /** Lux plus every live clone: everyone performs the same move. */
  private casters(): { x: number; y: number; clone: LuxClone | null }[] {
    return [{ x: this.x, y: this.y, clone: null }, ...this.liveClones().map((c) => ({ x: c.x, y: c.y, clone: c }))];
  }

  private cloneShots(dt: number, every: number): void {
    for (const c of this.liveClones()) {
      c.shotT -= dt;
      if (c.shotT > 0) continue;
      c.shotT = every;
      this.shoot(c.x, c.y - CHEST, this.aimFrom(c.x, c.y - CHEST), 105, HEART);
    }
  }

  // ------------------------------------------------------------------ brain
  *brain(w: World): Script {
    yield* this.wait(0.7);
    for (;;) {
      if (this.phase >= 2 && this.encoreCd <= 0) { yield* this.encoreRoutine(); continue; }
      yield* this.reposition(this.tele(this.phase === 0 ? 1.0 : 0.8) + w.rng.range(0, 0.4));
      yield* this.wait(this.tele(0.2));
      const ph = this.phase;
      const lit = !!this.stage?.inLight(w.player.x, w.player.y);
      const options: [string, number][] = [
        ['kiss', 3],
        ['fan', 2.2],
        ['swap', this.liveClones().length ? (ph === 0 ? 2 : 1.2) : 0],
        ['flare', lit ? 3 : 0],
        ['laser', ph >= 1 ? 3.5 : 0],
      ];
      for (const o of options) if (o[0] === this.lastPick) o[1] *= 0.25;
      const pick = w.rng.weighted(options);
      this.lastPick = pick;
      switch (pick) {
        case 'kiss': yield* this.kiss(); break;
        case 'fan': yield* this.fanAttack(); break;
        case 'swap': yield* this.swap(); break;
        case 'flare': yield* this.flare(); break;
        case 'laser': yield* this.laserAttack(this.tier >= 3 ? 3 : 2); break;
      }
    }
  }

  *transition(w: World, phase: number): Script {
    this.laser = null;
    this.encore = false;
    this.invuln = true;
    this.anim = 'cast';
    w.fx.ring(this.x, this.y - CHEST, 6, 60, P.magenta, 0.5, 3);
    if (phase === 1) {
      w.fx.label(this.x, this.y - 66, '聚光激光 · 舞池全开', P.rose, 1.6);
      yield* this.wait(1.0);
    } else {
      w.fx.label(this.x, this.y - 66, '安可', P.rose, 1.6);
      this.encoreCd = 0;
      yield* this.wait(0.6);
    }
    this.invuln = false;
    this.anim = 'idle';
  }

  // ------------------------------------------------------------------ attacks
  private heartBurst(x: number, y: number, n: number, speed: number, aim: number): void {
    const rot = aim - Math.PI / 2, c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const hx = 16 * Math.sin(t) ** 3;
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      const vx = (hx * c - hy * s) / 17, vy = (hx * s + hy * c) / 17;
      const k = Math.max(0.3, Math.hypot(vx, vy));
      this.shoot(x, y, Math.atan2(vy, vx), speed * k, HEART);
    }
  }

  private *kiss(): Script {
    const w = this.w;
    this.anim = 'kiss';
    w.sfx('telegraph', 0.8, 1.3);
    const wind = this.tele(0.6);
    const end = this.clock + wind;
    while (this.clock < end) {
      for (const c of this.casters()) if (w.rng.chance(0.3)) w.fx.sparks(c.x + this.facing * 4, c.y - 36, 1, P.rose, 40);
      yield;
    }
    const bursts = this.phase === 0 ? 1 : 2;
    for (let b = 0; b < bursts; b++) {
      for (const c of this.casters()) {
        const ox = c.x, oy = c.y - CHEST;
        this.heartBurst(ox, oy, c.clone ? 12 : 22, 82, this.aimFrom(ox, oy) + (b ? 0.25 : 0));
      }
      w.sfx('spray', 0.8, 1.4);
      yield* this.wait(0.45);
    }
    this.anim = 'idle';
    yield* this.wait(this.tele(0.6));
  }

  private *fanAttack(): Script {
    const w = this.w;
    this.anim = 'cast';
    const arms = this.phase === 0 ? 5 : 6;
    const ox = this.x, oy = this.y - CHEST;
    let base = this.aimFrom(ox, oy) + Math.PI / arms;
    const dir = w.rng.chance(0.5) ? 1 : -1;
    const warn = this.tele(0.7);
    for (let k = 0; k < arms; k++) {
      const a = base + (k * Math.PI * 2) / arms;
      this.hazard({ k: 'line', x1: ox, y1: oy, x2: ox + Math.cos(a) * 70, y2: oy + Math.sin(a) * 70, w: 6 }, warn, 0, (h) => { h.hitsPlayer = false; });
    }
    w.sfx('telegraph');
    yield* this.wait(warn);
    const dur = 2.4, gap = 0.12, spin = 0.8 * dir;
    const end = this.clock + dur;
    let next = this.clock, last = this.clock;
    while (this.clock < end) {
      const dt = this.clock - last;
      last = this.clock;
      base += spin * dt;
      while (this.clock >= next) {
        for (let k = 0; k < arms; k++) this.shoot(this.x, this.y - CHEST, base + (k * Math.PI * 2) / arms, 105, { frame: 'orb_m', glowColor: P.magenta });
        next += gap;
        w.sfx('spray', 0.35, 1.6);
      }
      this.cloneShots(dt, 0.6);
      yield;
    }
    this.anim = 'idle';
    yield* this.wait(this.tele(0.7));
  }

  private *swap(): Script {
    const w = this.w;
    const cl = this.liveClones();
    if (!cl.length) return;
    let c = cl[0];
    for (const o of cl) if (dist(o.x, o.y, w.player.x, w.player.y) < dist(c.x, c.y, w.player.x, w.player.y)) c = o;
    this.anim = 'cast';
    const warn = this.tele(0.55);
    const ring = (x: number, y: number) => this.hazard({ k: 'circle', x, y: y - CHEST, r: 16 }, warn, 0, (h) => { h.hitsPlayer = false; h.color = P.magenta; });
    ring(this.x, this.y);
    ring(c.x, c.y);
    w.sfx('telegraph', 0.6, 1.6);
    yield* this.wait(warn);
    if (!c.live) { this.anim = 'idle'; return; }
    w.fx.ghost('lux', 'cast', this.x, this.y - 4, { tint: P.rose, alpha: 0.5, flipX: this.facing < 0 }, 0.35);
    const [ax, ay] = [this.x, this.y];
    this.x = c.x; this.y = c.y;
    c.x = ax; c.y = ay; c.tx = ax; c.ty = ay;
    this.w.moveCircle(this, 0, 0, { ignore: this.body });
    this.body.x = this.x; this.body.y = this.y;
    w.fx.burst(this.x, this.y - CHEST, 10, P.rose, 80, 0.3, 1);
    w.fx.burst(c.x, c.y - CHEST, 10, P.rose, 80, 0.3, 1);
    w.sfx('blink');
    yield* this.wait(this.tele(0.25));
    for (const k of this.casters()) {
      const ox = k.x, oy = k.y - CHEST;
      this.fan(ox, oy, this.aimFrom(ox, oy), 3, 0.4, 125, HEART);
    }
    w.sfx('spray', 0.7, 1.5);
    this.anim = 'idle';
    yield* this.wait(this.tele(0.55));
  }

  private *flare(): Script {
    const w = this.w;
    const s = this.stage?.inLight(w.player.x, w.player.y);
    if (!s) return;
    this.anim = 'cast';
    const warn = this.tele(0.85);
    s.freeze = Math.max(s.freeze, warn + 0.5);
    s.flare = warn + 0.25;
    this.hazard({ k: 'circle', x: s.x, y: s.y, r: s.r }, warn, 0.2, (h) => {
      h.onActivate = (ww) => {
        ww.fx.glow(s.x, s.y - 6, s.r + 8, P.amber, 0.3);
        ww.fx.sparks(s.x, s.y - 4, 16, P.amber, 140);
        ww.sfx('zap');
      };
    });
    w.sfx('telegraph', 0.8, 0.9);
    yield* this.wait(warn + 0.2);
    this.anim = 'idle';
    yield* this.wait(this.tele(0.45));
  }

  // ---------------------------------------------------------------- laser
  private trace(a: number): BeamPath {
    return traceBeam(this.w, this.stage?.mirrors ?? [], this.x, this.y, a);
  }

  /** First segment (after a reflection) that crosses Lux, or -1. */
  private selfCross(path: BeamPath): number {
    const pts = path.pts;
    for (let i = 1; i < pts.length - 1; i++) {
      if (segDist(this.x, this.y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < 16) return i;
    }
    return -1;
  }

  private *laserAttack(count: number): Script {
    const w = this.w;
    // go to a stage mark (they line up with the mirrors)
    const p = w.player;
    const marks = [...MARKS].sort((a, b) => dist(a[0], a[1], this.x, this.y) - dist(b[0], b[1], this.x, this.y));
    const mark = marks.find((m) => dist(m[0], m[1], p.x, p.y) > 80) ?? marks[0];
    for (const c of this.clones) if (c.live) [c.tx, c.ty] = this.pickSpot();
    this.anim = 'cast';
    yield* this.glideTo(mark[0], mark[1], 170, 1.6);
    for (let i = 0; i < count; i++) {
      const sweep = i === count - 1 && (this.phase >= 2 || this.hp < this.maxHp * 0.45);
      const t = w.target();
      const a = Math.round(angleTo(this.x, this.y, t.x, t.y) / (Math.PI / 4)) * (Math.PI / 4);
      const span = sweep ? 0.55 * (w.rng.chance(0.5) ? 1 : -1) : 0;
      const warn = this.tele(1.0);
      w.sfx('telegraph', 1, 0.7);
      const wEnd = this.clock + warn;
      while (this.clock < wEnd) {
        const path = this.trace(a);
        this.laser = { path, warn: true, prog: 1 - (wEnd - this.clock) / warn, selfIdx: this.selfCross(path), sweep: span, a0: a };
        yield;
      }
      w.sfx('laser');
      const dur = sweep ? 1.6 : 0.4;
      const start = this.clock;
      let selfHit = false;
      while (this.clock < start + dur) {
        const f = (this.clock - start) / dur;
        const path = this.trace(a + span * f);
        const selfIdx = this.selfCross(path);
        this.laser = { path, warn: false, prog: f, selfIdx, sweep: span, a0: a };
        this.beamHits(path);
        if (selfIdx >= 0 && !selfHit) {
          selfHit = true;
          const q = path.pts[selfIdx];
          w.fx.label(this.x, this.y - 66, '反射命中', P.amber, 1.2);
          w.fx.sparks(this.body.hx, this.body.hy, 20, P.white, 200);
          w.fx.shake(6, 0.3);
          w.hitstop = Math.max(w.hitstop, 0.08);
          w.damage(this.body, { dmg: 300, kind: 'beam', x: this.body.hx, y: this.body.hy, dx: Math.sign(this.x - q[0]) || 1, dy: 0, poise: 75, from: 'env', src: 'mirror' });
          if (this.staggered || this.dying) return;
        }
        yield;
      }
      this.laser = null;
      yield* this.wait(this.tele(0.4));
    }
    this.anim = 'idle';
    yield* this.wait(this.tele(0.4));
  }

  private beamHits(path: BeamPath): void {
    const w = this.w, p = w.player, pts = path.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (shapeHits({ k: 'line', x1, y1, x2, y2, w: 8 }, p.x, p.y - 4, 4)) w.hitPlayer(1, { x: p.x, y: p.y, kind: 'beam' });
      for (const c of this.clones) if (c.live && segDist(c.x, c.y, x1, y1, x2, y2) < 12) c.pop(w, 'beam');
    }
  }

  // ---------------------------------------------------------------- encore
  private *encoreRoutine(): Script {
    const w = this.w;
    this.anim = 'cast';
    yield* this.glideTo(STAGE_CENTRE.x, STAGE_CENTRE.y, 150, 2.5);
    this.encore = true;
    this.poise = 0;
    w.fx.label(this.x, this.y - 66, '安可 · 每秒回复 2%', P.rose, 1.4);
    w.fx.ring(this.x, this.y - CHEST, 8, 80, P.rose, 0.5, 3);
    w.sfx('heal');
    const dir = w.rng.chance(0.5) ? 1 : -1;
    let a = w.rng.next() * Math.PI * 2;
    const end = this.clock + 5;
    let next = this.clock, nextRing = this.clock + 0.6, last = this.clock;
    while (this.clock < end && this.encore) {
      const dt = this.clock - last;
      last = this.clock;
      while (this.clock >= next) {
        for (let k = 0; k < 2; k++) this.shoot(this.x, this.y - CHEST, a + k * Math.PI, 92, HEART);
        a += 0.26 * dir;
        next += 0.12;
      }
      if (this.clock >= nextRing) {
        this.ring(this.x, this.y - CHEST, 16, 78, a * 0.5, { frame: 'orb_o' });
        nextRing += 1.3;
        w.sfx('spray', 0.6, 1.2);
      }
      this.cloneShots(dt, 1.3);
      yield;
    }
    if (!this.encore) return;
    this.encore = false;
    this.encoreCd = 14;
    this.anim = 'hurt';
    yield* this.wait(this.tele(1.4));
    this.anim = 'idle';
  }

  // ------------------------------------------------------------------ draw
  private frame(): string {
    if (this.staggered) return 'hurt';
    if (this.anim === 'idle') return Math.floor(this.animClock * 2.5) % 2 ? 'idle2' : 'idle1';
    return this.anim;
  }

  /** Draw Lux (clone = null) or one of her clones with the same pose. */
  drawFigure(g: Gfx, w: World, clone: LuxClone | null): void {
    const x = clone ? clone.x : this.x, y = clone ? clone.y : this.y;
    const bob = Math.sin(this.animClock * 3 + (clone ? clone.id : 0)) * 1.5;
    const lit = !!this.stage?.inLight(x, y);
    const fr = clone && clone.state === 'glitch' ? 'hurt' : this.frame();
    const flip = this.facing < 0;
    // hover base glow (everyone) and the shadow (only the real one, only in light)
    g.ellipse(x, y, 9, 3, P.magenta, 0.15, 'floor');
    if (!clone && lit) g.ellipse(x, y, 11, 4, P.ink, 0.7, 'floor');
    let alpha = 1;
    if (clone) {
      if (clone.state === 'in') alpha = clamp(clone.t / 0.5, 0, 1) * 0.9;
      else if (clone.state === 'glitch') alpha = 1 - clone.t / 0.3;
      if (lit) alpha *= 0.45;
    }
    const sy = y - 4 - bob;
    const glitch = clone ? (clone.state === 'glitch' ? 4 : clone.flickering ? 2 : 0) : 0;
    if (glitch) {
      g.img('lux', fr, x - glitch, sy, { flipX: flip, alpha: alpha * 0.45, fill: P.cyan, depth: y - 0.1 });
      g.img('lux', fr, x + glitch, sy, { flipX: flip, alpha: alpha * 0.45, fill: P.magenta, depth: y - 0.1 });
    }
    const flash = !clone && this.body.flash > 0;
    g.img('lux', fr, x + (clone?.state === 'glitch' ? w.rng.range(-2, 2) : 0), sy, { flipX: flip, alpha, fill: flash ? P.white : undefined, depth: y });
    g.circle(x, y - CHEST, 16, P.magenta, 0.12 * alpha, 'light');
    if (!clone && this.stage?.dark) this.stage.holes.push({ x, y: y - CHEST, r: 40 });
  }

  draw(g: Gfx, w: World): void {
    if (this.defeated) return;
    this.drawFigure(g, w, null);
    if (this.encore) {
      const pulse = 0.5 + 0.5 * Math.sin(this.animClock * 8);
      g.ring(this.x, this.y, 18 + pulse * 4, 1, P.acid, 0.6, 'floor');
      g.circle(this.x, this.y - CHEST, 26, P.acid, 0.1 + 0.06 * pulse, 'light');
    }
    if (this.staggered) {
      for (let i = 0; i < 3; i++) {
        const a = this.animClock * 4 + (i * Math.PI * 2) / 3;
        g.img('proj', 'star', this.x + Math.cos(a) * 12, this.y - 54 + Math.sin(a) * 4, { layer: 'top', ox: 0.5, oy: 0.5 });
      }
    }
    this.drawLaser(g, w);
  }

  private drawLaser(g: Gfx, w: World): void {
    const L = this.laser;
    if (!L) return;
    const pts = L.path.pts;
    const H = 8;
    const pulse = 0.5 + 0.5 * Math.sin(w.realTime * 30);
    for (let i = 0; i < pts.length - 1; i++) {
      const x1 = pts[i][0], y1 = i === 0 ? this.y - CHEST : pts[i][1] - H, x2 = pts[i + 1][0], y2 = pts[i + 1][1] - H;
      const self = L.selfIdx >= 0 && i >= L.selfIdx;
      if (L.warn) {
        const c = self ? COL.interact : P.red;
        g.line(x1, y1, x2, y2, Math.max(1, 6 * L.prog), c, 0.18, 'top');
        g.line(x1, y1, x2, y2, 1, c, 0.5 + 0.4 * pulse, 'top');
      } else {
        g.line(x1, y1, x2, y2, 7, self ? P.amber : P.rose, 0.5, 'top');
        g.line(x1, y1, x2, y2, 2, P.white, 1, 'top');
        g.line(x1, y1, x2, y2, 10, P.magenta, 0.12, 'light');
      }
      if (i > 0) g.ring(x1, y1, 4, 1, P.white, 0.8, 'top');
      if (this.stage?.dark) {
        const n = Math.max(1, Math.ceil(dist(x1, y1, x2, y2) / 18));
        for (let k = 0; k <= n; k++) this.stage.holes.push({ x: x1 + ((x2 - x1) * k) / n, y: y1 + ((y2 - y1) * k) / n, r: 20 });
      }
    }
    if (L.warn && L.sweep) {
      const a0 = Math.min(L.a0, L.a0 + L.sweep), a1 = Math.max(L.a0, L.a0 + L.sweep);
      g.sector(this.x, this.y - CHEST, 70, a0, a1, P.red, 0.12 + 0.1 * L.prog, 'top', 20);
    }
  }
}

export const luxDef: BossDef = {
  id: 'lux',
  arena: club,
  spawn: { x: 320, y: 110 },
  make: (w, tier) => new Lux(w, tier, 320, 110),
  drop: 'legs_blink',
  portrait: { key: 'lux_portrait', frame: 'lux' },
  hint: '拉配电箱断电 · 打坏投影仪 · E 转镜子反射激光 · 追光里伤害 +25%',
  music: {
    bpm: 120,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...xx',
    bass: [0, null, 12, null, 0, null, 12, 0, 0, null, 12, null, 0, 12, 10, 12],
    lead: [12, null, 15, null, 19, null, 15, null, 22, null, 19, null, 15, null, 14, null],
    root: 45,
    chords: [0, -4, 3, -2],
    wave: 'square',
  },
};


