/**
 * Modular construction site. Four rooms ride rails; the corridors between them are "bands" that
 * the rooms can close (squeeze) by sliding toward each other, carrying everything on them.
 *
 * Layout (map 880x608, bounds 24..856 x 56..584):
 *   rooms 280x168 at (88,112) (512,112) (88,376) (512,376), each with a back wall split by a door;
 *   band 0/1 = the vertical corridor beside the top/bottom row, band 2/3 = the horizontal corridor
 *   under the left/right column; the hub (368..512 x 280..376) is never closed and holds the press.
 * Rooms only ever move between their base position and the squeezed position, so no gap can
 * wedge a body against the outer walls and no area stays sealed.
 */
import { FOLD_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { dist, rayRect, type Rect } from '../../engine/math';
import { Body } from '../body';
import { Hazard } from '../hazard';
import { Barrel, Pillar } from '../props';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

export const ROOM_W = 280;
export const ROOM_H = 168;
const BASES: [number, number][] = [[88, 112], [512, 112], [88, 376], [512, 376]];
/** Press zone: the hub between the four rooms. */
export const HUB: Rect = { x: 368, y: 280, w: 144, h: 96 };
const PRESS_ZONE: Rect = { x: 372, y: 284, w: 136, h: 88 };
/** Rows slide horizontally by 72 each (gap 144 -> 0), columns vertically by 48 (gap 96 -> 0). */
const ROW_SHIFT = 72;
const COL_SHIFT = 48;
const CLOSE = 0.4;
const OPEN = 0.6;

interface BandDef { axis: 'row' | 'col'; a: number; b: number }
/** a = left/top room, b = right/bottom room. */
export const BANDS: BandDef[] = [{ axis: 'row', a: 0, b: 1 }, { axis: 'row', a: 2, b: 3 }, { axis: 'col', a: 0, b: 2 }, { axis: 'col', a: 1, b: 3 }];

export interface RailRoom {
  id: number; x: number; y: number; baseX: number; baseY: number;
  /** Position at the start of the current move and its goal. */
  sx: number; sy: number; tx: number; ty: number;
  walls: Rect[];
}

interface Squeeze {
  bands: number[];
  by: 'boss' | 'env';
  stage: 'warn' | 'close' | 'hold' | 'open';
  /** Seconds into the current moving stage. */
  t: number;
  hold: number;
  hazards: Hazard[];
  crushed: boolean;
}

const states = new WeakMap<World, FoundryState>();
export const foundryOf = (w: World): FoundryState | undefined => states.get(w);
const inside = (p: { x: number; y: number }, r: RailRoom) => p.x >= r.x && p.x <= r.x + ROOM_W && p.y >= r.y && p.y <= r.y + ROOM_H;
const inRect = (x: number, y: number, r: Rect, m = 0) => x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;
/** Room-relative spots, mirrored for the right column so consoles face the hub. */
const spot = (r: RailRoom, rx: number, ry: number): [number, number] => [r.x + (r.id % 2 ? ROOM_W - rx : rx), r.y + ry];

function circleInWall(w: World, x: number, y: number, r: number): boolean {
  for (const q of w.walls) {
    const cx = Math.max(q.x, Math.min(x, q.x + q.w)), cy = Math.max(q.y, Math.min(y, q.y + q.h));
    if ((x - cx) ** 2 + (y - cy) ** 2 < (r - 0.5) ** 2) return true;
  }
  return false;
}

/** Nearest point to (x, y) where a circle of radius r overlaps no wall (spiral search). */
export function freeSpot(w: World, x: number, y: number, r: number): [number, number] {
  const b = w.bounds;
  const cl = (px: number, py: number): [number, number] => [Math.max(b.x + r, Math.min(b.x + b.w - r, px)), Math.max(b.y + r, Math.min(b.y + b.h - r, py))];
  [x, y] = cl(x, y);
  if (!circleInWall(w, x, y, r)) return [x, y];
  for (let d = 6; d <= 160; d += 6) for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, [px, py] = cl(x + Math.cos(a) * d, y + Math.sin(a) * d);
    if (!circleInWall(w, px, py, r)) return [px, py];
  }
  return [x, y];
}

/** Push a circle out of walls, and if that leaves it inside another wall, move it to a free spot. */
export function unstick(w: World, o: { x: number; y: number; r: number }, ignore?: Body): void {
  w.moveCircle(o, 0, 0, { ignore, solids: false });
  if (circleInWall(w, o.x, o.y, o.r)) [o.x, o.y] = freeSpot(w, o.x, o.y, o.r);
}

/** Steel column on a room: cover, arc node, grapple anchor. A charge stops on it without breaking it. */
class RoomPillar extends Pillar {
  onRammed(w: World): boolean {
    w.fx.debris(this.x, this.y - 16, 8, [P.slate, P.steel, P.amber], 120);
    return true;
  }
}

/**
 * Steel beam dropped by Fold: a temporary low wall (axis-aligned rect) that blocks movement and
 * shots, conducts the arc and rides the room it lies on. Slugs, explosions and squeezes break it;
 * a charge into it staggers Fold.
 */
export class SteelBeam extends Body {
  readonly wall: Rect;
  private life: number;
  constructor(readonly st: FoundryState, x: number, y: number, readonly horizontal: boolean, life: number) {
    super();
    this.x = x; this.y = y; this.r = 6; this.hz = 5; this.hr = 8; this.mass = 0;
    this.conductive = true; this.targetable = false; this.grapple = 'anchor';
    this.life = life;
    this.wall = horizontal ? { x: x - 56, y: y - 6, w: 112, h: 12 } : { x: x - 6, y: y - 56, w: 12, h: 112 };
  }
  update(w: World, dt: number): void {
    this.life -= dt; this.flash = Math.max(0, this.flash - dt);
    this.syncWall();
    // a slug punches straight through: walls stop bullets before body collisions, so check here
    for (const b of w.bullets) if (!b.dead && b.team === 'player' && b.src === 'slug' && inRect(b.x, b.y, this.wall, 4)) { this.shatter(w); return; }
    if (this.life <= 0) this.shatter(w);
  }
  syncWall(): void {
    this.wall.x = this.horizontal ? this.x - 56 : this.x - 6;
    this.wall.y = this.horizontal ? this.y - 6 : this.y - 56;
  }
  hurt(w: World, h: Hit): number {
    if (h.kind === 'blast' || h.kind === 'crush' || h.src === 'slug' || h.src === 'iaido') this.shatter(w);
    else this.flash = 0.06;
    return 0;
  }
  shatter(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.walls = w.walls.filter(r => r !== this.wall);
    this.st.beams = this.st.beams.filter(b => b !== this);
    w.fx.debris(this.x, this.y - 6, 10, [P.steel, P.slate, P.orange], 120); w.sfx('crash', 0.4);
  }
  draw(g: Gfx): void {
    const r = this.wall, blink = this.life < 1.5 && Math.floor(this.life * 8) % 2 === 0;
    g.rect(r.x + 2, r.y + 4, r.w, r.h, P.ink, 0.45, 'floor');
    g.rect(r.x, r.y, r.w, r.h, this.flash > 0 ? P.pale : P.slate, 1);
    g.strokeRect(r.x, r.y, r.w, r.h, 1, P.ink, 1);
    if (this.horizontal) {
      g.line(r.x + 1, r.y + 3, r.x + r.w - 1, r.y + 3, 1, blink ? P.amber : P.steel, 1);
      for (let x = r.x + 8; x < r.x + r.w; x += 16) g.rect(x, r.y + 6, 2, 2, P.orange, 1);
    } else {
      g.line(r.x + 3, r.y + 1, r.x + 3, r.y + r.h - 1, 1, blink ? P.amber : P.steel, 1);
      for (let y = r.y + 8; y < r.y + r.h; y += 16) g.rect(r.x + 6, y, 2, 2, P.orange, 1);
    }
  }
}

class FoundryDevice extends Body {
  cd = 0;
  private hits = 0;
  private shock = 0;
  private shockAt = -9;
  constructor(readonly st: FoundryState, readonly mode: 'route' | 'brake' | 'press', x: number, y: number, readonly band = -1) {
    super(); this.x = x; this.y = y; this.r = 9; this.hz = 12; this.hr = 12; this.mass = 0;
    this.solid = true; this.conductive = true; this.hackable = true; this.interactable = true; this.grapple = 'anchor';
    this.interactLabel = T[mode];
  }
  update(w: World, dt: number): void { this.cd = Math.max(0, this.cd - dt); this.flash = Math.max(0, this.flash - dt); if (w.time - this.shockAt > 0.06 || this.cd > 0) this.shock = 0; }
  private use(w: World): void {
    if (this.cd > 0 || w.state !== 'fight' || w.boss?.dying) return;
    let ok = false;
    if (this.mode === 'route') ok = this.st.startSqueeze(w, [this.band], 'env', 1.2);
    else if (this.mode === 'brake') ok = this.st.brake(w);
    else ok = this.st.startPress(w);
    if (!ok) { w.sfx('click', 0.5); this.hits = 0; return; }
    this.cd = this.mode === 'route' ? 10 : this.mode === 'brake' ? 12 : 14;
    this.hits = this.shock = 0; this.flash = 0.1; w.sfx('lever', 0.6);
  }
  hurt(w: World, h: Hit): number {
    if (h.from !== 'player' || this.cd > 0 || h.quiet || h.kind === 'fire') return 0;
    this.hits++; this.flash = 0.06;
    if (h.src === 'slug' || h.kind === 'impact' || h.kind === 'blast' || this.hits >= 4) this.use(w);
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    if (this.cd > 0) return;
    this.shockAt = w.time; this.shock += dt;
    if (this.shock >= 0.5) this.use(w);
  }
  onHack(w: World): void { this.use(w); }
  onEmp(w: World): void { this.use(w); }
  onInteract(w: World): void { this.use(w); }
  draw(g: Gfx): void {
    g.ellipse(this.x, this.y, 12, 5, P.ink, 0.45);
    g.img('archive_dev', this.mode + (this.cd <= 0 ? '_on' : '_off'), this.x, this.y + 4, { fill: this.flash > 0 ? P.pale : undefined });
    if (this.cd <= 0) g.circle(this.x, this.y - 17, 13, this.mode === 'brake' ? P.red : P.amber, 0.15, 'light');
    else g.crisp(`${Math.ceil(this.cd)}`, this.x, this.y - 38, { align: 'center', color: P.steel, layer: 'top' });
  }
}

export class FoundryState {
  rooms: RailRoom[] = [];
  beams: SteelBeam[] = [];
  consoles: FoundryDevice[] = [];
  squeeze: Squeeze | null = null;
  pressT = 0;
  brakeT = 0;
  /** Set by Fold while a charge or a crane hop is under way (the brake catches him). */
  exposed = false;
  /** Set by Fold while he is in the air (rooms do not carry him). */
  airborne = false;
  private barrels: (Barrel | null)[] = [null, null, null, null];
  private barrelT = [0, 0, 0, 0];

  constructor(w: World) {
    for (const [i, [x, y]] of BASES.entries()) {
      const walls = [{ x: x + 12, y: y + 10, w: 98, h: 10 }, { x: x + 170, y: y + 10, w: 98, h: 10 }];
      this.rooms.push({ id: i, x, y, baseX: x, baseY: y, sx: x, sy: y, tx: x, ty: y, walls });
      w.walls.push(...walls);
    }
  }

  get busy(): boolean { return !!this.squeeze; }
  get closing(): boolean { return this.squeeze?.stage === 'warn' || this.squeeze?.stage === 'close'; }

  /** Current open gap of a band (zero width/height when closed). */
  bandRect(i: number): Rect {
    const d = BANDS[i], a = this.rooms[d.a], b = this.rooms[d.b];
    return d.axis === 'row'
      ? { x: a.x + ROOM_W, y: a.y, w: Math.max(0, b.x - a.x - ROOM_W), h: ROOM_H }
      : { x: a.x, y: a.y + ROOM_H, w: ROOM_W, h: Math.max(0, b.y - a.y - ROOM_H) };
  }
  /** Which band a ground point stands in (-1: a room, the hub or a margin). */
  bandOf(x: number, y: number): number {
    if (this.rooms.some(r => inside({ x, y }, r))) return -1;
    for (let i = 0; i < BANDS.length; i++) if (inRect(x, y, this.bandRect(i))) return i;
    return -1;
  }
  /** The band and its partner on the same axis (both rows or both columns). */
  axisBands(i: number): number[] { return BANDS[i].axis === 'row' ? [0, 1] : [2, 3]; }
  /** The closest point just outside band i from (x, y): onto a room, the hub or a margin. */
  nearestExit(i: number, x: number, y: number): { x: number; y: number } | null {
    const g = this.bandRect(i);
    if (!inRect(x, y, g)) return null;
    const cands = BANDS[i].axis === 'row'
      ? [{ x: g.x - 22, y }, { x: g.x + g.w + 22, y }, { x, y: g.y - 22 }, { x, y: g.y + g.h + 22 }]
      : [{ x, y: g.y - 22 }, { x, y: g.y + g.h + 22 }, { x: g.x - 22, y }, { x: g.x + g.w + 22, y }];
    return cands.reduce((a, b) => (dist(a.x, a.y, x, y) <= dist(b.x, b.y, x, y) ? a : b));
  }
  roomOf(x: number, y: number): RailRoom | undefined { return this.rooms.find(r => inside({ x, y }, r)); }
  inPress(x: number, y: number): boolean { return inRect(x, y, PRESS_ZONE); }

  startSqueeze(w: World, bands: number[], by: 'boss' | 'env', warn: number): boolean {
    if (this.squeeze || !bands.length || w.boss?.dying) return false;
    const hazards: Hazard[] = [];
    for (const i of bands) {
      const d = BANDS[i], a = this.rooms[d.a], b = this.rooms[d.b];
      for (const r of [a, b]) { r.sx = r.x; r.sy = r.y; }
      if (d.axis === 'row') { a.tx = a.baseX + ROW_SHIFT; b.tx = b.baseX - ROW_SHIFT; }
      else { a.ty = a.baseY + COL_SHIFT; b.ty = b.baseY - COL_SHIFT; }
      const h = new Hazard({ k: 'rect', ...this.bandRect(i) }, warn, CLOSE);
      h.dmg = by === 'boss' ? 2 : 1; h.marker = true; h.team = by === 'boss' ? 'enemy' : 'env';
      if (by === 'boss') h.owner = w.boss; else h.cancelable = false;
      h.onTick = (_w, hz) => { if (!hz.warning) hz.shape = { k: 'rect', ...this.bandRect(i) }; };
      hazards.push(w.addHazard(h));
    }
    this.squeeze = { bands, by, stage: 'warn', t: 0, hold: by === 'boss' ? 1.1 : 0.9, hazards, crushed: false };
    w.sfx('siren', 0.55);
    return true;
  }

  /** Emergency brake: cancels or reopens a squeeze; catches Fold riding it, charging or hopping. */
  brake(w: World): boolean {
    const sq = this.squeeze, boss = w.boss, part = boss?.parts[0];
    if (!sq && !this.exposed) return false;
    let caught = this.exposed;
    if (sq && part) {
      const moving = sq.bands.flatMap(i => [this.rooms[BANDS[i].a], this.rooms[BANDS[i].b]]);
      if (moving.some(r => inside(part, r))) caught = true;
    }
    if (sq) {
      if (sq.stage === 'warn') this.abort(w);
      else if (sq.stage !== 'open') this.beginOpen();
    }
    this.brakeT = 1.2;
    if (caught && boss && part && !boss.dying) {
      boss.stagger(w, 2.6);
      w.damage(part, { dmg: 80, kind: 'impact', x: part.hx, y: part.hy, from: 'env', src: 'rail_brake' });
    }
    w.fx.shake(4, 0.2); w.sfx('crash', 0.6);
    return true;
  }

  startPress(w: World): boolean {
    if (this.pressT > 0) return false;
    this.pressT = 1.25;
    const h = new Hazard({ k: 'rect', ...PRESS_ZONE }, 1.1, 0.16);
    h.team = 'env'; h.marker = true; h.dmg = 1; h.cancelable = false;
    h.onActivate = () => {
      const boss = w.boss, part = boss?.parts[0];
      if (boss && part && !boss.dying && inRect(part.x, part.y, PRESS_ZONE, part.r)) {
        boss.stagger(w, 3);
        w.damage(part, { dmg: 260, kind: 'crush', x: part.hx, y: part.hy, from: 'env', src: 'assembly_press', armorBreak: 1 });
      }
      for (const b of w.bodies) if (!b.dead && b.team !== 'enemy' && b.mass > 0 && inRect(b.x, b.y, PRESS_ZONE, b.r)) {
        w.damage(b, { dmg: 30, kind: 'crush', x: b.hx, y: b.hy, from: 'env', src: 'assembly_press' });
      }
      for (const b of [...this.beams]) if (inRect(b.x, b.y, PRESS_ZONE)) b.shatter(w);
      w.fx.debris(440, 330, 16, [P.steel, P.sodium], 120); w.fx.shake(5, 0.2); w.sfx('crush');
    };
    w.addHazard(h); w.sfx('siren', 0.7);
    return true;
  }

  dropBeam(w: World, x: number, y: number, horizontal: boolean, life: number): void {
    while (this.beams.length >= 4) this.beams[0].shatter(w);
    const b = new SteelBeam(this, x, y, horizontal, life);
    w.add(b); this.beams.push(b); w.walls.push(b.wall);
    w.fx.debris(x, y - 4, 12, [P.steel, P.orange, P.slate], 110); w.fx.shake(3, 0.12); w.sfx('land', 0.8);
    this.resolve(w);
  }
  /** A beam whose wall touches this circle (charge impacts). */
  beamAt(x: number, y: number, r: number): SteelBeam | undefined {
    return this.beams.find(b => {
      const q = b.wall, cx = Math.max(q.x, Math.min(x, q.x + q.w)), cy = Math.max(q.y, Math.min(y, q.y + q.h));
      return (x - cx) ** 2 + (y - cy) ** 2 <= (r + 1.5) ** 2;
    });
  }
  /** Ray against structural walls only (beams are left out: Fold does not plan around them). */
  rayStructure(w: World, ox: number, oy: number, dx: number, dy: number, max: number): number {
    let best = max;
    for (const r of w.walls) if (!this.beams.some(b => b.wall === r)) best = Math.min(best, rayRect(ox, oy, dx, dy, r));
    return best;
  }

  private abort(w: World): void {
    const sq = this.squeeze;
    if (!sq) return;
    for (const h of sq.hazards) h.dead = true;
    for (const r of this.rooms) { r.tx = r.baseX; r.ty = r.baseY; }
    this.squeeze = null;
    w.sfx('click', 0.5);
  }
  private beginOpen(): void {
    const sq = this.squeeze;
    if (!sq) return;
    for (const h of sq.hazards) h.dead = true;
    sq.stage = 'open'; sq.t = 0;
    for (const r of this.rooms) { r.sx = r.x; r.sy = r.y; r.tx = r.baseX; r.ty = r.baseY; }
  }

  update(w: World, dt: number): void {
    this.pressT = Math.max(0, this.pressT - dt);
    this.brakeT = Math.max(0, this.brakeT - dt);
    const ended = w.state === 'won' || w.state === 'lost' || !!w.boss?.dying;
    if (ended && this.squeeze && this.squeeze.stage !== 'open') {
      if (this.squeeze.stage === 'warn') this.abort(w); else this.beginOpen();
    }
    if (w.state === 'fight' && !ended) this.respawnBarrels(w, dt);
    if (w.state !== 'fight' || ended) {
      this.exposed = this.airborne = false;
      if (!ended || this.squeeze?.stage !== 'open') return;
    }
    const sq = this.squeeze;
    if (!sq) return;
    if (sq.stage === 'warn') {
      // the warning is the hazard: when it is cancelled (stagger) the squeeze is called off
      if (sq.hazards.some(h => h.dead)) { this.abort(w); return; }
      if (sq.hazards.every(h => !h.warning)) { sq.stage = 'close'; sq.t = 0; w.sfx('crush', 0.7); w.fx.shake(4, 0.25); }
      return;
    }
    if (sq.stage === 'hold') {
      sq.t += dt;
      if (sq.t >= sq.hold) this.beginOpen();
      return;
    }
    const dur = sq.stage === 'close' ? CLOSE : OPEN;
    sq.t = Math.min(dur, sq.t + dt);
    const k = sq.t / dur, e = k * k * (3 - 2 * k);
    const moves = new Map<RailRoom, [number, number]>();
    for (const r of this.rooms) {
      const nx = r.sx + (r.tx - r.sx) * e, ny = r.sy + (r.ty - r.sy) * e;
      if (nx !== r.x || ny !== r.y) moves.set(r, [nx - r.x, ny - r.y]);
    }
    this.slide(w, moves);
    if (sq.stage === 'close') this.crush(w, sq);
    if (sq.t >= dur) {
      if (sq.stage === 'close') { sq.stage = 'hold'; sq.t = 0; w.sfx('land', 0.6); }
      else { this.squeeze = null; w.sfx('land', 0.35); }
    }
  }

  /** Move rooms and everything standing on them; then push anything a wall swept into. */
  private slide(w: World, moves: Map<RailRoom, [number, number]>): void {
    if (!moves.size) return;
    const p = w.player, part = w.boss?.parts[0];
    const owner = (x: number, y: number) => { for (const [r, d] of moves) if (inside({ x, y }, r)) return d; return null; };
    const pd = !p.airborne ? owner(p.x, p.y) : null;
    const bodyMoves: [Body, [number, number]][] = [];
    for (const b of w.bodies) {
      if (b.dead || (b === part && this.airborne)) continue;
      const d = owner(b.x, b.y);
      if (d) bodyMoves.push([b, d]);
    }
    const bulletMoves: [typeof w.bullets[number], [number, number]][] = [];
    for (const b of w.bullets) if (!b.dead && b.floorBound) { const d = owner(b.x, b.y); if (d) bulletMoves.push([b, d]); }
    for (const [r, [dx, dy]] of moves) p.weapon.carryFloor({ x: r.x, y: r.y, w: ROOM_W, h: ROOM_H }, dx, dy);
    if (pd) { p.x += pd[0]; p.y += pd[1]; }
    for (const [b, [dx, dy]] of bodyMoves) {
      b.x += dx; b.y += dy;
      if (b instanceof SteelBeam) b.syncWall();
    }
    for (const [b, [dx, dy]] of bulletMoves) { b.x += dx; b.y += dy; }
    for (const [r, [dx, dy]] of moves) {
      r.x += dx; r.y += dy;
      r.walls[0].x = r.x + 12; r.walls[1].x = r.x + 170;
      r.walls[0].y = r.walls[1].y = r.y + 10;
    }
    this.resolve(w);
  }

  /** Push the player, props and Fold out of walls (no damage); never leave anyone inside one. */
  resolve(w: World): void {
    unstick(w, w.player);
    for (const b of w.bodies) if (!b.dead && b.mass > 0) unstick(w, b, b);
    const boss = w.boss, part = boss?.parts[0];
    if (boss && part && !this.airborne) { unstick(w, part, part); boss.x = part.x; boss.y = part.y; }
  }

  /** While closing: Fold caught in a gap is crushed; barrels burst; beams snap. */
  private crush(w: World, sq: Squeeze): void {
    const boss = w.boss, part = boss?.parts[0];
    for (const i of sq.bands) {
      const g = this.bandRect(i);
      if (!sq.crushed && boss && part && !boss.dying && !this.airborne && inRect(part.x, part.y, g)) {
        sq.crushed = true;
        boss.stagger(w, 3);
        w.damage(part, { dmg: 220, kind: 'crush', x: part.hx, y: part.hy, from: 'env', src: 'room_squeeze' });
        w.fx.debris(part.x, part.y - 20, 18, [P.steel, P.amber, P.orange], 160);
      }
      for (const b of w.bodies) if (!b.dead && b instanceof Barrel && inRect(b.x, b.y, g)) b.explode(w);
      for (const b of [...this.beams]) if (inRect(b.x, b.y, g)) b.shatter(w);
    }
  }

  /** Each room keeps one fuel barrel: a destroyed one comes back 16 s later. */
  private respawnBarrels(w: World, dt: number): void {
    for (const r of this.rooms) {
      const b = this.barrels[r.id];
      if (b && !b.dead) continue;
      if (b) { this.barrels[r.id] = null; this.barrelT[r.id] = 16; }
      if ((this.barrelT[r.id] -= dt) > 0) continue;
      const [x, y] = spot(r, 56, 130);
      if (this.squeeze || w.bodies.some(o => !o.dead && o.solid && dist(o.x, o.y, x, y) < o.r + 10) || dist(w.player.x, w.player.y, x, y) < 16) continue;
      this.barrels[r.id] = w.add(new Barrel(x, y));
      if (w.state === 'fight') w.fx.ring(x, y - 6, 4, 18, P.amber, 0.3, 1);
    }
  }

  drawFloor(g: Gfx, w: World): void {
    for (const r of this.rooms) {
      g.img('fold_room', String(r.id), r.x, r.y, { layer: 'floor', ox: 0, oy: 0 });
      g.crisp(T.rooms[r.id], r.x + 140, r.y + 32, { align: 'center', color: P.fog, layer: 'floor' });
    }
    const sq = this.squeeze;
    if (sq) {
      const c = sq.stage === 'open' ? P.steel : P.amber;
      for (const i of sq.bands) {
        const d = BANDS[i], a = this.rooms[d.a], b = this.rooms[d.b];
        // rail arrows from each room toward the seam
        for (const r of [a, b]) {
          const x = r.x + ROOM_W / 2, y = r.y + ROOM_H / 2, dx = r.tx - r.x, dy = r.ty - r.y;
          if (Math.abs(dx) + Math.abs(dy) < 1) continue;
          g.line(x, y, x + Math.sign(dx) * 40, y + Math.sign(dy) * 40, 3, c, 0.6, 'floor');
          g.ring(x + Math.sign(dx) * 40, y + Math.sign(dy) * 40, 5, 2, c, 0.8, 'floor');
        }
      }
    }
    if (this.pressT <= 0 && w.boss && !w.boss.dying) {
      const part = w.boss.parts[0];
      if (part && inRect(part.x, part.y, PRESS_ZONE)) g.strokeRect(PRESS_ZONE.x, PRESS_ZONE.y, PRESS_ZONE.w, PRESS_ZONE.h, 1, P.amber, 0.5, 'floor');
    }
  }
  drawTop(g: Gfx): void {
    if (this.pressT > 0) {
      const z = this.pressT > 0.15 ? 60 * (this.pressT - 0.15) / 1.1 : 0, Z = PRESS_ZONE;
      g.rect(Z.x + 4, Z.y - 2 - z, Z.w - 8, 18, P.slate, 0.85, 'top'); g.line(Z.x + 4, Z.y + 16 - z, Z.x + Z.w - 4, Z.y + 16 - z, 3, P.orange, 0.9, 'top');
    }
    if (this.brakeT > 0) g.crisp(T.stopped, 440, 60, { color: P.ice, align: 'center', layer: 'top' });
  }
}

export const foundry: Arena = {
  id: 'foundry', bg: 'bg_foundry', size: { w: 880, h: 608 }, bounds: { x: 24, y: 56, w: 832, h: 528 },
  playerSpawn: { x: 240, y: 476 },
  setup(w) {
    const st = new FoundryState(w); states.set(w, st); w.objects.push(st);
    // each room's console closes the band on its hub side: top-left -> top row, top-right -> right column...
    const consoleBand = [0, 3, 2, 1];
    for (const r of st.rooms) {
      st.consoles.push(w.add(new FoundryDevice(st, 'route', ...spot(r, 236, 128), consoleBand[r.id])));
      w.add(new RoomPillar(...spot(r, 100, 74)));
    }
    w.add(new FoundryDevice(st, 'brake', 440, 84));
    w.add(new FoundryDevice(st, 'press', 440, 566));
  },
  drawFloor(g, w) { foundryOf(w)?.drawFloor(g, w); },
  botHint(w) {
    const st = foundryOf(w), p = w.player;
    if (!st) return null;
    if (st.closing) for (const i of st.squeeze!.bands) {
      const g = st.bandRect(i);
      if (!inRect(p.x, p.y, g, 8) || st.roomOf(p.x, p.y)) continue;
      // step onto the nearer room: the floor carries you instead of crushing you
      if (BANDS[i].axis === 'row') return { x: p.x - g.x < g.x + g.w - p.x ? g.x - 26 : g.x + g.w + 26, y: Math.max(g.y + 34, Math.min(g.y + g.h - 20, p.y)), jump: false };
      return { x: p.x, y: p.y - g.y < g.y + g.h - p.y ? g.y - 24 : g.y + g.h + 34, jump: false };
    }
    if (st.pressT > 0.15 && inRect(p.x, p.y, PRESS_ZONE, 8)) {
      return { x: p.x < 440 ? PRESS_ZONE.x - 20 : PRESS_ZONE.x + PRESS_ZONE.w + 20, y: p.y, jump: false };
    }
    // Fold standing in a corridor next to a ready console: go and close it on him
    const part = w.boss?.parts[0];
    if (part && !st.busy && !w.boss?.staggered) {
      const band = st.bandOf(part.x, part.y), c = st.consoles.find(c => c.band === band && c.cd <= 0);
      if (band >= 0 && c && dist(p.x, p.y, c.x, c.y) < 70) return { x: c.x, y: c.y + 16, jump: false };
    }
    return null;
  },
};
