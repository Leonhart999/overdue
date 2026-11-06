/**
 * Neon Bazaar club (Madame Lux). A scrolling map two screens wide (1280x360, 80x23 tiles) in
 * three zones, left to right. Each zone powers a different part of her act:
 *   West   吧台区 (x 16-400): the bar counter is low cover (blocks walking and her soft bullets,
 *          not lasers; leap legs jump it; bottles on it shatter). Two booths cut 3 tiles into the
 *          back wall hold one holo-projector each. Breaker box on the wall behind the bar.
 *   Centre 舞池 (x 400-880): the stage strip along the top (laser marks, where Lux floats), the DJ
 *          console below it and the turntable dance floor with the three mirrors on its rim.
 *   East   VIP 区 (x 880-1264): a glass partition with two doorways (a wall for bodies and bullets;
 *          her laser passes it head-on and reflects off it at a slant), couches (low cover), two
 *          projectors and the second breaker box.
 * Interactables:
 *   - breakers (2, opposite ends): E / hits / arc / EMP / hack -> 5 s blackout of the whole club.
 *     Clones vanish, the dance floor and the turntable stop, Lux takes x1.5. Shared 20 s cooldown.
 *   - holo-projectors (4): each one sustains one clone floating in its own zone. Hits, arc, EMP,
 *     hack, E or cutting the power cable (blade) take it offline for 15 s and pop its clone.
 *     The boss switches them on per phase (`Projector.active`).
 *   - turntable (r 96, 3 rings x 8 sectors): cells light on the 120 BPM beat; 2 beats warning,
 *     1 beat live, ground attack. Rotation speed is set by the boss (P1 still, P2 20, P3 40 deg/s);
 *     it carries whatever stands on it. For her laser it locks on a multiple of 45 deg so mirror
 *     reflections stay on the 8 directions (`Turntable.holds`).
 *   - mirrors (3, on the turntable rim): E / shotgun / blade / hack / nail recall turn them 45 deg
 *     relative to the platform. Her laser reflects off the mirror plane (see `traceBeam`).
 *   - DJ console: E / hack -> the turntable runs reversed for 6 s (still turntable: spins), 12 s cooldown.
 *   - spotlights (2): roam with the player; the real Lux casts a shadow inside them; the player
 *     deals +25% while lit.
 * The stage is a world object (`ClubStage`) so the boss can find it through `w.objects`.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { clamp, dist, rayCircle, rayRect, type Rect } from '../../engine/math';
import { borderOf, maskWalls, type TileMask } from '../arenaMask';
import { Body } from '../body';
import { Hazard } from '../hazard';
import type { Cable, Hit } from '../types';
import type { Arena, World } from '../world';

/** Seconds per beat (120 BPM). */
export const BEAT = 0.5;
export const MAP = { w: 1280, h: 360 };
export const CLUB_BOUNDS: Rect = { x: 16, y: 48, w: 1248, h: 288 };

// ------------------------------------------------------------------ layout
export type ZoneId = 'west' | 'centre' | 'vip';
export const WEST_END = 400;
export const VIP_START = 880;
export function zoneOf(x: number): ZoneId { return x < WEST_END ? 'west' : x < VIP_START ? 'centre' : 'vip'; }
/** Where figures float in each zone (ground points). */
export const FLOAT: Record<ZoneId, Rect> = {
  west: { x: 40, y: 116, w: 340, h: 200 },
  centre: { x: 424, y: 90, w: 432, h: 214 },
  vip: { x: 908, y: 80, w: 330, h: 236 },
};

/** Booth openings in the west back wall: tile columns (inclusive), 3 tiles deep (rows 3-5). */
export const BOOTH_COLS: [number, number][] = [[5, 9], [15, 19]];
/** The west back wall comes 3 tiles further down than elsewhere (rows 3-5, columns 1-24). */
export const WEST_WALL = { c0: 1, c1: 24, r0: 3, r1: 5 };
const border = borderOf(80, 23);
export const clubMask: TileMask = (c, r) => {
  if (border(c, r)) return true;
  if (r >= WEST_WALL.r0 && r <= WEST_WALL.r1 && c >= WEST_WALL.c0 && c <= WEST_WALL.c1) return !BOOTH_COLS.some(([a, b]) => c >= a && c <= b);
  return false;
};

/** Low cover: `x, y, w, h` is the footprint on the ground, `top` the drawn height above it. */
export interface LowCover { x: number; y: number; w: number; h: number; top: number }
export const COUNTER: LowCover = { x: 64, y: 144, w: 272, h: 12, top: 12 };
export const COUCHES: LowCover[] = [
  { x: 936, y: 150, w: 72, h: 10, top: 10 },
  { x: 1152, y: 150, w: 72, h: 10, top: 10 },
  { x: 1036, y: 262, w: 88, h: 10, top: 10 },
];
/** Glass partition between the dance floor and the VIP area: x range and the two doorways (y). */
export const GLASS = { x: 878, w: 6, doors: [[112, 160], [232, 280]] as [number, number][] };
/** The mirror plane of the glass (centre line). */
export const GLASS_X = GLASS.x + GLASS.w / 2;
/** A laser closer than 22.5 deg to the glass normal goes through; anything flatter reflects. */
export const GLASS_PASS_COS = Math.cos(Math.PI / 8);
export const STAGE_STRIP = { x: 408, y: 56, w: 464, h: 52 };
export const TABLE = { x: 640, y: 220, r: 96, rings: [0, 32, 64, 96], sectors: 8 };
/** Mirrors on the turntable rim: radius and mount angles (in 45-degree steps: N, SE, SW). */
export const MIRROR_RING = 80;
export const MIRROR_SLOTS = [-2, 1, 3];
export const MIRROR_K0 = [1, 0, 3];
/** Laser marks on the stage strip. */
export const MARKS: [number, number][] = [[424, 96], [584, 96], [640, 96], [696, 96], [856, 96]];
export const ENCORE_POS = { x: TABLE.x, y: TABLE.y };
export const DJ_POS = { x: 548, y: 122 };
/** Projectors: two in the west booths, two in the VIP area. */
export const PROJECTOR_POS: [number, number, ZoneId][] = [[120, 74, 'west'], [280, 74, 'west'], [1010, 62, 'vip'], [1190, 322, 'vip']];
/** West breaker on the wall behind the bar, east breaker in the VIP corner. */
export const BREAKER_POS: [number, number][] = [[200, 110], [1240, 66]];
/** Neon signs baked into the background; they stay lit during a blackout. */
export const NEON: { x: number; y: number; r: number; c: number }[] = [
  { x: 200, y: 64, r: 30, c: P.cyan },
  { x: 470, y: 38, r: 30, c: P.magenta },
  { x: 640, y: 36, r: 44, c: P.rose },
  { x: 810, y: 38, r: 30, c: P.magenta },
  { x: 1072, y: 36, r: 40, c: P.cyan },
  { x: 8, y: 220, r: 30, c: P.cyan },
  { x: 1272, y: 220, r: 30, c: P.magenta },
];
/** Bottles on the counter (x, colour). */
export const BOTTLES: [number, number][] = Array.from({ length: 14 }, (_, i) => [74 + i * 19 + ((i * 7) % 5), [P.teal, P.lime, P.maroon, P.amber, P.orchid][(i * 3) % 5]]);

const DEG = Math.PI / 180;
const Q = Math.PI / 4;
/** P1 DJ spin speed (rad/s) when the turntable is otherwise still. */
const DJ_SPIN = 20 * DEG;
/** The turntable reaches the next 45-degree lock at least this fast (rad/s). */
const SNAP_SPEED = 90 * DEG;

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

/** Push a ground circle out of a rect. */
function pushOut(o: { x: number; y: number; r: number }, c: Rect): boolean {
  const cx = clamp(o.x, c.x, c.x + c.w), cy = clamp(o.y, c.y, c.y + c.h);
  const dx = o.x - cx, dy = o.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= o.r * o.r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    o.x = cx + (dx / d) * o.r; o.y = cy + (dy / d) * o.r;
  } else {
    const l = o.x - c.x, rr = c.x + c.w - o.x, t = o.y - c.y, b = c.y + c.h - o.y, m = Math.min(l, rr, t, b);
    if (m === l) o.x = c.x - o.r; else if (m === rr) o.x = c.x + c.w + o.r; else if (m === t) o.y = c.y - o.r; else o.y = c.y + c.h + o.r;
  }
  return true;
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
  /** Switched on by the boss for the current phase; a standby projector builds no clone. */
  active = true;
  private acc = 0;
  private shock = 0;
  private cable: Cable | null = null;
  constructor(x: number, y: number, readonly zone: ZoneId, private stage: ClubStage) {
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
  get ready(): boolean { return this.active && this.working && !this.link && this.respawnT <= 0; }

  plugCable(w: World): void {
    if (this.cable) return;
    const side = this.x < MAP.w / 2 ? -1 : 1;
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
    if (!this.link && this.working && this.active && this.respawnT > 0) this.respawnT -= dt;
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
    if (on && this.active) {
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
    } else if (on) {
      g.circle(this.lensX, this.lensY, 3, P.cyan, 0.08, 'light');
    } else if (this.offT > 0) {
      g.text(`${Math.ceil(this.offT)}`, this.x, this.y - 40, { layer: 'top', color: P.fog, align: 'center', alpha: 0.7 });
    }
  }
}

/** Turntable state: angle, speed, the DJ override and the laser lock. */
export class Turntable {
  readonly x = TABLE.x;
  readonly y = TABLE.y;
  readonly r = TABLE.r;
  angle = 0;
  /** Phase speed (rad/s, positive = clockwise on screen), set by the boss. */
  base = 0;
  /** DJ override left (s) and its cooldown. */
  djT = 0;
  djCd = 0;
  /** Laser lock requests: while > 0 the turntable snaps to the next 45-degree step and stops there. */
  holds = 0;
  /** Stopped on a 45-degree step because of a hold. */
  locked = false;
  /** Rotation applied in the last step (rad). */
  delta = 0;
  private snapTo: number | null = null;
  private lastV = 0;

  /** Speed when nothing holds it (rad/s). */
  get freeSpeed(): number { return this.djT > 0 ? (this.base ? -this.base : DJ_SPIN) : this.base; }
  on(x: number, y: number): boolean { return (x - this.x) ** 2 + (y - this.y) ** 2 < this.r * this.r; }

  step(dt: number, dark: boolean): number {
    if (this.djT > 0) this.djT -= dt;
    if (this.djCd > 0) this.djCd -= dt;
    let d = 0;
    if (this.holds > 0) {
      if (this.snapTo === null) {
        const k = this.angle / Q, dir = Math.sign(this.lastV);
        this.snapTo = (dir > 0 ? Math.ceil(k - 1e-6) : dir < 0 ? Math.floor(k + 1e-6) : Math.round(k)) * Q;
      }
      const rest = this.snapTo - this.angle, v = Math.max(Math.abs(this.lastV), SNAP_SPEED);
      if (Math.abs(rest) <= v * dt) { d = rest; this.locked = true; } else { d = Math.sign(rest) * v * dt; this.locked = false; }
    } else {
      this.snapTo = null;
      this.locked = false;
      const v = dark ? 0 : this.freeSpeed;
      this.lastV = v;
      d = v * dt;
    }
    this.angle += d;
    if (this.locked && this.snapTo !== null) this.angle = this.snapTo;
    this.delta = d;
    return d;
  }

  /** Ring and sector of a ground point (null = off the turntable). */
  cellOf(x: number, y: number): [number, number] | null {
    const d = dist(x, y, this.x, this.y);
    if (d >= this.r) return null;
    const ring = TABLE.rings.findIndex((r, i) => i > 0 && d < r) - 1;
    let a = (Math.atan2(y - this.y, x - this.x) - this.angle) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return [Math.min(TABLE.sectors - 1, Math.floor(a / Q)), ring];
  }
}

/** DJ console: reverses the turntable for 6 s (spins a still one), 12 s cooldown. */
export class DjConsole extends Body {
  constructor(x: number, y: number, private stage: ClubStage) {
    super();
    this.x = x; this.y = y;
    this.r = 10; this.hz = 12; this.hr = 10;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.hackable = true;
    this.interactable = true;
    this.targetable = false;
    this.interactLabel = '打碟：转盘反转';
  }
  update(_w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    this.interactLabel = this.stage.table.base ? '打碟：转盘反转' : '打碟：转盘转动';
  }
  onHack(w: World): void { this.stage.scratch(w); }
  onInteract(w: World): void { w.sfx(this.stage.scratch(w) ? 'lever' : 'click'); }
  draw(g: Gfx, w: World): void {
    const t = this.stage.table, ready = t.djCd <= 0;
    g.img('lux_dev', ready ? 'dj_on' : 'dj_off', this.x, this.y + 10, { fill: this.flash > 0 ? P.white : undefined });
    if (ready) g.circle(this.x, this.y - 12, 14, COL.interact, (0.25 + 0.15 * Math.sin(w.realTime * 5)) * 0.6, 'light');
    else g.text(`${Math.ceil(t.djCd)}`, this.x, this.y - 34, { layer: 'top', color: P.fog, align: 'center', alpha: 0.7 });
    if (t.djT > 0) g.circle(this.x, this.y - 12, 10, P.magenta, 0.25 + 0.1 * Math.sin(w.realTime * 16), 'light');
  }
}

/** Mirror on the turntable rim. The plane has 4 orientations (k * 45 deg) relative to the platform. */
export class Mirror extends Body {
  k: number;
  private rotCd = 0;
  private spinT = 0;
  private lastNails = 0;
  constructor(x: number, y: number, k: number, readonly table: Turntable | null = null, readonly slot = 0) {
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
  /** World angle of the mirror plane (rad). */
  get plane(): number { return this.k * Q + (this.table?.angle ?? 0); }
  /** Mirror plane endpoints on the ground. */
  seg(): [number, number, number, number] {
    const a = this.plane, c = Math.cos(a) * Mirror.HALF, s = Math.sin(a) * Mirror.HALF;
    return [this.x - c, this.y - s, this.x + c, this.y + s];
  }
  normal(): [number, number] {
    const a = this.plane;
    return [-Math.sin(a), Math.cos(a)];
  }
  /** Follow the turntable. */
  place(): void {
    const t = this.table;
    if (!t) return;
    const a = this.slot * Q + t.angle;
    this.x = t.x + Math.cos(a) * MIRROR_RING;
    this.y = t.y + Math.sin(a) * MIRROR_RING;
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
    // nearest of the 4 baked orientations (the floor line shows the exact plane)
    const k = (((Math.round((this.plane - (this.spinT > 0 ? Q : 0)) / Q)) % 4) + 4) % 4;
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

/** Glass pieces as segments on the mirror plane (x = GLASS_X), between the doorways. */
export function glassSpans(b: Rect = CLUB_BOUNDS): [number, number][] {
  const out: [number, number][] = [];
  let y = b.y;
  for (const [a, c] of GLASS.doors) { out.push([y, a]); y = c; }
  out.push([y, b.y + b.h]);
  return out;
}
const GLASS_SPANS = glassSpans();

export interface BeamPath {
  /** Ground points: origin, then every reflection, then the end on a wall. */
  pts: [number, number][];
  mirrors: Mirror[];
  /** Points where the beam reflected off the glass, and where it went through. */
  glassBounces: [number, number][];
  glassPasses: [number, number][];
}

/**
 * Trace a beam on the ground plane, reflecting off mirror planes and the glass (up to `bounces`
 * reflections). Glass rule: a beam within 22.5 deg of head-on passes through, any flatter beam
 * reflects off it like a fixed mirror. The counter and couches do not stop it.
 */
export function traceBeam(w: World, mirrors: Mirror[], x: number, y: number, a: number, bounces = 4): BeamPath {
  const st = findStage(w);
  const skip = st?.glassWalls ?? [];
  const glass = st ? GLASS_SPANS : [];
  let ox = x, oy = y, dx = Math.cos(a), dy = Math.sin(a);
  const pts: [number, number][] = [[ox, oy]];
  const hits: Mirror[] = [];
  const glassBounces: [number, number][] = [], glassPasses: [number, number][] = [];
  let last: Mirror | null = null, lastGlass = -1, left = bounces;
  for (let guard = 0; guard < 16; guard++) {
    let t = 1000;
    for (const r of w.walls) if (!skip.includes(r)) t = Math.min(t, rayRect(ox, oy, dx, dy, r));
    let hit: Mirror | null = null, gi = -1;
    for (const m of mirrors) {
      if (m === last || m.dead) continue;
      const [ax, ay, bx, by] = m.seg();
      const tt = raySeg(ox, oy, dx, dy, ax, ay, bx, by);
      if (tt < t) { t = tt; hit = m; }
    }
    for (let i = 0; i < glass.length; i++) {
      if (i === lastGlass) continue;
      const tt = raySeg(ox, oy, dx, dy, GLASS_X, glass[i][0], GLASS_X, glass[i][1]);
      if (tt < t) { t = tt; hit = null; gi = i; }
    }
    // a mirror column hit edge-on (parallel to its face) is solid: the beam stops on it
    for (const m of mirrors) {
      if (m === last || m === hit || m.dead) continue;
      const tc = rayCircle(ox, oy, dx, dy, m.x, m.y, m.r * 0.7);
      if (tc > 1e-3 && tc < t) { t = tc; hit = null; gi = -1; }
    }
    ox += dx * t; oy += dy * t;
    if (gi >= 0 && Math.abs(dx) >= GLASS_PASS_COS) {
      // head-on: straight through, no new corner
      glassPasses.push([ox, oy]);
      lastGlass = gi; last = null;
      continue;
    }
    pts.push([ox, oy]);
    if ((!hit && gi < 0) || left <= 0) break;
    left--;
    if (gi >= 0) {
      dx = -dx;
      glassBounces.push([ox, oy]);
      lastGlass = gi; last = null;
      continue;
    }
    const [nx, ny] = (hit as Mirror).normal();
    const d = dx * nx + dy * ny;
    dx -= 2 * d * nx; dy -= 2 * d * ny;
    hits.push(hit as Mirror);
    last = hit; lastGlass = -1;
  }
  return { pts, mirrors: hits, glassBounces, glassPasses };
}

// ------------------------------------------------------------------ the stage
interface Spot { x: number; y: number; r: number; t: number; fx: number; fy: number; px: number; py: number; freeze: number; flare: number; home: number }

/** A lit turntable cell: sector `c` (0-7, turns with the platform), ring `r` (0 = centre). */
interface FloorCell { h: Hazard; c: number; r: number }

interface Bottle { x: number; c: number; broken: boolean }

export class ClubStage {
  dead = false;
  blackoutT = 0;
  private blackFade = 0;
  breakerCd = 0;
  floorMode: FloorMode = 'off';
  private beatClock = 0;
  beat = 0;
  readonly spots: Spot[] = [
    { x: 0, y: 0, r: 30, t: 0, fx: 0.23, fy: 0.31, px: 0, py: 1, freeze: 0, flare: 0, home: TABLE.x },
    { x: 0, y: 0, r: 30, t: 0, fx: 0.19, fy: 0.27, px: 2.6, py: 0.3, freeze: 0, flare: 0, home: TABLE.x },
  ];
  readonly table = new Turntable();
  readonly mirrors: Mirror[] = [];
  readonly projectors: Projector[] = [];
  readonly breakers: Breaker[] = [];
  dj: DjConsole | null = null;
  /** The glass wall rects (in `w.walls`); the laser ignores them and uses the glass plane. */
  readonly glassWalls: Rect[] = [];
  readonly cover: LowCover[] = [COUNTER, ...COUCHES];
  readonly bottles: Bottle[] = BOTTLES.map(([x, c]) => ({ x, c, broken: false }));
  private floor: FloorCell[] = [];
  listener: StageListener | null = null;
  /** Extra darkness holes for this frame (the boss adds its laser, etc.). Cleared after drawing. */
  readonly holes: { x: number; y: number; r: number }[] = [];
  private wavePlan: number[] = [];

  constructor() { this.moveSpots(0, TABLE.x); }

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
    w.fx.label(w.camX + 320, w.camY + 120, '全场断电 · 伤害 ×1.5', P.amber, 1.4);
    this.listener?.onBlackout(w);
    return true;
  }

  /** DJ console: reverse (or spin) the turntable for 6 s. */
  scratch(w: World): boolean {
    const t = this.table, at = this.dj ?? { x: t.x, y: t.y - t.r };
    if (t.djCd > 0) { w.fx.label(at.x, at.y - 30, `冷却 ${Math.ceil(t.djCd)}s`, P.fog, 0.8); return false; }
    t.djT = 6;
    t.djCd = 12;
    w.fx.label(at.x, at.y - 34, t.base ? '转盘反转 6s' : '转盘转动 6s', P.magenta, 1.2);
    w.fx.sparks(at.x, at.y - 14, 8, P.magenta, 90);
    w.sfx('spray', 0.6, 0.7);
    return true;
  }

  stopFloor(): void {
    for (const f of this.floor) f.h.dead = true;
    this.floor = [];
    this.wavePlan = [];
  }

  /** Spotlights wander around a home point that trails the player (so they stay near the fight). */
  private moveSpots(dt: number, px: number): void {
    const b = CLUB_BOUNDS;
    for (const s of this.spots) {
      if (s.freeze > 0) { s.freeze -= dt; continue; }
      s.t += dt;
      const want = clamp(px, b.x + 240, b.x + b.w - 240);
      s.home += clamp(want - s.home, -130 * dt, 130 * dt);
      if (dt === 0) s.home = want;
      s.x = clamp(s.home + 220 * Math.sin(s.fx * s.t + s.px), b.x + s.r, b.x + b.w - s.r);
      s.y = 208 + 96 * Math.sin(s.fy * s.t + s.py);
    }
  }

  /** Mirrors follow the turntable. */
  placeMirrors(): void { for (const m of this.mirrors) m.place(); }

  update(w: World, dt: number): void {
    if (this.breakerCd > 0) this.breakerCd -= dt;
    if (this.blackoutT > 0) {
      this.blackoutT -= dt;
      this.blackFade = Math.min(1, this.blackFade + dt * 8);
      if (this.blackoutT <= 0) { w.sfx('click'); w.fx.flash(P.white, 0.15, 0.1); }
    } else this.blackFade = Math.max(0, this.blackFade - dt * 2.5);
    for (const s of this.spots) if (s.flare > 0) s.flare -= dt;
    this.moveSpots(dt, w.player.x);
    this.turn(w, dt);
    this.lowCover(w);
    this.floor = this.floor.filter((f) => !f.h.dead);
    // beat clock
    this.beatClock += dt;
    while (this.beatClock >= BEAT) {
      this.beatClock -= BEAT;
      this.beat++;
      this.onBeat(w);
    }
  }

  // ------------------------------------------------------------------ turntable
  private turn(w: World, dt: number): void {
    const t = this.table;
    const d = t.step(dt, this.dark);
    this.placeMirrors();
    for (const f of this.floor) if (f.h.shape.k === 'sector') f.h.shape.a = t.angle + (f.c + 0.5) * Q;
    if (!d) return;
    const c = Math.cos(d), s = Math.sin(d);
    const carry = (o: { x: number; y: number; r: number }, ignore?: Body) => {
      const rx = o.x - t.x, ry = o.y - t.y;
      w.moveCircle(o, t.x + rx * c - ry * s - o.x, t.y + rx * s + ry * c - o.y, ignore ? { ignore } : {});
    };
    const p = w.player;
    if (!p.airborne && t.on(p.x, p.y)) carry(p);
    for (const b of w.bodies) if (!b.dead && b.mass > 0 && b.team === 'neutral' && t.on(b.x, b.y)) carry(b, b);
  }

  // ------------------------------------------------------------------ counter, couches, bottles
  private lowCover(w: World): void {
    const p = w.player;
    if (!p.airborne) for (const c of this.cover) pushOut(p, c);
    for (const e of w.bullets) {
      if (e.dead) continue;
      if (e.y > COUNTER.y - COUNTER.top - 10 && e.y < COUNTER.y && e.x > COUNTER.x && e.x < COUNTER.x + COUNTER.w) {
        for (const bt of this.bottles) {
          if (bt.broken || Math.abs(e.x - bt.x) > 2 + e.r || e.y < COUNTER.y - COUNTER.top - 9 || e.y > COUNTER.y - COUNTER.top + 1) continue;
          bt.broken = true;
          w.fx.burst(bt.x, COUNTER.y - COUNTER.top - 4, 6, bt.c, 70, 0.3, 1);
          w.sfx('pop', 0.6, 1.6);
        }
      }
      if (e.team !== 'enemy' || !e.soft) continue;
      for (const c of this.cover) {
        if (e.x >= c.x && e.x <= c.x + c.w && e.y >= c.y - c.top && e.y <= c.y + c.h) { e.onWall(w); break; }
      }
    }
  }

  // ------------------------------------------------------------------ dance floor
  private lightCells(w: World, cells: [number, number][]): void {
    const t = this.table;
    for (const [c, r] of cells) {
      if (c < 0 || r < 0 || c >= TABLE.sectors || r >= 3) continue;
      if (this.floor.some((f) => f.c === c && f.r === r)) continue;
      const inner = TABLE.rings[r], outer = TABLE.rings[r + 1];
      const h = new Hazard({ k: 'sector', x: t.x, y: t.y, r: outer - 1, inner: inner ? inner + 1 : 0, a: t.angle + (c + 0.5) * Q, span: Q - 0.05 }, 2 * BEAT, BEAT);
      h.low = true;
      h.visible = false;
      h.owner = this;
      w.addHazard(h);
      this.floor.push({ h, c, r });
    }
  }

  private all(fn: (c: number, r: number) => boolean): [number, number][] {
    const out: [number, number][] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < TABLE.sectors; c++) if (fn(c, r)) out.push([c, r]);
    return out;
  }

  private onBeat(w: World): void {
    if (this.blackoutT > 0 || this.floorMode === 'off' || w.state !== 'fight') return;
    if (this.beat % 4 === 0) w.sfx('beat', 0.6);
    // queued wave rings
    if (this.wavePlan.length) {
      const r = this.wavePlan.shift()!;
      this.lightCells(w, this.all((_c, rr) => rr === r));
      return;
    }
    const rng = w.rng;
    const p = w.player;
    const sd = (a: number, b: number) => { const d = Math.abs(a - b) % 8; return Math.min(d, 8 - d); };
    if (this.floorMode === 'encore') {
      if (this.beat % 8 === 0) this.lightCells(w, this.all((c, r) => (c + r) % 2 === 0 && r > 0));
      if (this.beat % 8 === 4) this.lightCells(w, this.all((c, r) => (c + r) % 2 === 1));
      return;
    }
    const every = this.floorMode === 'light' ? 8 : 4;
    if (this.beat % every !== 0) return;
    const pc = this.table.cellOf(p.x, p.y);
    if (this.floorMode === 'light') {
      const pick = rng.int(0, 2);
      if (pick === 0 && pc) this.lightCells(w, this.all((c, r) => Math.abs(r - pc[1]) <= 1 && sd(c, pc[0]) <= 1));
      else if (pick === 1) { const r = rng.int(0, 2); this.lightCells(w, this.all((_c, rr) => rr === r)); }
      else { const s = rng.int(0, 7); this.lightCells(w, this.all((c) => c === s || c === (s + 1) % 8)); }
      return;
    }
    // full
    const pick = rng.int(0, 6);
    switch (pick) {
      case 0: { const par = rng.int(0, 1); this.lightCells(w, this.all((c, r) => (c + r) % 2 === par)); break; }
      case 1: this.lightCells(w, this.all((_c, r) => r === 2)); break;
      case 2: this.lightCells(w, this.all((_c, r) => r <= 1)); break;
      case 3: { const k = rng.int(0, 2); this.lightCells(w, this.all((c, r) => (c + r) % 3 === k)); break; }
      case 4: {
        const out = rng.chance(0.5);
        this.wavePlan = out ? [1, 2] : [1, 0];
        this.lightCells(w, this.all((_c, r) => r === (out ? 0 : 2)));
        break;
      }
      case 5:
        if (pc) this.lightCells(w, this.all((c, r) => c === pc[0] || r === pc[1]));
        else { const s = rng.int(0, 3); this.lightCells(w, this.all((c) => c % 4 === s)); }
        break;
      default: { const s = rng.int(0, 7); this.lightCells(w, this.all((c) => sd(c, s + 1) <= 1)); }
    }
  }

  // ------------------------------------------------------------------ drawing
  drawFloor(g: Gfx, w: World): void {
    const dark = this.blackoutT > 0;
    const pulse = 1 - (this.beatClock / BEAT);
    const t = this.table;
    // turntable cells: idle glow, then the sector lines that turn with the platform
    for (let r = 0; r < 3; r++) for (let c = 0; c < TABLE.sectors; c++) {
      const a0 = t.angle + c * Q + 0.025, a1 = t.angle + (c + 1) * Q - 0.025;
      const on = !dark && this.floorMode !== 'off' && (c + r + this.beat) % 4 === 0;
      const base = dark ? 0.02 : this.floorMode === 'off' ? 0.03 : 0.045;
      g.sector(t.x, t.y, TABLE.rings[r + 1] - 1, a0, a1, (c + r) % 2 ? P.cyan : P.magenta, on ? 0.09 + 0.09 * pulse : base, 'floor', TABLE.rings[r] ? TABLE.rings[r] + 1 : 0);
    }
    for (let c = 0; c < TABLE.sectors; c++) {
      const a = t.angle + c * Q;
      g.line(t.x + Math.cos(a) * 6, t.y + Math.sin(a) * 6, t.x + Math.cos(a) * (t.r - 1), t.y + Math.sin(a) * (t.r - 1), 1, c === 0 ? P.amber : P.slate, dark ? 0.25 : 0.6, 'floor');
    }
    if (t.locked) g.ring(t.x, t.y, t.r + 2, 1, P.red, 0.5, 'floor');
    else if (t.delta) {
      // direction chevrons on the rim
      const dir = Math.sign(t.delta);
      for (let i = 0; i < 4; i++) {
        const a = t.angle + i * (Math.PI / 2) + Q / 2, ca = Math.cos(a), sa = Math.sin(a), R = t.r + 4;
        const tx = -sa * dir, ty = ca * dir;
        g.poly([t.x + ca * R + tx * 4, t.y + sa * R + ty * 4, t.x + ca * (R - 3) - tx * 2, t.y + sa * (R - 3) - ty * 2, t.x + ca * (R + 3) - tx * 2, t.y + sa * (R + 3) - ty * 2], P.amber, dark ? 0.2 : 0.6, 'floor');
      }
    }
    for (const f of this.floor) {
      const h = f.h;
      if (h.shape.k !== 'sector') continue;
      const s = h.shape, a0 = s.a - s.span / 2, a1 = s.a + s.span / 2;
      if (h.warning) {
        const second = h.t >= BEAT;
        const blink = Math.floor(h.t * 8) % 2 === 0;
        g.sector(s.x, s.y, s.r, a0, a1, P.red, (second ? 0.32 : 0.16) + (blink ? 0.08 : 0), 'floor', s.inner);
        g.sector(s.x, s.y, s.r, a0, a1, second ? P.rose : P.red, 0.25, 'floor', Math.max(s.inner ?? 0, s.r - 2));
      } else {
        g.sector(s.x, s.y, s.r, a0, a1, P.rose, 0.7, 'floor', s.inner);
        g.sector(s.x, s.y, s.r - 4, a0 + 0.05, a1 - 0.05, P.white, 0.45, 'floor', (s.inner ?? 0) + 4);
        const mid = ((s.inner ?? 0) + s.r) / 2;
        g.circle(s.x + Math.cos(s.a) * mid, s.y + Math.sin(s.a) * mid, 18, P.magenta, 0.18, 'light');
      }
    }
    // bottles on the counter
    for (const b of this.bottles) {
      if (b.broken) continue;
      const y = COUNTER.y - COUNTER.top - 1;
      g.rect(b.x - 1, y - 7, 3, 7, b.c, 0.95, 'floor');
      g.rect(b.x, y - 9, 1, 2, P.pale, 0.95, 'floor');
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
      // light cones from the rig above (it hangs over each spot's home point)
      for (const s of this.spots) {
        const lx = s.home + (s.x - s.home) * 0.4, ly = 30;
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
      // only holes near the screen matter
      const v = w.view;
      g.darkness(0.8 * clamp(this.blackFade, 0, 1), holes.filter((h) => h.x > v.x - h.r && h.x < v.x + v.w + h.r && h.y > v.y - h.r && h.y < v.y + v.h + h.r));
    }
    this.holes.length = 0;
  }
}

/** Autopilot routing: through a doorway when the glass is in the way, round the counter end. */
function botRoute(w: World): { x: number; y: number; jump: boolean } | null {
  const p = w.player;
  const t = w.nearestEnemy(p.x, p.y, 999);
  if (!t) return null;
  const side = (x: number) => (x < GLASS_X ? -1 : 1);
  const sp = side(p.x), stx = side(t.x);
  if (sp !== stx && Math.abs(t.x - p.x) > 40) {
    let door = GLASS.doors[0], bd = Infinity;
    for (const d of GLASS.doors) { const m = Math.abs((d[0] + d[1]) / 2 - p.y); if (m < bd) { bd = m; door = d; } }
    const mid = (door[0] + door[1]) / 2;
    const inBand = p.y > door[0] + 7 && p.y < door[1] - 7;
    if (inBand && Math.abs(p.x - GLASS_X) < 16) return { x: GLASS_X + stx * 24, y: mid, jump: false };
    return { x: GLASS_X + sp * 12, y: mid, jump: false };
  }
  const c = COUNTER;
  const touching = p.x > c.x - 4 && p.x < c.x + c.w + 4 && p.y > c.y - p.r - 3 && p.y < c.y + c.h + p.r + 3;
  const across = (p.y < c.y + c.h / 2) !== (t.y < c.y + c.h / 2);
  if (touching && across && !p.airborne && Math.abs(t.y - p.y) > 40) {
    const ex = p.x - c.x < c.x + c.w - p.x ? c.x - 14 : c.x + c.w + 14;
    return { x: ex, y: c.y + c.h / 2, jump: false };
  }
  return null;
}

export const club: Arena = {
  id: 'club',
  bg: 'bg_club',
  size: MAP,
  bounds: CLUB_BOUNDS,
  playerSpawn: { x: 640, y: 326 },
  setup(w: World) {
    for (const r of maskWalls(clubMask, CLUB_BOUNDS)) w.walls.push(r);
    const st = new ClubStage();
    w.objects.push(st);
    for (const [y0, y1] of glassSpans()) {
      const r = { x: GLASS.x, y: y0, w: GLASS.w, h: y1 - y0 };
      w.walls.push(r);
      st.glassWalls.push(r);
    }
    for (const [x, y] of BREAKER_POS) st.breakers.push(w.add(new Breaker(x, y, st)));
    for (const [x, y, z] of PROJECTOR_POS) { const p = w.add(new Projector(x, y, z, st)); p.plugCable(w); st.projectors.push(p); }
    MIRROR_SLOTS.forEach((slot, i) => st.mirrors.push(w.add(new Mirror(0, 0, MIRROR_K0[i], st.table, slot))));
    st.placeMirrors();
    st.dj = w.add(new DjConsole(DJ_POS.x, DJ_POS.y, st));
  },
  drawFloor(g: Gfx, w: World) {
    findStage(w)?.drawFloor(g, w);
  },
  botHint: botRoute,
};
