/**
 * Downnet flooded server room (Octohydra). Interactables:
 *   - shallow water: most of the floor. Slows the player by 15% and can be electrified.
 *     Dry metal grating (walkways, rack pads, conduit pads, two top ledges) is always safe.
 *   - conduit junction boxes (2, side walls): 5 hits / E / grapple / hack / overload / arc held
 *     -> 1.2 s warning -> all water electrified 1.5 s. 14 s cooldown (shared).
 *     The hydra's own beams also trip a box they hit.
 *   - server racks (3): cover that blocks beams and bullets, conductive for the arc,
 *     anchors for the grapple. Biter heads and the risen core wreck them.
 *
 * The water layout lives in FARM (tile rects) so the background art and the zones agree.
 * Per-fight state (electrification, cooldown, racks, conduits) is a FarmGrid in `w.objects`.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { clamp, pointInRect, segDist, type Rect } from '../../engine/math';
import { Body } from '../body';
import { Zone } from '../hazard';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

const T = 16;
/** Dry grating areas in tiles: [col, row, w, h]. Everything else inside the bounds is water. */
const DRY_TILES: [number, number, number, number][] = [
  [11, 3, 4, 2], [25, 3, 4, 2], // top ledges
  [1, 10, 3, 4], [36, 10, 3, 4], // conduit pads
  [8, 10, 4, 3], [28, 10, 4, 3], [18, 14, 4, 2], // rack pads
  [19, 16, 2, 2], // bridge
  [8, 18, 24, 3], // bottom walkway
];

export const FARM = {
  bounds: { x: 16, y: 48, w: 608, h: 288 } as Rect,
  dry: DRY_TILES.map(([c, r, w, h]) => ({ x: c * T, y: r * T, w: w * T, h: h * T })) as Rect[],
  racks: [[160, 194], [480, 194], [320, 246]] as [number, number][],
  conduits: [[34, 194, 1], [606, 194, -1]] as [number, number, 1 | -1][],
  core: { x: 320, y: 92 },
  /** Water spots heads emerge from, in wake order. */
  spots: [[236, 124], [404, 124], [320, 176], [88, 272], [552, 272], [92, 100], [548, 100], [404, 252]] as [number, number][],
  playerSpawn: { x: 320, y: 304 },
};

export function isDry(x: number, y: number): boolean {
  for (const r of FARM.dry) if (pointInRect(x, y, r)) return true;
  return false;
}

/** Water as a small set of rectangles (row runs merged vertically). */
export function waterRects(): Rect[] {
  const b = FARM.bounds;
  const c0 = b.x / T, c1 = (b.x + b.w) / T, r0 = b.y / T, r1 = (b.y + b.h) / T;
  const runsOf = (r: number) => {
    const out: [number, number][] = [];
    let start = -1;
    for (let c = c0; c <= c1; c++) {
      const wet = c < c1 && !isDry(c * T + 8, r * T + 8);
      if (wet && start < 0) start = c;
      if (!wet && start >= 0) { out.push([start, c]); start = -1; }
    }
    return out;
  };
  let open: { c0: number; c1: number; r0: number }[] = [];
  const rects: Rect[] = [];
  for (let r = r0; r <= r1; r++) {
    const runs = r < r1 ? runsOf(r) : [];
    const next: typeof open = [];
    for (const o of open) {
      if (runs.some((x) => x[0] === o.c0 && x[1] === o.c1)) next.push(o);
      else rects.push({ x: o.c0 * T, y: o.r0 * T, w: (o.c1 - o.c0) * T, h: (r - o.r0) * T });
    }
    for (const [a, b] of runs) if (!next.some((o) => o.c0 === a && o.c1 === b)) next.push({ c0: a, c1: b, r0: r });
    open = next;
  }
  return rects;
}

export type ShockSource = 'conduit' | 'boss';

/** Per-fight arena state: water zones, electrification and the devices. */
export class FarmGrid {
  dead = false;
  water: Zone[] = [];
  racks: ServerRack[] = [];
  conduits: ConduitBox[] = [];
  state: 'idle' | 'warn' | 'live' = 'idle';
  t = 0;
  warnDur = 1.2;
  readonly liveDur = 1.5;
  source: ShockSource = 'conduit';
  /** Conduit cooldown (s). */
  cd = 0;
  private sirenT = 0;
  private liveAt = 0;
  /** Boss hooks (set by the boss): start of the live phase and every live step. */
  onLive?: (w: World, conduit: boolean) => void;
  onLiveTick?: (w: World, dt: number, conduit: boolean) => void;
  /** A conduit was tripped while the boss itself was charging the water: heads get hurt too. */
  private boosted = false;

  get conduitPower(): boolean { return this.source === 'conduit' || this.boosted; }
  get live(): boolean { return this.state === 'live'; }

  inWater(x: number, y: number): boolean {
    for (const z of this.water) if (z.contains(x, y)) return true;
    return false;
  }

  /** Start an electrification. Conduits respect the cooldown; the boss can always charge when idle. */
  trigger(w: World, source: ShockSource, warn = 1.2): boolean {
    if (source === 'conduit') {
      if (this.cd > 0) return false;
      if (this.state !== 'idle') {
        if (this.source === 'boss' && !this.boosted) {
          this.boosted = true;
          this.cd = 14;
          w.fx.label(320, 70, '接线盒叠加', COL.interact, 1);
          w.sfx('lever');
          return true;
        }
        return false;
      }
      this.cd = 14;
      w.sfx('lever');
    }
    this.state = 'warn';
    this.source = source;
    this.boosted = false;
    this.t = 0;
    this.warnDur = warn;
    this.sirenT = 0;
    w.fx.label(320, 70, source === 'conduit' ? '水面即将带电' : '八头蛇正在给水通电', source === 'conduit' ? P.ice : P.acid, 1.2);
    return true;
  }

  update(w: World, dt: number): void {
    if (this.cd > 0) this.cd -= dt;
    if (this.state === 'warn') {
      this.t += dt;
      this.sirenT -= dt;
      if (this.sirenT <= 0) { w.sfx(this.source === 'conduit' ? 'siren' : 'charge', 0.5); this.sirenT = 0.4; }
      const z = w.rng.pick(this.water);
      if (z && w.rng.chance(dt * 30)) {
        const pt = z.randomPoint(w);
        w.fx.sparks(pt.x, pt.y, 2, this.source === 'conduit' ? COL.shock : P.acid, 40);
      }
      if (this.t >= this.warnDur) {
        this.state = 'live';
        this.t = 0;
        this.liveAt = w.time;
        for (const wz of this.water) wz.electrified = this.liveDur;
        w.sfx('emp');
        w.sfx('zap');
        w.fx.shake(4, 0.3);
        w.fx.flash(P.ice, 0.18, 0.15);
        this.onLive?.(w, this.conduitPower);
      }
    } else if (this.state === 'live') {
      this.t += dt;
      // one heart per electrification: a shocked player stays immune until the water calms
      const pl = w.player;
      if (pl.lastHurtAt >= this.liveAt && pl.hp > 0) pl.invuln = Math.max(pl.invuln, this.liveDur - this.t + 0.05);
      if (w.rng.chance(dt * 12)) w.sfx('zap', 0.5, 0.8 + w.rng.next() * 0.4);
      this.onLiveTick?.(w, dt, this.conduitPower);
      if (this.t >= this.liveDur) { this.state = 'idle'; this.boosted = false; }
    }
    // acid puddles left by the spitters: ground hazard; pellets wash them away
    const p = w.player;
    for (const z of w.zones) {
      if (z.kind !== 'acid' || z.dead) continue;
      if (!p.airborne && z.contains(p.x, p.y, 1)) w.hitPlayer(1, { low: true, kind: 'acid', x: p.x, y: p.y });
      for (const b of w.bullets) {
        if (b.team === 'player' && b.cancelsSoft && !b.dead && z.contains(b.x, b.y + 6, 2)) {
          z.dead = true;
          w.fx.burst(b.x, b.y + 6, 5, P.lime, 50, 0.3, 1);
          break;
        }
      }
    }
  }

  draw(g: Gfx, w: World): void {
    if (this.state !== 'warn') return;
    const k = this.t / this.warnDur;
    const c = this.source === 'conduit' ? P.ice : P.acid;
    const a = 0.06 + 0.14 * k + 0.06 * Math.sin(w.realTime * 30);
    for (const z of this.water) if (z.shape.k === 'rect') g.rect(z.shape.x, z.shape.y, z.shape.w, z.shape.h, c, a);
    // crawling arcs from the conduits / core across the water
    const n = 10;
    for (let i = 0; i < n; i++) {
      const s = Math.floor(w.realTime * 12) + i * 7;
      const z = this.water[(s * 13) % this.water.length];
      if (!z || z.shape.k !== 'rect') continue;
      const r = z.shape;
      const x = r.x + hash01(s, 1) * r.w, y = r.y + hash01(s, 2) * r.h;
      let px = x, py = y;
      for (let j = 0; j < 4; j++) {
        const nx = px + (hash01(s, 3 + j) - 0.5) * 18, ny = py + (hash01(s, 9 + j) - 0.5) * 10;
        if (isDry(nx, ny)) break;
        g.line(px, py, nx, ny, 1, c, 0.5 + 0.4 * k);
        px = nx; py = ny;
      }
    }
  }
}

function hash01(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const GRIDS = new WeakMap<World, FarmGrid>();
export function farmOf(w: World): FarmGrid | undefined { return GRIDS.get(w); }

function shadow(g: Gfx, x: number, y: number, rx: number, ry = rx * 0.4): void {
  g.ellipse(x, y, rx, ry, P.ink, 0.45, 'floor');
}

/** Server rack: cover, conductive, grapple anchor. Biters and the risen core wreck it. */
export class ServerRack extends Body {
  hp = 3;
  wrecked = false;
  private sparkT = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.r = 12; this.hz = 16; this.hr = 13;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.conductive = true;
    this.grapple = 'anchor';
  }
  update(w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    if (this.sparkT > 0) this.sparkT -= dt;
    if (this.wrecked && w.rng.chance(dt * 3)) w.fx.sparks(this.x + w.rng.range(-8, 8), this.y - 6, 2, P.acid, 50);
  }
  hurt(w: World, h: Hit): number {
    if (!h.quiet && h.kind !== 'fire') { w.fx.sparks(h.x, h.y, 1, P.fog, 40); this.flash = 0.04; }
    return 0;
  }
  onShock(): void { this.sparkT = 0.1; }
  /** A biter (or the charging core) bites into it. Returns true while it still stands. */
  bite(w: World, n = 1): boolean {
    if (this.wrecked) return false;
    this.hp -= n;
    this.flash = 0.08;
    w.fx.sparks(this.x, this.y - 18, 10, P.acid, 120);
    w.fx.debris(this.x, this.y - 16, 6, [P.slate, P.steel, P.moss], 120);
    w.sfx('crash', 0.6);
    if (this.hp <= 0) this.wreck(w);
    return !this.wrecked;
  }
  wreck(w: World): void {
    if (this.wrecked) return;
    this.wrecked = true;
    this.solid = false;
    this.blocksShots = false;
    this.grapple = 'none';
    this.hz = 6; this.hr = 9;
    w.fx.debris(this.x, this.y - 16, 18, [P.slate, P.steel, P.acid, P.ink], 180);
    w.fx.smoke(this.x, this.y - 8, 8, P.slate, 6, 20);
    w.fx.label(this.x, this.y - 40, '机柜损坏', P.fog, 1);
    w.sfx('crash');
  }
  draw(g: Gfx, w: World): void {
    shadow(g, this.x, this.y + 1, 14);
    const fill = this.flash > 0 ? P.white : undefined;
    g.img('farm_props', this.wrecked ? 'rack_wrecked' : this.hp < 3 ? 'rack_dented' : 'rack', this.x, this.y + 3, { fill });
    if (!this.wrecked) {
      const f = 0.12 + 0.05 * Math.sin(w.realTime * 3 + this.x);
      g.circle(this.x, this.y - 18, 16, P.acid, f, 'light');
    }
    if (this.sparkT > 0) g.circle(this.x, this.y - 18, 12, P.ice, 0.3, 'light');
  }
}

/** Cable junction box on the side walls: trips the water electrification. */
export class ConduitBox extends Body {
  hits = 0;
  private hitT = 0;
  private shockT = 0;
  private refuseT = 0;
  private pulse = 0;
  constructor(x: number, y: number, public facing: 1 | -1, private grid: FarmGrid) {
    super();
    this.x = x; this.y = y;
    this.r = 9; this.hz = 14; this.hr = 11;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.conductive = true;
    this.interactable = true;
    this.hackable = true;
    this.targetable = false;
    this.interactLabel = '让水带电';
  }
  get ready(): boolean { return this.grid.cd <= 0; }
  update(_w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.refuseT > 0) this.refuseT -= dt;
    if (this.pulse > 0) this.pulse -= dt;
    if (this.shockT > 0) this.shockT = Math.max(0, this.shockT - dt * 0.5);
  }
  /** Returns true if the electrification started (or was boosted). */
  fire(w: World): boolean {
    const ok = this.grid.trigger(w, 'conduit');
    if (ok) { this.hits = 0; this.pulse = 0.5; w.fx.sparks(this.x, this.y - 14, 14, P.ice, 140); }
    else if (this.refuseT <= 0) {
      this.refuseT = 0.6;
      w.fx.label(this.x, this.y - 34, this.grid.cd > 0 ? `冷却 ${Math.ceil(this.grid.cd)}s` : '正在通电', P.fog, 0.7);
      w.sfx('click');
    }
    return ok;
  }
  onInteract(w: World): void { this.fire(w); }
  onHack(w: World): void { this.fire(w); }
  onEmp(w: World): void { this.fire(w); }
  /** Hit by one of the hydra's beams. */
  beamHit(w: World): void { if (this.ready) this.fire(w); }
  hurt(w: World, h: Hit): number {
    // only the hydra's beams trip a conduit (they call beamHit directly); stray bullets do not
    if (h.from === 'enemy') return 0;
    if (h.dmg <= 0 || h.quiet || this.hitT > 0) return 0;
    this.hitT = 0.06;
    this.flash = 0.05;
    w.fx.sparks(h.x, h.y, 3, P.ice, 70);
    if (!this.ready) return 0;
    this.hits++;
    w.sfx('zap', 0.4, 1.2 + this.hits * 0.1);
    if (this.hits >= 5) this.fire(w);
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    if (!this.ready) return;
    this.shockT += dt * 1.5;
    if (this.shockT >= 1.2) { this.shockT = 0; this.fire(w); }
  }
  draw(g: Gfx, w: World): void {
    shadow(g, this.x, this.y + 1, 10);
    const ready = this.ready && this.grid.state === 'idle';
    g.img('farm_props', ready ? 'conduit' : 'conduit_off', this.x, this.y + 2, { flipX: this.facing < 0, fill: this.flash > 0 ? P.white : undefined });
    const glow = ready ? 0.25 + 0.15 * Math.sin(w.realTime * 5) : 0.1;
    g.circle(this.x, this.y - 14, 12, ready ? COL.interact : P.red, glow, 'light');
    if (this.pulse > 0) g.circle(this.x, this.y - 14, 30 * (1 - this.pulse), P.ice, this.pulse, 'light');
    // hit pips (5) or the cooldown bar
    const bx = this.x - 9, by = this.y - 34;
    if (this.grid.cd > 0) {
      g.rect(bx, by, 18, 3, P.ink, 0.8, 'top');
      g.rect(bx, by, 18 * clamp(1 - this.grid.cd / 14, 0, 1), 3, P.red, 0.9, 'top');
    } else {
      for (let i = 0; i < 5; i++) g.rect(bx + i * 4, by, 3, 3, i < this.hits ? P.ice : P.ink, 0.9, 'top');
    }
  }
}

function setup(w: World): void {
  const grid = new FarmGrid();
  GRIDS.set(w, grid);
  w.objects.push(grid);
  for (const r of waterRects()) {
    const z = new Zone('water', { k: 'rect', x: r.x, y: r.y, w: r.w, h: r.h });
    z.drawBase = false;
    grid.water.push(w.addZone(z));
  }
  for (const [x, y] of FARM.racks) grid.racks.push(w.add(new ServerRack(x, y)));
  for (const [x, y, f] of FARM.conduits) grid.conduits.push(w.add(new ConduitBox(x, y, f, grid)));
}

/** Does a ground line cross any rack/conduit? Returns the first blocking distance from (x1, y1). */
export function beamBlock(w: World, x: number, y: number, dx: number, dy: number, max: number): { t: number; body: Body | null } {
  return w.raycast(x, y, dx, dy, max, (b) => b.team === 'neutral' && b.blocksShots && (b instanceof ServerRack || b instanceof ConduitBox), true);
}

/** Bodies of a class lying on a ground segment. */
export function onSegment<B extends Body>(w: World, x1: number, y1: number, x2: number, y2: number, width: number, test: (b: Body) => b is B): B[] {
  const out: B[] = [];
  for (const b of w.bodies) if (!b.dead && test(b) && segDist(b.x, b.y, x1, y1, x2, y2) <= width + b.r) out.push(b);
  return out;
}

export const serverfarm: Arena = {
  id: 'serverfarm',
  bg: 'bg_serverfarm',
  bounds: FARM.bounds,
  playerSpawn: FARM.playerSpawn,
  setup,
  update(w: World, dt: number) {
    const grid = farmOf(w);
    const p = w.player;
    if (!grid || p.airborne) return;
    if (grid.inWater(p.x, p.y)) {
      p.slow = Math.min(p.slow, 0.85);
      if (p.moving && w.rng.chance(dt * 8)) w.fx.burst(p.x + w.rng.range(-3, 3), p.y, 1, P.teal, 25, 0.35, 1);
    }
  },
  drawFloor(g: Gfx, w: World) {
    // green data glow drifting under the water, ceiling lamps
    for (let i = 0; i < 6; i++) {
      const x = 80 + i * 96 + Math.sin(w.realTime * 0.4 + i) * 20, y = 150 + Math.sin(w.realTime * 0.3 + i * 2) * 60;
      g.circle(x, y, 34, P.acid, 0.03, 'light');
    }
    for (const x of [112, 240, 400, 528]) g.circle(x, 50, 36, P.cyan, 0.05 + 0.01 * Math.sin(w.realTime * 2 + x), 'light');
  },
};
