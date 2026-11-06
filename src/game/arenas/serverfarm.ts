/**
 * Downnet flooded server shaft (Octohydra). A 640x1072 map (three screens tall, vertical scrolling).
 * Three flooded levels stacked bottom to top, joined by dry stair ramps through gaps in the
 * bulkheads between them (tile rows 44 and 23):
 *   L1 入口池 (bottom, y 720-1056): spawn walkway, two basins either side of a dry spine, one rack,
 *     a conduit box on the right wall. The ramp up (centre) is shut by a sluice gate until P2.
 *   L2 机柜池 (middle, y 384-704): one wide basin, two rack pads, a conduit box on the left wall,
 *     a landing at the sluice gate and two stair ramps up (left and right).
 *   L3 核心池 (top, y 48-368): the core in an alcove in the back wall, ledges, a drain grate in the
 *     middle. No conduit: only the hydra's own charge, the arc, fire and beams burn stumps here.
 * Interactables:
 *   - shallow water: slows the player by 15% and can be electrified, one level at a time.
 *     Dry metal grating (walkways, pads, ledges, stairs, the closed drain) is always safe.
 *   - conduit boxes (L1, L2): 5 hits / E / grapple / hack / overload / arc held -> 1.2 s warning
 *     -> that level's water electrified 1.5 s. 14 s cooldown per box. Hydra beams trip a box they hit.
 *   - server racks (3): cover that blocks beams and bullets, conductive for the arc,
 *     anchors for the grapple. Biter heads and the risen core wreck them.
 * Terrain changes (follow the boss phase):
 *   - P2: the sluice gate opens at once; 2 s of sirens, then L1 floods deep from the bottom up
 *     (4 s). Deep water is a pit: 1 heart, back on the nearest dry grating of L2.
 *   - P3: the flood recedes to shallow water (3 s); the drain grate flashes 1.5 s, then opens
 *     (a pit: 1 heart, back on L3 grating) and L3 drains over 10 s, strip by strip.
 *
 * The layout lives in FARM (tile rects) so the background art, the walls and the zones agree.
 * Per-fight state (water per level, conduits, racks, gate, flood, drain) is a FarmGrid in `w.objects`.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { clamp, dist, lerp, norm, pointInRect, segDist, type Rect } from '../../engine/math';
import { maskWalls, type TileMask } from '../arenaMask';
import { Body } from '../body';
import { Zone } from '../hazard';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

const T = 16;
type Tiles = [number, number, number, number];
const rect = ([c, r, w, h]: Tiles): Rect => ({ x: c * T, y: r * T, w: w * T, h: h * T });

/** Floor rows of each level (inclusive), bottom (L1) to top (L3). */
const LEVEL_ROWS: [number, number][] = [[45, 65], [24, 43], [3, 22]];
/** Bulkhead rows: above L1, above L2. */
const BULKHEAD_ROWS = [44, 23];
/** Gaps in the bulkheads: [col, width, row]. The first one holds the sluice gate. */
const GAP_TILES: Tiles[] = [[18, 44, 4, 1], [4, 23, 4, 1], [32, 23, 4, 1]];
/** Back-wall cheeks either side of the core alcove (open columns 15-24). */
const ALCOVE_TILES: Tiles[] = [[1, 3, 14, 3], [25, 3, 14, 3]];
/** Dry grating per level: [col, row, w, h]. Everything else on a level's floor is water. */
const DRY_TILES: Tiles[][] = [
  [
    [18, 45, 4, 18], // central spine (gate to walkway)
    [6, 63, 28, 3], // spawn walkway
    [8, 52, 4, 3], // rack pad
    [36, 52, 3, 4], // conduit pad
    [3, 46, 4, 2], [33, 46, 4, 2], // corner pads under the bulkhead
    [18, 44, 4, 1], // gate stairs
    [27, 51, 3, 3], [1, 56, 3, 3], // islands: no water more than ~90 px from grating
  ],
  [
    [15, 41, 10, 3], // landing above the gate
    [4, 24, 4, 3], [32, 24, 4, 3], // stair feet
    [9, 30, 4, 3], [27, 30, 4, 3], // rack pads
    [1, 34, 3, 4], // conduit pad
    [35, 36, 3, 3], // right wall pad
    [4, 23, 4, 1], [32, 23, 4, 1], // bulkhead stairs
    [17, 24, 6, 2], [18, 33, 4, 2], [1, 41, 4, 3], [29, 39, 3, 2], // islands
  ],
  [
    [10, 6, 4, 2], [26, 6, 4, 2], // ledges by the alcove
    [7, 13, 4, 3], [29, 13, 4, 3], // mid pads
    [4, 20, 4, 3], [32, 20, 4, 3], // stair heads
    [1, 6, 3, 3], [36, 6, 3, 3], [17, 20, 6, 3], // corner islands, bottom-centre landing
  ],
];

export const FARM = {
  size: { w: 640, h: 1072 },
  bounds: { x: 16, y: 48, w: 608, h: 1008 } as Rect,
  /** Floor band of each level (L1 bottom .. L3 top). */
  levels: LEVEL_ROWS.map(([r0, r1]) => ({ y0: r0 * T, y1: (r1 + 1) * T })),
  bulkheads: BULKHEAD_ROWS.map((r) => ({ x: 16, y: r * T, w: 608, h: T }) as Rect),
  /** Ramp gaps in the bulkheads; `lower` = the level below. gaps[0] is the sluice gate. */
  gaps: GAP_TILES.map((t, i) => ({ ...rect(t), lower: i === 0 ? 0 : 1 })),
  alcove: ALCOVE_TILES.map(rect),
  dry: DRY_TILES.flat().map(rect),
  dryOf: DRY_TILES.map((l) => l.map(rect)),
  /** Indices into `dry` of the conduit pads (hazard stripes in the art). */
  conduitPads: [3, 14],
  walkway: 1,
  drain: rect([18, 14, 4, 2]),
  /** Pit while the drain is open (the hole inside the grate). */
  drainPit: { x: 294, y: 228, w: 52, h: 24 } as Rect,
  racks: [[160, 866], [176, 514], [464, 514]] as [number, number][],
  /** [x, y, facing, level] */
  conduits: [[606, 866, -1, 0], [34, 578, 1, 1]] as [number, number, 1 | -1, number][],
  core: { x: 320, y: 92 },
  /** Water spots heads emerge from, in wake order: 3 on L1, 3 on L2, 2 on L3. */
  spots: [[232, 800], [408, 800], [472, 944], [320, 468], [104, 652], [536, 652], [208, 176], [432, 176]] as [number, number][],
  playerSpawn: { x: 320, y: 1032 },
};

/** Level of a y coordinate: 0 = L1 (bottom), 1 = L2, 2 = L3 (top). Bulkheads split down the middle. */
export function levelOf(y: number): number {
  return y >= 712 ? 0 : y >= 376 ? 1 : 2;
}

/** Static walls inside the bounds (bulkheads minus their gaps, alcove cheeks), as a tile mask. */
export const farmMask: TileMask = (c, r) => {
  if (c <= 0 || c >= 39 || r <= 2 || r >= 66) return true;
  if (BULKHEAD_ROWS.includes(r)) return !GAP_TILES.some(([gc, gr, gw]) => gr === r && c >= gc && c < gc + gw);
  return ALCOVE_TILES.some(([ac, ar, aw, ah]) => c >= ac && c < ac + aw && r >= ar && r < ar + ah);
};

export function isDry(x: number, y: number): boolean {
  if (pointInRect(x, y, FARM.drain)) return true;
  for (const r of FARM.dry) if (pointInRect(x, y, r)) return true;
  return false;
}

/** Water of rows r0..r1 (inclusive) as a few rectangles (row runs merged vertically). */
export function waterRects(r0: number, r1: number): Rect[] {
  const wet = (c: number, r: number) => !farmMask(c, r) && !isDry(c * T + 8, r * T + 8);
  let open: { c0: number; c1: number; r0: number }[] = [];
  const rects: Rect[] = [];
  for (let r = r0; r <= r1 + 1; r++) {
    const runs: [number, number][] = [];
    if (r <= r1) {
      let start = -1;
      for (let c = 1; c <= 39; c++) {
        const on = c < 39 && wet(c, r);
        if (on && start < 0) start = c;
        if (!on && start >= 0) { runs.push([start, c]); start = -1; }
      }
    }
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

/** L3 drains in strips of 2 tile rows, outermost first (the water runs toward the drain). */
export const DRAIN_STRIPS = 10;
const STRIP_ORDER = Array.from({ length: DRAIN_STRIPS }, (_, k) => k)
  .sort((a, b) => Math.abs(b * 2 + 3.5 - 14.5) - Math.abs(a * 2 + 3.5 - 14.5));

/** Closest point inside a dry rect of `level` (inset), avoiding the drain. */
export function nearestDry(level: number, x: number, y: number, inset = 10): { x: number; y: number } {
  let best = { x: FARM.playerSpawn.x, y: FARM.playerSpawn.y }, bd = Infinity;
  for (const r of FARM.dryOf[level]) {
    if (r.h <= T) continue; // bulkhead stairs: not a place to stand
    const px = clamp(x, r.x + inset, r.x + r.w - inset), py = clamp(y, r.y + inset, r.y + r.h - inset - 4);
    const d = (px - x) ** 2 + (py - y) ** 2;
    if (d < bd) { bd = d; best = { x: px, y: py }; }
  }
  return best;
}

/**
 * Next waypoint from (fx, fy) toward (tx, ty) through the ramp gaps (one level at a time).
 * `r` = the mover's radius. null when the way is shut (sluice gate closed).
 */
export function route(w: World, fx: number, fy: number, tx: number, ty: number, r: number): { x: number; y: number } | null {
  const grid = farmOf(w);
  const open = (i: number) => i !== 0 || !!grid?.gateOpen;
  const m = r + 14;
  // inside a gap: carry on through it toward the target's side
  for (let i = 0; i < FARM.gaps.length; i++) {
    const g = FARM.gaps[i];
    if (!open(i) || fx < g.x || fx > g.x + g.w || fy < g.y - m || fy > g.y + g.h + m) continue;
    const gx = g.x + g.w / 2;
    if (ty > g.y + g.h + m && fy < g.y + g.h + m - 2) return { x: gx, y: g.y + g.h + m };
    if (ty < g.y - m && fy > g.y - m + 2) return { x: gx, y: g.y - m };
  }
  const a = levelOf(fy), b = levelOf(ty);
  if (a === b) return { x: tx, y: ty };
  const n = a + Math.sign(b - a), lower = Math.min(a, n), up = b > a;
  let best = -1, bc = Infinity;
  FARM.gaps.forEach((g, i) => {
    if (g.lower !== lower || !open(i)) return;
    const gx = g.x + g.w / 2, c = Math.abs(fx - gx) + Math.abs(gx - tx);
    if (c < bc) { bc = c; best = i; }
  });
  if (best < 0) return null;
  const g = FARM.gaps[best], gx = g.x + g.w / 2;
  const aligned = Math.abs(fx - gx) <= g.w / 2 - r - 2;
  if (!aligned) return { x: gx, y: up ? g.y + g.h + m : g.y - m };
  return { x: gx, y: up ? g.y - m : g.y + g.h + m };
}

export type ShockSource = 'conduit' | 'boss';

/** One level's water and its electrification state machine. */
export class Pool {
  water: Zone[] = [];
  state: 'idle' | 'warn' | 'live' = 'idle';
  t = 0;
  warnDur = 1.2;
  readonly liveDur = 1.5;
  source: ShockSource = 'conduit';
  /** This level's conduit cooldown (s). */
  cd = 0;
  sirenT = 0;
  liveAt = 0;
  /** A conduit was tripped while the boss itself was charging the water: heads get hurt too. */
  boosted = false;
  constructor(readonly level: number) {}
  get conduitPower(): boolean { return this.source === 'conduit' || this.boosted; }
  get live(): boolean { return this.state === 'live'; }
  inWater(x: number, y: number): boolean {
    for (const z of this.water) if (!z.dead && z.contains(x, y)) return true;
    return false;
  }
}

type FloodState = 'none' | 'warn' | 'rising' | 'deep' | 'receding' | 'shallow';
type DrainState = 'closed' | 'warn' | 'open';
const FLOOD_WARN = 2;
const FLOOD_RISE = 4;
const FLOOD_RECEDE = 3;
const DRAIN_WARN = 1.5;
const DRAIN_TIME = 10;
const GATE_OPEN = 0.8;

/** Per-fight arena state: water per level, electrification, devices, gate, flood and drain. */
export class FarmGrid {
  dead = false;
  readonly pools = [new Pool(0), new Pool(1), new Pool(2)];
  racks: ServerRack[] = [];
  conduits: ConduitBox[] = [];
  /** L3 water zones by drain strip. */
  readonly strips: Zone[][] = Array.from({ length: DRAIN_STRIPS }, () => []);
  gateOpen = false;
  /** 0 = shut, 1 = fully raised. */
  gateK = 0;
  readonly gateWall: Rect = { ...FARM.gaps[0] };
  flood: FloodState = 'none';
  floodT = 0;
  /** Deep water covers L1 below this y. */
  floodY = FARM.levels[0].y1;
  drain: DrainState = 'closed';
  drainT = 0;
  /** L3 strips already dry. */
  drained = 0;
  /** Boss hooks (set by the boss): start of a pool's live phase and every live step. */
  onLive?: (w: World, pool: Pool, conduit: boolean) => void;
  onLiveTick?: (w: World, pool: Pool, dt: number, conduit: boolean) => void;

  /** Any level live / warning (for tests and the autopilot). */
  get live(): boolean { return this.pools.some((p) => p.live); }
  get state(): 'idle' | 'warn' | 'live' { return this.live ? 'live' : this.pools.some((p) => p.state === 'warn') ? 'warn' : 'idle'; }
  get liveDur(): number { return this.pools[0].liveDur; }
  /** L1 is (or is about to be) deep: get out. */
  get floodDanger(): boolean { return this.flood === 'warn' || this.flood === 'rising' || this.flood === 'deep'; }

  pool(y: number): Pool { return this.pools[levelOf(y)]; }
  inWater(x: number, y: number): boolean { return this.pool(y).inWater(x, y); }
  isDeep(x: number, y: number): boolean {
    return (this.flood === 'rising' || this.flood === 'deep') && levelOf(y) === 0 && y > this.floodY && pointInRect(x, y, FARM.bounds);
  }
  inDrain(x: number, y: number): boolean { return this.drain === 'open' && pointInRect(x, y, FARM.drainPit); }

  /** Start an electrification of one level. Conduits respect their cooldown; the boss can always charge when idle. */
  trigger(w: World, level: number, source: ShockSource, warn = 1.2): boolean {
    const pl = this.pools[level];
    if (!pl.water.some((z) => !z.dead)) return false;
    if (source === 'conduit') {
      if (pl.cd > 0) return false;
      if (pl.state !== 'idle') {
        if (pl.source === 'boss' && !pl.boosted) {
          pl.boosted = true;
          pl.cd = 14;
          this.label(w, level, '接线盒叠加', COL.interact, 1);
          w.sfx('lever');
          return true;
        }
        return false;
      }
      pl.cd = 14;
      w.sfx('lever');
    }
    pl.state = 'warn';
    pl.source = source;
    pl.boosted = false;
    pl.t = 0;
    pl.warnDur = warn;
    pl.sirenT = 0;
    this.label(w, level, source === 'conduit' ? '本层水面即将带电' : '八头蛇正在给本层水通电', source === 'conduit' ? P.ice : P.acid, 1.2);
    return true;
  }

  /** A rule label about one level, shown only to a player on that level (below the boss's labels). */
  label(w: World, level: number, text: string, c: number, dur: number): void {
    if (levelOf(w.player.y) !== level) return;
    const L = FARM.levels[level];
    w.fx.label(320, Math.max(L.y0 + 24, w.camY + 104), text, c, dur);
  }

  update(w: World, dt: number): void {
    for (const pl of this.pools) this.updatePool(w, pl, dt);
    this.updateTerrain(w, dt);
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

  private updatePool(w: World, pl: Pool, dt: number): void {
    if (pl.cd > 0) pl.cd -= dt;
    const water = pl.water.filter((z) => !z.dead);
    if (pl.state === 'warn') {
      pl.t += dt;
      pl.sirenT -= dt;
      const near = Math.abs(levelOf(w.player.y) - pl.level) <= 1;
      if (pl.sirenT <= 0) { if (near) w.sfx(pl.source === 'conduit' ? 'siren' : 'charge', levelOf(w.player.y) === pl.level ? 0.5 : 0.2); pl.sirenT = 0.4; }
      const z = water.length ? w.rng.pick(water) : null;
      if (z && w.rng.chance(dt * 30)) {
        const pt = z.randomPoint(w);
        w.fx.sparks(pt.x, pt.y, 2, pl.source === 'conduit' ? COL.shock : P.acid, 40);
      }
      if (pl.t >= pl.warnDur) {
        pl.state = 'live';
        pl.t = 0;
        pl.liveAt = w.time;
        for (const wz of water) wz.electrified = pl.liveDur;
        if (levelOf(w.player.y) === pl.level) {
          w.sfx('emp');
          w.sfx('zap');
          w.fx.shake(4, 0.3);
          w.fx.flash(P.ice, 0.18, 0.15);
        } else w.sfx('zap', 0.4);
        this.onLive?.(w, pl, pl.conduitPower);
      }
    } else if (pl.state === 'live') {
      pl.t += dt;
      // one heart per electrification: a shocked player stays immune until the water calms
      const p = w.player;
      if (p.lastHurtAt >= pl.liveAt && p.hp > 0 && levelOf(p.y) === pl.level) p.invuln = Math.max(p.invuln, pl.liveDur - pl.t + 0.05);
      if (levelOf(p.y) === pl.level && w.rng.chance(dt * 12)) w.sfx('zap', 0.5, 0.8 + w.rng.next() * 0.4);
      this.onLiveTick?.(w, pl, dt, pl.conduitPower);
      if (pl.t >= pl.liveDur) { pl.state = 'idle'; pl.boosted = false; }
    }
  }

  private updateTerrain(w: World, dt: number): void {
    const ph = w.boss && !w.boss.defeated ? w.boss.phase : 0;
    // P2: open the sluice gate, sirens, then the flood rises through L1
    if (ph >= 1 && this.flood === 'none') {
      this.flood = 'warn';
      this.floodT = 0;
      this.gateOpen = true;
      w.walls = w.walls.filter((r) => r !== this.gateWall);
      this.label(w, 0, '水闸打开 · 入口池即将淹没 · 上楼', P.red, 2.2);
      this.label(w, 1, '水闸打开', P.amber, 1.4);
      w.sfx('rev', 0.8, 0.6);
    }
    if (this.gateOpen && this.gateK < 1) this.gateK = Math.min(1, this.gateK + dt / GATE_OPEN);
    if (ph >= 2 && (this.flood === 'warn' || this.flood === 'rising' || this.flood === 'deep')) {
      this.flood = 'receding';
      this.floodT = 0;
      this.label(w, 0, '积水退去', P.ice, 1.4);
    }
    this.floodT += dt;
    const L1 = FARM.levels[0];
    switch (this.flood) {
      case 'warn':
        if (Math.floor((this.floodT - dt) / 0.5) !== Math.floor(this.floodT / 0.5) && levelOf(w.player.y) === 0) w.sfx('siren', 0.7);
        if (this.floodT >= FLOOD_WARN) { this.flood = 'rising'; this.floodT = 0; w.sfx('spray', 0.8, 0.5); }
        break;
      case 'rising':
        this.floodY = lerp(L1.y1, L1.y0, clamp(this.floodT / FLOOD_RISE, 0, 1));
        if (w.rng.chance(dt * 20)) w.fx.burst(w.rng.range(24, 616), this.floodY, 2, P.ice, 40, 0.4, 1);
        if (this.floodT >= FLOOD_RISE) { this.flood = 'deep'; this.floodY = L1.y0; }
        break;
      case 'receding': {
        const from = this.floodY;
        this.floodY = Math.max(from, lerp(L1.y0, L1.y1, clamp(this.floodT / FLOOD_RECEDE, 0, 1)));
        if (this.floodT >= FLOOD_RECEDE) { this.flood = 'shallow'; this.floodY = L1.y1; }
        break;
      }
    }
    // P3: the drain flashes, opens, and L3 runs dry strip by strip
    if (ph >= 2 && this.drain === 'closed') {
      this.drain = 'warn';
      this.drainT = 0;
      this.label(w, 2, '排水口即将打开', P.red, 1.5);
    }
    if (this.drain === 'closed') return;
    this.drainT += dt;
    if (this.drain === 'warn') {
      if (Math.floor((this.drainT - dt) / 0.4) !== Math.floor(this.drainT / 0.4) && levelOf(w.player.y) === 2) w.sfx('siren', 0.5, 1.3);
      if (this.drainT >= DRAIN_WARN) {
        this.drain = 'open';
        this.drainT = 0;
        this.label(w, 2, '核心池排水', P.ice, 1.4);
        w.sfx('crash', 0.7, 0.6);
      }
      return;
    }
    const due = Math.min(DRAIN_STRIPS, Math.floor((this.drainT / DRAIN_TIME) * DRAIN_STRIPS));
    while (this.drained < due) {
      for (const z of this.strips[STRIP_ORDER[this.drained]]) z.dead = true;
      this.drained++;
    }
    const dr = FARM.drain;
    if (this.drained < DRAIN_STRIPS && w.rng.chance(dt * 18)) w.fx.burst(dr.x + w.rng.range(8, dr.w - 8), dr.y + dr.h / 2, 1, P.teal, 30, 0.4, 1);
  }

  /** Is a strip of L3 already dry (art)? */
  stripDry(k: number): boolean { return STRIP_ORDER.indexOf(k) < this.drained; }

  draw(g: Gfx, w: World): void {
    for (const pl of this.pools) {
      if (pl.state !== 'warn') continue;
      const k = pl.t / pl.warnDur;
      const c = pl.source === 'conduit' ? P.ice : P.acid;
      const a = 0.06 + 0.14 * k + 0.06 * Math.sin(w.realTime * 30);
      const water = pl.water.filter((z) => !z.dead);
      for (const z of water) if (z.shape.k === 'rect') g.rect(z.shape.x, z.shape.y, z.shape.w, z.shape.h, c, a);
      // crawling arcs across the water
      for (let i = 0; i < 10 && water.length; i++) {
        const s = Math.floor(w.realTime * 12) + i * 7;
        const z = water[(s * 13) % water.length];
        if (!z || z.shape.k !== 'rect') continue;
        const r = z.shape;
        const x = r.x + hash01(s, 1) * r.w, y = r.y + hash01(s, 2) * r.h;
        let px = x, py = y;
        for (let j = 0; j < 4; j++) {
          const nx = px + (hash01(s, 3 + j) - 0.5) * 18, ny = py + (hash01(s, 9 + j) - 0.5) * 10;
          if (isDry(nx, ny) || !z.contains(nx, ny)) break;
          g.line(px, py, nx, ny, 1, c, 0.5 + 0.4 * k);
          px = nx; py = ny;
        }
      }
    }
  }

  /** Floor-level terrain: drained strips, flood water, the drain. Drawn under telegraphs. */
  drawTerrain(g: Gfx, w: World): void {
    for (let k = 0; k < DRAIN_STRIPS; k++) if (this.stripDry(k)) g.img('farm_drained', k, 0, FARM.levels[2].y0 + k * 32, { layer: 'floor', ox: 0, oy: 0 });
    const B = FARM.bounds, L1 = FARM.levels[0];
    if (this.flood === 'warn') {
      // flashing band of rising water at the bottom of L1
      const k = this.floodT / FLOOD_WARN, blink = 0.5 + 0.5 * Math.sin(w.realTime * 16);
      const h = 10 + 26 * k;
      g.rect(B.x, L1.y1 - h, B.w, h, P.ice, 0.12 + 0.18 * blink);
      for (let x = B.x + 8; x < B.x + B.w; x += 32) g.poly([x, L1.y1 - h - 4, x + 8, L1.y1 - h - 14 - 4 * blink, x + 16, L1.y1 - h - 4], P.ice, 0.35 + 0.3 * blink);
    }
    if (this.floodY < L1.y1 && this.flood !== 'none') {
      const y = this.floodY;
      // deep water hides the grating; drifting wave crests on top
      g.rect(B.x, y, B.w, L1.y1 - y, P.night, 0.9);
      g.rect(B.x, y, B.w, L1.y1 - y, P.abyss, 0.35);
      const hgt = L1.y1 - y;
      for (let i = 0; i < 40 && hgt > 12; i++) {
        const yy = y + 8 + ((i * 47 + w.realTime * 5) % (hgt - 10));
        const xx = B.x + ((i * 173 + w.realTime * (i % 2 ? 9 : -9)) % (B.w - 40) + B.w - 40) % (B.w - 40);
        g.line(xx, yy, xx + 14 + (i % 3) * 6, yy, 1, i % 4 === 0 ? P.cyan : P.teal, 0.6);
      }
      g.line(B.x, y, B.x + B.w, y, 2, P.ice, 0.6 + 0.25 * Math.sin(w.realTime * 6));
      if (this.flood === 'rising' || this.flood === 'deep') {
        // danger rim along the deep water edge
        for (let x = B.x; x < B.x + B.w; x += 16) g.line(x, y + 4, x + 8, y + 4, 2, P.red, 0.7);
      }
    }
    const dr = FARM.drain;
    if (this.drain === 'open') {
      g.img('farm_big', 'drain_open', dr.x, dr.y, { layer: 'floor', ox: 0, oy: 0 });
      if (this.drained < DRAIN_STRIPS) {
        const a = w.realTime * 3;
        for (let i = 0; i < 3; i++) g.ring(dr.x + dr.w / 2, dr.y + dr.h / 2, 10 + ((a * 6 + i * 8) % 22), 1, P.teal, 0.5);
      }
    } else {
      g.img('farm_big', 'drain', dr.x, dr.y, { layer: 'floor', ox: 0, oy: 0 });
      if (this.drain === 'warn') {
        const blink = Math.floor(w.realTime * 8) % 2 === 0;
        g.strokeRect(dr.x - 2, dr.y - 2, dr.w + 4, dr.h + 4, 2, P.red, blink ? 0.9 : 0.4);
        g.rect(dr.x, dr.y, dr.w, dr.h, P.red, 0.12 + 0.2 * (this.drainT / DRAIN_WARN));
      }
    }
  }

  /** The sluice gate door: shrinks up into its housing as it opens. */
  drawGate(g: Gfx): void {
    const gt = FARM.gaps[0];
    if (this.gateK >= 1) return;
    g.img('farm_big', 'gate', gt.x + gt.w / 2, gt.y + gt.h - 32, { ox: 0.5, oy: 0, sy: 1 - this.gateK, depth: gt.y + gt.h });
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

/** Cable junction box on a side wall: trips the electrification of its own level's water. */
export class ConduitBox extends Body {
  hits = 0;
  private hitT = 0;
  private shockT = 0;
  private refuseT = 0;
  private pulse = 0;
  constructor(x: number, y: number, public facing: 1 | -1, private grid: FarmGrid, readonly level: number) {
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
    this.interactLabel = '让本层水带电';
  }
  get pool(): Pool { return this.grid.pools[this.level]; }
  get ready(): boolean { return this.pool.cd <= 0; }
  update(_w: World, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.refuseT > 0) this.refuseT -= dt;
    if (this.pulse > 0) this.pulse -= dt;
    if (this.shockT > 0) this.shockT = Math.max(0, this.shockT - dt * 0.5);
  }
  /** Returns true if the electrification started (or was boosted). */
  fire(w: World): boolean {
    const ok = this.grid.trigger(w, this.level, 'conduit');
    if (ok) { this.hits = 0; this.pulse = 0.5; w.fx.sparks(this.x, this.y - 14, 14, P.ice, 140); }
    else if (this.refuseT <= 0) {
      this.refuseT = 0.6;
      w.fx.label(this.x, this.y - 34, this.pool.cd > 0 ? `冷却 ${Math.ceil(this.pool.cd)}s` : '正在通电', P.fog, 0.7);
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
    const ready = this.ready && this.pool.state === 'idle';
    g.img('farm_props', ready ? 'conduit' : 'conduit_off', this.x, this.y + 2, { flipX: this.facing < 0, fill: this.flash > 0 ? P.white : undefined });
    const glow = ready ? 0.25 + 0.15 * Math.sin(w.realTime * 5) : 0.1;
    g.circle(this.x, this.y - 14, 12, ready ? COL.interact : P.red, glow, 'light');
    if (this.pulse > 0) g.circle(this.x, this.y - 14, 30 * (1 - this.pulse), P.ice, this.pulse, 'light');
    // hit pips (5) or the cooldown bar
    const bx = this.x - 9, by = this.y - 34;
    if (this.pool.cd > 0) {
      g.rect(bx, by, 18, 3, P.ink, 0.8, 'top');
      g.rect(bx, by, 18 * clamp(1 - this.pool.cd / 14, 0, 1), 3, P.red, 0.9, 'top');
    } else {
      for (let i = 0; i < 5; i++) g.rect(bx + i * 4, by, 3, 3, i < this.hits ? P.ice : P.ink, 0.9, 'top');
    }
  }
}

/** Draws the sluice gate door with depth sorting (an object in `w.objects`). */
class GateView {
  dead = false;
  constructor(private grid: FarmGrid) {}
  update(): void {}
  draw(g: Gfx): void { this.grid.drawGate(g); }
}

function setup(w: World): void {
  const grid = new FarmGrid();
  GRIDS.set(w, grid);
  w.objects.push(grid, new GateView(grid));
  for (const r of maskWalls(farmMask, w.bounds)) w.walls.push(r);
  w.walls.push(grid.gateWall);
  const addWater = (pl: Pool, r: Rect) => {
    const z = new Zone('water', { k: 'rect', x: r.x, y: r.y, w: r.w, h: r.h });
    z.drawBase = false;
    pl.water.push(w.addZone(z));
    return z;
  };
  for (const lv of [0, 1]) for (const r of waterRects(LEVEL_ROWS[lv][0], LEVEL_ROWS[lv][1])) addWater(grid.pools[lv], r);
  const top = LEVEL_ROWS[2][0];
  for (let k = 0; k < DRAIN_STRIPS; k++) for (const r of waterRects(top + 2 * k, top + 2 * k + 1)) grid.strips[k].push(addWater(grid.pools[2], r));
  for (const [x, y] of FARM.racks) grid.racks.push(w.add(new ServerRack(x, y)));
  for (const [x, y, f, lv] of FARM.conduits) grid.conduits.push(w.add(new ConduitBox(x, y, f, grid, lv)));
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

/** Fell into deep water or the open drain: 1 heart, back on the nearest dry grating of `level`. */
function fall(w: World, level: number, text: string): void {
  const p = w.player;
  w.sfx('spray', 0.8, 0.6);
  w.fallPlayer(nearestDry(level, p.x, p.y), { label: text, color: P.teal });
}

export const serverfarm: Arena = {
  id: 'serverfarm',
  bg: 'bg_serverfarm',
  size: FARM.size,
  bounds: FARM.bounds,
  playerSpawn: FARM.playerSpawn,
  setup,
  update(w: World, dt: number) {
    const grid = farmOf(w);
    const p = w.player;
    if (!grid || p.airborne) return;
    if (w.state === 'fight' && p.hp > 0 && !p.legs.active) {
      if (grid.isDeep(p.x, p.y)) { fall(w, 1, '落入深水'); return; }
      if (grid.inDrain(p.x, p.y)) { fall(w, 2, '掉进排水口'); return; }
    }
    if (grid.inWater(p.x, p.y)) {
      p.slow = Math.min(p.slow, 0.85);
      if (p.moving && w.rng.chance(dt * 8)) w.fx.burst(p.x + w.rng.range(-3, 3), p.y, 1, P.teal, 25, 0.35, 1);
    }
  },
  botHint(w: World) {
    const grid = farmOf(w);
    const p = w.player;
    if (!grid) return null;
    const lv = levelOf(p.y);
    const gate = FARM.gaps[0];
    // the flood: climb to L2, and keep off the gate stairs while L1 is deep
    if (grid.floodDanger) {
      if (lv === 0) { const wp = route(w, p.x, p.y, 320, 680, p.r); return wp ? { ...wp, jump: false } : null; }
      if (p.y > gate.y - 16 && Math.abs(p.x - 320) < 48) return { x: p.x, y: gate.y - 40, jump: false };
    }
    // the open drain
    if (grid.drain !== 'closed' && dist(p.x, p.y, 320, 240) < 52) {
      const [nx, ny] = norm(p.x - 320, p.y - 240 || 1);
      return { x: p.x + nx * 60, y: p.y + ny * 60, jump: false };
    }
    // charged water on this level: get onto grating
    const pl = grid.pools[lv];
    // already on grating while this level is warning or live: hold still until it is over
    if (pl.state !== 'idle' && !pl.inWater(p.x, p.y)) return { x: p.x, y: p.y, jump: false };
    if (pl.state !== 'idle' && pl.inWater(p.x, p.y)) {
      const d = nearestDry(lv, p.x, p.y, 6);
      // far from grating: dash there during the warning too
      return { ...d, jump: pl.state === 'live' || dist(p.x, p.y, d.x, d.y) > 60 };
    }
    // the target is on another level: take the stairs
    const t = w.nearestEnemy(p.x, p.y, 999);
    if (t && levelOf(t.y) !== lv) {
      const wp = route(w, p.x, p.y, t.x, t.y, p.r);
      if (wp) return { ...wp, jump: false };
    }
    return null;
  },
  drawFloor(g: Gfx, w: World) {
    const grid = farmOf(w);
    // green data glow drifting under the water on each level, lamps under the bulkheads
    for (const L of FARM.levels) {
      if (w.camY > L.y1 || w.camY + 360 < L.y0) continue;
      for (let i = 0; i < 6; i++) {
        const x = 80 + i * 96 + Math.sin(w.realTime * 0.4 + i) * 20, y = (L.y0 + L.y1) / 2 + Math.sin(w.realTime * 0.3 + i * 2) * 100;
        g.circle(x, y, 34, P.acid, 0.03, 'light');
      }
      for (const x of [112, 240, 400, 528]) g.circle(x, L.y0 + 2, 36, P.cyan, 0.05 + 0.01 * Math.sin(w.realTime * 2 + x), 'light');
    }
    grid?.drawTerrain(g, w);
    // red beacons on the gate while it is shut
    if (grid && !grid.gateOpen) {
      const gt = FARM.gaps[0], blink = Math.floor(w.realTime * 2) % 2 === 0;
      for (const x of [gt.x - 4, gt.x + gt.w + 4]) g.circle(x, gt.y - 4, 6, P.red, blink ? 0.45 : 0.15, 'light');
    }
  },
};
