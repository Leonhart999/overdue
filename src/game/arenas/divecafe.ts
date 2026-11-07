/**
 * Dive cafe (Wren): one 960x540 map with two layers that share coordinates.
 *
 *   real  booths, bar counter, server racks (conductive, block shots), fuel drums, 4 dive pods
 *   net   firewall walls in other places, 4 one-way data streams, firewall ports (Wren's shield),
 *         the 4 pods are exit nodes here
 *
 * The player is in one layer at a time (`DiveState.layer`). `w.walls` is swapped to that layer's
 * wall set, and every layered body that is not in the player's layer is taken out of `w.bodies`
 * (it neither hits nor can be hit, the arena draws it as a faint ghost). Enemy bullets
 * (`WrenBullet`) and hazards registered with `DiveState.addHazard` carry a layer and only touch the
 * player when it matches.
 *
 * Diving: E at a pod, 0.5 s later the player is in the net at the same spot; the body stays in the
 * pod. E at any exit node, 0.4 s later the player is back in reality at that node's pod.
 * Pulling the plug (`pullPlug`): 1 heart, forced exit at the body's pod, 0.6 s stun.
 *
 * Per-fight state lives in a DiveState object in `w.objects`, found with diveOf(w).
 */
import { P, type Gfx } from '../../engine/gfx';
import { clamp, dist, pointInRect, rayRect, type Rect } from '../../engine/math';
import { tierHp } from '../boss';
import { Body } from '../body';
import { Bullet } from '../bullet';
import { Hazard } from '../hazard';
import { Barrel } from '../props';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

export type Layer = 'real' | 'net';
export type Pt = { x: number; y: number };

/** In-game text for this fight (plain rule text). */
export const WREN_TEXT = {
  name: '潜网客·芮恩',
  dive: '潜网', exit: '退出网络',
  real: '现实层', net: '网络层',
  plug: '拔线', plugWarn: '她在拔线',
  shieldBreak: '护盾崩溃', shieldBack: '护盾恢复', ports: '端口', shieldOff: '护盾下线',
  reroute: '数据流改向', portDown: '端口离线',
  phase2: '她也会潜网', phase3: '强制换层 · 每 8 秒',
  swap: '换层', wake: '回到身体', diving: '潜网中',
  hint: '潜入舱潜网 · 打掉网络层端口破盾 · 潜网时她会来拔线',
} as const;
const T = WREN_TEXT;

// ------------------------------------------------------------------ layout
export const DIVE_MAP = { w: 960, h: 540 };
export const DIVE_BOUNDS: Rect = { x: 24, y: 56, w: 912, h: 460 };
/** Player dive pods (real) = exit nodes (net). Ground points. */
export const PODS: readonly Pt[] = [{ x: 88, y: 112 }, { x: 872, y: 112 }, { x: 88, y: 466 }, { x: 872, y: 466 }];
/** Wren's own pod (real only). */
export const WREN_POD: Pt = { x: 480, y: 92 };
export const WREN_SPAWN: Pt = { x: 480, y: 140 };
export const PLAYER_SPAWN: Pt = { x: 480, y: 470 };
/** Where someone stands to use / leaves a pod. */
export const podFront = (p: Pt): Pt => ({ x: p.x, y: p.y + 18 });

/** Server racks (real, wall + conductive body). */
export const RACKS: readonly Pt[] = [{ x: 336, y: 296 }, { x: 624, y: 296 }];
export const DRUMS: readonly Pt[] = [{ x: 256, y: 136 }, { x: 704, y: 136 }, { x: 600, y: 470 }];

const footprint = (p: Pt, hw: number, h: number): Rect => ({ x: p.x - hw, y: p.y - h + 2, w: hw * 2, h });

/** Real-layer furniture. Booths and the bar are baked into the background. */
export const BOOTHS: readonly Rect[] = [
  { x: 160, y: 192, w: 112, h: 24 }, { x: 160, y: 368, w: 112, h: 24 },
  { x: 688, y: 192, w: 112, h: 24 }, { x: 688, y: 368, w: 112, h: 24 },
];
export const BAR: Rect = { x: 384, y: 400, w: 192, h: 24 };
export const REAL_WALLS: readonly Rect[] = [
  ...BOOTHS, BAR,
  ...RACKS.map((r) => footprint(r, 12, 12)),
  ...PODS.map((p) => footprint(p, 11, 10)),
  footprint(WREN_POD, 11, 10),
];

/** Net-layer firewalls (different from the furniture). */
export const NET_WALLS: readonly Rect[] = [
  { x: 304, y: 96, w: 16, h: 128 }, { x: 640, y: 96, w: 16, h: 128 },
  { x: 304, y: 352, w: 16, h: 128 }, { x: 640, y: 352, w: 16, h: 128 },
  { x: 400, y: 240, w: 160, h: 16 }, { x: 400, y: 336, w: 160, h: 16 },
  { x: 144, y: 288, w: 96, h: 16 }, { x: 720, y: 288, w: 96, h: 16 },
];

/** Net data streams: one-way belts (direction may be flipped by Wren). */
export const STREAMS: readonly { r: Rect; dx: number; dy: number }[] = [
  { r: { x: 336, y: 144, w: 288, h: 24 }, dx: 1, dy: 0 },
  { r: { x: 336, y: 424, w: 288, h: 24 }, dx: -1, dy: 0 },
  { r: { x: 96, y: 184, w: 24, h: 208 }, dx: 0, dy: 1 },
  { r: { x: 840, y: 184, w: 24, h: 208 }, dx: 0, dy: -1 },
];
export const STREAM_SPEED = 150;

/** Firewall port slots (net). Phase 1 uses the first 3, phase 2 all 4. */
export const PORT_SLOTS: readonly Pt[] = [{ x: 192, y: 220 }, { x: 768, y: 380 }, { x: 480, y: 296 }, { x: 768, y: 220 }];
export const PORT_HP = 100;
const BEAM_LEN = 54;
/** A pod whose plug was pulled is offline this long. */
export const PLUG_OFFLINE = 5;

// ------------------------------------------------------------------ walls + grid paths
const CELL = 16;
const GW = Math.ceil(DIVE_MAP.w / CELL), GH = Math.ceil(DIVE_MAP.h / CELL);

function circleHitsRect(x: number, y: number, r: number, q: Rect): boolean {
  const cx = clamp(x, q.x, q.x + q.w), cy = clamp(y, q.y, q.y + q.h);
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}

/** Is a ground circle clear of a wall set (and inside the bounds)? */
export function freeIn(walls: readonly Rect[], x: number, y: number, r: number): boolean {
  const b = DIVE_BOUNDS;
  if (x < b.x + r || x > b.x + b.w - r || y < b.y + r || y > b.y + b.h - r) return false;
  for (const q of walls) if (circleHitsRect(x, y, r, q)) return false;
  return true;
}

/** First wall hit along a ray in a wall set. */
export function rayWalls(walls: readonly Rect[], ox: number, oy: number, dx: number, dy: number, max: number): number {
  let best = max;
  for (const q of walls) best = Math.min(best, rayRect(ox, oy, dx, dy, q));
  return best;
}

/** Can a circle of radius r slide straight from a to b? */
export function clearPath(walls: readonly Rect[], ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const d = dist(ax, ay, bx, by), n = Math.max(1, Math.ceil(d / 6));
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
    for (const q of walls) if (circleHitsRect(x, y, r, q)) return false;
  }
  return true;
}

/** Walkable grid for one layer (cell centres with an 8 px clearance). Walls are static per layer. */
export class NavGrid {
  readonly free: Uint8Array;
  private readonly fields = new Map<number, Int16Array>();
  constructor(readonly walls: readonly Rect[]) {
    this.free = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      this.free[j * GW + i] = freeIn(walls, i * CELL + CELL / 2, j * CELL + CELL / 2, 8) ? 1 : 0;
    }
  }
  cell(x: number, y: number): number {
    const i = clamp(Math.floor(x / CELL), 0, GW - 1), j = clamp(Math.floor(y / CELL), 0, GH - 1);
    return j * GW + i;
  }
  isFree(x: number, y: number): boolean { return this.free[this.cell(x, y)] === 1; }
  private centre(c: number): Pt { return { x: (c % GW) * CELL + CELL / 2, y: Math.floor(c / GW) * CELL + CELL / 2 }; }
  /** Nearest free cell centre to a point. */
  nearestFree(x: number, y: number): Pt {
    const c0 = this.cell(x, y);
    if (this.free[c0]) return this.centre(c0);
    let best = c0, bd = Infinity;
    for (let c = 0; c < this.free.length; c++) {
      if (!this.free[c]) continue;
      const q = this.centre(c), d = (q.x - x) ** 2 + (q.y - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return this.centre(best);
  }
  /** BFS step counts to a goal cell (cached; -1 = unreachable). */
  field(goal: number): Int16Array {
    let f = this.fields.get(goal);
    if (f) return f;
    f = new Int16Array(GW * GH).fill(-1);
    const q: number[] = [goal];
    f[goal] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], ci = c % GW, cj = Math.floor(c / GW);
      for (let k = 0; k < 4; k++) {
        const ni = ci + (k === 0 ? 1 : k === 1 ? -1 : 0), nj = cj + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const n = nj * GW + ni;
        if (f[n] >= 0 || !this.free[n]) continue;
        f[n] = f[c] + 1;
        q.push(n);
      }
    }
    if (this.fields.size > 400) this.fields.clear();
    this.fields.set(goal, f);
    return f;
  }
  /** Path length in cells from a point to a goal point (Infinity = no path). */
  steps(ax: number, ay: number, bx: number, by: number): number {
    const v = this.field(this.cell(bx, by))[this.startCell(ax, ay)];
    return v < 0 ? Infinity : v;
  }
  /** Start cell: the cell itself, or a free neighbour when standing in a blocked one. */
  private startCell(x: number, y: number): number {
    const c = this.cell(x, y);
    if (this.free[c]) return c;
    const ci = c % GW, cj = Math.floor(c / GW);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const ni = ci + di, nj = cj + dj;
      if (ni >= 0 && nj >= 0 && ni < GW && nj < GH && this.free[nj * GW + ni]) return nj * GW + ni;
    }
    return c;
  }
  /**
   * Next point to walk to on the way from (ax, ay) to (bx, by): the target itself when the way is
   * straight, else the farthest cell along the BFS path that can be reached in a straight line.
   */
  next(ax: number, ay: number, bx: number, by: number, r = 6): Pt {
    if (clearPath(this.walls, ax, ay, bx, by, r)) return { x: bx, y: by };
    const f = this.field(this.cell(bx, by));
    let c = this.startCell(ax, ay);
    if (f[c] < 0) return { x: bx, y: by };
    let pick: Pt | null = null, first: Pt | null = null;
    for (let k = 0; k < 40 && f[c] > 0; k++) {
      const ci = c % GW, cj = Math.floor(c / GW);
      let nb = c;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const n = nj * GW + ni;
        if (f[n] >= 0 && f[n] < f[nb]) nb = n;
      }
      if (nb === c) break;
      c = nb;
      const p = this.centre(c);
      first ??= p;
      if (k % 2 === 1 || f[c] === 0) {
        if (clearPath(this.walls, ax, ay, p.x, p.y, r)) pick = p;
        else if (pick) break;
      }
    }
    return pick ?? first ?? this.centre(c);
  }
}

// ------------------------------------------------------------------ devices
/** Layered body: drawn by the arena as a ghost while its layer is not the player's. */
interface Ghostly { drawGhost(g: Gfx, w: World): void }

/** Dive pod (real) — the player's body lies here while diving. */
export class DivePod extends Body implements Ghostly {
  constructor(readonly st: DiveState, readonly idx: number) {
    super();
    const p = PODS[idx];
    this.x = p.x; this.y = p.y; this.r = 11; this.hz = 14; this.hr = 11;
    this.mass = 0; this.conductive = true; this.interactable = true; this.interactLabel = T.dive;
  }
  update(): void { this.interactable = this.st.podsOpen && this.st.podCd[this.idx] <= 0; }
  onInteract(w: World): void { this.st.requestSwitch(w, 'net', this.idx); }
  private frame(w: World): string {
    const st = this.st;
    if (st.podCd[this.idx] > 0) return Math.floor(w.realTime * 4) % 2 ? 'pod_jack' : 'pod_empty';
    if (st.bodyPod !== this.idx) return 'pod_empty';
    return st.plug && st.plug.pod === this.idx && Math.floor(w.realTime * 8) % 2 === 0 ? 'pod_jack' : 'pod_full';
  }
  draw(g: Gfx, w: World): void {
    g.ellipse(this.x, this.y + 1, 13, 5, P.ink, 0.45, 'floor');
    g.img('dive_dev', this.frame(w), this.x, this.y + 3);
    g.circle(this.x, this.y - 18, 9, P.cyan, 0.12, 'light');
  }
  drawGhost(g: Gfx, w: World): void {
    g.img('dive_dev', this.frame(w), this.x, this.y + 3, { alpha: 0.28 });
    // the body in the pod stays readable from the net
    if (this.st.bodyPod === this.idx) g.circle(this.x, this.y - 14, 11, this.st.plug?.pod === this.idx ? P.red : P.cyan, 0.16, 'light');
  }
}

/** Exit node (net) at a pod position. */
export class ExitNode extends Body implements Ghostly {
  constructor(readonly st: DiveState, readonly idx: number) {
    super();
    const p = PODS[idx];
    this.x = p.x; this.y = p.y; this.r = 11; this.hz = 10; this.hr = 2;
    this.mass = 0; this.conductive = true; this.interactable = true; this.interactLabel = T.exit;
    this.targetable = false;
  }
  update(w: World): void {
    this.interactable = this.st.podsOpen;
    // Autopilot fallback: an empty net (no ports, no avatar) still needs something to face.
    // Hits on it do nothing.
    const empty = !w.bodies.some((b) => b !== this && !b.dead && b.team === 'enemy' && b.targetable && !(b instanceof ExitNode));
    this.team = empty ? 'enemy' : 'neutral';
    this.targetable = empty;
  }
  hurt(): number { return 0; }
  onInteract(w: World): void { this.st.requestSwitch(w, 'real', this.idx); }
  draw(g: Gfx, w: World): void {
    const pulse = 0.5 + 0.5 * Math.sin(w.realTime * 4 + this.idx);
    g.img('dive_dev', 'node', this.x, this.y + 3);
    g.ring(this.x, this.y - 2, 14, 1, P.acid, 0.35 + 0.3 * pulse, 'floor');
    g.circle(this.x, this.y - 10, 10, P.acid, 0.12 + 0.08 * pulse, 'light');
  }
  drawGhost(g: Gfx): void { g.img('dive_dev', 'node', this.x, this.y + 3, { alpha: 0.25 }); }
}

/** Server rack (real): conductive, blocks shots, grapple anchor. Collision is a wall rect. */
class Rack extends Body implements Ghostly {
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y; this.r = 12; this.hz = 16; this.hr = 13;
    this.mass = 0; this.blocksShots = true; this.conductive = true; this.grapple = 'anchor';
  }
  hurt(w: World, h: Hit): number { if (!h.quiet && h.kind !== 'fire') w.fx.sparks(h.x, h.y, 1, P.fog, 40); return 0; }
  draw(g: Gfx, w: World): void {
    g.ellipse(this.x, this.y + 1, 14, 5, P.ink, 0.45, 'floor');
    g.img('dive_dev', 'rack', this.x, this.y + 3);
    if (Math.floor(w.realTime * 3 + this.x) % 4 === 0) g.circle(this.x + 5, this.y - 20, 4, P.cyan, 0.25, 'light');
  }
  drawGhost(g: Gfx): void { g.img('dive_dev', 'rack', this.x, this.y + 3, { alpha: 0.25 }); }
}

/** Jack-arm handle for a port, present in both layers (the arm hacks it across layers). */
class PortProxy extends Body {
  constructor(readonly port: FirewallPort) {
    super();
    this.x = port.x; this.y = port.y; this.r = 4; this.hz = 12; this.hr = 8;
    this.mass = 0; this.hackable = true; this.targetable = false;
  }
  update(): void { if (this.port.dead) this.dead = true; }
  onHack(w: World): void { this.port.destroy(w, 'hack'); }
}

/** Firewall port (net): powers Wren's shield. Guarded by two rotating sentinel beams. */
export class FirewallPort extends Body implements Ghostly {
  hp: number;
  readonly maxHp: number;
  readonly beams: Hazard[] = [];
  readonly proxy: PortProxy;
  spin: number;
  private age = 0;
  constructor(readonly st: DiveState, readonly slot: number, w: World, fast: boolean) {
    super();
    const p = PORT_SLOTS[slot];
    this.x = p.x; this.y = p.y; this.r = 10; this.hz = 12; this.hr = 11;
    this.team = 'enemy'; this.mass = 0; this.solid = true; this.conductive = true; this.grapple = 'anchor';
    this.maxHp = this.hp = Math.round(PORT_HP * Math.sqrt(tierHp(w.tier)));
    this.spin = (slot % 2 ? -1 : 1) * (fast ? 0.75 : 0.55);
    const a0 = slot * 0.9;
    for (let i = 0; i < 2; i++) {
      const h = new Hazard({ k: 'line', x1: this.x, y1: this.y, x2: this.x, y2: this.y, w: 5 }, 1.0, 1e6);
      h.team = 'env'; h.tick = true; h.activeFill = false; h.cancelable = false;
      const off = a0 + i * Math.PI;
      h.onTick = (ww, hh) => {
        const a = off + this.spin * this.age;
        const dx = Math.cos(a), dy = Math.sin(a);
        const len = rayWalls(this.st.walls.net, this.x, this.y, dx, dy, BEAM_LEN);
        const s = hh.shape;
        if (s.k === 'line') { s.x1 = this.x + dx * 8; s.y1 = this.y + dy * 8; s.x2 = this.x + dx * len; s.y2 = this.y + dy * len; }
        void ww;
      };
      h.onTick(w, h, 0);
      this.beams.push(st.addHazard(w, h, 'net'));
    }
    this.proxy = new PortProxy(this);
  }
  update(_w: World, dt: number): void {
    this.age += dt;
    if (this.flash > 0) this.flash -= dt;
  }
  hurt(w: World, h: Hit): number {
    if (this.dead || this.st.layerOf(this) !== this.st.layer) return 0;
    const dmg = h.dmg;
    if (dmg <= 0) return 0;
    this.hp -= dmg;
    if (!h.quiet) { this.flash = 0.05; w.fx.number(this.id * 10, h.x, h.y, dmg, P.white); w.sfx('bossHit', 0.6, 1.3); }
    w.boss?.noteHit();
    if (this.hp <= 0) this.destroy(w, h.src ?? 'hit');
    return dmg;
  }
  onEmp(w: World): void { if (this.st.layer === 'net') this.destroy(w, 'overload'); }
  destroy(w: World, _why: string): void {
    if (this.dead) return;
    this.dead = true;
    for (const b of this.beams) b.dead = true;
    this.proxy.dead = true;
    const vis = this.st.layer === 'net';
    w.fx.debris(this.x, this.y - 10, vis ? 14 : 6, [P.cyan, P.acid, P.ice, P.abyss], 160);
    w.fx.ring(this.x, this.y - 10, 6, 46, P.acid, 0.35, 2);
    w.fx.label(this.x, this.y - 30, T.portDown, P.acid, 0.9);
    w.sfx('emp', vis ? 0.9 : 0.5);
    this.st.portsChanged = true;
  }
  draw(g: Gfx, w: World): void {
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 6);
    g.ellipse(this.x, this.y + 1, 12, 5, P.ink, 0.5, 'floor');
    g.ring(this.x, this.y - 2, BEAM_LEN, 1, P.red, 0.12, 'floor');
    g.img('dive_dev', 'port', this.x, this.y + 3, { fill: this.flash > 0 ? P.white : undefined });
    g.circle(this.x, this.y - 14, 12, P.cyan, 0.18 + 0.1 * pulse, 'light');
    // hp pips
    const f = clamp(this.hp / this.maxHp, 0, 1);
    g.rect(this.x - 10, this.y - 34, 20, 2, P.ink, 0.8, 'top');
    g.rect(this.x - 10, this.y - 34, 20 * f, 2, P.acid, 0.95, 'top');
    for (const b of this.beams) drawBeam(g, w, b, 1);
  }
  drawGhost(g: Gfx, w: World): void {
    g.img('dive_dev', 'port', this.x, this.y + 3, { alpha: 0.25 });
    for (const b of this.beams) drawBeam(g, w, b, 0.25);
  }
}

function drawBeam(g: Gfx, w: World, h: Hazard, a: number): void {
  const s = h.shape;
  if (s.k !== 'line' || h.dead) return;
  if (h.warning) {
    const blink = Math.floor(w.realTime * 12) % 2 === 0;
    g.line(s.x1, s.y1, s.x2, s.y2, 5, P.red, (blink ? 0.45 : 0.2) * a, 'floor');
    return;
  }
  g.line(s.x1, s.y1, s.x2, s.y2, 5, P.red, 0.55 * a, 'top');
  g.line(s.x1, s.y1, s.x2, s.y2, 1, P.rose, 0.95 * a, 'top');
  if (a > 0.5) g.circle(s.x2, s.y2, 4, P.red, 0.4, 'light');
}

// ------------------------------------------------------------------ enemy bullets with a layer
export class WrenBullet extends Bullet {
  constructor(x: number, y: number, vx: number, vy: number, public layer: Layer, private st: DiveState) {
    super(x, y, vx, vy, 'enemy');
  }
  private deflectBase: boolean | null = null;
  private get live(): boolean { return this.st.layer === this.layer; }
  update(w: World, dt: number): void {
    // a ghost needle in the other layer cannot be sent back
    if (this.deflectBase === null) this.deflectBase = this.deflectable;
    if (this.team === 'enemy') this.deflectable = this.deflectBase && this.live;
    const saved = w.walls;
    w.walls = this.st.walls[this.layer];
    try { super.update(w, dt); } finally { w.walls = saved; }
  }
  protected collide(w: World): void { if (this.live) super.collide(w); }
  draw(g: Gfx, w: World): void {
    if (this.live) { super.draw(g, w); return; }
    const a = this.rotates ? Math.atan2(this.vy, this.vx) : 0;
    g.img('proj', this.frame, this.x, this.y, { layer: 'top', ox: 0.5, oy: 0.5, rot: a, scale: this.scale, alpha: 0.25 });
  }
}

// ------------------------------------------------------------------ per-fight state
interface LayerHazard { layer: Layer | 'both'; hits: boolean; vis: boolean }
interface Stream { r: Rect; dx: number; dy: number; warn: number }

const STATES = new WeakMap<World, DiveState>();
export function diveOf(w: World): DiveState | undefined { return STATES.get(w); }

export class DiveState {
  dead = false;
  layer: Layer = 'real';
  readonly walls: Record<Layer, Rect[]>;
  readonly grid: Record<Layer, NavGrid>;
  readonly pods: DivePod[] = [];
  readonly nodes: ExitNode[] = [];
  ports: FirewallPort[] = [];
  /** Set when a port died (the boss checks the shield). */
  portsChanged = false;
  streams: Stream[] = STREAMS.map((s) => ({ ...s, r: { ...s.r }, warn: 0 }));
  /** Pod holding the player's body while diving. */
  bodyPod: number | null = null;
  /** Plug-pull warning on a pod (drawn + alarm). */
  plug: { pod: number; t: number; dur: number } | null = null;
  /** Pending layer switch (dive 0.5 s / exit 0.4 s). */
  pending: { to: Layer; idx: number; t: number } | null = null;
  /** Seconds a pod stays offline after its plug was pulled. */
  readonly podCd = PODS.map(() => 0);
  /** Pods and nodes can be used (off in phase 3). */
  podsOpen = true;
  /** Phase 3 forced swaps: seconds to the next swap (null = off). */
  swapIn: number | null = null;
  readonly swapPeriod = 8;
  /** World time of the last layer change. */
  switchedAt = -99;
  private glitchT = 0;
  private cooldown = 0;
  /** Layered bodies (bodies not listed here are always present). */
  private readonly members = new Map<Body, Layer | 'both' | 'off'>();
  private readonly hz = new Map<Hazard, LayerHazard>();
  readonly drums: Barrel[] = [];
  /** Autopilot hint cache. */
  readonly hint: { t: number; layer: Layer; v: { x: number; y: number; jump: boolean } | null } = { t: -9, layer: 'real', v: null };

  constructor(w: World) {
    const boundary = w.walls.slice();
    this.walls = { real: [...boundary, ...REAL_WALLS], net: [...boundary, ...NET_WALLS] };
    this.grid = { real: new NavGrid(this.walls.real), net: new NavGrid(this.walls.net) };
  }

  other(l: Layer): Layer { return l === 'real' ? 'net' : 'real'; }

  // ---------------------------------------------------------------- membership
  /** Put a body in a layer ('both' = always present, 'off' = nowhere). */
  setLayer(w: World, b: Body, l: Layer | 'both' | 'off'): void {
    this.members.set(b, l);
    this.sync(w);
  }
  layerOf(b: Body): Layer | 'both' | 'off' | undefined { return this.members.get(b); }

  /** Bring w.bodies in line with the player's layer. */
  sync(w: World): void {
    for (const b of [...this.members.keys()]) if (b.dead) this.members.delete(b);
    const want = (b: Body) => {
      const l = this.members.get(b);
      return l === undefined || l === 'both' || l === this.layer;
    };
    const kept = w.bodies.filter(want);
    const have = new Set(kept);
    for (const [b] of this.members) if (want(b) && !have.has(b) && !b.dead) kept.push(b);
    w.bodies = kept;
    w.walls = this.walls[this.layer];
    for (const [h, m] of this.hz) {
      if (h.dead) { this.hz.delete(h); continue; }
      const on = m.layer === 'both' || m.layer === this.layer;
      h.hitsPlayer = m.hits && on;
      h.visible = m.vis && on;
    }
  }

  /** Register a hazard in a layer (only hits the player there; drawn as a ghost elsewhere). */
  addHazard(w: World, h: Hazard, layer: Layer | 'both'): Hazard {
    this.hz.set(h, { layer, hits: h.hitsPlayer, vis: h.visible });
    if (!w.hazards.includes(h)) w.addHazard(h);
    const on = layer === 'both' || layer === this.layer;
    h.hitsPlayer = h.hitsPlayer && on;
    h.visible = h.visible && on;
    return h;
  }
  hazardLayer(h: Hazard): Layer | 'both' | undefined { return this.hz.get(h)?.layer; }

  /** Ports alive. */
  get portsAlive(): number { return this.ports.filter((p) => !p.dead).length; }

  spawnPorts(w: World, n: number, fast: boolean): void {
    const used = new Set(this.ports.filter((p) => !p.dead).map((p) => p.slot));
    for (let s = 0; s < n; s++) {
      if (used.has(s)) continue;
      const port = new FirewallPort(this, s, w, fast);
      this.ports.push(port);
      w.add(port);
      this.setLayer(w, port, 'net');
      w.add(port.proxy);
      this.setLayer(w, port.proxy, 'both');
      w.fx.ring(port.x, port.y - 10, 4, 36, P.cyan, 0.4, 2);
    }
    this.ports = this.ports.filter((p) => !p.dead);
  }

  clearPorts(w: World): void {
    for (const p of this.ports) if (!p.dead) p.destroy(w, 'phase');
    this.ports = [];
    this.portsChanged = false;
  }

  // ---------------------------------------------------------------- layer changes
  requestSwitch(w: World, to: Layer, idx: number): void {
    if (w.state !== 'fight' || !this.podsOpen || this.pending || this.cooldown > 0) return;
    if (to === this.layer) return;
    const p = w.player;
    this.pending = { to, idx, t: to === 'net' ? 0.5 : 0.4 };
    p.forced = { vx: 0, vy: 0, t: this.pending.t, iframes: false, solids: true };
    p.vx = p.vy = 0;
    w.sfx('charge', 0.5, to === 'net' ? 1.4 : 1.8);
    w.fx.ring(p.x, p.y - 8, 18, 4, to === 'net' ? P.cyan : P.acid, this.pending.t, 1);
  }

  /** Change the player's layer now. */
  setPlayerLayer(w: World, to: Layer): void {
    if (this.layer === to) return;
    this.layer = to;
    this.switchedAt = w.time;
    w.player.held = null; // a carried prop stays in its own layer
    this.glitchT = 0.35;
    this.cooldown = 0.3;
    this.sync(w);
    w.sfx('blink', 0.8, to === 'net' ? 1.3 : 0.8);
    w.fx.shake(2, 0.12);
  }

  private complete(w: World): void {
    const pd = this.pending!;
    this.pending = null;
    const p = w.player;
    if (pd.to === 'net') {
      this.bodyPod = pd.idx;
      this.setPlayerLayer(w, 'net');
    } else {
      const f = podFront(PODS[pd.idx]);
      p.x = f.x; p.y = f.y; p.vx = p.vy = 0;
      this.bodyPod = null;
      this.plug = null;
      this.setPlayerLayer(w, 'real');
    }
  }

  /** Wren pulls the plug: 1 heart, forced exit at the body's pod, 0.6 s stun. */
  pullPlug(w: World): void {
    if (this.layer !== 'net' || this.bodyPod === null) return;
    const pod = PODS[this.bodyPod];
    this.podCd[this.bodyPod] = PLUG_OFFLINE;
    this.pending = null;
    this.bodyPod = null;
    this.plug = null;
    this.setPlayerLayer(w, 'real');
    const f = podFront(pod);
    w.fallPlayer(f, { label: T.plug, color: P.cyan });
    w.player.forced = { vx: 0, vy: 0, t: 0.6, iframes: false, solids: true };
    w.fx.sparks(pod.x, pod.y - 16, 14, P.cyan, 140);
    w.fx.flash(P.red, 0.25, 0.2);
  }

  /**
   * Phase 3: everybody changes layer. Anyone standing in a wall of the new layer is pushed to the
   * nearest free spot. `others` are moved too (Wren).
   */
  forceSwap(w: World, others: Body[]): void {
    const to = this.other(this.layer);
    this.pending = null;
    w.player.forced = null;
    this.setPlayerLayer(w, to);
    const p = w.player;
    if (!freeIn(this.walls[to], p.x, p.y, p.r + 1)) {
      const f = this.grid[to].nearestFree(p.x, p.y);
      p.x = f.x; p.y = f.y;
    }
    for (const b of others) {
      if (!freeIn(this.walls[to], b.x, b.y, b.r + 1)) { const f = this.grid[to].nearestFree(b.x, b.y); b.x = f.x; b.y = f.y; }
    }
    w.fx.flash(P.cyan, 0.2, 0.15);
    w.sfx('emp', 0.7);
    this.glitchT = 0.45;
  }

  /** Move a body (or any circle) in a given layer against that layer's walls only. */
  move(w: World, l: Layer, o: { x: number; y: number; r: number }, dx: number, dy: number): void {
    const saved = w.walls;
    w.walls = this.walls[l];
    try { w.moveCircle(o, dx, dy, { solids: false }); } finally { w.walls = saved; }
  }

  /** Flip the direction of some streams after a 1 s red warning. */
  flipStreams(w: World, idx: number[], warn = 1): void {
    for (const i of idx) if (this.streams[i] && this.streams[i].warn <= 0) this.streams[i].warn = warn;
    w.sfx('telegraph', this.layer === 'net' ? 0.8 : 0.3);
  }

  streamAt(x: number, y: number): Stream | null {
    for (const s of this.streams) if (pointInRect(x, y, s.r)) return s;
    return null;
  }

  // ---------------------------------------------------------------- per step
  update(w: World, dt: number): void {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.glitchT > 0) this.glitchT -= dt;
    for (let i = 0; i < this.podCd.length; i++) if (this.podCd[i] > 0) this.podCd[i] -= dt;
    for (const d of this.drums) if (d.dead) this.members.delete(d);
    const p = w.player;
    if (this.pending && w.state === 'fight') {
      this.pending.t -= dt;
      if (this.pending.t <= 0) this.complete(w);
    } else if (this.pending) this.pending = null;
    if (this.plug) this.plug.t += dt;
    // data streams
    for (const s of this.streams) {
      if (s.warn > 0) {
        s.warn -= dt;
        if (s.warn <= 0) { s.dx = -s.dx; s.dy = -s.dy; if (this.layer === 'net') w.sfx('zap', 0.5); }
      }
    }
    if (this.layer === 'net' && w.state === 'fight') {
      const s = this.streamAt(p.x, p.y);
      if (s && !p.airborne && !p.forced) w.moveCircle(p, s.dx * STREAM_SPEED * dt, s.dy * STREAM_SPEED * dt);
    }
    for (const b of w.bullets) {
      if (b.dead) continue;
      const l = b instanceof WrenBullet ? b.layer : this.layer;
      if (l !== 'net') continue;
      const s = this.streamAt(b.x, b.y);
      if (s) { b.x += s.dx * STREAM_SPEED * 0.6 * dt; b.y += s.dy * STREAM_SPEED * 0.6 * dt; }
    }
    // phase 3 forced swap clock (the boss performs the swap so it can move itself too)
    if (this.swapIn !== null && w.state === 'fight') this.swapIn -= dt;
    this.sync(w);
  }

  // ---------------------------------------------------------------- drawing
  drawFloor(g: Gfx, w: World): void {
    const net = this.layer === 'net';
    if (net) {
      g.img('bg_divecafe', 'net', 0, 0, { layer: 'floor', ox: 0, oy: 0 });
      g.img('bg_divecafe', 'real_ghost', 0, 0, { layer: 'floor', ox: 0, oy: 0, alpha: 0.22 });
    } else {
      g.img('bg_divecafe', 'net_ghost', 0, 0, { layer: 'floor', ox: 0, oy: 0, alpha: 0.25 });
    }
    // streams: arrows scroll with the flow, red while about to flip
    const v = w.view;
    for (const s of this.streams) {
      const flip = s.warn > 0 && Math.floor(w.realTime * 10) % 2 === 0;
      const horiz = s.dx !== 0;
      const frame = (flip ? 'arrow_red_' : 'arrow_') + (s.dx > 0 ? 'r' : s.dx < 0 ? 'l' : s.dy > 0 ? 'd' : 'u');
      const len = horiz ? s.r.w : s.r.h;
      const off = ((w.time * STREAM_SPEED * 0.5) % 24 + 24) % 24;
      const a = net ? 1 : 0.25;
      g.rect(s.r.x, s.r.y, s.r.w, s.r.h, flip ? P.red : P.teal, (net ? 0.18 : 0.06), 'floor');
      for (let k = -24; k < len; k += 24) {
        const t = clamp(k + (s.dx + s.dy > 0 ? off : 24 - off), 0, len - 16);
        const x = horiz ? s.r.x + t : s.r.x + s.r.w / 2 - 8;
        const y = horiz ? s.r.y + s.r.h / 2 - 8 : s.r.y + t;
        if (x > v.x + v.w || x + 16 < v.x || y > v.y + v.h || y + 16 < v.y) continue;
        g.img('dive_fx', frame, x, y, { layer: 'floor', ox: 0, oy: 0, alpha: a });
      }
    }
    // off-layer telegraphs: faint outlines
    for (const [h, m] of this.hz) {
      if (h.dead || m.layer === 'both' || m.layer === this.layer || !m.vis) continue;
      const s = h.shape, a = h.warning ? 0.32 : 0.18;
      if (s.k === 'rect') g.strokeRect(s.x, s.y, s.w, s.h, 1, P.red, a);
      else if (s.k === 'circle') g.ring(s.x, s.y, s.r, 1, P.red, a);
      else if (s.k === 'sector') g.sector(s.x, s.y, s.r, s.a - s.span / 2, s.a + s.span / 2, P.red, a * 0.4);
    }
  }

  drawGhosts(g: Gfx, w: World): void {
    for (const [b, l] of this.members) {
      if (b.dead || l === 'both' || l === 'off' || l === this.layer) continue;
      const gh = b as unknown as Partial<Ghostly>;
      if (gh.drawGhost) gh.drawGhost(g, w);
      else if (b instanceof Barrel) g.img('props', 'barrel', b.x, b.y + 1, { alpha: 0.25 });
    }
    // the player's body lying in its pod, seen from the net
    if (this.layer === 'net' && this.bodyPod !== null) {
      const pod = PODS[this.bodyPod];
      g.img('pc_echo', 'down_idle', pod.x, pod.y - 2, { alpha: 0.3, tint: P.cyan });
    }
  }

  drawTop(g: Gfx, w: World): void {
    const net = this.layer === 'net';
    // layer tag (under the player plate)
    if (w.state === 'fight') {
      g.rect(4, 42, 52, 15, P.ink, 0.75, 'ui');
      g.rect(4, 42, 2, 15, net ? P.acid : P.cyan, 0.9, 'ui');
      g.crisp(net ? T.net : T.real, 31, 43, { layer: 'ui', align: 'center', color: net ? P.acid : P.cyan });
    }
    // plug-pull alarm: red screen edges + pod countdown
    if (this.plug && net) {
      const k = 0.35 + 0.3 * Math.sin(w.realTime * 22);
      g.rect(0, 0, 640, 4, P.red, k, 'ui'); g.rect(0, 356, 640, 4, P.red, k, 'ui');
      g.rect(0, 0, 4, 360, P.red, k, 'ui'); g.rect(636, 0, 4, 360, P.red, k, 'ui');
      const left = Math.max(0, this.plug.dur - this.plug.t);
      g.crisp(`${T.plugWarn} ${left.toFixed(1)}`, 320, 44, { layer: 'ui', align: 'center', color: P.red, outline: P.ink });
    }
    // phase 3 swap countdown (screen centre)
    if (this.swapIn !== null && w.state === 'fight') {
      const n = Math.max(1, Math.ceil(this.swapIn));
      const big = this.swapIn < 3;
      g.crisp(`${T.swap} ${n}`, 320, big ? 150 : 46, { layer: 'ui', align: 'center', scale: big ? 2 : 1, color: big ? P.amber : P.fog, outline: P.ink, alpha: big ? 0.85 : 0.8 });
    }
    // glitch on a layer change: colour-split bands + scanlines
    if (this.glitchT > 0) {
      const k = this.glitchT / 0.35;
      for (let i = 0; i < 7; i++) {
        const y = Math.floor(w.vrng.range(0, 350));
        const h = 2 + Math.floor(w.vrng.range(0, 10));
        const dx = w.vrng.range(-8, 8);
        g.rect(dx, y, 640, h, i % 2 ? P.magenta : P.cyan, 0.18 * k, 'ui');
      }
      for (let y = 0; y < 360; y += 3) g.rect(0, y, 640, 1, P.ink, 0.25 * k, 'ui');
    }
    // pending dive / exit bar over the player
    if (this.pending) {
      const p = w.player, tot = this.pending.to === 'net' ? 0.5 : 0.4;
      const f = 1 - this.pending.t / tot;
      g.rect(p.x - 12, p.y - 30, 24, 3, P.ink, 0.85, 'top');
      g.rect(p.x - 12, p.y - 30, 24 * f, 3, this.pending.to === 'net' ? P.cyan : P.acid, 1, 'top');
    }
  }
}

// ------------------------------------------------------------------ arena
function setup(w: World): void {
  const st = new DiveState(w);
  STATES.set(w, st);
  w.objects.push(st);
  for (let i = 0; i < PODS.length; i++) {
    const pod = w.add(new DivePod(st, i));
    st.pods.push(pod);
    st.setLayer(w, pod, 'real');
    const node = w.add(new ExitNode(st, i));
    st.nodes.push(node);
    st.setLayer(w, node, 'net');
  }
  for (const r of RACKS) st.setLayer(w, w.add(new Rack(r.x, r.y)), 'real');
  for (const d of DRUMS) { const b = w.add(new Barrel(d.x, d.y)); st.drums.push(b); st.setLayer(w, b, 'real'); }
  st.sync(w);
}

/** Autopilot waypoint toward a point in the player's layer. */
function walkTo(st: DiveState, w: World, x: number, y: number): { x: number; y: number; jump: boolean } {
  const p = w.player;
  const n = st.grid[st.layer].next(p.x, p.y, x, y, p.r + 1);
  return { x: n.x, y: n.y, jump: false };
}

/** What the boss tells the autopilot (implemented by Wren). */
export interface DiveBossHints {
  /** Shield up and ports to break. */
  shieldUp: boolean;
  /** Her body lies in her pod (phase 2 dive). */
  slumped: boolean;
  /** Ground point of her body in the real layer. */
  realX: number; realY: number;
  phase: number;
}
const isHints = (b: unknown): b is DiveBossHints => !!b && typeof b === 'object' && 'shieldUp' in b && 'slumped' in b;

/** Seconds of walking along the grid path (rough). */
function travel(st: DiveState, w: World, to: Pt): number {
  const p = w.player;
  return (st.grid[st.layer].steps(p.x, p.y, to.x, to.y) * 16) / 110;
}

function computeHint(w: World, st: DiveState, b: NonNullable<World['boss']>): { x: number; y: number; jump: boolean } | null {
  const p = w.player;
  const h = isHints(b) ? b : null;
  const target = w.nearestEnemy(p.x, p.y, 999);
  const losTo = (t: Pt | null) => {
    if (!t || clearPath(st.walls[st.layer], p.x, p.y, t.x, t.y, p.r + 1)) return null;
    return walkTo(st, w, t.x, t.y);
  };
  if (!st.podsOpen || !h) return losTo(target);
  const go = (to: Pt) => (dist(p.x, p.y, to.x, to.y) < 8 ? { x: p.x, y: p.y, jump: false } : walkTo(st, w, to.x, to.y));
  const alive = st.ports.filter((q) => !q.dead);
  if (st.layer === 'real') {
    if (h.shieldUp && !h.slumped && alive.length) {
      // dive at a pod near the remaining ports, away from her
      let best = -1, bc = Infinity;
      for (let i = 0; i < PODS.length; i++) {
        const f = podFront(PODS[i]);
        const her = dist(PODS[i].x, PODS[i].y, h.realX, h.realY);
        const port = Math.min(...alive.map((q) => dist(q.x, q.y, f.x, f.y)));
        const c = travel(st, w, f) + port / 150 + (her < 90 ? 6 : her < 180 ? 2 : 0) + Math.max(0, st.podCd[i]);
        if (c < bc) { bc = c; best = i; }
      }
      if (best >= 0) return go(podFront(PODS[best]));
    }
    return losTo(target);
  }
  // net: get out when the shield is down (next to her) or the plug is about to be pulled
  if (!h.shieldUp) {
    let best = -1, bc = Infinity;
    for (let i = 0; i < PODS.length; i++) {
      const c = travel(st, w, podFront(PODS[i])) + dist(PODS[i].x, PODS[i].y, h.realX, h.realY) / 400;
      if (c < bc) { bc = c; best = i; }
    }
    if (best >= 0) return go(podFront(PODS[best]));
  }
  if (st.plug) {
    // the plug is being pulled: leave through a node reachable in time, preferably one near the
    // remaining ports (the body moves there)
    const left = st.plug.dur - st.plug.t;
    let best = -1, bc = Infinity;
    for (let i = 0; i < PODS.length; i++) {
      const f = podFront(PODS[i]), t = travel(st, w, f);
      if (t > left + 0.4) continue;
      const port = alive.length ? Math.min(...alive.map((q) => dist(q.x, q.y, f.x, f.y))) : 0;
      const c = t + port / 240 + (i === st.bodyPod ? 1 : 0);
      if (c < bc) { bc = c; best = i; }
    }
    if (best >= 0) return go(podFront(PODS[best]));
  }
  if (target && alive.includes(target as FirewallPort)) return losTo(target);
  return losTo(alive[0] ?? target);
}

function botHint(w: World): { x: number; y: number; jump: boolean } | null {
  const st = diveOf(w);
  const b = w.boss;
  if (!st || !b || b.dying || w.state !== 'fight') return null;
  const p = w.player;
  if (st.pending) return { x: p.x, y: p.y, jump: false };
  // recompute ten times a second
  if (w.time - st.hint.t < 0.1 && st.hint.layer === st.layer) return st.hint.v;
  st.hint.t = w.time; st.hint.layer = st.layer;
  return (st.hint.v = computeHint(w, st, b));
}

export const divecafe: Arena = {
  id: 'divecafe',
  bg: 'bg_divecafe',
  size: DIVE_MAP,
  bounds: DIVE_BOUNDS,
  playerSpawn: PLAYER_SPAWN,
  setup,
  botHint,
  drawFloor(g: Gfx, w: World) {
    const st = diveOf(w);
    if (!st) return;
    st.drawFloor(g, w);
    st.drawGhosts(g, w);
  },
  drawTop(g: Gfx, w: World) { diveOf(w)?.drawTop(g, w); },
};
