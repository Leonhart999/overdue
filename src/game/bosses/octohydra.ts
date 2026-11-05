/**
 * OCTOHYDRA — an eight-headed data serpent in a flooded server room.
 *
 * The core monolith sits shielded at the top of the arena; heads rise out of 8 water spots.
 * A severed head leaves a sparking stump that regrows after 7 s unless it is cauterised:
 * electrified water, explosions / fire, an arc overload, the arc beam held on it ~1 s, or one of
 * the hydra's own beams crossing it. A head that already regrew once withers for good when cut again.
 * Every retired stump burns back into the core (5.5% of its HP).
 *
 * P1 (0-3 burnt) : 3 heads — spitter (lobbed acid, puddles), beamer (1.2 s telegraph, hard beam,
 *                  blocked by racks), biter (telegraphed lunge, stuck 1 s afterwards).
 * P2 (4-7 burnt) : 4 heads, faster heads; the core electrifies the water itself (green
 *                  telegraph) and sweeps a slow low beam over the water.
 * P3 (8 burnt)   : the shield breaks, the core rises and roams: rings, a charge that wrecks
 *                  racks (and stuns the core), the sweep. Conduits deal big damage to it in water.
 *
 * HP bar = core HP. Heads have their own HP (160, tier scaled) and share the core's poise bar.
 */
import { P, type Gfx } from '../../engine/gfx';
import { angleTo, clamp, dist, lerp, norm, sign } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Body } from '../body';
import { Boss, BossPart } from '../boss';
import { Bullet } from '../bullet';
import { FirePatch, Zone, type Hazard } from '../hazard';
import { beamBlock, ConduitBox, FARM, farmOf, onSegment, ServerRack, serverfarm, type FarmGrid } from '../arenas/serverfarm';
import type { Hit, Shape } from '../types';
import type { World } from '../world';
import type { BossDef } from './registry';

type HeadType = 'spitter' | 'beamer' | 'biter';
type Anim = 'idle' | 'attack' | 'hurt';

const SPOT_TYPES: HeadType[] = ['spitter', 'beamer', 'biter', 'biter', 'spitter', 'beamer', 'biter', 'spitter'];
const CORE_HP = 2400;
const HEAD_HP = 160;
const REGROW = 7;
const MAX_REGROWS = 1;
/** Core HP lost per retired stump (fraction of max). */
const BURN = 0.055;
const LIFT = 36;
const BITE_REACH = 150;
/** Area attacks that may touch a head and its neck in the same step: count once per head. */
const AREA_SRC = new Set(['blade', 'iaido', 'overload', 'land', 'shove', 'fist', 'slide', 'grapple', 'conduit', 'fire', 'barrel']);

interface Spot {
  i: number;
  x: number;
  y: number;
  type: HeadType;
  state: 'dormant' | 'rising' | 'head' | 'stump' | 'burnt';
  t: number;
  head: Head | null;
  stump: Stump | null;
  regrows: number;
  /** Rising telegraph already placed. */
  marked: boolean;
}

// =====================================================================================
// parts
// =====================================================================================
class Head extends BossPart {
  hp: number;
  readonly maxHp: number;
  facing = 1;
  anim: Anim = 'idle';
  script: Script | null = null;
  cd: number;
  stunT = 0;
  stuck = false;
  lunging = false;
  rise = 0;
  lift = LIFT;
  ox = 0;
  oy = 0;
  hazards: Hazard[] = [];
  necks: NeckSeg[] = [];
  beam: Hazard | null = null;
  beamHitConduit = false;
  lastSrc = '';
  lastAt = -1;
  /** Piercing projectiles already counted on this head (neck + head share one hit). */
  readonly srcIds = new Set<number>();
  constructor(readonly o: Octohydra, readonly spot: Spot, hp: number) {
    super(o, spot.x, spot.y, 7, 0, 9);
    this.solid = false;
    this.type = spot.type;
    this.maxHp = this.hp = hp;
    this.cd = 1.2 + spot.i * 0.37 % 1.4;
  }
  readonly type: HeadType;
  get mouthX(): number { return this.x + this.facing * 9; }
  get mouthY(): number { return this.y - this.hz + 2; }
  hurt(w: World, h: Hit): number { return this.o.hitHead(w, this, h, false); }
  draw(g: Gfx, w: World): void { this.o.drawHead(g, w, this); }
}

/** Invisible hit bodies along a neck: forward damage to their head (iaido through necks x1.5). */
class NeckSeg extends BossPart {
  constructor(readonly o: Octohydra, readonly head: Head, readonly t: number) {
    super(o, head.x, head.y, 4, 10, 6);
    this.solid = false;
    this.targetable = false;
  }
  hurt(w: World, h: Hit): number { return this.head.dead ? 0 : this.o.hitHead(w, this.head, h, true); }
}

class CorePart extends BossPart {
  constructor(o: Octohydra, x: number, y: number) {
    super(o, x, y, 20, 30, 22);
    this.invulnerable = true;
    this.targetable = false;
  }
}

/** Severed neck. Neutral + conductive so the arc chains into it; never an auto-aim target. */
class Stump extends Body {
  burnt = false;
  withered = false;
  shockT = 0;
  private sparkT = 0;
  constructor(readonly o: Octohydra, readonly spot: Spot) {
    super();
    this.x = spot.x; this.y = spot.y;
    this.r = 8; this.hz = 7; this.hr = 8;
    this.mass = 0;
    this.conductive = true;
  }
  update(w: World, dt: number): void {
    if (this.burnt) {
      if (w.rng.chance(dt * 2)) w.fx.smoke(this.x, this.y - 8, 1, P.slate, 3, 14);
      return;
    }
    if (this.shockT > 0 && this.sparkT <= 0) this.shockT = Math.max(0, this.shockT - dt * 0.6);
    if (this.sparkT > 0) this.sparkT -= dt;
    if (w.rng.chance(dt * 9)) w.fx.sparks(this.x + w.rng.range(-3, 3), this.y - 9, 2, w.rng.pick([P.acid, P.ice, P.amber]), 70);
    const grid = farmOf(w);
    if (grid?.live) { this.cauterise(w, 'water'); return; }
    for (const o of w.objects) {
      if (o instanceof FirePatch && !o.dead && dist(o.x, o.y, this.x, this.y) < o.r + 8) { this.cauterise(w, 'fire'); return; }
    }
  }
  hurt(w: World, h: Hit): number {
    if (this.burnt) return 0;
    if (h.ignite || h.kind === 'fire' || h.kind === 'blast') this.cauterise(w, 'fire');
    else if (!h.quiet) w.fx.sparks(h.x, h.y, 2, P.fog, 40);
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    if (this.burnt) return;
    this.shockT += dt;
    this.sparkT = 0.15;
    if (this.shockT >= 1) this.cauterise(w, 'arc');
  }
  onEmp(w: World): void { this.cauterise(w, 'arc'); }
  cauterise(w: World, how: 'water' | 'fire' | 'arc' | 'beam' | 'wither'): void {
    if (this.burnt) return;
    this.burnt = true;
    this.conductive = false;
    this.withered = how === 'wither';
    w.fx.smoke(this.x, this.y - 6, 8, P.slate, 5, 22);
    w.fx.burst(this.x, this.y - 8, 10, how === 'wither' ? P.fog : P.orange, 70, 0.4, 1);
    w.sfx(how === 'wither' ? 'click' : 'fire', 0.9);
    this.o.onRetired(w, this.spot, how);
  }
  draw(g: Gfx, w: World): void {
    g.ellipse(this.x, this.y, 11, 4, P.abyss, 0.6, 'floor');
    g.img('octo_parts', this.burnt ? 'stump_burnt' : 'stump', this.x, this.y + 3, { depth: this.y });
    if (this.burnt) return;
    const sp = this.spot;
    const k = clamp(1 - sp.t / REGROW, 0, 1);
    // regrowth timer (rose arc) and arc-cauterise progress (ice)
    const a0 = -Math.PI / 2;
    g.sector(this.x, this.y - 8, 13, a0, a0 + Math.max(0.01, k * Math.PI * 2), P.rose, 0.35, 'top', 11);
    if (this.shockT > 0) g.sector(this.x, this.y - 8, 16, a0, a0 + Math.max(0.01, this.shockT * Math.PI * 2), P.ice, 0.6, 'top', 14);
    g.circle(this.x, this.y - 10, 9, P.acid, 0.18 + 0.1 * Math.sin(w.realTime * 20), 'light');
  }
}

/** Lobbed acid: arcs to a marked landing spot, splashes and leaves a puddle. Deflectable. */
class AcidGlob extends Bullet {
  private ft = 0;
  constructor(private gx0: number, private gy0: number, private z0: number, readonly tx: number, readonly ty: number, private T: number) {
    super(gx0, gy0 - z0, 0, 0, 'enemy');
    this.soft = true;
    this.frame = 'acid';
    this.r = 3.5;
    this.glow = 5;
    this.glowColor = P.acid;
    this.life = T + 1;
  }
  update(w: World, dt: number): void {
    if (this.team === 'player') { super.update(w, dt); return; }
    if (dt <= 0) return;
    this.ft += dt;
    const u = Math.min(1, this.ft / this.T);
    const gx = lerp(this.gx0, this.tx, u), gy = lerp(this.gy0, this.ty, u);
    const z = this.z0 * (1 - u) + 42 * 4 * u * (1 - u);
    const nx = gx, ny = gy - z;
    this.vx = (nx - this.x) / dt; this.vy = (ny - this.y) / dt;
    this.x = nx; this.y = ny;
    if (u >= 1) this.land(w);
  }
  private land(w: World): void {
    this.dead = true;
    const p = w.player;
    if (!p.airborne && dist(p.x, p.y, this.tx, this.ty) < 12) w.hitPlayer(1, { low: true, kind: 'acid', x: this.tx, y: this.ty });
    w.fx.burst(this.tx, this.ty - 2, 8, P.acid, 70, 0.35, 1, 0);
    const z = new Zone('acid', { k: 'circle', x: this.tx, y: this.ty, r: 11 });
    z.life = 5;
    w.addZone(z);
    w.sfx('pop', 0.6, 0.7);
  }
  draw(g: Gfx, w: World): void {
    if (this.team === 'enemy') {
      const u = Math.min(1, this.ft / this.T);
      g.ring(this.tx, this.ty, 12 + 8 * (1 - u), 1, P.red, 0.5 + 0.4 * u, 'floor');
      g.ellipse(lerp(this.gx0, this.tx, u), lerp(this.gy0, this.ty, u), 3, 1.5, P.ink, 0.4, 'floor');
    }
    super.draw(g, w);
  }
}

// =====================================================================================
// boss
// =====================================================================================
export class Octohydra extends Boss {
  readonly id = 'octohydra' as const;
  readonly name = '八头蛇';
  readonly core: CorePart;
  readonly spots: Spot[];
  readonly grid: FarmGrid | undefined;
  private readonly headHp: number;
  burnt = 0;
  private wakeT = 0;
  private transitioning = false;
  private animClock = 0;
  private coreAnim: 'shielded' | 'exposed' | 'risen' = 'shielded';
  private coreLift = 0;
  private charging = false;
  private chargeGlow = 0;
  private sweep: { x1: number; y1: number; x2: number; y2: number } | null = null;
  private lastZap = -6;
  private lastPick = '';
  private moveX = 0;
  private moveY = 0;

  constructor(w: World, tier: number, x: number, y: number) {
    super(w, tier, x, y, CORE_HP);
    this.thresholds = [1 - 4 * BURN, 1 - 8 * BURN];
    this.staggerDur = 2.6;
    this.headHp = Math.round(HEAD_HP * ([1, 1.35, 1.7][tier - 1] ?? 1.7) * w.hpMul);
    this.core = this.addPart(new CorePart(this, x, y)) as CorePart;
    this.spots = FARM.spots.map(([sx, sy], i) => ({ i, x: sx, y: sy, type: SPOT_TYPES[i], state: 'dormant', t: 0, head: null, stump: null, regrows: 0, marked: false }));
    for (let i = 0; i < 3; i++) this.wake(this.spots[i], 1.0 + i * 0.45);
    this.grid = farmOf(w);
    if (this.grid) {
      this.grid.onLive = (ww, conduit) => this.onWaterLive(ww, conduit);
      this.grid.onLiveTick = (ww, dt, conduit) => this.onWaterTick(ww, dt, conduit);
    }
    this.updateStatus();
  }

  get heads(): Head[] { return this.spots.flatMap((s) => (s.head && !s.head.dead ? [s.head] : [])); }
  get exposed(): boolean { return this.phase >= 2; }

  private updateStatus(): void {
    this.status = this.phase < 2 ? `已烧焦 ${this.burnt}/8` : '核心暴露';
  }

  // ------------------------------------------------------------------ spots
  private wake(s: Spot, t: number): void {
    s.state = 'rising';
    s.t = t;
    s.marked = false;
  }

  private emerge(w: World, s: Spot): void {
    const h = new Head(this, s, this.headHp);
    s.head = h;
    s.state = 'head';
    h.facing = sign(w.target().x - s.x);
    this.addPart(h);
    for (const t of [0.4, 0.72]) {
      const n = new NeckSeg(this, h, t);
      h.necks.push(n);
      this.addPart(n);
    }
    w.fx.burst(s.x, s.y - 4, 14, P.teal, 90, 0.5, 2, 0);
    w.fx.ring(s.x, s.y, 4, 24, P.ice, 0.3);
    w.sfx('stomp', 0.5, 1.3);
  }

  /** Stump retired (cauterised or withered): burns back into the core. */
  onRetired(w: World, s: Spot, how: string): void {
    if (s.state !== 'stump') return;
    s.state = 'burnt';
    this.burnt++;
    this.hp = Math.max(1, this.hp - this.maxHp * BURN);
    w.fx.label(s.x, s.y - 26, how === 'wither' ? '枯死' : '烧焦', how === 'wither' ? P.fog : P.orange, 1);
    w.fx.number(this.core.id * 10 + 1, this.core.hx, this.core.hy, this.maxHp * BURN, P.amber, true);
    this.core.flash = 0.08;
    w.sfx('bossHit', 1, 0.7);
    this.updateStatus();
    if (this.burnt >= 8 && this.phase < 2) this.goPhase(w, 2);
    else if (this.burnt >= 4 && this.phase < 1) this.goPhase(w, 1);
  }

  private goPhase(w: World, phase: number): void {
    this.phase = phase;
    this.cancelAttacks(w);
    for (const h of this.heads) this.interrupt(h);
    this.beginPhase(w, phase);
    this.updateStatus();
  }

  private sever(w: World, h: Head, burn: boolean): void {
    const s = h.spot;
    this.interrupt(h);
    h.dead = true;
    for (const n of h.necks) n.dead = true;
    this.parts = this.parts.filter((p) => p !== h && !h.necks.includes(p as NeckSeg));
    s.head = null;
    w.fx.ghost('octo_heads', `${h.type}_hurt`, h.x, h.y - h.hz + 8, { ox: 0.5, oy: 0.5, flipX: h.facing < 0, alpha: 0.8 }, 0.35);
    w.fx.debris(h.x, h.y - h.hz, 12, h.type === 'spitter' ? [P.lime, P.moss, P.acid] : h.type === 'beamer' ? [P.steel, P.fog, P.red] : [P.grape, P.orchid, P.pale], 160);
    w.fx.burst(s.x, s.y - 4, 16, P.teal, 110, 0.5, 2, 0);
    w.fx.label(s.x, s.y - 34, '断颈', P.white, 0.9);
    w.fx.shake(3, 0.15);
    w.hitstop = Math.max(w.hitstop, 0.05);
    w.sfx('cut');
    w.sfx('crash', 0.5, 1.4);
    s.state = 'stump';
    s.t = REGROW;
    const st = new Stump(this, s);
    s.stump = st;
    w.add(st);
    if (burn) st.cauterise(w, 'fire');
    else if (s.regrows >= MAX_REGROWS) st.cauterise(w, 'wither');
  }

  // ------------------------------------------------------------------ hits
  hitHead(w: World, h: Head, hit: Hit, viaNeck: boolean): number {
    if (this.dying || this.defeated || h.dead || h.rise < 1) return 0;
    const key = hit.src ?? hit.kind;
    if (AREA_SRC.has(key) && h.lastSrc === key && h.lastAt === w.time) return 0;
    h.lastSrc = key; h.lastAt = w.time;
    if (hit.srcId !== undefined) {
      if (h.srcIds.has(hit.srcId)) return 0;
      if (h.srcIds.size > 64) h.srcIds.clear();
      h.srcIds.add(hit.srcId);
    }
    this.noteHit();
    let mul = this.vulnMul * (this.staggerT > 0 ? 1.5 : 1) * (h.stuck ? 1.5 : 1);
    if (viaNeck && key === 'iaido') mul *= 1.5;
    const weak = !viaNeck && h.anim === 'attack' && hit.from === 'player';
    if (weak) mul *= w.player.weakMul;
    const dmg = hit.dmg * mul;
    if (dmg <= 0) return 0;
    h.hp -= dmg;
    if (!hit.quiet) {
      h.flash = 0.06;
      const c = hit.from === 'env' ? P.amber : weak ? P.orange : this.staggerT > 0 || h.stuck ? P.rose : P.white;
      w.fx.number(h.id * 10 + (hit.from === 'env' ? 1 : 0), hit.x, hit.y, dmg, c, dmg >= 60);
      w.sfx(weak ? 'weak' : 'bossHit');
    }
    if (hit.poise && this.staggerT <= 0) this.addPoise(w, hit.poise);
    if (key === 'slug' && h.hp > 0) {
      // the slug snaps the head back and cancels its attack
      this.interrupt(h);
      h.stunT = Math.max(h.stunT, 0.6);
      w.fx.label(h.x, h.y - h.hz - 14, '打断', P.amber, 0.7);
    }
    if (h.hp <= 0) {
      const burn = !!hit.ignite || hit.kind === 'fire' || hit.kind === 'blast' || !!this.grid?.live;
      this.sever(w, h, burn);
    }
    return dmg;
  }

  private onWaterLive(w: World, conduit: boolean): void {
    if (this.dying) return;
    if (conduit) {
      for (const h of this.heads) {
        if (h.rise < 1) continue;
        w.damage(h, { dmg: 60, kind: 'shock', x: h.hx, y: h.hy, from: 'env', src: 'conduit', poise: 18 });
        if (!h.dead) { this.interrupt(h); h.stunT = Math.max(h.stunT, 1.3); }
      }
      if (this.exposed && this.coreInWater(w)) {
        w.damage(this.core, { dmg: 200, kind: 'shock', x: this.core.hx, y: this.core.hy, from: 'env', src: 'conduit', poise: 70 });
        w.fx.label(this.x, this.y - 80, '核心触电', P.ice, 1.2);
      }
    }
    for (const s of this.spots) if (s.stump && !s.stump.burnt) s.stump.cauterise(w, 'water');
  }

  private onWaterTick(w: World, dt: number, conduit: boolean): void {
    if (!conduit || !this.exposed || this.dying || !this.coreInWater(w)) return;
    w.damage(this.core, { dmg: 70 * dt, kind: 'shock', x: this.core.hx, y: this.core.hy, from: 'env', src: 'conduit', poise: 20 * dt, quiet: true });
  }

  private coreInWater(w: World): boolean { return !!farmOf(w)?.inWater(this.x, this.y); }

  onStagger(w: World): void {
    for (const h of this.heads) { this.interrupt(h); h.stunT = Math.max(h.stunT, this.staggerDur); }
    this.charging = false;
    this.sweep = null;
    this.moveX = this.moveY = 0;
    w.fx.smoke(this.x, this.y - 50, 6, P.slate, 5, 24);
  }

  onDeath(w: World): void {
    for (const h of this.heads) { this.interrupt(h); h.stunT = 99; }
    this.sweep = null;
    w.fx.label(this.x, this.y - 80, '核心崩溃', P.white, 1.6);
  }

  // ------------------------------------------------------------------ per step
  think(w: World, dt: number): void {
    this.animClock += dt;
    if (this.chargeGlow > 0) this.chargeGlow = Math.max(0, this.chargeGlow - dt * 0.5);
    // spots: rising, regrowth, waking replacements
    const target = this.phase === 0 ? 3 : this.phase === 1 ? 4 : 0;
    let alive = 0;
    for (const s of this.spots) {
      if (s.state === 'rising') {
        if (!s.marked) {
          s.marked = true;
          this.hazard({ k: 'circle', x: s.x, y: s.y, r: 15 }, s.t, 0.15, (h) => { h.cancelable = false; });
          w.sfx('telegraph', 0.4, 0.6);
        }
        s.t -= dt;
        if (w.rng.chance(dt * 14)) w.fx.burst(s.x + w.rng.range(-8, 8), s.y, 1, P.ice, 30, 0.4, 1);
        if (s.t <= 0) this.emerge(w, s);
      } else if (s.state === 'stump' && s.stump && !s.stump.burnt) {
        s.t -= dt;
        if (s.t <= 0) {
          if (s.regrows >= MAX_REGROWS) s.stump.cauterise(w, 'wither');
          else {
            s.regrows++;
            s.stump.dead = true;
            s.stump = null;
            this.wake(s, this.tele(0.7));
          }
        }
      }
      if (s.state === 'rising' || s.state === 'head' || s.state === 'stump') alive++;
    }
    if (this.wakeT > 0) this.wakeT -= dt;
    if (alive < target && this.wakeT <= 0 && !this.transitioning) {
      const next = this.spots.find((s) => s.state === 'dormant');
      if (next) { this.wake(next, this.tele(1.1)); this.wakeT = 1.0; }
    }
    // heads
    const busy = this.heads.filter((h) => h.script).length;
    const maxBusy = this.phase === 0 ? 2 : 2;
    let started = 0;
    for (const h of this.heads) {
      this.updateHead(w, h, dt);
      if (h.script || h.stunT > 0 || h.rise < 1 || this.staggered || this.transitioning || this.dying) continue;
      h.cd -= dt;
      if (h.cd <= 0 && busy + started < maxBusy) {
        h.script = this.headAttack(w, h);
        started++;
      }
    }
    // the risen core roams
    if (this.exposed && !this.staggered && (this.moveX || this.moveY)) {
      w.moveCircle(this, this.moveX * dt, this.moveY * dt, { ignore: this.core });
      this.core.x = this.x; this.core.y = this.y;
    }
    const want = this.coreAnim === 'risen' ? 46 : 30;
    this.coreLift += (want - this.coreLift) * Math.min(1, dt * 3);
    this.core.hz = this.coreLift;
    // keep the player out of the core
    const p = w.player;
    const d = dist(p.x, p.y, this.x, this.y);
    if (d < this.core.r + p.r && !p.airborne) {
      const [nx, ny] = norm(p.x - this.x, p.y - this.y);
      p.x = this.x + nx * (this.core.r + p.r);
      p.y = this.y + ny * (this.core.r + p.r);
    }
    this.updateStatus();
  }

  get r(): number { return this.core.r; }

  private updateHead(w: World, h: Head, dt: number): void {
    if (h.rise < 1) h.rise = Math.min(1, h.rise + dt / 0.4);
    if (h.flash > 0) h.flash -= dt;
    if (h.stunT > 0) {
      h.stunT -= dt;
      h.anim = 'hurt';
      if (w.rng.chance(dt * 6)) w.fx.sparks(h.x, h.y - h.hz - 6, 2, P.ice, 50);
      if (h.stunT <= 0) { h.anim = 'idle'; h.cd = Math.max(h.cd, 0.6); }
    }
    if (h.script && h.script.next().done) h.script = null;
    if (!h.script) {
      // drift back to the spot
      const back = 220 * dt, l = Math.hypot(h.ox, h.oy);
      if (l > 0) { const k = Math.max(0, l - back) / l; h.ox *= k; h.oy *= k; }
      h.lunging = false;
      h.stuck = false;
      if (h.stunT <= 0) h.anim = 'idle';
      const t = w.target();
      if (Math.abs(t.x - h.x) > 4) h.facing = sign(t.x - h.x);
    }
    const lift = (h.stunT > 0 || this.dying ? 20 : h.lunging ? 13 : h.lift) * h.rise;
    const sway = h.script || h.stunT > 0 ? 0.3 : 1;
    h.x = h.spot.x + h.ox + Math.sin(this.animClock * 1.7 + h.spot.i * 1.3) * 3 * sway;
    h.y = h.spot.y + h.oy;
    h.hz += (lift + Math.sin(this.animClock * 2.3 + h.spot.i) * 1.5 * sway - h.hz) * Math.min(1, dt * 12);
    for (const n of h.necks) {
      const [nx, ny] = this.neckPoint(h, n.t);
      n.x = nx;
      n.y = lerp(h.spot.y, h.y, n.t);
      n.hz = n.y - ny;
    }
  }

  /** Screen-space point on a neck (quadratic curve from the water spot to the head). */
  neckPoint(h: Head, t: number): [number, number] {
    const bx = h.spot.x, by = h.spot.y - 2;
    const hx = h.x - h.facing * 5, hy = h.y - h.hz + 6;
    const span = dist(bx, h.spot.y, h.x, h.y);
    const cx = (bx + hx) / 2, cy = (by + hy) / 2 - 6 - span * 0.15;
    const u = 1 - t;
    return [u * u * bx + 2 * u * t * cx + t * t * hx, u * u * by + 2 * u * t * cy + t * t * hy];
  }

  private interrupt(h: Head): void {
    h.script = null;
    for (const z of h.hazards) z.dead = true;
    h.hazards = [];
    h.beam = null;
    h.stuck = false;
    h.lunging = false;
    h.anim = 'idle';
  }

  private headHazard(h: Head, shape: Shape, warn: number, active: number, setup?: (z: Hazard) => void): Hazard {
    const z = this.hazard(shape, warn, active, setup);
    h.hazards.push(z);
    return z;
  }

  private headCd(): number { return this.tele(this.phase === 0 ? 2.4 : 1.7) + this.w.rng.range(0, 1.1); }

  private *headAttack(w: World, h: Head): Script {
    if (h.type === 'spitter') yield* this.spit(w, h);
    else if (h.type === 'beamer') yield* this.beamShot(w, h, this.phase >= 1 ? 2 : 1);
    else yield* this.bite(w, h, this.phase >= 1 ? 2 : 1);
    h.hazards = h.hazards.filter((z) => !z.dead);
    h.cd = this.headCd();
  }

  private *spit(w: World, h: Head): Script {
    h.anim = 'attack';
    const wind = this.tele(0.6);
    w.sfx('telegraph', 0.5, 1.5);
    const end = this.clock + wind;
    while (this.clock < end) {
      if (w.rng.chance(0.3)) w.fx.burst(h.mouthX, h.mouthY, 1, P.acid, 30, 0.3, 1);
      yield;
    }
    const n = this.phase >= 1 ? 5 : 3;
    const t = w.target();
    for (let i = 0; i < n; i++) {
      let tx = t.x, ty = t.y;
      if (i > 0) { tx += w.rng.range(-40, 40); ty += w.rng.range(-28, 28); }
      [tx, ty] = w.clampToBounds(tx, ty, 10);
      const T = (0.7 + dist(h.x, h.y, tx, ty) / 420) / this.bulletMul;
      w.addBullet(new AcidGlob(h.mouthX, h.y, h.hz, tx, ty, T));
      w.sfx('spray', 0.7, 0.7);
      yield* this.wait(0.12);
    }
    h.anim = 'idle';
    yield* this.wait(this.tele(0.4));
  }

  /** Beam line on the ground from (x, y) at angle a, cut by racks and conduit boxes. */
  private beamLine(w: World, x: number, y: number, a: number, max: number): { x1: number; y1: number; x2: number; y2: number; body: Body | null } {
    const dx = Math.cos(a), dy = Math.sin(a);
    const res = beamBlock(w, x, y, dx, dy, max);
    return { x1: x, y1: y, x2: x + dx * res.t, y2: y + dy * res.t, body: res.body };
  }

  /** Effects of an active hydra beam: cauterise stumps it crosses, trip a conduit it hits. */
  private beamEffects(w: World, s: { x1: number; y1: number; x2: number; y2: number }, body: Body | null): void {
    for (const st of onSegment(w, s.x1, s.y1, s.x2, s.y2, 6, (b): b is Stump => b instanceof Stump)) st.cauterise(w, 'beam');
    if (body instanceof ConduitBox) body.beamHit(w);
    if (body instanceof ServerRack && w.rng.chance(0.4)) w.fx.sparks(s.x2, s.y2 - 10, 2, P.rose, 80);
  }

  private *beamShot(w: World, h: Head, shots: number): Script {
    for (let k = 0; k < shots; k++) {
      h.anim = 'attack';
      const warn = this.tele(k === 0 ? 1.2 : 0.75);
      let a = angleTo(h.x, h.y, w.target().x, w.target().y);
      let L = this.beamLine(w, h.x, h.y, a, 560);
      const z = this.headHazard(h, { k: 'line', x1: L.x1, y1: L.y1, x2: L.x2, y2: L.y2, w: 10 }, warn, 0.4, (hz) => {
        hz.activeFill = false;
        hz.onTick = (ww, hh) => {
          if (hh.t < warn * 0.55) {
            const t = ww.target();
            a = angleTo(h.x, h.y, t.x, t.y);
            h.facing = sign(Math.cos(a)) || h.facing;
          }
          L = this.beamLine(ww, h.x, h.y, a, 560);
          if (hh.shape.k === 'line') { hh.shape.x1 = L.x1; hh.shape.y1 = L.y1; hh.shape.x2 = L.x2; hh.shape.y2 = L.y2; }
          if (!hh.warning) {
            this.beamEffects(ww, L, L.body);
            if (ww.rng.chance(0.5)) ww.fx.sparks(L.x2, L.y2 - 4, 2, P.rose, 90);
          }
        };
        hz.onActivate = (ww) => { ww.sfx('laser'); ww.fx.shake(2, 0.15); };
      });
      w.sfx('charge', 0.6, 1.3);
      yield* this.wait(warn);
      if (z.dead) return;
      h.beam = z;
      yield* this.wait(0.4);
      h.beam = null;
      yield* this.wait(this.tele(0.25));
    }
    h.anim = 'idle';
    yield* this.wait(this.tele(0.5));
  }

  private *bite(w: World, h: Head, count: number): Script {
    for (let k = 0; k < count; k++) {
      // pull back to the spot first
      while (Math.hypot(h.ox, h.oy) > 4) {
        h.ox *= 0.8; h.oy *= 0.8;
        yield;
      }
      h.anim = 'attack';
      const warn = this.tele(k === 0 ? 0.75 : 0.5);
      const s = h.spot;
      let [dx, dy] = norm(w.target().x - s.x, w.target().y - s.y);
      let L = Math.min(BITE_REACH, dist(s.x, s.y, w.target().x, w.target().y) + 26);
      const z = this.headHazard(h, { k: 'line', x1: s.x, y1: s.y, x2: s.x + dx * L, y2: s.y + dy * L, w: 22 }, warn, 0, (hz) => {
        hz.hitsPlayer = false;
        hz.onTick = (ww, hh) => {
          if (hh.t < warn * 0.5) {
            const t = ww.target();
            [dx, dy] = norm(t.x - s.x, t.y - s.y);
            L = Math.min(BITE_REACH, dist(s.x, s.y, t.x, t.y) + 26);
            if (hh.shape.k === 'line') { hh.shape.x2 = s.x + dx * L; hh.shape.y2 = s.y + dy * L; }
          }
        };
      });
      w.sfx('telegraph', 0.6, 1.1);
      const end = this.clock + warn;
      while (this.clock < end) {
        h.ox = -dx * 8 * Math.min(1, (this.clock - end + warn) / warn);
        h.oy = -dy * 5 * Math.min(1, (this.clock - end + warn) / warn);
        h.facing = sign(dx) || h.facing;
        yield;
      }
      if (z.dead && z.t < warn) return;
      // lunge
      h.lunging = true;
      w.sfx('slash', 1, 0.6);
      let d = 0, last = this.clock, hitP = false;
      const speed = 480 * this.bulletMul;
      while (d < L) {
        d = Math.min(L, d + speed * (this.clock - last));
        last = this.clock;
        h.ox = dx * d; h.oy = dy * d;
        const gx = s.x + h.ox, gy = s.y + h.oy;
        const p = w.player;
        if (!hitP && dist(p.x, p.y, gx, gy) < 14) {
          if (w.hitPlayer(1, { x: gx, y: gy, dx, dy, knock: 200 }) === 'hit') hitP = true;
        }
        const rack = w.bodies.find((b): b is ServerRack => b instanceof ServerRack && !b.wrecked && dist(b.x, b.y, gx, gy) < b.r + 7);
        if (rack) { rack.bite(w); w.fx.shake(3, 0.15); break; }
        if (w.rng.chance(0.5)) w.fx.burst(gx, gy, 1, P.teal, 40, 0.3, 1);
        yield;
      }
      // stuck: the punish window
      h.stuck = true;
      h.anim = 'hurt';
      w.fx.label(h.x, h.y - 40, '卡住', P.amber, 0.8);
      w.sfx('crash', 0.5, 1.2);
      yield* this.wait(1.0);
      h.stuck = false;
      h.lunging = false;
    }
    h.anim = 'idle';
    yield* this.wait(this.tele(0.3));
  }

  // ------------------------------------------------------------------ core brain
  *brain(w: World): Script {
    yield* this.wait(0.5);
    for (;;) {
      if (this.phase === 0) { yield* this.wait(0.5); continue; }
      if (this.phase === 1) {
        yield* this.wait(this.tele(2.2) + w.rng.range(0, 1.5));
        if (this.clock - this.lastZap > this.tele(11)) yield* this.electrify(w);
        else yield* this.sweepBeam(w);
        continue;
      }
      // P3: roam, then attack
      yield* this.roam(w, this.tele(1.1) + w.rng.range(0, 0.6));
      const d = this.distToTarget();
      const options: [string, number][] = [
        ['ring', 3],
        ['charge', d > 70 ? 3 : 1],
        ['sweep', 2],
        ['zap', this.clock - this.lastZap > this.tele(14) ? 2 : 0],
      ];
      for (const o of options) if (o[0] === this.lastPick) o[1] *= 0.3;
      const pick = w.rng.weighted(options);
      this.lastPick = pick;
      if (pick === 'ring') yield* this.rings(w);
      else if (pick === 'charge') yield* this.charge(w);
      else if (pick === 'sweep') yield* this.sweepBeam(w);
      else yield* this.electrify(w);
    }
  }

  *transition(w: World, phase: number): Script {
    this.transitioning = true;
    this.moveX = this.moveY = 0;
    try {
    if (phase === 1) {
      w.fx.label(this.x, this.y - 74, '核心开始放电', P.acid, 1.4);
      for (let i = 0; i < 6; i++) { w.fx.sparks(this.x, this.y - 40, 6, P.acid, 120); w.sfx('zap', 0.6); yield* this.wait(0.15); }
    } else {
      this.invuln = true;
      this.coreAnim = 'exposed';
      w.fx.label(this.x, this.y - 80, '护盾破碎', P.ice, 1.4);
      for (let i = 0; i < 4; i++) { w.fx.debris(this.x, this.y - 40, 10, [P.acid, P.lime, P.ice], 180); w.sfx('crash', 0.7); yield* this.wait(0.25); }
      this.coreAnim = 'risen';
      this.core.invulnerable = false;
      this.core.targetable = true;
      this.core.r = 18;
      w.fx.label(this.x, this.y - 84, '核心升起', P.white, 1.4);
      w.sfx('rev');
      for (let i = 0; i < 8; i++) { w.fx.burst(this.x, this.y, 4, P.teal, 80, 0.4, 2, 0); yield* this.wait(0.1); }
    }
    } finally {
      // runs even if the transition is cut short, so the fight can never lock up
      if (phase >= 2) {
        this.coreAnim = 'risen';
        this.core.invulnerable = false;
        this.core.targetable = true;
        this.core.r = 18;
      }
      this.invuln = false;
      this.transitioning = false;
    }
    this.updateStatus();
    yield* this.wait(0.3);
  }

  private *electrify(w: World): Script {
    const g = this.grid;
    if (!g) return;
    const warn = this.tele(1.7);
    if (!g.trigger(w, 'boss', warn)) { yield* this.wait(0.4); return; }
    this.lastZap = this.clock;
    const end = this.clock + warn;
    while (this.clock < end) {
      this.chargeGlow = 1;
      if (w.rng.chance(0.3)) w.fx.sparks(this.x + w.rng.range(-16, 16), this.y - this.core.hz - 10, 2, P.acid, 90);
      yield;
    }
    yield* this.wait(g.liveDur + this.tele(0.4));
  }

  private *sweepBeam(w: World): Script {
    const ox = this.x, oy = this.y + 2;
    const t = w.target();
    const a = angleTo(ox, oy, t.x, t.y);
    const dir = w.rng.chance(0.5) ? 1 : -1;
    const span = 1.5, R = 420;
    const warn = this.tele(1.0), dur = 2.3;
    this.hazard({ k: 'sector', x: ox, y: oy, r: R, a, span, inner: 20 }, warn, 0, (h) => { h.hitsPlayer = false; });
    this.hazard({ k: 'line', x1: ox, y1: oy, x2: ox + Math.cos(a - dir * span / 2) * 160, y2: oy + Math.sin(a - dir * span / 2) * 160, w: 8 }, warn, 0, (h) => { h.hitsPlayer = false; });
    w.sfx('charge', 0.8, 0.8);
    const end = this.clock + warn;
    while (this.clock < end) { this.chargeGlow = 0.7; yield; }
    if (this.staggered) return;
    w.sfx('laser', 1, 0.7);
    this.hazard({ k: 'line', x1: ox, y1: oy, x2: ox, y2: oy, w: 8 }, 0, dur, (h) => {
      h.low = true;
      h.activeFill = false;
      h.cancelable = false;
      h.onTick = (ww, hh) => {
        if (this.staggered || this.dying) { hh.dead = true; this.sweep = null; return; }
        const ang = a - dir * span / 2 + dir * span * clamp(hh.t / dur, 0, 1);
        const L = this.beamLine(ww, this.x, this.y + 2, ang, R);
        if (hh.shape.k === 'line') { hh.shape.x1 = L.x1; hh.shape.y1 = L.y1; hh.shape.x2 = L.x2; hh.shape.y2 = L.y2; }
        this.sweep = L;
        this.beamEffects(ww, L, L.body);
        if (ww.rng.chance(0.6)) ww.fx.burst(L.x2, L.y2, 1, P.ice, 50, 0.3, 1, 0);
      };
      h.onEnd = () => { this.sweep = null; };
    });
    yield* this.wait(dur);
    this.sweep = null;
    yield* this.wait(this.tele(0.5));
  }

  private *roam(w: World, dur: number): Script {
    const b = w.bounds;
    const t = w.target();
    let tx = clamp(t.x + w.rng.range(-120, 120), b.x + 40, b.x + b.w - 40);
    let ty = clamp(t.y + w.rng.range(-90, 40), b.y + 80, b.y + b.h - 30);
    if (dist(tx, ty, t.x, t.y) < 70) { tx = clamp(320 + (320 - t.x) * 0.5, b.x + 40, b.x + b.w - 40); ty = clamp(170, b.y + 30, b.y + b.h - 30); }
    const end = this.clock + dur;
    while (this.clock < end) {
      const d = dist(this.x, this.y, tx, ty);
      const [nx, ny] = norm(tx - this.x, ty - this.y);
      const sp = d > 6 ? 62 : 0;
      this.moveX = nx * sp; this.moveY = ny * sp;
      yield;
    }
    this.moveX = this.moveY = 0;
  }

  private *rings(w: World): Script {
    w.sfx('telegraph', 0.8, 0.9);
    const wind = this.tele(0.6);
    const end = this.clock + wind;
    while (this.clock < end) { this.chargeGlow = 0.8; if (w.rng.chance(0.4)) w.fx.sparks(this.x, this.y - this.core.hz, 2, P.magenta, 70); yield; }
    const n = this.tier >= 3 ? 18 : 15;
    for (let k = 0; k < 3; k++) {
      this.ring(this.x, this.y - this.core.hz, n, 92 + k * 6, k * (Math.PI / n), { frame: 'orb_m', glowColor: P.magenta });
      w.sfx('spray', 0.9, 0.8);
      yield* this.wait(0.42);
    }
    yield* this.wait(this.tele(0.7));
  }

  private *charge(w: World): Script {
    const warn = this.tele(0.9);
    let [dx, dy] = this.dirToTarget();
    const lane = () => w.raycast(this.x, this.y, dx, dy, 640, (b) => b instanceof ServerRack && !b.wrecked, true).t;
    let L = lane();
    this.hazard({ k: 'line', x1: this.x, y1: this.y, x2: this.x + dx * L, y2: this.y + dy * L, w: 56 }, warn, 0, (h) => {
      h.hitsPlayer = false;
      h.onTick = (_ww, hh) => {
        if (hh.t < warn * 0.5) {
          [dx, dy] = this.dirToTarget();
          L = lane();
          if (hh.shape.k === 'line') { hh.shape.x2 = this.x + dx * L; hh.shape.y2 = this.y + dy * L; }
        }
      };
    });
    w.sfx('rev');
    const end = this.clock + warn;
    while (this.clock < end) { this.chargeGlow = 1; yield; }
    if (this.staggered) return;
    this.charging = true;
    const speed = 360 * this.bulletMul;
    let hitP = false, crashed: 'wall' | 'rack' | null = null, last = this.clock;
    for (let t = 0; t < 2.2 && !crashed; t += 1 / 60) {
      const step = speed * (this.clock - last);
      last = this.clock;
      const rack = w.bodies.find((b): b is ServerRack => b instanceof ServerRack && !b.wrecked && dist(this.x + dx * step, this.y + dy * step, b.x, b.y) < this.core.r + b.r);
      if (rack) { rack.wreck(w); crashed = 'rack'; break; }
      const res = w.moveCircle(this, dx * step, dy * step, { ignore: this.core, solids: false });
      this.core.x = this.x; this.core.y = this.y;
      if (res.wall) crashed = 'wall';
      const p = w.player;
      if (!hitP && dist(p.x, p.y, this.x, this.y) < this.core.r + p.r + 4) {
        const side = sign(-dy * (p.x - this.x) + dx * (p.y - this.y));
        if (w.hitPlayer(2, { x: p.x, y: p.y, knock: 220, dx: -dy * side + dx * 0.4, dy: dx * side + dy * 0.4 }) === 'hit') hitP = true;
      }
      if (w.rng.chance(0.7)) w.fx.burst(this.x - dx * 16, this.y, 1, P.teal, 50, 0.4, 2, 0);
      yield;
    }
    this.charging = false;
    if (crashed === 'rack') {
      w.fx.label(this.x, this.y - 80, '撞晕', P.amber);
      w.fx.shake(6, 0.3);
      this.stagger(w, 2.2);
      return;
    }
    if (crashed === 'wall') {
      w.fx.shake(5, 0.25);
      w.sfx('crash');
      yield* this.wait(this.tele(0.9));
    }
    yield* this.wait(this.tele(0.3));
  }

  // ------------------------------------------------------------------ draw
  drawHead(g: Gfx, w: World, h: Head): void {
    const s = h.spot;
    // water disturbance at the base
    g.ellipse(s.x, s.y, 11, 4, P.abyss, 0.7, 'floor');
    g.ring(s.x, s.y, 9 + Math.sin(this.animClock * 4 + s.i) * 1.5, 1, P.teal, 0.5, 'floor');
    g.ellipse(h.x, h.y, 8, 3, P.ink, 0.3, 'floor');
    // neck chain
    const len = dist(s.x, s.y, h.x, h.y - h.hz) + 6;
    const n = Math.max(5, Math.round(len / 4));
    const segTop = h.y; // depth: neck sits just behind its head
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (t * len < 2 && h.rise < 1) continue;
      const [x, y] = this.neckPoint(h, t * h.rise);
      const glow = i % 3 === 0;
      g.img('octo_parts', glow ? 'neck_glow' : 'neck', x, y + 5, { scale: 1.15 - 0.35 * t, depth: lerp(s.y, segTop, t) + 0.5 });
    }
    const frame = `${h.type}_${h.anim}`;
    const shake = h.stuck ? w.rng.range(-1, 1) : 0;
    g.img('octo_heads', frame, h.x + shake, h.y - h.hz + 8, { ox: 0.5, oy: 0.75, flipX: h.facing < 0, depth: h.y + 2, fill: h.flash > 0 ? P.white : undefined });
    const gc = h.type === 'spitter' ? P.acid : h.type === 'beamer' ? P.red : P.magenta;
    if (h.anim === 'attack') g.circle(h.mouthX, h.mouthY, 7 + Math.sin(this.animClock * 30), gc, 0.35, 'light');
    else g.circle(h.x, h.y - h.hz, 10, gc, 0.1, 'light');
    // beam
    const b = h.beam;
    if (b && !b.dead && b.shape.k === 'line') {
      const sh = b.shape;
      g.line(h.mouthX, h.mouthY, sh.x2, sh.y2, 7, P.red, 0.45, 'top');
      g.line(h.mouthX, h.mouthY, sh.x2, sh.y2, 3, P.rose, 0.9, 'top');
      g.line(h.mouthX, h.mouthY, sh.x2, sh.y2, 1, P.white, 1, 'top');
      g.line(sh.x1, sh.y1, sh.x2, sh.y2, 4, P.red, 0.35, 'floor');
      g.circle(sh.x2, sh.y2, 10, P.rose, 0.45, 'light');
    }
    // small HP bar once damaged (target priority)
    if (h.hp < h.maxHp && h.rise >= 1) {
      const bx = h.x - 9, by = h.y - h.hz - 19;
      g.rect(bx - 1, by - 1, 20, 4, P.ink, 0.8, 'top');
      g.rect(bx, by, 18 * clamp(h.hp / h.maxHp, 0, 1), 2, h.stuck || this.staggered ? P.rose : P.red, 1, 'top');
    }
    if (h.stunT > 0 && !this.dying) {
      for (let i = 0; i < 2; i++) {
        const a = this.animClock * 5 + i * Math.PI;
        g.img('proj', 'star', h.x + Math.cos(a) * 9, h.y - h.hz - 14 + Math.sin(a) * 3, { layer: 'top', ox: 0.5, oy: 0.5 });
      }
    }
  }

  draw(g: Gfx, w: World): void {
    const risen = this.coreAnim === 'risen';
    const bob = risen ? Math.sin(this.animClock * 2) * 2 : 0;
    g.ellipse(this.x, this.y + 2, 26, 9, P.ink, 0.5, 'floor');
    g.ring(this.x, this.y + 2, 24 + Math.sin(this.animClock * 3) * 2, 1, P.teal, 0.45, 'floor');
    const lift = risen ? this.coreLift - 30 : 0;
    const shake = this.charging || this.staggered ? w.rng.range(-1, 1) : 0;
    g.img('octo_core', this.coreAnim, this.x + shake, this.y + 6 - lift + bob, { depth: this.y, fill: this.core.flash > 0 ? P.white : undefined });
    const cy = this.y - 34 - lift + bob;
    g.circle(this.x, cy, 18, P.acid, 0.12 + 0.25 * this.chargeGlow + 0.04 * Math.sin(this.animClock * 4), 'light');
    if (!this.exposed) g.circle(this.x, cy, 30, P.acid, 0.06, 'light');
    if (this.sweep) {
      const s = this.sweep;
      g.line(this.x, cy, s.x2, s.y2, 6, P.red, 0.4, 'top');
      g.line(this.x, cy, s.x2, s.y2, 2, P.rose, 0.95, 'top');
      g.line(s.x1, s.y1, s.x2, s.y2, 5, P.red, 0.35, 'floor');
      g.circle(s.x2, s.y2, 9, P.rose, 0.4, 'light');
    }
    if (this.staggered) {
      for (let i = 0; i < 3; i++) {
        const a = this.animClock * 4 + (i * Math.PI * 2) / 3;
        g.img('proj', 'star', this.x + Math.cos(a) * 18, cy - 40 + Math.sin(a) * 5, { layer: 'top', ox: 0.5, oy: 0.5 });
      }
    }
  }
}

export const octohydraDef: BossDef = {
  id: 'octohydra',
  arena: serverfarm,
  spawn: { x: FARM.core.x, y: FARM.core.y },
  make: (w, tier) => new Octohydra(w, tier, FARM.core.x, FARM.core.y),
  drop: 'arm_jack',
  portrait: { key: 'octo_portrait', frame: 'portrait' },
  hint: '打断头后用接线盒电水或电弧烧焦断颈 · 机柜挡光束 · 站上格栅或跳起躲电',
  music: {
    bpm: 110,
    kick: 'x.....x...x.....',
    snare: '....x.......x..x',
    hat: '..x...x...x.x.x.',
    bass: [0, null, null, 0, null, null, 7, null, 0, null, 12, null, 10, null, 7, 5],
    lead: [null, null, 12, null, 15, null, null, null, 19, null, 17, null, 15, null, 12, null],
    root: 31,
    chords: [0, 0, 3, -2],
    wave: 'square',
  },
};
