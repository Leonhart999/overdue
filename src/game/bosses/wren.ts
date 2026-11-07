/**
 * Wren (潜网客·芮恩), boss 8. Two-layer fight in the dive cafe (see arenas/divecafe.ts).
 *
 * Phase 1  real body. Shield (x0.2, no poise) powered by 3 firewall ports in the net.
 *          Stylus volley (3 hard needles), holo pop-ups (3-5 rect slams, jumpable).
 *          While the player dives she walks to their pod and pulls the plug (1.4 s warning),
 *          and reroutes the data streams (1 s red warning, then they reverse).
 *          All ports down: shield breaks, 2 s stagger, 10 s without shield, then ports respawn.
 * Phase 2  (60 %) 4 ports. When the player dives she lies in her own pod and chases them with a
 *          code avatar (whip sector, data needles). Her slumped body takes x1.5. Once she notices
 *          the player back in reality near her or hitting her body, she returns 1.5 s later.
 * Phase 3  (25 %) ports gone, shield off for good, pods closed. Everybody changes layer every
 *          8 s; she casts pop-ups into the next layer just before the swap.
 */
import { COL, P, type Gfx } from '../../engine/gfx';
import { angleTo, clamp, dist, norm } from '../../engine/math';
import type { Script } from '../../engine/script';
import { Boss, BossPart, type HitTag, type ShotOpts } from '../boss';
import type { Hazard } from '../hazard';
import type { Hit, Shape } from '../types';
import type { World } from '../world';
import {
  divecafe, diveOf, PODS, podFront, WREN_POD, WREN_SPAWN, WREN_TEXT as T, WrenBullet,
  type DiveBossHints, type DiveState, type Layer,
} from '../arenas/divecafe';
import type { BossDef } from './registry';

const BASE_HP = 1300;

type Pose = 'idle' | 'walk' | 'cast' | 'shoot' | 'hurt' | 'whip';

/** Cached path waypoint for one mover. */
interface Nav { x: number; y: number; t: number }

export class Wren extends Boss implements DiveBossHints {
  readonly id = 'wren' as const;
  readonly name = T.name;
  /** Real body. */
  readonly body: BossPart;
  /** Code avatar in the net (phase 2 dives). */
  readonly avatar: BossPart;
  /** Her body lies in her pod while the avatar is in the net. */
  diving = false;
  /** Seconds left without shield (includes the 2 s stagger). */
  shieldDownT = 0;
  private wakeAt: number | null = null;
  private diveCd = 0;
  private slumpHit = false;
  private exitedAt = -99;
  private lastLayer: Layer = 'real';
  private shieldedHit = false;
  private ambushed = false;
  /** Dive (switch time) the current plug hunt belongs to. */
  private huntFor = -1;
  private pick = 0;
  private apick = 0;
  private pose: Pose = 'idle';
  private apose: Pose = 'idle';
  private flip = false;
  private aflip = false;
  private walkT = 0;
  private nav: Nav = { x: 0, y: 0, t: -1 };
  private anav: Nav = { x: 0, y: 0, t: -1 };
  /** Pop-up window telegraphs (drawn as AR windows). */
  private popups: Hazard[] = [];
  /** Monocle flare (seconds). */
  private flare = 0;
  // entrance-only state
  private introPod = false;
  private introDark = 0;
  private introWins: { x: number; y: number; t: number }[] = [];

  constructor(w: World, tier: number) {
    super(w, tier, WREN_SPAWN.x, WREN_SPAWN.y, BASE_HP);
    this.thresholds = [0.62, 0.25];
    this.body = this.addPart(new BossPart(this, WREN_SPAWN.x, WREN_SPAWN.y, 8, 20, 11));
    this.avatar = this.addPart(new BossPart(this, WREN_POD.x, WREN_POD.y + 30, 8, 20, 11));
    this.avatar.targetable = false;
    const st = diveOf(w);
    if (st) {
      st.setLayer(w, this.body, 'real');
      st.setLayer(w, this.avatar, 'off');
      st.spawnPorts(w, 3, false);
    }
    this.updateStatus();
  }

  private get st(): DiveState { return diveOf(this.w)!; }
  get shieldUp(): boolean { return this.phase < 2 && this.shieldDownT <= 0; }
  get slumped(): boolean { return this.diving; }
  get realX(): number { return this.body.x; }
  get realY(): number { return this.body.y; }
  /** Layer the body is in (phase 3: it follows the player). */
  private bodyLayer(): Layer { return this.phase >= 2 ? this.st.layer : 'real'; }
  private partLayer(p: BossPart): Layer | 'off' { return p === this.avatar ? (this.diving ? 'net' : 'off') : this.bodyLayer(); }

  // ------------------------------------------------------------------ per step
  think(w: World, dt: number): void {
    const st = diveOf(w);
    if (!st) return;
    if (this.flare > 0) this.flare -= dt;
    if (this.diveCd > 0) this.diveCd -= dt;
    // shield
    if (this.phase < 2 && this.shieldDownT > 0) {
      this.shieldDownT -= dt;
      if (this.shieldDownT <= 0 && !this.dying) {
        st.spawnPorts(w, this.phase >= 1 ? 4 : 3, this.phase >= 1);
        w.fx.label(this.body.x, this.body.y - 62, T.shieldBack, P.cyan, 1);
        w.sfx('shield');
      }
    }
    if (st.portsChanged) {
      st.portsChanged = false;
      if (this.shieldUp && st.portsAlive === 0 && w.state === 'fight' && !this.dying) this.breakShield(w);
    }
    // phase 2: noticing the player back in reality
    if (st.layer !== this.lastLayer && st.layer === 'real') this.exitedAt = this.clock;
    this.lastLayer = st.layer;
    if (this.diving && st.layer === 'real') {
      const p = w.player;
      if (this.wakeAt === null && (this.slumpHit || dist(p.x, p.y, WREN_POD.x, WREN_POD.y) < 90 || this.clock - this.exitedAt > 7)) {
        this.wakeAt = this.clock + 1.5;
        w.fx.label(WREN_POD.x, WREN_POD.y - 50, T.wake, P.amber, 1.2);
        w.sfx('telegraph', 0.6);
      }
    } else if (this.diving) { this.wakeAt = null; this.slumpHit = false; }
    // phase 3: forced layer swap
    if (this.phase >= 2 && st.swapIn !== null && st.swapIn <= 0 && w.state === 'fight') {
      st.forceSwap(w, [this.body]);
      st.setLayer(w, this.body, st.layer);
      st.swapIn += st.swapPeriod;
      this.ambushed = false;
      this.nav.t = -1;
    }
    // presence point (labels, stagger sparks)
    const here = this.diving && st.layer === 'net' ? this.avatar : this.body;
    this.x = here.x; this.y = here.y;
    if (this.body.flash > 0 && this.diving) this.body.flash = Math.min(this.body.flash, 0.05);
    this.updateStatus();
  }

  private updateStatus(): void {
    const st = diveOf(this.w);
    if (!st) return;
    if (this.phase >= 2) { this.status = `${T.swap} ${Math.max(0, Math.ceil(st.swapIn ?? 0))}`; return; }
    const n = this.phase >= 1 ? 4 : 3;
    const s = this.shieldDownT > 0 ? `${T.shieldOff} ${Math.ceil(this.shieldDownT)}` : `${T.ports} ${st.portsAlive}/${n}`;
    this.status = this.diving ? `${s} · ${T.diving}` : s;
  }

  private breakShield(w: World): void {
    this.shieldDownT = 12;
    const b = this.body;
    w.fx.label(b.x, b.y - 64, T.shieldBreak, P.amber, 1.4);
    w.fx.ring(b.x, b.y - 18, 8, 60, P.cyan, 0.4, 3);
    w.fx.debris(b.x, b.y - 20, 12, [P.cyan, P.ice, P.abyss], 160);
    w.sfx('stagger');
    if (!this.inTransition && !this.dying) { this.staggerDur = 2; this.stagger(w); }
  }

  modHit(_w: World, part: BossPart, _h: Hit): { mul: number; tag: HitTag } {
    this.shieldedHit = false;
    if (this.partLayer(part) !== this.st.layer) return { mul: 0, tag: 'immune' };
    if (part === this.avatar) return { mul: 1, tag: 'normal' };
    if (this.diving) { this.slumpHit = true; return { mul: 1.5, tag: 'normal' }; }
    if (this.shieldUp) { this.shieldedHit = true; return { mul: 0.2, tag: 'armor' }; }
    return { mul: 1, tag: 'normal' };
  }

  /** No poise through the shield. */
  addPoise(w: World, amount: number): void {
    if (this.shieldedHit) { this.shieldedHit = false; return; }
    super.addPoise(w, amount);
  }

  onStaggerEnd(): void { this.staggerDur = 3; this.pose = 'idle'; this.apose = 'idle'; }
  onStagger(): void { this.st.plug = null; this.pose = 'hurt'; this.apose = 'hurt'; }
  onDeath(w: World): void {
    const st = diveOf(w);
    if (!st) return;
    st.plug = null;
    st.swapIn = null;
    for (const p of this.popups) p.dead = true;
  }

  // ------------------------------------------------------------------ helpers
  /** A telegraph in one layer. */
  private lh(layer: Layer | 'both', shape: Shape, warn: number, active: number, setup?: (h: Hazard) => void): Hazard {
    const h = this.hazard(shape, warn, active, setup);
    return this.st.addHazard(this.w, h, layer);
  }

  /** A projectile in one layer. */
  private fire(layer: Layer, x: number, y: number, a: number, speed: number, o: ShotOpts = {}): WrenBullet {
    const sp = speed * this.bulletMul;
    const b = new WrenBullet(x, y, Math.cos(a) * sp, Math.sin(a) * sp, layer, this.st);
    b.soft = o.soft ?? true;
    b.frame = o.frame ?? (b.soft ? 'orb_o' : 'bolt');
    b.r = o.r ?? (b.soft ? 3 : 2.5);
    b.dmg = o.dmg ?? 1;
    b.life = o.life ?? 4;
    b.rotates = o.rotates ?? !b.soft;
    b.glow = o.glow ?? 5;
    b.glowColor = o.glowColor ?? (b.soft ? COL.soft : COL.hard);
    b.deflectable = o.deflectable ?? true;
    return this.w.addBullet(b);
  }

  /** Step a part toward a point in a layer (cached path waypoints). Returns the distance left. */
  private stepTo(part: BossPart, layer: Layer, nav: Nav, tx: number, ty: number, speed: number, dt: number): number {
    const st = this.st;
    const d = dist(part.x, part.y, tx, ty);
    if (d < 1) return 0;
    if (nav.t < 0 || this.clock - nav.t > 0.2 || dist(nav.x, nav.y, part.x, part.y) < 3) {
      const n = st.grid[layer].next(part.x, part.y, tx, ty, part.r + 1);
      nav.x = n.x; nav.y = n.y; nav.t = this.clock;
    }
    const [nx, ny] = norm(nav.x - part.x, nav.y - part.y);
    const step = Math.min(speed * dt, d);
    st.move(this.w, layer, part, nx * step, ny * step);
    if (part === this.avatar) { if (Math.abs(nx) > 0.2) this.aflip = nx < 0; }
    else if (Math.abs(nx) > 0.2) this.flip = nx < 0;
    this.walkT += dt;
    return d - step;
  }

  private faceTarget(): void {
    const t = this.w.target();
    if (this.diving && this.st.layer === 'net') this.aflip = t.x < this.avatar.x;
    else this.flip = t.x < this.body.x;
  }

  /** Run `fn(dt)` every step for `dur` boss seconds; stops early when it returns true. */
  private *during(dur: number, fn: (dt: number) => boolean | void): Script {
    const end = this.clock + dur;
    let last = this.clock;
    while (this.clock < end) {
      const dt = this.clock - last;
      last = this.clock;
      if (fn(dt) === true) return;
      yield;
    }
  }

  /** Keep a fighting distance from the target, strafing; walls are walked around. */
  private *approach(dur: number, part: BossPart, layer: Layer, nav: Nav, want: number, speed: number): Script {
    let side = this.w.rng.chance(0.5) ? 1 : -1;
    const self = this;
    try {
      yield* this.during(dur, (dt) => {
        if (self.st.layer !== layer && self.phase < 2 && part === self.body) return true;
        const t = self.w.target();
        const d = dist(part.x, part.y, t.x, t.y);
        const [nx, ny] = norm(t.x - part.x, t.y - part.y);
        const k = d > want + 20 ? 1 : d < want - 30 ? -0.8 : 0;
        let gx = part.x + (nx * k - ny * 0.6 * side) * 40, gy = part.y + (ny * k + nx * 0.6 * side) * 40;
        [gx, gy] = self.w.clampToBounds(gx, gy, 20);
        if (!self.st.grid[layer].isFree(gx, gy)) side = -side;
        if (k > 0) { gx = t.x; gy = t.y; }
        self.pose = 'walk'; if (part === self.avatar) self.apose = 'walk';
        self.stepTo(part, layer, nav, gx, gy, speed, dt);
        if (part === self.avatar) self.aflip = t.x < part.x; else self.flip = t.x < part.x;
      });
    } finally { this.pose = 'idle'; this.apose = 'idle'; }
  }

  // ------------------------------------------------------------------ brain
  *brain(w: World): Script {
    yield* this.wait(0.4);
    for (;;) {
      const st = this.st;
      if (this.phase >= 2) { yield* this.p3Step(); continue; }
      if (this.diving) {
        if (st.layer === 'net') yield* this.avatarStep();
        else if (this.wakeAt !== null && this.clock >= this.wakeAt) yield* this.wake();
        else yield;
        continue;
      }
      if (st.layer === 'net' && st.bodyPod !== null) {
        if (this.phase >= 1 && this.diveCd <= 0) yield* this.diveIn();
        else yield* this.huntPlug();
        continue;
      }
      yield* this.realStep();
      void w;
    }
  }

  /** Real-layer pattern: reposition, then stylus volley or pop-ups. */
  private *realStep(): Script {
    const layer = this.bodyLayer();
    yield* this.approach(this.tele(0.7), this.body, layer, this.nav, 120, 82);
    if (this.st.layer !== layer) return;
    const k = this.pick++ % (this.phase >= 1 ? 3 : 2);
    if (k === 1) yield* this.popupAttack(layer);
    else yield* this.stylus(layer, this.phase >= 1 && k === 2 ? 2 : 1);
  }

  /** 触笔速射: three hard needles along three red lines. */
  private *stylus(layer: Layer, volleys: number): Script {
    const b = this.body;
    try {
      for (let v = 0; v < volleys; v++) {
        this.pose = 'cast'; this.faceTarget(); this.flare = 0.5;
        const hx = b.x + (this.flip ? -8 : 8), hy = b.y - 22;
        const a = this.aimFrom(hx, hy);
        const warn = this.tele(0.6);
        for (let i = -1; i <= 1; i++) {
          const aa = a + i * 0.2;
          this.lh(layer, { k: 'line', x1: hx, y1: hy, x2: hx + Math.cos(aa) * 240, y2: hy + Math.sin(aa) * 240, w: 8 }, warn, 0, (h) => { h.hitsPlayer = false; h.marker = true; });
        }
        this.w.sfx('charge', 0.5, 1.6);
        yield* this.wait(warn);
        if (this.st.layer !== layer && this.phase < 2) return;
        this.pose = 'shoot';
        for (let i = -1; i <= 1; i++) this.fire(layer, hx, hy, a + i * 0.2, 270, { soft: false, frame: 'bolt', glowColor: P.cyan });
        this.w.sfx('laser', 0.7, 1.4);
        yield* this.wait(0.22);
      }
      this.pose = 'idle';
      yield* this.wait(this.tele(0.7));
    } finally { this.pose = 'idle'; }
  }

  /** 全息弹窗: 3-5 AR windows, then they slam shut (1 heart, jumpable). */
  private *popupAttack(layer: Layer, warnOverride?: number): Script {
    const w = this.w, p = w.player;
    const n = Math.min(5, 3 + (this.phase >= 1 ? 1 : 0) + (this.tier >= 3 ? 1 : 0));
    const warn = warnOverride ?? this.tele(0.9);
    this.pose = 'cast'; this.flare = warn;
    try {
      const pts: { x: number; y: number }[] = [{ x: p.x, y: p.y - 6 }];
      for (let i = 1; i < n; i++) {
        for (let tries = 0; tries < 8; tries++) {
          const a = w.rng.next() * Math.PI * 2, r = 50 + w.rng.next() * 70;
          const [x, y] = w.clampToBounds(p.x + Math.cos(a) * r, p.y - 6 + Math.sin(a) * r * 0.8, 30);
          if (pts.every((q) => Math.abs(q.x - x) > 44 || Math.abs(q.y - y) > 30)) { pts.push({ x, y }); break; }
        }
      }
      for (const q of pts) {
        const h = this.lh(layer, { k: 'rect', x: q.x - 24, y: q.y - 16, w: 48, h: 32 }, warn, 0.12, (hh) => {
          hh.low = true; hh.marker = true;
          hh.onActivate = (ww) => { ww.fx.sparks(q.x, q.y, 6, P.cyan, 90); ww.fx.shake(2, 0.1); };
        });
        this.popups.push(h);
      }
      w.sfx('ui', 0.8, 1.5);
      yield* this.wait(Math.min(warn, this.tele(0.9)));
      if (!warnOverride) {
        w.sfx('crush', 0.6, 1.4);
        yield* this.wait(0.15);
        this.pose = 'idle';
        yield* this.wait(this.tele(0.8));
      }
    } finally { this.pose = 'idle'; this.popups = this.popups.filter((h) => !h.dead); }
  }

  /** 数据流改向: streams flash red for 1 s, then reverse. */
  private *reroute(part: BossPart): Script {
    const st = this.st, w = this.w;
    const idx = this.phase >= 1 ? [0, 1, 2, 3] : w.rng.chance(0.5) ? [0, 3] : [1, 2];
    if (part === this.avatar) this.apose = 'cast'; else this.pose = 'cast';
    this.flare = 0.6;
    st.flipStreams(w, idx, 1);
    if (st.layer === 'net') w.fx.label(part.x, part.y - 56, T.reroute, P.red, 1);
    try { yield* this.wait(this.tele(0.45)); } finally { this.pose = 'idle'; this.apose = 'idle'; }
  }

  /** Walk to the pod with the player's body and pull the plug. */
  private *huntPlug(): Script {
    const st = this.st, w = this.w, b = this.body;
    let flipAt = this.clock + 3;
    const speed = this.phase >= 1 ? 90 : 80;
    try {
      // a fresh dive: she scans for the pod first (monocle flare)
      if (this.huntFor !== st.switchedAt) {
        this.huntFor = st.switchedAt;
        this.pose = 'cast'; this.flare = 1;
        yield* this.wait(this.tele(1.2));
      }
      for (;;) {
        if (st.layer !== 'net' || st.bodyPod === null) return;
        const podIdx = st.bodyPod, pod = PODS[podIdx], f = podFront(pod);
        if (this.clock >= flipAt) { yield* this.reroute(b); flipAt = this.clock + 5.5; continue; }
        if (dist(b.x, b.y, f.x, f.y) > 14) {
          let last = this.clock;
          yield* this.during(0.25, () => {
            const dt = this.clock - last; last = this.clock;
            this.pose = 'walk';
            return this.stepTo(b, 'real', this.nav, f.x, f.y, speed, dt) < 2 || st.layer !== 'net';
          });
          continue;
        }
        // at the pod: 1.4 s warning, then pull
        const dur = this.tele(1.4);
        this.pose = 'cast'; this.flip = pod.x < b.x;
        const hz = this.lh('both', { k: 'circle', x: pod.x, y: pod.y - 4, r: 24 }, dur, 0.05, (h) => { h.hitsPlayer = false; h.marker = true; });
        st.plug = { pod: podIdx, t: 0, dur };
        w.sfx('siren', 0.8);
        const end = this.clock + dur;
        while (this.clock < end && st.layer === 'net' && st.bodyPod === podIdx) yield;
        hz.dead = true; st.plug = null;
        if (st.layer === 'net' && st.bodyPod === podIdx) {
          st.pullPlug(w);
          this.pose = 'shoot';
          w.sfx('zap');
          yield* this.wait(this.tele(1.1));
          return;
        }
        yield* this.wait(this.tele(0.3));
      }
    } finally { st.plug = null; this.pose = 'idle'; }
  }

  /** Phase 2: lie down in her pod; the avatar appears in the net. */
  private *diveIn(): Script {
    const st = this.st, w = this.w, b = this.body;
    const f = podFront(WREN_POD);
    try {
      while (dist(b.x, b.y, f.x, f.y) > 10) {
        if (st.layer !== 'net') return;
        let last = this.clock;
        yield* this.during(0.25, () => { const dt = this.clock - last; last = this.clock; this.pose = 'walk'; return this.stepTo(b, 'real', this.nav, f.x, f.y, 110, dt) < 2; });
      }
      this.pose = 'hurt';
      yield* this.wait(0.45);
      if (st.layer !== 'net') return;
      this.diving = true;
      this.diveCd = 10;
      this.wakeAt = null; this.slumpHit = false;
      b.x = WREN_POD.x; b.y = WREN_POD.y + 4;
      this.avatar.x = f.x; this.avatar.y = f.y + 8; this.anav.t = -1;
      this.avatar.targetable = true;
      st.setLayer(w, this.avatar, 'net');
      w.fx.ring(this.avatar.x, this.avatar.y - 18, 4, 40, P.cyan, 0.35, 2);
      w.fx.label(this.avatar.x, this.avatar.y - 56, T.diving, P.cyan, 1);
      w.sfx('blink');
      yield* this.wait(0.4);
    } finally { this.pose = 'idle'; }
  }

  /** Back to the body: the avatar fades, she climbs out. */
  private *wake(): Script {
    const st = this.st, w = this.w;
    this.endDive(w);
    this.pose = 'hurt';
    try { yield* this.wait(0.45); } finally { this.pose = 'idle'; }
    void st;
  }

  private endDive(w: World): void {
    const st = this.st;
    if (!this.diving) return;
    this.diving = false;
    this.wakeAt = null;
    this.slumpHit = false;
    w.fx.ring(this.avatar.x, this.avatar.y - 18, 30, 4, P.cyan, 0.3, 1);
    this.avatar.targetable = false;
    st.setLayer(w, this.avatar, 'off');
    for (const e of w.bullets) if (e instanceof WrenBullet && e.team === 'enemy' && e.layer === 'net') e.dead = true;
    const f = podFront(WREN_POD);
    this.body.x = f.x; this.body.y = f.y;
    this.nav.t = -1;
  }

  /** Net avatar pattern: chase, then whip or needles (sometimes reroute the streams). */
  private *avatarStep(): Script {
    const a = this.avatar;
    yield* this.approach(this.tele(0.6), a, 'net', this.anav, 56, 100);
    if (!this.diving || this.st.layer !== 'net') return;
    const t = this.w.target();
    const k = this.apick++ % 4;
    if (k === 3) yield* this.reroute(a);
    else if (dist(a.x, a.y, t.x, t.y) < 84) yield* this.whip(a, 'net');
    else yield* this.needles(a, 'net');
  }

  /** 代码鞭: 0.7 s sector. */
  private *whip(part: BossPart, layer: Layer): Script {
    const isAv = part === this.avatar;
    const a = angleTo(part.x, part.y - 6, this.w.target().x, this.w.target().y - 6);
    const warn = this.tele(0.7);
    if (isAv) { this.apose = 'cast'; this.aflip = Math.cos(a) < 0; } else { this.pose = 'cast'; this.flip = Math.cos(a) < 0; }
    try {
      this.lh(layer, { k: 'sector', x: part.x, y: part.y - 6, r: 74, a, span: 1.7 }, warn, 0.12);
      this.w.sfx('charge', 0.6, 1.2);
      yield* this.wait(warn);
      if (isAv) this.apose = 'whip'; else this.pose = 'shoot';
      this.w.sfx('slash', 0.8, 0.8);
      yield* this.wait(0.2);
      if (isAv) this.apose = 'idle'; else this.pose = 'idle';
      yield* this.wait(this.tele(0.6));
    } finally { this.pose = 'idle'; this.apose = 'idle'; }
  }

  /** 数据针: a fan of soft needles (the shotgun clears them). */
  private *needles(part: BossPart, layer: Layer): Script {
    const isAv = part === this.avatar;
    try {
      if (isAv) this.apose = 'cast'; else this.pose = 'cast';
      this.flare = 0.5;
      this.w.fx.ring(part.x, part.y - 20, 18, 4, P.magenta, this.tele(0.5), 1);
      this.w.sfx('charge', 0.4, 1.5);
      yield* this.wait(this.tele(0.5));
      const hx = part.x, hy = part.y - 20;
      const a = this.aimFrom(hx, hy);
      const n = this.phase >= 1 ? 6 : 5;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1) - 0.5;
        this.fire(layer, hx, hy, a + t * 0.9, 150, { soft: true, frame: 'orb_o', glowColor: COL.softAlt });
      }
      this.w.sfx('laser', 0.5, 1.8);
      if (isAv) this.apose = 'idle'; else this.pose = 'idle';
      yield* this.wait(this.tele(0.7));
    } finally { this.pose = 'idle'; this.apose = 'idle'; }
  }

  // ------------------------------------------------------------------ phase 3
  private *p3Step(): Script {
    const st = this.st;
    const left = st.swapIn ?? 99;
    if (!this.ambushed && left < this.tele(1.6) + 0.3 && left > 0.4) { yield* this.ambush(); return; }
    const layer = st.layer;
    const b = this.body;
    // stay clear of attacks that would still be winding up across the swap
    const budget = left - 0.2;
    if (layer === 'real') {
      yield* this.approach(Math.min(this.tele(0.6), Math.max(0.1, budget)), b, layer, this.nav, 120, 86);
      if ((st.swapIn ?? 99) < this.tele(1.6) + 0.3) return;
      const k = this.pick++ % 2;
      if (k === 0) yield* this.stylus(layer, 1); else yield* this.popupAttack(layer);
    } else {
      yield* this.approach(Math.min(this.tele(0.6), Math.max(0.1, budget)), b, layer, this.nav, 56, 100);
      if ((st.swapIn ?? 99) < this.tele(1.6) + 0.3) return;
      const t = this.w.target();
      const k = this.apick++ % 3;
      if (k === 2) yield* this.reroute(b);
      else if (dist(b.x, b.y, t.x, t.y) < 84) yield* this.whip(b, layer);
      else yield* this.needles(b, layer);
    }
  }

  /** Pop-ups cast into the next layer: they land 0.6 s after the swap. */
  private *ambush(): Script {
    const st = this.st;
    this.ambushed = true;
    const next = st.other(st.layer);
    const warn = Math.max(0.9, (st.swapIn ?? 1) + 0.6);
    yield* this.popupAttack(next, warn);
    // wait out the swap
    const self = this;
    yield* this.during(3, () => self.st.layer === next);
    yield* this.wait(this.tele(0.6));
  }

  // ------------------------------------------------------------------ transitions
  *transition(w: World, phase: number): Script {
    const st = this.st;
    this.invuln = true;
    try {
      if (phase === 1) {
        w.fx.label(this.x, this.y - 66, T.phase2, P.cyan, 1.4);
        if (this.shieldUp) st.spawnPorts(w, 4, true);
        this.diveCd = 0;
        yield* this.wait(1.0);
      } else {
        // phase 3: one form that follows the player's layer
        const av = this.diving && st.layer === 'net' ? { x: this.avatar.x, y: this.avatar.y } : null;
        if (this.diving) this.endDive(w);
        if (av) { this.body.x = av.x; this.body.y = av.y; }
        st.clearPorts(w);
        this.shieldDownT = 0;
        st.podsOpen = false; st.bodyPod = null; st.plug = null; st.pending = null;
        st.setLayer(w, this.body, st.layer);
        const g = st.grid[st.layer];
        if (!g.isFree(this.body.x, this.body.y)) { const f = g.nearestFree(this.body.x, this.body.y); this.body.x = f.x; this.body.y = f.y; }
        st.swapIn = st.swapPeriod;
        this.ambushed = false;
        w.fx.label(this.body.x, this.body.y - 66, T.phase3, P.amber, 1.6);
        w.fx.flash(P.cyan, 0.25, 0.2);
        yield* this.wait(1.0);
      }
    } finally { this.invuln = false; this.pose = 'idle'; }
  }

  // ------------------------------------------------------------------ entrance
  introFocus(): { x: number; y: number } { return { x: WREN_POD.x, y: WREN_POD.y + 50 }; }

  /**
   * The cafe lights glitch, AR windows pop open around her pod, she climbs out and walks down,
   * her monocle flares cyan. Visual only.
   */
  *entrance(w: World): Script {
    const t0 = this.clock;
    const b = this.body;
    const f = podFront(WREN_POD);
    this.introPod = true;
    b.x = WREN_POD.x; b.y = WREN_POD.y + 4;
    try {
      w.sfx('zap', 0.6);
      let last = this.clock;
      const wins = [{ x: WREN_POD.x - 70, y: WREN_POD.y + 10, t: 0.55 }, { x: WREN_POD.x + 72, y: WREN_POD.y + 2, t: 0.85 }, { x: WREN_POD.x - 30, y: WREN_POD.y + 70, t: 1.15 }];
      let stepped = false, flared = false;
      while (this.clock - t0 < 3.3) {
        const t = this.clock - t0, dt = this.clock - last;
        last = this.clock;
        this.introDark = t < 1.3 ? (Math.floor(t * 14) % 3 === 0 ? 0.65 : 0.35) : Math.max(0, 0.35 - (t - 1.3));
        for (const q of wins) if (t >= q.t && !this.introWins.includes(q)) { this.introWins.push(q); w.sfx('ui', 0.7, 1.4 + this.introWins.length * 0.1); }
        if (t >= 1.5 && !stepped) { stepped = true; this.introPod = false; b.x = f.x; b.y = f.y - 6; w.sfx('blink', 0.7); }
        if (t >= 1.5 && t < 2.4) {
          this.pose = 'walk'; this.walkT += dt;
          b.y = Math.min(WREN_SPAWN.y, b.y + 30 * dt);
        } else if (t >= 2.4) this.pose = 'cast';
        if (t >= 2.5 && !flared) { flared = true; this.flare = 0.8; w.fx.ring(b.x + 3, b.y - 30, 4, 46, P.cyan, 0.45, 2); w.sfx('emp', 0.7); }
        if (this.flare > 0) this.flare -= dt;
        yield;
      }
    } finally {
      this.introPod = false; this.introDark = 0; this.introWins = []; this.pose = 'idle'; this.flare = 0;
      b.x = WREN_SPAWN.x; b.y = WREN_SPAWN.y; this.x = b.x; this.y = b.y;
      this.invuln = false; this.diving = false;
    }
  }

  // ------------------------------------------------------------------ drawing
  private frame(pose: Pose): string {
    if (pose === 'walk') return Math.floor(this.walkT * 8) % 2 ? 'walk2' : 'walk1';
    if (pose === 'idle') return Math.floor(this.clock * 3) % 2 ? 'idle2' : 'idle1';
    return pose;
  }

  draw(g: Gfx, w: World): void {
    const st = diveOf(w);
    if (!st) return;
    const realOn = st.layer === 'real';
    const aReal = realOn ? 1 : 0.28;
    // her pod (real)
    const inPod = this.diving || this.introPod;
    g.ellipse(WREN_POD.x, WREN_POD.y + 1, 14, 5, P.ink, 0.4 * aReal, 'floor');
    g.img('dive_dev', inPod ? 'wpod_full' : 'wpod_empty', WREN_POD.x, WREN_POD.y + 3,
      { alpha: aReal, fill: inPod && this.body.flash > 0 && realOn ? P.white : undefined });
    if (inPod) g.circle(WREN_POD.x, WREN_POD.y - 16, 12, P.magenta, 0.15 * aReal, 'light');
    if (this.diving && this.wakeAt !== null && realOn) {
      const k = clamp((this.wakeAt - this.clock) / 1.5, 0, 1);
      g.rect(WREN_POD.x - 14, WREN_POD.y - 40, 28, 3, P.ink, 0.8, 'top');
      g.rect(WREN_POD.x - 14, WREN_POD.y - 40, 28 * k, 3, P.amber, 1, 'top');
    }
    // body
    const b = this.body;
    const bl = this.bodyLayer();
    if (!inPod) {
      const on = bl === st.layer;
      const sheet = bl === 'net' ? 'wren_net' : 'wren';
      const fr = b.flash > 0 || this.staggered ? 'hurt' : this.frame(this.pose);
      g.ellipse(b.x, b.y + 1, 9, 3.5, P.ink, on ? 0.5 : 0.15, 'floor');
      if (bl === 'net' && on) this.glitchCopies(g, sheet, fr, b.x, b.y, this.flip);
      g.img(sheet, fr, b.x, b.y + 4, { flipX: this.flip, alpha: on ? 1 : 0.28, fill: b.flash > 0 && on ? P.white : undefined });
      const mx = b.x + (this.flip ? -2 : 2), my = b.y - 31;
      if (on) g.circle(mx, my, 4 + (this.flare > 0 ? 6 : 0), this.phase >= 2 ? P.red : P.cyan, this.flare > 0 ? 0.5 : 0.22, 'light');
      if (this.shieldUp && on && !this.dying) {
        const pulse = 0.25 + 0.1 * Math.sin(w.realTime * 5);
        g.ring(b.x, b.y - 18, 17, 1, P.cyan, pulse, 'top');
        g.circle(b.x, b.y - 18, 18, P.cyan, 0.08, 'light');
      }
    }
    // avatar
    if (this.diving) {
      const a = this.avatar, on = st.layer === 'net';
      const fr = a.flash > 0 || this.staggered ? 'hurt' : this.frame(this.apose);
      if (on) this.glitchCopies(g, 'wren_net', fr, a.x, a.y, this.aflip);
      g.ellipse(a.x, a.y + 1, 9, 3.5, P.cyan, on ? 0.2 : 0.06, 'floor');
      g.img('wren_net', fr, a.x, a.y + 4, { flipX: this.aflip, alpha: on ? 1 : 0.25, fill: a.flash > 0 && on ? P.white : undefined });
      if (on) g.circle(a.x, a.y - 24, 14, P.cyan, 0.16, 'light');
    }
    // AR pop-up windows over their telegraphs
    for (const h of this.popups) {
      if (h.dead || h.shape.k !== 'rect') continue;
      const s = h.shape, lay = st.hazardLayer(h);
      const on = lay === 'both' || lay === st.layer;
      const k = h.progress;
      const pop = Math.min(1, h.t / 0.12);
      g.img('dive_win', k > 0.75 && Math.floor(w.realTime * 16) % 2 ? 'win_b' : 'win_a', s.x + s.w / 2, s.y + s.h / 2 - (1 - pop) * 4,
        { layer: 'top', ox: 0.5, oy: 0.5, alpha: (on ? 0.6 : 0.22) * pop, sy: pop });
    }
    // entrance: AR windows and the light glitch
    for (const q of this.introWins) g.img('dive_win', 'win_a', q.x, q.y, { layer: 'top', ox: 0.5, oy: 0.5, alpha: 0.9 });
    if (this.introDark > 0) g.rect(0, 0, 640, 360, P.ink, this.introDark, 'ui');
    if (this.staggered && !inPod) g.ring(this.x, this.y - 52, 10, 2, P.amber, 0.8, 'top');
  }

  /** Colour-split copies for the net form (cyan / magenta offsets that jump now and then). */
  private glitchCopies(g: Gfx, sheet: string, fr: string, x: number, y: number, flip: boolean): void {
    const j = Math.floor(this.clock * 12) % 7 === 0 ? 3 : 1;
    g.img(sheet, fr, x - j, y + 4, { flipX: flip, tint: P.magenta, alpha: 0.35 });
    g.img(sheet, fr, x + j, y + 4, { flipX: flip, tint: P.cyan, alpha: 0.35 });
  }
}

export const wrenDef: BossDef = {
  id: 'wren', arena: divecafe, spawn: WREN_SPAWN, make: (w, tier) => new Wren(w, tier),
  drop: 'arm_jack', hint: T.hint, portrait: { key: 'standee', frame: 'wren' },
  music: { bpm: 128, kick: 'x.....x...x.....', snare: '....x.......x..x', hat: 'x.xxx.x.x.xxx.xx',
    bass: [0, null, 0, 12, null, 0, 10, null, 0, null, 7, null, 3, 3, 5, null],
    lead: [24, null, 22, null, 19, null, null, 17, 19, null, 15, null, null, 12, null, null],
    root: 40, chords: [0, 0, 5, 3], wave: 'square' },
};
