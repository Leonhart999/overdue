/**
 * VESPER — Halcyon repo sniper on the roof of an 8-car ring-line train (src/game/arenas/train.ts).
 *
 * Chase: she stays 1-2 cars ahead of the player. When the player has been within ~1 car of her for
 * a moment (or gets right up to her) she relocates: smoke at her feet, a leap 1-2 cars forward onto
 * a landing spot shown in advance (a red circle: 1 heart if you stand on it). The camera leans
 * toward her so her sight line is readable.
 *
 * Sniper round: red laser tracks the player 1.0 s, locks (white) 0.35 s, then a fast hard round
 * (1 heart). Cover stops it. Blade / fist send it back: a deflected round on her is x5 damage and
 * +42 poise. Nails in her slow the tracking (-8% per nail, max -40%). The jack arm makes the laser
 * wobble for 4 s on top of the jam slow.
 *
 * P1 (100-65%) : sniper round, relocation, close kick (sector, 1 heart + knockback, then a backflip).
 * P2 (65-30%)  : adds a triple volley (three lines that lock and fire one after another), an
 *                armour-piercing round (thick gold line, breaks the first cover and keeps going) and
 *                a proximity mine left under the smoke of every relocation. The rear cars uncouple.
 * P3 (30-0%)   : cornered on the last 3 cars; once only 3 are left the train enters the tunnel
 *                (darkness: her laser is what shows her). Faster relocations with a quick shot after.
 *
 * Arena: before each gantry she gets into a car gap. Staggered, stunned, jammed or knocked out of
 * the gap when it arrives: 360 damage + stagger. A live roof under her: 140 damage + 1.2 s stun.
 * Slug / fist / shove / pellets push her (out of a gap). Arc chained into her through a pantograph
 * or junction box: x1.5.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleDiff, angleTo, clamp, dist, norm } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Body } from '../body';
import { Boss, BossPart, type HitTag } from '../boss';
import { Bullet } from '../bullet';
import { Hazard } from '../hazard';
import { carIndexAt, coverAt, gapAt, isClearingShot, isConductor, shotRay, keepOffDrops, LAST_CARS, train, TRAIN, trainOf, type Gap, type TrainRider, type TrainState } from '../arenas/train';
import { shapeHits, type Hit } from '../types';
import type { World } from '../world';
import type { BossDef } from './registry';

type Anim = 'idle1' | 'idle2' | 'aim' | 'fire' | 'kick' | 'hurt' | 'leap' | 'crouch';

const BASE_HP = 2250;
/** Rifle pivot height above the ground point. */
const GUN_H = 24;
const MUZZLE = 24;
const SHOT_SPEED = 560;
const MAX_MINES = 3;
/** "Within about one car": the chase distance that makes her move on. */
const NEAR = 220;

interface Laser {
  a: number;
  /** Extra aim offset that closes as the line tracks (volley lines start fanned out). */
  off: number;
  haz: Hazard;
  locked: boolean;
  ap: boolean;
  ex: number;
  ey: number;
}

// =====================================================================================
// Projectiles, mine, smoke
// =====================================================================================
class SniperRound extends Bullet {
  private pierced = false;
  constructor(x: number, y: number, vx: number, vy: number, readonly ap: boolean) {
    super(x, y, vx, vy, 'enemy');
    this.soft = false;
    this.frame = 'bolt';
    this.r = 2.5;
    this.dmg = 1;
    this.life = 2;
    this.rotates = true;
    this.glow = ap ? 8 : 6;
    this.glowColor = ap ? P.amber : COL.hard;
    this.scale = ap ? 1.4 : 1.15;
    this.deflectable = true;
  }
  /** Cover stops it (both ways: a deflected round too). An AP round breaks the first cover and keeps going. */
  protected collide(w: World): void {
    const st = trainOf(w);
    const c = st ? coverAt(st, this.x, this.y) : null;
    if (c) {
      if (this.team === 'enemy' && this.ap && !this.pierced) {
        this.pierced = true;
        c.shot(w, true);
        w.fx.sparks(this.x, this.y, 8, P.amber, 140);
      } else {
        if (this.team === 'enemy') c.shot(w, false);
        this.dead = true;
        w.fx.sparks(this.x, this.y, 4, this.team === 'enemy' ? P.red : P.cyan, 80);
        return;
      }
    }
    super.collide(w);
  }
}

/** Proximity mine (P2+), left where she relocated from. Pellets, slugs, blasts and overloads set it off early. */
export class VesperMine extends Body {
  private arm = 0.8;
  private life = 24;
  private fuse = -1;
  private warnHaz: Hazard | null = null;
  readonly R = 30;
  constructor(private v: Vesper, x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.r = 4; this.hz = 2; this.hr = 5;
    this.mass = 0;
    this.targetable = false;
  }
  update(w: World, dt: number): void {
    if (this.dead) return;
    this.life -= dt;
    if (this.arm > 0) this.arm -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    for (const e of w.bullets) {
      if (!e.dead && isClearingShot(e) && dist(e.x, e.y, this.x, this.y - 2) < this.hr + e.r + 4) {
        if (e.src === 'pellet') e.dead = true;
        this.detonate(w);
        return;
      }
    }
    if (this.fuse < 0) {
      const p = w.player;
      if (this.arm <= 0 && !p.airborne && dist(p.x, p.y, this.x, this.y) < 22 && w.state === 'fight') {
        this.fuse = 0.4;
        w.sfx('telegraph', 0.8, 2);
        const h = new Hazard({ k: 'circle', x: this.x, y: this.y, r: this.R + 2 }, this.fuse, 0);
        h.hitsPlayer = false;
        h.cancelable = false;
        h.team = 'env';
        this.warnHaz = w.addHazard(h);
      }
      return;
    }
    this.fuse -= dt;
    if (this.fuse <= 0) this.detonate(w);
  }
  detonate(w: World): void {
    if (this.dead) return;
    this.dead = true;
    if (this.warnHaz) this.warnHaz.dead = true;
    w.explode(this.x, this.y - 2, this.R, { enemyDmg: 120, poise: 30, playerDmg: 1, from: 'env', src: 'mine' });
    this.v.mineGone(this);
  }
  hurt(w: World, h: Hit): number {
    if (h.from === 'enemy') return 0;
    if (h.kind === 'blast' || h.kind === 'fire' || h.src === 'overload' || h.src === 'slug' || h.src === 'pellet') this.detonate(w);
    return 0;
  }
  onEmp(w: World): void { this.detonate(w); }
  draw(g: Gfx, w: World): void {
    const fast = this.fuse >= 0;
    const on = Math.floor(w.realTime * (fast ? 14 : 3)) % 2 === 0;
    g.img('vesper_fx', on ? 'mine_a' : 'mine_b', this.x, this.y + 3, { layer: 'floor' });
    g.circle(this.x, this.y - 2, on ? 6 : 3, P.red, on ? 0.5 : 0.2, 'light');
  }
}

/** Smoke from a relocation: hides what is under it (mines). Pellets and slugs blow it away. */
class Smoke {
  t = 0;
  dead = false;
  private puffs: { dx: number; dy: number; r: number; ph: number }[] = [];
  constructor(public x: number, public y: number, public r: number, public dur: number, w: World) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + w.rng.next(), d = i === 0 ? 0 : r * (0.35 + w.rng.next() * 0.45);
      this.puffs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.6, r: r * (0.45 + w.rng.next() * 0.25), ph: w.rng.next() * 6 });
    }
  }
  update(w: World, dt: number): void {
    this.t += dt;
    if (this.t >= this.dur) { this.dead = true; return; }
    for (const e of w.bullets) {
      if (!e.dead && isClearingShot(e) && dist(e.x, e.y, this.x, this.y) < this.r) {
        this.dead = true;
        w.fx.smoke(this.x, this.y, 6, P.fog, 5, 30);
        w.fx.burst(this.x, this.y, 10, P.fog, 120, 0.3, 2);
        return;
      }
    }
  }
  drawTop(g: Gfx, w: World): void {
    const f = Math.min(1, this.t / 0.25) * Math.min(1, (this.dur - this.t) / 0.8);
    const grow = 0.7 + 0.3 * Math.min(1, this.t / 0.6);
    for (const p of this.puffs) {
      const wob = Math.sin(w.realTime * 1.5 + p.ph) * 2;
      g.circle(this.x + p.dx + wob, this.y + p.dy - 8, p.r * grow, P.slate, 0.75 * f, 'top');
      g.circle(this.x + p.dx + wob - 2, this.y + p.dy - 10, p.r * grow * 0.7, P.steel, 0.55 * f, 'top');
    }
  }
}

// =====================================================================================
// Vesper
// =====================================================================================
export class Vesper extends Boss implements TrainRider {
  readonly id = 'vesper' as const;
  readonly name = '维斯珀';
  readonly body: BossPart;
  private dt = 1 / 60;
  private anim: Anim = 'idle1';
  private animClock = 0;
  /** Rifle aim angle. */
  private face = Math.PI;
  private flip = true;
  private lasers: Laser[] = [];
  airborne = false;
  private z = 0;
  private landAt: { x: number; y: number } | null = null;
  private kvx = 0;
  private kvy = 0;
  private kickCd = 2;
  /** Seconds on the current spot, with the player within ~1 car, with her line of sight blocked. */
  private spotT = 0;
  private nearT = 0;
  private blockedT = 0;
  private wobbleT = 0;
  private stunT = 0;
  private muzzleT = 0;
  private mines: VesperMine[] = [];
  private lastPick = '';
  private gapWait = false;

  constructor(w: World, tier: number, x: number, y: number) {
    super(w, tier, x, y, BASE_HP);
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, x, y, 7, 20, 11));
    const st = trainOf(w);
    if (st) st.rider = this;
    this.updateStatus();
  }

  get r(): number { return this.body.r; }
  get onRoof(): boolean { return !this.dying && !this.defeated; }
  private get st(): TrainState | undefined { return trainOf(this.w); }
  /** P3 speeds wind-ups and recoveries up. */
  private t(s: number): number { return this.tele(s) * (this.phase >= 2 ? 0.85 : 1); }
  private eta(): number { const st = this.st; return st ? st.gantry.etaAt(this.w, this.x) : Infinity; }

  // ------------------------------------------------------------------ train hooks
  hitByGantry(w: World): void {
    if (this.invuln) return;
    w.fx.label(this.x, this.y - 60, '被龙门架撞到', P.amber, 1.2);
    w.fx.shake(8, 0.4);
    w.hitstop = Math.max(w.hitstop, 0.1);
    w.fx.debris(this.x, this.y - 20, 16, [P.white, P.pale, P.slate, P.red], 220);
    w.sfx('crash');
    this.kvx = -280;
    w.damage(this.body, { dmg: 360, kind: 'crush', x: this.x, y: this.y - 20, dx: -1, dy: 0, poise: 999, from: 'env', src: 'gantry' });
  }

  shockedByCar(w: World): void {
    if (this.airborne || this.invuln) return;
    w.damage(this.body, { dmg: 140, kind: 'shock', x: this.x, y: this.y - 20, poise: 30, from: 'env', src: 'catenary' });
    w.fx.sparks(this.x, this.y - 20, 14, P.ice, 140);
    if (!this.staggered && !this.inTransition && !this.dying) {
      w.fx.label(this.x, this.y - 56, '麻痹', P.ice, 0.9);
      this.setScript(this.stunned(1.2));
    }
  }

  mineGone(m: VesperMine): void { this.mines = this.mines.filter((x) => x !== m); }

  jam(w: World, s: number): void {
    super.jam(w, s);
    this.wobbleT = Math.max(this.wobbleT, 4);
  }

  // ------------------------------------------------------------------ hits
  modHit(w: World, _part: BossPart, h: Hit): { mul: number; tag: HitTag } {
    if (h.from !== 'player') return { mul: 1, tag: 'normal' };
    const src = h.src ?? '';
    // pushes (out of a gap, into the gantry's path)
    if (!this.airborne && h.dx !== undefined && h.dy !== undefined) {
      const k = src === 'slug' ? 280 : src === 'fist' ? 220 : src === 'shove' ? 140 : src === 'pellet' ? 6 : 0;
      if (k) { this.kvx += h.dx * k; this.kvy += h.dy * k * 0.5; }
    }
    if (src === 'arc') {
      // chained through the catenary (pantograph / junction box) into her
      const nodes = (w.player.weapon as unknown as { nodes?: Body[] }).nodes;
      const i = nodes ? nodes.indexOf(this.body) : -1;
      if (nodes && i > 0 && isConductor(nodes[i - 1])) return { mul: 1.5, tag: 'normal' };
    }
    if (src === 'deflect') {
      w.fx.label(this.x, this.y - 56, '弹回命中', P.amber, 0.8);
      this.addPoise(w, 42);
      return { mul: 5, tag: 'normal' };
    }
    return { mul: 1, tag: 'normal' };
  }

  onStagger(): void {
    this.anim = 'hurt';
    this.gapWait = false;
    this.dropLasers();
  }
  onStaggerEnd(): void { this.anim = 'idle1'; }
  onDeath(): void {
    this.status = '';
    this.dropLasers();
    for (const m of this.mines) m.dead = true;
    this.mines = [];
  }

  // ------------------------------------------------------------------ per-step
  think(w: World, dt: number): void {
    this.dt = dt;
    this.animClock += dt;
    if (this.kickCd > 0) this.kickCd -= dt;
    if (this.wobbleT > 0) this.wobbleT -= dt;
    if (this.muzzleT > 0) this.muzzleT -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.mines.some((m) => m.dead)) this.mines = this.mines.filter((m) => !m.dead);
    const st = this.st;
    if (st && this.phase >= 2 && !st.tunnel && st.carsLeft <= LAST_CARS && !this.dying) {
      st.tunnel = true;
      w.fx.label(w.player.x, w.bounds.y + 30, '列车进入隧道', P.pale, 1.6);
      w.sfx('rev', 0.8, 0.5);
    }
    if (!this.airborne) {
      this.spotT += dt;
      const p = w.player;
      const dx = Math.abs(p.x - this.x);
      this.nearT = dx < NEAR ? this.nearT + dt : Math.max(0, this.nearT - dt * 2);
      this.blockedT = this.hasLos() ? Math.max(0, this.blockedT - dt * 2) : this.blockedT + dt;
      // pushes
      if (Math.abs(this.kvx) > 1 || Math.abs(this.kvy) > 1) {
        w.moveCircle(this, this.kvx * dt, this.kvy * dt, { ignore: this.body });
        const k = Math.exp(-6 * dt);
        this.kvx *= k; this.kvy *= k;
      }
      this.keepInside();
      // keep the player out of her
      if (!p.airborne && dist(p.x, p.y, this.x, this.y) < this.body.r + p.r) {
        const [nx, ny] = norm(p.x - this.x, p.y - this.y);
        p.x = this.x + nx * (this.body.r + p.r);
        p.y = this.y + ny * (this.body.r + p.r);
      }
      if (!this.lasers.length) {
        const c = Math.cos(angleTo(this.x, this.y, w.target().x, w.target().y));
        if (c < -0.2) this.flip = true; else if (c > 0.2) this.flip = false;
      }
    }
    this.updateStatus();
  }

  private keepInside(): void {
    [this.x, this.y] = this.w.clampToBounds(this.x, this.y, this.body.r + 2);
    keepOffDrops(this);
    this.body.x = this.x; this.body.y = this.y;
  }

  private updateStatus(): void {
    const eta = this.eta();
    let s = eta < 30 ? `龙门架 ${Math.ceil(eta)}s` : '';
    const n = this.body.nails;
    if (n > 0) s += `${s ? ' · ' : ''}瞄准 -${Math.round(Math.min(0.4, 0.08 * n) * 100)}%`;
    const st = this.st;
    if (st && st.uncouple && st.carsLeft > LAST_CARS) s += `${s ? ' · ' : ''}车厢 ${st.carsLeft}`;
    this.status = s;
  }

  // ------------------------------------------------------------------ aim helpers
  private pivot(): [number, number] { return [this.x + (this.flip ? -3 : 3), this.y - GUN_H]; }
  private muzzle(a: number): [number, number] {
    const [px, py] = this.pivot();
    return [px + Math.cos(a) * MUZZLE, py + Math.sin(a) * MUZZLE * 0.9];
  }
  private hasLos(): boolean {
    const t = this.w.target();
    const [px, py] = this.pivot();
    const d = dist(px, py, t.hx, t.hy);
    const [nx, ny] = norm(t.hx - px, t.hy - py);
    return shotRay(this.w, px, py, nx, ny, d) >= d - 2;
  }
  private trackRate(): number {
    const base = [2.6, 3.0, 3.4][this.phase] ?? 3.4;
    return base * (1 - Math.min(0.4, 0.08 * this.body.nails));
  }
  private wobble(): number {
    if (this.wobbleT <= 0) return 0;
    return Math.sin(this.clock * 11) * 0.16 + Math.sin(this.clock * 4.3) * 0.09;
  }
  /** Aim angle actually used (wobble included). */
  private aimOf(L: Laser): number { return L.a + this.wobble(); }

  private newLaser(ap: boolean, dur: number, off = 0): Laser {
    const [mx, my] = this.pivot();
    const t = this.w.target();
    const a = angleTo(mx, my, t.hx, t.hy) + off;
    const haz = this.hazard({ k: 'line', x1: mx, y1: my, x2: mx, y2: my, w: ap ? 18 : 14 }, dur + 1, 0, (h) => {
      h.hitsPlayer = false;
      h.color = ap ? P.orange : COL.danger;
    });
    const L: Laser = { a, off, haz, locked: false, ap, ex: mx, ey: my };
    this.lasers.push(L);
    this.updateLaser(L);
    return L;
  }

  private updateLaser(L: Laser): void {
    const a = this.aimOf(L);
    const [mx, my] = this.muzzle(a);
    const dx = Math.cos(a), dy = Math.sin(a);
    const len = shotRay(this.w, mx, my, dx, dy, 900);
    L.ex = mx + dx * len; L.ey = my + dy * len;
    const s = L.haz.shape;
    if (s.k === 'line') { s.x1 = mx; s.y1 = my; s.x2 = L.ex; s.y2 = L.ey; }
  }

  private trackLaser(L: Laser, closing = 1): void {
    if (!L.locked) {
      const [px, py] = this.pivot();
      const t = this.w.target();
      L.off *= Math.max(0, 1 - this.dt * 2.5 * closing);
      const want = angleTo(px, py, t.hx, t.hy) + L.off;
      const step = this.trackRate() * this.dt;
      const d = angleDiff(L.a, want);
      L.a += clamp(d, -step, step);
      this.face = L.a;
      this.flip = Math.cos(L.a) < 0;
    }
    this.updateLaser(L);
  }

  private lockLaser(L: Laser): void {
    L.locked = true;
    L.haz.color = P.white;
    this.w.sfx('telegraph', 0.8, L.ap ? 0.8 : 1.5);
  }

  private fireLaser(L: Laser): void {
    const w = this.w;
    const a = this.aimOf(L);
    const [mx, my] = this.muzzle(a);
    const sp = (L.ap ? SHOT_SPEED * 1.15 : SHOT_SPEED) * this.bulletMul;
    w.addBullet(new SniperRound(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, L.ap));
    L.haz.dead = true;
    this.lasers = this.lasers.filter((x) => x !== L);
    this.muzzleT = 0.07;
    this.kvx -= Math.cos(a) * 30;
    w.fx.sparks(mx, my, 6, L.ap ? P.amber : P.white, 160, a, 0.5);
    w.fx.shake(L.ap ? 3 : 2, 0.08);
    w.sfx('slug', L.ap ? 0.9 : 0.6, L.ap ? 0.7 : 1.3);
  }

  private dropLasers(): void {
    for (const L of this.lasers) L.haz.dead = true;
    this.lasers = [];
  }

  // ------------------------------------------------------------------ movement helpers
  /** Front end of the rear car while uncoupling runs (she keeps off it), else -Infinity. */
  private doomedX(): number {
    const st = this.st;
    return st && st.uncouple && st.carsLeft > LAST_CARS ? TRAIN.cars[st.rear].x1 + TRAIN.gapW : -Infinity;
  }

  /** Is a ground point free for her to stand on? */
  private free(x: number, y: number): boolean {
    const b = this.w.bounds, r = this.body.r + 2;
    if (x < b.x + r || x > b.x + b.w - r || y < b.y + r || y > b.y + b.h - r) return false;
    if (x < this.doomedX() + r) return false;
    for (const gp of TRAIN.gaps) if (x > gp.x0 - r && x < gp.x1 + r && (y < gp.walkY0 + r || y > gp.walkY1 - r)) return false;
    for (const wl of this.w.walls) if (x > wl.x - r && x < wl.x + wl.w + r && y > wl.y - r && y < wl.y + wl.h + r) return false;
    for (const o of this.w.bodies) if (o.solid && !o.dead && o !== this.body && dist(x, y, o.x, o.y) < r + o.r) return false;
    return true;
  }

  /** Car index range she may relocate to in this phase. */
  private carRange(): [number, number] {
    const st = this.st;
    const front = TRAIN.cars.length - 1;
    if (!st) return [0, front];
    let lo = st.rear + (st.uncouple && st.carsLeft > LAST_CARS ? 1 : 0);
    const hi = this.phase === 0 ? front - 3 : this.phase === 1 ? front - 1 : front;
    // cornered at the locomotive once the train is down to its last cars
    if (this.phase >= 2 && st.carsLeft <= LAST_CARS) lo = Math.max(lo, front - (LAST_CARS - 1));
    return [Math.min(lo, hi), hi];
  }

  /**
   * Where to relocate. Chase: forward, 1 (sometimes 2) cars ahead of the player and ahead of her
   * own car. Cornered (front of her range reached): any other car in range, not the player's.
   * Reposition: a better spot 1-2 cars ahead of the player (back toward a player left far behind).
   */
  private pickSpot(mode: 'chase' | 'reposition'): { x: number; y: number } | null {
    const w = this.w;
    const p = w.player;
    const [lo, hi] = this.carRange();
    const pc = carIndexAt(p.x), mine = carIndexAt(this.x);
    let want = pc + (w.rng.chance(0.3) ? 2 : 1);
    if (mode === 'chase') want = Math.max(want, mine + 1);
    if (want > hi || want < lo || want === pc) {
      // cornered: the nearest other car in range that the player is not on
      let best = -1, bd = Infinity;
      for (let i = lo; i <= hi; i++) {
        if (i === pc) continue;
        const d = Math.abs(i - pc) + (i === mine && mode === 'chase' ? 3 : 0) + (i < pc ? 0.5 : 0);
        if (d < bd) { bd = d; best = i; }
      }
      want = best;
    }
    const car = TRAIN.cars[want];
    if (!car) return null;
    let best: { x: number; y: number } | null = null, bs = -Infinity;
    for (const s of car.spots) {
      if (!this.free(s.x, s.y)) continue;
      if (this.mines.some((m) => dist(m.x, m.y, s.x, s.y) < 24)) continue;
      const d = dist(s.x, s.y, p.x, p.y);
      if (d < 110 || dist(s.x, s.y, this.x, this.y) < 40) continue;
      // never so far ahead that the player loses her (she stays 1-2 cars ahead)
      if (d > 860) continue;
      const [nx, ny] = norm(p.x - s.x, p.hy - (s.y - GUN_H));
      const los = shotRay(w, s.x, s.y - GUN_H, nx, ny, d) >= d - 4;
      const sc = -Math.abs(d - 330) * 0.4 + (los ? 80 : 0) + w.rng.next() * 40;
      if (sc > bs) { bs = sc; best = s; }
    }
    return best;
  }

  /** Leap to (tx, ty). Airborne: invulnerable and untargetable. */
  private *leapTo(tx: number, ty: number, dur: number, height: number): Script {
    const sx = this.x, sy = this.y;
    this.anim = 'leap';
    this.dropLasers();
    try {
      this.airborne = true;
      this.invuln = true;
      this.body.targetable = false;
      this.body.solid = false;
      this.body.hz = 400;
      this.landAt = { x: tx, y: ty };
      this.w.sfx('leap', 0.8, 1.2);
      const start = this.clock;
      while (this.clock - start < dur) {
        const f = (this.clock - start) / dur;
        this.x = sx + (tx - sx) * f;
        this.y = sy + (ty - sy) * f;
        this.z = Math.sin(Math.PI * f) * height;
        this.body.x = this.x; this.body.y = this.y;
        yield;
      }
    } finally {
      this.x = tx; this.y = ty;
      this.body.x = tx; this.body.y = ty;
      this.airborne = false;
      this.invuln = false;
      this.body.targetable = true;
      this.body.solid = true;
      this.body.hz = 20;
      this.landAt = null;
      this.z = 0;
      this.kvx = this.kvy = 0;
      this.spotT = 0;
      this.nearT = 0;
      this.blockedT = 0;
    }
    this.anim = 'crouch';
    this.w.sfx('land', 0.6, 1.3);
    this.w.fx.smoke(this.x, this.y, 4, P.slate, 3, 8);
  }

  // ------------------------------------------------------------------ brain
  *brain(w: World): Script {
    yield* this.wait(0.6);
    for (;;) {
      const eta = this.eta();
      if (eta < 2.9) { yield* this.toGap(); continue; }
      const p = w.player;
      const d = this.distToTarget();
      const ph = this.phase;
      const dx = Math.abs(p.x - this.x);
      if (d < 50 && this.kickCd <= 0) { yield* this.kick(); continue; }
      const dwell = [5.0, 4.2, 3.4][ph] ?? 3.4;
      const chase = this.nearT > dwell || (d < 70 && this.kickCd > 0 && this.nearT > 1.5);
      const carL = TRAIN.carLen + TRAIN.gapW;
      const reposition = !chase && (this.x < this.doomedX() || this.blockedT > 3 || dx > 2.2 * carL || (this.spotT > 14 && dx > carL));
      const opts: [string, number][] = [
        ['relocate', chase && eta > 2.2 ? 12 : 0],
        ['reposition', reposition && eta > 2.2 ? (this.x < this.doomedX() ? 50 : 6) : 0],
        ['snipe', eta > 3.2 ? 4 : 0],
        ['volley', ph >= 1 && eta > 4.6 ? 2.5 : 0],
        ['ap', ph >= 1 && eta > 3.8 ? (this.blockedT > 0.5 ? 5 : 1.2) : 0],
      ];
      if (opts.every((o) => o[1] <= 0)) { yield* this.wait(0.1); continue; }
      for (const o of opts) if (o[0] === this.lastPick && o[0] !== 'relocate' && o[0] !== 'reposition') o[1] *= 0.5;
      const pick = w.rng.weighted(opts);
      this.lastPick = pick;
      switch (pick) {
        case 'relocate': yield* this.relocate('chase'); break;
        case 'reposition': yield* this.relocate('reposition'); break;
        case 'snipe': yield* this.snipe(this.t(1.0), this.t(0.35)); break;
        case 'volley': yield* this.volley(); break;
        case 'ap': yield* this.snipe(this.t(1.2), this.t(0.45), true); break;
      }
      this.anim = 'idle1';
      yield* this.wait(this.t(0.35) + w.rng.range(0, 0.3));
    }
  }

  *transition(w: World, phase: number): Script {
    this.dropLasers();
    this.invuln = true;
    this.anim = 'crouch';
    const st = this.st;
    try {
      if (phase === 1) {
        w.fx.label(this.x, this.y - 60, '穿甲弹 · 地雷 · 车厢脱钩', P.red, 1.6);
        w.sfx('reload');
        if (st) { st.uncouple = true; st.uncoupleEvery = 14; }
        yield* this.wait(1.0);
      } else {
        w.fx.label(this.x, this.y - 60, '换位更快 · 落地即开枪', P.red, 1.4);
        if (st) { st.uncoupleEvery = 8; st.gantry.interval = 14; }
        yield* this.wait(0.5);
      }
    } finally {
      this.invuln = false;
      this.anim = 'idle1';
    }
    if (phase === 2) {
      const s = this.pickSpot('chase');
      if (s) yield* this.leapTo(s.x, s.y, this.t(0.7), 60);
    }
    yield* this.wait(0.3);
  }

  // ------------------------------------------------------------------ attacks
  private *stunned(s: number): Script {
    this.dropLasers();
    this.anim = 'hurt';
    this.stunT = s;
    try { yield* this.wait(s); } finally { this.stunT = 0; this.anim = 'idle1'; }
  }

  private *snipe(track: number, lock: number, ap = false): Script {
    this.anim = 'aim';
    const L = this.newLaser(ap, track + lock);
    if (ap) this.w.fx.label(this.x, this.y - 56, '穿甲弹', P.amber, 0.8);
    this.w.sfx('laser', 0.5, ap ? 0.7 : 1.2);
    try {
      let start = this.clock;
      while (this.clock - start < track) { this.trackLaser(L); yield; }
      this.lockLaser(L);
      start = this.clock;
      while (this.clock - start < lock) { this.trackLaser(L); yield; }
      this.fireLaser(L);
    } finally { this.dropLasers(); }
    this.anim = 'fire';
    yield* this.wait(0.15);
    this.anim = 'aim';
    yield* this.wait(this.t(0.45));
  }

  private *volley(): Script {
    this.anim = 'aim';
    const track = this.t(0.9), lock = this.t(0.35);
    const ls = [-0.35, 0, 0.35].map((o) => this.newLaser(false, track + lock * 3 + 0.5, o));
    this.w.sfx('laser', 0.6, 1.4);
    try {
      let start = this.clock;
      while (this.clock - start < track) { for (const L of ls) this.trackLaser(L); yield; }
      for (const L of ls) {
        this.lockLaser(L);
        start = this.clock;
        while (this.clock - start < lock) { for (const k of ls) if (this.lasers.includes(k)) this.trackLaser(k, 2); yield; }
        this.fireLaser(L);
        this.anim = 'fire';
      }
    } finally { this.dropLasers(); }
    this.anim = 'aim';
    yield* this.wait(this.t(0.6));
  }

  private *kick(): Script {
    const w = this.w;
    const t = w.target();
    const a = angleTo(this.x, this.y, t.x, t.y);
    this.flip = Math.cos(a) < 0;
    this.anim = 'kick';
    const R = 46, span = 1.8;
    const warn = this.t(0.45);
    let knocked = false;
    const haz = this.hazard({ k: 'sector', x: this.x, y: this.y - 4, r: R, a, span }, warn, 0.08, (h) => {
      h.dmg = 1;
      h.onActivate = (ww) => ww.sfx('punch', 0.9, 1.2);
      // a landed kick (the hazard dealt the heart this step) also knocks the player away
      h.onTick = (ww, hh) => {
        if (hh.warning || knocked || !hh.hitSet.has(-1)) return;
        knocked = true;
        const p = ww.player;
        if (p.invuln > 0.9 && shapeHits(hh.shape, p.x, p.y - 4, 6)) {
          const [kx, ky] = norm(p.x - this.x, p.y - this.y);
          p.forced = { vx: kx * 300, vy: ky * 300, t: 0.14, iframes: false, solids: true };
        }
      };
    });
    w.sfx('slash', 0.6, 0.7);
    yield* this.wait(warn + 0.1);
    if (haz.dead && haz.t < warn) return;
    this.kickCd = 3.5;
    // backflip away from the player
    const [nx, ny] = norm(this.x - t.x, this.y - t.y);
    let dest: [number, number] | null = null;
    for (const dd of [90, 70, 50]) {
      for (const off of [0, 0.5, -0.5, 1, -1]) {
        const c = Math.cos(off), s = Math.sin(off);
        const x = this.x + (nx * c - ny * s) * dd, y = this.y + (nx * s + ny * c) * dd;
        if (this.free(x, y)) { dest = [x, y]; break; }
      }
      if (dest) break;
    }
    if (dest) yield* this.leapTo(dest[0], dest[1], this.t(0.4), 26);
    this.anim = 'crouch';
    yield* this.wait(this.t(0.5));
  }

  private *relocate(mode: 'chase' | 'reposition'): Script {
    const w = this.w;
    const s = this.pickSpot(mode);
    if (!s) { yield* this.wait(0.3); return; }
    const ph = this.phase;
    const windup = this.t(ph >= 2 ? 0.25 : 0.35);
    const flight = this.t(ph >= 2 ? 0.5 : 0.65) + Math.min(0.35, dist(this.x, this.y, s.x, s.y) / 2400);
    this.anim = 'crouch';
    // landing spot: shown from the start (1 heart if you stand on it when she lands)
    this.hazard({ k: 'circle', x: s.x, y: s.y, r: 16 }, windup + flight, 0.06, (h) => { h.dmg = 1; });
    w.objects.push(new Smoke(this.x, this.y - 2, ph >= 1 ? 30 : 24, 3.4, w));
    w.sfx('pop', 0.8, 0.6);
    w.fx.smoke(this.x, this.y, 6, P.slate, 5, 16);
    if (ph >= 1 && this.mines.length < MAX_MINES) {
      const m = w.add(new VesperMine(this, this.x, this.y));
      this.mines.push(m);
    }
    yield* this.wait(windup);
    yield* this.leapTo(s.x, s.y, flight, 54 + Math.min(40, dist(this.x, this.y, s.x, s.y) / 20));
    yield* this.wait(this.t(0.3));
    // P3: a quick shot right after landing
    if (ph >= 2 && this.eta() > 2.6) yield* this.snipe(this.t(0.6), this.t(0.32));
  }

  /** Gantry coming: get into a car gap and stay down until it has passed. */
  private *toGap(): Script {
    const w = this.w;
    const gp = this.chooseGap();
    if (!gp) { yield* this.wait(0.3); return; }
    const ty = clamp(this.y, gp.walkY0 + 12, gp.walkY1 - 12);
    if (!gapAt(this.x, this.y, 3)) {
      const d = dist(this.x, this.y, gp.cx, ty);
      if (d < 40) {
        // close: walk in
        const start = this.clock;
        while (this.clock - start < 1 && !gapAt(this.x, this.y, 4)) {
          const [nx, ny] = norm(gp.cx - this.x, ty - this.y);
          w.moveCircle(this, nx * 90 * this.dt, ny * 90 * this.dt, { ignore: this.body });
          this.keepInside();
          yield;
        }
      } else yield* this.leapTo(gp.cx, ty, this.t(0.45) + Math.min(0.3, d / 1500), 30);
    }
    this.gapWait = true;
    this.anim = 'crouch';
    try {
      const start = this.clock;
      while (this.clock - start < 9) {
        const g = this.st?.gantry;
        if (!g || this.eta() === Infinity || (g.state === 'idle' && this.eta() > 4)) break;
        // pushed out: walk back in
        if (!gapAt(this.x, this.y, 3)) {
          const [nx, ny] = norm(gp.cx - this.x, ty - this.y);
          w.moveCircle(this, nx * 70 * this.dt, ny * 70 * this.dt, { ignore: this.body });
          this.keepInside();
        }
        yield;
      }
    } finally { this.gapWait = false; }
    this.anim = 'idle1';
    yield* this.wait(this.t(0.25));
  }

  private chooseGap(): Gap | null {
    const p = this.w.player, b = this.w.bounds;
    let best: Gap | null = null, bs = Infinity;
    const doomed = this.doomedX();
    for (const gp of TRAIN.gaps) {
      if (gp.x0 < b.x + 2 || gp.x1 <= doomed) continue;
      const s = Math.abs(gp.cx - this.x) + (Math.abs(gp.cx - p.x) < 36 ? 400 : 0);
      if (s < bs) { bs = s; best = gp; }
    }
    return best;
  }

  // ------------------------------------------------------------------ draw
  draw(g: Gfx, w: World): void {
    const st = this.st;
    // landing marker: a white cross inside the red circle
    if (this.landAt) {
      const { x, y } = this.landAt;
      g.line(x - 6, y, x + 6, y, 1, P.white, 0.8);
      g.line(x, y - 4, x, y + 4, 1, P.white, 0.8);
      st?.holes.push({ x, y, r: 22 });
    }
    const sh = this.airborne ? clamp(1 - this.z / 120, 0.4, 1) : 1;
    g.ellipse(this.x, this.y + 1, 9 * sh, 3.5 * sh, P.ink, 0.5, 'floor');
    let frame: string = this.anim;
    if (this.anim === 'idle1' || this.anim === 'idle2') frame = Math.floor(this.animClock * 2) % 2 ? 'idle2' : 'idle1';
    if (this.staggered || this.stunT > 0) frame = 'hurt';
    if (this.airborne) frame = 'leap';
    if (this.gapWait && !this.staggered) frame = 'crouch';
    const flash = this.body.flash > 0;
    const y = this.y - this.z;
    const rifle = (frame === 'aim' || frame === 'fire') && !this.airborne;
    const [px, py] = this.pivot();
    const ra = this.lasers.length ? this.aimOf(this.lasers[0]) : this.face;
    const back = Math.sin(ra) < -0.3;
    const drawRifle = () => g.img('vesper_rifle', frame === 'fire' ? 'fire' : 'rifle', px - Math.cos(ra) * (frame === 'fire' ? 2 : 0), py, { ox: 0.25, oy: 0.5, rot: ra, flipY: Math.cos(ra) < 0, depth: this.y + (back ? -0.3 : 0.3), fill: flash ? P.pale : undefined });
    if (rifle && back) drawRifle();
    g.img('vesper', frame, this.x, y + 2, { flipX: this.flip, fill: flash ? P.pale : undefined, depth: this.y });
    if (rifle && !back) drawRifle();
    // visor glow
    g.circle(this.x + (this.flip ? -2 : 2), y - 33, 4, P.red, 0.35, 'light');
    if (this.muzzleT > 0) { const [mx, my] = this.muzzle(ra); g.circle(mx, my, 9, P.white, 0.7, 'light'); st?.holes.push({ x: mx, y: my, r: 24 }); }
    // laser sight: crisp line on top of the hazard band
    for (const L of this.lasers) {
      const a = this.aimOf(L);
      const [mx, my] = this.muzzle(a);
      const c = L.locked ? P.white : L.ap ? P.amber : P.red;
      g.line(mx, my, L.ex, L.ey, L.ap ? 2 : 1, c, L.locked ? 0.95 : 0.85, 'top');
      g.circle(L.ex, L.ey, L.locked ? 5 : 3, c, 0.6, 'light');
      g.circle(mx, my, 4, c, 0.5, 'light');
    }
    if (this.staggered || this.stunT > 0) {
      st?.holes.push({ x: this.x, y: this.y - 16, r: 26 });
      for (let i = 0; i < 3; i++) {
        const a = this.animClock * 4 + (i * Math.PI * 2) / 3;
        g.img('proj', 'star', this.x + Math.cos(a) * 10, this.y - 46 + Math.sin(a) * 3, { layer: 'top', ox: 0.5, oy: 0.5 });
      }
      if (this.stunT > 0 && w.vrng.chance(0.3)) w.fx.sparks(this.x + w.vrng.range(-6, 6), this.y - 20, 1, P.ice, 60);
    }
  }
}

export const vesperDef: BossDef = {
  id: 'vesper',
  arena: train,
  spawn: TRAIN.vesperSpawn,
  make: (w, tier) => new Vesper(w, tier, TRAIN.vesperSpawn.x, TRAIN.vesperSpawn.y),
  drop: 'head_optics',
  hint: '躲在掩体后 · 用刀弹回狙击弹 · 龙门架来时把她控住 · 接线盒电她那节车厢',
  portrait: { key: 'vesper_portrait', frame: 'vesper' },
  music: {
    bpm: 150,
    kick: 'x..x..x.x..x..x.',
    snare: '....x.......x.xx',
    hat: 'xxx.xxx.xxx.xxxx',
    bass: [0, 0, 12, 0, 0, 12, 0, 10, 0, 0, 12, 0, 3, 5, 7, 3],
    lead: [12, null, null, 15, null, null, 14, null, 12, null, null, 10, null, 7, null, null],
    root: 40,
    chords: [0, 0, 1, -2],
    wave: 'square',
  },
};
