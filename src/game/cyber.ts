/**
 * Cyberware. Each slot replaces exactly one verb:
 *   legs -> space (dash / leap / blink / slide)
 *   arm  -> Q (shove / grapple / hydraulic fist / jack)
 *   core -> passive survival rule
 *   head -> passive targeting / perception rule
 */
import { COL, P, type Gfx } from '../engine/gfx';
import type { InputState } from '../engine/input';
import { clamp, dist, norm } from '../engine/math';
import type { Body } from './body';
import type { CyberId } from './loadout';
import type { Player } from './player';
import { shapeHits } from './types';
import type { World } from './world';

function dashDir(p: Player, inp: InputState): [number, number] {
  if (inp.mx || inp.my) return norm(inp.mx, inp.my);
  return [Math.cos(p.aim), Math.sin(p.aim)];
}

/** Is a ground circle free of walls and solid bodies? */
function spotFree(w: World, x: number, y: number, r: number): boolean {
  for (const wl of w.walls) {
    const cx = clamp(x, wl.x, wl.x + wl.w), cy = clamp(y, wl.y, wl.y + wl.h);
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return false;
  }
  for (const b of w.bodies) if (b.solid && !b.dead && dist(x, y, b.x, b.y) < r + b.r) return false;
  return true;
}

// =====================================================================================
// LEGS
// =====================================================================================
export abstract class Legs {
  abstract readonly id: CyberId;
  cd = 0;
  maxCd = 1;
  active = false;
  get allowsFire(): boolean { return !this.active; }
  /** Return true while this ability owns movement. */
  abstract update(w: World, p: Player, inp: InputState, dt: number): boolean;
  refund(): void { this.cd = 0; }
  readyFrac(): number { return this.maxCd ? clamp(1 - this.cd / this.maxCd, 0, 1) : 1; }
  /** Text shown under the cooldown pip (charges). */
  hudText(): string { return ''; }
  drawScale(): number { return 1; }
  draw(_g: Gfx, _w: World, _p: Player): void {}
}

class StockLegs extends Legs {
  readonly id = 'legs_stock' as const;
  private t = 0;
  private dx = 0;
  private dy = 0;
  maxCd = 0.5;
  update(w: World, p: Player, inp: InputState, dt: number): boolean {
    if (this.cd > 0) this.cd -= dt;
    if (!this.active && inp.dashPressed && this.cd <= 0) {
      [this.dx, this.dy] = dashDir(p, inp);
      this.active = true;
      this.t = 0;
      this.cd = this.maxCd + 0.16;
      p.beginDodge(w, 0.2);
      w.sfx('dash');
      w.fx.smoke(p.x, p.y, 3, P.slate, 3, 8);
    }
    if (!this.active) return false;
    this.t += dt;
    const sp = 720 * (1 - this.t / 0.2);
    w.moveCircle(p, this.dx * sp * dt, this.dy * sp * dt);
    p.vx = this.dx * 110;
    p.vy = this.dy * 110;
    if (this.t >= 0.16) this.active = false;
    return true;
  }
}

class LeapLegs extends Legs {
  readonly id = 'legs_leap' as const;
  private t = 0;
  private dx = 0;
  private dy = 0;
  private readonly dur = 0.42;
  maxCd = 0.85;
  update(w: World, p: Player, inp: InputState, dt: number): boolean {
    if (this.cd > 0) this.cd -= dt;
    if (!this.active && inp.dashPressed && this.cd <= 0) {
      [this.dx, this.dy] = dashDir(p, inp);
      if (!inp.mx && !inp.my) { this.dx *= 0.5; this.dy *= 0.5; }
      this.active = true;
      this.t = 0;
      p.airborne = true;
      p.beginDodge(w, 0.15);
      this.cd = this.maxCd + this.dur;
      w.sfx('leap');
    }
    if (!this.active) return false;
    this.t += dt;
    const sp = 228;
    w.moveCircle(p, this.dx * sp * dt, this.dy * sp * dt, { solids: false });
    p.z = Math.sin(Math.PI * Math.min(1, this.t / this.dur)) * 16;
    if (this.t >= this.dur) this.land(w, p);
    return true;
  }
  private land(w: World, p: Player): void {
    this.active = false;
    p.airborne = false;
    p.z = 0;
    w.moveCircle(p, 0, 0); // pop out of anything we landed in
    p.vx = this.dx * 60;
    p.vy = this.dy * 60;
    const R = 36;
    w.clearBullets(p.x, p.y - 6, R, true);
    for (const b of w.bodies) {
      if (b.dead) continue;
      const d = dist(p.x, p.y, b.x, b.y);
      if (d > R + b.r) continue;
      const [nx, ny] = norm(b.x - p.x, b.y - p.y);
      if (b.team === 'enemy') w.damage(b, { dmg: 10 * p.dmgMul, kind: 'impact', x: b.hx, y: b.hy, dx: nx, dy: ny, poise: 6, from: 'player', src: 'land' });
      else if (b.mass > 0) b.push(nx * 280, ny * 280);
    }
    w.fx.ring(p.x, p.y, 4, R, P.ice, 0.25, 2);
    w.fx.smoke(p.x, p.y, 6, P.slate, 4, 10);
    w.fx.shake(2, 0.1);
    w.sfx('land');
  }
  drawScale(): number { return 1; }
  draw(g: Gfx, _w: World, p: Player): void {
    if (this.active) g.ellipse(p.x, p.y, 7, 3, P.ink, 0.35, 'floor');
  }
}

class BlinkLegs extends Legs {
  readonly id = 'legs_blink' as const;
  charges = 2;
  maxCd = 1.3;
  get allowsFire(): boolean { return true; }
  update(w: World, p: Player, inp: InputState, dt: number): boolean {
    if (this.charges < 2) {
      this.cd -= dt;
      if (this.cd <= 0) { this.charges++; this.cd = this.charges < 2 ? this.maxCd : 0; }
    }
    if (inp.dashPressed && this.charges > 0) {
      const [dx, dy] = dashDir(p, inp);
      let tx = p.x, ty = p.y;
      for (let d = 84; d >= 0; d -= 4) {
        const x = p.x + dx * d, y = p.y + dy * d;
        if (spotFree(w, x, y, p.r)) { tx = x; ty = y; break; }
      }
      w.fx.ghost('pc_echo', `${p.dir}_idle`, p.x, p.y, { tint: P.magenta, alpha: 0.7 }, 0.5);
      w.decoy = { x: p.x, y: p.y, t: 1.2 };
      w.fx.burst(p.x, p.y - 9, 10, P.rose, 60, 0.3, 1);
      p.x = tx;
      p.y = ty;
      w.fx.burst(p.x, p.y - 9, 10, P.ice, 60, 0.3, 1);
      p.beginDodge(w, 0.22);
      if (this.charges === 2) this.cd = this.maxCd;
      this.charges--;
      w.sfx('blink');
    }
    return false;
  }
  refund(): void { this.charges = 2; this.cd = 0; }
  readyFrac(): number { return this.charges > 0 ? 1 : clamp(1 - this.cd / this.maxCd, 0, 1); }
  hudText(): string { return `${this.charges}`; }
  draw(g: Gfx, w: World): void {
    const d = w.decoy;
    if (d) {
      const a = 0.35 + 0.25 * Math.sin(w.realTime * 30);
      g.img('pc_echo', 'down_idle', d.x, d.y, { tint: P.rose, alpha: a, depth: d.y });
    }
  }
}

class SlideLegs extends Legs {
  readonly id = 'legs_slide' as const;
  private t = 0;
  private dx = 0;
  private dy = 0;
  private hitSet = new Set<number>();
  private readonly dur = 0.36;
  maxCd = 0.65;
  get allowsFire(): boolean { return true; }
  update(w: World, p: Player, inp: InputState, dt: number): boolean {
    if (this.cd > 0) this.cd -= dt;
    if (!this.active && inp.dashPressed && this.cd <= 0) {
      [this.dx, this.dy] = dashDir(p, inp);
      this.active = true;
      this.t = 0;
      this.hitSet.clear();
      p.beginDodge(w, 0.12);
      this.cd = this.maxCd + this.dur;
      w.sfx('slide');
    }
    if (!this.active) return false;
    this.t += dt;
    const sp = 520 - 300 * (this.t / this.dur);
    const enemies = w.bodies.filter((b) => b.team === 'enemy');
    w.moveCircle(p, this.dx * sp * dt, this.dy * sp * dt, { ignore: enemies });
    p.vx = this.dx * sp * 0.3;
    p.vy = this.dy * sp * 0.3;
    for (const b of w.bodies) {
      if (b.dead || this.hitSet.has(b.id)) continue;
      if (dist(p.x, p.y, b.x, b.y) > b.r + p.r + 4) continue;
      this.hitSet.add(b.id);
      if (b.team === 'enemy') {
        w.damage(b, { dmg: 15 * p.dmgMul, kind: 'impact', x: b.hx, y: b.hy, dx: this.dx, dy: this.dy, poise: 6, from: 'player', src: 'slide' });
        p.iframes = Math.max(p.iframes, 0.25);
      } else if (b.mass > 0) {
        b.push(this.dx * 420, this.dy * 420);
        w.sfx('punch', 0.5);
      }
    }
    if (w.rng.chance(0.5)) w.fx.burst(p.x, p.y, 1, P.slate, 30, 0.3, 2);
    if (this.t >= this.dur) this.active = false;
    return true;
  }
  drawScale(): number { return this.active ? 0.78 : 1; }
}

// =====================================================================================
// ARMS
// =====================================================================================
export abstract class Arm {
  abstract readonly id: CyberId;
  cd = 0;
  maxCd = 1;
  abstract update(w: World, p: Player, inp: InputState, dt: number, can: boolean): void;
  reduceCd(s: number): void { this.cd = Math.max(0, this.cd - s); }
  readyFrac(): number { return this.maxCd ? clamp(1 - this.cd / this.maxCd, 0, 1) : 1; }
  hudText(): string { return ''; }
  draw(_g: Gfx, _w: World, _p: Player): void {}
}

class ShoveArm extends Arm {
  readonly id = 'arm_shove' as const;
  maxCd = 2.5;
  private fxT = 0;
  update(w: World, p: Player, inp: InputState, dt: number, can: boolean): void {
    if (this.cd > 0) this.cd -= dt;
    if (this.fxT > 0) this.fxT -= dt;
    if (!can || !inp.armPressed || this.cd > 0) return;
    this.cd = this.maxCd;
    this.fxT = 0.12;
    const cx = p.x, cy = p.y - 8, a = p.aim, R = 54, span = 1.9;
    const sec = { k: 'sector' as const, x: cx, y: cy, r: R, a, span };
    for (const e of w.bullets) {
      if (e.team === 'enemy' && e.soft && !e.dead && shapeHits(sec, e.x, e.y, e.r)) { e.dead = true; w.fx.burst(e.x, e.y, 3, COL.soft, 40, 0.2, 1); }
    }
    for (const b of w.bodies) {
      if (b.dead || !shapeHits(sec, b.hx, b.hy, b.hr)) continue;
      const [nx, ny] = norm(b.x - p.x, b.y - p.y);
      if (b.team === 'enemy') w.damage(b, { dmg: 5 * p.dmgMul, kind: 'impact', x: b.hx, y: b.hy, dx: nx, dy: ny, poise: 9, from: 'player', src: 'shove' });
      else if (b.mass > 0) b.push(Math.cos(a) * 400, Math.sin(a) * 400);
    }
    w.sfx('shove');
    w.fx.sparks(cx, cy, 8, P.ice, 160, a, 1.4);
  }
  draw(g: Gfx, _w: World, p: Player): void {
    if (this.fxT > 0) {
      const a = p.aim;
      g.sector(p.x, p.y - 8, 54 * (1 - this.fxT * 3), a - 0.95, a + 0.95, P.ice, 0.25 * (this.fxT / 0.12), 'top', 20);
    }
  }
}

type GrappleState = 'idle' | 'flying' | 'retract' | 'pulling' | 'zipping';

class GrappleArm extends Arm {
  readonly id = 'arm_grapple' as const;
  maxCd = 2.8;
  private st: GrappleState = 'idle';
  private hx = 0;
  private hy = 0;
  private dx = 0;
  private dy = 0;
  private travelled = 0;
  private target: Body | null = null;
  private zipTo: { x: number; y: number } | null = null;
  private heldT = 0;
  private lastZipD = Infinity;
  private pullT = 0;

  update(w: World, p: Player, inp: InputState, dt: number, can: boolean): void {
    if (this.cd > 0 && this.st === 'idle') this.cd -= dt;
    if (p.held) {
      this.heldT += dt;
      if ((can && inp.armPressed) || this.heldT > 6) this.throwHeld(w, p);
      return;
    }
    switch (this.st) {
      case 'idle':
        if (can && inp.armPressed && this.cd <= 0) {
          this.st = 'flying';
          this.hx = p.handX; this.hy = p.handY;
          this.dx = Math.cos(p.aim); this.dy = Math.sin(p.aim);
          this.travelled = 0;
          w.sfx('grapple');
        }
        break;
      case 'flying': this.fly(w, p, dt); break;
      case 'retract': {
        const [nx, ny] = norm(p.handX - this.hx, p.handY - this.hy);
        this.hx += nx * 900 * dt; this.hy += ny * 900 * dt;
        if (dist(this.hx, this.hy, p.handX, p.handY) < 12) this.finish();
        break;
      }
      case 'pulling': {
        const b = this.target;
        if (!b || b.dead) { this.finish(); break; }
        this.pullT += dt;
        if (this.pullT > 1) { this.finish(); break; } // prop snagged behind something
        const [nx, ny] = norm(p.x - b.x, p.y - b.y);
        b.vx = nx * 430; b.vy = ny * 430;
        this.hx = b.hx; this.hy = b.hy;
        if (dist(b.x, b.y, p.x, p.y) < 20) {
          p.held = b;
          this.heldT = 0;
          b.vx = b.vy = 0;
          this.st = 'idle';
          w.sfx('click');
        }
        break;
      }
      case 'zipping': {
        const t = this.zipTo!;
        const d = dist(p.x, p.y, t.x, t.y);
        const [nx, ny] = norm(t.x - p.x, t.y - p.y);
        const sp = 520;
        const stuck = this.lastZipD - d < sp * dt * 0.25 && this.travelled > 0;
        this.lastZipD = d;
        if (d < 6 || d < sp * dt || stuck) {
          p.forced = null;
          this.arrive(w, p);
        } else {
          p.forced = { vx: nx * sp, vy: ny * sp, t: dt * 1.5, iframes: true, solids: false };
          this.hx = this.target ? this.target.hx : t.x;
          this.hy = this.target ? this.target.hy : t.y;
          this.travelled += sp * dt;
          if (this.travelled > 600) { p.forced = null; this.finish(); }
        }
        break;
      }
    }
  }

  private fly(w: World, p: Player, dt: number): void {
    const sp = 720;
    for (let s = 0; s < 4; s++) {
      this.hx += (this.dx * sp * dt) / 4;
      this.hy += (this.dy * sp * dt) / 4;
      this.travelled += (sp * dt) / 4;
      if (w.pointInWall(this.hx, this.hy)) {
        this.hx -= this.dx * 4; this.hy -= this.dy * 4;
        this.startZip(w, p, this.hx - this.dx * (p.r + 3), this.hy - this.dy * (p.r + 3) + 9, null);
        return;
      }
      for (const b of w.bodies) {
        if (b.dead || !b.targetable && !b.interactable) continue;
        if (dist(this.hx, this.hy, b.hx, b.hy) > b.hr + 5) continue;
        if (b.interactable && b.onInteract) { b.onInteract(w); this.st = 'retract'; w.sfx('click'); return; }
        if (b.grapple === 'pull' && b.mass > 0) { this.target = b; this.st = 'pulling'; this.pullT = 0; w.sfx('click'); return; }
        if (b.team === 'enemy' || b.grapple === 'anchor' || b.solid) {
          const [nx, ny] = norm(p.x - b.x, p.y - b.y);
          const stop = b.r + p.r + 4;
          this.startZip(w, p, b.x + nx * stop, b.y + ny * stop, b);
          return;
        }
      }
      if (this.travelled > 190 * p.rangeMul) { this.st = 'retract'; return; }
    }
  }

  private startZip(w: World, p: Player, x: number, y: number, b: Body | null): void {
    this.st = 'zipping';
    this.lastZipD = Infinity;
    this.zipTo = { x, y };
    this.target = b;
    this.travelled = 0;
    p.beginDodge(w, 0.1);
    w.sfx('hook');
  }

  private arrive(w: World, p: Player): void {
    const b = this.target;
    if (b && b.team === 'enemy') {
      const [nx, ny] = norm(b.x - p.x, b.y - p.y);
      w.damage(b, { dmg: 10 * p.dmgMul, kind: 'impact', x: b.hx, y: b.hy, dx: nx, dy: ny, poise: 12, from: 'player', src: 'grapple' });
      w.sfx('punch');
    }
    p.iframes = Math.max(p.iframes, 0.15);
    w.moveCircle(p, 0, 0);
    this.finish();
  }

  private throwHeld(w: World, p: Player): void {
    const b = p.held!;
    p.held = null;
    b.x = p.x + Math.cos(p.aim) * 16;
    b.y = p.y + Math.sin(p.aim) * 10;
    w.moveCircle(b, 0, 0, { ignore: b });
    b.vx = Math.cos(p.aim) * 480;
    b.vy = Math.sin(p.aim) * 480;
    this.cd = 0.6;
    w.sfx('shove');
  }

  private finish(): void {
    this.st = 'idle';
    this.target = null;
    this.zipTo = null;
    this.cd = this.maxCd;
  }

  hudText(): string { return this.st === 'idle' && this.cd <= 0 ? '' : ''; }

  draw(g: Gfx, _w: World, p: Player): void {
    if (this.st === 'idle') return;
    g.line(p.handX, p.handY, this.hx, this.hy, 1, P.steel, 1, 'top');
    g.img('proj', 'claw', this.hx, this.hy, { layer: 'top', ox: 0.5, oy: 0.5, rot: Math.atan2(this.hy - p.handY, this.hx - p.handX) });
  }
}

class FistArm extends Arm {
  readonly id = 'arm_fist' as const;
  maxCd = 2.6;
  private charging = false;
  private chargeT = 0;
  private fxT = 0;
  update(w: World, p: Player, inp: InputState, dt: number, can: boolean): void {
    if (this.cd > 0) this.cd -= dt;
    if (this.fxT > 0) this.fxT -= dt;
    if (!this.charging) {
      if (can && inp.armPressed && this.cd <= 0) { this.charging = true; this.chargeT = 0; }
      return;
    }
    this.chargeT += dt;
    p.slow = Math.min(p.slow, 0.6);
    if (this.chargeT > 0.7 && Math.floor(this.chargeT * 20) % 3 === 0) w.fx.sparks(p.handX, p.handY, 1, P.amber, 40);
    if (!inp.arm || !can) this.punch(w, p);
  }
  private punch(w: World, p: Player): void {
    this.charging = false;
    const c = clamp((this.chargeT - 0.08) / 0.6, 0, 1);
    this.cd = this.maxCd;
    this.fxT = 0.15;
    const a = p.aim, R = 38, cx = p.x, cy = p.y - 8;
    const sec = { k: 'sector' as const, x: cx, y: cy, r: R, a, span: 1.75 };
    let reflected = 0;
    for (const e of w.bullets) {
      if (e.dead || e.team !== 'enemy' || !e.deflectable || !shapeHits(sec, e.x, e.y, e.r + 2)) continue;
      const sp = Math.max(260, e.speed * 1.3);
      e.team = 'player'; e.deflected = true; e.dmg = 12 * p.dmgMul; e.poise = 4;
      e.vx = Math.cos(a) * sp; e.vy = Math.sin(a) * sp; e.age = 0; e.life = 1.5; e.hitIds.clear();
      e.frame = 'deflect'; e.glowColor = P.cyan; e.src = 'deflect';
      reflected++;
    }
    for (const b of w.bodies) {
      if (b.dead || !shapeHits(sec, b.hx, b.hy, b.hr)) continue;
      const [nx, ny] = norm(b.x - p.x, b.y - p.y);
      if (b.team === 'enemy') {
        w.damage(b, { dmg: (20 + 50 * c) * p.dmgMul, kind: 'melee', x: b.hx, y: b.hy, dx: nx, dy: ny, poise: 12 + 38 * c, armorBreak: c >= 0.5 ? 1 : 0, from: 'player', src: 'fist' });
      } else if (b.mass > 0) {
        b.push(Math.cos(a) * (320 + 480 * c), Math.sin(a) * (320 + 480 * c));
      }
    }
    w.moveCircle(p, Math.cos(a) * 8, Math.sin(a) * 8);
    w.hitstop = Math.max(w.hitstop, 0.03 + 0.04 * c);
    w.fx.shake(2 + 3 * c, 0.12);
    w.fx.sparks(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 10, P.amber, 180, a, 1.2);
    w.sfx('punch', 0.8 + 0.4 * c);
    if (reflected) w.sfx('deflect');
  }
  draw(g: Gfx, _w: World, p: Player): void {
    if (this.charging) {
      const c = clamp((this.chargeT - 0.08) / 0.6, 0, 1);
      g.circle(p.handX, p.handY, 3 + c * 5, c >= 1 ? P.amber : P.orange, 0.5, 'light');
    }
    if (this.fxT > 0) g.sector(p.x, p.y - 8, 38, p.aim - 0.85, p.aim + 0.85, P.amber, 0.3 * (this.fxT / 0.15), 'top', 12);
  }
}

class JackArm extends Arm {
  readonly id = 'arm_jack' as const;
  maxCd = 8;
  private chan: { b: Body; t: number } | null = null;
  update(w: World, p: Player, inp: InputState, dt: number, can: boolean): void {
    if (this.cd > 0) this.cd -= dt;
    if (this.chan) {
      const c = this.chan;
      c.t -= dt;
      if (c.b.dead) { this.chan = null; return; }
      if (c.t <= 0) {
        this.chan = null;
        if (c.b.team === 'enemy' && w.boss) w.boss.jam(w, 4);
        else c.b.onHack?.(w);
        w.fx.burst(c.b.hx, c.b.hy, 14, P.acid, 80, 0.4, 1);
        w.fx.label(c.b.hx, c.b.hy - 10, '已骇入', P.acid);
      }
      return;
    }
    if (!can || !inp.armPressed || this.cd > 0) return;
    const ax = inp.ax, ay = inp.ay;
    let best: Body | null = null, bd = Infinity;
    for (const b of w.bodies) {
      if (b.dead || !(b.hackable || b.team === 'enemy')) continue;
      if (dist(p.x, p.y, b.x, b.y) > 260) continue;
      const d = dist(ax, ay, b.hx, b.hy) - b.hr - (b.hackable ? 24 : 0);
      if (d < 36 && d < bd) { bd = d; best = b; }
    }
    if (!best) { w.fx.label(p.x, p.y - 18, '无目标', P.fog, 0.5); w.sfx('click'); return; }
    this.chan = { b: best, t: 0.3 };
    this.cd = this.maxCd;
    // glyph look: devices 1.2 s after the hack lands; boss parts hand over to the boss-wide jam look
    best.glyphUntil = w.time + 0.3 + (best.team === 'enemy' ? 0.7 : 1.2);
    w.sfx('hack');
  }
  draw(g: Gfx, w: World, p: Player): void {
    const c = this.chan;
    if (!c) return;
    const n = 6;
    let px = p.handX, py = p.handY;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = p.handX + (c.b.hx - p.handX) * t + (i < n ? w.vrng.range(-3, 3) : 0);
      const y = p.handY + (c.b.hy - p.handY) * t + (i < n ? w.vrng.range(-3, 3) : 0);
      g.line(px, py, x, y, 1, P.acid, 0.9, 'top');
      px = x; py = y;
    }
  }
}

// =====================================================================================
// CORE + HEAD (passive)
// =====================================================================================
export class CoreWare {
  cd = 0;
  constructor(readonly id: CyberId) {}
  init(p: Player): void {
    if (this.id === 'core_plating') { p.shieldMax = 1; p.shield = 1; }
  }
  update(w: World, p: Player, dt: number): void {
    if (this.cd > 0) this.cd -= dt;
    if (this.id === 'core_plating' && p.shield < p.shieldMax && w.time - p.lastHurtAt > 10) {
      p.shield = p.shieldMax;
      w.sfx('shield');
      w.fx.ring(p.x, p.y - 9, 14, 4, P.cyan, 0.3);
    }
  }
  onHurt(w: World, p: Player): void {
    if (this.id !== 'core_capacitor' || this.cd > 0) return;
    this.cd = 12;
    w.clearBullets(p.x, p.y - 8, 135, false);
    for (const b of w.bodies) {
      if (b.dead || b.mass <= 0 || dist(p.x, p.y, b.x, b.y) > 80) continue;
      const [nx, ny] = norm(b.x - p.x, b.y - p.y);
      b.push(nx * 250, ny * 250);
    }
    w.fx.ring(p.x, p.y - 8, 8, 135, P.ice, 0.35, 3);
    w.sfx('emp');
  }
  onPerfectDodge(_w: World, p: Player): void {
    if (this.id === 'core_overclock') p.overclockT = 4;
  }
  readyFrac(): number { return this.id === 'core_capacitor' ? clamp(1 - this.cd / 12, 0, 1) : 1; }
}

export class HeadWare {
  constructor(readonly id: CyberId) {}
  init(p: Player): void {
    if (this.id === 'head_optics') { p.weakMul = 1.8; p.teleMul = 1.15; }
    if (this.id === 'head_ballistic') { p.homing = 2.6; p.rangeMul = 1.25; }
  }
  update(_w: World, _p: Player, _dt: number): void {}
  onPerfectDodge(w: World, _p: Player): void {
    if (this.id === 'head_reflex') {
      w.slowmo(0.3, 1.4);
      w.playerUnscaled = true;
    }
  }
}

export function makeLegs(id: CyberId): Legs {
  switch (id) {
    case 'legs_leap': return new LeapLegs();
    case 'legs_blink': return new BlinkLegs();
    case 'legs_slide': return new SlideLegs();
    default: return new StockLegs();
  }
}

export function makeArm(id: CyberId): Arm {
  switch (id) {
    case 'arm_grapple': return new GrappleArm();
    case 'arm_fist': return new FistArm();
    case 'arm_jack': return new JackArm();
    default: return new ShoveArm();
  }
}

export const makeCore = (id: CyberId) => new CoreWare(id);
export const makeHead = (id: CyberId) => new HeadWare(id);

