/** Memory archive: delayed hostile echoes, one stored replay, breaker and coolant controls. */
import { KAIRO_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { dist } from '../../engine/math';
import { Body } from '../body';
import { Hazard } from '../hazard';
import { Barrel, Pillar } from '../props';
import type { Hit } from '../types';
import type { Arena, World } from '../world';

import { ArchiveTime } from './archiveTime';
import { ARCHIVE_LAYOUT } from './archiveLayout';
import { ArchiveRush } from './archiveRush';
import { ArchiveStop } from './archiveStop';
import { copyMemory, drawMemory, MemoryCast, type MemoryPattern } from './archiveMemory';
export type { MemoryPattern } from './archiveMemory';

const states = new WeakMap<World, ArchiveState>();
export const archiveOf = (w: World): ArchiveState | undefined => states.get(w);

class ArchiveDevice extends Body {
  cd = 0;
  private hits = 0;
  private shock = 0;
  private shockAt = -9;
  constructor(readonly st: ArchiveState, readonly mode: 'record' | 'breaker' | 'coolant', x: number, y: number) {
    super(); this.x = x; this.y = y; this.r = 10; this.hz = 12; this.hr = 13;
    this.mass = 0; this.solid = true; this.conductive = true; this.interactable = true; this.hackable = true;
    this.grapple = 'anchor'; this.interactLabel = mode === 'record' ? T.record : mode === 'breaker' ? T.breaker : T.coolant;
  }
  update(w: World, dt: number): void {
    this.cd = Math.max(0, this.cd - dt); this.flash = Math.max(0, this.flash - dt);
    if (w.time - this.shockAt > 0.06 || this.cd > 0) this.shock = 0;
    if (this.mode === 'record') this.interactLabel = this.st.stored ? T.release : T.record;
  }
  private use(w: World): void {
    if (this.cd > 0 || w.state !== 'fight') return;
    if (this.mode === 'record') {
      if (!this.st.useRecord(w)) return;
      this.cd = 1;
    } else if (this.mode === 'breaker') {
      this.st.pauseT = 2.5; this.st.time.restore(); this.cd = 10;
      w.fx.ring(this.x, this.y - 8, 8, 70, P.ice, 0.4, 2); w.sfx('emp', 0.7);
    } else {
      this.cd = 12;
      const x = this.x, y = this.y;
      const h = new Hazard({ k: 'circle', x, y: y - 4, r: 76 }, 0.75, 0.18);
      h.team = 'player'; h.hitsPlayer = false; h.color = P.ice; h.marker = true;
      h.onActivate = () => {
        for (const b of w.bodies) if (!b.dead && b.team === 'enemy' && dist(x, y - 4, b.hx, b.hy) <= 76 + b.hr) {
          // 999 poise: the jet always staggers, whatever the tier's poise bar
          w.damage(b, { dmg: 120, kind: 'shock', x: b.hx, y: b.hy, from: 'env', src: 'coolant', poise: 999 });
        }
        w.fx.smoke(x, y - 6, 18, P.ice, 6, 70); w.sfx('emp');
      };
      w.addHazard(h); w.sfx('telegraph');
    }
    this.hits = 0; this.shock = 0; this.flash = 0.12;
  }
  hurt(w: World, h: Hit): number {
    if (h.from !== 'player' || this.cd > 0) return 0;
    if (h.kind === 'fire' || h.quiet) return 0;
    this.flash = 0.06;
    this.hits++;
    if (h.src === 'slug' || h.kind === 'blast' || h.kind === 'impact' || this.hits >= 4) this.use(w);
    return 0;
  }
  onShock(w: World, _dps: number, dt: number): void {
    if (this.cd > 0) return;
    this.shockAt = w.time; this.shock += dt;
    if (this.shock >= 0.5) this.use(w);
  }
  onHack(w: World): void { this.use(w); }
  onEmp(w: World): void { this.use(w); }
  onInteract(w: World): void { this.use(w); }
  draw(g: Gfx, w: World): void {
    const on = this.cd <= 0;
    g.ellipse(this.x, this.y + 1, 13, 5, P.ink, 0.5);
    g.img('archive_dev', this.mode + (on ? '_on' : '_off'), this.x, this.y + 4, { fill: this.flash > 0 ? P.white : undefined });
    if (on) g.circle(this.x, this.y - 18, 12, this.mode === 'coolant' ? P.ice : P.amber, 0.13, 'light');
    if (this.mode === 'record' && this.st.stored) g.ring(this.x, this.y - 20, 10 + Math.sin(w.time * 6), 1, P.cyan, 0.7, 'top');
    if (!on) g.crisp(`${Math.ceil(this.cd)}`, this.x, this.y - 36, { align: 'center', color: P.steel, layer: 'top' });
  }
}

class ArchiveRack extends Pillar {
  draw(g: Gfx): void {
    g.ellipse(this.x, this.y, 13, 5, P.ink, 0.5);
    g.img('archive_dev', 'rack_on', this.x, this.y + 4);
  }
}

export class ArchiveState {
  readonly time = new ArchiveTime();
  rush: ArchiveRush | null = null;
  private trail: { x: number; y: number; t: number; distance: number }[] = [];
  private trailTimer = 0;
  private travelled = 0;
  pending: MemoryCast[] = [];
  casts: MemoryCast[] = [];
  stops: ArchiveStop[] = [];
  /** Kairo's current pendulum-swing telegraph (read by the autopilot). */
  swing: Hazard | null = null;
  swingBack: Hazard | null = null;
  /** Extra boss-clock seconds granted to each pending shutter replay so far (capped). */
  private shutterGrace = new WeakMap<MemoryCast, number>();
  stored: MemoryPattern | null = null;
  pauseT = 0;
  get busy(): boolean { return (!!this.rush && !this.rush.dead) || this.casts.some(c => !c.dead && !c.friendly) || this.stops.some(s => !s.dead); }
  get shutterPending(): boolean { return this.casts.some(c => !c.dead && !c.friendly && c.pattern.kind === 'shutter'); }
  /** Hostile patterns alive now (originals, replays and stop-watches). */
  get hostileCount(): number { return this.casts.filter(c => !c.dead && !c.friendly).length + this.stops.filter(s => !s.dead).length; }
  /** Only delayed replays are running: a new original may be layered on top of one of them. */
  get layerable(): boolean {
    if (this.rush && !this.rush.dead) return false;
    if (this.stops.some(s => !s.dead) || this.shutterPending) return false;
    const hostile = this.casts.filter(c => !c.dead && !c.friendly);
    return hostile.length === 1 && hostile[0].replay;
  }
  /** A stop-watch currently holds the player still. */
  get stopping(): boolean { return this.stops.some(s => !s.dead && !s.warning); }
  constructor(private readonly w: World) {}

  cast(pattern: MemoryPattern, warn: number, friendly = false, replay = false): MemoryCast {
    const rate = friendly ? 1 : this.time.rates.boss;
    // Every warning retains at least 0.7 seconds of unjammed world time in haste.
    const c = new MemoryCast(this, copyMemory(pattern), Math.max(warn, rate * 0.7), friendly, replay);
    this.casts.push(c); this.w.objects.push(c);
    return c;
  }
  record(pattern: MemoryPattern, delay = 3): void {
    this.pending = this.pending.filter(c => !c.dead);
    if (this.pending.length >= 2) return;
    if (pattern.kind === 'shutter') delay = Math.max(delay, this.journey(pattern.x, pattern.y, pattern.r) * this.time.rates.boss);
    this.pending.push(this.cast(pattern, delay, false, true));
  }
  /** Real seconds the player needs to walk back inside an archive spot from where they stand now. */
  journey(x: number, y: number, r: number): number {
    const p = this.w.player;
    // 1.3: detours around racks and devices; 0.8: reaction time.
    const gap = Math.max(0, dist(p.x, p.y - 4, x, y) - r + 16) * 1.3;
    return gap / (118 * Math.min(1, p.moveMul) * this.time.rates.player) + 0.8;
  }
  startStop(x: number, y: number, r: number, warn: number): ArchiveStop {
    const s = new ArchiveStop(this, x, y, r, warn);
    this.stops.push(s); this.w.objects.push(s);
    this.w.sfx('telegraph');
    return s;
  }
  clearHostile(): void {
    this.rush?.cancel();
    for (const c of this.casts) if (!c.friendly) c.cancel();
    for (const s of this.stops) s.cancel();
    this.pending = []; this.stops = [];
  }
  startRush(phase: number, pace: number): ArchiveRush {
    this.rush?.cancel();
    const rush = new ArchiveRush(this, phase, pace);
    this.rush = rush; this.w.objects.push(rush);
    this.w.sfx('charge', 0.8);
    return rush;
  }
  cutMemory(w: World, pattern: MemoryPattern): void {
    if (!this.stored) this.stored = copyMemory(pattern);
    w.fx.ring(pattern.x, pattern.y, 6, 35, P.ice, 0.25, 2);
    w.fx.sparks(pattern.x, pattern.y, 10, P.amber, 90); w.sfx('deflect');
    w.boss?.addPoise(w, 20);
  }
  useRecord(w: World): boolean {
    if (w.boss?.dying) return false;
    if (!this.stored) {
      // Only a replay still in its countdown can be sealed; one already swinging plays out.
      const c = this.pending.filter(c => !c.dead && !c.begun).sort((a, b) => a.remaining - b.remaining)[0];
      if (!c) { w.sfx('click', 0.4); return false; }
      this.stored = copyMemory(c.pattern); c.cancel();
      w.fx.ring(96, 126, 6, 28, P.cyan, 0.25, 2); w.sfx('recall');
    } else {
      const p = this.stored; this.stored = null;
      this.cast(p, 0.7, true); w.sfx('charge');
    }
    return true;
  }
  pastPlayer(): { x: number; y: number; distance: number } {
    const old = this.trail.find(p => p.t >= this.w.time - 2) ?? this.trail[0];
    return old ? { x: old.x, y: old.y, distance: this.travelled - old.distance }
      : { x: this.w.player.x, y: this.w.player.y - 4, distance: 0 };
  }
  update(w: World, dt: number): void {
    if (w.state === 'fight') {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.06;
        const p = w.player, last = this.trail[this.trail.length - 1];
        if (last) this.travelled += dist(last.x, last.y, p.x, p.y - 4);
        this.trail.push({ x: p.x, y: p.y - 4, t: w.time, distance: this.travelled });
      }
      while (this.trail.length > 1 && this.trail[1].t < w.time - 4) this.trail.shift();
    }
    if (this.rush?.dead) this.rush = null;
    this.pauseT = Math.max(0, this.pauseT - dt);
    this.pending = this.pending.filter(c => !c.dead);
    this.casts = this.casts.filter(c => !c.dead);
    this.stops = this.stops.filter(s => !s.dead);
    // A shutter replay never closes before the player could walk back to it (a slow field
    // started, or other pressure pushed them away); the extra time is capped at 3 boss seconds.
    for (const c of this.pending) {
      if (c.begun || c.pattern.kind !== 'shutter' || this.pauseT > 0) continue;
      const need = this.journey(c.pattern.x, c.pattern.y, c.pattern.r) * this.time.rates.boss;
      const granted = this.shutterGrace.get(c) ?? 0;
      if (c.remaining < need && granted < 3) {
        const add = Math.min(need - c.remaining, 3 - granted);
        c.remaining += add; this.shutterGrace.set(c, granted + add);
      }
    }
    if (w.boss?.dying || w.state === 'lost' || w.state === 'won') {
      for (const c of this.casts) c.cancel();
      for (const s of this.stops) s.cancel();
      this.rush?.cancel(); this.rush = null;
      this.pending = []; this.stops = []; this.stored = null;
    }
  }
  drawTop(g: Gfx): void {
    if (this.stored) drawMemory(g, this.stored, P.amber, true);
    if (this.pauseT > 0) g.crisp(`${T.paused} ${this.pauseT.toFixed(1)}`, 320, 66, { color: P.ice, align: 'center', layer: 'top' });
  }
}

export const archive: Arena = {
  id: 'archive', bg: 'bg_archive', bounds: { ...ARCHIVE_LAYOUT.bounds }, playerSpawn: { x: 320, y: 292 },
  setup(w) {
    const st = new ArchiveState(w); states.set(w, st); w.objects.push(st);
    w.add(new ArchiveDevice(st, 'record', 96, 134));
    w.add(new ArchiveDevice(st, 'breaker', 544, 134));
    w.add(new ArchiveDevice(st, 'coolant', 544, 284));
    w.add(new ArchiveRack(176, 212)); w.add(new ArchiveRack(464, 212));
    w.add(new Barrel(220, 288)); w.add(new Barrel(420, 288));
  },
  timeRates(w) { return archiveOf(w)!.time.rates; },
  update(w, dt) { archiveOf(w)?.time.update(w, dt); },
  drawFloor(g, w) { archiveOf(w)?.time.drawFloor(g); },
  drawTop(g, w) { archiveOf(w)?.time.drawTop(g, w); },
  botHint(w) {
    const st = archiveOf(w);
    if (!st || st.pauseT > 0) return null;
    if (st.rush?.imminent(w)) return { x: w.player.x, y: w.player.y, jump: true };
    // Step out of the pendulum swing late in its wind-up, as a player reacting to it would;
    // with a return swing pending, clear its band as well.
    const sw = st.swing, sb = st.swingBack;
    const back = sb && !sb.dead && sb.warning && sb.warn - sb.t < 0.8 * w.bossRate ? sb : null;
    if (sw && !sw.dead && sw.warning && sw.shape.k === 'circle' && sw.warn - sw.t < 0.35 * w.bossRate || back) {
      const c = (back ?? sw)!.shape as { x: number; y: number; r: number; w?: number };
      const out = back ? c.r + (c.w ?? 0) / 2 : c.r, d = dist(w.player.x, w.player.y - 4, c.x, c.y);
      if (d < out + 10) {
        const a = Math.atan2(w.player.y - 4 - c.y, w.player.x - c.x);
        const [x, y] = w.clampToBounds(c.x + Math.cos(a) * (out + 30), c.y + 4 + Math.sin(a) * (out + 30), 20);
        return { x, y, jump: false };
      }
    }
    // Leave a closing stop-watch late (a reaction delay), not the moment it appears.
    const stop = st.stops.find(s => s.warning && s.contains(w.player.x, w.player.y - 4, 10) && s.realLeft(w) < 0.3);
    if (stop) {
      const a = Math.atan2(w.player.y - 4 - stop.y, w.player.x - stop.x);
      const [x, y] = w.clampToBounds(stop.x + Math.cos(a) * (stop.r + 30), stop.y + 4 + Math.sin(a) * (stop.r + 30), 20);
      return { x, y, jump: false };
    }
    const shutter = st.casts.find(c => !c.dead && !c.friendly && c.pattern.kind === 'shutter');
    if (shutter && shutter.pattern.kind === 'shutter') {
      const p = shutter.pattern;
      if (dist(w.player.x, w.player.y - 4, p.x, p.y) > p.r - 16) return { x: p.x, y: p.y + 4, jump: false };
      return null;
    }
    const threats = st.casts.filter(c => c.threatens(w.player.x, w.player.y - 4, 10, 0.4));
    if (!threats.length) return null;
    const safe: { x: number; y: number }[] = [];
    for (const y of [ARCHIVE_LAYOUT.bounds.y + 16, 165, 255, 310]) for (const x of [72, 250, 390, 568]) {
      if (st.casts.some(c => c.threatens(x, y - 4, 12, 0.6))) continue;
      if (w.bodies.some(b => !b.dead && b.solid && dist(x, y, b.x, b.y) < b.r + 10)) continue;
      safe.push({ x, y });
    }
    safe.sort((a, b) => dist(a.x, a.y, w.player.x, w.player.y) - dist(b.x, b.y, w.player.x, w.player.y));
    return safe[0] ? { ...safe[0], jump: true } : null;
  },
};
