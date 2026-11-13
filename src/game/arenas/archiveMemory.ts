/** Recorded time attacks: geometry, drawing and execution share the same immutable timeline. */
import { KAIRO_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { clamp, dist, segDist } from '../../engine/math';
import { JAM_SLOW } from '../boss';
import type { Cable } from '../types';
import type { World } from '../world';
import { ARCHIVE_LAYOUT } from './archiveLayout';

export interface TracePoint {
  x: number; y: number; z: number; frame: string;
  /** Blink/teleport gaps are not swept into a damaging straight line. */
  cut?: boolean;
}
export type MemoryPattern =
  | { kind: 'trace'; x: number; y: number; path: TracePoint[]; duration: number; copies: number }
  | { kind: 'shutter'; x: number; y: number; r: number }
  | { kind: 'hand'; x: number; y: number; r: number; a: number; sweep: number; duration: number;
      /** Half-width of the blade (default 5); the P2 minute hand is thicker. */
      hw?: number; minute?: boolean };

export function copyMemory(p: MemoryPattern): MemoryPattern {
  return p.kind === 'trace' ? { ...p, path: p.path.map(q => ({ ...q })) } : { ...p };
}
export function replayMemory(p: MemoryPattern, phase: number): MemoryPattern {
  const q = copyMemory(p);
  if (q.kind === 'hand' && phase >= 1) { q.a += q.sweep; q.sweep *= -1; }
  return q;
}
export function memoryDuration(p: MemoryPattern): number {
  return p.kind === 'shutter' ? 0.18 : p.duration + (p.kind === 'trace' ? (p.copies - 1) * 0.6 : 0);
}

function tracePoint(p: Extract<MemoryPattern, { kind: 'trace' }>, elapsed: number): TracePoint {
  const f = clamp(1 - elapsed / p.duration, 0, 1) * (p.path.length - 1);
  const i = Math.floor(f), j = Math.min(i + 1, p.path.length - 1), a = p.path[i], b = p.path[j];
  // A discontinuity stays a jump in both directions, including when the timeline runs backwards.
  if (b.cut) return f - i < 0.5 ? a : b;
  return { x: a.x + (b.x - a.x) * (f - i), y: a.y + (b.y - a.y) * (f - i),
    z: a.z + (b.z - a.z) * (f - i), frame: a.frame };
}

/** Test the actual swept interval, rather than making the entire preview path hurt at once. */
export function memoryTouches(p: MemoryPattern, x: number, y: number, r: number, from: number, to: number): boolean {
  if (p.kind === 'shutter') return dist(p.x, p.y, x, y) > p.r;
  const samples = Math.max(1, Math.ceil(Math.abs(to - from) / 0.015));
  if (p.kind === 'hand') {
    for (let i = 0; i <= samples; i++) {
      const a = p.a + p.sweep * clamp((from + (to - from) * i / samples) / p.duration, 0, 1);
      if (segDist(x, y, p.x, p.y, p.x + Math.cos(a) * p.r, p.y + Math.sin(a) * p.r) <= (p.hw ?? 5) + r) return true;
    }
    return false;
  }
  for (let copy = 0; copy < p.copies; copy++) {
    const start = from - copy * 0.6, end = to - copy * 0.6;
    if (end < 0 || start > p.duration) continue;
    let previous = tracePoint(p, clamp(start, 0, p.duration));
    for (let i = 0; i <= samples; i++) {
      const q = tracePoint(p, clamp(start + (end - start) * i / samples, 0, p.duration));
      // A recorded blink has no collision along the skipped segment.
      const d = dist(previous.x, previous.y, q.x, q.y);
      if ((d > 40 ? dist(q.x, q.y, x, y) : segDist(x, y, previous.x, previous.y, q.x, q.y)) <= 10 + r) return true;
      previous = q;
    }
  }
  return false;
}

function clock(g: Gfx, x: number, y: number, r: number, progress: number, color: number, alpha = 0.7): void {
  g.ring(x, y, r, 1, color, alpha, 'top');
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6 - Math.PI / 2;
    const c = i / 12 < progress ? P.white : color;
    g.line(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4), x + Math.cos(a) * r, y + Math.sin(a) * r, 1, c, alpha, 'top');
  }
}

export function drawMemory(g: Gfx, p: MemoryPattern, color: number, quiet = false, elapsed = -1): void {
  if (p.kind === 'trace') {
    for (let i = 1; i < p.path.length; i++) {
      const a = p.path[i - 1], b = p.path[i];
      if (!b.cut) g.line(a.x, a.y, b.x, b.y, 1, color, quiet ? 0.28 : 0.65, 'top');
      if (i % 4 === 0) g.ring(b.x, b.y, 2, 1, color, 0.6, 'top');
    }
    if (quiet) return;
    const last = p.path[p.path.length - 1];
    if (elapsed < 0) {
      for (let i = 0; i < p.path.length; i += 7) {
        const q = p.path[i];
        g.img('pc_echo', q.frame, q.x, q.y + 4 - q.z, { layer: 'top', tint: color, alpha: 0.22 });
      }
      clock(g, last.x, last.y, 18, 0, color, 0.6);
    } else for (let i = 0; i < p.copies; i++) {
      const t = elapsed - i * 0.6;
      if (t < 0 || t > p.duration) continue;
      const q = tracePoint(p, t);
      g.circle(q.x, q.y, 10, color, 0.15, 'floor');
      g.ring(q.x, q.y, 14, 1, color, 0.9, 'top');
      g.img('pc_echo', q.frame, q.x, q.y + 4 - q.z, { layer: 'top', tint: color, alpha: 0.8 });
      g.circle(q.x, q.y - 9, 13, color, 0.15, 'light');
    }
  } else if (p.kind === 'shutter') {
    if (!quiet) {
      // Conservative horizontal strips leave a true circular hole without a full-screen render texture.
      const b = ARCHIVE_LAYOUT.bounds, left = b.x, right = b.x + b.w, bottom = b.y + b.h;
      for (let y = b.y; y < bottom; y += 12) {
        const h = Math.min(12, bottom - y), closest = clamp(p.y, y, y + h), dy = Math.abs(closest - p.y);
        const half = dy < p.r ? Math.sqrt(p.r * p.r - dy * dy) : 0;
        const x0 = clamp(p.x - half, left, right), x1 = clamp(p.x + half, left, right);
        g.rect(left, y, x0 - left, h, color, elapsed < 0 ? 0.1 : 0.55, 'floor');
        g.rect(x1, y, right - x1, h, color, elapsed < 0 ? 0.1 : 0.55, 'floor');
      }
      g.circle(p.x, p.y, p.r, P.cyan, 0.12, 'floor');
      g.img('pc_echo', 'down_idle', p.x, p.y + 4, { layer: 'top', tint: P.ice, alpha: 0.25 });
      g.crisp(T.returnSpot, p.x, p.y - 6, { color: P.ice, layer: 'top', align: 'center' });
    }
    g.ring(p.x, p.y, p.r, 2, quiet ? color : P.ice, quiet ? 0.35 : 0.9, 'top');
  } else {
    const start = Math.min(p.a, p.a + p.sweep), end = Math.max(p.a, p.a + p.sweep);
    if (!quiet && elapsed < 0) g.sector(p.x, p.y, p.r + 9, start, end, color, 0.1, 'floor');
    clock(g, p.x, p.y, p.r + 9, elapsed < 0 ? 0 : elapsed / p.duration, color, quiet ? 0.25 : 0.55);
    for (let i = 0; i <= 8; i++) {
      const a = p.a + p.sweep * i / 8;
      g.line(p.x + Math.cos(a) * (p.r - 4), p.y + Math.sin(a) * (p.r - 4),
        p.x + Math.cos(a) * (p.r + 7), p.y + Math.sin(a) * (p.r + 7), 2, color, quiet ? 0.2 : 0.65, 'top');
    }
    const a = p.a + (elapsed < 0 ? 0 : p.sweep * clamp(elapsed / p.duration, 0, 1));
    const x = p.x + Math.cos(a) * p.r, y = p.y + Math.sin(a) * p.r;
    g.line(p.x, p.y, x, y, elapsed < 0 || quiet ? 1 : (p.hw ?? 5) * 2, color, quiet ? 0.25 : 0.8, 'top');
    if (p.minute && !quiet) g.ring(x, y, 4, 1, P.white, 0.8, 'top');
    if (!quiet) {
      g.line(p.x, p.y, x, y, elapsed < 0 ? 1 : 2, P.white, 0.8, 'top');
      g.circle(p.x, p.y, 7, P.amber, 0.85, 'top');
      // Chevrons show time direction, including a replay that reverses the sweep.
      const tipA = p.a + p.sweep * 0.5, sign = Math.sign(p.sweep), rr = p.r + 5;
      const tx = p.x + Math.cos(tipA) * rr, ty = p.y + Math.sin(tipA) * rr;
      const dx = -Math.sin(tipA) * sign, dy = Math.cos(tipA) * sign;
      g.line(tx - dx * 7 + dy * 4, ty - dy * 7 - dx * 4, tx, ty, 2, color, 0.9, 'top');
      g.line(tx - dx * 7 - dy * 4, ty - dy * 7 + dx * 4, tx, ty, 2, color, 0.9, 'top');
    }
  }
}

export interface MemoryHost {
  pauseT: number;
  readonly time: { readonly rates: { boss: number } };
  cutMemory(w: World, pattern: MemoryPattern): void;
}

/** One original attack or delayed replay; both use identical hit geometry and cleanup. */
export class MemoryCast {
  dead = false;
  completed = false;
  elapsed = 0;
  private started = false;
  /** True once the attack has left its warning (a sealed replay must not be mid-swing). */
  get begun(): boolean { return this.started; }
  private playerHit = false;
  private hitIds = new Set<number>();
  private cable: Cable | null = null;
  private readonly initialWait: number;
  constructor(readonly st: MemoryHost, readonly pattern: MemoryPattern, public remaining: number,
    readonly friendly = false, readonly replay = false) { this.initialWait = remaining; }

  cancel(): void {
    this.dead = true;
    if (this.cable) this.cable.dead = true;
    this.cable = null;
  }
  threatens(x: number, y: number, r = 4, lookahead = 0.25): boolean {
    if (this.dead || this.friendly || this.st.pauseT > 0) return false;
    const ahead = lookahead * this.st.time.rates.boss;
    if (this.remaining > ahead) return false;
    const from = this.started ? this.elapsed : 0;
    return memoryTouches(this.pattern, x, y, r, from, Math.min(memoryDuration(this.pattern), from + ahead));
  }

  update(w: World, dt: number): void {
    if (w.state !== 'fight' || w.boss?.dying || !this.friendly && (w.boss?.staggered || w.boss?.inTransition)) { this.cancel(); return; }
    if (!this.friendly && this.st.pauseT > 0) return;
    let step = dt * (this.friendly ? 1 : w.bossRate * (w.boss && w.boss.jamT > 0 ? JAM_SLOW : 1));
    if (this.remaining > 0) {
      this.remaining -= step;
      if (this.remaining > 0) return;
      step = -this.remaining; this.remaining = 0;
    }
    const p = this.pattern;
    if (!this.started) {
      this.started = true;
      w.sfx(p.kind === 'shutter' ? 'emp' : p.kind === 'trace' ? 'recall' : 'lever', 0.7);
      if (p.kind === 'hand' && !this.friendly) {
        this.cable = { x1: p.x, y1: p.y, x2: p.x + Math.cos(p.a) * p.r, y2: p.y + Math.sin(p.a) * p.r,
          onCut: () => { if (!this.dead) { this.cancel(); this.st.cutMemory(w, p); } } };
        w.cables.push(this.cable);
      }
    }
    const previous = this.elapsed;
    this.elapsed = Math.min(memoryDuration(p), this.elapsed + step);
    if (this.cable && p.kind === 'hand') {
      const a = p.a + p.sweep * this.elapsed / p.duration;
      this.cable.x2 = p.x + Math.cos(a) * p.r; this.cable.y2 = p.y + Math.sin(a) * p.r;
    }
    if (this.friendly) {
      for (const b of w.bodies) {
        if (b.dead || b.team !== 'enemy' || this.hitIds.has(b.id) || !memoryTouches(p, b.x, b.y - 4, b.r, previous, this.elapsed)) continue;
        const dealt = w.damage(b, { dmg: 220, kind: 'shock', x: b.hx, y: b.hy, from: 'env', src: 'memory_replay', poise: 65 });
        if (dealt > 0) this.hitIds.add(b.id);
      }
    } else if (!this.playerHit && memoryTouches(p, w.player.x, w.player.y - 4, 4, previous, this.elapsed)) {
      const hit = w.hitPlayer(1, { x: p.x, y: p.y, low: p.kind !== 'shutter', kind: p.kind === 'trace' ? 'impact' : 'beam' });
      if (hit !== 'ignored') this.playerHit = true;
    }
    if (this.elapsed >= memoryDuration(p)) { this.completed = true; this.cancel(); }
  }

  drawTop(g: Gfx): void {
    if (this.dead) return;
    const paused = !this.friendly && this.st.pauseT > 0;
    const rate = this.st.time.rates.boss;
    const color = this.friendly ? P.cyan : paused ? P.ice : this.replay && this.remaining / rate > 0.9 ? P.cyan : P.red;
    drawMemory(g, this.pattern, color, false, this.started ? this.elapsed : -1);
    if (!this.started) {
      const p = this.pattern;
      const title = p.kind === 'trace' ? T.trace : p.kind === 'hand' ? (p.minute ? T.minute : T.hand) : T.shutter;
      const y = p.kind === 'shutter' ? p.y + p.r + 8 : p.kind === 'hand' ? p.y - (p.minute ? 38 : 24) : p.path[p.path.length - 1].y + 22;
      const x = p.kind === 'trace' ? p.path[p.path.length - 1].x : p.x;
      g.crisp(`${this.replay ? T.replay + ' ' : ''}${title} ${Math.max(0, this.remaining / (this.friendly ? 1 : rate)).toFixed(1)}`, clamp(x, 110, 530), clamp(y, 72, 322),
        { color, align: 'center', layer: 'top' });
      if (p.kind === 'shutter') clock(g, p.x, p.y, p.r + 8, 1 - this.remaining / this.initialWait, color);
    }
  }
}
