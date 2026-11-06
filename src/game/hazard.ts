/**
 * Hazard: a telegraphed damage area. It shows a red warning for `warn` seconds, then is
 * active for `active` seconds. Bosses create them for every area attack; the environment and
 * player abilities use them too (explosions, fire).
 *
 * Zone: a floor area with a material (oil, water, acid) that can burn or be electrified.
 */
import type { Gfx } from '../engine/gfx';
import { COL, P } from '../engine/gfx';
import { nextId } from './body';
import { shapeHits, type Shape } from './types';
import type { World } from './world';

export class Hazard {
  readonly id = nextId();
  t = 0;
  /** Hearts dealt to the player. */
  dmg = 1;
  /** Ground attack: jumping players ignore it. */
  low = false;
  hitsPlayer = true;
  /** Damage to enemy-team bodies (environment / player hazards). Per hit, or per second if `tick`. */
  enemyDmg = 0;
  enemyPoise = 0;
  tick = false;
  team: 'enemy' | 'env' | 'player' = 'enemy';
  /** Owner (boss) — warnings are cancelled when the owner is staggered. */
  owner: unknown = null;
  cancelable = true;
  color = COL.danger;
  /** Draw the warning shape. */
  visible = true;
  /** Scrolling maps: show an off-screen edge marker even when it deals no hits (visual-only telegraphs). */
  marker = false;
  /** Draw a fill while active (false when the attack draws its own visuals). */
  activeFill = true;
  readonly hitSet = new Set<number>();
  dead = false;
  onActivate?: (w: World, h: Hazard) => void;
  /** Called every step in both phases (moving / growing shapes). */
  onTick?: (w: World, h: Hazard, dt: number) => void;
  onEnd?: (w: World, h: Hazard) => void;
  private activated = false;

  constructor(public shape: Shape, public warn: number, public active: number) {}

  get warning(): boolean { return this.t < this.warn; }
  /** 0..1 progress through the warning. */
  get progress(): number { return this.warn > 0 ? Math.min(1, this.t / this.warn) : 1; }

  update(w: World, dt: number): void {
    this.t += dt;
    this.onTick?.(w, this, dt);
    if (this.warning) return;
    if (!this.activated) {
      this.activated = true;
      this.onActivate?.(w, this);
    }
    if (this.hitsPlayer && (this.team !== 'player')) {
      const p = w.player;
      if ((this.tick || !this.hitSet.has(-1)) && shapeHits(this.shape, p.x, p.y - 4, 4)) {
        const res = w.hitPlayer(this.dmg, { x: p.x, y: p.y, low: this.low, kind: 'blast' });
        if (res !== 'ignored') this.hitSet.add(-1);
      }
    }
    if (this.enemyDmg > 0) {
      for (const b of w.bodies) {
        if (b.dead || b.team !== 'enemy') continue;
        if (!this.tick && this.hitSet.has(b.id)) continue;
        if (!shapeHits(this.shape, b.x, b.y, b.r)) continue;
        this.hitSet.add(b.id);
        w.damage(b, {
          dmg: this.tick ? this.enemyDmg * dt : this.enemyDmg, kind: 'fire', x: b.hx, y: b.hy,
          poise: this.tick ? this.enemyPoise * dt : this.enemyPoise, from: this.team === 'player' ? 'player' : 'env',
          src: 'fire', quiet: this.tick, ignite: true,
        });
      }
    }
    if (this.t >= this.warn + this.active) {
      this.dead = true;
      this.onEnd?.(w, this);
    }
  }

  draw(g: Gfx): void {
    if (!this.visible) return;
    const s = this.shape;
    const warn = this.warning;
    if (!warn && !this.activeFill) return;
    const p = this.progress;
    const c = this.color;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 30);
    const fillA = warn ? 0.1 + 0.18 * p : 0.55;
    const fillC = warn ? c : P.rose;
    switch (s.k) {
      case 'circle':
        g.circle(s.x, s.y, s.r, fillC, fillA);
        if (warn) {
          g.circle(s.x, s.y, s.r * p, c, 0.22);
          g.ring(s.x, s.y, s.r, 1, c, 0.6 + 0.4 * pulse);
        }
        break;
      case 'ring':
        g.ring(s.x, s.y, s.r, s.w, fillC, warn ? 0.3 + 0.3 * pulse : 0.7);
        if (!warn) g.ring(s.x, s.y, s.r, 2, P.white, 0.8);
        break;
      case 'rect':
        g.rect(s.x, s.y, s.w, s.h, fillC, fillA);
        if (warn) g.strokeRect(s.x, s.y, s.w, s.h, 1, c, 0.6 + 0.4 * pulse);
        break;
      case 'line': {
        g.line(s.x1, s.y1, s.x2, s.y2, s.w, fillC, fillA);
        if (warn) {
          g.line(s.x1, s.y1, s.x2, s.y2, Math.max(1, s.w * p), c, 0.25);
          const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l = Math.hypot(dx, dy) || 1;
          const nx = (-dy / l) * (s.w / 2), ny = (dx / l) * (s.w / 2);
          const a = 0.6 + 0.4 * pulse;
          g.line(s.x1 + nx, s.y1 + ny, s.x2 + nx, s.y2 + ny, 1, c, a);
          g.line(s.x1 - nx, s.y1 - ny, s.x2 - nx, s.y2 - ny, 1, c, a);
        }
        break;
      }
      case 'sector': {
        const a0 = s.a - s.span / 2, a1 = s.a + s.span / 2;
        g.sector(s.x, s.y, s.r, a0, a1, fillC, fillA, 'floor', s.inner);
        if (warn) g.sector(s.x, s.y, s.r * p, a0, a1, c, 0.2, 'floor', s.inner);
        break;
      }
    }
  }
}

export type ZoneKind = 'oil' | 'water' | 'acid';

export class Zone {
  readonly id = nextId();
  /** Seconds left burning / electrified. */
  burning = 0;
  electrified = 0;
  life = Infinity;
  age = 0;
  /** Burning oil ignites again only after this cooldown. */
  burnCooldown = 0;
  /** Arena draws water itself; zones only draw overlays when true. */
  drawBase = true;
  dead = false;

  constructor(public kind: ZoneKind, public shape: Shape) {}

  contains(x: number, y: number, r = 0): boolean { return shapeHits(this.shape, x, y, r); }

  update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) this.dead = true;
    if (this.burnCooldown > 0) this.burnCooldown -= dt;
    if (this.burning > 0) {
      this.burning -= dt;
      if (this.burning <= 0) this.burnCooldown = 3;
      if (w.rng.chance(dt * 30)) {
        const pt = this.randomPoint(w);
        w.fx.flame(pt.x, pt.y);
      }
    }
    if (this.electrified > 0) {
      this.electrified -= dt;
      if (w.rng.chance(dt * 40)) {
        const pt = this.randomPoint(w);
        w.fx.sparks(pt.x, pt.y, 2, COL.shock, 50);
      }
    }
  }

  ignite(): void {
    if (this.kind !== 'oil' || this.burning > 0 || this.burnCooldown > 0) return;
    this.burning = 4;
  }

  randomPoint(w: World): { x: number; y: number } {
    const s = this.shape;
    for (let i = 0; i < 8; i++) {
      let x = 0, y = 0;
      if (s.k === 'circle') { const a = w.rng.next() * Math.PI * 2, r = Math.sqrt(w.rng.next()) * s.r; x = s.x + Math.cos(a) * r; y = s.y + Math.sin(a) * r * 0.8; }
      else if (s.k === 'rect') { x = s.x + w.rng.next() * s.w; y = s.y + w.rng.next() * s.h; }
      else return { x: 0, y: 0 };
      if (this.contains(x, y)) return { x, y };
    }
    return s.k === 'circle' ? { x: s.x, y: s.y } : s.k === 'rect' ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : { x: 0, y: 0 };
  }

  draw(g: Gfx): void {
    const s = this.shape;
    if (this.drawBase && this.kind === 'oil' && s.k === 'circle') {
      g.ellipse(s.x, s.y, s.r, s.r * 0.8, P.ink, 0.75);
      g.ellipse(s.x - s.r * 0.25, s.y - s.r * 0.2, s.r * 0.35, s.r * 0.18, P.grape, 0.5);
    }
    if (this.drawBase && this.kind === 'acid' && s.k === 'circle') {
      g.ellipse(s.x, s.y, s.r, s.r * 0.8, P.moss, 0.7);
      g.ellipse(s.x, s.y, s.r * 0.6, s.r * 0.45, P.lime, 0.5);
    }
    if (this.burning > 0 && s.k === 'circle') {
      const f = Math.min(1, this.burning);
      g.ellipse(s.x, s.y, s.r, s.r * 0.8, P.orange, 0.35 * f);
      g.circle(s.x, s.y - 4, s.r * 1.2, P.orange, 0.15 * f, 'light');
    }
    if (this.electrified > 0) {
      const a = 0.25 + 0.2 * Math.sin(this.age * 50);
      if (s.k === 'circle') g.ellipse(s.x, s.y, s.r, s.r * 0.8, P.ice, a);
      if (s.k === 'rect') g.rect(s.x, s.y, s.w, s.h, P.ice, a);
    }
  }
}

/**
 * A small patch of fire on the floor (world object, push into `w.objects`).
 * team 'player' hurts only enemies (dragon's breath), 'enemy' hurts only the player
 * (boss fire trails), 'env' hurts both. Always ignites flammables and oil it touches.
 */
export class FirePatch {
  t = 0;
  dead = false;
  constructor(public x: number, public y: number, public r: number, public dur: number, public team: 'player' | 'enemy' | 'env') {}

  update(w: World, dt: number): void {
    this.t += dt;
    if (this.t >= this.dur) { this.dead = true; return; }
    if (w.rng.chance(dt * 14 * (this.r / 10))) {
      w.fx.flame(this.x + w.rng.range(-this.r, this.r) * 0.8, this.y + w.rng.range(-this.r, this.r) * 0.5);
    }
    const p = w.player;
    if (this.team !== 'player' && !p.airborne && (p.x - this.x) ** 2 + ((p.y - this.y) * 1.25) ** 2 < (this.r + 2) ** 2) {
      w.hitPlayer(1, { low: true, kind: 'fire', x: p.x, y: p.y, perfectable: false });
    }
    for (const b of w.bodies) {
      if (b.dead) continue;
      const near = (b.x - this.x) ** 2 + (b.y - this.y) ** 2 < (this.r + b.r * 0.6) ** 2;
      if (!near) continue;
      if (b.team === 'enemy' && this.team !== 'enemy') {
        w.damage(b, { dmg: 12 * dt, kind: 'fire', x: b.hx, y: b.hy, from: this.team === 'player' ? 'player' : 'env', src: 'fire', quiet: true, ignite: true, poise: 3 * dt });
      } else if (b.team === 'neutral' && b.flammable) {
        w.damage(b, { dmg: 0, kind: 'fire', x: b.hx, y: b.hy, from: 'env', src: 'fire', ignite: true, quiet: true });
      }
    }
    for (const z of w.zones) if (z.kind === 'oil' && z.contains(this.x, this.y, this.r)) z.ignite();
  }

  draw(g: Gfx): void {
    const f = Math.min(1, (this.dur - this.t) * 2);
    g.ellipse(this.x, this.y, this.r, this.r * 0.75, P.orange, 0.3 * f);
    g.ellipse(this.x, this.y, this.r * 0.6, this.r * 0.4, P.sodium, 0.35 * f);
    g.circle(this.x, this.y - 3, this.r * 1.5, P.orange, 0.12 * f, 'light');
  }
}
