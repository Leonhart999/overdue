/**
 * FOLD — architect of a modular construction site whose rooms slide on rails.
 *
 * He reaches the player wherever they hide: a crane hop lands on them, measuring bolts bank off
 * walls along a drawn path, steel beams and rivet bundles drop over the partitions, and the
 * rooms themselves close the corridor the player stands in (2 hearts). Every self-stagger is a
 * reward the player sets up: a charge into a pillar, beam or console, the press in the hub,
 * the brake while he rides a moving room or hangs from the crane, a squeeze or a cut crane cable.
 *
 * P1 two-bolt bank shot (1 bounce), charge, beam, crane hop, hammer, squeeze (one band).
 * P2 rails on both axes: bolts bounce twice and come in triples, two beams, rivet bundles,
 *    the hop lands with a rivet ring, triple hammer.
 * P3 whole-line squeezes (both bands of an axis), four-bolt bursts, cross cut, hop -> charge.
 */
import { FOLD_TEXT as T } from '../../data/text';
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleTo, closestOnSegment, dist, norm, rayCircle, type Rect } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Boss, BossPart, type HitTag } from '../boss';
import { Bullet } from '../bullet';
import { foundry, foundryOf, freeSpot, unstick } from '../arenas/foundry';
import { Barrel } from '../props';
import { shapeHits, type Cable, type Hit, type Shape } from '../types';
import type { World } from '../world';
import type { BossDef } from './registry';

const SPAWN = { x: 652, y: 214 };

/** Ray vs rect that also reports which face was hit ('x' = a vertical face). */
function rayRectN(ox: number, oy: number, dx: number, dy: number, r: Rect): { t: number; axis: 'x' | 'y' } {
  let tmin = -Infinity, tmax = Infinity, axis: 'x' | 'y' = 'x';
  if (Math.abs(dx) < 1e-9) { if (ox < r.x || ox > r.x + r.w) return { t: Infinity, axis }; }
  else {
    const t1 = (r.x - ox) / dx, t2 = (r.x + r.w - ox) / dx;
    tmin = Math.min(t1, t2); tmax = Math.max(t1, t2);
  }
  if (Math.abs(dy) < 1e-9) { if (oy < r.y || oy > r.y + r.h) return { t: Infinity, axis }; }
  else {
    const t1 = (r.y - oy) / dy, t2 = (r.y + r.h - oy) / dy;
    const a = Math.min(t1, t2);
    if (a > tmin) { tmin = a; axis = 'y'; }
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < Math.max(0, tmin)) return { t: Infinity, axis };
  return { t: Math.max(0, tmin), axis };
}

/** Hard measuring bolt that follows a precomputed bank path; once deflected it flies straight. */
class RailBolt extends Bullet {
  private seg = 0;
  private along = 0;
  constructor(private pts: number[], private sp: number) {
    super(pts[0], pts[1], 0, 0, 'enemy');
    this.soft = false; this.frame = 'bolt'; this.r = 2.5; this.rotates = true;
    this.glow = 6; this.glowColor = COL.hard; this.deflectable = true;
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    this.life = len / sp + 0.3;
    this.aim();
  }
  private aim(): void {
    const i = this.seg * 2, [nx, ny] = norm(this.pts[i + 2] - this.pts[i], this.pts[i + 3] - this.pts[i + 1]);
    this.vx = nx * this.sp; this.vy = ny * this.sp;
  }
  update(w: World, dt: number): void {
    if (this.team !== 'enemy') { super.update(w, dt); return; }
    this.age += dt;
    if (this.age >= this.life) { this.dead = true; return; }
    let remain = this.sp * dt;
    while (remain > 0 && !this.dead && this.team === 'enemy') {
      const i = this.seg * 2, x0 = this.pts[i], y0 = this.pts[i + 1], x1 = this.pts[i + 2], y1 = this.pts[i + 3];
      const len = Math.hypot(x1 - x0, y1 - y0) || 1e-6;
      const step = Math.min(4, remain, len - this.along);
      this.along += step; remain -= step;
      this.x = x0 + (x1 - x0) * this.along / len; this.y = y0 + (y1 - y0) * this.along / len;
      if (this.along >= len - 1e-6) {
        this.seg++; this.along = 0;
        if (this.seg * 2 + 3 >= this.pts.length) { this.onWall(w); return; }
        this.aim();
        w.fx.sparks(this.x, this.y, 3, P.amber, 60); w.sfx('armor', 0.35);
      } else if (w.pointBlocked(this.x, this.y)) { this.onWall(w); return; }
      this.collide(w);
    }
  }
}

interface Lob { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number }

export class Fold extends Boss {
  readonly id = 'fold' as const;
  readonly name = T.name;
  readonly body: BossPart;
  private moveX = 0;
  private moveY = 0;
  private face = Math.PI;
  private pose = 'idle1';
  private lastPick = '';
  private squeezeCd = 5;
  private hopCd = 0;
  private introZ = 0;
  private introSpread = 0;
  /** Height while hanging from the crane. */
  private z = 0;
  private cable: Cable | null = null;
  private hookAt: { x: number; y: number } | null = null;
  private bank: number[] | null = null;
  private lobs: Lob[] = [];
  /** Attack chained straight after the current one (no walk in between). */
  private followUp = '';

  constructor(w: World, tier: number) {
    super(w, tier, SPAWN.x, SPAWN.y, 4200);
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, this.x, this.y, 19, 27, 22));
    this.body.conductive = true;
  }

  think(w: World, dt: number): void {
    if (!this.staggered && !this.inTransition && (this.moveX || this.moveY)) {
      w.moveCircle(this.body, this.moveX * dt, this.moveY * dt, { ignore: this.body });
      // a prop can push him back into a beam after the wall pass: walls win
      unstick(w, this.body, this.body);
    }
    this.x = this.body.x; this.y = this.body.y;
    this.face = angleTo(this.x, this.y - 24, w.target().hx, w.target().hy);
    this.squeezeCd = Math.max(0, this.squeezeCd - dt);
    this.hopCd = Math.max(0, this.hopCd - dt);
    if (this.cable) { this.cable.x1 = this.x; this.cable.y1 = this.y - 44 - this.z; }
    const st = foundryOf(w);
    this.status = st?.brakeT ? T.stopped : st?.busy ? T.moving : this.cable ? T.hop : this.phase >= 2 ? T.phase3 : this.phase === 1 ? T.phase2 : '';
  }

  private stop(): void {
    this.moveX = this.moveY = 0; this.pose = 'idle1'; this.bank = null; this.lobs = [];
    this.dropCable();
    const st = foundryOf(this.w);
    if (st) st.exposed = false;
    if (this.z > 0 || st?.airborne || !this.body.solid) this.land();
  }
  /** Back on the ground after a hop or an interrupted hop (never inside a wall). */
  private land(): void {
    const st = foundryOf(this.w);
    this.z = 0; this.body.solid = true;
    if (st) st.airborne = false;
    unstick(this.w, this.body, this.body);
    this.x = this.body.x; this.y = this.body.y;
  }
  private dropCable(): void {
    if (this.cable) { this.cable.dead = true; this.cable = null; }
    this.hookAt = null;
  }
  onStagger(): void { this.stop(); }
  onDeath(): void { this.stop(); }
  modHit(w: World, _p: BossPart, h: Hit): { mul: number; tag: HitTag } {
    // a measuring bolt sent back hurts and rocks him: the blade's reward for reading the bank path
    if (h.src === 'deflect') { this.addPoise(w, 18); return { mul: 2, tag: 'normal' }; }
    return { mul: 1, tag: 'normal' };
  }

  /** Blade cut the crane cable: he drops wherever he is. */
  private cableCut(): void {
    const w = this.w;
    this.cable = null; this.hookAt = null;
    w.fx.label(this.x, this.y - 80, T.cut, P.white, 1);
    if (this.staggered || this.inTransition || this.dying) return;
    this.stagger(w, 2.6);
    w.damage(this.body, { dmg: 50, kind: 'impact', x: this.body.hx, y: this.body.hy, from: 'env', src: 'crane_cut' });
  }

  *entrance(w: World): Script {
    const start = this.clock;
    this.introZ = 70; this.introSpread = 1;
    try {
      w.sfx('siren', 0.6);
      while (this.clock - start < 1.4) {
        const t = (this.clock - start) / 1.4;
        this.introZ = 70 * (1 - t) ** 2; this.introSpread = 1 - t * 0.7;
        yield;
      }
      this.introZ = 0; w.fx.debris(this.x, this.y, 14, [P.steel, P.orange], 100);
      w.fx.ring(this.x, this.y, 5, 65, P.amber, 0.35, 2); w.fx.shake(4, 0.2); w.sfx('land');
      const hold = this.clock;
      while (this.clock - hold < 1) { this.introSpread = 0.3 * (1 - (this.clock - hold)); yield; }
    } finally {
      this.introZ = this.introSpread = 0; this.invuln = false; this.stop();
      this.x = this.body.x = SPAWN.x; this.y = this.body.y = SPAWN.y;
    }
  }

  *transition(w: World, phase: number): Script {
    this.stop(); this.invuln = true;
    try {
      w.fx.label(this.x, this.y - 80, phase === 1 ? T.phase2 : T.phase3, P.amber, 1.2);
      w.fx.ring(this.x, this.y - 24, 12, 84, P.orange, 0.5, 2);
      yield* this.wait(0.8);
    } finally { this.invuln = false; this.stop(); this.squeezeCd = 0; }
  }

  /** Clear line from his chest to the target (walls only). */
  private los(): boolean {
    const t = this.w.target(), d = dist(this.x, this.y - 20, t.x, t.y - 8);
    const [nx, ny] = norm(t.x - this.x, t.y - 8 - (this.y - 20));
    return this.w.rayWall(this.x, this.y - 20, nx, ny, d) >= d - 1;
  }

  *brain(w: World): Script {
    yield* this.wait(0.4);
    for (;;) {
      const st = foundryOf(w);
      if (!this.followUp) yield* this.approach(this.tele(this.phase >= 2 ? 0.3 : 0.4) + w.rng.range(0, 0.25));
      const d = this.distToTarget(), los = this.los(), t = w.target();
      const band = st && !st.busy && this.squeezeCd <= 0 ? st.bandOf(t.x, t.y) : -1;
      const myBand = st ? st.bandOf(this.x, this.y) : -1;
      const options: [string, number][] = [
        ['hop', this.hopCd <= 0 && (d > 250 || (!los && d > 110)) ? 6 : 0],
        ['measure', d > 80 ? 3 : 0.5],
        ['charge', los && d > 80 && d < 330 ? 3 : 0],
        ['beam', 2.2],
        ['hammer', d < 130 ? 4 : 0],
        ['sweep', d < 50 ? 3 : 0],
        ['squeeze', band >= 0 && band !== myBand ? 7 : 0],
        ['bundle', this.phase >= 1 ? 2.5 : 1.5],
        ['cross', this.phase >= 2 ? 2.2 : 0],
      ];
      for (const o of options) if (o[0] === this.lastPick) o[1] *= 0.25;
      const chained = this.followUp && (!this.followUp.endsWith('charge') || (los && d > 70)) ? this.followUp : '';
      const pick = chained || w.rng.weighted(options);
      this.followUp = '';
      this.lastPick = pick;
      switch (pick) {
        case 'hop': yield* this.hop(); break;
        case 'measure': yield* this.measure(); break;
        case 'charge': yield* this.charge(false); break;
        case 'recharge': yield* this.charge(true); break;
        case 'beam': yield* this.beamDrop(); break;
        case 'hammer': yield* this.hammer(); break;
        case 'sweep': yield* this.sweep(); break;
        case 'squeeze': yield* this.squeeze(band); break;
        case 'bundle': yield* this.bundle(); break;
        default: yield* this.crossCut();
      }
      if (!this.followUp) yield* this.wait(this.tele(this.phase >= 2 ? 0.3 : 0.4));
    }
  }

  private *approach(seconds: number): Script {
    const end = this.clock + seconds, speed = [70, 82, 94][this.phase] ?? 94;
    try {
      while (this.clock < end) {
        const t = this.w.target(), [nx, ny] = norm(t.x - this.x, t.y - this.y);
        const d = this.distToTarget();
        const k = d > 140 ? 1 : d < 60 ? -0.5 : 0;
        this.moveX = nx * speed * k - ny * 20; this.moveY = ny * speed * k + nx * 20;
        yield;
      }
    } finally { this.moveX = this.moveY = 0; }
  }

  // ------------------------------------------------------------------ crane hop
  /** Hook the overhead crane and drop onto the player's spot. The blade can cut the cable. */
  private *hop(): Script {
    const w = this.w, st = foundryOf(w), t = w.target();
    const [lx, ly] = freeSpot(w, t.x, t.y, this.body.r);
    const R = 46, WAVE = 112, warn = this.tele(1.05), flight = Math.min(0.5, warn * 0.5);
    this.pose = 'attack';
    this.hookAt = { x: lx, y: ly - 150 };
    const cable: Cable = { x1: this.x, y1: this.y - 44, x2: lx, y2: ly - 150, onCut: () => this.cableCut() };
    this.cable = cable; w.cables.push(cable);
    try {
      this.hazard({ k: 'circle', x: lx, y: ly, r: R }, warn, 0.12, h => { h.low = true; h.marker = true; });
      // outer ring: how far the landing shockwave will travel
      this.hazard({ k: 'ring', x: lx, y: ly, r: WAVE, w: 2 }, warn, 0.01, h => { h.hitsPlayer = false; });
      w.sfx('hook');
      yield* this.wait(warn - flight);
      if (st) { st.exposed = true; st.airborne = true; }
      this.body.solid = false;
      const sx = this.x, sy = this.y, t0 = this.clock;
      while (this.clock - t0 < flight) {
        const k = (this.clock - t0) / flight;
        this.body.x = sx + (lx - sx) * k; this.body.y = sy + (ly - sy) * k;
        this.x = this.body.x; this.y = this.body.y;
        this.z = Math.sin(k * Math.PI) * 54;
        yield;
      }
      this.body.x = lx; this.body.y = ly;
      this.dropCable(); this.land();
      if (st) st.exposed = false;
      w.fx.ring(lx, ly, 6, R + 4, P.orange, 0.25, 3); w.fx.debris(lx, ly - 6, 12, [P.steel, P.orange], 120);
      w.fx.shake(4, 0.2); w.sfx('stomp');
      // low shockwave rolling out to the outer ring: jump it or dash through it
      const wave = this.hazard({ k: 'ring', x: lx, y: ly, r: R, w: 12 }, 0, 0.36, h => {
        h.low = true;
        h.onTick = (_w, hz) => { if (hz.shape.k === 'ring') hz.shape.r = R + (WAVE - R) * Math.min(1, hz.t / 0.36); };
      });
      wave.cancelable = false;
      if (this.phase >= 1) this.ring(lx, ly - 8, this.phase >= 2 ? 10 : 8, 105, w.rng.next(), { frame: 'orb_o', life: 1.6 });
      if (this.phase >= 2 && this.los()) { yield* this.wait(this.tele(0.2)); yield* this.charge(true); }
      else yield* this.wait(this.tele(0.8));
    } finally {
      this.dropCable(); this.pose = 'idle1'; this.hopCd = 3;
      if (st) st.exposed = false;
      if (this.z > 0 || st?.airborne || !this.body.solid) this.land();
    }
  }

  // ------------------------------------------------------------------ measuring bolt
  /** Trace a bolt path with up to `maxB` bounces; returns points and the distance where it meets the target. */
  private trace(ox: number, oy: number, a: number, maxB: number, tx: number, ty: number): { pts: number[]; hit: number } {
    const w = this.w, pts = [ox, oy];
    let x = ox, y = oy, dx = Math.cos(a), dy = Math.sin(a), len = 0, hit = -1;
    for (let b = 0; b <= maxB && len < 900; b++) {
      let best = 900 - len, axis: 'x' | 'y' | null = null, blocked = false;
      for (const r of w.walls) { const h = rayRectN(x, y, dx, dy, r); if (h.t < best) { best = h.t; axis = h.axis; } }
      for (const o of w.bodies) {
        if (o.dead || o.team !== 'neutral' || !(o.blocksShots || o.flammable)) continue;
        const t = rayCircle(x, y, dx, dy, o.hx, o.hy, o.hr + 2.5);
        if (t < best) { best = t; axis = null; blocked = true; }
      }
      const ex = x + dx * best, ey = y + dy * best;
      if (hit < 0) {
        const c = closestOnSegment(tx, ty, x, y, ex, ey);
        if (Math.hypot(c.x - tx, c.y - ty) <= 7) hit = len + c.t * best;
      }
      pts.push(ex, ey); len += best;
      if (blocked || !axis || best < 1) break;
      if (b === maxB) break;
      // step back off the face and reflect
      x = ex - dx * 0.75; y = ey - dy * 0.75;
      pts[pts.length - 2] = x; pts[pts.length - 1] = y;
      if (axis === 'x') dx = -dx; else dy = -dy;
    }
    return { pts, hit };
  }

  /** Direct shot if possible, otherwise the shortest bank shot with the fewest bounces. */
  private bankPath(maxB: number): number[] {
    const w = this.w, t = w.target();
    let ox = this.x, oy = this.y - 24;
    if (w.pointInWall(ox, oy)) oy = this.y - 6;
    const direct = this.trace(ox, oy, angleTo(ox, oy, t.hx, t.hy), maxB, t.hx, t.hy);
    const firstLeg = this.trace(ox, oy, angleTo(ox, oy, t.hx, t.hy), 0, t.hx, t.hy);
    if (firstLeg.hit >= 0) return direct.pts;
    for (let b = 1; b <= maxB; b++) {
      let best: number[] | null = null, bestLen = Infinity;
      for (let i = 0; i < 180; i++) {
        const r = this.trace(ox, oy, (i / 180) * Math.PI * 2, b, t.hx, t.hy);
        if (r.hit >= 0 && r.hit < bestLen) { bestLen = r.hit; best = r.pts; }
      }
      if (best) return best;
    }
    return direct.pts;
  }

  private *measure(): Script {
    const w = this.w;
    const path = this.bankPath(this.phase >= 1 ? 2 : 1);
    const warn = this.tele(0.9);
    this.pose = 'attack'; this.bank = path;
    try {
      for (let i = 0; i + 3 < path.length; i += 2) {
        this.hazard({ k: 'line', x1: path[i], y1: path[i + 1], x2: path[i + 2], y2: path[i + 3], w: 10 }, warn, 0.02, h => { h.hitsPlayer = false; h.marker = true; });
      }
      w.sfx('telegraph'); yield* this.wait(warn);
      const shots = this.phase >= 2 ? 4 : this.phase === 1 ? 3 : 2;
      for (let i = 0; i < shots; i++) {
        w.addBullet(new RailBolt(path, 330 * this.bulletMul));
        w.sfx('shotgun', 0.5);
        if (i < shots - 1) yield* this.wait(0.22);
      }
      this.bank = null;
      yield* this.wait(this.tele(0.6));
    } finally { this.bank = null; this.pose = 'idle1'; }
  }

  // ------------------------------------------------------------------ charge
  private *charge(chain: boolean): Script {
    const w = this.w, st = foundryOf(w), t = w.target();
    const a = angleTo(this.x, this.y, t.x, t.y), nx = Math.cos(a), ny = Math.sin(a), r = this.body.r;
    // plan against structure only, from the centre and both shoulders, stopping short by the body radius
    let clear = 400;
    for (const s of [-1, 0, 1]) {
      const ox = this.x - ny * r * 0.9 * s, oy = this.y + nx * r * 0.9 * s;
      clear = Math.min(clear, st ? st.rayStructure(w, ox, oy, nx, ny, 400) : w.rayWall(ox, oy, nx, ny, 400));
    }
    const travel = Math.min(380, this.distToTarget() + 70, clear - r - 3);
    if (travel < 60) { yield* this.wait(0.2); return; }
    const lane: Shape = { k: 'line', x1: this.x, y1: this.y - 4, x2: this.x + nx * travel, y2: this.y - 4 + ny * travel, w: 64 };
    const warn = this.tele(chain ? 0.75 : 1.0);
    this.pose = 'attack';
    try {
      this.hazard(lane, warn, 0.02, h => { h.hitsPlayer = false; h.marker = true; });
      w.sfx('charge'); yield* this.wait(warn);
      if (st) st.exposed = true;
      const speed = this.phase >= 2 ? 340 : 300;
      let last = this.clock, walked = 0, hitPlayer = false;
      while (walked < travel) {
        const dt = this.clock - last; last = this.clock;
        const step = Math.min(speed * dt, travel - walked), ox = this.x, oy = this.y;
        const res = w.moveCircle(this.body, nx * step, ny * step, { ignore: this.body });
        this.x = this.body.x; this.y = this.body.y; walked += step;
        const swept: Shape = { k: 'line', x1: ox, y1: oy - 4, x2: this.x, y2: this.y - 4, w: 46 };
        if (!hitPlayer && shapeHits(swept, w.player.x, w.player.y - 4, 4)) {
          if (w.hitPlayer(1, { x: this.x, y: this.y, dx: nx, dy: ny, kind: 'impact', knock: 160 }) !== 'ignored') hitPlayer = true;
        }
        if (res.body || res.wall) {
          const beam = st?.beamAt(this.x, this.y, r);
          if (res.body instanceof Barrel) {
            this.stagger(w, 2.2); res.body.explode(w);
          } else if (res.body || beam) {
            beam?.shatter(w); res.body?.onRammed?.(w);
            w.fx.debris(this.x, this.y - 18, 14, [P.steel, P.amber], 110); w.sfx('crash');
            this.stagger(w, 2.4);
          } else w.sfx('crash', 0.5); // a wall moved into him: he just stops
          return;
        }
        yield;
      }
      if (st) st.exposed = false;
      // P2+: turn and run the line again (once)
      if (!chain && this.phase >= 1 && this.los() && this.distToTarget() > 70) { this.followUp = 'recharge'; yield* this.wait(this.tele(0.25)); return; }
      yield* this.wait(this.tele(0.8));
    } finally { this.pose = 'idle1'; if (st) st.exposed = false; }
  }

  // ------------------------------------------------------------------ steel beam
  private *beamDrop(): Script {
    const w = this.w, st = foundryOf(w);
    const n = this.phase >= 1 ? 2 : 1;
    this.pose = 'attack';
    try {
      let horizontal = false;
      for (let i = 0; i < n; i++) {
        const t = w.target();
        // the first beam lies across his line to the player; the second crosses it
        horizontal = i === 0 ? Math.abs(t.y - this.y) > Math.abs(t.x - this.x) : !horizontal;
        const cx = w.clampToBounds(t.x, t.y, horizontal ? 58 : 8)[0], cy = w.clampToBounds(t.x, t.y - 2, horizontal ? 8 : 58)[1];
        const shape: Shape = horizontal ? { k: 'rect', x: cx - 58, y: cy - 10, w: 116, h: 20 } : { k: 'rect', x: cx - 10, y: cy - 58, w: 20, h: 116 };
        const h = horizontal;
        this.hazard(shape, this.tele(i ? 0.8 : 1.0), 0.1, hz => {
          hz.marker = true;
          hz.onActivate = () => st?.dropBeam(w, cx, cy, h, this.phase >= 2 ? 7 : 9);
        });
        w.sfx('telegraph');
        yield* this.wait(this.tele(0.45));
      }
      yield* this.wait(this.tele(0.35));
      // the beam is cover: hide behind it and the follow-up charge slams into it
      this.followUp = w.rng.weighted([['charge', 2], ['measure', 2], ['', 1]]);
    } finally { this.pose = 'idle1'; }
  }

  // ------------------------------------------------------------------ hammer
  private *hammer(): Script {
    const w = this.w;
    this.pose = 'attack';
    try {
      const count = this.phase >= 1 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const t = w.target(), [x, y] = w.clampToBounds(t.x, t.y - 4, 4);
        const warn = this.tele(i ? 0.7 : 0.95);
        this.hazard({ k: 'circle', x, y, r: 44 }, warn, 0.15, h => { h.low = true; h.marker = true; });
        w.sfx('telegraph'); yield* this.wait(warn);
        w.fx.ring(x, y, 5, 48, P.orange, 0.2, 3); w.fx.shake(2, 0.12); w.sfx('stomp');
        yield* this.wait(0.2);
      }
      yield* this.wait(this.tele(0.6));
    } finally { this.pose = 'idle1'; }
  }

  // ------------------------------------------------------------------ ruler sweep
  /** Close range: the folding rule snaps open in a wide arc in front of him. */
  private *sweep(): Script {
    const w = this.w, a = this.aimFrom(this.x, this.y - 8);
    this.pose = 'attack';
    try {
      const shape: Shape = { k: 'sector', x: this.x, y: this.y - 8, r: 64, a, span: 2.4 };
      this.hazard(shape, this.tele(0.65), 0.12, h => { h.marker = true; });
      w.sfx('charge', 0.6); yield* this.wait(this.tele(0.65));
      w.fx.ring(this.x, this.y - 8, 20, 64, P.amber, 0.15, 2); w.sfx('laser', 0.6);
      yield* this.wait(this.tele(0.7));
    } finally { this.pose = 'idle1'; }
  }

  // ------------------------------------------------------------------ squeeze
  private *squeeze(band: number): Script {
    const w = this.w, st = foundryOf(w);
    if (!st || band < 0) return;
    const mine = st.bandOf(this.x, this.y);
    const bands = (this.phase >= 2 ? st.axisBands(band) : [band]).filter(b => b !== mine);
    if (!st.startSqueeze(w, bands, 'boss', this.tele(1.5))) { yield* this.wait(0.2); return; }
    this.squeezeCd = this.phase >= 2 ? 5.5 : 7;
    this.pose = 'attack';
    try {
      // pin: a hammer on the nearest way out of the band (the other exits stay open)
      yield* this.wait(this.tele(0.35));
      const t = w.target(), exit = st.nearestExit(band, t.x, t.y);
      if (exit && st.closing) {
        this.hazard({ k: 'circle', x: exit.x, y: exit.y, r: 34 }, this.tele(0.85), 0.15, h => { h.low = true; h.marker = true; });
        w.sfx('telegraph');
      }
      while (st.closing) yield;
      yield* this.wait(this.tele(0.4));
    } finally { this.pose = 'idle1'; }
  }

  // ------------------------------------------------------------------ rivet bundle
  /** Lobbed over the partitions: lands on the player's spot and bursts into a ring of soft rivets. */
  private *bundle(): Script {
    const w = this.w;
    this.pose = 'attack';
    try {
      const n = this.phase >= 2 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const t = w.target(), [x, y] = w.clampToBounds(t.x, t.y - 4, 6), warn = this.tele(1.1);
        const lob: Lob = { x0: this.x, y0: this.y - 44, x1: x, y1: y, t0: this.clock, dur: warn };
        this.lobs.push(lob);
        this.hazard({ k: 'circle', x, y, r: 30 }, warn, 0.1, h => {
          h.marker = true;
          h.onActivate = () => {
            this.lobs = this.lobs.filter(l => l !== lob);
            this.ring(x, y - 6, this.phase >= 1 ? 10 : 8, 115, w.rng.next(), { frame: 'orb_o', life: 1.6 });
            w.fx.debris(x, y - 4, 8, [P.steel, P.amber], 100); w.sfx('crash', 0.5);
          };
        });
        w.sfx('telegraph');
        yield* this.wait(this.tele(0.5));
      }
      yield* this.wait(this.tele(1.1));
    } finally { this.pose = 'idle1'; this.lobs = []; }
  }

  // ------------------------------------------------------------------ cross cut (P3)
  private *crossCut(): Script {
    const w = this.w;
    this.pose = 'attack';
    try {
      // each axis locks separately; the second warning starts after the first cut ends
      for (let i = 0; i < 2; i++) {
        const t = w.target(), x = t.x, y = t.y - 4;
        const dx = i ? 0 : 1, dy = i ? 1 : 0;
        const back = w.rayWall(x, y, -dx, -dy, 600), front = w.rayWall(x, y, dx, dy, 600);
        const s: Shape = { k: 'line', x1: x - dx * back, y1: y - dy * back, x2: x + dx * front, y2: y + dy * front, w: 24 };
        const warn = this.tele(0.9);
        this.hazard(s, warn, 0.16, h => { h.low = true; h.marker = true; });
        w.sfx('charge', 0.7); yield* this.wait(warn);
        w.sfx('laser'); w.fx.shake(2, 0.12); yield* this.wait(0.25);
      }
      yield* this.wait(this.tele(0.8));
    } finally { this.pose = 'idle1'; }
  }

  // ------------------------------------------------------------------ drawing
  draw(g: Gfx): void {
    const lift = this.introZ + this.z;
    g.ellipse(this.x, this.y + 1, 24 - lift * 0.08, 9, P.ink, 0.5);
    const y = this.y + 6 - lift;
    const frame = this.staggered || this.body.flash > 0 ? 'hurt' : this.pose === 'idle1' ? Math.floor(this.clock * 3) % 2 ? 'idle2' : 'idle1' : this.pose;
    g.img(this.phase >= 1 ? 'fold_broken' : 'fold', frame, this.x, y, { flipX: Math.cos(this.face) < 0, fill: this.body.flash > 0 ? P.pale : undefined });
    g.circle(this.x + 12, y - 40, 13, P.amber, 0.15, 'light');
    if (this.introSpread > 0) for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + this.clock * 0.5, r = 80 * this.introSpread;
      const x = this.x + Math.cos(a) * r, yy = this.y - 30 + Math.sin(a) * r * 0.5;
      g.line(this.x, this.y - 30, x, yy, 3, P.sodium, 0.7, 'top');
      g.ring(x, yy, 6, 1, P.ice, 0.8, 'top');
    }
    // crane hook above the landing spot
    if (this.hookAt) {
      const h = this.hookAt;
      g.rect(h.x - 9, h.y - 4, 18, 6, P.orange, 1, 'top'); g.strokeRect(h.x - 9, h.y - 4, 18, 6, 1, P.ink, 1, 'top');
      g.ring(h.x, h.y + 6, 4, 2, P.steel, 1, 'top');
    }
    // bank path: bounce points marked so the ricochet reads before it fires
    const b = this.bank;
    if (b) for (let i = 2; i + 3 < b.length; i += 2) {
      g.ring(b[i], b[i + 1], 5, 1, P.rose, 0.9, 'top');
      g.circle(b[i], b[i + 1], 2, P.white, 0.9, 'top');
    }
    for (const l of this.lobs) {
      const k = Math.min(1, (this.clock - l.t0) / l.dur);
      const x = l.x0 + (l.x1 - l.x0) * k, yy = l.y0 + (l.y1 - l.y0) * k - Math.sin(k * Math.PI) * 90;
      g.rect(x - 5, yy - 4, 10, 8, P.steel, 1, 'top'); g.strokeRect(x - 5, yy - 4, 10, 8, 1, P.ink, 1, 'top');
      g.line(x - 4, yy, x + 4, yy, 1, P.orange, 1, 'top');
    }
    if (this.staggered) g.ring(this.x, this.y - 78 - lift, 12, 2, P.amber, 0.9, 'top');
  }
}

export const foldDef: BossDef = {
  id: 'fold', arena: foundry, spawn: SPAWN, make: (w, tier) => new Fold(w, tier),
  drop: 'legs_slide', hint: T.hint, portrait: { key: 'standee', frame: 'fold' },
  music: { bpm: 132, kick: 'x..x....x..x....', snare: '....x.......x...', hat: 'x.x.xxx.x.x.xxx.',
    bass: [0, null, 0, 7, null, null, 3, null, 0, null, 10, null, 7, null, 3, null],
    lead: [12, null, 15, null, 19, null, null, null, 12, null, 10, null, 7, null, null, null],
    root: 34, chords: [0, 3, 0, -2], wave: 'sawtooth' },
};
