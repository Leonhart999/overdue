/**
 * Skyline rooftop helipad (Director Kade). Interactables:
 *   - helicopter: hovers over one of three pad spots for 6 s every 18 s. Its downdraft (big circle)
 *     pushes the player, props, drones and enemy soft bullets outward; hard bullets are unaffected.
 *     Each hover drops a barrel when fewer than two are left. P3: Kade calls strafing runs
 *     (two red lanes). During a run the console crashes it onto Kade.
 *   - pad console: E / grapple / hack / overload. Calls the helicopter now (over the spot nearest
 *     the player), sends a hovering one away, or crashes a strafing one. 20 s cooldown.
 *   - auto-turrets (2, top corners): red aim line 0.8 s, then a 4-bolt burst at the player.
 *     Hacked (jack arm, overload burst, E when adjacent) they shoot Kade for 15 s.
 *   - searchlight towers (2, bottom corners): sweeping spots. 2 s in a spot = locked: Kade's next
 *     attack tracks. A slug, an explosion, an overload, 6 nails, 30 damage or Kade's bash break a lamp.
 *   - rail gaps (left and right): falling through costs 1 heart and the winch pulls you back.
 *     Drones, barrels and tanks that go through are lost.
 *   - fuel tanks (2): big explosion (72 px), leave burning fuel.
 *
 * Per-fight state is a PadState in `w.objects`, found with padOf(w).
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleTo, clamp, dist, norm } from '../../engine/math';
import { Body } from '../body';
import { Bullet } from '../bullet';
import { FirePatch, Hazard, Zone } from '../hazard';
import { Barrel } from '../props';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

export const PAD = {
  bounds: { x: 40, y: 56, w: 560, h: 272 },
  /** Rail gap on both side rails (y range). */
  gap: { y0: 172, y1: 220 },
  turrets: [[78, 92], [562, 92]] as [number, number][],
  towers: [[76, 304], [564, 304]] as [number, number][],
  console: [320, 318] as [number, number],
  tanks: [[150, 262], [490, 140]] as [number, number][],
  barrels: [[214, 108], [430, 276]] as [number, number][],
  /** Helicopter hover spots (ground points). */
  spots: [[320, 196], [182, 168], [458, 226]] as [number, number][],
  /** Painted H centre. */
  pad: { x: 320, y: 196 },
  playerSpawn: { x: 320, y: 288 },
  kadeSpawn: { x: 320, y: 132 },
};

export const DOWNDRAFT_R = 66;
const HELI_ALT = 46;
const CONSOLE_CD = 20;

const STATES = new WeakMap<World, PadState>();
export function padOf(w: World): PadState | undefined { return STATES.get(w); }

function shadow(g: Gfx, x: number, y: number, rx: number, ry = rx * 0.4): void {
  g.ellipse(x, y, rx, ry, P.ink, 0.45, 'floor');
}

// =====================================================================================
// Helicopter
// =====================================================================================
export type HeliState = 'away' | 'in' | 'hover' | 'out' | 'strafe' | 'crash';

interface Pass { x1: number; y1: number; x2: number; y2: number; lanes: Hazard[]; t: number; warn: number; active: number }

export class Heli {
  state: HeliState = 'away';
  t = 0;
  /** Seconds until the next scheduled hover while away. */
  nextIn = 9;
  /** Hover / crash ground point. */
  hx = PAD.pad.x;
  hy = PAD.pad.y;
  /** Current ground-projected position (shadow); the body is drawn HELI_ALT above it. */
  x = -200;
  y = -200;
  private fromX = -200;
  private fromY = -200;
  /** Downdraft strength 0..1. */
  k = 0;
  /** Forced hover seconds left (Kade's clearance). */
  forced = 0;
  private passes: Pass[] = [];
  private passesLeft = 0;
  private rotor = 0;
  private dropped = false;
  readonly inT = 1.1;
  readonly hoverT = 6;
  readonly outT = 1.0;
  readonly crashT = 1.1;

  constructor(private pad: PadState) {}

  get inDraft(): boolean { return this.k > 0.3; }
  get busy(): boolean { return this.state === 'strafe' || this.state === 'crash'; }
  get strafing(): boolean { return this.state === 'strafe'; }

  /** Is a ground point inside the downdraft circle? */
  covers(x: number, y: number, pad = 0): boolean {
    return this.inDraft && dist(x, y, this.hx, this.hy) < DOWNDRAFT_R + pad;
  }

  arrive(spotX: number, spotY: number): void {
    if (this.state === 'hover' || this.state === 'in') { this.hx = spotX; this.hy = spotY; return; }
    this.hx = spotX; this.hy = spotY;
    this.state = 'in';
    this.t = 0;
    this.fromX = spotX + 220; this.fromY = spotY - 280;
    this.x = this.fromX; this.y = this.fromY;
    this.dropped = false;
  }

  leave(): void {
    if (this.state !== 'hover' && this.state !== 'in') return;
    this.state = 'out';
    this.t = 0;
    this.fromX = this.x; this.fromY = this.y;
  }

  /** Hover over the spot nearest (x, y). */
  callTo(x: number, y: number): void {
    let best = PAD.spots[0], bd = Infinity;
    for (const s of PAD.spots) { const d = dist(s[0], s[1], x, y); if (d < bd) { bd = d; best = s; } }
    this.arrive(best[0], best[1]);
  }

  /** Clearance: hover for `s` seconds no matter what (comes back from a crash if needed). */
  forceHover(spotX: number, spotY: number, s: number): void {
    this.cancelPasses();
    if (this.state === 'strafe' || this.state === 'crash' || this.state === 'out') this.state = 'away';
    this.forced = Math.max(this.forced, s);
    this.arrive(spotX, spotY);
  }

  /** Start a strafing run of `passes` lanes pairs (Kade P3). Returns false if the helicopter is unavailable. */
  strafe(passes: number): boolean {
    if (this.state === 'crash' || this.forced > 0) return false;
    this.state = 'strafe';
    this.t = 0;
    this.passesLeft = passes;
    this.passes = [];
    return true;
  }

  private cancelPasses(): void {
    for (const p of this.passes) for (const l of p.lanes) if (l.warning) l.dead = true;
    this.passes = [];
    this.passesLeft = 0;
  }

  /** Console during a strafing run: dive onto (x, y). */
  crash(w: World, x: number, y: number): void {
    this.cancelPasses();
    [x, y] = w.clampToBounds(x, y, 30);
    this.hx = x; this.hy = y;
    this.state = 'crash';
    this.t = 0;
    this.fromX = this.x; this.fromY = this.y;
    const h = new Hazard({ k: 'circle', x, y, r: 60 }, this.crashT, 0);
    h.hitsPlayer = false;
    h.cancelable = false;
    w.addHazard(h);
    w.fx.label(x, y - 50, '直升机坠毁', COL.danger, 1.2);
    w.sfx('siren');
  }

  private explodeCrash(w: World): void {
    const x = this.hx, y = this.hy;
    w.explode(x, y - 6, 60, { enemyDmg: 380, poise: 999, playerDmg: 2, from: 'env', src: 'heli', knock: 320 });
    w.fx.explosion(x - 20, y + 8, 30);
    w.fx.explosion(x + 22, y - 6, 26);
    w.fx.shake(10, 0.5);
    w.fx.flash(P.orange, 0.35, 0.25);
    w.hitstop = Math.max(w.hitstop, 0.1);
    w.fx.debris(x, y - 10, 30, [P.white, P.pale, P.amber, P.slate, P.ink], 260);
    // spilled fuel: burning puddles that keep hurting both sides for a while
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + w.rng.next(), r = 18 + w.rng.next() * 34;
      const [fx, fy] = w.clampToBounds(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8, 10);
      w.objects.push(new FirePatch(fx, fy, 12, 6 + w.rng.next() * 2, 'env'));
    }
    for (let i = 0; i < 3; i++) {
      const [ox, oy] = w.clampToBounds(x + w.rng.range(-40, 40), y + w.rng.range(-26, 26), 20);
      const z = new Zone('oil', { k: 'circle', x: ox, y: oy, r: 18 + w.rng.next() * 8 });
      z.life = 24;
      w.addZone(z).ignite();
    }
    this.pad.wrecks.push({ x, y, t: 0 });
    this.state = 'away';
    this.nextIn = 14;
    this.x = this.y = -200;
  }

  update(w: World, dt: number): void {
    this.rotor += dt;
    if (this.forced > 0) this.forced -= dt;
    switch (this.state) {
      case 'away':
        this.k = 0;
        this.nextIn -= dt;
        if (this.nextIn <= 0 && w.state === 'fight') {
          const s = w.rng.pick(PAD.spots);
          this.arrive(s[0], s[1]);
        }
        break;
      case 'in': {
        this.t += dt;
        const f = clamp(this.t / this.inT, 0, 1), e = 1 - (1 - f) * (1 - f);
        this.x = this.fromX + (this.hx - this.fromX) * e;
        this.y = this.fromY + (this.hy - this.fromY) * e;
        this.k = Math.max(0, (f - 0.6) / 0.4) * 0.5;
        if (f >= 1) { this.state = 'hover'; this.t = 0; }
        break;
      }
      case 'hover':
        this.t += dt;
        this.x += (this.hx - this.x) * Math.min(1, dt * 4);
        this.y += (this.hy - this.y) * Math.min(1, dt * 4);
        this.k = Math.min(1, 0.5 + this.t / 0.5);
        if (!this.dropped && this.t > 0.6) { this.dropped = true; this.pad.dropBarrel(w, this.hx, this.hy); }
        if (this.t >= this.hoverT && this.forced <= 0) this.leave();
        break;
      case 'out': {
        this.t += dt;
        const f = clamp(this.t / this.outT, 0, 1);
        this.k = Math.max(0, 1 - f * 3);
        this.x = this.fromX - 260 * f * f;
        this.y = this.fromY - 300 * f * f;
        if (f >= 1) { this.state = 'away'; this.nextIn = 18 - this.hoverT - this.inT; }
        break;
      }
      case 'strafe': this.updateStrafe(w, dt); break;
      case 'crash': {
        this.t += dt;
        const f = clamp(this.t / this.crashT, 0, 1);
        this.k = 0;
        this.x = this.fromX + (this.hx - this.fromX) * f;
        this.y = this.fromY + (this.hy - this.fromY) * f;
        if (w.rng.chance(dt * 30)) w.fx.smoke(this.x, this.y - HELI_ALT * (1 - f), 1, P.slate, 5, 20);
        if (f >= 1) this.explodeCrash(w);
        break;
      }
    }
    if (this.k > 0) this.blow(w, dt);
  }

  private updateStrafe(w: World, dt: number): void {
    this.k = 0;
    if (!this.passes.length) {
      if (this.passesLeft <= 0) { this.state = 'away'; this.nextIn = 8; this.x = this.y = -200; return; }
      this.passesLeft--;
      this.passes.push(this.makePass(w));
    }
    const ps = this.passes[0];
    ps.t += dt;
    // the helicopter approaches during the warning, then crosses the arena along the centre line
    const f = clamp((ps.t - ps.warn + 0.35) / (ps.active + 0.7), 0, 1);
    this.x = ps.x1 + (ps.x2 - ps.x1) * f;
    this.y = ps.y1 + (ps.y2 - ps.y1) * f;
    if (ps.t >= ps.warn && ps.t < ps.warn + ps.active) {
      for (const l of ps.lanes) {
        if (l.shape.k !== 'line' || !w.rng.chance(dt * 40)) continue;
        const s = l.shape, u = w.rng.next();
        w.fx.sparks(s.x1 + (s.x2 - s.x1) * u, s.y1 + (s.y2 - s.y1) * u, 3, P.amber, 90);
      }
      if (w.rng.chance(dt * 20)) w.sfx('spray', 0.6, 1.3);
    }
    if (ps.t >= ps.warn + ps.active + 0.5) this.passes.shift();
  }

  private makePass(w: World): Pass {
    const p = w.player;
    const a = w.rng.range(0, Math.PI);
    const dx = Math.cos(a), dy = Math.sin(a);
    const nx = -dy, ny = dx;
    // the player stands on one of the two lanes; the centre line runs between them
    const side = w.rng.chance(0.5) ? 1 : -1;
    const cx = p.x - nx * 22 * side, cy = p.y - ny * 22 * side;
    const L = 520;
    const warn = (w.boss?.tele(1.3) ?? 1.3), active = 0.45;
    const lanes: Hazard[] = [];
    for (const s of [-1, 1]) {
      const ox = nx * 22 * s, oy = ny * 22 * s;
      const h = new Hazard({ k: 'line', x1: cx - dx * L + ox, y1: cy - dy * L + oy, x2: cx + dx * L + ox, y2: cy + dy * L + oy, w: 16 }, warn, active);
      h.cancelable = false;
      lanes.push(w.addHazard(h));
    }
    w.sfx('telegraph');
    w.sfx('rev', 0.6, 1.4);
    return { x1: cx - dx * 420, y1: cy - dy * 420, x2: cx + dx * 420, y2: cy + dy * 420, lanes, t: 0, warn, active };
  }

  /** Downdraft: push the player, movable bodies, drones and enemy soft bullets outward. */
  private blow(w: World, dt: number): void {
    const R = DOWNDRAFT_R, k = this.k;
    const p = w.player;
    const d = dist(p.x, p.y, this.hx, this.hy);
    if (d < R && w.state === 'fight') {
      const [nx, ny] = d > 1 ? norm(p.x - this.hx, p.y - this.hy) : [1, 0];
      const sp = 70 * k * (0.3 + 0.7 * d / R);
      w.moveCircle(p, nx * sp * dt, ny * sp * dt);
    }
    for (const b of w.bodies) {
      if (b.dead || b.mass <= 0) continue;
      const bd = dist(b.x, b.y, this.hx, this.hy);
      if (bd > R + b.r) continue;
      const [nx, ny] = bd > 1 ? norm(b.x - this.hx, b.y - this.hy) : [1, 0];
      const f = (b.team === 'enemy' ? 420 : 260) * k * dt;
      b.vx += nx * f; b.vy += ny * f;
    }
    for (const e of w.bullets) {
      if (e.dead || e.team !== 'enemy' || !e.soft) continue;
      const bd = dist(e.x, e.y, this.hx, this.hy);
      if (bd > R) continue;
      const [nx, ny] = bd > 1 ? norm(e.x - this.hx, e.y - this.hy) : [1, 0];
      e.vx += nx * 700 * k * dt; e.vy += ny * 700 * k * dt;
    }
  }

  drawFloor(g: Gfx, w: World): void {
    if (this.x < -100) return;
    // shadow
    const alt = this.state === 'crash' ? 1 - clamp(this.t / this.crashT, 0, 1) : 1;
    g.ellipse(this.x, this.y + 4, 40 - 8 * alt, 16 - 3 * alt, P.ink, 0.35 + 0.15 * (1 - alt), 'floor');
    if (this.k > 0) {
      // radial rain streaks and the edge of the downdraft
      const R = DOWNDRAFT_R, k = this.k;
      g.ellipse(this.hx, this.hy, R, R, P.pale, 0.08 * k, 'floor');
      g.ring(this.hx, this.hy, R, 2, P.pale, 0.55 * k, 'floor');
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.sin(i * 7.1) * 0.2;
        const ph = (w.realTime * 2.2 + i * 0.37) % 1;
        const r0 = 12 + ph * (R - 16), r1 = r0 + 9;
        g.line(this.hx + Math.cos(a) * r0, this.hy + Math.sin(a) * r0, this.hx + Math.cos(a) * r1, this.hy + Math.sin(a) * r1, 1, P.pale, 0.7 * k * (1 - ph * 0.6), 'floor');
      }
    }
  }

  drawTop(g: Gfx, w: World): void {
    if (this.x < -150 && this.y < -150) return;
    const crash = this.state === 'crash' ? clamp(this.t / this.crashT, 0, 1) : 0;
    const alt = HELI_ALT * (1 - crash);
    const bx = this.x, by = this.y - alt;
    let rot = 0;
    const ps = this.passes[0];
    if (this.state === 'strafe' && ps) rot = Math.atan2(ps.y2 - ps.y1, ps.x2 - ps.x1) + Math.PI / 2;
    if (this.state === 'crash') rot = crash * 5;
    // see-through while hovering so the fight under it stays readable
    const alpha = this.state === 'strafe' || this.state === 'crash' ? 1 : 0.55;
    g.img('kade_heli', 'body', bx, by, { layer: 'top', ox: 0.5, oy: 0.5, rot, alpha });
    // rotor: two crossing blades, blurred disc
    const ra = this.rotor * 30;
    g.circle(bx, by, 34, P.pale, 0.05, 'top');
    for (let i = 0; i < 2; i++) {
      const a = ra + i * Math.PI / 2;
      g.line(bx - Math.cos(a) * 36, by - Math.sin(a) * 36, bx + Math.cos(a) * 36, by + Math.sin(a) * 36, 2, P.ink, 0.45 * alpha, 'top');
    }
    // nav lights and the searchlight under the nose
    const blink = Math.floor(w.realTime * 3) % 2 === 0;
    g.circle(bx - 14, by + 4, 3, P.red, blink ? 0.7 : 0.2, 'light');
    g.circle(bx + 14, by + 4, 3, P.acid, blink ? 0.2 : 0.7, 'light');
    if (this.state === 'strafe') g.circle(bx, by + 6, 8, P.amber, 0.5, 'light');
    if (this.k > 0) g.circle(this.hx, this.hy, DOWNDRAFT_R * 0.8, P.pale, 0.05 * this.k, 'light');
  }
}

// =====================================================================================
// Devices
// =====================================================================================
/** Pad console: calls / sends away / crashes the helicopter. */
export class PadConsole extends Body {
  private refuseT = 0;
  private pulse = 0;
  constructor(x: number, y: number, private pad: PadState) {
    super();
    this.x = x; this.y = y;
    this.r = 9; this.hz = 12; this.hr = 10;
    this.mass = 0;
    this.solid = true;
    this.interactable = true;
    this.hackable = true;
    this.targetable = false;
    this.interactLabel = '叫来直升机';
  }
  update(_w: World, dt: number): void {
    if (this.refuseT > 0) this.refuseT -= dt;
    if (this.pulse > 0) this.pulse -= dt;
    const h = this.pad.heli;
    this.interactLabel = h.strafing ? '让直升机坠毁' : h.state === 'hover' || h.state === 'in' ? '赶走直升机' : '叫来直升机';
  }
  use(w: World): void {
    const r = this.pad.consoleUse(w);
    if (r === true) { this.pulse = 0.5; w.sfx('lever'); w.fx.sparks(this.x, this.y - 14, 8, P.amber, 100); return; }
    if (this.refuseT <= 0) { this.refuseT = 0.6; w.fx.label(this.x, this.y - 30, r, P.fog, 0.7); w.sfx('click'); }
  }
  onInteract(w: World): void { this.use(w); }
  onHack(w: World): void { this.use(w); }
  onEmp(w: World): void { this.use(w); }
  onRammed(): boolean { return true; }
  hurt(): number { return 0; }
  draw(g: Gfx, w: World): void {
    shadow(g, this.x, this.y + 1, 11);
    const cd = this.pad.consoleCd;
    const ready = cd <= 0 && this.pad.heli.state !== 'crash' && this.pad.heli.forced <= 0;
    g.img('pad_dev', ready ? (this.pad.heli.strafing ? 'console_alert' : 'console') : 'console_off', this.x, this.y + 4);
    const glow = ready ? 0.25 + 0.15 * Math.sin(w.realTime * 5) : 0.08;
    g.circle(this.x, this.y - 14, this.pad.heli.strafing && ready ? 18 : 12, ready ? COL.interact : P.red, glow, 'light');
    if (this.pulse > 0) g.circle(this.x, this.y - 14, 30 * (1 - this.pulse), P.amber, this.pulse, 'light');
    if (cd > 0) {
      const bx = this.x - 9, by = this.y - 32;
      g.rect(bx, by, 18, 3, P.ink, 0.8, 'top');
      g.rect(bx, by, 18 * clamp(1 - cd / CONSOLE_CD, 0, 1), 3, P.red, 0.9, 'top');
    }
  }
}

/** Auto-turret. Enemy side by default; hacked it shoots Kade for 15 s. */
export class Turret extends Body {
  side: 'enemy' | 'player' = 'enemy';
  hackT = 0;
  private st: 'idle' | 'aim' | 'fire' = 'idle';
  private t: number;
  private aimA = Math.PI / 2;
  private shots = 0;
  private aimLine: Hazard | null = null;
  private fireT = 0;
  private muzzleT = 0;
  readonly hackDur = 15;
  /** Kade is channelling a reset on this turret (drawn by Kade). */
  resetting = false;
  constructor(x: number, y: number, phase: number) {
    super();
    this.x = x; this.y = y;
    this.r = 10; this.hz = 14; this.hr = 10;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.conductive = true;
    this.hackable = true;
    this.interactable = true;
    this.targetable = false;
    this.interactLabel = '骇入炮台';
    this.t = 2.5 + phase;
  }
  get muzzle(): [number, number] { return [this.x + Math.cos(this.aimA) * 10, this.y - 16 + Math.sin(this.aimA) * 6]; }

  hack(w: World): void {
    if (this.side === 'player') { this.hackT = this.hackDur; this.glyphUntil = w.time + this.hackDur; return; }
    this.side = 'player';
    this.hackT = this.hackDur;
    this.glyphUntil = w.time + this.hackDur;
    this.st = 'idle';
    this.t = 0.3;
    if (this.aimLine) { this.aimLine.dead = true; this.aimLine = null; }
    this.interactLabel = '炮台已骇入';
    w.fx.label(this.x, this.y - 34, '炮台已骇入', P.acid, 1.2);
    w.fx.burst(this.x, this.y - 14, 14, P.acid, 80, 0.4, 1);
    w.sfx('hack');
  }

  /** Back to Kade's side (timeout or his reset). */
  reset(w: World, byKade: boolean): void {
    if (this.side === 'enemy') return;
    this.side = 'enemy';
    this.hackT = 0;
    this.glyphUntil = -1;
    this.st = 'idle';
    this.t = 2;
    this.interactLabel = '骇入炮台';
    w.fx.label(this.x, this.y - 34, byKade ? '炮台被夺回' : '骇入结束', P.red, 1);
    w.sfx('click');
  }

  onHack(w: World): void { this.hack(w); }
  onEmp(w: World): void { this.hack(w); }
  onInteract(w: World): void { if (this.side === 'enemy') this.hack(w); }
  onRammed(): boolean { return true; }
  hurt(w: World, h: Hit): number {
    if (!h.quiet && h.kind !== 'fire' && h.from !== 'enemy') w.fx.sparks(h.x, h.y, 1, P.fog, 40);
    return 0;
  }

  update(w: World, dt: number): void {
    if (this.muzzleT > 0) this.muzzleT -= dt;
    const boss = w.boss;
    if (!boss || boss.dying || w.state !== 'fight') { if (this.aimLine) { this.aimLine.dead = true; this.aimLine = null; } return; }
    if (this.side === 'player') {
      this.hackT -= dt;
      if (this.hackT <= 0) { this.reset(w, false); return; }
      const k = boss.parts[0];
      if (!k || k.dead || !k.targetable) return;
      this.aimA = angleTo(this.x, this.y - 16, k.hx, k.hy);
      this.fireT -= dt;
      if (this.fireT <= 0 && dist(this.x, this.y, k.x, k.y) < 400) {
        this.fireT = 0.3;
        const [mx, my] = this.muzzle;
        const sp = 440;
        const b = new Bullet(mx, my, Math.cos(this.aimA) * sp, Math.sin(this.aimA) * sp, 'player');
        b.r = 2.5; b.dmg = 9; b.poise = 1.2; b.frame = 'deflect'; b.rotates = true; b.life = 1.2;
        b.glow = 4; b.glowColor = P.acid; b.src = 'turret';
        w.addBullet(b);
        this.muzzleT = 0.06;
        w.sfx('nail', 0.5, 0.7);
      }
      return;
    }
    // enemy side: idle -> aim (red line, tracks then locks) -> 4-bolt burst
    const p = w.target();
    switch (this.st) {
      case 'idle':
        this.aimA += (angleTo(this.x, this.y - 16, p.hx, p.hy) - this.aimA) * Math.min(1, dt * 2);
        this.t -= dt;
        if (this.t <= 0) {
          this.st = 'aim';
          const warn = boss.tele(0.8);
          this.t = warn;
          const [mx, my] = this.muzzle;
          const h = new Hazard({ k: 'line', x1: mx, y1: my, x2: mx, y2: my, w: 13 }, warn, 0);
          h.hitsPlayer = false;
          h.cancelable = false;
          this.aimLine = w.addHazard(h);
          w.sfx('telegraph', 0.5, 1.4);
        }
        break;
      case 'aim': {
        this.t -= dt;
        const h = this.aimLine;
        if (h && !h.dead && h.shape.k === 'line') {
          if (h.t < h.warn * 0.7) this.aimA = angleTo(this.x, this.y - 16, p.hx, p.hy);
          const [mx, my] = this.muzzle;
          const L = w.rayWall(mx, my, Math.cos(this.aimA), Math.sin(this.aimA), 420);
          h.shape.x1 = mx; h.shape.y1 = my;
          h.shape.x2 = mx + Math.cos(this.aimA) * L; h.shape.y2 = my + Math.sin(this.aimA) * L;
        }
        if (this.t <= 0) { this.st = 'fire'; this.shots = 4; this.fireT = 0; this.aimLine = null; }
        break;
      }
      case 'fire':
        this.fireT -= dt;
        if (this.fireT <= 0) {
          this.fireT = 0.09;
          const [mx, my] = this.muzzle;
          boss.shoot(mx, my, this.aimA, 300, { soft: false, life: 1.6 });
          this.muzzleT = 0.05;
          w.sfx('nail', 0.5, 0.6);
          if (--this.shots <= 0) { this.st = 'idle'; this.t = boss.tele(3.4) + w.rng.range(0, 1.2); }
        }
        break;
    }
  }

  draw(g: Gfx, w: World): void {
    shadow(g, this.x, this.y + 1, 12);
    const hacked = this.side === 'player';
    g.img('pad_dev', hacked ? 'turret_hacked' : 'turret', this.x, this.y + 4);
    // gun barrel, rotated toward the aim
    g.img('pad_dev_gun', hacked ? 'gun_hacked' : 'gun', this.x, this.y - 16, { ox: 0.25, oy: 0.5, rot: this.aimA, flipY: Math.cos(this.aimA) < 0, depth: this.y + 0.5 });
    if (this.muzzleT > 0) { const [mx, my] = this.muzzle; g.circle(mx, my, 6, hacked ? P.acid : P.red, 0.6, 'light'); }
    if (hacked) {
      g.circle(this.x, this.y - 14, 14, P.acid, 0.18 + 0.06 * Math.sin(w.realTime * 8), 'light');
      const bx = this.x - 10, by = this.y - 34;
      g.rect(bx, by, 20, 3, P.ink, 0.8, 'top');
      g.rect(bx, by, 20 * clamp(this.hackT / this.hackDur, 0, 1), 3, P.acid, 0.9, 'top');
    } else g.circle(this.x, this.y - 16, 8, P.red, 0.12, 'light');
  }
}

/** Searchlight tower: a sweeping spot that locks the player on for Kade. */
export class SearchTower extends Body {
  broken = false;
  private dmgTaken = 0;
  private shockT = 0;
  sx = 0;
  sy = 0;
  readonly spotR = 26;
  private t: number;
  constructor(x: number, y: number, private seed: number) {
    super();
    this.x = x; this.y = y;
    this.r = 8; this.hz = 36; this.hr = 9;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.grapple = 'anchor';
    this.t = seed * 3.7;
    this.sweep(0);
  }
  get lampX(): number { return this.x; }
  get lampY(): number { return this.y - 38; }
  get lit(): boolean { return !this.broken; }

  private sweep(dt: number): void {
    this.t += dt;
    const s = this.seed;
    this.sx = 320 + 210 * Math.sin(this.t * (0.31 + s * 0.07) + s * 2);
    this.sy = 192 + 96 * Math.sin(this.t * (0.47 - s * 0.05) + s * 1.3);
  }

  breakLamp(w: World): void {
    if (this.broken) return;
    this.broken = true;
    this.blocksShots = false;
    this.hz = 20;
    w.fx.debris(this.lampX, this.lampY, 14, [P.white, P.pale, P.amber, P.slate], 160);
    w.fx.sparks(this.lampX, this.lampY, 16, P.amber, 160);
    w.fx.label(this.x, this.y - 54, '探照灯被打碎', P.amber, 1.1);
    w.sfx('crash', 0.8);
    w.sfx('pop');
  }

  update(w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    if (this.broken) { if (w.rng.chance(dt * 2)) w.fx.sparks(this.lampX, this.lampY + 6, 2, P.amber, 50); return; }
    this.sweep(dt);
    if (this.nails >= 6) this.breakLamp(w);
    if (this.shockT > 0) this.shockT = Math.max(0, this.shockT - dt * 0.5);
  }

  hurt(w: World, h: Hit): number {
    if (this.broken || h.from === 'enemy' || h.quiet) return 0;
    this.flash = 0.05;
    w.fx.sparks(h.x, h.y, 2, P.pale, 60);
    if (h.src === 'slug' || h.kind === 'blast' || h.src === 'overload') { this.breakLamp(w); return 0; }
    this.dmgTaken += h.dmg;
    if (this.dmgTaken >= 30) this.breakLamp(w);
    return 0;
  }
  onEmp(w: World): void { this.breakLamp(w); }
  onRammed(w: World): boolean { this.breakLamp(w); return true; }

  drawFloor(g: Gfx, w: World): void {
    if (this.broken) return;
    const f = 0.16 + 0.03 * Math.sin(w.realTime * 7 + this.seed);
    g.ellipse(this.sx, this.sy, this.spotR, this.spotR * 0.8, P.pale, f, 'floor');
    g.ring(this.sx, this.sy, this.spotR, 1, P.white, 0.25, 'floor');
  }

  drawLight(g: Gfx): void {
    if (this.broken) return;
    const a = angleTo(this.lampX, this.lampY, this.sx, this.sy);
    const nx = -Math.sin(a), ny = Math.cos(a);
    g.poly([this.lampX + nx * 2, this.lampY + ny * 2, this.sx + nx * this.spotR, this.sy + ny * this.spotR * 0.8,
      this.sx - nx * this.spotR, this.sy - ny * this.spotR * 0.8, this.lampX - nx * 2, this.lampY - ny * 2], P.pale, 0.07, 'light');
    g.circle(this.sx, this.sy, this.spotR, P.pale, 0.1, 'light');
    g.circle(this.lampX, this.lampY, 7, P.white, 0.45, 'light');
  }

  draw(g: Gfx): void {
    shadow(g, this.x, this.y + 1, 9);
    g.img('pad_tall', this.broken ? 'tower_broken' : 'tower', this.x, this.y + 4, { fill: this.flash > 0 ? P.white : undefined });
    if (!this.broken && this.nails > 0) {
      for (let i = 0; i < 6; i++) g.rect(this.x - 9 + i * 3, this.y - 56, 2, 2, i < this.nails ? P.amber : P.ink, 0.9, 'top');
    }
  }
}

/** Big fuel tank: like a barrel, but heavier with a much bigger blast and burning fuel. */
export class FuelTank extends Barrel {
  constructor(x: number, y: number) {
    super(x, y);
    this.r = 10; this.hz = 12; this.hr = 10;
    this.mass = 2.2;
    this.hp = 22;
    this.friction = 3;
  }
  explode(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.explode(this.x, this.y - 6, 72, { enemyDmg: 260, poise: 80, armorBreak: 1, playerDmg: 1, from: 'env', src: 'tank' });
    w.fx.shake(7, 0.35);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const [fx, fy] = w.clampToBounds(this.x + Math.cos(a) * 22, this.y + Math.sin(a) * 16, 10);
      w.objects.push(new FirePatch(fx, fy, 10, 3.5, 'env'));
    }
  }
  draw(g: Gfx): void {
    shadow(g, this.x, this.y, 11);
    const flick = this.lit && Math.floor(this.fuse * 20) % 2 === 0;
    g.img('pad_dev', this.lit ? 'tank_lit' : 'tank', this.x, this.y + 5, { fill: this.flash > 0 || flick ? P.white : undefined });
    if (this.lit) {
      // blast radius telegraph matches the explosion
      g.circle(this.x, this.y - 6, 72, COL.danger, 0.08, 'floor');
      g.ring(this.x, this.y - 6, 72, 1, COL.danger, 0.8, 'floor');
      g.circle(this.x, this.y - 14, 16, P.orange, 0.35, 'light');
    }
  }
}

// =====================================================================================
// Per-fight state
// =====================================================================================
export class PadState {
  dead = false;
  heli: Heli;
  console!: PadConsole;
  turrets: Turret[] = [];
  towers: SearchTower[] = [];
  consoleCd = 0;
  /** Seconds spent in a searchlight (decays outside). At 2 s: locked. */
  lockMeter = 0;
  /** Pending lock-on: Kade's next attack tracks. Kade clears it. */
  locked = false;
  wrecks: { x: number; y: number; t: number }[] = [];
  private incoming: { x: number; y: number; t: number }[] = [];
  /** Kade forbids the console during the clearance countdown. */
  consoleLocked = false;

  constructor() { this.heli = new Heli(this); }

  inDowndraft(x: number, y: number): boolean { return this.heli.covers(x, y); }

  /** Console action. Returns true or the refusal text. */
  consoleUse(w: World): true | string {
    const h = this.heli;
    if (this.consoleLocked || h.forced > 0) return '清场中，无法操作';
    if (this.consoleCd > 0) return `冷却 ${Math.ceil(this.consoleCd)}s`;
    if (h.state === 'crash') return '直升机坠毁中';
    if (h.strafing) {
      const b = w.boss;
      const tx = b ? b.x : PAD.pad.x, ty = b ? b.y : PAD.pad.y;
      h.crash(w, tx, ty);
    } else if (h.state === 'hover' || h.state === 'in') {
      h.leave();
      w.fx.label(this.console.x, this.console.y - 30, '直升机离开', COL.interact, 1);
    } else {
      h.callTo(w.player.x, w.player.y);
      w.fx.label(this.console.x, this.console.y - 30, '直升机来了', COL.interact, 1);
    }
    this.consoleCd = CONSOLE_CD;
    return true;
  }

  dropBarrel(w: World, hx: number, hy: number): void {
    const n = w.bodies.filter((b) => b instanceof Barrel && !(b instanceof FuelTank) && !b.dead).length + this.incoming.length;
    if (n >= 2) return;
    for (let i = 0; i < 8; i++) {
      const a = w.rng.next() * Math.PI * 2, r = DOWNDRAFT_R + 16 + w.rng.next() * 40;
      const [x, y] = w.clampToBounds(hx + Math.cos(a) * r, hy + Math.sin(a) * r * 0.8, 24);
      if (w.bodies.some((b) => !b.dead && b.solid && dist(b.x, b.y, x, y) < b.r + 14)) continue;
      this.incoming.push({ x, y, t: 0.8 });
      return;
    }
  }

  update(w: World, dt: number): void {
    if (this.consoleCd > 0) this.consoleCd -= dt;
    this.heli.update(w, dt);
    for (const wr of this.wrecks) wr.t += dt;
    this.wrecks = this.wrecks.filter((wr) => wr.t < 30);
    for (const inc of this.incoming) {
      inc.t -= dt;
      if (inc.t <= 0) { w.add(new Barrel(inc.x, inc.y)); w.fx.smoke(inc.x, inc.y, 5, P.slate, 4, 10); w.sfx('land', 0.6); }
    }
    this.incoming = this.incoming.filter((i) => i.t > 0);
    // searchlight lock-on
    const p = w.player;
    if (!this.locked && w.state === 'fight' && w.boss && !w.boss.dying) {
      const inLight = this.towers.some((t) => t.lit && (p.x - t.sx) ** 2 + ((p.y - t.sy) / 0.8) ** 2 < t.spotR ** 2);
      if (inLight) this.lockMeter += dt;
      else this.lockMeter = Math.max(0, this.lockMeter - dt * 0.7);
      if (this.lockMeter >= 2) {
        this.lockMeter = 0;
        this.locked = true;
        w.fx.label(p.x, p.y - 22, '锁定', COL.danger, 1.1);
        w.sfx('telegraph', 0.8, 1.6);
      }
    }
  }

  draw(g: Gfx, w: World): void {
    for (const wr of this.wrecks) {
      const a = Math.min(1, (30 - wr.t) / 3);
      g.ellipse(wr.x, wr.y, 46, 26, P.ink, 0.55 * a, 'floor');
      g.img('kade_heli', 'wreck', wr.x, wr.y, { layer: 'floor', ox: 0.5, oy: 0.5, alpha: a });
    }
    for (const t of this.towers) t.drawFloor(g, w);
    this.heli.drawFloor(g, w);
    for (const inc of this.incoming) g.ring(inc.x, inc.y, 10 * (inc.t / 0.8) + 4, 1, P.orange, 0.8);
    // lock-on meter around the player
    const p = w.player;
    if (this.lockMeter > 0.05 && !this.locked) {
      const f = this.lockMeter / 2;
      g.sector(p.x, p.y - 9, 13, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2, COL.danger, 0.55, 'top', 11);
    }
  }

  drawTop(g: Gfx, w: World): void {
    for (const t of this.towers) t.drawLight(g);
    this.heli.drawTop(g, w);
  }
}

// =====================================================================================
// Arena
// =====================================================================================
const RAIN = Array.from({ length: 70 }, (_, i) => ({ x: (i * 97.3) % 640, y: (i * 53.7) % 360, s: 0.8 + ((i * 31) % 10) / 20 }));

function setup(w: World): void {
  const pad = new PadState();
  STATES.set(w, pad);
  w.objects.push(pad);
  // side rails with a gap each: replace the full side walls with two segments
  const b = w.bounds, T = 64, G = PAD.gap;
  w.walls = w.walls.filter((r) => !(r.h === b.h && r.y === b.y && (r.x === b.x - T || r.x === b.x + b.w)));
  for (const x of [b.x - T, b.x + b.w]) {
    w.walls.push({ x, y: b.y, w: T, h: G.y0 - b.y });
    w.walls.push({ x, y: G.y1, w: T, h: b.y + b.h - G.y1 });
  }
  pad.console = w.add(new PadConsole(PAD.console[0], PAD.console[1], pad));
  PAD.turrets.forEach(([x, y], i) => pad.turrets.push(w.add(new Turret(x, y, i * 2.2))));
  PAD.towers.forEach(([x, y], i) => pad.towers.push(w.add(new SearchTower(x, y, i))));
  for (const [x, y] of PAD.tanks) w.add(new FuelTank(x, y));
  for (const [x, y] of PAD.barrels) w.add(new Barrel(x, y));
}

/** Fell through a rail gap: 1 heart, winched back to the rail. */
function winch(w: World, left: boolean): void {
  const p = w.player, b = w.bounds;
  p.forced = null;
  p.legs.active = false;
  p.iframes = 0;
  if (p.invuln > 0) { // already hit this moment (bash knockback): no second heart for the fall
    p.x = left ? b.x + 60 : b.x + b.w - 60; p.y = (PAD.gap.y0 + PAD.gap.y1) / 2; p.vx = p.vy = 0;
    p.invuln = Math.max(p.invuln, 1.5);
    return;
  }
  const gy = (PAD.gap.y0 + PAD.gap.y1) / 2;
  const x = left ? b.x + 60 : b.x + b.w - 60;
  w.fx.label(p.x, p.y - 20, '坠落', COL.danger, 0.8);
  w.hitPlayer(1, { kind: 'fall', x: p.x, y: p.y });
  p.x = x; p.y = gy; p.vx = p.vy = 0;
  p.invuln = Math.max(p.invuln, 1.5);
  w.fx.label(x, gy - 24, '绞盘拉回', P.fog, 1);
  w.fx.burst(x, gy - 9, 8, P.pale, 60, 0.3, 1);
  w.sfx('grapple');
}

export const helipad: Arena = {
  id: 'helipad',
  bg: 'bg_helipad',
  bounds: PAD.bounds,
  playerSpawn: PAD.playerSpawn,
  setup,
  update(w: World) {
    const b = w.bounds, p = w.player;
    if (w.state === 'fight' && p.hp > 0 && !p.airborne) {
      if (p.x < b.x - 4) winch(w, true);
      else if (p.x > b.x + b.w + 4) winch(w, false);
    }
    // props through the gaps are gone
    for (const o of w.bodies) {
      if (o.dead || o.mass <= 0 || o.team !== 'neutral') continue;
      if (o.x < b.x - 6 || o.x > b.x + b.w + 6) {
        o.dead = true;
        w.fx.label(o.x, o.y - 20, '掉下去了', P.fog, 0.8);
        w.sfx('crash', 0.3, 0.6);
        if (p.held === o) p.held = null;
      }
    }
  },
  drawFloor(g: Gfx, w: World) {
    // city glow below the roof edges
    for (const [x, y, c] of [[20, 120, P.magenta], [20, 280, P.cyan], [620, 110, P.cyan], [620, 270, P.magenta], [200, 350, P.sodium], [460, 352, P.magenta]] as [number, number, number][]) {
      g.circle(x, y, 46, c, 0.05 + 0.015 * Math.sin(w.realTime * 1.3 + x), 'light');
    }
    // H marking edge lights
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const on = Math.floor(w.realTime * 2 + i) % 12 === 0;
      g.circle(PAD.pad.x + Math.cos(a) * 82, PAD.pad.y + Math.sin(a) * 58, on ? 6 : 3, P.amber, on ? 0.45 : 0.16, 'light');
    }
    // red warning beacons at the rail gaps
    const blink = Math.floor(w.realTime * 2) % 2 === 0;
    for (const x of [w.bounds.x, w.bounds.x + w.bounds.w]) for (const y of [PAD.gap.y0, PAD.gap.y1]) g.circle(x, y, 5, P.red, blink ? 0.5 : 0.15, 'light');
  },
  drawTop(g: Gfx, w: World) {
    // rain (screen space streaks); the downdraft bends nearby drops outward
    const pad = padOf(w);
    const t = w.realTime;
    for (const d of RAIN) {
      const x = (d.x + t * 40 * d.s) % 640, y = (d.y + t * 260 * d.s) % 360;
      let dx = 2, dy = 7;
      if (pad && pad.heli.k > 0 && dist(x, y, pad.heli.hx, pad.heli.hy) < DOWNDRAFT_R + 20) {
        const [nx, ny] = norm(x - pad.heli.hx, y - pad.heli.hy);
        dx = nx * 7; dy = ny * 7;
      }
      g.line(x, y, x + dx, y + dy, 1, P.fog, 0.25, 'top');
    }
  },
};
