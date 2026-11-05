/**
 * World: one boss fight. Owns every entity, runs the fixed-step simulation and draws itself
 * through the Gfx interface. No Phaser here — the FightScene feeds input and a Gfx.
 *
 * Step order: player -> boss -> bodies -> bullets -> hazards -> zones -> arena -> fx.
 * Time: `time` is scaled world time (slow motion), `realTime` is unscaled.
 */
import { audio, type SfxName } from '../engine/audio';
import { COL, P, type Gfx } from '../engine/gfx';
import type { InputState } from '../engine/input';
import { angleDiff, clamp, dist, pointInRect, rayCircle, rayRect, Rng, type Rect } from '../engine/math';
import { JAM_SLOW, type Boss } from './boss';
import type { Body } from './body';
import type { Bullet } from './bullet';
import { Fx } from './fx';
import { Hazard, type Zone } from './hazard';
import type { Player } from './player';
import type { Cable, Hit } from './types';

export const SCREEN_W = 640;
export const SCREEN_H = 360;

export interface Arena {
  id: string;
  /** Background texture (floor + walls), 640x360. */
  bg: string;
  /** Playable rectangle (inside the walls). */
  bounds: Rect;
  playerSpawn: { x: number; y: number };
  /** Add props, zones and arena objects. Called once before the boss spawns. */
  setup(w: World): void;
  update?(w: World, dt: number): void;
  /** Drawn after the floor, before bodies (decals). */
  drawFloor?(g: Gfx, w: World): void;
  /** Drawn above everything in the world (overhead crane, lights). */
  drawTop?(g: Gfx, w: World): void;
  /**
   * Autopilot only: a safe spot the bot should run to right now (e.g. dry grating before the
   * water goes live), and whether to jump/dash when it cannot make it. Gameplay never calls this.
   */
  botHint?(w: World): { x: number; y: number; jump: boolean } | null;
}

export interface HitPlayerOpts {
  x?: number;
  y?: number;
  dx?: number;
  dy?: number;
  /** Ground attack: ignored while airborne. */
  low?: boolean;
  kind?: string;
  /** Knockback speed applied to the player on a real hit. */
  knock?: number;
  /** Floor damage that ticks every step (fire, live water): dashing through it is not a perfect dodge. */
  perfectable?: boolean;
}

export type PlayerHitResult = 'hit' | 'dodged' | 'ignored';

export interface FightStats {
  damageBySrc: Record<string, number>;
  envDamage: number;
  hitsTaken: number;
  perfectDodges: number;
  staggers: number;
}

export class World {
  time = 0;
  realTime = 0;
  /** Global slow motion (bullet time) — 1 = normal. */
  timeScale = 1;
  private slowT = 0;
  private slowTarget = 1;
  /** When true the player ignores timeScale (reflex booster). */
  playerUnscaled = false;
  hitstop = 0;
  /** True when the last step was skipped by hitstop (input edges must not be cleared). */
  frozen = false;
  /** RNG for visuals only (lightning jitter...), so drawing never changes the simulation. */
  readonly vrng = new Rng(4242);
  readonly rng: Rng;
  readonly fx = new Fx();

  bodies: Body[] = [];
  bullets: Bullet[] = [];
  hazards: Hazard[] = [];
  zones: Zone[] = [];
  cables: Cable[] = [];
  /** Per-frame custom draw/update hooks (arena objects, boss helpers). */
  objects: { update(w: World, dt: number): void; draw?(g: Gfx, w: World): void; drawTop?(g: Gfx, w: World): void; dead?: boolean }[] = [];
  walls: Rect[] = [];
  bounds: Rect;

  player!: Player;
  boss: Boss | null = null;
  /** Fake target left by the phase step legs. Bosses aim at it while it exists. */
  decoy: { x: number; y: number; t: number } | null = null;
  input!: InputState;
  readonly stats: FightStats = { damageBySrc: {}, envDamage: 0, hitsTaken: 0, perfectDodges: 0, staggers: 0 };
  state: 'intro' | 'fight' | 'won' | 'lost' = 'intro';
  stateT = 0;
  /** Interact prompt shown above the player. */
  prompt: string | null = null;
  /** Loan modifiers for this fight. */
  hpMul = 1;
  paceMul = 1;

  constructor(public arena: Arena, public tier: number, seed: number) {
    this.rng = new Rng(seed);
    this.bounds = arena.bounds;
    const b = arena.bounds, T = 64;
    // Boundary walls as four thick rectangles around the playable area.
    this.walls.push({ x: b.x - T, y: b.y - T, w: b.w + 2 * T, h: T });
    this.walls.push({ x: b.x - T, y: b.y + b.h, w: b.w + 2 * T, h: T });
    this.walls.push({ x: b.x - T, y: b.y, w: T, h: b.h });
    this.walls.push({ x: b.x + b.w, y: b.y, w: T, h: b.h });
  }

  sfx(name: SfxName, vol = 1, pitch = 1): void { audio.sfx(name, vol, pitch); }

  add<T extends Body>(b: T): T { this.bodies.push(b); return b; }
  addBullet<T extends Bullet>(b: T): T { this.bullets.push(b); return b; }
  addHazard(h: Hazard): Hazard { this.hazards.push(h); return h; }
  addZone(z: Zone): Zone { this.zones.push(z); return z; }

  // ------------------------------------------------------------------ time
  /** Slow the world to `scale` for `dur` real seconds. */
  slowmo(scale: number, dur: number): void {
    if (scale <= this.slowTarget || this.slowT <= 0) { this.slowTarget = scale; this.slowT = Math.max(this.slowT, dur); }
  }

  step(dt: number, input: InputState): void {
    this.input = input;
    this.realTime += dt;
    this.fx.update(dt);
    // during hitstop nothing reads input, so the scene must keep this step's presses (see `frozen`)
    this.frozen = this.hitstop > 0;
    if (this.hitstop > 0) { this.hitstop -= dt; return; }
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.timeScale = this.slowTarget;
      if (this.slowT <= 0) { this.timeScale = 1; this.slowTarget = 1; this.playerUnscaled = false; }
    }
    const wdt = dt * this.timeScale;
    this.stateT += dt;
    this.prompt = null;

    this.player.update(this, input, this.playerUnscaled ? dt : wdt);
    if (this.boss && this.state !== 'intro') this.boss.update(this, wdt);
    for (const b of this.bodies) if (!b.dead) b.update(this, wdt);
    // a jammed boss is slowed as a whole: its own bullets and telegraphs too
    const jam = this.boss && this.boss.jamT > 0 && !this.boss.dying ? JAM_SLOW : 1;
    for (const b of this.bullets) if (!b.dead) b.update(this, b.team === 'enemy' ? wdt * jam : wdt);
    this.cancelSoftBullets();
    for (const h of this.hazards) if (!h.dead) h.update(this, h.owner && h.owner === this.boss ? wdt * jam : wdt);
    this.updateZones(wdt);
    this.arena.update?.(this, wdt);
    for (const o of this.objects) if (!o.dead) o.update(this, wdt);
    if (this.decoy) { this.decoy.t -= wdt; if (this.decoy.t <= 0) this.decoy = null; }

    this.bodies = this.bodies.filter((b) => !b.dead);
    this.bullets = this.bullets.filter((b) => !b.dead);
    this.hazards = this.hazards.filter((h) => !h.dead);
    this.zones = this.zones.filter((z) => !z.dead);
    this.cables = this.cables.filter((c) => !c.dead);
    this.objects = this.objects.filter((o) => !o.dead);
    this.time += wdt;

    if (this.state === 'fight') {
      if (this.player.hp <= 0) { this.state = 'lost'; this.stateT = 0; }
      else if (this.boss && this.boss.defeated) { this.state = 'won'; this.stateT = 0; }
    }
  }

  private cancelSoftBullets(): void {
    const cancelers = this.bullets.filter((b) => b.cancelsSoft && !b.dead);
    if (!cancelers.length) return;
    for (const e of this.bullets) {
      if (e.dead || e.team !== 'enemy' || !e.soft) continue;
      for (const c of cancelers) {
        if (c.dead) continue;
        const rr = c.r + e.r + 2;
        if ((c.x - e.x) ** 2 + (c.y - e.y) ** 2 <= rr * rr) {
          e.dead = true;
          if (c.pierce !== Infinity) c.dead = true; // the slug keeps going ("穿透一切")
          this.fx.burst(e.x, e.y, 4, COL.soft, 50, 0.2, 1);
          this.sfx('pop');
          break;
        }
      }
    }
  }

  private updateZones(dt: number): void {
    const p = this.player;
    for (const z of this.zones) {
      z.update(this, dt);
      if (z.burning > 0) {
        if (!p.airborne && z.contains(p.x, p.y, 2)) this.hitPlayer(1, { low: true, kind: 'fire', x: p.x, y: p.y, perfectable: false });
        for (const b of this.bodies) {
          if (b.dead) continue;
          if (!z.contains(b.x, b.y, b.r * 0.5)) continue;
          if (b.team === 'enemy') this.damage(b, { dmg: 16 * dt, kind: 'fire', x: b.hx, y: b.hy, from: 'env', src: 'fire', quiet: true, ignite: true, poise: 4 * dt });
          else if (b.flammable) this.damage(b, { dmg: 0, kind: 'fire', x: b.hx, y: b.hy, from: 'env', src: 'fire', ignite: true, quiet: true });
        }
        // spread fire to touching oil
        for (const o of this.zones) if (o !== z && o.kind === 'oil' && o.burning <= 0 && zonesTouch(z, o)) o.ignite();
      }
      if (z.electrified > 0) {
        if (!p.airborne && z.contains(p.x, p.y, 0)) this.hitPlayer(1, { low: true, kind: 'shock', x: p.x, y: p.y, perfectable: false });
        for (const b of this.bodies) {
          if (!b.dead && z.contains(b.x, b.y, 0)) b.onShock?.(this, 40, dt);
        }
      }
    }
  }

  // ------------------------------------------------------------------ queries
  pointInWall(x: number, y: number): boolean {
    for (const r of this.walls) if (pointInRect(x, y, r)) return true;
    return false;
  }

  /** Walls or shot-blocking bodies (pillars) at a point (bullets use the hurt circle). */
  pointBlocked(x: number, y: number): boolean {
    if (this.pointInWall(x, y)) return true;
    return false;
  }

  /** First wall hit along a ray (distance), ignoring bodies. */
  rayWall(ox: number, oy: number, dx: number, dy: number, max = 1000): number {
    let best = max;
    for (const r of this.walls) best = Math.min(best, rayRect(ox, oy, dx, dy, r));
    return best;
  }

  /**
   * Ray against walls and bodies. `filter` selects which bodies can stop the ray.
   * Bodies are tested on their ground circle when `ground` is set (charges), else on the hurt circle.
   */
  raycast(ox: number, oy: number, dx: number, dy: number, max: number, filter: (b: Body) => boolean, ground = false): { t: number; body: Body | null } {
    let t = this.rayWall(ox, oy, dx, dy, max), body: Body | null = null;
    for (const b of this.bodies) {
      if (b.dead || !filter(b)) continue;
      const d = ground ? rayCircle(ox, oy, dx, dy, b.x, b.y, b.r) : rayCircle(ox, oy, dx, dy, b.hx, b.hy, b.hr);
      if (d < t) { t = d; body = b; }
    }
    return { t, body };
  }

  /** Nearest enemy body in front of (dirX, dirY) within `cone` radians (half-angle). */
  nearestEnemy(x: number, y: number, range: number, dirX = 0, dirY = 0, cone = Math.PI): Body | null {
    let best: Body | null = null, bd = range;
    const ref = Math.atan2(dirY, dirX);
    for (const b of this.bodies) {
      if (b.dead || b.team !== 'enemy' || !b.targetable) continue;
      const d = dist(x, y, b.hx, b.hy) - b.hr;
      if (d > bd) continue;
      if (cone < Math.PI && (dirX || dirY)) {
        const a = Math.atan2(b.hy - y, b.hx - x);
        if (Math.abs(angleDiff(ref, a)) > cone) continue;
      }
      bd = d;
      best = b;
    }
    return best;
  }

  bodiesInCircle(x: number, y: number, r: number, filter: (b: Body) => boolean = () => true, hurtCircle = true): Body[] {
    return this.bodies.filter((b) => {
      if (b.dead || !filter(b)) return false;
      const bx = b.x, by = hurtCircle ? b.hy : b.y, br = hurtCircle ? b.hr : b.r;
      return (bx - x) ** 2 + (by - y) ** 2 <= (r + br) ** 2;
    });
  }

  /** What bosses aim at: the decoy if one exists, otherwise the player. (feet position) */
  target(): { x: number; y: number; hx: number; hy: number } {
    if (this.decoy) return { x: this.decoy.x, y: this.decoy.y, hx: this.decoy.x, hy: this.decoy.y - 11 };
    const p = this.player;
    return { x: p.x, y: p.y, hx: p.x, hy: p.y - p.hz };
  }

  // ------------------------------------------------------------------ movement
  /**
   * Move a ground circle by (dx, dy), resolving walls and solid bodies.
   * Returns which obstacle was touched. `bounce` reflects velocity for props.
   */
  moveCircle(
    o: { x: number; y: number; r: number; vx?: number; vy?: number },
    dx: number, dy: number,
    opt: { bounce?: number; ignore?: Body | Body[]; solids?: boolean } = {},
  ): { wall: boolean; body: Body | null } {
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / Math.max(2, o.r * 0.8)));
    let hitWall = false, hitBody: Body | null = null;
    const ign = Array.isArray(opt.ignore) ? opt.ignore : opt.ignore ? [opt.ignore] : [];
    for (let s = 0; s < steps; s++) {
      o.x += dx / steps;
      o.y += dy / steps;
      for (const r of this.walls) {
        const cx = clamp(o.x, r.x, r.x + r.w), cy = clamp(o.y, r.y, r.y + r.h);
        let ddx = o.x - cx, ddy = o.y - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= o.r * o.r) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-6) { // centre inside: push out along the shortest axis
          const l = o.x - r.x, rr = r.x + r.w - o.x, t = o.y - r.y, bb = r.y + r.h - o.y;
          const m = Math.min(l, rr, t, bb);
          if (m === l) { ddx = -1; ddy = 0; } else if (m === rr) { ddx = 1; ddy = 0; } else if (m === t) { ddx = 0; ddy = -1; } else { ddx = 0; ddy = 1; }
          d = 0;
          o.x += ddx * (o.r + m); o.y += ddy * (o.r + m);
        } else {
          ddx /= d; ddy /= d;
          o.x = cx + ddx * o.r; o.y = cy + ddy * o.r;
        }
        hitWall = true;
        if (opt.bounce !== undefined && o.vx !== undefined && o.vy !== undefined) {
          const vn = o.vx * ddx + o.vy * ddy;
          if (vn < 0) { o.vx -= (1 + opt.bounce) * vn * ddx; o.vy -= (1 + opt.bounce) * vn * ddy; }
        }
      }
      if (opt.solids === false) continue;
      for (const b of this.bodies) {
        if (b.dead || !b.solid || b === o || ign.includes(b)) continue;
        const ddx = o.x - b.x, ddy = o.y - b.y;
        const rr = o.r + b.r;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const nx = ddx / d, ny = ddy / d;
        o.x = b.x + nx * rr; o.y = b.y + ny * rr;
        hitBody = b;
        if (opt.bounce !== undefined && o.vx !== undefined && o.vy !== undefined) {
          const vn = o.vx * nx + o.vy * ny;
          if (vn < 0) { o.vx -= (1 + opt.bounce) * vn * nx; o.vy -= (1 + opt.bounce) * vn * ny; }
        }
      }
    }
    return { wall: hitWall, body: hitBody };
  }

  /** Keep a point inside the playable bounds with margin. */
  clampToBounds(x: number, y: number, m = 8): [number, number] {
    const b = this.bounds;
    return [clamp(x, b.x + m, b.x + b.w - m), clamp(y, b.y + m, b.y + b.h - m)];
  }

  // ------------------------------------------------------------------ damage
  damage(b: Body, h: Hit): number {
    if (b.dead) return 0;
    const dealt = b.hurt(this, h);
    if (dealt > 0 && b.team === 'enemy') {
      if (h.from === 'player') {
        const k = h.src ?? h.kind;
        this.stats.damageBySrc[k] = (this.stats.damageBySrc[k] ?? 0) + dealt;
      } else if (h.from === 'env') this.stats.envDamage += dealt;
    }
    if (h.knock && b.mass > 0 && (h.dx !== undefined || h.dy !== undefined)) b.push((h.dx ?? 0) * h.knock, (h.dy ?? 0) * h.knock);
    return dealt;
  }

  hitPlayer(dmg: number, o: HitPlayerOpts = {}): PlayerHitResult {
    if (this.state !== 'fight') return 'ignored';
    return this.player.hurt(this, dmg, o);
  }

  /**
   * Explosion: damages enemy bodies, the player, ignites flammables and oil, pushes props and
   * destroys enemy soft bullets.
   */
  explode(x: number, y: number, r: number, o: { enemyDmg: number; poise?: number; armorBreak?: number; playerDmg?: number; from: 'player' | 'env' | 'enemy'; src: string; knock?: number }): void {
    this.fx.explosion(x, y, r);
    this.fx.shake(5, 0.25);
    this.hitstop = Math.max(this.hitstop, 0.04);
    this.sfx('explosion');
    for (const b of this.bodies) {
      if (b.dead) continue;
      const d = dist(x, y, b.x, b.y - b.hz * 0.5);
      if (d > r + b.r) continue;
      const nx = (b.x - x) / (d || 1), ny = (b.y - y) / (d || 1);
      if (b.team === 'enemy') {
        if (o.from !== 'enemy') this.damage(b, { dmg: o.enemyDmg, kind: 'blast', x: b.hx, y: b.hy, dx: nx, dy: ny, poise: o.poise, armorBreak: o.armorBreak, from: o.from, src: o.src, ignite: true });
      } else {
        this.damage(b, { dmg: 30, kind: 'blast', x: b.hx, y: b.hy, dx: nx, dy: ny, from: 'env', src: o.src, ignite: true });
        if (b.mass > 0) b.push(nx * (o.knock ?? 260), ny * (o.knock ?? 260));
      }
    }
    if (o.playerDmg && dist(x, y, this.player.x, this.player.y - 6) < r) {
      this.hitPlayer(o.playerDmg, { x, y, knock: 160, dx: this.player.x - x, dy: this.player.y - y });
    }
    for (const z of this.zones) if (z.kind === 'oil' && z.contains(x, y, r)) z.ignite();
    for (const e of this.bullets) if (e.team === 'enemy' && e.soft && dist(x, y, e.x, e.y) < r) e.dead = true;
  }

  /** Remove (or count) enemy bullets in a radius. */
  clearBullets(x: number, y: number, r: number, softOnly: boolean): number {
    let n = 0;
    for (const e of this.bullets) {
      if (e.dead || e.team !== 'enemy' || (softOnly && !e.soft)) continue;
      if (dist(x, y, e.x, e.y) <= r + e.r) { e.dead = true; n++; this.fx.burst(e.x, e.y, 3, COL.soft, 40, 0.2, 1); }
    }
    if (n) this.sfx('pop');
    return n;
  }

  // ------------------------------------------------------------------ drawing
  /** Seconds of glyph look left: the body's own hack timer, or the whole boss side while jammed. null = the boss. */
  glyphLeft(b: Body | null): number {
    const jam = this.boss && !this.boss.dying && (!b || b.team === 'enemy') ? this.boss.jamT : 0;
    return Math.max(b ? b.glyphUntil - this.time : 0, jam);
  }

  draw(g: Gfx): void {
    const [sx, sy] = this.fx.shakeOffset();
    g.img(this.arena.bg, 0, sx * 0, sy * 0, { layer: 'floor', ox: 0, oy: 0 });
    this.arena.drawFloor?.(g, this);
    for (const z of this.zones) z.draw(g);
    for (const h of this.hazards) h.draw(g);
    for (const o of this.objects) o.draw?.(g, this);
    for (const b of this.bodies) {
      const on = glyphVisible(this.glyphLeft(b));
      if (on) g.glyphs(true);
      b.draw(g, this);
      if (on) g.glyphs(false);
    }
    if (this.boss) {
      let left = this.glyphLeft(null);
      for (const p of this.boss.parts) left = Math.max(left, p.glyphUntil - this.time);
      const on = glyphVisible(left);
      if (on) g.glyphs(true);
      this.boss.draw(g, this);
      if (on) g.glyphs(false);
    }
    this.player.draw(g, this);
    for (const b of this.bullets) b.draw(g, this);
    for (const c of this.cables) g.line(c.x1, c.y1, c.x2, c.y2, 1, P.fog, 1, 'top');
    this.arena.drawTop?.(g, this);
    for (const o of this.objects) o.drawTop?.(g, this);
    this.fx.draw(g);
  }
}

/** Glyph look is solid, then blinks during its last 0.6 s so the player sees the hack running out. */
function glyphVisible(left: number): boolean {
  return left > 0 && (left > 0.6 || Math.floor(left * 10) % 2 === 0);
}

function zonesTouch(a: Zone, b: Zone): boolean {
  if (a.shape.k === 'circle' && b.shape.k === 'circle') return dist(a.shape.x, a.shape.y, b.shape.x, b.shape.y) < a.shape.r + b.shape.r;
  return false;
}

export { Hazard };
