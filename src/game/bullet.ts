/** Projectiles (both teams). Behaviour hooks can be overridden by subclasses (nails, hooks...). */
import type { Gfx } from '../engine/gfx';
import { COL } from '../engine/gfx';
import { nextId, type Body } from './body';
import type { DmgKind } from './types';
import type { World } from './world';

export class Bullet {
  readonly id = nextId();
  r = 2;
  /** Player bullets: hit points. Enemy bullets: hearts (pips). */
  dmg = 1;
  poise = 0;
  /** Soft bullets can be destroyed by pellets, shoves and landing shockwaves. */
  soft = true;
  life = 4;
  age = 0;
  /** Extra bodies it can pass through (Infinity = all). */
  pierce = 0;
  readonly hitIds = new Set<number>();
  /** Frame in the 'proj' sheet. */
  frame = 'orb_o';
  rotates = false;
  scale = 1;
  /** Additive glow radius (0 = none) and colour. */
  glow = 0;
  glowColor = COL.soft;
  src = '';
  kind: DmgKind = 'bullet';
  knock = 0;
  armorBreak = 0;
  ignite = false;
  /** Turn rate toward the nearest enemy (rad/s), player bullets only. */
  homing = 0;
  /** Speed change per second (negative = decelerate). */
  accel = 0;
  minSpeed = 0;
  dead = false;
  /** Destroys enemy soft bullets on contact (shotgun pellets). */
  cancelsSoft = false;
  /** Extra soft bullets it can break before it is used up. */
  softPierce = 0;
  /** Can be sent back by the blade / hydraulic fist. */
  deflectable = true;
  /** Rolls along the ground: jumping players are not hit. */
  low = false;
  /** Was reflected by the player (counts for stats; uses player team). */
  deflected = false;

  constructor(public x: number, public y: number, public vx: number, public vy: number, public team: 'player' | 'enemy') {}

  get speed(): number { return Math.hypot(this.vx, this.vy); }

  update(w: World, dt: number): void {
    this.age += dt;
    if (this.age >= this.life) {
      this.onExpire(w);
      this.dead = true;
      return;
    }
    if (this.accel) {
      const sp = this.speed;
      const ns = Math.max(this.minSpeed, sp + this.accel * dt);
      if (sp > 0) { this.vx *= ns / sp; this.vy *= ns / sp; }
    }
    if (this.homing > 0 && this.team === 'player') {
      const t = w.nearestEnemy(this.x, this.y, 260, this.vx, this.vy, 0.9);
      if (t) {
        const want = Math.atan2(t.hy - this.y, t.hx - this.x);
        const cur = Math.atan2(this.vy, this.vx);
        let d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const step = Math.max(-this.homing * dt, Math.min(this.homing * dt, d));
        const sp = this.speed, a = cur + step;
        this.vx = Math.cos(a) * sp;
        this.vy = Math.sin(a) * sp;
      }
    }
    const travel = this.speed * dt;
    const steps = Math.max(1, Math.ceil(travel / 4));
    const sx = (this.vx * dt) / steps, sy = (this.vy * dt) / steps;
    for (let i = 0; i < steps && !this.dead; i++) {
      this.x += sx;
      this.y += sy;
      if (w.pointBlocked(this.x, this.y)) {
        this.onWall(w);
        if (this.dead) return;
      }
      this.collide(w);
    }
  }

  protected collide(w: World): void {
    if (this.team === 'enemy') {
      const p = w.player;
      if (!this.hitIds.has(-1) && p.overlapsHurt(this.x, this.y, this.r)) {
        const res = w.hitPlayer(this.dmg, { x: this.x, y: this.y, dx: this.vx, dy: this.vy, low: this.low, kind: this.kind });
        if (res === 'hit') { this.dead = true; return; }
        this.hitIds.add(-1);
      }
    }
    for (const b of w.bodies) {
      if (b.dead || this.hitIds.has(b.id)) continue;
      if (this.team === 'enemy' && b.team === 'enemy') continue;
      if (this.team === 'player' && b.team === 'player') continue;
      if (b.team === 'neutral' && !b.blocksShots && !b.flammable) continue;
      const dx = this.x - b.hx, dy = this.y - b.hy;
      const rr = this.r + b.hr;
      if (dx * dx + dy * dy > rr * rr) continue;
      this.hitIds.add(b.id);
      this.onHitBody(w, b);
      if (this.dead) return;
    }
  }

  onHitBody(w: World, b: Body): void {
    const sp = this.speed || 1;
    w.damage(b, {
      dmg: this.team === 'enemy' ? this.dmg * 6 : this.dmg, kind: this.kind, x: this.x, y: this.y,
      dx: this.vx / sp, dy: this.vy / sp, poise: this.poise, from: this.team === 'enemy' ? 'enemy' : 'player',
      src: this.src, knock: this.knock, armorBreak: this.armorBreak, ignite: this.ignite,
    });
    if (this.pierce-- <= 0 || b.blocksShots && this.pierce !== Infinity) this.dead = true;
  }

  onWall(w: World): void {
    this.dead = true;
    w.fx.sparks(this.x, this.y, 3, this.team === 'player' ? COL.player : this.glowColor, 60);
  }

  onExpire(_w: World): void {}

  draw(g: Gfx, _w: World): void {
    const a = this.rotates ? Math.atan2(this.vy, this.vx) : 0;
    if (this.glow) g.circle(this.x, this.y, this.glow, this.glowColor, 0.28, 'light');
    g.img('proj', this.frame, this.x, this.y, { layer: 'top', ox: 0.5, oy: 0.5, rot: a, scale: this.scale });
  }
}
