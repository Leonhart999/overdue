/**
 * MADAME LUX — holo-idol loan shark in the Neon Bazaar club (a 1280 px scrolling map, see
 * arenas/club.ts). Floats, splits into clones.
 *
 * P1 (100-65%) : 2 clones (projectors west A + VIP A). Kiss (heart-shaped soft burst), fan
 *                (5 rotating streams), swap (she and a clone flash and trade places, across the
 *                map if the clone is in a side zone), spot flare (punishes standing in a spotlight).
 *                Turntable still.
 * P2 (65-30%)  : 3 clones (+ VIP B). Turntable turns 20 deg/s. Spotlight laser from a stage mark:
 *                the turntable locks on a 45-degree step first, then 8 directions, 1 s telegraph with
 *                the full path (mirrors and glass bounce it); a reflection that crosses her deals
 *                300 + 75 poise, any segment pops clones. Below 45% the last laser sweeps. Floor full on.
 * P3 (<=30%)   : all 4 projectors (3 clones, one spare). Turntable 40 deg/s. Encore at the turntable
 *                centre: heals 2%/s (never above 30%) while spiralling hearts. Poise gain x3 during
 *                the encore; a blackout or a full poise break interrupts it.
 *
 * Where she is: the real Lux floats over the stage / centre, within ~260 px of the player. After a
 * swap into a side zone she stays there, hopping, until she swaps again; if she has been off
 * screen for 4 s she swaps (or blinks) back next to the player. Clones float in their projector's
 * zone; clones more than 360 px from the player sit out the shared moves.
 *
 * Real vs clone: only the real Lux casts a shadow in a spotlight (clones turn see-through there),
 * clones flicker now and then, are tied to a projector by a faint beam, can be walked through and
 * glitch out in one hit without touching her HP. Their bullets are real.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleTo, clamp, dist, norm, segDist, type Rect } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Boss, BossPart, type HitTag } from '../boss';
import { club, ENCORE_POS, FLOAT, findStage, MARKS, traceBeam, zoneOf, type BeamPath, type ClubStage, type Hologram, type PopReason, type Projector, type StageListener, type ZoneId } from '../arenas/club';
import { shapeHits, type Hit } from '../types';
import type { World } from '../world';
import type { BossDef } from './registry';

type Anim = 'idle' | 'cast' | 'kiss' | 'hurt';

const BASE_HP = 3250;
const HEART = { frame: 'heart', glowColor: P.magenta, r: 3.5, life: 5 };
/** Chest height of the figure above its ground point. */
const CHEST = 30;
/** Projectors (stage order: west A, west B, VIP A, VIP B) switched on in each phase. */
const ACTIVE_PROJ = [[0, 2], [0, 2, 3], [0, 1, 2, 3]];
/** Turntable speed per phase (deg/s). */
const TABLE_DEG = [0, 20, 40];
/** Clones farther than this from the player (x) sit out the shared moves. */
const CAST_RANGE = 360;
/** Off screen this long -> she comes back to the player. */
const OFFSCREEN_MAX = 4;

interface LaserState {
  /** Sweep only: the bounced path at the end of the sweep, shown during the warning. */
  endPath?: BeamPath;
  path: BeamPath;
  warn: boolean;
  prog: number;
  /** First segment index that crosses Lux (-1 = none). */
  selfIdx: number;
  sweep: number;
  a0: number;
}

class LuxClone extends BossPart implements Hologram {
  state: 'in' | 'live' | 'glitch' = 'in';
  t = 0;
  tx: number;
  ty: number;
  shotT = 0;
  private glitchAt: number;
  constructor(public lux: Lux, public proj: Projector, x: number, y: number) {
    super(lux, x, y, 10, 28, 12);
    this.solid = false;
    this.tx = x; this.ty = y;
    this.glitchAt = 1 + (this.id % 7) * 0.3;
  }
  get live(): boolean { return !this.dead && this.state !== 'glitch'; }
  /** Clones float in their projector's zone. */
  get zone(): ZoneId { return this.proj.zone; }

  pop(w: World, why: PopReason): void {
    if (this.dead || this.state === 'glitch') return;
    this.state = 'glitch';
    this.t = 0;
    this.targetable = false;
    if (this.proj.link === this) this.proj.link = null;
    if (why === 'hit' || why === 'beam') this.proj.respawnT = Math.max(this.proj.respawnT, this.lux.phase === 0 ? 5 : 4);
    w.fx.burst(this.hx, this.hy, 12, P.cyan, 90, 0.35, 2);
    w.fx.burst(this.hx, this.hy, 8, P.magenta, 70, 0.3, 2);
    w.sfx('zap', 0.7, 1.3);
    w.sfx('pop');
  }

  hurt(w: World, h: Hit): number {
    if (h.from !== 'enemy') this.pop(w, 'hit');
    return 0;
  }

  update(w: World, dt: number): void {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.state === 'in' && this.t > 0.5) { this.state = 'live'; this.t = 0; }
    if (this.state === 'glitch') { if (this.t > 0.3) this.dead = true; return; }
    if (this.lux.dying) { this.pop(w, 'end'); return; }
    if (!this.lux.staggered) {
      const d = dist(this.x, this.y, this.tx, this.ty);
      if (d > 1) {
        const step = Math.min(d, this.lux.glideSpeed * 1.1 * dt);
        this.x += ((this.tx - this.x) / d) * step;
        this.y += ((this.ty - this.y) / d) * step;
      }
    }
    this.glitchAt -= dt;
    if (this.glitchAt < -0.09) this.glitchAt = 1.2 + w.rng.next() * 2.2;
  }

  /** Short flicker every couple of seconds (one of the clone tells). */
  get flickering(): boolean { return this.glitchAt < 0; }

  draw(g: Gfx, w: World): void { this.lux.drawFigure(g, w, this); }
}

export class Lux extends Boss implements StageListener {
  readonly id = 'lux' as const;
  readonly name = '卢克丝夫人';
  readonly body: BossPart;
  readonly stage: ClubStage | null;
  clones: LuxClone[] = [];
  anim: Anim = 'idle';
  animClock = 0;
  facing = 1;
  encore = false;
  private encoreCd = 0;
  private healShown = 0;
  private laser: LaserState | null = null;
  private lastPick = '';
  /** Seconds the real Lux has been off screen. */
  offT = 0;
  // ------------------------------------------------------------------ entrance state
  /** Entrance-only look, all at rest in the fight: hologram alpha, glitch offset, scanline (0..1, -1 = off), club darkness. */
  private introAlpha = 1;
  private introGlitch = 0;
  private introScan = -1;
  private introDark = 0;
  private introBeams: { rx: number; gx: number; gy: number; c: number; a: number }[] = [];
  private introHearts: { x: number; y: number; vx: number; age: number; life: number }[] = [];

  constructor(w: World, tier: number, x: number, y: number) {
    super(w, tier, x, y, BASE_HP);
    this.thresholds = [0.65, 0.3];
    this.body = this.addPart(new BossPart(this, x, y, 10, 28, 12));
    this.stage = findStage(w);
    if (this.stage) this.stage.listener = this;
  }

  get r(): number { return this.body.r; }
  get glideSpeed(): number { return [70, 85, 95][this.phase] ?? 95; }
  private liveClones(): LuxClone[] { return this.clones.filter((c) => c.live && c.state === 'live'); }

  // ------------------------------------------------------------------ hits
  modHit(w: World, _part: BossPart, h: Hit): { mul: number; tag: HitTag } {
    // spotlight bonus: player.dmgMul is recomputed inside Player.update, so it is applied here
    const lit = h.from === 'player' && !!this.stage?.inLight(w.player.x, w.player.y);
    return { mul: lit ? 1.25 : 1, tag: 'normal' };
  }

  addPoise(w: World, amount: number): void {
    super.addPoise(w, this.encore ? amount * 3 : amount);
  }

  onBlackout(w: World): void {
    if (this.dying) return;
    if (this.encore && !this.staggered) {
      this.encore = false;
      this.encoreCd = 14;
      w.fx.label(this.x, this.y - 66, '安可中断', P.amber, 1.2);
      this.stagger(w, 2.5);
    }
  }

  onStagger(): void {
    if (this.encore) this.encoreCd = 14;
    this.encore = false;
    this.laser = null;
    this.anim = 'hurt';
  }
  onStaggerEnd(): void { this.anim = 'idle'; }

  onDeath(w: World): void {
    this.laser = null;
    this.encore = false;
    for (const c of this.clones) c.pop(w, 'end');
    if (this.stage) { this.stage.floorMode = 'off'; this.stage.stopFloor(); }
  }

  // ------------------------------------------------------------------ per-step
  think(w: World, dt: number): void {
    this.animClock += dt;
    const st = this.stage;
    if (st) {
      st.floorMode = this.dying ? 'off' : this.encore ? 'encore' : this.phase === 0 ? 'light' : 'full';
      this.vulnMul = st.dark ? 1.5 : 1;
      const act = ACTIVE_PROJ[this.phase] ?? ACTIVE_PROJ[2];
      st.projectors.forEach((p, i) => { p.active = !this.dying && act.includes(i); });
      st.table.base = this.dying ? 0 : (TABLE_DEG[this.phase] ?? 40) * (Math.PI / 180);
    }
    if (w.scrolls && !this.dying && w.state === 'fight' && !w.onScreen(this.x, this.y - CHEST)) this.offT += dt;
    else this.offT = 0;
    if (this.staggered) this.laser = null;
    this.manageClones(w);
    if (this.encore && !this.staggered) {
      const cap = this.maxHp * this.thresholds[1];
      const before = this.hp;
      this.hp = Math.min(Math.max(this.hp, cap), this.hp + 0.02 * this.maxHp * dt);
      this.healShown += this.hp - before;
      if (this.healShown >= 15) { w.fx.number(9001, this.x, this.y - 50, this.healShown, P.acid); this.healShown = 0; }
    } else if (this.phase >= 2 && this.encoreCd > 0) this.encoreCd -= dt;
    // keep the player out of her ground circle
    const p = w.player;
    const d = dist(p.x, p.y, this.x, this.y);
    if (d < this.body.r + p.r && !p.airborne) {
      const [nx, ny] = norm(p.x - this.x, p.y - this.y);
      p.x = this.x + nx * (this.body.r + p.r);
      p.y = this.y + ny * (this.body.r + p.r);
    }
    const t = w.target();
    if (Math.abs(t.x - this.x) > 6) this.facing = t.x < this.x ? -1 : 1;
    this.updateStatus(w);
  }

  private updateStatus(w: World): void {
    const s: string[] = [`分身 ${this.clones.filter((c) => c.live).length}`];
    if (this.stage?.dark) s.push('断电 ×1.5');
    if (this.encore) s.push('安可 回复中');
    if (this.stage?.inLight(w.player.x, w.player.y)) s.push('追光 +25%');
    this.status = s.join(' · ');
  }

  private manageClones(w: World): void {
    const st = this.stage;
    this.clones = this.clones.filter((c) => !c.dead);
    if (!st || this.dying || st.dark || w.state !== 'fight') return;
    const want = [2, 3, 3][this.phase] ?? 3;
    const live = this.clones.filter((c) => c.live);
    if (live.length >= want) return;
    const free = st.projectors.filter((p) => p.ready);
    if (!free.length) return;
    // spread the clones: prefer a projector in the zone with the fewest clones
    const count = (z: ZoneId) => live.filter((c) => c.zone === z).length;
    const least = Math.min(...free.map((p) => count(p.zone)));
    const proj = w.rng.pick(free.filter((p) => count(p.zone) === least));
    const [x, y] = this.pickSpot(FLOAT[proj.zone]);
    const c = new LuxClone(this, proj, x, y);
    c.shotT = w.rng.range(0, 1);
    proj.link = c;
    w.add(c);
    this.clones.push(c);
    w.fx.burst(c.hx, c.hy, 10, P.cyan, 60, 0.35, 1);
    w.sfx('blink', 0.4, 1.3);
  }

  /** Where the real Lux floats: the part of the centre zone near the player, or her side zone after a swap. */
  private homeRegion(centre = false): Rect {
    const z = zoneOf(this.x);
    if (z !== 'centre' && !centre) return FLOAT[z];
    const c = FLOAT.centre, px = this.w.player.x;
    const lo = clamp(px - 260, c.x, c.x + c.w - 100), hi = Math.max(lo + 100, clamp(px + 260, c.x + 100, c.x + c.w));
    return { x: lo, y: c.y, w: hi - lo, h: c.h };
  }

  /**
   * A floating spot inside `region`, away from the player, mirrors and the other figures.
   * `from`: keep the new spot within ~150 px of it (Lux hops, she does not cross the room).
   */
  private pickSpot(region: Rect, from?: { x: number; y: number }): [number, number] {
    const w = this.w, p = w.player, rng = w.rng;
    let best: [number, number] = [this.x, this.y], bs = -Infinity;
    for (let i = 0; i < 14; i++) {
      const x = rng.range(region.x, region.x + region.w), y = rng.range(region.y, region.y + region.h);
      const d = dist(x, y, p.x, p.y);
      let s = -Math.abs(d - (from ? 95 : 130)) + (d < 70 ? -300 : 0);
      let near = 999;
      for (const c of this.clones) if (c.live) near = Math.min(near, dist(x, y, c.tx, c.ty));
      if (!from) near = Math.min(near, dist(x, y, this.x, this.y));
      s += Math.min(near, 120) * 0.6;
      for (const m of this.stage?.mirrors ?? []) if (dist(x, y, m.x, m.y) < 30) s -= 400;
      if (from) s -= Math.max(0, dist(x, y, from.x, from.y) - 150) * 1.5;
      if (s > bs) { bs = s; best = [x, y]; }
    }
    return best;
  }

  /** Float (she is a hologram: through glass and over the counter, never out of the club). */
  private moveTo(x: number, y: number): void {
    [this.x, this.y] = this.w.clampToBounds(x, y, 10);
    this.body.x = this.x; this.body.y = this.y;
  }

  private *glideTo(tx: number, ty: number, speed: number, maxT: number): Script {
    const end = this.clock + maxT;
    let last = this.clock;
    while (this.clock < end) {
      const dt = this.clock - last;
      last = this.clock;
      const d = dist(this.x, this.y, tx, ty);
      if (d < 2) break;
      const step = Math.min(d, speed * dt);
      this.moveTo(this.x + ((tx - this.x) / d) * step, this.y + ((ty - this.y) / d) * step);
      yield;
    }
  }

  private *reposition(dur: number): Script {
    for (const c of this.clones) if (c.live) [c.tx, c.ty] = this.pickSpot(FLOAT[c.zone]);
    const [x, y] = this.pickSpot(this.homeRegion(), this);
    yield* this.glideTo(x, y, this.glideSpeed, dur);
  }

  /** Clones close enough to the player to join a shared move. */
  private nearClones(): LuxClone[] {
    const px = this.w.player.x;
    return this.liveClones().filter((c) => Math.abs(c.x - px) < CAST_RANGE);
  }

  /** Lux plus every live clone near the player: everyone performs the same move. */
  private casters(): { x: number; y: number; clone: LuxClone | null }[] {
    return [{ x: this.x, y: this.y, clone: null }, ...this.nearClones().map((c) => ({ x: c.x, y: c.y, clone: c }))];
  }

  private cloneShots(dt: number, every: number): void {
    for (const c of this.nearClones()) {
      c.shotT -= dt;
      if (c.shotT > 0) continue;
      c.shotT = every;
      this.shoot(c.x, c.y - CHEST, this.aimFrom(c.x, c.y - CHEST), 105, HEART);
    }
  }

  // ------------------------------------------------------------------ entrance
  /** Run `fn(progress, dt)` every step for `dur` boss seconds (keeps the idle bob and the hearts moving). */
  private *cineRun(dur: number, fn: (k: number, dt: number) => void): Script {
    const t0 = this.clock;
    let last = t0;
    while (this.clock - t0 < dur) {
      const dt = this.clock - last;
      last = this.clock;
      this.animClock += dt;
      for (const h of this.introHearts) { h.age += dt; h.y -= 22 * dt; h.x += h.vx * dt; }
      this.introHearts = this.introHearts.filter((h) => h.age < h.life);
      fn(clamp((this.clock - t0) / dur, 0, 1), dt);
      yield;
    }
  }

  /**
   * Lights cut out, two spotlights sweep in and converge on the stage, she glitches in as a
   * hologram (ghost copies blink on and off around her), materialises with a magenta ring burst
   * and blows a kiss. Visual only: no clones, no hazards, the stage is not touched.
   */
  *entrance(w: World): Script {
    const sx = this.x, sy = this.y, face = this.facing, cy = sy - CHEST;
    const ease = (k: number) => 1 - (1 - k) * (1 - k);
    const rng = w.vrng;
    try {
      this.anim = 'idle';
      this.introAlpha = 0;
      // 1. the club lights cut out
      w.sfx('emp', 0.6, 0.6);
      yield* this.cineRun(0.45, (k) => { this.introDark = 0.82 * k; });
      w.sfx('click', 0.7, 0.7);
      // 2. two spotlights sweep in from opposite ends of the stage
      this.introBeams = [
        { rx: 300, gx: 180, gy: 300, c: P.cyan, a: 0.5 },
        { rx: 980, gx: 1100, gy: 300, c: P.magenta, a: 0.5 },
      ];
      w.sfx('beat', 0.7);
      let ticked = false;
      yield* this.cineRun(1.1, (k) => {
        const e = ease(k);
        const [a, b] = this.introBeams;
        a.gx = 180 + (sx - 40 - 180) * e;
        a.gy = 300 + (sy + 6 - 300) * e + Math.sin(k * 9) * 14 * (1 - k);
        b.gx = 1100 + (sx + 40 - 1100) * e;
        b.gy = 300 + (sy + 6 - 300) * e + Math.sin(k * 9 + 2) * 14 * (1 - k);
        if (!ticked && k > 0.5) { ticked = true; w.sfx('telegraph', 0.4, 1.8); }
      });
      // 3. they converge on her mark
      w.sfx('zap', 0.7, 0.8);
      w.fx.glow(sx, cy, 34, P.white, 0.3);
      yield* this.cineRun(0.25, (_k, dt) => {
        for (const bm of this.introBeams) {
          bm.gx += (sx - bm.gx) * Math.min(1, dt * 14);
          bm.gy += (sy + 4 - bm.gy) * Math.min(1, dt * 14);
        }
        if (rng.chance(0.4)) w.fx.sparks(sx, sy - 2, 2, P.white, 60);
      });
      // 4. the hologram glitches in: flicker, colour split, scanline, ghost copies
      this.anim = 'cast';
      const ghosts: [number, number][] = [[-52, -8], [48, 6], [-26, 22], [30, -18], [-64, 14], [60, -6]];
      let gi = 0, nextGhost = 0.05;
      yield* this.cineRun(0.9, (k) => {
        const flick = Math.floor(this.clock * 40) % 3 === 0;
        this.introAlpha = k < 0.1 ? 0 : flick ? 0.15 : Math.min(1, 0.35 + k);
        this.introGlitch = 5 * (1 - k);
        this.introScan = (k * 2.2) % 1;
        if (k >= nextGhost && gi < 8) {
          nextGhost += 0.11;
          const [ox, oy] = ghosts[gi % ghosts.length];
          const c = gi % 2 ? P.cyan : P.magenta;
          w.fx.ghost('lux', 'cast', sx + ox, sy - 4 + oy, { flipX: face < 0, fill: c, alpha: 0.55 }, 0.22);
          w.fx.burst(sx + ox, cy + oy, 5, c, 50, 0.25, 1);
          w.sfx('blink', 0.25, 1.3 + 0.1 * (gi % 3));
          gi++;
        }
      });
      // 5. she materialises: ring burst, bass hit, lights back on, a kiss with hearts
      this.introAlpha = 1;
      this.introGlitch = 0;
      this.introScan = -1;
      w.fx.ring(sx, cy, 6, 90, P.magenta, 0.5, 3);
      w.fx.ring(sx, sy, 4, 56, P.cyan, 0.4, 2);
      w.fx.burst(sx, cy, 14, P.magenta, 120, 0.4, 2);
      w.fx.flash(P.magenta, 0.25, 0.14);
      w.fx.shake(4, 0.3);
      w.sfx('blink', 0.9, 0.9);
      w.sfx('crush', 0.7, 0.5);
      let kissed = false;
      yield* this.cineRun(0.55, (k) => {
        this.introDark = 0.82 * (1 - ease(k));
        for (const bm of this.introBeams) bm.a = 0.5 * (1 - k);
        if (!kissed && k > 0.3) {
          kissed = true;
          this.anim = 'kiss';
          w.sfx('spray', 0.4, 1.6);
          for (let i = 0; i < 10; i++) {
            this.introHearts.push({ x: sx + rng.range(-26, 26), y: cy + rng.range(-14, 6), vx: rng.range(-10, 10), age: 0, life: rng.range(0.9, 1.4) });
          }
        }
      });
      this.introDark = 0;
      this.introBeams = [];
      yield* this.cineRun(0.7, () => {});
    } finally {
      this.introAlpha = 1;
      this.introGlitch = 0;
      this.introScan = -1;
      this.introDark = 0;
      this.introBeams = [];
      this.introHearts = [];
      this.anim = 'idle';
      this.facing = face;
      this.x = sx; this.y = sy;
      this.body.x = sx; this.body.y = sy;
    }
  }

  // ------------------------------------------------------------------ brain
  *brain(w: World): Script {
    yield* this.wait(0.7);
    for (;;) {
      if (this.offT > OFFSCREEN_MAX) { yield* this.comeBack(); continue; }
      if (this.phase >= 2 && this.encoreCd <= 0) { yield* this.encoreRoutine(); continue; }
      yield* this.reposition(this.tele(this.phase === 0 ? 1.0 : 0.8) + w.rng.range(0, 0.4));
      yield* this.wait(this.tele(0.2));
      const ph = this.phase;
      const lit = !!this.stage?.inLight(w.player.x, w.player.y);
      const options: [string, number][] = [
        ['kiss', 3],
        ['fan', 2.2],
        ['swap', this.liveClones().length ? (ph === 0 ? 2 : 1.2) : 0],
        ['flare', lit ? 3 : 0],
        ['laser', ph >= 1 ? 3.5 : 0],
      ];
      for (const o of options) if (o[0] === this.lastPick) o[1] *= 0.25;
      const pick = w.rng.weighted(options);
      this.lastPick = pick;
      switch (pick) {
        case 'kiss': yield* this.kiss(); break;
        case 'fan': yield* this.fanAttack(); break;
        case 'swap': yield* this.swap(); break;
        case 'flare': yield* this.flare(); break;
        case 'laser': yield* this.laserAttack(this.tier >= 3 ? 3 : 2); break;
      }
    }
  }

  *transition(w: World, phase: number): Script {
    this.laser = null;
    this.encore = false;
    this.invuln = true;
    this.anim = 'cast';
    w.fx.ring(this.x, this.y - CHEST, 6, 60, P.magenta, 0.5, 3);
    if (phase === 1) {
      w.fx.label(this.x, this.y - 66, '聚光激光 · 舞池全开', P.rose, 1.6);
      yield* this.wait(1.0);
    } else {
      w.fx.label(this.x, this.y - 66, '安可', P.rose, 1.6);
      this.encoreCd = 0;
      yield* this.wait(0.6);
    }
    this.invuln = false;
    this.anim = 'idle';
  }

  // ------------------------------------------------------------------ attacks
  private heartBurst(x: number, y: number, n: number, speed: number, aim: number): void {
    const rot = aim - Math.PI / 2, c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const hx = 16 * Math.sin(t) ** 3;
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      const vx = (hx * c - hy * s) / 17, vy = (hx * s + hy * c) / 17;
      const k = Math.max(0.3, Math.hypot(vx, vy));
      this.shoot(x, y, Math.atan2(vy, vx), speed * k, HEART);
    }
  }

  private *kiss(): Script {
    const w = this.w;
    this.anim = 'kiss';
    w.sfx('telegraph', 0.8, 1.3);
    const wind = this.tele(0.6);
    const end = this.clock + wind;
    while (this.clock < end) {
      for (const c of this.casters()) if (w.rng.chance(0.3)) w.fx.sparks(c.x + this.facing * 4, c.y - 36, 1, P.rose, 40);
      yield;
    }
    const bursts = this.phase === 0 ? 1 : 2;
    for (let b = 0; b < bursts; b++) {
      for (const c of this.casters()) {
        const ox = c.x, oy = c.y - CHEST;
        this.heartBurst(ox, oy, c.clone ? 12 : 22, 82, this.aimFrom(ox, oy) + (b ? 0.25 : 0));
      }
      w.sfx('spray', 0.8, 1.4);
      yield* this.wait(0.45);
    }
    this.anim = 'idle';
    yield* this.wait(this.tele(0.6));
  }

  private *fanAttack(): Script {
    const w = this.w;
    this.anim = 'cast';
    const arms = this.phase === 0 ? 5 : 6;
    const ox = this.x, oy = this.y - CHEST;
    let base = this.aimFrom(ox, oy) + Math.PI / arms;
    const dir = w.rng.chance(0.5) ? 1 : -1;
    const warn = this.tele(0.7);
    for (let k = 0; k < arms; k++) {
      const a = base + (k * Math.PI * 2) / arms;
      this.hazard({ k: 'line', x1: ox, y1: oy, x2: ox + Math.cos(a) * 70, y2: oy + Math.sin(a) * 70, w: 6 }, warn, 0, (h) => { h.hitsPlayer = false; });
    }
    w.sfx('telegraph');
    yield* this.wait(warn);
    const dur = 2.4, gap = 0.12, spin = 0.8 * dir;
    const end = this.clock + dur;
    let next = this.clock, last = this.clock;
    while (this.clock < end) {
      const dt = this.clock - last;
      last = this.clock;
      base += spin * dt;
      while (this.clock >= next) {
        for (let k = 0; k < arms; k++) this.shoot(this.x, this.y - CHEST, base + (k * Math.PI * 2) / arms, 105, { frame: 'orb_m', glowColor: P.magenta });
        next += gap;
        w.sfx('spray', 0.35, 1.6);
      }
      this.cloneShots(dt, 0.6);
      yield;
    }
    this.anim = 'idle';
    yield* this.wait(this.tele(0.7));
  }

  /** Trade places with a clone (default: the one nearest the player, anywhere on the map). */
  private *swap(target?: LuxClone): Script {
    const w = this.w;
    const cl = this.liveClones();
    if (!cl.length) return;
    let c = target ?? cl[0];
    if (!target) for (const o of cl) if (dist(o.x, o.y, w.player.x, w.player.y) < dist(c.x, c.y, w.player.x, w.player.y)) c = o;
    this.anim = 'cast';
    const warn = this.tele(0.55);
    this.swapRing(this.x, this.y, warn);
    this.swapRing(c.x, c.y, warn);
    w.sfx('telegraph', 0.6, 1.6);
    yield* this.wait(warn);
    if (!c.live) { this.anim = 'idle'; return; }
    w.fx.ghost('lux', 'cast', this.x, this.y - 4, { tint: P.rose, alpha: 0.5, flipX: this.facing < 0 }, 0.35);
    const [ax, ay] = [this.x, this.y];
    this.moveTo(c.x, c.y);
    c.x = ax; c.y = ay; c.tx = ax; c.ty = ay;
    this.offT = 0;
    w.fx.burst(this.x, this.y - CHEST, 10, P.rose, 80, 0.3, 1);
    w.fx.burst(c.x, c.y - CHEST, 10, P.rose, 80, 0.3, 1);
    w.sfx('blink');
    yield* this.wait(this.tele(0.25));
    for (const k of this.casters()) {
      const ox = k.x, oy = k.y - CHEST;
      this.fan(ox, oy, this.aimFrom(ox, oy), 3, 0.4, 125, HEART);
    }
    w.sfx('spray', 0.7, 1.5);
    this.anim = 'idle';
    yield* this.wait(this.tele(0.55));
  }

  private swapRing(x: number, y: number, warn: number): void {
    this.hazard({ k: 'circle', x, y: y - CHEST, r: 16 }, warn, 0, (h) => { h.hitsPlayer = false; h.color = P.magenta; });
  }

  /** Off screen too long: swap with a clone in view, or blink to the stage next to the player. */
  private *comeBack(): Script {
    const w = this.w, p = w.player;
    let best: LuxClone | null = null;
    for (const c of this.liveClones()) {
      if (!w.onScreen(c.x, c.y - CHEST, 24)) continue;
      if (!best || dist(c.x, c.y, p.x, p.y) < dist(best.x, best.y, p.x, p.y)) best = c;
    }
    if (best) { yield* this.swap(best); return; }
    const [x, y] = this.pickSpot(this.homeRegion(true));
    this.anim = 'cast';
    const warn = this.tele(0.55);
    this.swapRing(this.x, this.y, warn);
    this.swapRing(x, y, warn);
    w.sfx('telegraph', 0.6, 1.6);
    yield* this.wait(warn);
    this.moveTo(x, y);
    this.offT = 0;
    w.fx.burst(this.x, this.y - CHEST, 10, P.rose, 80, 0.3, 1);
    w.sfx('blink');
    this.anim = 'idle';
    yield* this.wait(this.tele(0.4));
  }

  private *flare(): Script {
    const w = this.w;
    const s = this.stage?.inLight(w.player.x, w.player.y);
    if (!s) return;
    this.anim = 'cast';
    const warn = this.tele(0.85);
    s.freeze = Math.max(s.freeze, warn + 0.5);
    s.flare = warn + 0.25;
    this.hazard({ k: 'circle', x: s.x, y: s.y, r: s.r }, warn, 0.2, (h) => {
      h.onActivate = (ww) => {
        ww.fx.glow(s.x, s.y - 6, s.r + 8, P.amber, 0.3);
        ww.fx.sparks(s.x, s.y - 4, 16, P.amber, 140);
        ww.sfx('zap');
      };
    });
    w.sfx('telegraph', 0.8, 0.9);
    yield* this.wait(warn + 0.2);
    this.anim = 'idle';
    yield* this.wait(this.tele(0.45));
  }

  // ---------------------------------------------------------------- laser
  private trace(a: number): BeamPath {
    return traceBeam(this.w, this.stage?.mirrors ?? [], this.x, this.y, a);
  }

  /** First segment (after a reflection) that crosses Lux, or -1. */
  private selfCross(path: BeamPath): number {
    const pts = path.pts;
    for (let i = 1; i < pts.length - 1; i++) {
      if (segDist(this.x, this.y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < 16) return i;
    }
    return -1;
  }

  private *laserAttack(count: number): Script {
    const w = this.w, st = this.stage;
    // go to a stage mark; meanwhile the turntable runs on to the next 45-degree step and locks
    const p = w.player;
    const marks = [...MARKS].sort((a, b) => dist(a[0], a[1], this.x, this.y) - dist(b[0], b[1], this.x, this.y));
    const mark = marks.find((m) => dist(m[0], m[1], p.x, p.y) > 80) ?? marks[0];
    for (const c of this.clones) if (c.live) [c.tx, c.ty] = this.pickSpot(FLOAT[c.zone]);
    this.anim = 'cast';
    if (st) st.table.holds++;
    try {
      yield* this.glideTo(mark[0], mark[1], 170, 2.4);
      const until = this.clock + 1.5;
      while (st && !st.table.locked && this.clock < until) yield;
      yield* this.laserShots(count);
    } finally {
      if (st) st.table.holds = Math.max(0, st.table.holds - 1);
      this.laser = null;
    }
  }

  /** The shots themselves, from where she stands (the turntable is locked). */
  private *laserShots(count: number): Script {
    const w = this.w;
    for (let i = 0; i < count; i++) {
      const sweep = i === count - 1 && (this.phase >= 2 || this.hp < this.maxHp * 0.45);
      const t = w.target();
      const a = Math.round(angleTo(this.x, this.y, t.x, t.y) / (Math.PI / 4)) * (Math.PI / 4);
      const span = sweep ? 0.55 * (w.rng.chance(0.5) ? 1 : -1) : 0;
      const warn = this.tele(1.0);
      w.sfx('telegraph', 1, 0.7);
      const wEnd = this.clock + warn;
      while (this.clock < wEnd) {
        const path = this.trace(a);
        const endPath = span ? this.trace(a + span) : undefined;
        this.laser = { path, warn: true, prog: 1 - (wEnd - this.clock) / warn, selfIdx: this.selfCross(path), sweep: span, a0: a, endPath };
        yield;
      }
      w.sfx('laser');
      const dur = sweep ? 1.6 : 0.4;
      const start = this.clock;
      let selfHit = false;
      while (this.clock < start + dur) {
        const f = (this.clock - start) / dur;
        const path = this.trace(a + span * f);
        const selfIdx = this.selfCross(path);
        this.laser = { path, warn: false, prog: f, selfIdx, sweep: span, a0: a };
        this.beamHits(path);
        if (selfIdx >= 0 && !selfHit) {
          selfHit = true;
          const q = path.pts[selfIdx];
          w.fx.label(this.x, this.y - 66, '反射命中', P.amber, 1.2);
          w.fx.sparks(this.body.hx, this.body.hy, 20, P.white, 200);
          w.fx.shake(6, 0.3);
          w.hitstop = Math.max(w.hitstop, 0.08);
          w.damage(this.body, { dmg: 300, kind: 'beam', x: this.body.hx, y: this.body.hy, dx: Math.sign(this.x - q[0]) || 1, dy: 0, poise: 75, from: 'env', src: 'mirror' });
          if (this.staggered || this.dying) return;
        }
        yield;
      }
      this.laser = null;
      yield* this.wait(this.tele(0.4));
    }
    this.anim = 'idle';
    yield* this.wait(this.tele(0.4));
  }

  private beamHits(path: BeamPath): void {
    const w = this.w, p = w.player, pts = path.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      if (shapeHits({ k: 'line', x1, y1, x2, y2, w: 8 }, p.x, p.y - 4, 4)) w.hitPlayer(1, { x: p.x, y: p.y, kind: 'beam' });
      for (const c of this.clones) if (c.live && segDist(c.x, c.y, x1, y1, x2, y2) < 12) c.pop(w, 'beam');
    }
  }

  // ---------------------------------------------------------------- encore
  private *encoreRoutine(): Script {
    const w = this.w;
    this.anim = 'cast';
    yield* this.glideTo(ENCORE_POS.x, ENCORE_POS.y, 150, 4);
    this.encore = true;
    this.poise = 0;
    w.fx.label(this.x, this.y - 66, '安可 · 每秒回复 2%', P.rose, 1.4);
    w.fx.ring(this.x, this.y - CHEST, 8, 80, P.rose, 0.5, 3);
    w.sfx('heal');
    const dir = w.rng.chance(0.5) ? 1 : -1;
    let a = w.rng.next() * Math.PI * 2;
    const end = this.clock + 5;
    let next = this.clock, nextRing = this.clock + 0.6, last = this.clock;
    while (this.clock < end && this.encore) {
      const dt = this.clock - last;
      last = this.clock;
      while (this.clock >= next) {
        for (let k = 0; k < 2; k++) this.shoot(this.x, this.y - CHEST, a + k * Math.PI, 92, HEART);
        a += 0.26 * dir;
        next += 0.12;
      }
      if (this.clock >= nextRing) {
        this.ring(this.x, this.y - CHEST, 16, 78, a * 0.5, { frame: 'orb_o' });
        nextRing += 1.3;
        w.sfx('spray', 0.6, 1.2);
      }
      this.cloneShots(dt, 1.3);
      yield;
    }
    if (!this.encore) return;
    this.encore = false;
    this.encoreCd = 14;
    this.anim = 'hurt';
    yield* this.wait(this.tele(1.4));
    this.anim = 'idle';
  }

  // ------------------------------------------------------------------ draw
  private frame(): string {
    if (this.staggered) return 'hurt';
    if (this.anim === 'idle') return Math.floor(this.animClock * 2.5) % 2 ? 'idle2' : 'idle1';
    return this.anim;
  }

  /** Draw Lux (clone = null) or one of her clones with the same pose. */
  drawFigure(g: Gfx, w: World, clone: LuxClone | null): void {
    const x = clone ? clone.x : this.x, y = clone ? clone.y : this.y;
    const bob = Math.sin(this.animClock * 3 + (clone ? clone.id : 0)) * 1.5;
    const lit = !!this.stage?.inLight(x, y);
    const fr = clone && clone.state === 'glitch' ? 'hurt' : this.frame();
    const flip = this.facing < 0;
    // hover base glow (everyone) and the shadow (only the real one, only in light)
    g.ellipse(x, y, 9, 3, P.magenta, 0.15, 'floor');
    if (!clone && lit) g.ellipse(x, y, 11, 4, P.ink, 0.7, 'floor');
    let alpha = 1;
    if (clone) {
      if (clone.state === 'in') alpha = clamp(clone.t / 0.5, 0, 1) * 0.9;
      else if (clone.state === 'glitch') alpha = 1 - clone.t / 0.3;
      if (lit) alpha *= 0.45;
    } else alpha *= this.introAlpha;
    const sy = y - 4 - bob;
    const glitch = clone ? (clone.state === 'glitch' ? 4 : clone.flickering ? 2 : 0) : this.introGlitch;
    if (glitch) {
      g.img('lux', fr, x - glitch, sy, { flipX: flip, alpha: alpha * 0.45, fill: P.cyan, depth: y - 0.1 });
      g.img('lux', fr, x + glitch, sy, { flipX: flip, alpha: alpha * 0.45, fill: P.magenta, depth: y - 0.1 });
    }
    const flash = !clone && this.body.flash > 0;
    g.img('lux', fr, x + (clone?.state === 'glitch' ? w.rng.range(-2, 2) : 0), sy, { flipX: flip, alpha, fill: flash ? P.white : undefined, depth: y });
    g.circle(x, y - CHEST, 16, P.magenta, 0.12 * alpha, 'light');
    if (!clone && this.stage?.dark) this.stage.holes.push({ x, y: y - CHEST, r: 40 });
  }

  draw(g: Gfx, w: World): void {
    if (this.defeated) return;
    this.drawFigure(g, w, null);
    this.drawIntro(g);
    if (this.encore) {
      const pulse = 0.5 + 0.5 * Math.sin(this.animClock * 8);
      g.ring(this.x, this.y, 18 + pulse * 4, 1, P.acid, 0.6, 'floor');
      g.circle(this.x, this.y - CHEST, 26, P.acid, 0.1 + 0.06 * pulse, 'light');
    }
    if (this.staggered) {
      for (let i = 0; i < 3; i++) {
        const a = this.animClock * 4 + (i * Math.PI * 2) / 3;
        g.img('proj', 'star', this.x + Math.cos(a) * 12, this.y - 54 + Math.sin(a) * 4, { layer: 'top', ox: 0.5, oy: 0.5 });
      }
    }
    this.drawLaser(g, w);
  }

  /** Entrance props: spotlight beams, scanline, hearts and the club darkness. Nothing here is drawn in the fight. */
  private drawIntro(g: Gfx): void {
    const holes: { x: number; y: number; r: number }[] = [];
    for (const b of this.introBeams) {
      const f = b.a / 0.5, r = 26;
      if (f <= 0.02) continue;
      g.poly([b.rx - 5, 26, b.rx + 5, 26, b.gx + r, b.gy, b.gx - r, b.gy], b.c, 0.2 * f, 'light');
      g.circle(b.gx, b.gy - 4, r, b.c, 0.28 * f, 'light');
      g.ellipse(b.gx, b.gy, r, r * 0.5, b.c, 0.2 * f, 'floor');
      g.ring(b.gx, b.gy, r, 1, b.c, 0.7 * f, 'floor');
      // the cone shows through the darkness as a chain of holes
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        holes.push({ x: b.rx + (b.gx - b.rx) * t, y: 26 + (b.gy - 6 - 26) * t, r: 10 + t * (r + 10) });
      }
    }
    if (this.introAlpha > 0.1) holes.push({ x: this.x, y: this.y - CHEST, r: 34 });
    if (this.introDark > 0.01) g.darkness(this.introDark, holes);
    if (this.introScan >= 0) {
      const sy = Math.round(this.y - 4 - this.introScan * 44);
      g.rect(this.x - 14, sy, 28, 1, P.cyan, 0.9, 'top');
      g.rect(this.x - 14, sy + 1, 28, 1, P.white, 0.4, 'top');
    }
    for (const h of this.introHearts) {
      const a = Math.min(1, (h.life - h.age) * 2.5);
      g.img('proj', 'heart', h.x, h.y, { layer: 'top', ox: 0.5, oy: 0.5, alpha: a });
      g.circle(h.x, h.y, 6, P.magenta, 0.25 * a, 'light');
    }
  }

  private drawLaser(g: Gfx, w: World): void {
    const L = this.laser;
    if (!L) return;
    // the beam hits along the ground: show that line on the floor so the hit area is honest
    const gp = L.path.pts;
    for (let i = 0; i < gp.length - 1; i++) g.line(gp[i][0], gp[i][1], gp[i + 1][0], gp[i + 1][1], L.warn ? 8 : 8, P.red, L.warn ? 0.1 + 0.12 * L.prog : 0.3, 'floor');
    if (L.warn && L.endPath) {
      const ep = L.endPath.pts;
      for (let i = 0; i < ep.length - 1; i++) {
        g.line(ep[i][0], ep[i][1], ep[i + 1][0], ep[i + 1][1], 1, P.red, 0.5, 'floor');
        g.line(ep[i][0], ep[i][1] - 8, ep[i + 1][0], ep[i + 1][1] - 8, 1, P.red, 0.35 + 0.3 * L.prog, 'top');
      }
    }
    const pts = L.path.pts;
    const H = 8;
    const pulse = 0.5 + 0.5 * Math.sin(w.realTime * 30);
    for (let i = 0; i < pts.length - 1; i++) {
      const x1 = pts[i][0], y1 = i === 0 ? this.y - CHEST : pts[i][1] - H, x2 = pts[i + 1][0], y2 = pts[i + 1][1] - H;
      const self = L.selfIdx >= 0 && i >= L.selfIdx;
      if (L.warn) {
        g.line(x1, y1, x2, y2, Math.max(1, 6 * L.prog), P.red, 0.18, 'top');
        g.line(x1, y1, x2, y2, 1, self ? P.rose : P.red, 0.5 + 0.4 * pulse, 'top');
      } else {
        g.line(x1, y1, x2, y2, 7, P.rose, 0.5, 'top');
        g.line(x1, y1, x2, y2, 2, P.white, 1, 'top');
        g.line(x1, y1, x2, y2, 10, P.magenta, 0.12, 'light');
      }
      if (i > 0) g.ring(x1, y1, 4, 1, P.white, 0.8, 'top');
      if (this.stage?.dark) {
        const n = Math.max(1, Math.ceil(dist(x1, y1, x2, y2) / 18));
        for (let k = 0; k <= n; k++) this.stage.holes.push({ x: x1 + ((x2 - x1) * k) / n, y: y1 + ((y2 - y1) * k) / n, r: 20 });
      }
    }
    if (L.selfIdx >= 0) {
      // the reflection will come back into her: amber target ring on Lux
      g.ring(this.body.hx, this.body.hy, 12 + 2 * pulse, 2, COL.interact, 0.9, 'top');
      g.text('反射', this.body.hx, this.body.hy - 30, { color: COL.interact, align: 'center' });
    }
    if (L.warn && L.sweep) {
      const a0 = Math.min(L.a0, L.a0 + L.sweep), a1 = Math.max(L.a0, L.a0 + L.sweep);
      g.sector(this.x, this.y - CHEST, 70, a0, a1, P.red, 0.12 + 0.1 * L.prog, 'top', 20);
    }
  }
}

export const luxDef: BossDef = {
  id: 'lux',
  arena: club,
  spawn: { x: MARKS[2][0], y: MARKS[2][1] },
  make: (w, tier) => new Lux(w, tier, MARKS[2][0], MARKS[2][1]),
  drop: 'legs_blink',
  portrait: { key: 'lux_portrait', frame: 'lux' },
  hint: '两头配电箱都能全场断电 · 打坏投影仪 · E 转镜子反射激光 · E 打碟台反转转盘 · 追光 +25%',
  music: {
    bpm: 120,
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...xx',
    bass: [0, null, 12, null, 0, null, 12, 0, 0, null, 12, null, 0, 12, 10, 12],
    lead: [12, null, 15, null, 19, null, 15, null, 22, null, 19, null, 15, null, 14, null],
    root: 45,
    chords: [0, -4, 3, -2],
    wave: 'square',
  },
};


