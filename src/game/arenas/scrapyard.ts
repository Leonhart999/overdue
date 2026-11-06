/**
 * Rustport compactor yard (Gearjaw). Layout: docs/arena-plan.html, GDD 8.1.
 *   - the four corners are cut by scrap heaps (tile mask shared with the background art).
 *   - gantry crane: the trolley runs up and down the centre line x = 320, so every drop lands
 *     on that line. Levers at both rail ends (E / grapple / hack) drop the load; the impact
 *     staggers the boss outright and leaves a scrap block (a new ram-stopper).
 *   - two steel pillars stand on the centre line: ram one, then drop the crane on him.
 *   - four car stacks (destructible cover) split the yard into three lanes; rams, the crane
 *     and three blasts knock them down. Gearjaw topples the two nearest when his armour blows.
 *   - fuel barrels and two oil troughs across the middle lane.
 *   - P3: the compactor plates on both side walls push in 48 px. A ram into a plate pins him
 *     for 2 s; shooting (or hacking) a plate's red button slams it: 300 damage + stagger.
 * From P3 the crane also drops fresh barrels.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { clamp, dist, type Rect } from '../../engine/math';
import { borderMask, maskWalls, type TileMask } from '../arenaMask';
import { Body } from '../body';
import { Zone } from '../hazard';
import { Barrel, CarStack, Lever, Pillar, ScrapBlock } from '../props';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

export const YARD = {
  bounds: { x: 16, y: 48, w: 608, h: 288 } as Rect,
  rail: { x: 320, y0: 96, y1: 288 },
  pillars: [[320, 128], [320, 272]] as [number, number][],
  stacks: [[176, 136], [464, 136], [176, 264], [464, 264]] as [number, number][],
  barrels: [[248, 96], [392, 96], [80, 232], [560, 232], [256, 312]] as [number, number][],
  /** Two oil troughs across the middle lane, each a row of touching puddles. */
  oil: [226, 246, 266, 286, 354, 374, 394, 414].map((x) => [x, 200, 11]) as [number, number, number][],
  levers: [[288, 62, 1], [352, 330, -1]] as [number, number, 1 | -1][],
  /** Compactor plates on the side walls (y range) and how far they push in. */
  plates: { y0: 96, y1: 288, depth: 48, slam: 40 },
  playerSpawn: { x: 320, y: 316 },
};

/** Scrap heaps cut the four corners in three steps: row -> tiles in from each side. */
const CORNER: Record<number, number> = { 3: 4, 4: 2, 5: 1, 18: 1, 19: 2, 20: 4 };
export const yardMask: TileMask = (c, r) => {
  if (borderMask(c, r)) return true;
  const k = CORNER[r];
  return k !== undefined && (c <= k || c >= 39 - k);
};

function circleRect(x: number, y: number, r: number, rc: Rect): boolean {
  const cx = clamp(x, rc.x, rc.x + rc.w), cy = clamp(y, rc.y, rc.y + rc.h);
  return (x - cx) ** 2 + (y - cy) ** 2 < r * r;
}

/** Invisible hackable handle on the crane's ground target. */
class CraneHandle extends Body {
  constructor(private crane: Crane) {
    super();
    this.targetable = false;
    this.hackable = true;
    this.mass = 0;
    this.r = 4; this.hz = 0; this.hr = 14;
  }
  update(): void { this.x = this.crane.x; this.y = this.crane.y; }
  onHack(w: World): void { this.crane.pull(w, true); }
}

export class Crane {
  x = YARD.rail.x;
  y = YARD.rail.y0;
  private d = 0;
  loaded = true;
  reloadT = 0;
  private dropT = -1;
  private fallT = -1;
  private readonly warn = 0.85;
  private readonly fall = 0.22;
  private sirenT = 0;
  dead = false;
  private barrelT = 6;
  private incoming: { x: number; y: number; t: number }[] = [];
  /** Hacked drops race the trolley along the rail to the crosshair's height before falling. */
  private hackTo: number | null = null;

  update(w: World, dt: number): void {
    const { y0, y1 } = YARD.rail;
    if (this.dropT < 0 && this.fallT < 0) {
      this.d += 46 * dt;
      const L = y1 - y0, m = this.d % (2 * L);
      this.y = y0 + (m < L ? m : 2 * L - m);
    }
    if (!this.loaded && this.dropT < 0 && this.fallT < 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.loaded = true; w.sfx('lever', 0.5); }
    }
    if (this.dropT >= 0) {
      this.dropT += dt;
      if (this.hackTo !== null) {
        const dy = this.hackTo - this.y, step = 700 * dt;
        this.y = Math.abs(dy) <= step ? this.hackTo : this.y + Math.sign(dy) * step;
      }
      this.sirenT -= dt;
      if (this.sirenT <= 0) { w.sfx('siren', 0.6); this.sirenT = 0.75; }
      if (this.dropT >= this.warn) { this.dropT = -1; this.fallT = 0; }
    }
    if (this.fallT >= 0) {
      this.fallT += dt;
      if (this.fallT >= this.fall) {
        this.fallT = -1;
        this.crush(w);
        if (this.hackTo !== null) { this.d = this.railDistance(this.y); this.hackTo = null; }
      }
    }
    // P3: barrel resupply
    if (w.boss && w.boss.phase >= 2 && !w.boss.dying) {
      this.barrelT -= dt;
      const barrels = w.bodies.filter((b) => b instanceof Barrel).length;
      if (this.barrelT <= 0 && barrels < 4) {
        this.barrelT = 8;
        const spot = freeSpot(w);
        if (spot) this.incoming.push({ ...spot, t: 0.8 });
      }
    }
    for (const inc of this.incoming) {
      inc.t -= dt;
      if (inc.t <= 0) {
        w.add(new Barrel(inc.x, inc.y));
        w.fx.smoke(inc.x, inc.y, 5, P.slate, 4, 10);
        w.sfx('land', 0.6);
      }
    }
    this.incoming = this.incoming.filter((i) => i.t > 0);
  }

  /** Patrol distance that puts the trolley at height y on its way down the rail. */
  private railDistance(y: number): number { return y - YARD.rail.y0; }

  /** Lever / hack. Returns false when the crane cannot drop right now. */
  pull(w: World, hacked = false): boolean {
    if (!this.loaded || this.dropT >= 0 || this.fallT >= 0) {
      w.fx.label(this.x, this.y - 70, this.loaded ? '正在落下' : `装货中 ${Math.ceil(this.reloadT)}s`, P.fog, 0.8);
      return false;
    }
    this.dropT = 0;
    if (hacked) this.hackTo = clamp(w.input.ay, YARD.rail.y0, YARD.rail.y1);
    this.sirenT = 0;
    w.fx.label(this.x, this.y - 74, '吊车落下', COL.interact, 1);
    return true;
  }

  private crush(w: World): void {
    this.loaded = false;
    this.reloadT = 12;
    const R = 36;
    w.sfx('crush');
    w.fx.shake(9, 0.4);
    w.hitstop = Math.max(w.hitstop, 0.08);
    w.fx.ring(this.x, this.y, 10, R + 20, P.amber, 0.35, 3);
    w.fx.debris(this.x, this.y - 10, 24, [P.rust, P.umber, P.slate, P.steel], 220);
    w.fx.smoke(this.x, this.y, 14, P.umber, 7, 15);
    let hitBoss = false;
    for (const b of w.bodies) {
      if (b.dead) continue;
      if (dist(b.x, b.y, this.x, this.y) > R + b.r) continue;
      if (b.team === 'enemy') {
        w.damage(b, { dmg: 350, kind: 'crush', x: b.hx, y: b.hy, poise: 999, armorBreak: 2, from: 'env', src: 'crane' });
        hitBoss = true;
      } else if (b.flammable) w.damage(b, { dmg: 99, kind: 'blast', x: b.hx, y: b.hy, from: 'env', ignite: true });
    }
    const p = w.player;
    if (dist(p.x, p.y, this.x, this.y) < R) w.hitPlayer(2, { x: this.x, y: this.y, knock: 200, dx: p.x - this.x, dy: p.y - this.y });
    // the load stays as a scrap block unless something big is in the way
    const blocked = w.bodies.some((b) => !b.dead && b.solid && b.mass === 0 && dist(b.x, b.y, this.x, this.y) < b.r + 14);
    if (!blocked || hitBoss) {
      const [bx, by] = w.clampToBounds(this.x, this.y, 18);
      const blk = w.add(new ScrapBlock(bx, by));
      if (hitBoss && w.boss) {
        // push the block out of the boss, along the rail
        const bb = w.boss;
        const d = dist(bb.x, bb.y, bx, by) || 1;
        const need = 26 + blk.r + 2;
        if (d < need) { blk.x = bb.x + ((bx - bb.x) / d) * need; blk.y = bb.y + ((by - bb.y) / d) * need; [blk.x, blk.y] = w.clampToBounds(blk.x, blk.y, 18); }
      }
      if (w.pointInWall(blk.x, blk.y)) blk.dead = true;
    }
  }

  draw(g: Gfx, w: World): void {
    // ground shadow + crosshair
    const warn = this.dropT >= 0 || this.fallT >= 0;
    const pulse = 0.5 + 0.5 * Math.sin(w.realTime * 18);
    if (this.loaded || warn) {
      const c = warn ? P.red : P.ink;
      g.ellipse(this.x, this.y, 30, 13, c, warn ? 0.25 + 0.2 * pulse : 0.3);
      g.ring(this.x, this.y, warn ? 36 : 6, 1, warn ? P.red : COL.interact, warn ? 0.9 : 0.5);
      g.line(this.x - 8, this.y, this.x + 8, this.y, 1, warn ? P.red : COL.interact, 0.6);
      g.line(this.x, this.y - 5, this.x, this.y + 5, 1, warn ? P.red : COL.interact, 0.6);
    }
    for (const inc of this.incoming) g.ring(inc.x, inc.y, 10 * (inc.t / 0.8) + 4, 1, P.orange, 0.8);
  }

  /** Hack target standing in for the crane (its glyph timer drives the hacked look). */
  handle: Body | null = null;

  drawTop(g: Gfx, w: World): void {
    const hacked = !!this.handle && this.handle.glyphUntil > w.time;
    if (hacked) g.glyphs(true);
    this.drawRig(g);
    if (hacked) g.glyphs(false);
  }

  private drawRig(g: Gfx): void {
    // overhead rail along the centre line, 104 px up (3/4 view)
    const { x, y0, y1 } = YARD.rail;
    const top = Math.max(34, y0 - 104), bot = y1 - 104;
    g.rect(x - 3, top, 7, bot - top, P.night, 0.55, 'top');
    g.line(x - 3, top, x - 3, bot, 1, P.rust, 0.7, 'top');
    g.line(x + 3, top, x + 3, bot, 1, P.umber, 0.7, 'top');
    for (let y = top; y < bot; y += 12) g.line(x - 2, y, x + 2, y + 6, 1, P.umber, 0.5, 'top');
    const by = this.y - 104;
    g.img('block', 'trolley', this.x, by + 4, { layer: 'top', oy: 1 });
    let ly = this.y - 66;
    if (this.fallT >= 0) ly = this.y - 66 + 66 * (this.fallT / this.fall) ** 2;
    if (this.loaded || this.fallT >= 0) {
      if (this.fallT < 0) g.line(this.x, by + 2, this.x, ly - 22, 1, P.slate, 0.9, 'top');
      g.img('block', 'scrap_block', this.x, ly + 4, { layer: 'top', alpha: this.fallT >= 0 ? 1 : 0.9 });
    } else {
      g.line(this.x, by + 2, this.x, by + 16, 1, P.slate, 0.9, 'top');
      g.img('proj', 'magnet', this.x, by + 20, { layer: 'top', ox: 0.5, oy: 0.5 });
    }
  }
}

/** A floor spot for a resupplied barrel: not in a wall, clear of solid props and the rail. */
function freeSpot(w: World): { x: number; y: number } | null {
  for (let i = 0; i < 16; i++) {
    const x = w.rng.range(90, 550), y = w.rng.range(100, 300);
    if (Math.abs(x - YARD.rail.x) < 30 || w.pointInWall(x, y)) continue;
    if (w.bodies.some((b) => !b.dead && b.solid && dist(b.x, b.y, x, y) < b.r + 16)) continue;
    if (w.boss && dist(w.boss.x, w.boss.y, x, y) < 50) continue;
    return { x, y };
  }
  return null;
}

// ------------------------------------------------------------------ compactor plates (P3)
/** Red button on a plate face: shoot it, hit it or hack it to slam the plate. */
class PlateButton extends Body {
  constructor(private c: Compactor, readonly side: number) {
    super();
    this.r = 4; this.hz = 14; this.hr = 8;
    this.mass = 0;
    this.blocksShots = true;
    this.hackable = true;
  }
  hurt(w: World, h: Hit): number {
    if (h.from === 'player') this.c.slam(w, this.side);
    return 0;
  }
  onHack(w: World): void { this.c.slam(w, this.side); }
  draw(g: Gfx, w: World): void {
    const ready = this.c.ready(this.side);
    const pinned = this.c.pinT[this.side] > 0;
    const pulse = 0.5 + 0.5 * Math.sin(w.realTime * (pinned ? 16 : 5));
    g.circle(this.x, this.y - this.hz, 5, P.ink, 1, 'top');
    g.circle(this.x, this.y - this.hz, 4, ready ? P.red : P.maroon, 1, 'top');
    if (ready) g.circle(this.x, this.y - this.hz, 10 + 4 * pulse, P.red, pinned ? 0.45 : 0.2, 'light');
  }
}

type PlateState = 'idle' | 'warn' | 'moving' | 'set';

export class Compactor {
  state: PlateState = 'idle';
  private t = 0;
  private sirenT = 0;
  offset = 0;
  dead = false;
  readonly walls: Rect[] = [];
  readonly buttons: PlateButton[] = [];
  readonly slamCd = [0, 0];
  readonly slamT = [0, 0];
  /** Seconds a rammed boss stays pinned against each plate (button pulses fast). */
  readonly pinT = [0, 0];
  private static readonly WARN = 2;
  private static readonly MOVE = 1.5;

  /** x of plate `side` (0 = left, 1 = right) surface facing the yard. */
  face(side: number): number {
    const b = YARD.bounds;
    return side === 0 ? b.x + this.offset : b.x + b.w - this.offset;
  }

  ready(side: number): boolean { return this.state === 'set' && this.slamCd[side] <= 0; }

  update(w: World, dt: number): void {
    const boss = w.boss;
    for (let s = 0; s < 2; s++) {
      this.slamCd[s] = Math.max(0, this.slamCd[s] - dt);
      this.slamT[s] = Math.max(0, this.slamT[s] - dt);
      this.pinT[s] = Math.max(0, this.pinT[s] - dt);
    }
    switch (this.state) {
      case 'idle':
        if (boss && boss.phase >= 2 && !boss.dying) {
          this.state = 'warn';
          this.t = 0;
          this.sirenT = 0;
          w.fx.label(320, 90, '压实板推进', P.red, 1.6);
        }
        return;
      case 'warn':
        this.t += dt;
        this.sirenT -= dt;
        if (this.sirenT <= 0) { w.sfx('siren', 0.7); this.sirenT = 0.5; }
        if (this.t >= Compactor.WARN) {
          this.state = 'moving';
          this.t = 0;
          const { y0, y1 } = YARD.plates;
          for (let s = 0; s < 2; s++) { const rc = { x: this.face(s), y: y0, w: 0, h: y1 - y0 }; this.walls.push(rc); w.walls.push(rc); }
          w.sfx('rev', 0.8, 0.6);
        }
        return;
      case 'moving':
        this.t += dt;
        this.offset = YARD.plates.depth * Math.min(1, this.t / Compactor.MOVE);
        this.syncWalls();
        this.shove(w, true);
        if (w.rng.chance(dt * 10)) w.fx.shake(1.5, 0.1);
        if (this.t >= Compactor.MOVE) {
          this.state = 'set';
          w.sfx('crash', 0.8);
          w.fx.shake(5, 0.25);
          for (let s = 0; s < 2; s++) this.buttons.push(w.add(new PlateButton(this, s)));
        }
        break;
      case 'set':
        this.shove(w, false);
        break;
    }
    const mid = (YARD.plates.y0 + YARD.plates.y1) / 2;
    for (const bt of this.buttons) { bt.x = this.face(bt.side) + (bt.side === 0 ? 3 : -3); bt.y = mid + 8; }
  }

  private syncWalls(): void {
    const b = YARD.bounds;
    this.walls[0].x = b.x; this.walls[0].w = this.offset;
    this.walls[1].x = b.x + b.w - this.offset; this.walls[1].w = this.offset;
  }

  /** Keep everything on the yard side of both plates; barrels caught by a moving plate burst. */
  private shove(w: World, moving: boolean): void {
    const { y0, y1 } = YARD.plates;
    for (let s = 0; s < 2; s++) {
      const f = this.face(s), dir = s === 0 ? 1 : -1;
      const caught = (x: number, y: number, r: number) => y + r > y0 && y - r < y1 && (dir === 1 ? x - r < f : x + r > f);
      const p = w.player;
      if (caught(p.x, p.y, p.r)) p.x = f + dir * p.r;
      for (const b of w.bodies) {
        if (b.dead || b.team === 'enemy' || b instanceof PlateButton || !caught(b.x, b.y, b.r)) continue;
        if (b instanceof Barrel && moving) { b.explode(w); continue; }
        if (b.mass > 0 || b.solid) b.x = f + dir * b.r;
      }
      const boss = w.boss;
      const r = boss?.parts[0]?.r ?? 0;
      if (boss && r && caught(boss.x, boss.y, r)) {
        const dx = f + dir * r - boss.x;
        boss.x += dx;
        for (const pt of boss.parts) pt.x += dx;
      }
    }
  }

  /** A ram ended against a wall at (x, y): if that wall is a plate, pin the boss for 2 s. */
  pin(w: World, x: number, y: number, r: number): number {
    if (this.state !== 'set') return 0;
    const { y0, y1 } = YARD.plates;
    if (y < y0 || y > y1) return 0;
    for (let s = 0; s < 2; s++) {
      if (Math.abs(x - this.face(s)) > r + 6) continue;
      this.pinT[s] = 2;
      w.fx.label(x, y - 70, '卡住', P.amber, 1.2);
      return 2;
    }
    return 0;
  }

  /** Slam plate `side` out 40 px: 300 damage + stagger to boss parts, a heart to the player, barrels burst. */
  slam(w: World, side: number): boolean {
    if (!this.ready(side)) return false;
    this.slamCd[side] = 8;
    this.slamT[side] = 0.3;
    const { y0, y1, slam } = YARD.plates;
    const f = this.face(side);
    const zone = { x: side === 0 ? f : f - slam, y: y0, w: slam, h: y1 - y0 };
    const dir = side === 0 ? 1 : -1;
    w.sfx('crush');
    w.fx.shake(8, 0.3);
    w.hitstop = Math.max(w.hitstop, 0.06);
    w.fx.debris(f + dir * 20, (y0 + y1) / 2, 18, [P.rust, P.steel, P.amber], 200);
    let hitBoss = false;
    for (const b of w.bodies) {
      if (b.dead || !circleRect(b.x, b.y, b.r, zone)) continue;
      if (b.team === 'enemy' && !hitBoss) {
        hitBoss = true;
        w.damage(b, { dmg: 300, kind: 'crush', x: b.hx, y: b.hy, dx: dir, dy: 0, poise: 999, armorBreak: 2, from: 'env', src: 'press' });
      } else if (b instanceof Barrel) b.explode(w);
    }
    const p = w.player;
    if (circleRect(p.x, p.y, p.r, zone)) w.hitPlayer(1, { x: p.x, y: p.y, knock: 220, dx: dir, dy: 0 });
    w.fx.label(f + dir * 30, y0 - 4, hitBoss ? '压实 300' : '压实', P.amber, 1);
    return true;
  }

  draw(g: Gfx, w: World): void {
    const { y0, y1, slam } = YARD.plates;
    const blink = this.state === 'warn' && Math.floor(w.realTime * 6) % 2 === 0;
    for (let s = 0; s < 2; s++) {
      const b = YARD.bounds;
      const out = this.slamT[s] > 0 ? slam * Math.sin((this.slamT[s] / 0.3) * Math.PI) : 0;
      const depth = this.offset + 6 + out;
      const x = s === 0 ? b.x : b.x + b.w - depth;
      // top of the plate (3/4 view: lifted 10 px) and its face
      g.rect(x, y0 - 10, depth, y1 - y0 + 10, P.slate, 1);
      for (let yy = y0; yy < y1; yy += 24) { g.line(x, yy, x + depth, yy, 1, P.navy, 0.9); g.line(x, yy + 1, x + depth, yy + 1, 1, P.fog, 0.5); }
      const fx = s === 0 ? x + depth - 3 : x;
      g.rect(fx, y0 - 10, 3, y1 - y0 + 10, P.fog, 1);
      for (let yy = y0 - 10; yy < y1; yy += 8) g.rect(fx, yy, 3, 4, blink ? P.red : (Math.floor(yy / 8) % 2 ? P.amber : P.ink), 1);
      if (this.state === 'warn') g.rect(s === 0 ? b.x : b.x + b.w - 54, y0, 54, y1 - y0, P.red, blink ? 0.18 : 0.08);
    }
  }
}

// ------------------------------------------------------------------ yard state for the boss
class Yard {
  constructor(readonly crane: Crane, readonly compactor: Compactor, readonly stacks: CarStack[]) {}

  /**
   * A ram ended against a wall at (x, y) with hull radius r. Knocks down any car stack it hit.
   * Returns how long the boss is held there: 2 s when pinned against a compactor plate, else 0.
   */
  onRamWall(w: World, x: number, y: number, r: number): number {
    for (const s of this.stacks) if (!s.dead && circleRect(x, y, r + 8, s.wall)) s.collapse(w);
    return this.compactor.pin(w, x, y, r);
  }

  /** Knock down the n standing stacks nearest to (x, y) (Gearjaw's armour blowing off). */
  topple(w: World, x: number, y: number, n: number): void {
    const alive = this.stacks.filter((s) => !s.dead).sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y));
    for (const s of alive.slice(0, n)) s.collapse(w);
  }
}

const YARDS = new WeakMap<World, Yard>();
export function yardOf(w: World): Yard | undefined { return YARDS.get(w); }

export const scrapyard: Arena = {
  id: 'scrapyard',
  bg: 'bg_scrapyard',
  bounds: YARD.bounds,
  playerSpawn: YARD.playerSpawn,
  setup(w: World) {
    for (const r of maskWalls(yardMask, YARD.bounds)) w.walls.push(r);
    const crane = new Crane();
    w.objects.push(crane);
    crane.handle = w.add(new CraneHandle(crane));
    for (const [x, y, f] of YARD.levers) w.add(new Lever(x, y, (ww) => crane.pull(ww), f));
    for (const [x, y] of YARD.pillars) w.add(new Pillar(x, y));
    const stacks = YARD.stacks.map(([x, y]) => w.add(new CarStack(x, y)).attach(w));
    for (const [x, y] of YARD.barrels) w.add(new Barrel(x, y));
    for (const [x, y, r] of YARD.oil) w.addZone(new Zone('oil', { k: 'circle', x, y, r }));
    const compactor = new Compactor();
    w.objects.push(compactor);
    YARDS.set(w, new Yard(crane, compactor, stacks));
  },
  drawFloor(g: Gfx, w: World) {
    // sodium lamps along the top wall
    for (const x of [96, 240, 400, 544]) {
      g.circle(x, 52, 40, P.sodium, 0.06 + 0.01 * Math.sin(w.realTime * 3 + x), 'light');
    }
  },
};
