/**
 * The four weapons. Each one changes how you approach the arena, not just numbers:
 *   riveter  — nails stick in the boss, props and walls; recall rips them out and drags props.
 *   arc      — chained electricity through conductors; overload orb bursts and shorts devices.
 *   breacher — pellets push props and erase soft bullets; slug launches props and strips armour.
 *   blade    — slashes reflect every bullet; iaido cuts through a line and severs cables.
 */
import { audio } from '../engine/audio';
import { BLADE_TEXT, BREACHER_TEXT } from '../data/text';
import { COL, P, type Gfx } from '../engine/gfx';
import type { InputState } from '../engine/input';
import { angleDiff, angleTo, clamp, dist, norm, segmentsCross, segDist, pointInRect, type Rect } from '../engine/math';
import type { Body } from './body';
import { Bullet } from './bullet';
import { FirePatch, Hazard } from './hazard';
import type { ModId, WeaponId } from './loadout';
import type { Player } from './player';
import { shapeHits, type Cable } from './types';
import type { World } from './world';

export interface WeaponHud {
  ammo?: number;
  ammoMax?: number;
  /** 0..1 */
  charge?: number;
  /** 0..1 readiness of the special (1 = ready). */
  special?: number;
  text?: string;
}

export abstract class Weapon {
  abstract readonly id: WeaponId;
  kick = 0;
  constructor(readonly mods: ModId[]) {}
  has(m: ModId): boolean { return this.mods.includes(m); }
  abstract update(w: World, p: Player, inp: InputState, dt: number, canFire: boolean): void;
  abstract hud(): WeaponHud;
  onPerfectDodge?(w: World, p: Player): void;
  /** Called when the fight ends (stop loops). */
  dispose(): void {}
  /** Arc caster only: the bodies the current arc chains through, player side first (empty otherwise). */
  chainNodes(): readonly Body[] { return []; }
  /** Move deployments anchored to a translating floor; projectiles keep their flight path. */
  carryFloor(_area: Rect, _dx: number, _dy: number): void {}

  muzzle(p: Player, len: number): [number, number] {
    return [p.handX + Math.cos(p.aim) * len, p.handY + Math.sin(p.aim) * len];
  }

  draw(g: Gfx, _w: World, p: Player, depth: number): void {
    const a = p.aim;
    const k = this.kick;
    g.img('wpn', this.id, p.handX - Math.cos(a) * k, p.handY - Math.sin(a) * k, { ox: 0.2, oy: 0.5, rot: a, flipY: Math.cos(a) < 0, depth });
  }

  protected decayKick(dt: number): void { this.kick = Math.max(0, this.kick - dt * 40); }
}

// =====================================================================================
// RIVETER
// =====================================================================================
interface Stuck { body: Body | null; x: number; y: number; ang: number; enemy: boolean }

class NailBullet extends Bullet {
  constructor(x: number, y: number, vx: number, vy: number, private gun: Riveter, p: Player) {
    super(x, y, vx, vy, 'player');
    this.r = 2;
    this.dmg = 3 * p.dmgMul;
    this.poise = 0.35;
    this.frame = 'nail';
    this.rotates = true;
    this.life = 0.8;
    this.src = 'nail';
    this.homing = p.homing;
  }
  private get ang(): number { return Math.atan2(this.vy, this.vx); }
  onHitBody(w: World, b: Body): void {
    const sp = this.speed || 1;
    const enemy = b.team === 'enemy';
    w.damage(b, { dmg: enemy ? this.dmg : 1, kind: 'bullet', x: this.x, y: this.y, dx: this.vx / sp, dy: this.vy / sp, poise: this.poise, from: 'player', src: 'nail' });
    w.sfx('nailHit');
    if (!b.dead) this.gun.stick(b, this.x, this.y, this.ang, enemy);
    else this.gun.drop(this.x, this.y, this.ang);
    this.dead = true;
  }
  onWall(w: World): void {
    const [nx, ny] = norm(this.vx, this.vy);
    this.gun.wallNail(this.x - nx * 3, this.y - ny * 3, this.ang);
    this.dead = true;
    w.fx.sparks(this.x, this.y, 2, P.fog, 50);
  }
  onExpire(): void { this.gun.drop(this.x, this.y, this.ang); }
}

class ReturnNail extends Bullet {
  constructor(x: number, y: number, private gun: Riveter, private p: Player) {
    super(x, y, 0, 0, 'player');
    this.r = 2;
    this.frame = 'nail';
    this.rotates = true;
    this.life = 2.5;
    this.src = 'recall';
    this.pierce = Infinity;
    this.dmg = 5 * p.dmgMul;
    this.glow = 4;
    this.glowColor = P.cyan;
  }
  update(w: World, dt: number): void {
    this.age += dt;
    const t = this.gun.magnet ?? { x: this.p.handX, y: this.p.handY };
    const [nx, ny] = norm(t.x - this.x, t.y - this.y);
    const sp = Math.min(760, 260 + this.age * 1600);
    this.vx = nx * sp;
    this.vy = ny * sp;
    const steps = Math.max(1, Math.ceil((sp * dt) / 4));
    for (let i = 0; i < steps; i++) {
      this.x += (this.vx * dt) / steps;
      this.y += (this.vy * dt) / steps;
      for (const b of w.bodies) {
        if (b.dead || b.team !== 'enemy' || this.hitIds.has(b.id)) continue;
        if (dist(this.x, this.y, b.hx, b.hy) > b.hr + 3) continue;
        this.hitIds.add(b.id);
        w.damage(b, { dmg: this.dmg, kind: 'bullet', x: this.x, y: this.y, dx: nx, dy: ny, poise: 0.7, from: 'player', src: 'recall', srcId: this.id });
        w.sfx('nailHit', 0.7, 1.3);
      }
      if (dist(this.x, this.y, t.x, t.y) < 8) {
        this.dead = true;
        this.gun.returned(w);
        return;
      }
    }
    if (this.age > this.life) { this.dead = true; this.gun.returned(w); }
  }
}

class Riveter extends Weapon {
  readonly id = 'riveter' as const;
  readonly max = 20;
  ammo = 20;
  private fireCd = 0;
  private stuck: Stuck[] = [];
  private recallCd = 0;
  private inFlight = 0;
  magnet: { x: number; y: number } | null = null;
  private w: World | null = null;
  private p: Player | null = null;
  private emptyHint = 0;

  update(w: World, p: Player, inp: InputState, dt: number, canFire: boolean): void {
    this.w = w; this.p = p;
    this.decayKick(dt);
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.recallCd > 0) this.recallCd -= dt;
    if (this.emptyHint > 0) this.emptyHint -= dt;
    // forget nails whose host died
    for (const s of this.stuck) if (s.body && s.body.dead) { s.x = s.body.x; s.y = s.body.y; s.body = null; s.enemy = false; }
    if (this.has('riveter_barbed')) {
      const per = new Map<Body, number>();
      for (const s of this.stuck) if (s.body && s.enemy) per.set(s.body, (per.get(s.body) ?? 0) + 1);
      for (const [b, n] of per) w.damage(b, { dmg: 0.8 * n * dt * p.dmgMul, kind: 'bullet', x: b.hx, y: b.hy, from: 'player', src: 'barbed', quiet: true });
    }
    if (canFire && inp.fire && this.fireCd <= 0) {
      if (this.ammo > 0) this.fire(w, p);
      else if (inp.firePressed || this.emptyHint <= 0) {
        this.emptyHint = 0.6;
        w.sfx('click');
        w.fx.label(p.x, p.y - 20, '右键回收', P.fog, 0.6);
        this.fireCd = 0.15;
      }
    }
    if (inp.altPressed && this.recallCd <= 0 && (this.stuck.length || this.flyingNails(w).length)) this.recall(w, p, inp);
  }

  carryFloor(area: Rect, dx: number, dy: number): void {
    for (const s of this.stuck) if (!s.body && pointInRect(s.x, s.y, area)) { s.x += dx; s.y += dy; }
    if (this.magnet && pointInRect(this.magnet.x, this.magnet.y, area)) { this.magnet.x += dx; this.magnet.y += dy; }
  }

  private flyingNails(w: World): NailBullet[] {
    return w.bullets.filter((b): b is NailBullet => b instanceof NailBullet && !b.dead);
  }

  private fire(w: World, p: Player): void {
    this.ammo--;
    this.fireCd = 1 / (7.5 * p.fireRateMul);
    const a = p.aim + (w.rng.next() - 0.5) * 0.05;
    const [mx, my] = this.muzzle(p, 10);
    w.addBullet(new NailBullet(mx, my, Math.cos(a) * 450, Math.sin(a) * 450, this, p));
    this.kick = 2;
    w.fx.sparks(mx, my, 2, P.amber, 80, a, 0.5);
    w.sfx('nail', 0.8, 0.9 + w.rng.next() * 0.2);
  }

  stick(b: Body, x: number, y: number, ang: number, enemy: boolean): void {
    if (enemy && b.nails >= 16) { this.drop(x, y, ang); return; }
    b.nails++;
    this.stuck.push({ body: b, x: x - b.hx, y: y - b.hy, ang, enemy });
  }
  drop(x: number, y: number, ang: number): void { this.stuck.push({ body: null, x, y, ang, enemy: false }); }
  wallNail(x: number, y: number, ang: number): void { this.stuck.push({ body: null, x, y, ang, enemy: false }); }

  private pos(s: Stuck): [number, number] {
    return s.body ? [s.body.hx + s.x, s.body.hy + s.y] : [s.x, s.y];
  }

  private recall(w: World, p: Player, inp: InputState): void {
    this.recallCd = 0.35;
    this.magnet = this.has('riveter_magnet') ? { x: inp.ax, y: inp.ay } : null;
    let rips = 0;
    const tx = this.magnet?.x ?? p.x, ty = this.magnet?.y ?? p.y;
    const drag = new Map<Body, number>();
    const blasts = new Map<Body, { x: number; y: number; n: number }>();
    if (this.has('riveter_blast')) {
      for (const s of this.stuck) {
        const b = s.body;
        if (!b || b.dead) continue;
        const batch = blasts.get(b);
        if (batch) batch.n++;
        else blasts.set(b, { x: b.x, y: b.y - b.hz * 0.5, n: 1 });
      }
    }
    for (const n of this.flyingNails(w)) { n.dead = true; this.spawnReturn(w, p, n.x, n.y); }
    for (const s of this.stuck) {
      const [x, y] = this.pos(s);
      const b = s.body;
      if (b && !b.dead) {
        b.nails = Math.max(0, b.nails - 1);
        if (s.enemy) {
          const [nx, ny] = norm(tx - x, ty - y);
          w.damage(b, { dmg: 8 * p.dmgMul, kind: 'melee', x, y, dx: -nx, dy: -ny, poise: 1.6, from: 'player', src: 'rip' });
          w.fx.burst(x, y, 2, P.red, 60, 0.25, 1);
          rips++;
        } else if (b.mass > 0) drag.set(b, (drag.get(b) ?? 0) + 1);
      }
      this.spawnReturn(w, p, x, y);
    }
    for (const [b, n] of drag) {
      const [nx, ny] = norm(tx - b.x, ty - b.y);
      const sp = Math.min(460, 90 * n + 120);
      b.vx = nx * sp; b.vy = ny * sp;
    }
    this.stuck = [];
    for (const { x, y, n } of blasts.values()) {
      if (n < 4) continue;
      w.explode(x, y, 40, { enemyDmg: 6 * n * p.dmgMul, poise: Math.min(12, n * 1.2), from: 'player', src: 'nail_blast', knock: 180 });
    }
    w.sfx('recall');
    if (rips) {
      w.sfx('rip', Math.min(1.5, 0.6 + rips * 0.08));
      w.fx.shake(Math.min(5, 1 + rips * 0.3), 0.15);
      if (rips >= 8) w.hitstop = Math.max(w.hitstop, 0.05);
    }
  }

  private spawnReturn(w: World, p: Player, x: number, y: number): void {
    this.inFlight++;
    w.addBullet(new ReturnNail(x, y, this, p));
  }

  returned(w: World): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.ammo = Math.min(this.max, this.ammo + 1);
    if (this.inFlight === 0) this.magnet = null;
    w.sfx('click', 0.3);
  }

  hud(): WeaponHud {
    const inBoss = this.stuck.filter((s) => s.enemy).length;
    return { ammo: this.ammo, ammoMax: this.max, special: this.stuck.length || this.inFlight ? 1 : 0.3, text: inBoss ? `钉入 ${inBoss}` : '' };
  }

  draw(g: Gfx, w: World, p: Player, depth: number): void {
    super.draw(g, w, p, depth);
    if (this.w !== w) return;
    for (const s of this.stuck) {
      const [x, y] = this.pos(s);
      if (s.body) g.img('proj', 'nail_stuck', x, y, { layer: 'top', ox: 0.7, oy: 0.5, rot: s.ang, tint: this.has('riveter_blast') && s.body.nails >= 4 ? P.orange : undefined });
      else g.img('proj', 'nail_stuck', x, y, { layer: 'floor', ox: 0.7, oy: 0.5, rot: s.ang });
    }
    if (this.magnet) g.ring(this.magnet.x, this.magnet.y, 5 + Math.sin(w.realTime * 20), 1, P.cyan, 0.8, 'top');
    void this.p;
  }
}

// =====================================================================================
// ARC CASTER
// =====================================================================================
/** A fixed residual field: six pulses, without charging the weapon or repeating EMP. */
class ArcAftershock {
  dead = false;
  private age = 0;
  private nextPulse = 0.5;
  private flash = 0;
  readonly r = 56;

  constructor(readonly x: number, readonly y: number, private readonly dmgMul: number) {}

  update(w: World, dt: number): void {
    if (w.state !== 'fight') { this.dead = true; return; }
    this.age = Math.min(3, this.age + dt);
    this.flash = Math.max(0, this.flash - dt);
    while (this.nextPulse <= this.age + 1e-8 && this.nextPulse <= 3) {
      this.nextPulse += 0.5;
      this.pulse(w);
    }
    if (this.age >= 3 - 1e-8) this.dead = true;
  }

  private pulse(w: World): void {
    this.flash = 0.18;
    for (const b of w.bodies) {
      if (b.dead || dist(this.x, this.y, b.hx, b.hy) > this.r + b.hr) continue;
      if (b.team === 'enemy') {
        w.damage(b, { dmg: 8 * this.dmgMul, kind: 'shock', x: b.hx, y: b.hy, poise: 1.5, from: 'player', src: 'aftershock' });
      }
      b.onShock?.(w, 16, 0.5);
    }
    w.clearBullets(this.x, this.y, this.r, true);
    w.fx.ring(this.x, this.y, 8, this.r, P.ice, 0.22, 2);
    w.fx.glow(this.x, this.y, this.r, P.cyan, 0.12);
    w.sfx('zap', 0.3, 0.85);
  }

  draw(g: Gfx): void {
    const fade = Math.min(1, (3 - this.age) * 2);
    g.circle(this.x, this.y, this.r, P.teal, 0.12 * fade, 'floor');
    g.ring(this.x, this.y, this.r, 1, P.cyan, 0.45 * fade, 'floor');
    g.ring(this.x, this.y, this.r * 0.6, 1, P.teal, 0.3 * fade, 'floor');
  }

  drawTop(g: Gfx): void {
    const fade = Math.min(1, (3 - this.age) * 2);
    if (this.flash <= 0) return;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + this.age * 0.8;
      const x = this.x + Math.cos(a) * this.r, y = this.y + Math.sin(a) * this.r;
      const mx = this.x + Math.cos(a + 0.25) * this.r * 0.5;
      const my = this.y + Math.sin(a + 0.25) * this.r * 0.5;
      const alpha = this.flash / 0.18 * fade;
      g.line(this.x, this.y, mx, my, 1, P.ice, alpha, 'top');
      g.line(mx, my, x, y, 1, P.cyan, alpha, 'top');
    }
  }
}

class ArcOrb extends Bullet {
  private stopped = false;
  private fuse = 0.7;
  private stuckTo: Body | null = null;
  private ox = 0;
  private oy = 0;
  private armed = 0;
  private mineLife = 8;
  constructor(x: number, y: number, private tx: number, private ty: number, private power: number, private mine: boolean, private p: Player, private aftershock: boolean) {
    super(x, y, 0, 0, 'player');
    const [nx, ny] = norm(tx - x, ty - y);
    this.vx = nx * 360; this.vy = ny * 360;
    this.r = 4;
    this.frame = 'arcball';
    this.glow = 10;
    this.glowColor = P.cyan;
    this.life = 20;
    this.pierce = Infinity;
  }
  update(w: World, dt: number): void {
    this.age += dt;
    if (!this.stopped) {
      const d = dist(this.x, this.y, this.tx, this.ty);
      const step = 360 * dt;
      if (d <= step || w.pointInWall(this.x + this.vx * dt, this.y + this.vy * dt)) { this.stop(); }
      else {
        this.x += this.vx * dt; this.y += this.vy * dt;
        for (const b of w.bodies) {
          if (b.dead || b.team !== 'enemy') continue;
          if (dist(this.x, this.y, b.hx, b.hy) < b.hr + this.r) { this.stuckTo = b; this.ox = this.x - b.hx; this.oy = this.y - b.hy; this.stop(); break; }
        }
      }
      return;
    }
    if (this.stuckTo) {
      if (this.stuckTo.dead) this.stuckTo = null;
      else { this.x = this.stuckTo.hx + this.ox; this.y = this.stuckTo.hy + this.oy; }
    }
    if (this.mine) {
      this.armed += dt;
      this.mineLife -= dt;
      const near = this.armed > 0.3 && w.bodies.some((b) => !b.dead && b.team === 'enemy' && dist(this.x, this.y, b.x, b.y) < b.r + 34);
      if (near || this.mineLife <= 0 || this.stuckTo) this.fuse -= this.stuckTo ? dt : 99;
      if (this.fuse <= 0) this.burst(w);
    } else {
      this.fuse -= dt;
      if (this.fuse <= 0) this.burst(w);
    }
  }
  private stop(): void { this.stopped = true; this.vx = this.vy = 0; }
  private burst(w: World): void {
    this.dead = true;
    const R = 56, c = this.power;
    const mul = this.mine ? 1.5 : 1;
    for (const b of w.bodies) {
      if (b.dead || dist(this.x, this.y, b.hx, b.hy) > R + b.hr) continue;
      if (b.team === 'enemy') {
        const [nx, ny] = norm(b.hx - this.x, b.hy - this.y);
        w.damage(b, { dmg: (40 + 1.6 * c) * mul * this.p.dmgMul, kind: 'shock', x: b.hx, y: b.hy, dx: nx, dy: ny, poise: 10 + 0.45 * c, from: 'player', src: 'overload', ignite: true });
      }
      b.onEmp?.(w);
    }
    if (this.aftershock) w.objects.push(new ArcAftershock(this.x, this.y, this.p.dmgMul));
    w.clearBullets(this.x, this.y, R, true);
    w.fx.ring(this.x, this.y, 6, R, P.ice, 0.3, 3);
    w.fx.glow(this.x, this.y, R, P.cyan, 0.3);
    w.fx.sparks(this.x, this.y, 24, P.ice, 220);
    w.fx.shake(4, 0.2);
    w.hitstop = Math.max(w.hitstop, 0.04);
    w.sfx('overload');
  }
  draw(g: Gfx, w: World): void {
    const pulse = this.stopped ? 0.5 + 0.5 * Math.sin(w.realTime * (this.mine ? 8 : 40)) : 1;
    g.circle(this.x, this.y, 8 + 4 * pulse, P.cyan, 0.3, 'light');
    g.img('proj', 'arcball', this.x, this.y, { layer: 'top', ox: 0.5, oy: 0.5 });
    if (this.mine && this.stopped) g.ring(this.x, this.y, 34, 1, P.cyan, 0.25 + 0.2 * pulse, 'floor');
  }
}

class ArcCaster extends Weapon {
  readonly id = 'arc' as const;
  charge = 0;
  private links: number[][] = [];
  private firing = false;
  private nodes: Body[] = [];

  chainNodes(): readonly Body[] { return this.nodes; }

  update(w: World, p: Player, inp: InputState, dt: number, canFire: boolean): void {
    this.firing = canFire && inp.fire;
    audio.loop('arc', this.firing);
    this.links = [];
    this.nodes = [];
    if (this.firing) this.beam(w, p, dt);
    if (inp.altPressed && canFire) {
      if (this.charge >= 25) {
        const [mx, my] = this.muzzle(p, 8);
        const d = Math.min(175, dist(mx, my, inp.ax, inp.ay));
        const tx = mx + Math.cos(p.aim) * d, ty = my + Math.sin(p.aim) * d;
        w.addBullet(new ArcOrb(mx, my, tx, ty, this.charge, this.has('arc_mine'), p, this.has('arc_aftershock')));
        this.charge = 0;
        w.sfx('charge');
      } else {
        w.fx.label(p.x, p.y - 20, '电量不足', P.fog, 0.5);
        w.sfx('click');
      }
    }
  }

  private isNode(b: Body): boolean {
    return !b.dead && ((b.team === 'enemy' && b.targetable) || (b.team === 'neutral' && b.conductive));
  }

  private beam(w: World, p: Player, dt: number): void {
    p.slow = Math.min(p.slow, 0.75);
    const [ox, oy] = this.muzzle(p, 11);
    const range = 130 * p.rangeMul, cone = 0.6;
    let first: Body | null = null, best = Infinity;
    for (const b of w.bodies) {
      if (!this.isNode(b)) continue;
      const d = dist(ox, oy, b.hx, b.hy) - b.hr;
      if (d > range) continue;
      const da = Math.abs(angleDiff(p.aim, angleTo(ox, oy, b.hx, b.hy)));
      if (da > cone && d > b.hr) continue;
      const [nx, ny] = norm(b.hx - ox, b.hy - oy);
      if (w.rayWall(ox, oy, nx, ny, d + 1) < d) continue;
      const score = d * (1 + da * 2.5) - (b.team === 'enemy' ? 10 : 0);
      if (score < best) { best = score; first = b; }
    }
    if (!first) {
      const len = Math.min(60, w.rayWall(ox, oy, Math.cos(p.aim), Math.sin(p.aim), 60));
      this.links.push([ox, oy, ox + Math.cos(p.aim) * len, oy + Math.sin(p.aim) * len, 0]);
      return;
    }
    const web = this.has('arc_web');
    const chain = [first];
    const seen = new Set([first.id]);
    for (let j = 0; j < (web ? 6 : 3); j++) {
      const from = chain[chain.length - 1];
      let nb: Body | null = null, nd = Infinity;
      for (const b of w.bodies) {
        if (seen.has(b.id) || !this.isNode(b)) continue;
        const jr = web && (from.conductive || b.conductive) ? 130 : 80;
        const d = dist(from.hx, from.hy, b.hx, b.hy) - b.hr - from.hr;
        if (d < jr && d < nd) { nd = d; nb = b; }
      }
      if (!nb) break;
      seen.add(nb.id);
      chain.push(nb);
    }
    this.nodes = chain;
    let hitEnemy = false;
    let px = ox, py = oy;
    for (const b of chain) {
      this.links.push([px, py, b.hx, b.hy, b.team === 'enemy' ? 1 : 0]);
      px = b.hx; py = b.hy;
      if (b.team === 'enemy') {
        w.damage(b, { dmg: 30 * p.dmgMul * p.fireRateMul * dt, kind: 'shock', x: b.hx, y: b.hy, poise: 2.4 * dt, from: 'player', src: 'arc' });
        hitEnemy = true;
      }
      b.onShock?.(w, 30, dt);
      if (w.rng.chance(dt * 20)) w.fx.sparks(b.hx, b.hy, 2, P.ice, 90);
    }
    if (hitEnemy) this.charge = Math.min(100, this.charge + 24 * dt);
  }

  hud(): WeaponHud { return { charge: this.charge / 100, text: this.charge >= 25 ? '' : '' }; }
  dispose(): void { audio.loop('arc', false); }

  draw(g: Gfx, w: World, p: Player, depth: number): void {
    super.draw(g, w, p, depth);
    for (const [x1, y1, x2, y2, hit] of this.links) {
      const n = Math.max(3, Math.floor(dist(x1, y1, x2, y2) / 9));
      let lx = x1, ly = y1;
      const [nx, ny] = norm(-(y2 - y1), x2 - x1);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const j = i < n ? w.vrng.range(-4, 4) : 0;
        const x = x1 + (x2 - x1) * t + nx * j, y = y1 + (y2 - y1) * t + ny * j;
        g.line(lx, ly, x, y, 3, P.cyan, 0.35, 'top');
        g.line(lx, ly, x, y, 1, P.white, 1, 'top');
        lx = x; ly = y;
      }
      g.circle(x2, y2, hit ? 7 : 4, P.cyan, 0.35, 'light');
    }
    if (this.charge >= 25) g.circle(p.handX, p.handY, 3 + this.charge / 25, P.cyan, 0.3, 'light');
    void this.nodes;
  }
}

// =====================================================================================
// BREACHER
// =====================================================================================
// Nearby impacts refresh one patch instead of stacking a full pellet volley of fire damage.
class DragonFirePatch extends FirePatch {}

class Pellet extends Bullet {
  private sx: number;
  private sy: number;
  constructor(x: number, y: number, vx: number, vy: number, p: Player, dragon: boolean, private readonly rangeScale = 1) {
    super(x, y, vx, vy, 'player');
    this.sx = x; this.sy = y;
    this.r = 2;
    this.dmg = 6 * p.dmgMul * (dragon ? 0.8 : 1);
    this.poise = 0.7;
    this.frame = dragon ? 'pellet_fire' : 'pellet';
    this.life = 0.27 * rangeScale;
    this.src = 'pellet';
    this.cancelsSoft = true;
    this.softPierce = 1; // each pellet breaks two soft bullets
    this.knock = 48;
    this.ignite = dragon;
    this.homing = p.homing;
  }
  onHitBody(w: World, b: Body): void {
    const travelled = dist(this.sx, this.sy, this.x, this.y) / this.rangeScale;
    const fall = 1 - clamp((travelled - 45) / 110, 0, 0.7);
    const sp = this.speed || 1;
    const enemy = b.team === 'enemy';
    w.damage(b, {
      dmg: enemy ? this.dmg * fall : 1, kind: 'bullet', x: this.x, y: this.y, dx: this.vx / sp, dy: this.vy / sp,
      poise: this.poise, from: 'player', src: 'pellet', knock: this.knock, ignite: this.ignite,
    });
    this.igniteGround(w, this.x, b.y);
    this.dead = true;
  }
  onWall(w: World): void {
    super.onWall(w);
    this.igniteGround(w);
  }
  onExpire(w: World): void { this.igniteGround(w); }

  private igniteGround(w: World, x = this.x, y = this.y + 6): void {
    if (!this.ignite) return;
    [x, y] = w.clampToBounds(x, y, 9);
    for (const o of w.objects) {
      if (o instanceof DragonFirePatch && !o.dead && dist(x, y, o.x, o.y) < 18) {
        o.t = 0;
        return;
      }
    }
    w.objects.push(new DragonFirePatch(x, y, 9, 2.5, 'player'));
  }
}

class Slug extends Bullet {
  constructor(x: number, y: number, vx: number, vy: number, p: Player, shells: number, private readonly explosive: boolean, rangeScale: number) {
    super(x, y, vx, vy, 'player');
    this.r = 4;
    this.dmg = 40 * shells * p.dmgMul * (explosive ? 1.6 : 1);
    this.poise = 15 * shells;
    this.armorBreak = 1;
    this.frame = 'slug';
    this.rotates = true;
    this.life = 0.6 * rangeScale;
    this.pierce = Infinity;
    this.src = 'slug';
    this.cancelsSoft = true;
    this.knock = 560;
    this.glow = 6;
    this.glowColor = P.amber;
  }
  onHitBody(w: World, b: Body): void {
    const sp = this.speed || 1;
    const enemy = b.team === 'enemy';
    w.damage(b, { dmg: enemy ? this.dmg : 2, kind: 'impact', x: this.x, y: this.y, dx: this.vx / sp, dy: this.vy / sp, poise: this.poise, armorBreak: this.armorBreak, from: 'player', src: 'slug', knock: this.knock, srcId: this.id });
    w.fx.sparks(this.x, this.y, 8, P.amber, 160, Math.atan2(this.vy, this.vx), 1);
    if (this.explosive) w.fx.explosion(this.x, this.y, 14);
    if (enemy) w.hitstop = Math.max(w.hitstop, 0.05);
  }
  onWall(w: World): void {
    // Penetrate interior walls and cover; stop only at the arena boundary.
    const b = w.bounds;
    if (this.x >= b.x && this.x <= b.x + b.w && this.y >= b.y && this.y <= b.y + b.h) return;
    this.dead = true;
    w.fx.sparks(this.x, this.y, 10, P.amber, 140);
    w.fx.shake(2, 0.1);
  }
  // keeps going through shot-blocking bodies too
  protected collide(w: World): void {
    for (const b of w.bodies) {
      if (b.dead || this.hitIds.has(b.id) || b.team === 'player') continue;
      if (b.team === 'neutral' && !b.blocksShots && !b.flammable && b.mass <= 0) continue;
      if (dist(this.x, this.y, b.hx, b.hy) > this.r + b.hr) continue;
      this.hitIds.add(b.id);
      this.onHitBody(w, b);
    }
  }
}

class Breacher extends Weapon {
  readonly id = 'breacher' as const;
  shells = 2;
  private reloadT = 0;
  private fireCd = 0;
  private idleT = 0;

  update(w: World, p: Player, inp: InputState, dt: number, canFire: boolean): void {
    this.decayKick(dt);
    if (this.fireCd > 0) this.fireCd -= dt;
    this.idleT += dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.shells = 2; w.sfx('reload'); }
    } else if (this.shells === 0 || (this.shells < 2 && this.idleT > 0.7)) {
      this.reloadT = this.shells === 0 ? 0.85 : 0.6;
    }
    if (!canFire) return;
    if (inp.fire && this.fireCd <= 0 && this.shells > 0 && this.reloadT <= 0) this.blast(w, p);
    else if (inp.fire && this.fireCd <= 0 && this.shells > 0 && this.reloadT > 0 && this.shells === 1) { this.reloadT = 0; this.blast(w, p); }
    if (inp.altPressed && this.shells > 0 && this.fireCd <= 0) this.slug(w, p);
  }

  private blast(w: World, p: Player): void {
    const dragon = this.has('breacher_dragon');
    const rampage = this.has('breacher_overload');
    const pellets = rampage ? 15 : 8;
    const rangeScale = rampage ? 1.2 : 1;
    this.shells--;
    this.fireCd = 0.3 / p.fireRateMul;
    this.idleT = 0;
    const [mx, my] = this.muzzle(p, 13);
    for (let i = 0; i < pellets; i++) {
      const a = p.aim + (w.rng.next() - 0.5) * 0.46;
      const sp = 470 + w.rng.next() * 110;
      w.addBullet(new Pellet(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, p, dragon, rangeScale));
    }
    this.kick = 4;
    w.fx.glow(mx, my, 14, P.amber, 0.08);
    w.fx.burst(mx, my, 6, P.sodium, 140, 0.15, 2, p.aim, 0.6);
    w.fx.smoke(mx, my, 3, P.steel, 3, 10);
    w.fx.debris(p.x, p.y - 10, 1, [P.red]);
    w.fx.shake(2, 0.08);
    w.sfx('shotgun');
    p.vx -= Math.cos(p.aim) * 60; p.vy -= Math.sin(p.aim) * 60;
  }

  private slug(w: World, p: Player): void {
    const n = this.shells;
    const recoil = this.has('breacher_recoil');
    const rangeScale = this.has('breacher_overload') ? 1.2 : 1;
    this.shells = 0;
    this.reloadT = 0;
    this.fireCd = 0.35;
    this.idleT = 0;
    const [mx, my] = this.muzzle(p, 13);
    w.addBullet(new Slug(mx, my, Math.cos(p.aim) * 640, Math.sin(p.aim) * 640, p, n, recoil, rangeScale));
    this.kick = 6;
    w.fx.glow(mx, my, 20, P.amber, 0.1);
    w.fx.burst(mx, my, 10, P.amber, 200, 0.2, 2, p.aim, 0.4);
    w.fx.shake(4, 0.12);
    w.sfx('slug');
    const duration = recoil ? 0.2 : 0.1;
    const speed = (recoil ? 80 : 20) / duration;
    p.vx = 0; p.vy = 0;
    p.forced = { vx: -Math.cos(p.aim) * speed, vy: -Math.sin(p.aim) * speed, t: duration, iframes: recoil, solids: true };
    if (recoil) p.beginDodge(w, duration);
  }

  hud(): WeaponHud {
    return { ammo: this.shells, ammoMax: 2, special: this.shells > 0 ? 1 : 0, text: this.reloadT > 0 ? BREACHER_TEXT.reloading : this.has('breacher_overload') ? BREACHER_TEXT.rampage : '' };
  }
}

// =====================================================================================
// MONOBLADE
// =====================================================================================
function cutCables(w: World, test: (c: Cable) => boolean): number {
  let n = 0;
  for (const c of w.cables) {
    if (c.dead || !test(c)) continue;
    c.dead = true;
    c.onCut();
    n++;
    w.fx.sparks((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2, 12, P.white, 160);
    w.sfx('cut');
  }
  return n;
}

class Monoblade extends Weapon {
  readonly id = 'blade' as const;
  private combo = 0;
  private swingT = -1;
  private swingDur = 0.22;
  private swingA = 0;
  private hitSet = new Set<number>();
  private lastEnd = -9;
  private buffer = 0;
  iaidoCd = 0;
  /** Match the current dodge to the iaido that started it, excluding legs/grapple dodges. */
  private iaidoDodgeStart = -Infinity;
  private iaidoCanReturn = false;
  private returnReady = false;
  private altBuffer = 0;
  private instantUntil = -Infinity;
  private realClock = 0;
  private get instantIaido(): boolean { return this.realClock < this.instantUntil; }
  private charging = false;
  private chargeT = 0;
  private iaidoFx: { x1: number; y1: number; x2: number; y2: number; t: number; lightReturn: boolean } | null = null;
  private clock = 0;

  update(w: World, p: Player, inp: InputState, dt: number, canFire: boolean): void {
    this.clock += dt;
    this.realClock = w.realTime;
    if (this.iaidoCd > 0) this.iaidoCd = Math.max(0, this.iaidoCd - dt);
    // The second cut belongs to this cooldown cycle, not a permanent banked attack.
    if (this.iaidoCd <= 0 && !this.instantIaido) this.returnReady = false;
    this.altBuffer = Math.max(0, this.altBuffer - dt);
    if (inp.altPressed && (this.returnReady || this.instantIaido)) this.altBuffer = 0.2;
    if (this.iaidoFx) { this.iaidoFx.t -= dt; if (this.iaidoFx.t <= 0) this.iaidoFx = null; }
    if (inp.firePressed) this.buffer = 0.2;
    if (this.buffer > 0) this.buffer -= dt;

    if (this.swingT >= 0) {
      this.swingT += dt;
      if (this.swingT >= 0.03 && this.swingT <= 0.15) this.swingHits(w, p);
      if (this.swingT >= this.swingDur) { this.swingT = -1; this.lastEnd = this.clock; }
    }
    if (this.buffer > 0 && canFire && !this.charging && (this.swingT < 0 || this.swingT > this.swingDur * 0.8)) this.startSwing(w, p);

    // iaido
    if (canFire && !this.charging) {
      if ((inp.altPressed || this.altBuffer > 0) && (this.returnReady || this.instantIaido)) {
        const lightReturn = this.returnReady;
        this.altBuffer = 0;
        this.iaido(w, p, lightReturn);
      } else if (inp.altPressed && this.iaidoCd <= 0) {
        this.charging = true;
        this.chargeT = 0;
      }
    }
    if (this.charging) {
      this.chargeT += dt;
      p.slow = Math.min(p.slow, 0.35);
      if (Math.floor(this.chargeT * 30) % 4 === 0 && this.chargeT > 0.22) w.fx.sparks(p.handX, p.handY, 1, P.white, 30);
      if (!inp.alt || !canFire) {
        this.charging = false;
        if (this.chargeT >= 0.22 && canFire) this.iaido(w, p);
      }
    }
  }

  private startSwing(w: World, p: Player): void {
    this.combo = this.clock - this.lastEnd < 0.45 && this.combo < 2 && this.swingT < 0 ? this.combo + 1 : this.swingT >= 0 && this.combo < 2 ? this.combo + 1 : 0;
    this.swingT = 0;
    this.swingDur = (this.combo === 2 ? 0.3 : 0.22) / p.fireRateMul;
    this.swingA = p.aim;
    this.hitSet.clear();
    this.buffer = 0;
    w.sfx('slash', 1, this.combo === 2 ? 0.8 : 1 + this.combo * 0.1);
    if (this.combo === 2) p.forced = { vx: Math.cos(p.aim) * 260, vy: Math.sin(p.aim) * 260, t: 0.09, iframes: false, solids: true };
  }

  private swingHits(w: World, p: Player): void {
    const R = 36 * p.rangeMul, cx = p.x, cy = p.y - 8;
    const sec = { k: 'sector' as const, x: cx, y: cy, r: R, a: this.swingA, span: 2.4 };
    const ret = this.has('blade_return');
    let deflected = 0;
    for (const e of w.bullets) {
      if (e.dead || e.team !== 'enemy' || !e.deflectable || !shapeHits(sec, e.x, e.y, e.r + 3)) continue;
      const sp = Math.max(280, e.speed * 1.35);
      const a = p.aim + (w.rng.next() - 0.5) * 0.15;
      e.team = 'player'; e.deflected = true; e.dmg = 10 * p.dmgMul * (ret ? 2 : 1); e.poise = 3;
      e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.age = 0; e.life = 1.6; e.hitIds.clear();
      e.accel = 0; e.homing = ret ? 7 : p.homing; e.frame = 'deflect'; e.glow = 5; e.glowColor = P.cyan; e.src = 'deflect'; e.low = false;
      deflected++;
    }
    if (deflected) {
      w.sfx('deflect');
      w.hitstop = Math.max(w.hitstop, 0.03);
      w.fx.sparks(cx + Math.cos(this.swingA) * 18, cy + Math.sin(this.swingA) * 18, 6, P.ice, 150);
    }
    const dmg = [12, 12, 22][this.combo] * p.dmgMul;
    for (const b of w.bodies) {
      if (b.dead || this.hitSet.has(b.id) || !shapeHits(sec, b.hx, b.hy, b.hr)) continue;
      this.hitSet.add(b.id);
      const [nx, ny] = norm(b.hx - cx, b.hy - cy);
      if (b.team === 'enemy') {
        w.damage(b, { dmg, kind: 'melee', x: b.hx - nx * b.hr * 0.6, y: b.hy - ny * b.hr * 0.6, dx: nx, dy: ny, poise: [3, 3, 9][this.combo], from: 'player', src: 'blade' });
        w.hitstop = Math.max(w.hitstop, this.combo === 2 ? 0.06 : 0.035);
        w.fx.sparks(b.hx - nx * b.hr, b.hy - ny * b.hr, 5, P.white, 120);
      } else {
        w.damage(b, { dmg: 2, kind: 'melee', x: b.hx, y: b.hy, dx: nx, dy: ny, from: 'player', src: 'blade', knock: 240 });
      }
    }
    cutCables(w, (c) => {
      for (let t = 0; t <= 1; t += 0.08) if (shapeHits(sec, c.x1 + (c.x2 - c.x1) * t, c.y1 + (c.y2 - c.y1) * t, 1)) return true;
      return false;
    });
  }

  private iaido(w: World, p: Player, lightReturn = false): void {
    const a = p.aim, dx = Math.cos(a), dy = Math.sin(a);
    const len = Math.max(0, Math.min(120, w.rayWall(p.x, p.y, dx, dy, 140) - 8));
    const x1 = p.x, y1 = p.y - 8, x2 = p.x + dx * len, y2 = p.y - 8 + dy * len;
    p.forced = { vx: dx * len / 0.08, vy: dy * len / 0.08, t: 0.08, iframes: true, solids: false };
    p.beginDodge(w, 0.2);
    this.iaidoDodgeStart = p.dashStart;
    this.iaidoCanReturn = !lightReturn;
    this.returnReady = false;
    this.iaidoCd = this.instantIaido ? 0 : 3;
    this.iaidoFx = { x1, y1, x2, y2, t: 0.25, lightReturn };
    const dmg = lightReturn ? 105 : 70;
    const hits = this.lineDamage(w, p, x1, y1, x2, y2, dmg, 32);
    cutCables(w, (c) => segmentsCross(x1, y1, x2, y2, c.x1, c.y1, c.x2, c.y2));
    w.sfx('iaido', 1, lightReturn ? 1.2 : 1);
    w.fx.shake(hits ? (lightReturn ? 6 : 5) : 2, 0.15);
    if (hits) { w.hitstop = Math.max(w.hitstop, 0.08); w.slowmo(0.5, 0.12); }
    if (this.has('blade_afterimage')) {
      const h = new Hazard({ k: 'line', x1, y1, x2, y2, w: 14 }, 0.5, 0.05);
      h.team = 'player';
      h.hitsPlayer = false;
      h.color = P.cyan;
      h.onActivate = (ww) => {
        this.lineDamage(ww, p, x1, y1, x2, y2, dmg * 0.7, 18);
        ww.fx.sparks((x1 + x2) / 2, (y1 + y2) / 2, 16, P.ice, 180);
        ww.sfx('slash', 1, 0.7);
      };
      w.addHazard(h);
    }
  }

  private lineDamage(w: World, p: Player, x1: number, y1: number, x2: number, y2: number, dmg: number, poise: number): number {
    let n = 0;
    const [dx, dy] = norm(x2 - x1, y2 - y1);
    for (const b of w.bodies) {
      if (b.dead || segDist(b.hx, b.hy, x1, y1, x2, y2) > b.hr + 8) continue;
      if (b.team === 'enemy') {
        w.damage(b, { dmg: dmg * p.dmgMul, kind: 'melee', x: b.hx, y: b.hy, dx, dy, poise, from: 'player', src: 'iaido' });
        w.fx.sparks(b.hx, b.hy, 10, P.white, 200);
        n++;
      } else if (b.flammable) {
        w.damage(b, { dmg: 0, kind: 'melee', x: b.hx, y: b.hy, from: 'player', src: 'iaido', ignite: true });
      }
    }
    return n;
  }

  onPerfectDodge(w: World, p: Player): void {
    this.realClock = w.realTime;
    const duringIaido = p.dashStart === this.iaidoDodgeStart;
    if (duringIaido && this.iaidoCanReturn) this.returnReady = true;
    // Flow starts with an iaido dodge; any perfect dodge within Flow refreshes it.
    if (this.has('blade_flow') && (duringIaido || this.instantIaido)) {
      this.instantUntil = w.realTime + 1;
      this.iaidoCd = 0;
    }
  }

  dispose(): void {
    this.charging = false;
    this.returnReady = false;
    this.iaidoCanReturn = false;
    this.altBuffer = 0;
    this.instantUntil = -Infinity;
  }

  hud(): WeaponHud {
    return {
      special: this.returnReady || this.instantIaido ? 1 : Math.max(0, 1 - this.iaidoCd / 3),
      text: this.returnReady ? BLADE_TEXT.lightReturn : this.instantIaido ? `${BLADE_TEXT.flow} ${Math.ceil(this.instantUntil - this.realClock)}s` : '',
    };
  }

  draw(g: Gfx, w: World, p: Player, depth: number): void {
    let rot = p.aim;
    if (this.swingT >= 0) {
      const t = Math.min(1, this.swingT / 0.15);
      const side = this.combo % 2 === 0 ? 1 : -1;
      rot = this.swingA + side * (-1.2 + 2.4 * t);
      const a0 = this.swingA - 1.2, a1 = this.swingA + 1.2;
      const R = 36 * p.rangeMul;
      const alpha = 0.55 * (1 - Math.max(0, this.swingT - 0.12) / 0.15);
      if (alpha > 0) {
        g.sector(p.x, p.y - 8, R, a0, a1, P.white, alpha * 0.35, 'top', R - 8);
        g.sector(p.x, p.y - 8, R - 2, a0 + 0.2, a1 - 0.2, P.ice, alpha * 0.5, 'top', R - 5);
      }
    }
    if (this.charging && this.chargeT >= 0.22) g.circle(p.handX, p.handY, 6, P.white, 0.45, 'light');
    if (this.instantIaido) g.circle(p.handX, p.handY, 7, P.cyan, 0.4, 'light');
    if (this.returnReady) g.circle(p.handX, p.handY, 5, P.amber, 0.5, 'light');
    g.img('wpn', 'blade', p.handX, p.handY, { ox: 0.15, oy: 0.5, rot, flipY: Math.cos(rot) < 0, depth });
    const f = this.iaidoFx;
    if (f) {
      const a = f.t / 0.25;
      g.line(f.x1, f.y1, f.x2, f.y2, (f.lightReturn ? 7 : 5) * a, f.lightReturn ? P.amber : P.ice, 0.4 * a, 'top');
      g.line(f.x1, f.y1, f.x2, f.y2, 1, P.white, a, 'top');
    }
    void w;
  }
}

export function makeWeapon(id: WeaponId, mods: ModId[]): Weapon {
  switch (id) {
    case 'riveter': return new Riveter(mods);
    case 'arc': return new ArcCaster(mods);
    case 'breacher': return new Breacher(mods);
    case 'blade': return new Monoblade(mods);
  }
}

export { COL };
