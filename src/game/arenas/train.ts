/**
 * Ring-line maglev roof (Vesper): an 8-car train, a horizontally scrolling map. The fight starts on
 * the rear car (left); the locomotive is at the front (right). The train is data: TRAIN.cars /
 * TRAIN.gaps are built from a car count and length, and every device, safe zone, sweep and wall is
 * generated from that list.
 *
 * Interactables:
 *   - cover (2 per car: AC unit, cargo crate): wall rects. Block her sniper rounds and laser.
 *     3 sniper hits or 1 armour-piercing round break one into flat rubble (blocks nothing).
 *   - gantry: every ~16 s a countdown ("前方龙门架"), then a band runs along the whole train from
 *     the front to the rear at train speed. 1 heart + knockback to the rear, except inside a car gap
 *     (lower than the roof). Vesper caught outside a gap: 360 damage + stagger.
 *   - catenary junction boxes (1 per car): 4 hits / E / grapple / hack /
 *     overload / 0.5 s of arc -> 2 s warning -> that car's roof is live for 1.5 s (1 heart, jump
 *     or leave the car). Vesper on it: damage + stun. 10 s cooldown per box. Pantographs (car
 *     centres) and boxes are conductive: arc chained through them into her deals x1.5.
 *   - uncoupling (Vesper P2+): the rearmost car detaches after a telegraph (red coupling + siren):
 *     3-4.5 s while the player is on it (every ~14 s), 1.5 s when it is empty. Still on it: 1 heart,
 *     put on the next car. The left wall and `w.bounds` move forward. Stops at the last 3 cars.
 *   - tunnel (Vesper P3, once 3 cars are left): darkness; only the player's light, warning lamps,
 *     junction boxes, her laser and telegraphs show.
 *
 * Per-fight state is a TrainState in `w.objects`, found with trainOf(w). `w.bounds` is a per-fight
 * copy of TRAIN.bounds (it shrinks from the back).
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { clamp, dist, rayRect, type Rect } from '../../engine/math';
import { Body } from '../body';
import type { Bullet } from '../bullet';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

// =====================================================================================
// Train layout (data)
// =====================================================================================
export interface CoverSpec { kind: 'ac' | 'crate'; x: number; y: number; fw: number; fh: number }
export interface Car {
  i: number;
  x0: number;
  x1: number;
  cx: number;
  covers: CoverSpec[];
  box: { x: number; y: number };
  panto: { x: number; y: number };
  /** Landing spots for Vesper's relocation leaps. */
  spots: { x: number; y: number }[];
}
/** Gap i sits between car i and car i + 1 (it leaves with car i when that car uncouples). */
export interface Gap { i: number; x0: number; x1: number; cx: number; walkY0: number; walkY1: number }

/** Cover layouts by car (u along the car, v across the roof), alternating. */
const COVER_PATTERNS: { kind: 'ac' | 'crate'; u: number; v: number }[][] = [
  [{ kind: 'ac', u: 0.32, v: 0.27 }, { kind: 'crate', u: 0.68, v: 0.76 }],
  [{ kind: 'crate', u: 0.3, v: 0.75 }, { kind: 'ac', u: 0.7, v: 0.27 }],
];
const COVER_SIZE = { ac: { fw: 34, fh: 18 }, crate: { fw: 24, fh: 20 } };

export function buildTrain(count: number, carLen: number, gapW: number, x0: number, y: number, h: number, mapH: number) {
  const bounds: Rect = { x: x0, y, w: count * carLen + (count - 1) * gapW, h };
  const cars: Car[] = [];
  const gaps: Gap[] = [];
  for (let i = 0; i < count; i++) {
    const cx0 = x0 + i * (carLen + gapW), cx1 = cx0 + carLen;
    const covers = COVER_PATTERNS[i % COVER_PATTERNS.length].map((c) => ({
      kind: c.kind, x: Math.round(cx0 + c.u * carLen), y: Math.round(y + c.v * h), ...COVER_SIZE[c.kind],
    }));
    const car: Car = {
      i, x0: cx0, x1: cx1, cx: cx0 + carLen / 2, covers,
      box: { x: Math.round(cx0 + carLen / 2), y: y + 16 },
      panto: { x: Math.round(cx0 + carLen / 2), y: Math.round(y + h / 2) },
      spots: [],
    };
    for (const u of [0.15, 0.32, 0.5, 0.68, 0.85]) for (const v of [0.22, 0.5, 0.78]) {
      const sx = Math.round(cx0 + u * carLen), sy = Math.round(y + v * h);
      const clear = covers.every((c) => Math.abs(sx - c.x) > c.fw / 2 + 14 || Math.abs(sy - c.y) > c.fh / 2 + 14)
        && dist(sx, sy, car.box.x, car.box.y) > 24 && dist(sx, sy, car.panto.x, car.panto.y) > 22;
      if (clear) car.spots.push({ x: sx, y: sy });
    }
    cars.push(car);
    if (i < count - 1) gaps.push({ i, x0: cx1, x1: cx1 + gapW, cx: cx1 + gapW / 2, walkY0: y + 30, walkY1: y + h - 30 });
  }
  return {
    bounds, cars, gaps, carLen, gapW,
    /** Map size: the locomotive nose sticks out past the front of the roof. */
    size: { w: bounds.x + bounds.w + 40, h: mapH },
    playerSpawn: { x: cars[0].x0 + carLen * 0.3, y: y + h / 2 },
    vesperSpawn: { x: Math.round(cars[Math.min(1, count - 1)].x0 + carLen * 0.68), y: Math.round(y + h * 0.5) },
    /** Far roof lip above the walkable roof and visible car side below it (3/4 view), px. */
    lip: 8,
    side: 26,
  };
}

export const TRAIN = buildTrain(8, 370, 30, 20, 80, 212, 360);
/** Cars left when uncoupling stops (Vesper is cornered on them in P3). */
export const LAST_CARS = 3;
/** Train speed: how fast the gantry band runs along the roof and the scenery scrolls, px/s. */
const TRAIN_SPEED = 520;
/** Widths of the scrolling strip tiles (art builds them at these sizes). */
export const STRIP = { trackW: 64, cityW: 128 };
/** Strip heights, derived from the layout. */
export const STRIP_H = {
  top: TRAIN.bounds.y - TRAIN.lip,
  track: TRAIN.bounds.h + TRAIN.lip + TRAIN.side + 6,
  bot: TRAIN.size.h - (TRAIN.bounds.y + TRAIN.bounds.h + TRAIN.side + 6),
};
/** Car sprite frame size (roof + lips + side). */
export const CAR_SPRITE = { w: TRAIN.carLen, h: TRAIN.bounds.h + TRAIN.lip + TRAIN.side + 2, gapW: TRAIN.gapW };

export function carAt(x: number): Car | null {
  for (const c of TRAIN.cars) if (x >= c.x0 && x < c.x1) return c;
  return null;
}
/** Car index under x counting a gap as part of the car behind it. */
export function carIndexAt(x: number): number {
  for (const c of TRAIN.cars) if (x < c.x1 + TRAIN.gapW) return c.i;
  return TRAIN.cars.length - 1;
}
export function gapAt(x: number, y: number, margin = 0): Gap | null {
  for (const g of TRAIN.gaps) if (x >= g.x0 + margin && x <= g.x1 - margin && y >= g.walkY0 && y <= g.walkY1) return g;
  return null;
}

/**
 * Only the coupler walkway in the middle of a gap can be stood on. The drop beside it is not a
 * wall (her shots and the arc cross it), so ground positions are pushed back out each step.
 */
export function keepOffDrops(o: { x: number; y: number }): void {
  for (const gp of TRAIN.gaps) {
    if (o.x <= gp.x0 || o.x >= gp.x1 || (o.y >= gp.walkY0 && o.y <= gp.walkY1)) continue;
    const dl = o.x - gp.x0, dr = gp.x1 - o.x;
    const dy = o.y < gp.walkY0 ? gp.walkY0 - o.y : o.y - gp.walkY1;
    if (dy <= Math.min(dl, dr)) o.y = o.y < gp.walkY0 ? gp.walkY0 : gp.walkY1;
    else if (dl < dr) o.x = gp.x0 - 0.5;
    else o.x = gp.x1 + 0.5;
  }
}

const GANTRY_WARN = 2.5;
/** Half width of the gantry's hit band (feet x). */
export const GANTRY_HALF = 12;
const LIVE_WARN = 2.0;
const LIVE_DUR = 1.5;
const BOX_CD = 10;

const STATES = new WeakMap<World, TrainState>();
export function trainOf(w: World): TrainState | undefined { return STATES.get(w); }

/** The boss on the roof: the train reports hazards to it. */
export interface TrainRider {
  x: number;
  y: number;
  readonly onRoof: boolean;
  shockedByCar(w: World): void;
  hitByGantry(w: World): void;
}

function shadow(g: Gfx, x: number, y: number, rx: number, ry = rx * 0.4): void {
  g.ellipse(x, y, rx, ry, P.ink, 0.45, 'floor');
}

// =====================================================================================
// Devices
// =====================================================================================
/** How far above its footprint a cover stops shots. */
const SHOT_LIFT = 18;

/** Standing cover whose shot box contains a point. */
export function coverAt(st: TrainState, x: number, y: number): Cover | null {
  for (const c of st.covers) {
    if (c.broken || c.dead) continue;
    const r = c.shotBox;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return c;
  }
  return null;
}

/** Distance along a shot ray to the first wall or cover shot box (her laser and line of sight). */
export function shotRay(w: World, ox: number, oy: number, dx: number, dy: number, max: number, skip?: Cover | null): number {
  let t = w.rayWall(ox, oy, dx, dy, max);
  const st = trainOf(w);
  if (st) for (const c of st.covers) if (!c.broken && !c.dead && c !== skip) t = Math.min(t, rayRect(ox, oy, dx, dy, c.shotBox));
  return t;
}

/** Roof cover. A wall rect while standing; rubble (no blocking) once broken. (x, y) = footprint centre. */
export class Cover extends Body {
  hits = 3;
  broken = false;
  readonly wall: Rect;
  constructor(readonly spec: CoverSpec) {
    super();
    this.x = spec.x; this.y = spec.y;
    this.r = Math.max(spec.fw, spec.fh) / 2; this.hz = 0; this.hr = 0;
    this.mass = 0;
    this.targetable = false;
    this.wall = { x: spec.x - spec.fw / 2, y: spec.y - spec.fh / 2, w: spec.fw, h: spec.fh };
  }
  attach(w: World): this { w.walls.push(this.wall); return this; }
  update(_w: World, dt: number): void { if (this.flash > 0) this.flash -= dt; }
  contains(x: number, y: number, pad = 1): boolean {
    const r = this.wall;
    return !this.broken && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
  }
  /**
   * Where it stops shots: the footprint raised by the height shots fly at (bullets are drawn
   * 11-24 px above the ground point they are over), so a player standing behind it is covered.
   */
  get shotBox(): Rect {
    const r = this.wall;
    return { x: r.x, y: r.y - SHOT_LIFT, w: r.w, h: r.h + SHOT_LIFT - 2 };
  }
  /** A sniper round stopped here. Armour-piercing rounds break it at once. */
  shot(w: World, ap: boolean): void {
    if (this.broken) return;
    this.flash = 0.08;
    this.hits -= ap ? 3 : 1;
    w.fx.debris(this.x, this.y - 10, 6, [P.slate, P.steel, P.fog], 100);
    w.sfx('armor', 0.7, 0.8);
    if (this.hits <= 0) this.collapse(w);
  }
  collapse(w: World, quiet = false): void {
    if (this.broken) return;
    this.broken = true;
    w.walls = w.walls.filter((r) => r !== this.wall);
    if (quiet) return;
    w.fx.debris(this.x, this.y - 12, 18, [P.slate, P.steel, P.fog, P.sodium, P.ink], 180);
    w.fx.smoke(this.x, this.y, 8, P.slate, 6, 14);
    w.fx.label(this.x, this.y - 30, '掩体被打碎', P.fog, 0.9);
    w.fx.shake(3, 0.15);
    w.sfx('crash', 0.8);
  }
  hurt(): number { return 0; }
  draw(g: Gfx): void {
    const k = this.spec.kind;
    const frame = this.broken ? `${k}_broken` : this.hits < 3 ? `${k}_dent` : k;
    g.img('train_cover', frame, this.x, this.wall.y + this.wall.h + 3, { layer: this.broken ? 'floor' : 'world', depth: this.wall.y + this.wall.h, fill: this.flash > 0 ? P.white : undefined });
  }
}

/** Catenary junction box: electrifies its car's roof. */
export class JunctionBox extends Body {
  hitCount = 0;
  private hitGap = 0;
  shock = 0;
  cd = 0;
  private pulse = 0;
  constructor(private st: TrainState, readonly car: Car) {
    super();
    this.x = car.box.x; this.y = car.box.y;
    this.r = 8; this.hz = 10; this.hr = 9;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.conductive = true;
    this.interactable = true;
    this.hackable = true;
    this.targetable = false;
    this.interactLabel = '车顶通电';
  }
  get ready(): boolean { const l = this.st.live[this.car.i]; return this.cd <= 0 && l.warn <= 0 && l.on <= 0; }
  trigger(w: World): void {
    if (!this.ready) {
      if (this.pulse <= 0 && this.cd > 0) { w.fx.label(this.x, this.y - 26, `冷却 ${Math.ceil(this.cd)}s`, P.fog, 0.6); this.pulse = 0.6; }
      return;
    }
    this.cd = BOX_CD;
    this.hitCount = 0;
    this.shock = 0;
    this.pulse = 0.5;
    this.st.electrify(w, this.car);
    w.sfx('lever');
    w.fx.sparks(this.x, this.y - 12, 10, P.ice, 120);
  }
  update(_w: World, dt: number): void {
    if (this.cd > 0) this.cd -= dt;
    if (this.pulse > 0) this.pulse -= dt;
    if (this.hitGap > 0) this.hitGap -= dt;
    if (this.shock > 0) this.shock = Math.max(0, this.shock - dt * 0.4);
    if (this.flash > 0) this.flash -= dt;
    this.interactLabel = this.cd > 0 ? `接线盒冷却 ${Math.ceil(this.cd)}s` : '车顶通电';
  }
  hurt(w: World, h: Hit): number {
    if (h.from !== 'player' || h.quiet) return 0;
    this.flash = 0.05;
    w.fx.sparks(h.x, h.y, 2, P.ice, 60);
    if (h.src === 'slug' || h.kind === 'blast') { this.trigger(w); return 0; }
    // a shotgun blast counts as one hit, not eight
    if (this.hitGap > 0 || !this.ready) return 0;
    this.hitGap = 0.12;
    if (++this.hitCount >= 4) this.trigger(w);
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    if (!this.ready) return;
    this.shock += dt;
    if (this.shock >= 0.5) this.trigger(w);
  }
  onInteract(w: World): void { this.trigger(w); }
  onHack(w: World): void { this.trigger(w); }
  onEmp(w: World): void { this.trigger(w); }
  draw(g: Gfx, w: World): void {
    shadow(g, this.x, this.y + 1, 10);
    const live = this.st.live[this.car.i];
    const frame = live.warn > 0 || live.on > 0 ? 'box_live' : this.cd > 0 ? 'box_off' : 'box';
    g.img('train_dev', frame, this.x, this.y + 4, { fill: this.flash > 0 ? P.white : undefined });
    const ready = this.ready;
    g.circle(this.x, this.y - 10, ready ? 12 : 8, ready ? COL.interact : P.slate, ready ? 0.22 + 0.1 * Math.sin(w.realTime * 5) : 0.08, 'light');
    if (ready && this.hitCount > 0) {
      for (let i = 0; i < 4; i++) g.rect(this.x - 8 + i * 4, this.y - 30, 3, 2, i < this.hitCount ? P.amber : P.ink, 0.9, 'top');
    }
    if (this.cd > 0) {
      g.rect(this.x - 9, this.y - 30, 18, 3, P.ink, 0.8, 'top');
      g.rect(this.x - 9, this.y - 30, 18 * clamp(1 - this.cd / BOX_CD, 0, 1), 3, P.ice, 0.9, 'top');
    }
  }
}

/** Pantograph under the catenary: a conductive node the arc chains through (to her). */
export class Pantograph extends Body {
  constructor(readonly box: JunctionBox, car: Car) {
    super();
    this.x = car.panto.x; this.y = car.panto.y;
    this.r = 5; this.hz = 20; this.hr = 6;
    this.mass = 0;
    this.solid = true;
    this.conductive = true;
    this.targetable = false;
  }
  hurt(): number { return 0; }
  draw(g: Gfx): void {
    shadow(g, this.x, this.y + 1, 7);
    g.img('train_dev', 'panto', this.x, this.y + 4);
  }
}

// =====================================================================================
// Gantry: runs along the train from the front to the rear at train speed
// =====================================================================================
export class Gantry {
  state: 'idle' | 'warn' | 'pass' = 'idle';
  /** Idle: seconds until the next warning. Warn: seconds elapsed. */
  t = 13;
  interval = 16;
  x = 0;
  private hitPlayer = false;
  private hitRider = false;
  constructor(private st: TrainState) {}

  get speed(): number { return TRAIN_SPEED; }
  startX(w: World): number { return w.bounds.x + w.bounds.w + 30; }
  endX(w: World): number { return w.bounds.x - 30; }
  get warnLeft(): number { return this.state === 'warn' ? GANTRY_WARN - this.t : this.state === 'idle' ? this.t + GANTRY_WARN : 0; }

  /** World seconds until the band reaches ground x (Infinity once it has passed). */
  etaAt(w: World, x: number): number {
    if (this.state === 'pass') return x <= this.x + GANTRY_HALF ? Math.max(0, this.x - x) / this.speed : Infinity;
    return this.warnLeft + Math.max(0, this.startX(w) - x) / this.speed;
  }

  /** Is the feet x inside the band right now? */
  covers(x: number, pad = 0): boolean { return this.state === 'pass' && Math.abs(x - this.x) < GANTRY_HALF + pad; }

  update(w: World, dt: number): void {
    const fighting = w.state === 'fight' && !!w.boss && !w.boss.dying;
    switch (this.state) {
      case 'idle':
        if (!fighting) return;
        this.t -= dt;
        if (this.t <= 0) {
          this.state = 'warn';
          this.t = 0;
          w.sfx('siren', 0.7, 1.2);
        }
        return;
      case 'warn':
        this.t += dt;
        if (Math.floor(this.t * 2) !== Math.floor((this.t - dt) * 2)) w.sfx('telegraph', 0.5, 1.6);
        if (this.t >= GANTRY_WARN) {
          this.state = 'pass';
          this.x = this.startX(w);
          this.hitPlayer = this.hitRider = false;
        }
        return;
      case 'pass': {
        this.x -= this.speed * dt;
        const p = w.player;
        if (Math.abs(this.x - p.x) < 320 && w.rng.chance(dt * 4)) w.sfx('rev', 0.7, 0.6);
        if (!this.hitPlayer && this.covers(p.x, p.r) && !gapAt(p.x, p.y, 1) && w.state === 'fight') {
          const r = w.hitPlayer(1, { x: p.x, y: p.y, knock: 320, dx: -1, dy: 0, kind: 'crush' });
          if (r === 'hit') { this.hitPlayer = true; w.fx.label(p.x, p.y - 22, '被龙门架撞到', COL.danger, 0.9); }
        }
        const rd = this.st.rider;
        if (!this.hitRider && rd && rd.onRoof && this.covers(rd.x, 7) && !gapAt(rd.x, rd.y, 2)) {
          this.hitRider = true;
          rd.hitByGantry(w);
        }
        if (w.onScreen(this.x, w.bounds.y, -20) && w.rng.chance(dt * 30)) w.fx.sparks(this.x, w.bounds.y + w.rng.next() * w.bounds.h, 2, P.amber, 80);
        if (this.x <= this.endX(w)) {
          this.state = 'idle';
          const passT = (this.startX(w) - this.endX(w)) / this.speed;
          this.t = Math.max(4, this.interval - GANTRY_WARN - passT);
        }
        return;
      }
    }
  }

  drawFloor(g: Gfx, w: World): void {
    const b = w.bounds, v = w.view;
    const eta = this.etaAt(w, w.player.x);
    if (this.state === 'warn' || (this.state === 'pass' && eta < 99)) {
      const pulse = 0.5 + 0.5 * Math.sin(w.realTime * (eta < 1.2 ? 28 : 14));
      // the safe gaps on screen are outlined
      for (const gp of TRAIN.gaps) {
        if (gp.x0 < b.x + 2 || gp.x0 > v.x + v.w || gp.x1 < v.x) continue;
        g.rect(gp.x0, gp.walkY0, gp.x1 - gp.x0, gp.walkY1 - gp.walkY0, P.white, 0.1 + 0.08 * pulse);
        g.strokeRect(gp.x0, gp.walkY0, gp.x1 - gp.x0, gp.walkY1 - gp.walkY0, 1, P.white, 0.7 + 0.3 * pulse);
      }
    }
    if (this.state === 'warn') {
      // the front end of the roof flashes red
      const pulse = 0.5 + 0.5 * Math.sin(w.realTime * 14);
      g.rect(b.x + b.w - 14, b.y, 14, b.h, COL.danger, 0.15 + 0.25 * pulse);
    }
    if (this.state === 'pass') {
      // the band on the roof (drawn width >= hit area: half band + player radius)
      const W = 2 * (GANTRY_HALF + 5);
      g.rect(this.x - W / 2, b.y, W, b.h, P.rose, 0.5);
      for (const gp of TRAIN.gaps) if (Math.abs(this.x - gp.cx) < W) g.rect(gp.x0, gp.walkY0, gp.x1 - gp.x0, gp.walkY1 - gp.walkY0, P.navy, 0.8);
      g.rect(this.x + W / 2, b.y - 16, 10, b.h + 32, P.ink, 0.3);
    }
  }

  drawTop(g: Gfx, w: World): void {
    const b = w.bounds, v = w.view;
    const eta = this.etaAt(w, w.player.x);
    if (this.state === 'warn' || (this.state === 'pass' && eta < 99 && !w.onScreen(this.x, b.y + 40, 0))) {
      // countdown to the band reaching the player, at the top of the view
      const cx = v.x + v.w / 2, y = b.y - 10, L = 200;
      const f = clamp(eta / 9, 0, 1);
      g.rect(cx - L / 2, y - 2, L, 5, P.ink, 0.85, 'top');
      g.rect(cx - L / 2, y - 2, L * f, 5, COL.danger, 0.95, 'top');
      g.text(`前方龙门架 ${Math.ceil(eta)} · 躲进车厢连接处`, cx, y - 16, { layer: 'top', color: COL.danger, align: 'center', stroke: true, overDark: true });
      // arrow at the front edge of the view
      const ax = v.x + v.w - 14, ay = b.y + b.h / 2;
      const pulse = 0.6 + 0.4 * Math.sin(w.realTime * 14);
      g.poly([ax + 8, ay, ax - 4, ay - 9, ax - 4, ay + 9], COL.danger, pulse, 'top');
    }
    if (this.state === 'warn' || (this.state === 'pass' && eta < 99)) {
      for (const gp of TRAIN.gaps) if (gp.x0 >= b.x + 2 && w.onScreen(gp.cx, gp.walkY0, -10)) g.text('安全', gp.cx, gp.walkY0 - 12, { layer: 'top', color: P.white, align: 'center', stroke: true, overDark: true });
    }
    if (this.state === 'pass' && w.onScreen(this.x, b.y + 40, -40)) {
      g.img('train_gantry', 'beam', this.x, b.y + b.h + TRAIN.side + 20, { layer: 'top' });
      g.circle(this.x, b.y - 26, 5, P.red, 0.6, 'light');
      g.circle(this.x, b.y + b.h + TRAIN.side + 10, 5, P.red, 0.6, 'light');
    }
  }
}

// =====================================================================================
// Per-fight state
// =====================================================================================
interface Drift { i: number; t: number }

export class TrainState {
  dead = false;
  covers: Cover[] = [];
  boxes: JunctionBox[] = [];
  pantos: Pantograph[] = [];
  readonly gantry: Gantry;
  /** Per car: live-roof warning and active seconds. */
  readonly live = TRAIN.cars.map(() => ({ warn: 0, on: 0, hitPlayer: false, hitRider: false }));
  rider: TrainRider | null = null;
  /** Rearmost car still attached. */
  rear = 0;
  /** Uncoupling runs (Vesper P2+); seconds between detachments with the player on the rear car. */
  uncouple = false;
  uncoupleEvery = 14;
  private uncoupleT = 0;
  /** Running uncoupling telegraph: seconds left and its length. */
  detachT = -1;
  detachDur = 3;
  private detachBusy = false;
  private sirenT = 0;
  private drifting: Drift[] = [];
  private rearWall: Rect | null = null;
  /** Tunnel darkness (Vesper P3 sets `tunnel`). */
  tunnel = false;
  dark = 0;
  /** Extra darkness holes for this frame (her laser...). Cleared after drawing. */
  readonly holes: { x: number; y: number; r: number }[] = [];
  scroll = 0;

  constructor() { this.gantry = new Gantry(this); }

  get carsLeft(): number { return TRAIN.cars.length - this.rear; }
  get front(): number { return TRAIN.cars.length - 1; }

  electrify(w: World, car: Car): void {
    const l = this.live[car.i];
    if (l.warn > 0 || l.on > 0 || car.i < this.rear) return;
    l.warn = LIVE_WARN;
    l.hitPlayer = l.hitRider = false;
    w.fx.label(car.cx, w.bounds.y + 40, '车顶即将通电', COL.danger, 1);
    w.sfx('charge', 0.7, 1.3);
  }

  /** Seconds until car i's roof is safe again (0 = not live, no warning). */
  liveLeft(i: number): number {
    const l = this.live[i];
    if (!l) return 0;
    return l.warn > 0 ? l.warn + LIVE_DUR : Math.max(0, l.on);
  }

  /** Is x on a car whose roof is live (or about to be)? */
  liveAt(x: number, warnToo = false): boolean {
    const c = carAt(x);
    if (!c) return false;
    const l = this.live[c.i];
    return l.on > 0 || (warnToo && l.warn > 0);
  }

  update(w: World, dt: number): void {
    this.scroll += dt * TRAIN_SPEED * (this.tunnel ? 1.15 : 1);
    this.dark += ((this.tunnel ? 1 : 0) - this.dark) * Math.min(1, dt * 1.5);
    this.gantry.update(w, dt);
    this.updateUncouple(w, dt);
    for (const d of this.drifting) d.t += dt;
    this.drifting = this.drifting.filter((d) => d.t < 6);
    const p = w.player;
    for (const car of TRAIN.cars) {
      const l = this.live[car.i];
      if (l.warn > 0) {
        l.warn -= dt;
        if (l.warn <= 0) { l.on = LIVE_DUR; if (w.onScreen(car.cx, w.bounds.y, -200)) { w.sfx('zap'); w.sfx('emp', 0.6); } }
        continue;
      }
      if (l.on <= 0) continue;
      l.on -= dt;
      if (w.onScreen(car.cx, w.bounds.y, -200) && w.rng.chance(dt * 40)) w.fx.sparks(car.x0 + w.rng.next() * (car.x1 - car.x0), w.bounds.y + w.rng.next() * w.bounds.h, 2, COL.shock, 60);
      const onCar = (x: number) => x >= car.x0 && x < car.x1;
      if (!l.hitPlayer && onCar(p.x) && !p.airborne && w.state === 'fight') {
        if (w.hitPlayer(1, { x: p.x, y: p.y, low: true, kind: 'shock', perfectable: false }) === 'hit') l.hitPlayer = true;
      }
      const rd = this.rider;
      if (!l.hitRider && rd && rd.onRoof && onCar(rd.x)) { l.hitRider = true; rd.shockedByCar(w); }
    }
  }

  // ------------------------------------------------------------------ uncoupling
  private playerOnRear(w: World): boolean {
    const c = TRAIN.cars[this.rear];
    return w.player.x < c.x1 + TRAIN.gapW;
  }

  private updateUncouple(w: World, dt: number): void {
    if (!this.uncouple || this.carsLeft <= LAST_CARS || w.state !== 'fight' || !w.boss || w.boss.dying) { this.detachT = -1; return; }
    if (this.detachT < 0) {
      // an empty rear car goes quickly; the one under the player on the slow cadence
      const busy = this.playerOnRear(w);
      // empty rear cars go one after another; the one under the player on the slow cadence
      if (!busy) this.uncoupleT = Math.min(this.uncoupleT, 0.6);
      this.uncoupleT -= dt;
      // never on top of a gantry pass the player has to dodge, never toward a live roof
      if (this.uncoupleT > 0 || (busy && (this.gantry.etaAt(w, w.player.x) < 6 || this.gantry.state === 'pass' || this.liveLeft(this.rear + 1) > 0))) return;
      // long enough to walk off the car: at least 3 s, more from the far end
      const walk = (TRAIN.cars[this.rear].x1 + TRAIN.gapW + 10 - w.player.x) / 110;
      this.detachDur = busy ? clamp(walk + 0.4, 3, 4.5) : 1.5;
      this.detachT = this.detachDur;
      this.detachBusy = busy;
      this.sirenT = 0;
      const gp = TRAIN.gaps[this.rear];
      w.fx.label(gp.cx, w.bounds.y + 24, '车厢脱钩', COL.danger, 1.4);
      return;
    }
    // the player stepped onto a car that was leaving empty: give them time to get off again
    if (!this.detachBusy && this.playerOnRear(w)) {
      this.detachBusy = true;
      this.detachT = Math.max(this.detachT, 2.5);
      this.detachDur = Math.max(this.detachDur, this.detachT);
    }
    // the car the player has to step onto went live: wait for it
    const ahead = this.liveLeft(this.rear + 1);
    if (ahead > 0 && this.playerOnRear(w) && this.detachT < ahead + 1.2) {
      this.detachT = ahead + 1.2;
      this.detachDur = Math.max(this.detachDur, this.detachT);
    }
    this.detachT -= dt;
    this.sirenT -= dt;
    if (this.sirenT <= 0) { if (this.playerOnRear(w)) w.sfx('siren', 0.6, 1.4); this.sirenT = 0.5; }
    if (this.detachT <= 0) {
      this.detachT = -1;
      this.detach(w);
      this.uncoupleT = this.uncoupleEvery;
    }
  }

  /** The rear car (and the gap in front of it) falls behind. */
  detach(w: World): void {
    const car = TRAIN.cars[this.rear];
    const next = TRAIN.cars[this.rear + 1];
    if (!next) return;
    this.rear++;
    this.drifting.push({ i: car.i, t: 0 });
    const left = next.x0;
    // devices and props on it are gone
    for (const c of this.covers) if (c.x < left) { c.collapse(w, true); c.dead = true; }
    for (const b of w.bodies) if (!b.dead && b.team === 'neutral' && b.x < left) { b.dead = true; if (w.player.held === b) w.player.held = null; }
    this.live[car.i].warn = this.live[car.i].on = 0;
    // move the rear wall and the playable bounds forward
    const T = 64, B = TRAIN.bounds;
    if (this.rearWall) w.walls = w.walls.filter((r) => r !== this.rearWall);
    this.rearWall = { x: B.x - T, y: B.y - T, w: left - (B.x - T), h: B.h + 2 * T };
    w.walls.push(this.rearWall);
    const right = w.bounds.x + w.bounds.w;
    w.bounds.x = left;
    w.bounds.w = right - left;
    w.sfx('crash', 0.8, 0.6);
    w.fx.shake(3, 0.2);
    // anyone still on it is thrown onto the next car
    const p = w.player;
    if (p.x < left + 2 && w.state === 'fight') {
      // a leap over the leaving car does not save you: you are still on it when it goes
      p.airborne = false;
      p.z = 0;
      w.fallPlayer({ x: left + 22, y: clamp(p.y, B.y + 20, B.y + B.h - 20) }, { label: '脱钩', arrive: '跳到下一节' });
      w.sfx('grapple');
    }
    const rd = this.rider;
    if (rd && rd.x < left + 8) { rd.x = left + 40; }
  }

  // ------------------------------------------------------------------ drawing
  draw(g: Gfx, w: World): void {
    const b = w.bounds;
    for (const car of TRAIN.cars) {
      if (car.i < this.rear || car.x1 < w.camX || car.x0 > w.camX + w.view.w) continue;
      const l = this.live[car.i];
      if (l.warn > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(w.realTime * 30);
        g.rect(car.x0, b.y, car.x1 - car.x0, b.h, COL.danger, 0.1 + 0.15 * (1 - l.warn / LIVE_WARN));
        g.strokeRect(car.x0 + 1, b.y + 1, car.x1 - car.x0 - 2, b.h - 2, 1, COL.danger, 0.6 + 0.4 * pulse);
      } else if (l.on > 0) {
        g.rect(car.x0, b.y, car.x1 - car.x0, b.h, P.ice, 0.18 + 0.12 * Math.sin(w.realTime * 50));
        for (let k = 0; k < 5; k++) {
          let x = car.x0, yy = b.y + w.vrng.next() * b.h;
          while (x < car.x1) { const nx = Math.min(car.x1, x + 12 + w.vrng.next() * 10), ny = yy + w.vrng.range(-6, 6); g.line(x, yy, nx, ny, 1, P.ice, 0.8); x = nx; yy = ny; }
        }
      }
    }
    // uncoupling telegraph: the rear car and its coupling flash red
    if (this.detachT >= 0) {
      const car = TRAIN.cars[this.rear], gp = TRAIN.gaps[this.rear];
      const pulse = 0.5 + 0.5 * Math.sin(w.realTime * 20);
      const f = 1 - this.detachT / this.detachDur;
      g.rect(car.x0, b.y, gp.x1 - car.x0, b.h, COL.danger, 0.06 + 0.14 * f);
      g.strokeRect(car.x0 + 1, b.y + 1, gp.x1 - car.x0 - 2, b.h - 2, 2, COL.danger, 0.5 + 0.5 * pulse);
      g.rect(gp.x0, gp.walkY0, gp.x1 - gp.x0, gp.walkY1 - gp.walkY0, COL.danger, 0.3 + 0.4 * pulse);
    }
    this.gantry.drawFloor(g, w);
  }

  /** Floor images: scrolling scenery, then the cars (attached and falling behind). Called by the arena. */
  drawTrain(g: Gfx, w: World): void {
    const B = TRAIN.bounds, v = w.view;
    const tunnel = this.dark > 0.5;
    const yTop = B.y - TRAIN.lip, yTrack = yTop, yBot = B.y + B.h + TRAIN.side + 6;
    const sc = this.scroll;
    const tile = (key: string, frame: string, tw: number, y: number, speed: number) => {
      const off = ((sc * speed) % tw + tw) % tw;
      for (let x = Math.floor(v.x / tw) * tw - off; x < v.x + v.w + tw; x += tw) g.img(key, frame, x, y, { layer: 'floor', ox: 0, oy: 0 });
    };
    tile('train_strip_top', tunnel ? 'tunnel' : 'city', STRIP.cityW, yTop - STRIP_H.top, tunnel ? 1 : 0.35);
    tile('train_track', 'track', STRIP.trackW, yTrack, 1);
    tile('train_strip_bot', tunnel ? 'tunnel' : 'city', STRIP.cityW, yBot, tunnel ? 1 : 0.6);
    const carImg = (i: number, dx: number) => {
      const car = TRAIN.cars[i];
      const x = car.x0 + dx;
      if (x + TRAIN.carLen + TRAIN.gapW < v.x || x > v.x + v.w) return;
      const frame = i === TRAIN.cars.length - 1 ? 'loco' : i === this.rear || i === 0 ? 'rear' : i % 2 ? 'car_b' : 'car_a';
      g.img('train_car', frame, x, yTop, { layer: 'floor', ox: 0, oy: 0 });
      if (i < TRAIN.cars.length - 1) g.img('train_gap', 'gap', x + TRAIN.carLen, yTop, { layer: 'floor', ox: 0, oy: 0 });
      else g.img('train_gap', 'nose', x + TRAIN.carLen, yTop, { layer: 'floor', ox: 0, oy: 0 });
    };
    for (const d of this.drifting) carImg(d.i, -(40 * d.t + 160 * d.t * d.t));
    for (let i = this.rear; i < TRAIN.cars.length; i++) carImg(i, 0);
  }

  drawTop(g: Gfx, w: World): void {
    const b = w.bounds, v = w.view;
    // catenary wire over the car centres
    const wy = TRAIN.cars[0].panto.y - 24;
    g.line(Math.max(b.x - 20, v.x), wy, Math.min(b.x + b.w + 20, v.x + v.w), wy, 1, P.fog, 0.8, 'top');
    for (const c of TRAIN.cars) if (this.live[c.i].on > 0) g.line(c.x0, wy, c.x1, wy, 2, P.ice, 0.9, 'top');
    this.gantry.drawTop(g, w);
    if (this.detachT >= 0) {
      const gp = TRAIN.gaps[this.rear];
      g.text(`脱钩 ${Math.ceil(this.detachT)}`, gp.cx, b.y - 12, { layer: 'top', color: COL.danger, align: 'center', stroke: true, overDark: true });
      g.circle(gp.cx, b.y + b.h / 2, 26, P.red, 0.3 + 0.3 * Math.sin(w.realTime * 20), 'light');
    }
    if (this.dark > 0.02) {
      const p = w.player;
      const on = (x: number, y: number, m: number) => w.onScreen(x, y, -m);
      const holes = [{ x: p.x, y: p.y - 10, r: 66 }, ...this.holes];
      for (const bx of this.boxes) if (!bx.dead && on(bx.x, bx.y, 30)) holes.push({ x: bx.x, y: bx.y - 10, r: 26 });
      for (let i = this.rear; i < TRAIN.cars.length; i++) {
        const c = TRAIN.cars[i];
        for (const x of [c.x0 + 6, c.x1 - 6]) for (const y of [b.y + 6, b.y + b.h - 6]) if (on(x, y, 20)) holes.push({ x, y, r: 16 });
        const l = this.live[i];
        if (l.warn > 0 || l.on > 0) for (let x = c.x0 + 20; x < c.x1; x += 40) for (let y = b.y + 30; y < b.y + b.h; y += 50) if (on(x, y, 40)) holes.push({ x, y, r: 34 });
      }
      for (const e of w.bullets) if (on(e.x, e.y, 20)) holes.push({ x: e.x, y: e.y, r: 14 });
      for (const h of w.hazards) {
        if (!h.visible || h.team === 'player') continue;
        const s = h.shape;
        if (s.k === 'circle' || s.k === 'sector') { if (on(s.x, s.y, s.r + 20)) holes.push({ x: s.x, y: s.y, r: s.r + 12 }); }
        else if (s.k === 'line') {
          const n = Math.max(1, Math.ceil(dist(s.x1, s.y1, s.x2, s.y2) / 18));
          for (let i = 0; i <= n; i++) {
            const x = s.x1 + ((s.x2 - s.x1) * i) / n, y = s.y1 + ((s.y2 - s.y1) * i) / n;
            if (on(x, y, 24)) holes.push({ x, y, r: 20 });
          }
        }
      }
      const gt = this.gantry;
      if (gt.state === 'pass' && on(gt.x, b.y, 40)) for (let y = b.y - 20; y < b.y + b.h + 40; y += 30) holes.push({ x: gt.x, y, r: 30 });
      if (gt.state === 'warn' || (gt.state === 'pass' && gt.etaAt(w, p.x) < 99)) {
        holes.push({ x: v.x + v.w / 2 - 60, y: b.y - 18, r: 40 }, { x: v.x + v.w / 2 + 60, y: b.y - 18, r: 40 }, { x: v.x + v.w - 14, y: b.y + b.h / 2, r: 18 });
        for (const gp of TRAIN.gaps) if (gp.x0 >= b.x + 2) for (let y = gp.walkY0; y <= gp.walkY1; y += 30) if (on(gp.cx, y, 30)) holes.push({ x: gp.cx, y, r: 24 });
      }
      g.darkness(0.9 * clamp(this.dark, 0, 1), holes);
    }
    this.holes.length = 0;
  }
}

// =====================================================================================
// Arena
// =====================================================================================
function setup(w: World): void {
  const st = new TrainState();
  STATES.set(w, st);
  w.objects.push(st);
  // per-fight bounds: they shrink from the back when cars uncouple
  w.bounds = { ...TRAIN.bounds };
  for (const car of TRAIN.cars) {
    for (const c of car.covers) st.covers.push(w.add(new Cover(c)).attach(w));
    const box = w.add(new JunctionBox(st, car));
    st.boxes.push(box);
    st.pantos.push(w.add(new Pantograph(box, car)));
  }
}

/** Train conductors (arc chained through one of these into Vesper is boosted). */
export function isConductor(b: Body): boolean { return b instanceof Pantograph || b instanceof JunctionBox; }

/** Player shots that clear smoke and set off mines early. */
export function isClearingShot(e: Bullet): boolean { return e.team === 'player' && (e.src === 'pellet' || e.src === 'slug'); }

/** Autopilot target (see Arena.botHint). */
function hintTarget(w: World, st: TrainState): { x: number; y: number; jump: boolean } | null {
  const p = w.player;
  const b = w.bounds;
  const walk = (y: number) => clamp(y, TRAIN.gaps[0].walkY0 + 12, TRAIN.gaps[0].walkY1 - 12);
  // gantry coming: get into the nearest gap and stay there
  {
    let best: Gap | null = null, bd = Infinity;
    for (const gp of TRAIN.gaps) { if (gp.x0 < b.x + 2 || (st.detachT >= 0 && gp.i === st.rear)) continue; const d = Math.abs(gp.cx - p.x); if (d < bd) { bd = d; best = gp; } }
    if (best && st.gantry.etaAt(w, p.x) < 2.0 + bd / 100) return { x: best.cx, y: clamp(p.y, best.walkY0 + 14, best.walkY1 - 14), jump: false };
  }
  // the rear car is about to uncouple under the player: move up a car
  if (st.detachT >= 0 && p.x < TRAIN.cars[st.rear].x1 + TRAIN.gapW + 6) {
    return { x: TRAIN.cars[st.rear + 1].x0 + 30, y: walk(p.y), jump: false };
  }
  // live roof (or about to be): leave the car
  const car = carAt(p.x);
  if (car && st.liveAt(p.x, true)) {
    const l = st.live[car.i];
    // exits: the gap behind (unless it is leaving with the rear car) and the gap in front
    const backOk = car.i > st.rear && !(st.detachT >= 0 && car.i - 1 === st.rear);
    const frontOk = car.i < st.front;
    const back = backOk && (!frontOk || p.x - car.x0 < car.x1 - p.x);
    const out = back ? car.x0 - 14 : frontOk ? car.x1 + 14 : car.x0 - 14;
    return { x: clamp(out, b.x + 8, b.x + b.w - 8), y: walk(p.y), jump: l.on > 0 };
  }
  // just stepped off a live roof: stay off it
  for (const c of TRAIN.cars) {
    if (c.i < st.rear || st.liveLeft(c.i) <= 0) continue;
    if (p.x >= c.x0 - 26 && p.x < c.x0) return { x: c.x0 - 16, y: walk(p.y), jump: false };
    if (p.x >= c.x1 && p.x < c.x1 + 26) return { x: c.x1 + 16, y: walk(p.y), jump: false };
  }
  // she is far ahead (beyond the autopilot's targeting): run along the train after her
  const v = w.boss;
  if (v && !v.dying && Math.abs(v.x - p.x) > 560) {
    return { x: clamp(v.x - Math.sign(v.x - p.x) * 260, b.x + 20, b.x + b.w - 20), y: walk(p.y), jump: false };
  }
  return null;
}

/** Autopilot: walk around standing cover instead of pushing into it. */
function detour(w: World, st: TrainState, x: number, y: number): { x: number; y: number } {
  const p = w.player;
  const d = dist(p.x, p.y, x, y);
  if (d < 2) return { x, y };
  const dx = (x - p.x) / d, dy = (y - p.y) / d;
  for (const c of st.covers) {
    if (c.broken || c.dead) continue;
    const r = c.wall, m = p.r + 3;
    const t = rayRect(p.x, p.y, dx, dy, { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
    if (t > d) continue;
    const up = r.y - m - 4, down = r.y + r.h + m + 4;
    const b = w.bounds;
    const wy = (Math.abs(p.y - up) < Math.abs(p.y - down) && up > b.y + 6) || down > b.y + b.h - 6 ? up : down;
    return { x: clamp(p.x + dx * 30, r.x - m - 2, r.x + r.w + m + 2), y: wy };
  }
  return { x, y };
}

export const train: Arena = {
  id: 'train',
  bg: 'bg_train',
  size: TRAIN.size,
  bounds: TRAIN.bounds,
  playerSpawn: TRAIN.playerSpawn,
  setup,
  update(w: World) {
    if (!w.player.airborne) keepOffDrops(w.player);
  },
  camera(w: World) {
    const p = w.player, v = w.boss;
    const lean = v && !v.dying ? clamp((v.x - p.x) * 0.35, -170, 170) : 0;
    return { x: p.x + lean, y: w.size.h / 2 };
  },
  botHint(w: World) {
    const st = trainOf(w);
    if (!st) return null;
    const h = hintTarget(w, st);
    return h ? { ...detour(w, st, h.x, h.y), jump: h.jump } : null;
  },
  drawFloor(g: Gfx, w: World) {
    const st = trainOf(w);
    if (!st) return;
    st.drawTrain(g, w);
    const b = w.bounds;
    // warning lamps at the car corners, window light along the car sides
    const blink = Math.floor(w.realTime * 2) % 2 === 0;
    for (let i = st.rear; i < TRAIN.cars.length; i++) {
      const c = TRAIN.cars[i];
      if (c.x1 < w.camX - 20 || c.x0 > w.camX + w.view.w + 20) continue;
      for (const x of [c.x0 + 6, c.x1 - 6]) for (const y of [b.y + 6, b.y + b.h - 6]) g.circle(x, y, 6, P.red, blink ? 0.45 : 0.15, 'light');
      g.rect(c.x0 + 6, b.y + b.h + 10, c.x1 - c.x0 - 12, 5, P.amber, 0.06, 'light');
    }
  },
};
