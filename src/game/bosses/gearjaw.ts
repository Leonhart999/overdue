/**
 * GEARJAW — scrap crane-mech on treads (reference boss implementation).
 *
 * P1 armoured  : front armour (x0.4 from the front), rear engine is a weak point; 4 plates that
 *                slugs / fists / explosions / the crane strip. Hook, ram, scrap spray, stomp.
 * P2 stripped  : armour gone, faster; adds overheat vent (punish window), hook sweep, double ram.
 * P3 overload  : ram leaves burning oil, spray adds rings; the crane resupplies barrels (arena).
 *
 * Arena interplay: rams stop on pillars / scrap blocks (stagger), rams detonate barrels, the hook
 * drags barrels back to him (and they explode on him if lit), a hook stuck in a wall leaves a
 * cable the blade can cut.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleTo, clamp, dist, norm, sign } from '../../engine/math';
import type { Script } from '../../engine/script';
import type { Body } from '../body';
import { Boss, BossPart, type HitTag } from '../boss';
import { FirePatch } from '../hazard';
import type { Cable, Hit } from '../types';
import type { World } from '../world';

type Anim = 'idle' | 'attack' | 'hurt';

class GearHook {
  dead = false;
  state: 'fly' | 'stuck' | 'reel' | 'back' = 'fly';
  x: number;
  y: number;
  private travelled = 0;
  private stuckT = 0;
  private cargo: Body | null = null;
  private grabbed = false;
  cable: Cable | null = null;

  constructor(private gj: Gearjaw, private dx: number, private dy: number) {
    const [ox, oy] = gj.hookOrigin();
    this.x = ox;
    this.y = oy;
  }

  update(w: World, dt: number): void {
    const [ox, oy] = this.gj.hookOrigin();
    if (this.gj.dying || this.gj.staggered) {
      if (this.state !== 'back') this.release(w);
      this.state = 'back';
    }
    switch (this.state) {
      case 'fly': {
        const sp = 560 * this.gj.bulletMul;
        for (let s = 0; s < 4 && this.state === 'fly'; s++) {
          this.x += (this.dx * sp * dt) / 4;
          this.y += (this.dy * sp * dt) / 4;
          this.travelled += (sp * dt) / 4;
          const p = w.player;
          if (p.overlapsHurt(this.x, this.y, 5)) {
            const r = w.hitPlayer(1, { x: this.x, y: this.y });
            if (r === 'hit') { this.grabbed = true; this.state = 'reel'; w.sfx('hook'); this.gj.followUp = 'stomp'; return; }
          }
          for (const b of w.bodies) {
            if (b.dead || b.team !== 'neutral') continue;
            if (dist(this.x, this.y, b.hx, b.hy) > b.hr + 4) continue;
            if (b.grapple === 'pull' && b.mass > 0) { this.cargo = b; this.state = 'reel'; w.sfx('hook'); return; }
            if (b.solid) { this.stick(w); return; }
          }
          if (w.pointInWall(this.x, this.y)) { this.x -= this.dx * 4; this.y -= this.dy * 4; this.stick(w); return; }
          if (this.travelled > 300) { this.state = 'back'; return; }
        }
        break;
      }
      case 'stuck':
        this.stuckT -= dt;
        if (this.cable) { this.cable.x1 = ox; this.cable.y1 = oy; }
        if (this.stuckT <= 0) { this.dropCable(); this.state = 'back'; }
        break;
      case 'reel': {
        const [nx, ny] = norm(ox - this.x, oy - this.y);
        const sp = 300;
        this.x += nx * sp * dt;
        this.y += ny * sp * dt;
        if (this.cargo) {
          if (this.cargo.dead) { this.cargo = null; this.state = 'back'; break; }
          this.cargo.x = this.x; this.cargo.y = this.y + this.cargo.hz;
          this.cargo.vx = this.cargo.vy = 0;
        }
        if (this.grabbed) {
          const p = w.player;
          p.forced = { vx: nx * sp, vy: ny * sp, t: dt * 1.5, iframes: false, solids: true };
        }
        const near = dist(this.x, this.y, ox, oy) < 30 || (this.grabbed && dist(w.player.x, w.player.y, this.gj.x, this.gj.y) < 46);
        if (near) { this.release(w); this.dead = true; }
        break;
      }
      case 'back': {
        const [nx, ny] = norm(ox - this.x, oy - this.y);
        this.x += nx * 760 * dt;
        this.y += ny * 760 * dt;
        if (dist(this.x, this.y, ox, oy) < 14) this.dead = true;
        break;
      }
    }
  }

  private stick(w: World): void {
    this.state = 'stuck';
    this.stuckT = 1.3;
    w.sfx('crash', 0.4);
    w.fx.sparks(this.x, this.y, 6, P.amber, 90);
    const [ox, oy] = this.gj.hookOrigin();
    const c: Cable = { x1: ox, y1: oy, x2: this.x, y2: this.y, onCut: () => { this.cable = null; this.dead = true; this.gj.hookCut(w); } };
    this.cable = c;
    w.cables.push(c);
  }

  private dropCable(): void {
    if (this.cable) { this.cable.dead = true; this.cable = null; }
  }

  private release(w: World): void {
    this.dropCable();
    if (this.cargo && !this.cargo.dead) {
      const b = this.cargo;
      const [nx, ny] = norm(w.player.x - this.gj.x, w.player.y - this.gj.y);
      b.x = this.gj.x + nx * (this.gj.body.r + b.r + 3);
      b.y = this.gj.y + ny * (this.gj.body.r + b.r + 3);
      w.moveCircle(b, 0, 0, { ignore: b });
      b.vx = b.vy = 0;
    }
    if (this.grabbed) w.player.forced = null;
    this.cargo = null;
    this.grabbed = false;
  }

  draw(g: Gfx): void {
    const [ox, oy] = this.gj.hookOrigin();
    if (!this.cable) g.line(ox, oy, this.x, this.y, 1, P.slate, 1, 'top');
    g.img('proj', 'hook', this.x, this.y, { layer: 'top', ox: 0.5, oy: 0.5, rot: angleTo(ox, oy, this.x, this.y) });
  }
}

export class Gearjaw extends Boss {
  readonly id = 'gearjaw' as const;
  readonly name = '齿颚';
  readonly body: BossPart;
  facing = 1;
  private turnT = 0;
  plates = 4;
  private anim: Anim = 'idle';
  private animClock = 0;
  private moveX = 0;
  private moveY = 0;
  private charging = false;
  private revT = 0;
  cooling = 0;
  hook: GearHook | null = null;
  private hookLost = 0;
  followUp: 'stomp' | null = null;
  private lastPick = '';
  private trailD = 0;

  constructor(w: World, tier: number, x: number, y: number) {
    super(w, tier, x, y, 4200);
    this.thresholds = [0.6, 0.25];
    this.body = this.addPart(new BossPart(this, x, y, 26, 37, 30));
    this.updateStatus();
  }

  get stripped(): boolean { return this.phase >= 1; }

  hookOrigin(): [number, number] { return [this.x + this.facing * 39, this.y - 44]; }

  private updateStatus(): void {
    this.status = this.phase === 0 ? `装甲 ${this.plates}/4` : this.cooling > 0 ? '冷却中 ×1.5' : '';
  }

  // ------------------------------------------------------------------ hits
  modHit(w: World, _part: BossPart, h: Hit): { mul: number; tag: HitTag } {
    if (h.armorBreak && this.phase === 0 && this.plates > 0) {
      this.plates = Math.max(0, this.plates - h.armorBreak);
      w.fx.debris(this.x, this.y - 40, 6, [P.rust, P.orange, P.amber], 160);
      w.sfx('crash', 0.6);
      w.fx.label(this.x, this.y - 64, this.plates ? `护甲板 -${h.armorBreak}` : '装甲破坏', P.orange);
      this.updateStatus();
    }
    let mul = this.cooling > 0 ? 1.5 : 1;
    const directional = h.from === 'player' && (h.kind === 'bullet' || h.kind === 'melee' || h.kind === 'shock' || h.kind === 'beam');
    if (!directional) return { mul, tag: 'normal' };
    // which side was hit? use travel direction if known, else player position
    const fromSide = h.dx !== undefined && Math.abs(h.dx) > 0.2 ? -sign(h.dx) : sign(w.player.x - this.x);
    const front = fromSide === this.facing;
    if (this.phase === 0 && this.plates > 0 && front) return { mul: 0.4 * mul, tag: 'armor' };
    if (!front) return { mul, tag: 'weak' };
    return { mul, tag: 'normal' };
  }

  hookCut(w: World): void {
    this.hook = null;
    this.hookLost = 6;
    w.fx.label(this.x, this.y - 70, '钢缆切断', P.white, 1);
    this.addPoise(w, 45);
    if (!this.staggered && !this.inTransition) this.setScript(this.stumble());
  }

  private *stumble(): Script {
    this.anim = 'hurt';
    yield* this.wait(1.0);
    this.anim = 'idle';
  }

  onStagger(w: World): void {
    this.charging = false;
    this.anim = 'hurt';
    this.moveX = this.moveY = 0;
    w.fx.smoke(this.x, this.y - 50, 8, P.slate, 6, 30);
  }
  onStaggerEnd(): void { this.anim = 'idle'; }

  // ------------------------------------------------------------------ per-step
  private lastDt = 1 / 60;

  think(w: World, dt: number): void {
    this.lastDt = dt;
    this.animClock += dt;
    if (this.revT > 0) this.revT -= dt;
    if (this.hookLost > 0) this.hookLost -= dt;
    if (this.cooling > 0) {
      this.cooling -= dt;
      if (w.rng.chance(dt * 20)) w.fx.smoke(this.x + w.rng.range(-20, 20), this.y - 50, 1, P.pale, 4, 40);
      if (this.cooling <= 0) this.updateStatus();
    }
    if (this.hook) { this.hook.update(w, dt); if (this.hook.dead) this.hook = null; }
    if (!this.staggered && (this.moveX || this.moveY)) {
      w.moveCircle(this, this.moveX * dt, this.moveY * dt, { ignore: this.body });
      this.body.x = this.x; this.body.y = this.y;
    }
    // keep the player out of the hull
    const p = w.player;
    const d = dist(p.x, p.y, this.x, this.y);
    if (d < this.body.r + p.r && !p.airborne) {
      const [nx, ny] = norm(p.x - this.x, p.y - this.y);
      p.x = this.x + nx * (this.body.r + p.r);
      p.y = this.y + ny * (this.body.r + p.r);
    }
    if (this.phase >= 1 && w.rng.chance(dt * 6)) w.fx.sparks(this.x - this.facing * 2, this.y - 38, 1, w.rng.pick([P.cyan, P.magenta, P.amber]), 60);
    if (this.phase >= 2 && w.rng.chance(dt * 8)) w.fx.smoke(this.x - this.facing * 26, this.y - 80, 1, P.slate, 4, 30);
    this.updateStatus();
  }

  /** x, y, r for moveCircle (the boss moves as its ground circle). */
  get r(): number { return this.body.r; }

  private targetSide(): number { return sign(this.w.target().x - this.x); }

  private *turnToTarget(): Script {
    if (this.targetSide() === this.facing) return;
    this.anim = 'idle';
    yield* this.wait(this.tele(this.phase === 0 ? 0.5 : 0.3));
    this.facing = this.targetSide();
    this.w.sfx('rev', 0.4);
  }

  private *approach(dur: number): Script {
    const end = this.clock + dur;
    const speed = [42, 58, 68][this.phase];
    while (this.clock < end) {
      const t = this.w.target();
      const d = dist(this.x, this.y, t.x, t.y);
      const [nx, ny] = norm(t.x - this.x, t.y - this.y);
      const k = d > 80 ? 1 : 0;
      this.moveX = nx * speed * k;
      this.moveY = ny * speed * k;
      // slow turning: the player gets windows behind him
      if (this.targetSide() !== this.facing) {
        this.turnT += this.lastDt;
        if (this.turnT > (this.phase === 0 ? 0.8 : 0.45)) { this.facing = this.targetSide(); this.turnT = 0; }
      } else this.turnT = 0;
      yield;
    }
    this.moveX = this.moveY = 0;
  }

  // ------------------------------------------------------------------ brain
  *brain(w: World): Script {
    yield* this.wait(0.6);
    for (;;) {
      if (this.followUp === 'stomp') { this.followUp = null; yield* this.stomp(); continue; }
      yield* this.approach(this.tele(this.phase === 0 ? 0.9 : 0.6) + w.rng.range(0, 0.4));
      const d = this.distToTarget();
      const ph = this.phase;
      const options: [string, number][] = [
        ['hook', this.hookLost > 0 ? 0 : d > 70 ? 3 : 1],
        ['ram', d > 90 ? 3 : 1],
        ['spray', d > 60 ? 2 : 1],
        ['stomp', d < 90 ? 5 : 0],
        ['vent', ph >= 1 ? 2 : 0],
        ['sweep', ph >= 1 && d < 140 && this.hookLost <= 0 ? 2.5 : 0],
      ];
      for (const o of options) if (o[0] === this.lastPick) o[1] *= 0.3;
      const pick = w.rng.weighted(options);
      this.lastPick = pick;
      switch (pick) {
        case 'hook': yield* this.hookThrow(); break;
        case 'ram': yield* this.ram(ph === 0 ? 1 : ph === 1 ? (this.tier >= 3 ? 3 : 2) : 3); break;
        case 'spray': yield* this.spray(); break;
        case 'stomp': yield* this.stomp(); break;
        case 'vent': yield* this.vent(); break;
        case 'sweep': yield* this.sweep(); break;
      }
    }
  }

  *transition(w: World, phase: number): Script {
    this.charging = false;
    this.moveX = this.moveY = 0;
    this.invuln = true;
    this.anim = 'hurt';
    try {
    if (phase === 1) {
      this.plates = 0;
      w.fx.label(this.x, this.y - 72, '装甲炸飞', P.orange, 1.4);
      for (let i = 0; i < 3; i++) {
        w.fx.explosion(this.x + w.rng.range(-20, 20), this.y - 40 + w.rng.range(-10, 10), 20);
        w.sfx('explosion', 0.7);
        yield* this.wait(0.25);
      }
      w.fx.debris(this.x, this.y - 40, 24, [P.rust, P.orange, P.amber, P.slate], 220);
    } else {
      w.fx.label(this.x, this.y - 72, '过载', P.red, 1.4);
      w.sfx('rev');
      for (let i = 0; i < 8; i++) { w.fx.smoke(this.x, this.y - 60, 3, P.slate, 6, 40); yield* this.wait(0.1); }
    }
    } finally {
      this.updateStatus();
      this.invuln = false;
      this.anim = 'idle';
    }
    yield* this.wait(0.4);
  }

  private *hookThrow(): Script {
    const w = this.w;
    yield* this.turnToTarget();
    this.anim = 'attack';
    const windup = this.tele(0.7);
    const [ox, oy] = this.hookOrigin();
    let a = this.aimFrom(ox, oy);
    const h = this.hazard({ k: 'line', x1: ox, y1: oy, x2: ox + Math.cos(a) * 300, y2: oy + Math.sin(a) * 300, w: 8 }, windup, 0, (hz) => {
      hz.hitsPlayer = false;
      hz.onTick = (_w, hh) => {
        if (hh.t < windup * 0.6) {
          a = this.aimFrom(ox, oy);
          if (hh.shape.k === 'line') { hh.shape.x2 = ox + Math.cos(a) * 300; hh.shape.y2 = oy + Math.sin(a) * 300; }
        }
      };
    });
    w.sfx('telegraph');
    yield* this.wait(windup);
    if (h.dead && h.t < windup) return;
    this.hook = new GearHook(this, Math.cos(a), Math.sin(a));
    w.sfx('hook');
    while (this.hook && !this.hook.dead) yield;
    this.anim = 'idle';
    yield* this.wait(this.tele(0.5));
  }

  private *ram(count: number): Script {
    const w = this.w;
    for (let i = 0; i < count; i++) {
      yield* this.turnToTarget();
      this.anim = 'attack';
      const windup = this.tele(i === 0 ? 0.85 : 0.5);
      let [dx, dy] = this.dirToTarget();
      const lane = () => {
        const res = w.raycast(this.x, this.y, dx, dy, 700, (b) => b.solid && b.team === 'neutral' && b.mass === 0, true);
        return res.t;
      };
      let L = lane();
      const hz = this.hazard({ k: 'line', x1: this.x, y1: this.y, x2: this.x + dx * L, y2: this.y + dy * L, w: 70 }, windup, 0, (h) => {
        h.hitsPlayer = false;
        h.onTick = (_w, hh) => {
          if (hh.t < windup * 0.45) {
            [dx, dy] = this.dirToTarget();
            L = lane();
            if (hh.shape.k === 'line') { hh.shape.x2 = this.x + dx * L; hh.shape.y2 = this.y + dy * L; }
          }
        };
      });
      void hz;
      w.sfx('rev');
      this.revT = windup;
      const end = this.clock + windup;
      while (this.clock < end) {
        if (w.rng.chance(0.4)) w.fx.smoke(this.x - this.facing * 26, this.y - 76, 1, P.slate, 4, 50);
        yield;
      }
      if (dx !== 0) this.facing = sign(dx);
      // charge
      this.charging = true;
      const speed = 400 * this.bulletMul;
      let hitPlayer = false;
      let crashed: 'wall' | 'pillar' | null = null;
      const start = this.clock;
      let last = this.clock;
      for (let t = 0; t < 2.5 && !crashed; t = this.clock - start) {
        const sdt = this.clock - last || 1 / 60;
        last = this.clock;
        const step = speed * sdt;
        // solid neutral obstacles directly ahead
        for (const b of w.bodies) {
          if (b.dead || b.team !== 'neutral') continue;
          if (dist(this.x + dx * step, this.y + dy * step, b.x, b.y) > this.body.r + b.r) continue;
          const stops = b.onRammed?.(w) ?? false;
          if (stops) { crashed = 'pillar'; break; }
          if (!b.dead && b.mass > 0) b.push(dx * 500 + -dy * 200, dy * 500 + dx * 200);
        }
        if (crashed) break;
        const res = w.moveCircle(this, dx * step, dy * step, { ignore: this.body, solids: false });
        this.body.x = this.x; this.body.y = this.y;
        if (res.wall) crashed = 'wall';
        const p = w.player;
        if (!hitPlayer && dist(p.x, p.y, this.x, this.y) < this.body.r + p.r + 4) {
          const side = sign(-dy * (p.x - this.x) + dx * (p.y - this.y));
          if (w.hitPlayer(2, { x: p.x, y: p.y, knock: 240, dx: -dy * side + dx * 0.4, dy: dx * side + dy * 0.4 }) === 'hit') hitPlayer = true;
        }
        if (this.phase >= 2) {
          this.trailD += step;
          if (this.trailD > 22) { this.trailD = 0; w.objects.push(new FirePatch(this.x - dx * 20, this.y - dy * 10, 11, 3.5, 'enemy')); }
        }
        if (w.rng.chance(0.6)) w.fx.burst(this.x - dx * 30, this.y, 1, P.umber, 40, 0.4, 2);
        if (Math.floor(t * 10) % 2 === 0) w.fx.shake(1.5, 0.05);
        yield;
      }
      this.charging = false;
      this.anim = 'idle';
      if (crashed === 'pillar') {
        w.fx.label(this.x, this.y - 70, '撞晕', P.amber);
        this.stagger(w, this.staggerDur);
        return;
      }
      if (crashed === 'wall') {
        w.fx.shake(6, 0.25);
        w.sfx('crash');
        w.fx.debris(this.x + dx * 30, this.y - 20, 10, [P.rust, P.umber, P.slate]);
        this.anim = 'hurt';
        yield* this.wait(this.tele(i === count - 1 ? 1.0 : 0.35));
        this.anim = 'idle';
      }
    }
    yield* this.wait(this.tele(0.3));
  }

  private *spray(): Script {
    const w = this.w;
    yield* this.turnToTarget();
    this.anim = 'attack';
    w.sfx('telegraph', 0.8, 0.8);
    const [ox, oy] = this.hookOrigin();
    for (let i = 0; i < 6; i++) { w.fx.sparks(ox, oy, 2, P.orange, 60); yield* this.wait(this.tele(0.5) / 6); }
    const waves = this.phase >= 2 ? 4 : 3;
    for (let k = 0; k < waves; k++) {
      const a = this.aimFrom(ox, oy) + (k % 2 ? 0.08 : -0.08);
      this.fan(ox, oy, a, 9, 1.4, 160 + w.rng.range(-10, 20), { frame: 'scrap' });
      if (this.phase >= 2 && k % 2 === 1) this.ring(this.x, this.y - 40, 18, 110, k * 0.17, { frame: 'scrap', accel: 10 });
      w.sfx('spray');
      yield* this.wait(0.3);
    }
    this.anim = 'idle';
    yield* this.wait(this.tele(0.5));
  }

  private *stomp(): Script {
    const w = this.w;
    this.anim = 'attack';
    this.hazard({ k: 'circle', x: this.x, y: this.y, r: 40 }, this.tele(0.55), 0, (h) => { h.hitsPlayer = false; });
    this.hazard({ k: 'ring', x: this.x, y: this.y, r: 150, w: 2 }, this.tele(0.55), 0, (h) => { h.hitsPlayer = false; });
    w.sfx('telegraph');
    yield* this.wait(this.tele(0.55));
    const R0 = 30, R1 = 150, dur = 0.65;
    this.hazard({ k: 'ring', x: this.x, y: this.y, r: R0, w: 12 }, 0, dur, (h) => {
      h.low = true;
      h.cancelable = false;
      h.onTick = (ww, hh) => {
        if (hh.shape.k !== 'ring') return;
        hh.shape.r = R0 + (R1 - R0) * clamp(hh.t / dur, 0, 1);
        for (const b of ww.bodies) {
          if (b.dead || b.mass <= 0 || b.team !== 'neutral') continue;
          const d = dist(b.x, b.y, hh.shape.x, hh.shape.y);
          if (Math.abs(d - hh.shape.r) < 8) { const [nx, ny] = norm(b.x - hh.shape.x, b.y - hh.shape.y); b.push(nx * 40, ny * 40); }
        }
      };
    });
    w.sfx('stomp');
    w.fx.shake(5, 0.3);
    w.fx.smoke(this.x, this.y, 10, P.umber, 6, 10);
    this.anim = 'idle';
    yield* this.wait(this.tele(0.7));
  }

  private *vent(): Script {
    const w = this.w;
    this.anim = 'attack';
    const R = 76;
    const warn = this.tele(1.1);
    this.hazard({ k: 'circle', x: this.x, y: this.y - 6, r: R }, warn, 0.45, (h) => {
      h.onActivate = (ww) => {
        for (let i = 0; i < 40; i++) {
          const a = ww.rng.next() * Math.PI * 2, r = ww.rng.next() * R;
          ww.fx.flame(this.x + Math.cos(a) * r, this.y - 6 + Math.sin(a) * r * 0.8);
        }
        ww.fx.glow(this.x, this.y - 20, R, P.orange, 0.4);
        ww.sfx('fire', 1.2);
        for (const z of ww.zones) if (z.kind === 'oil' && z.contains(this.x, this.y, R)) z.ignite();
        for (const b of ww.bodies) if (b.flammable && dist(b.x, b.y, this.x, this.y) < R) ww.damage(b, { dmg: 0, kind: 'fire', x: b.hx, y: b.hy, from: 'env', ignite: true });
      };
    });
    w.sfx('rev', 0.8);
    yield* this.wait(warn + 0.45);
    // cooling: the punish window
    this.cooling = 2.6;
    this.anim = 'hurt';
    w.fx.label(this.x, this.y - 70, '冷却中', P.ice, 1.2);
    this.updateStatus();
    yield* this.wait(2.6);
    this.anim = 'idle';
  }

  private *sweep(): Script {
    const w = this.w;
    yield* this.turnToTarget();
    this.anim = 'attack';
    const a = this.aimFrom(this.x, this.y - 30);
    const warn = this.tele(0.8);
    this.hazard({ k: 'sector', x: this.x, y: this.y - 20, r: 128, a, span: 3.3, inner: 24 }, warn, 0.22);
    w.sfx('telegraph');
    yield* this.wait(warn);
    w.sfx('hook');
    w.fx.sparks(this.x, this.y - 30, 12, P.pale, 200, a, 3);
    yield* this.wait(0.22);
    this.anim = 'idle';
    yield* this.wait(this.tele(0.6));
  }

  // ------------------------------------------------------------------ draw
  draw(g: Gfx, w: World): void {
    g.ellipse(this.x, this.y + 2, 40, 12, P.ink, 0.5, 'floor');
    const key = this.stripped ? 'bt_gearjaw_stripped' : 'bt_gearjaw';
    let frame: string = this.anim === 'idle' ? (Math.floor(this.animClock * 2.5) % 2 ? 'idle2' : 'idle1') : this.anim;
    if (this.staggered) frame = 'hurt';
    const shakeX = this.revT > 0 || this.charging ? w.rng.range(-1, 1) : 0;
    const flash = this.body.flash > 0;
    g.img(key, frame, this.x + shakeX, this.y + 11, {
      flipX: this.facing < 0, fill: flash ? P.pale : undefined, depth: this.y,
    });
    // engine glow (weak point behind)
    const ex = this.x - this.facing * 30, ey = this.y - 62;
    g.circle(ex, ey, 6 + Math.sin(this.animClock * 8), P.orange, this.phase === 0 ? 0.25 : 0.4, 'light');
    if (this.stripped) g.circle(this.x - this.facing * 3, this.y - 35, 16, P.orange, this.cooling > 0 ? 0.55 : 0.25, 'light');
    if (this.cooling > 0) g.circle(this.x, this.y - 36, 34, P.ice, 0.12 + 0.06 * Math.sin(this.animClock * 12), 'light');
    if (this.staggered) {
      for (let i = 0; i < 3; i++) {
        const a = this.animClock * 4 + (i * Math.PI * 2) / 3;
        g.img('proj', 'star', this.x + Math.cos(a) * 18, this.y - 84 + Math.sin(a) * 5, { layer: 'top', ox: 0.5, oy: 0.5 });
      }
    }
    this.hook?.draw(g);
    void COL;
  }
}
