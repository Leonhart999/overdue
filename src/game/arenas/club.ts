/**
 * Neon Bazaar club stage (Madame Lux). Interactables:
 *   - breaker boxes (2, top corners): E / hits / arc / EMP / hack -> 5 s blackout. Clones vanish,
 *     the dance floor stops, Lux takes x1.5. Shared 20 s cooldown.
 *   - holo-projectors (4): each one sustains one clone. Hits, arc, EMP, hack, E or cutting the
 *     power cable (blade) take it offline for 15 s and pop its clone.
 *   - mirror pillars (3): E / shotgun / blade / hack / nail recall rotate them 45 deg. Lux's laser
 *     reflects off the mirror plane (see `traceBeam`).
 *   - dance floor (8x5): lights on the 120 BPM beat; 2 beats warning, 1 beat active, ground attack.
 *   - spotlights (2): the real Lux casts a shadow inside them; the player deals +25% while lit.
 * The stage is a world object (`ClubStage`) so the boss can find it through `w.objects`.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { clamp, dist, rayCircle } from '../../engine/math';
import { Body } from '../body';
import { Hazard } from '../hazard';
import type { Cable, Hit } from '../types';
import type { Arena, World } from '../world';

/** Seconds per beat (120 BPM). */
export const BEAT = 0.5;
export const FLOOR = { x: 192, y: 132, cols: 8, rows: 5, cw: 32, ch: 24 };
export const STAGE_CENTRE = { x: 320, y: 192 };
/** Laser marks: every mark lines up (0/45/90 deg) with at least two mirrors. */
export const MARKS: [number, number][] = [[140, 100], [320, 100], [500, 100]];
export const MIRROR_POS: [number, number][] = [[140, 280], [320, 280], [500, 280]];
export const PROJECTOR_POS: [number, number][] = [[220, 64], [420, 64], [104, 322], [536, 322]];
export const BREAKER_POS: [number, number][] = [[38, 60], [602, 60]];
/** Neon signs baked into the background; they stay lit during a blackout. */
export const NEON: { x: number; y: number; r: number; c: number }[] = [
  { x: 120, y: 38, r: 34, c: P.magenta },
  { x: 320, y: 36, r: 44, c: P.rose },
  { x: 520, y: 38, r: 34, c: P.cyan },
  { x: 8, y: 196, r: 30, c: P.cyan },
  { x: 632, y: 196, r: 30, c: P.magenta },
];

export type FloorMode = 'off' | 'light' | 'full' | 'encore';
export type PopReason = 'hit' | 'projector' | 'blackout' | 'beam' | 'end';

/** A clone sustained by a projector (implemented by the boss). */
export interface Hologram {
  dead: boolean;
  pop(w: World, why: PopReason): void;
  readonly hx: number;
  readonly hy: number;
}

/** Boss-side reactions the stage triggers. */
export interface StageListener {
  onBlackout(w: World): void;
}

export function findStage(w: World): ClubStage | null {
  for (const o of w.objects) if (o instanceof ClubStage) return o;
  return null;
}

// ------------------------------------------------------------------ devices
/** Breaker box on the wall. Any player interaction trips a blackout (if the stage allows). */
export class Breaker extends Body {
  private acc = 0;
  private shock = 0;
  constructor(x: number, y: number, private stage: ClubStage) {
    super();
    this.x = x; this.y = y;
    this.r = 8; this.hz = 12; this.hr = 9;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.conductive = true;
    this.hackable = true;
    this.interactable = true;
    this.targetable = false;
    this.interactLabel = '拉闸断电';
  }
  update(_w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    this.acc = Math.max(0, this.acc - dt);
    this.shock = Math.max(0, this.shock - dt * 0.5);
  }
  hurt(w: World, h: Hit): number {
    if (h.from !== 'player') return 0;
    if (!h.quiet) this.flash = 0.05;
    this.acc += Math.min(3, Math.max(1, h.dmg));
    if (this.acc >= 3) { this.acc = 0; this.stage.trip(w, this); }
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    this.shock += dt;
    if (this.shock > 0.4) { this.shock = 0; this.stage.trip(w, this); }
  }
  onEmp(w: World): void { this.stage.trip(w, this); }
  onHack(w: World): void { this.stage.trip(w, this); }
  onInteract(w: World): void {
    if (this.stage.trip(w, this)) w.sfx('lever');
    else w.sfx('click');
  }
  draw(g: Gfx, w: World): void {
    const ready = this.stage.breakerCd <= 0 && this.stage.blackoutT <= 0;
    g.img('lux_dev', ready ? 'breaker_on' : 'breaker_off', this.x, this.y + 10, { fill: this.flash > 0 ? P.white : undefined });
    const pulse = 0.25 + 0.15 * Math.sin(w.realTime * 5);
    if (ready) g.circle(this.x, this.y - 14, 12, COL.interact, pulse * 0.6, 'light');
    else g.circle(this.x + 4, this.y - 20, 4, P.red, 0.4, 'light');
  }
}

/** Holo-projector: sustains one clone. Offline for 15 s when broken, shorted, hacked or unplugged. */
export class Projector extends Body {
  offT = 0;
  /** Delay before this projector can (re)build a clone. */
  respawnT = 1.4;
  link: Hologram | null = null;
  private acc = 0;
  private shock = 0;
  private cable: Cable | null = null;
  constructor(x: number, y: number, private stage: ClubStage) {
    super();
    this.x = x; this.y = y;
    this.r = 7; this.hz = 14; this.hr = 8;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.conductive = true;
    this.hackable = true;
    this.interactable = true;
    this.targetable = false;
    this.interactLabel = '拔掉投影仪';
  }
  get lensX(): number { return this.x; }
  get lensY(): number { return this.y - 18; }
  get working(): boolean { return this.offT <= 0 && this.stage.blackoutT <= 0; }
  /** Free to build a clone right now. */
  get ready(): boolean { return this.working && !this.link && this.respawnT <= 0; }

  plugCable(w: World): void {
    if (this.cable) return;
    const side = this.x < 320 ? -1 : 1;
    const c: Cable = {
      x1: this.x + side * 5, y1: this.y - 2, x2: this.x + side * 26, y2: this.y + (this.y < 200 ? -6 : 6),
      onCut: () => { this.cable = null; this.disable(w); },
    };
    this.cable = c;
    w.cables.push(c);
  }

  update(w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    this.acc = Math.max(0, this.acc - dt * 1.5);
    this.shock = Math.max(0, this.shock - dt * 0.5);
    if (this.offT > 0) {
      this.offT -= dt;
      if (w.rng.chance(dt * 4)) w.fx.sparks(this.lensX, this.lensY, 1, P.ice, 50);
      if (this.offT <= 0) { this.plugCable(w); this.respawnT = Math.max(this.respawnT, 1); w.sfx('click', 0.5); }
    }
    if (this.link?.dead) this.link = null;
    if (!this.link && this.working && this.respawnT > 0) this.respawnT -= dt;
  }
  hurt(w: World, h: Hit): number {
    if (h.from !== 'player' || this.offT > 0) return 0;
    if (!h.quiet) { this.flash = 0.05; w.fx.sparks(h.x, h.y, 2, P.ice, 60); }
    this.acc += Math.min(6, Math.max(1, h.dmg));
    if (this.acc >= 6) this.disable(w);
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    this.shock += dt;
    if (this.shock > 0.5) this.disable(w);
  }
  onEmp(w: World): void { this.disable(w); }
  onHack(w: World): void { this.disable(w); }
  onInteract(w: World): void { if (this.offT <= 0) { this.disable(w); w.sfx('lever'); } }

  disable(w: World): void {
    if (this.offT > 0) return;
    this.offT = 15;
    this.acc = this.shock = 0;
    if (this.cable) { this.cable.dead = true; this.cable = null; }
    const l = this.link;
    this.link = null;
    l?.pop(w, 'projector');
    w.fx.sparks(this.lensX, this.lensY, 10, P.ice, 120);
    w.fx.label(this.x, this.y - 34, '投影仪离线 15s', P.ice, 1);
    w.sfx('zap');
  }

  draw(g: Gfx, w: World): void {
    const on = this.offT <= 0 && this.stage.blackoutT <= 0;
    g.img('lux_dev', on ? 'projector_on' : 'projector_off', this.x, this.y + 10, { fill: this.flash > 0 ? P.white : undefined });
    if (on) {
      g.circle(this.lensX, this.lensY, this.link ? 9 : 5, P.cyan, this.link ? 0.4 : 0.2, 'light');
      const l = this.link;
      if (l && !l.dead) {
        // faint projection beam to its clone
        const a = 0.1 + 0.05 * Math.sin(w.realTime * 9 + this.x);
        g.line(this.lensX, this.lensY, l.hx, l.hy, 3, P.cyan, a * 0.6, 'light');
        g.line(this.lensX, this.lensY, l.hx, l.hy, 1, P.ice, a, 'top');
        const t = (w.realTime * 1.4 + this.x * 0.01) % 1;
        g.circle(this.lensX + (l.hx - this.lensX) * t, this.lensY + (l.hy - this.lensY) * t, 1.5, P.ice, 0.6, 'top');
      }
    } else if (this.offT > 0) {
      g.text(`${Math.ceil(this.offT)}`, this.x, this.y - 40, { layer: 'top', color: P.fog, align: 'center', alpha: 0.7 });
    }
  }
}

/** Mirror pillar. The mirror plane has 4 orientations (k * 45 deg); the pillar is solid cover. */
export class Mirror extends Body {
  k: number;
  private rotCd = 0;
  private spinT = 0;
  private lastNails = 0;
  constructor(x: number, y: number, k: number) {
    super();
    this.x = x; this.y = y; this.k = k;
    this.r = 9; this.hz = 16; this.hr = 10;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.hackable = true;
    this.interactable = true;
    this.targetable = false;
    this.interactLabel = '旋转镜子';
  }
  /** Half length of the mirror plane (ground units). */
  static readonly HALF = 13;
  /** Mirror plane endpoints on the ground. */
  seg(): [number, number, number, number] {
    const a = (this.k * Math.PI) / 4, c = Math.cos(a) * Mirror.HALF, s = Math.sin(a) * Mirror.HALF;
    return [this.x - c, this.y - s, this.x + c, this.y + s];
  }
  normal(): [number, number] {
    const a = (this.k * Math.PI) / 4;
    return [-Math.sin(a), Math.cos(a)];
  }
  rotate(w: World): void {
    this.k = (this.k + 1) % 4;
    this.spinT = 0.15;
    this.rotCd = 0.3;
    w.sfx('click', 0.8, 1.4);
    w.fx.sparks(this.x, this.y - 20, 4, P.ice, 60);
  }
  update(w: World, dt: number): void {
    if (this.rotCd > 0) this.rotCd -= dt;
    if (this.spinT > 0) this.spinT -= dt;
    if (this.flash > 0) this.flash -= dt;
    // riveter: recalling nails stuck in the mirror yanks it round
    if (this.nails < this.lastNails) this.rotate(w);
    this.lastNails = this.nails;
  }
  hurt(w: World, h: Hit): number {
    if (h.from !== 'player') return 0;
    if (!h.quiet) this.flash = 0.04;
    if ((h.src === 'pellet' || h.src === 'slug' || h.src === 'blade' || h.src === 'shove' || h.src === 'fist') && this.rotCd <= 0) this.rotate(w);
    return 0;
  }
  onHack(w: World): void { this.rotate(w); }
  onInteract(w: World): void { this.rotate(w); }
  draw(g: Gfx, w: World): void {
    g.ellipse(this.x, this.y, 11, 4, P.ink, 0.45, 'floor');
    const k = this.spinT > 0 ? (this.k + 3) % 4 : this.k;
    g.img('lux_dev', `mirror_${k}`, this.x, this.y + 10, { fill: this.flash > 0 ? P.white : undefined });
    // orientation marker on the floor (amber = interactive)
    const [x1, y1, x2, y2] = this.seg();
    g.line(x1, y1, x2, y2, 1, COL.interact, 0.35 + 0.1 * Math.sin(w.realTime * 4), 'floor');
  }
}

// ------------------------------------------------------------------ beam tracing
function raySeg(ox: number, oy: number, dx: number, dy: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax, ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const rx = ax - ox, ry = ay - oy;
  const t = (rx * ey - ry * ex) / den;
  const u = (rx * dy - ry * dx) / den;
  return t > 1e-3 && u >= 0 && u <= 1 ? t : Infinity;
}

export interface BeamPath {
  /** Ground points: origin, then every reflection, then the end on a wall. */
  pts: [number, number][];
  mirrors: Mirror[];
}

/** Trace a beam on the ground plane, reflecting off mirror planes (up to `bounces`). */
export function traceBeam(w: World, mirrors: Mirror[], x: number, y: number, a: number, bounces = 4): BeamPath {
  let ox = x, oy = y, dx = Math.cos(a), dy = Math.sin(a);
  const pts: [number, number][] = [[ox, oy]];
  const hits: Mirror[] = [];
  let last: Mirror | null = null;
  for (let i = 0; i <= bounces; i++) {
    let t = w.rayWall(ox, oy, dx, dy, 1000), hit: Mirror | null = null;
    for (const m of mirrors) {
      if (m === last || m.dead) continue;
      const [ax, ay, bx, by] = m.seg();
      const tt = raySeg(ox, oy, dx, dy, ax, ay, bx, by);
      if (tt < t) { t = tt; hit = m; }
    }
    // a mirror column hit edge-on (parallel to its face) is solid: the beam stops on it
    for (const m of mirrors) {
      if (m === last || m === hit || m.dead) continue;
      const tc = rayCircle(ox, oy, dx, dy, m.x, m.y, m.r * 0.7);
      if (tc > 1e-3 && tc < t) { t = tc; hit = null; }
    }
    ox += dx * t; oy += dy * t;
    pts.push([ox, oy]);
    if (!hit || i === bounces) break;
    const [nx, ny] = hit.normal();
    const d = dx * nx + dy * ny;
    dx -= 2 * d * nx; dy -= 2 * d * ny;
    hits.push(hit);
    last = hit;
  }
  return { pts, mirrors: hits };
}

// ------------------------------------------------------------------ the stage
interface Spot { x: number; y: number; r: number; t: number; fx: number; fy: number; px: number; py: number; freeze: number; flare: number }

interface FloorCell { h: Hazard; c: number; r: number }

export class ClubStage {
  dead = false;
  blackoutT = 0;
  private blackFade = 0;
  breakerCd = 0;
  floorMode: FloorMode = 'off';
  private beatClock = 0;
  beat = 0;
  readonly spots: Spot[] = [
    { x: 0, y: 0, r: 30, t: 0, fx: 0.23, fy: 0.31, px: 0, py: 1, freeze: 0, flare: 0 },
    { x: 0, y: 0, r: 30, t: 0, fx: 0.19, fy: 0.27, px: 2.6, py: 0.3, freeze: 0, flare: 0 },
  ];
  readonly mirrors: Mirror[] = [];
  readonly projectors: Projector[] = [];
  readonly breakers: Breaker[] = [];
  private floor: FloorCell[] = [];
  listener: StageListener | null = null;
  /** Extra darkness holes for this frame (the boss adds its laser, etc.). Cleared after drawing. */
  readonly holes: { x: number; y: number; r: number }[] = [];
  private wavePlan: number[] = [];

  constructor() { this.moveSpots(0); }

  get dark(): boolean { return this.blackoutT > 0; }

  /** Spotlight containing a ground point (null during blackouts). */
  inLight(x: number, y: number): Spot | null {
    if (this.blackoutT > 0) return null;
    for (const s of this.spots) if ((x - s.x) ** 2 + (y - s.y) ** 2 <= s.r * s.r) return s;
    return null;
  }

  /** Start a blackout. Returns false while on cooldown. */
  trip(w: World, from?: Body): boolean {
    if (this.blackoutT > 0) return false;
    if (this.breakerCd > 0) {
      const b = from ?? this.breakers[0];
      if (b) w.fx.label(b.x, b.y - 30, `冷却 ${Math.ceil(this.breakerCd)}s`, P.fog, 0.8);
      return false;
    }
    if (w.boss && (w.boss.dying || w.boss.defeated)) return false;
    this.blackoutT = 5;
    this.breakerCd = 20;
    this.stopFloor();
    for (const p of this.projectors) { const l = p.link; p.link = null; l?.pop(w, 'blackout'); p.respawnT = Math.max(p.respawnT, 1.2); }
    w.sfx('emp');
    w.sfx('crash', 0.5);
    w.fx.shake(3, 0.2);
    const b = from ?? this.breakers[0];
    if (b) w.fx.sparks(b.x, b.y - 14, 14, P.amber, 140);
    w.fx.label(320, 120, '断电 · 伤害 ×1.5', P.amber, 1.4);
    this.listener?.onBlackout(w);
    return true;
  }

  stopFloor(): void {
    for (const f of this.floor) f.h.dead = true;
    this.floor = [];
    this.wavePlan = [];
  }

  private moveSpots(dt: number): void {
    for (const s of this.spots) {
      if (s.freeze > 0) { s.freeze -= dt; continue; }
      s.t += dt;
      s.x = STAGE_CENTRE.x + 220 * Math.sin(s.fx * s.t + s.px);
      s.y = STAGE_CENTRE.y + 92 * Math.sin(s.fy * s.t + s.py);
    }
  }

  update(w: World, dt: number): void {
    if (this.breakerCd > 0) this.breakerCd -= dt;
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      this.blackFade = Math.min(1, this.blackFade + dt * 8);
      if (this.blackoutT <= 0) { w.sfx('click'); w.fx.flash(P.white, 0.15, 0.1); }
    } else this.blackFade = Math.max(0, this.blackFade - dt * 2.5);
    for (const s of this.spots) if (s.flare > 0) s.flare -= dt;
    this.moveSpots(dt);
    this.floor = this.floor.filter((f) => !f.h.dead);
    // beat clock
    this.beatClock += dt;
    while (this.beatClock >= BEAT) {
      this.beatClock -= BEAT;
      this.beat++;
      this.onBeat(w);
    }
  }

  // ------------------------------------------------------------------ dance floor
  private lightCells(w: World, cells: [number, number][]): void {
    for (const [c, r] of cells) {
      if (c < 0 || r < 0 || c >= FLOOR.cols || r >= FLOOR.rows) continue;
      if (this.floor.some((f) => f.c === c && f.r === r)) continue;
      const x = FLOOR.x + c * FLOOR.cw, y = FLOOR.y + r * FLOOR.ch;
      const h = new Hazard({ k: 'rect', x: x + 2, y: y + 2, w: FLOOR.cw - 4, h: FLOOR.ch - 4 }, 2 * BEAT, BEAT);
      h.low = true;
      h.visible = false;
      h.owner = this;
      w.addHazard(h);
      this.floor.push({ h, c, r });
    }
  }

  private cellOf(x: number, y: number): [number, number] | null {
    const c = Math.floor((x - FLOOR.x) / FLOOR.cw), r = Math.floor((y - FLOOR.y) / FLOOR.ch);
    return c >= 0 && r >= 0 && c < FLOOR.cols && r < FLOOR.rows ? [c, r] : null;
  }

  private all(fn: (c: number, r: number) => boolean): [number, number][] {
    const out: [number, number][] = [];
    for (let r = 0; r < FLOOR.rows; r++) for (let c = 0; c < FLOOR.cols; c++) if (fn(c, r)) out.push([c, r]);
    return out;
  }

  private onBeat(w: World): void {
    if (this.blackoutT > 0 || this.floorMode === 'off' || w.state !== 'fight') return;
    if (this.beat % 4 === 0) w.sfx('beat', 0.6);
    // queued wave rows
    if (this.wavePlan.length) {
      const r = this.wavePlan.shift()!;
      this.lightCells(w, this.all((_c, rr) => rr === r));
      return;
    }
    const rng = w.rng;
    const p = w.player;
    if (this.floorMode === 'encore') {
      if (this.beat % 8 === 0) this.lightCells(w, this.all((c, r) => (c + r) % 2 === 0 && !(c >= 3 && c <= 4 && r === 2)));
      if (this.beat % 8 === 4) this.lightCells(w, this.all((c, r) => (c + r) % 2 === 1));
      return;
    }
    const every = this.floorMode === 'light' ? 8 : 4;
    if (this.beat % every !== 0) return;
    const pc = this.cellOf(p.x, p.y);
    if (this.floorMode === 'light') {
      const pick = rng.int(0, 2);
      if (pick === 0 && pc) this.lightCells(w, this.all((c, r) => Math.abs(c - pc[0]) <= 1 && Math.abs(r - pc[1]) <= 1));
      else if (pick === 1) { const r = rng.int(0, FLOOR.rows - 1); this.lightCells(w, this.all((_c, rr) => rr === r)); }
      else { const c = rng.int(0, FLOOR.cols - 2); this.lightCells(w, this.all((cc) => cc === c || cc === c + 1)); }
      return;
    }
    // full
    const pick = rng.int(0, 6);
    switch (pick) {
      case 0: { const par = rng.int(0, 1); this.lightCells(w, this.all((c, r) => (c + r) % 2 === par)); break; }
      case 1: this.lightCells(w, this.all((c, r) => c === 0 || r === 0 || c === FLOOR.cols - 1 || r === FLOOR.rows - 1)); break;
      case 2: this.lightCells(w, this.all((c, r) => c >= 2 && c <= 5 && r >= 1 && r <= 3)); break;
      case 3: { const k = rng.int(0, 2); this.lightCells(w, this.all((c, r) => (c + r) % 3 === k)); break; }
      case 4: {
        const down = rng.chance(0.5);
        this.wavePlan = down ? [1, 2, 3, 4] : [3, 2, 1, 0];
        this.lightCells(w, this.all((_c, r) => r === (down ? 0 : FLOOR.rows - 1)));
        break;
      }
      case 5: if (pc) this.lightCells(w, this.all((c, r) => c === pc[0] || r === pc[1])); else this.lightCells(w, this.all((c) => c === 3 || c === 4)); break;
      default: { const c = rng.int(0, FLOOR.cols - 3); this.lightCells(w, this.all((cc) => cc >= c && cc <= c + 2)); }
    }
  }

  // ------------------------------------------------------------------ drawing
  drawFloor(g: Gfx, w: World): void {
    const dark = this.blackoutT > 0;
    const pulse = 1 - (this.beatClock / BEAT);
    // idle dance floor glow
    if (!dark && this.floorMode !== 'off') {
      for (let r = 0; r < FLOOR.rows; r++) for (let c = 0; c < FLOOR.cols; c++) {
        const x = FLOOR.x + c * FLOOR.cw, y = FLOOR.y + r * FLOOR.ch;
        const on = (c + r + this.beat) % 4 === 0;
        g.rect(x + 2, y + 2, FLOOR.cw - 4, FLOOR.ch - 4, (c + r) % 2 ? P.cyan : P.magenta, on ? 0.08 + 0.08 * pulse : 0.035);
      }
    }
    for (const f of this.floor) {
      const x = FLOOR.x + f.c * FLOOR.cw, y = FLOOR.y + f.r * FLOOR.ch;
      const h = f.h;
      if (h.warning) {
        const second = h.t >= BEAT;
        const blink = Math.floor(h.t * 8) % 2 === 0;
        g.rect(x + 2, y + 2, FLOOR.cw - 4, FLOOR.ch - 4, P.red, (second ? 0.32 : 0.16) + (blink ? 0.08 : 0));
        g.strokeRect(x + 2, y + 2, FLOOR.cw - 4, FLOOR.ch - 4, 1, second ? P.rose : P.red, 0.8);
      } else {
        g.rect(x + 2, y + 2, FLOOR.cw - 4, FLOOR.ch - 4, P.rose, 0.7);
        g.rect(x + 6, y + 5, FLOOR.cw - 12, FLOOR.ch - 10, P.white, 0.5);
        g.circle(x + FLOOR.cw / 2, y + FLOOR.ch / 2, 18, P.magenta, 0.18, 'light');
      }
    }
    // laser marks pulse on the stage
    for (const [mx, my] of MARKS) g.ring(mx, my, 7 + pulse * 2, 1, P.sodium, dark ? 0.15 : 0.35);
    // spotlights on the floor
    if (!dark) {
      for (const s of this.spots) {
        const flare = s.flare > 0;
        g.circle(s.x, s.y, s.r, flare ? P.red : P.amber, flare ? 0.2 : 0.1);
        g.ring(s.x, s.y, s.r, 1, flare ? P.red : P.amber, 0.35);
      }
    }
    // the player is lit: small ring at the feet
    const p = w.player;
    if (this.inLight(p.x, p.y)) g.ring(p.x, p.y, 8, 1, P.amber, 0.7);
  }

  draw(_g: Gfx, _w: World): void {}

  drawTop(g: Gfx, w: World): void {
    if (this.blackoutT <= 0) {
      // light cones from the rig above the stage
      for (const s of this.spots) {
        const lx = s.x * 0.6 + 128, ly = 30;
        g.poly([lx - 4, ly, lx + 4, ly, s.x + s.r, s.y, s.x - s.r, s.y], s.flare > 0 ? P.red : P.amber, 0.05, 'light');
        g.circle(s.x, s.y - 6, s.r, P.amber, 0.08, 'light');
      }
    }
    for (const n of NEON) g.circle(n.x, n.y, n.r * 0.7, n.c, 0.1 + 0.03 * Math.sin(w.realTime * 3 + n.x), 'light');
    if (this.blackFade > 0) {
      const p = w.player;
      const holes = [{ x: p.x, y: p.y - 10, r: 74 }, ...NEON.map((n) => ({ x: n.x, y: n.y, r: n.r * 1.6 })), ...this.holes];
      for (const b of this.breakers) holes.push({ x: b.x, y: b.y - 12, r: 26 });
      for (const e of w.bullets) if (e.team === 'enemy') holes.push({ x: e.x, y: e.y, r: 16 });
      for (const h of w.hazards) {
        if (!h.visible || h.team === 'player') continue;
        const s = h.shape;
        if (s.k === 'circle') holes.push({ x: s.x, y: s.y, r: s.r + 14 });
        else if (s.k === 'line') {
          const n = Math.max(1, Math.ceil(dist(s.x1, s.y1, s.x2, s.y2) / 18));
          for (let i = 0; i <= n; i++) holes.push({ x: s.x1 + ((s.x2 - s.x1) * i) / n, y: s.y1 + ((s.y2 - s.y1) * i) / n, r: 22 });
        }
      }
      g.darkness(0.8 * clamp(this.blackFade, 0, 1), holes);
    }
    this.holes.length = 0;
  }
}

export const club: Arena = {
  id: 'club',
  bg: 'bg_club',
  bounds: { x: 16, y: 48, w: 608, h: 288 },
  playerSpawn: { x: 252, y: 318 },
  setup(w: World) {
    const st = new ClubStage();
    w.objects.push(st);
    for (const [x, y] of BREAKER_POS) st.breakers.push(w.add(new Breaker(x, y, st)));
    for (const [x, y] of PROJECTOR_POS) { const p = w.add(new Projector(x, y, st)); p.plugCable(w); st.projectors.push(p); }
    MIRROR_POS.forEach(([x, y], i) => st.mirrors.push(w.add(new Mirror(x, y, [1, 0, 3][i]))));
  },
  drawFloor(g: Gfx, w: World) {
    findStage(w)?.drawFloor(g, w);
  },
};
