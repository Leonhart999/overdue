/**
 * Rustport scrapyard (Gearjaw). Interactables:
 *   - gantry crane: patrols a loop carrying a scrap load; levers (E / grapple / hack) drop it.
 *     The impact staggers the boss outright and leaves a scrap block (a new ram-stopper).
 *   - fuel barrels, steel pillars, oil puddles (props.ts / hazard.ts)
 * From P3 the crane also drops fresh barrels.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { clamp, dist } from '../../engine/math';
import { Body } from '../body';
import { Zone } from '../hazard';
import { Barrel, Lever, Pillar, ScrapBlock } from '../props';
import type { Arena, World } from '../world';

const PATH: [number, number][] = [[112, 112], [528, 112], [528, 292], [112, 292]];
const PATH_LEN = PATH.reduce((s, p, i) => s + dist(p[0], p[1], PATH[(i + 1) % 4][0], PATH[(i + 1) % 4][1]), 0);

function pathPoint(d: number): [number, number] {
  d = ((d % PATH_LEN) + PATH_LEN) % PATH_LEN;
  for (let i = 0; i < 4; i++) {
    const a = PATH[i], b = PATH[(i + 1) % 4];
    const l = dist(a[0], a[1], b[0], b[1]);
    if (d <= l) return [a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l];
    d -= l;
  }
  return PATH[0];
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
  x = PATH[0][0];
  y = PATH[0][1];
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

  update(w: World, dt: number): void {
    if (this.dropT < 0 && this.fallT < 0) {
      this.d += 46 * dt;
      [this.x, this.y] = pathPoint(this.d);
    }
    if (!this.loaded && this.dropT < 0 && this.fallT < 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.loaded = true; w.sfx('lever', 0.5); }
    }
    if (this.dropT >= 0) {
      this.dropT += dt;
      this.sirenT -= dt;
      if (this.sirenT <= 0) { w.sfx('siren', 0.6); this.sirenT = 0.75; }
      if (this.dropT >= this.warn) { this.dropT = -1; this.fallT = 0; }
    }
    if (this.fallT >= 0) {
      this.fallT += dt;
      if (this.fallT >= this.fall) { this.fallT = -1; this.crush(w); }
    }
    // P3: barrel resupply
    if (w.boss && w.boss.phase >= 2 && !w.boss.dying) {
      this.barrelT -= dt;
      const barrels = w.bodies.filter((b) => b instanceof Barrel).length;
      if (this.barrelT <= 0 && barrels < 4) {
        this.barrelT = 8;
        const [x, y] = w.clampToBounds(w.rng.range(90, 550), w.rng.range(100, 300), 20);
        this.incoming.push({ x, y, t: 0.8 });
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

  /** Lever / hack. Returns false when the crane cannot drop right now. */
  pull(w: World, hacked = false): boolean {
    if (!this.loaded || this.dropT >= 0 || this.fallT >= 0) {
      w.fx.label(this.x, this.y - 70, this.loaded ? '正在落下' : `装货中 ${Math.ceil(this.reloadT)}s`, P.fog, 0.8);
      return false;
    }
    this.dropT = hacked ? this.warn * 0.4 : 0;
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
        // push the block out of the boss
        const bb = w.boss;
        const d = dist(bb.x, bb.y, bx, by) || 1;
        const need = 26 + blk.r + 2;
        if (d < need) { blk.x = bb.x + ((bx - bb.x) / d) * need; blk.y = bb.y + ((by - bb.y) / d) * need; [blk.x, blk.y] = w.clampToBounds(blk.x, blk.y, 18); }
      }
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

  drawTop(g: Gfx): void {
    // gantry bridge across the yard at the trolley's depth
    const by = this.y - 104;
    // girder bridge: dark beam, lit top rail, cross bracing
    g.rect(16, by - 4, 608, 7, P.night, 0.6, 'top');
    g.line(16, by - 4, 624, by - 4, 1, P.rust, 0.7, 'top');
    g.line(16, by + 3, 624, by + 3, 1, P.umber, 0.7, 'top');
    for (let x = 16; x < 624; x += 12) g.line(x, by - 3, x + 6, by + 2, 1, P.umber, 0.5, 'top');
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

export const scrapyard: Arena = {
  id: 'scrapyard',
  bg: 'bg_scrapyard',
  bounds: { x: 16, y: 48, w: 608, h: 288 },
  playerSpawn: { x: 320, y: 300 },
  setup(w: World) {
    const crane = new Crane();
    w.objects.push(crane);
    w.add(new CraneHandle(crane));
    w.add(new Lever(30, 196, (ww) => crane.pull(ww), 1));
    w.add(new Lever(610, 196, (ww) => crane.pull(ww), -1));
    for (const [x, y] of [[150, 146], [490, 146], [150, 262], [490, 262]]) w.add(new Pillar(x, y));
    for (const [x, y] of [[248, 106], [392, 106], [80, 300], [560, 300], [320, 236]]) w.add(new Barrel(x, y));
    for (const [x, y, r] of [[232, 200, 22], [408, 200, 22], [320, 128, 18], [96, 96, 18], [544, 96, 18]]) {
      w.addZone(new Zone('oil', { k: 'circle', x, y, r }));
    }
  },
  drawFloor(g: Gfx, w: World) {
    // sodium lamps along the top wall
    for (const x of [96, 240, 400, 544]) {
      g.circle(x, 52, 40, P.sodium, 0.06 + 0.01 * Math.sin(w.realTime * 3 + x), 'light');
    }
    void clamp;
  },
};
