/**
 * Boss base class. A boss owns one or more BossParts (hittable bodies) and runs a generator
 * script (see engine/script.ts). The base class handles HP, phases, poise/stagger, hit flashes,
 * damage numbers, death, tier scaling and the hack slow-down.
 *
 * Subclass contract:
 *   - create parts in the constructor and `w.add()` them
 *   - implement `brain(w)`: an endless generator choosing attacks
 *   - optionally `transition(w, phase)`: runs once when a phase threshold is crossed
 *   - optionally `modHit(...)`: armour / weak points per hit
 *   - optionally `think(w, dt)`: per-step movement and timers (runs even while staggered)
 *   - implement `draw(g, w)`
 * Create every telegraph through `this.hazard(...)` so it is cancelled on stagger and death.
 */
import { COL, P, type Gfx } from '../engine/gfx';
import { angleTo, dist, norm } from '../engine/math';
import { wait, type Clocked, type Script } from '../engine/script';
import { Body } from './body';
import { Bullet } from './bullet';
import { Hazard } from './hazard';
import type { BossId } from './loadout';
import type { Hit, Shape } from './types';
import type { World } from './world';

export class BossPart extends Body {
  /** Damage multiplier for this part (heads, cores...). */
  dmgMul = 1;
  /** Weak point: hits get the player's weak multiplier (x1.3, optics x1.8). */
  weak = false;
  /** Ignore all damage (shielded core). */
  invulnerable = false;
  lastFlashAt = -9;
  constructor(public boss: Boss, x: number, y: number, r: number, hz: number, hr: number) {
    super();
    this.team = 'enemy';
    this.mass = 0;
    this.solid = true;
    this.x = x; this.y = y; this.r = r; this.hz = hz; this.hr = hr;
  }
  hurt(w: World, h: Hit): number { return this.boss.takeHit(w, this, h); }
}

export interface ShotOpts {
  soft?: boolean;
  frame?: string;
  r?: number;
  dmg?: number;
  life?: number;
  accel?: number;
  minSpeed?: number;
  low?: boolean;
  glow?: number;
  glowColor?: number;
  rotates?: boolean;
  deflectable?: boolean;
}

export type HitTag = 'normal' | 'weak' | 'armor' | 'immune';

export abstract class Boss implements Clocked {
  abstract readonly id: BossId;
  abstract readonly name: string;
  clock = 0;
  hp: number;
  maxHp: number;
  phase = 0;
  /** HP fractions where phases begin, descending (e.g. [0.6, 0.25]). */
  thresholds: number[] = [];
  poise = 0;
  poiseMax = 100;
  private lastHitAt = -9;
  staggerT = 0;
  staggerDur = 3;
  /** Temporary incoming-damage multiplier (cooling vents, blackouts). */
  vulnMul = 1;
  jamT = 0;
  parts: BossPart[] = [];
  script: Script | null = null;
  invuln = false;
  dying = false;
  deathT = 0;
  defeated = false;
  x: number;
  y: number;
  /** Shown under the HP bar (armour count, heads left...). */
  status = '';

  constructor(protected w: World, readonly tier: number, x: number, y: number, baseHp: number) {
    this.x = x;
    this.y = y;
    this.maxHp = this.hp = Math.round(baseHp * ([1, 1.35, 1.7][tier - 1] ?? 1.7) * w.hpMul);
    this.poiseMax = 100 + 15 * (tier - 1);
  }

  /** Telegraph/recovery multiplier: faster at higher tiers, slower with tactical optics. */
  get pace(): number { return ([1, 0.9, 0.82][this.tier - 1] ?? 0.8) * (this.w.player?.teleMul ?? 1) * this.w.paceMul; }
  /** Bullet speed multiplier by tier. */
  get bulletMul(): number { return [1, 1.08, 1.15][this.tier - 1] ?? 1.15; }
  tele(s: number): number { return s * this.pace; }
  get staggered(): boolean { return this.staggerT > 0; }

  abstract brain(w: World): Script;
  // eslint-disable-next-line require-yield
  *transition(_w: World, _phase: number): Script { /* optional */ }
  think(_w: World, _dt: number): void {}
  abstract draw(g: Gfx, w: World): void;
  /** Adjust a hit: return multiplier and tag. */
  modHit(_w: World, _part: BossPart, _h: Hit): { mul: number; tag: HitTag } { return { mul: 1, tag: 'normal' }; }
  onStagger(_w: World): void {}
  onStaggerEnd(_w: World): void {}
  onDeath(_w: World): void {}

  addPart(p: BossPart): BossPart {
    this.parts.push(p);
    this.w.add(p);
    return p;
  }

  update(w: World, dt: number): void {
    if (this.dying) {
      this.deathT += dt;
      if (w.rng.chance(dt * 10)) {
        const p = this.parts[0];
        const x = (p?.hx ?? this.x) + w.rng.range(-30, 30), y = (p?.hy ?? this.y) + w.rng.range(-26, 20);
        w.fx.explosion(x, y, 16);
        w.sfx('explosion', 0.5);
      }
      if (this.deathT > 2.2 && !this.defeated) {
        this.defeated = true;
        for (const p of this.parts) p.dead = true;
      }
      return;
    }
    if (this.jamT > 0) { this.jamT -= dt; dt *= 0.7; }
    this.clock += dt;
    for (const p of this.parts) if (p.flash > 0) p.flash -= dt;
    if (this.clock - this.lastHitAt > 2 && this.staggerT <= 0) this.poise = Math.max(0, this.poise - 25 * dt);
    this.think(w, dt);
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (w.rng.chance(dt * 8)) w.fx.sparks(this.x + w.rng.range(-20, 20), this.y - 30 + w.rng.range(-15, 15), 3, P.amber, 80);
      if (this.staggerT <= 0) {
        this.poise = 0;
        this.script = null;
        this.onStaggerEnd(w);
      }
      return;
    }
    if (!this.script) this.script = this.brain(w);
    if (this.script.next().done) this.script = null;
  }

  takeHit(w: World, part: BossPart, h: Hit): number {
    if (this.dying || this.defeated) return 0;
    if (this.invuln || part.invulnerable) {
      if (!h.quiet) { w.fx.sparks(h.x, h.y, 2, P.fog, 50); w.sfx('armor', 0.6); }
      return 0;
    }
    const m = this.modHit(w, part, h);
    if (m.tag === 'immune') {
      if (!h.quiet) { w.fx.sparks(h.x, h.y, 2, P.fog, 50); w.sfx('armor', 0.6); }
      return 0;
    }
    let mul = m.mul * part.dmgMul * this.vulnMul * (this.staggerT > 0 ? 1.5 : 1);
    if (m.tag === 'weak' || part.weak) mul *= w.player.weakMul;
    const dmg = h.dmg * mul;
    if (dmg <= 0) return 0;
    this.hp -= dmg;
    this.lastHitAt = this.clock;
    if (!h.quiet) {
      // brief flash, rate-limited so sustained damage does not keep the sprite white
      if (this.clock - part.lastFlashAt > 0.18) { part.flash = 0.05; part.lastFlashAt = this.clock; }
      const c = h.from === 'env' ? P.amber : m.tag === 'armor' ? P.fog : m.tag === 'weak' || part.weak ? P.orange : this.staggerT > 0 ? P.rose : P.white;
      w.fx.number(part.id * 10 + (h.from === 'env' ? 1 : 0), h.x, h.y, dmg, c, dmg >= 60);
      if (m.tag === 'armor') { w.sfx('armor'); w.fx.sparks(h.x, h.y, 2, P.pale, 70); }
      else if (m.tag === 'weak' || part.weak) w.sfx('weak');
      else w.sfx('bossHit');
    }
    if (this.staggerT <= 0 && h.poise) this.addPoise(w, h.poise);
    while (this.phase < this.thresholds.length && this.hp <= this.maxHp * this.thresholds[this.phase] && this.hp > 0) {
      this.phase++;
      this.enterPhase(w, this.phase);
    }
    if (this.hp <= 0) this.die(w);
    return dmg;
  }

  addPoise(w: World, amount: number): void {
    if (this.staggerT > 0 || this.dying) return;
    this.poise += amount;
    if (this.poise >= this.poiseMax) this.stagger(w);
  }

  stagger(w: World, dur = this.staggerDur): void {
    if (this.dying) return;
    this.staggerT = dur;
    this.poise = this.poiseMax;
    this.cancelAttacks(w);
    this.script = null;
    w.stats.staggers++;
    w.fx.label(this.x, this.y - 70, '瘫痪', P.amber, 1.2);
    w.fx.shake(4, 0.2);
    w.sfx('stagger');
    this.onStagger(w);
  }

  /** Remove this boss's pending telegraphs. Active hazards keep running. */
  cancelAttacks(w: World): void {
    for (const h of w.hazards) if (h.owner === this && h.warning && h.cancelable) h.dead = true;
  }

  private enterPhase(w: World, phase: number): void {
    this.cancelAttacks(w);
    this.staggerT = 0;
    this.poise = 0;
    const self = this;
    this.script = (function* () {
      yield* self.transition(w, phase);
      yield* self.brain(w);
    })();
    w.sfx('phase');
    w.fx.shake(5, 0.4);
  }

  jam(w: World, s: number): void {
    this.jamT = Math.max(this.jamT, s);
    w.fx.label(this.x, this.y - 70, '干扰', P.acid, 1);
  }

  die(w: World): void {
    this.dying = true;
    this.hp = 0;
    this.script = null;
    this.cancelAttacks(w);
    for (const h of w.hazards) if (h.owner === this) h.dead = true;
    for (const b of w.bullets) if (b.team === 'enemy') b.dead = true;
    w.slowmo(0.25, 1.2);
    w.fx.flash(P.white, 0.6, 0.3);
    w.sfx('bossDeath');
    this.onDeath(w);
  }

  // ------------------------------------------------------------------ helpers for subclasses
  hazard(shape: Shape, warn: number, active: number, setup?: (h: Hazard) => void): Hazard {
    const h = new Hazard(shape, warn, active);
    h.owner = this;
    setup?.(h);
    return this.w.addHazard(h);
  }

  shoot(x: number, y: number, a: number, speed: number, o: ShotOpts = {}): Bullet {
    const sp = speed * this.bulletMul;
    const b = new Bullet(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 'enemy');
    b.soft = o.soft ?? true;
    b.frame = o.frame ?? (b.soft ? 'orb_o' : 'bolt');
    b.r = o.r ?? (b.soft ? 3 : 2.5);
    b.dmg = o.dmg ?? 1;
    b.life = o.life ?? 4;
    b.accel = o.accel ?? 0;
    b.minSpeed = o.minSpeed ?? 0;
    b.low = o.low ?? false;
    b.rotates = o.rotates ?? !b.soft;
    b.glow = o.glow ?? 5;
    b.glowColor = o.glowColor ?? (b.soft ? COL.soft : COL.hard);
    b.deflectable = o.deflectable ?? true;
    return this.w.addBullet(b);
  }

  /** Fan of n bullets centred on angle a, total spread `spread` radians. */
  fan(x: number, y: number, a: number, n: number, spread: number, speed: number, o?: ShotOpts): void {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      this.shoot(x, y, a + t * spread, speed, o);
    }
  }

  ring(x: number, y: number, n: number, speed: number, offset = 0, o?: ShotOpts): void {
    for (let i = 0; i < n; i++) this.shoot(x, y, offset + (i / n) * Math.PI * 2, speed, o);
  }

  /** Angle from a point to the current target's hurt centre. */
  aimFrom(x: number, y: number): number {
    const t = this.w.target();
    return angleTo(x, y, t.hx, t.hy);
  }

  distToTarget(): number {
    const t = this.w.target();
    return dist(this.x, this.y, t.x, t.y);
  }

  dirToTarget(): [number, number] {
    const t = this.w.target();
    return norm(t.x - this.x, t.y - this.y);
  }

  wait(s: number): Script { return wait(this, s); }
}
