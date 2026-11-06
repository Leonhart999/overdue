/** Reusable arena props. Arena-specific devices live next to their arena. */
import { COL, P, type Gfx } from '../engine/gfx';
import type { Rect } from '../engine/math';
import { Body, integrateProp } from './body';
import type { Hit } from './types';
import type { World } from './world';

function shadow(g: Gfx, x: number, y: number, rx: number, ry = rx * 0.4): void {
  g.ellipse(x, y, rx, ry, P.ink, 0.45, 'floor');
}

/** Fuel barrel: explodes when lit. Pushable, grabbable, conductive, flammable. */
export class Barrel extends Body {
  hp = 12;
  lit = false;
  fuse = 0;
  private shock = 0;
  /** Seconds since thrown/launched fast — impacts with bosses detonate. */
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.r = 7; this.hz = 8; this.hr = 7;
    this.mass = 1;
    this.solid = true;
    this.flammable = true;
    this.conductive = true;
    this.grapple = 'pull';
    this.friction = 3.2;
  }

  light(w: World, fuse: number): void {
    if (this.lit) { this.fuse = Math.min(this.fuse, fuse); return; }
    this.lit = true;
    this.fuse = fuse;
    w.sfx('fire', 0.6);
  }

  update(w: World, dt: number): void {
    integrateProp(w, this, dt);
    if (this.flash > 0) this.flash -= dt;
    if (this.shock > 0) this.shock = Math.max(0, this.shock - dt * 0.5);
    if (this.lit) {
      this.fuse -= dt;
      if (w.rng.chance(dt * 25)) w.fx.flame(this.x + w.rng.range(-3, 3), this.y - 16);
      if (this.fuse <= 0) this.explode(w);
    }
  }

  hurt(w: World, h: Hit): number {
    this.flash = 0.05;
    if (h.ignite || h.kind === 'blast' || h.kind === 'fire') this.light(w, h.kind === 'blast' ? 0.12 : 0.5);
    this.hp -= h.dmg;
    if (this.hp <= 0) this.light(w, 0.1);
    return 0;
  }

  onShock(w: World, _dps: number, dt: number): void {
    this.shock += dt;
    if (this.shock > 0.45) this.light(w, 0.25);
  }

  onRammed(w: World): boolean {
    this.explode(w);
    return false;
  }

  onImpact(w: World, other: Body | null): void {
    if (other && other.team === 'enemy') this.explode(w);
  }

  explode(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.explode(this.x, this.y - 6, 48, { enemyDmg: 160, poise: 45, armorBreak: 1, playerDmg: 1, from: 'env', src: 'barrel' });
  }

  draw(g: Gfx): void {
    shadow(g, this.x, this.y, 7);
    const flick = this.lit && Math.floor(this.fuse * 20) % 2 === 0;
    g.img('props', this.lit ? 'barrel_lit' : 'barrel', this.x, this.y + 1, { fill: this.flash > 0 || flick ? P.white : undefined });
    if (this.lit) g.circle(this.x, this.y - 10, 12, P.orange, 0.3, 'light');
  }
}

/** Steel column: solid cover, conductive, stops a charging boss (and breaks). */
export class Pillar extends Body {
  constructor(x: number, y: number, public frame = 'pillar') {
    super();
    this.x = x; this.y = y;
    this.r = 9; this.hz = 18; this.hr = 13;
    this.mass = 0;
    this.solid = true;
    this.blocksShots = true;
    this.conductive = true;
    this.grapple = 'anchor';
  }
  hurt(w: World, h: Hit): number {
    if (!h.quiet && h.kind !== 'fire') w.fx.sparks(h.x, h.y, 1, P.fog, 40);
    return 0;
  }
  onRammed(w: World): boolean {
    this.dead = true;
    w.fx.debris(this.x, this.y - 16, 16, [P.slate, P.steel, P.amber, P.ink], 180);
    w.fx.smoke(this.x, this.y - 10, 8, P.slate, 6, 20);
    w.sfx('crash');
    return true;
  }
  draw(g: Gfx): void {
    shadow(g, this.x, this.y, 10);
    g.img('pillar', this.frame, this.x, this.y + 2);
  }
}

/** Crushed-car cube dropped by the crane: like a pillar but wider. */
export class ScrapBlock extends Pillar {
  constructor(x: number, y: number) {
    super(x, y, 'scrap_block');
    this.r = 14; this.hz = 12; this.hr = 14;
  }
  draw(g: Gfx): void {
    shadow(g, this.x, this.y, 15);
    g.img('block', 'scrap_block', this.x, this.y + 4);
  }
}

/** Wall lever. Pull with E, the grapple, or hack it. */
export class Lever extends Body {
  down = 0;
  constructor(x: number, y: number, private onPull: (w: World) => boolean, public facing: 1 | -1 = 1) {
    super();
    this.x = x; this.y = y;
    this.r = 6; this.hz = 10; this.hr = 8;
    this.mass = 0;
    this.solid = true;
    this.interactable = true;
    this.hackable = true;
    this.targetable = false;
    this.interactLabel = '拉下拉杆';
  }
  update(_w: World, dt: number): void { if (this.down > 0) this.down -= dt; }
  onInteract(w: World): void {
    if (this.down > 0) return;
    if (this.onPull(w)) {
      this.down = 0.8;
      w.sfx('lever');
    } else w.sfx('click');
  }
  onHack(w: World): void { this.onInteract(w); }
  draw(g: Gfx, w: World): void {
    g.img('props', this.down > 0 ? 'lever_down' : 'lever_up', this.x, this.y + 2, { flipX: this.facing < 0 });
    const pulse = 0.25 + 0.15 * Math.sin(w.realTime * 5);
    g.circle(this.x, this.y - 10, 9, COL.interact, pulse * 0.6, 'light');
  }
}

/**
 * Destructible cover (a stack of crushed cars). While standing it is a wall rect in `w.walls`,
 * so it blocks movement, bullets, hooks and the ram lane like any wall. Three blasts, a crane
 * drop or a ram (the arena calls `collapse`) knock it down and leave flat rubble.
 * (x, y) is the centre of the footprint.
 */
export class CarStack extends Body {
  hits = 3;
  readonly wall: Rect;
  constructor(x: number, y: number, readonly fw = 48, readonly fh = 32) {
    super();
    this.x = x; this.y = y;
    this.r = 20; this.hz = 0; this.hr = 20;
    this.mass = 0;
    this.targetable = false;
    this.wall = { x: x - fw / 2, y: y - fh / 2, w: fw, h: fh };
  }

  /** Put the wall into the world (call once after `w.add`). */
  attach(w: World): this {
    w.walls.push(this.wall);
    return this;
  }

  update(_w: World, dt: number): void { if (this.flash > 0) this.flash -= dt; }

  hurt(w: World, h: Hit): number {
    if (h.kind !== 'blast' && h.kind !== 'crush') return 0;
    this.flash = 0.08;
    this.hits -= h.kind === 'crush' ? 3 : 1;
    w.fx.debris(this.x, this.y - 10, 5, [P.rust, P.umber, P.slate], 90);
    if (this.hits <= 0) this.collapse(w);
    return 0;
  }

  collapse(w: World): void {
    if (this.dead) return;
    this.dead = true;
    w.walls = w.walls.filter((r) => r !== this.wall);
    w.objects.push(new Rubble(this.x, this.y + this.fh / 2));
    w.fx.debris(this.x, this.y - 12, 22, [P.rust, P.umber, P.slate, P.steel, P.orange], 200);
    w.fx.smoke(this.x, this.y, 10, P.umber, 7, 15);
    w.fx.shake(4, 0.2);
    w.sfx('crash');
  }

  draw(g: Gfx): void {
    g.img('stack', this.hits < 3 ? 'car_stack_dent' : 'car_stack', this.x, this.y + this.fh / 2, { fill: this.flash > 0 ? P.white : undefined });
  }
}

/** Flattened cars left on the floor after a CarStack collapses (decal only). */
class Rubble {
  dead = false;
  constructor(private x: number, private y: number) {}
  update(): void {}
  draw(g: Gfx): void { g.img('stack', 'car_rubble', this.x, this.y, { layer: 'floor' }); }
}
