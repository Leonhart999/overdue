/** Haste-only pursuit: simultaneous clock-hand cuts, answered one beat at a time. */
import { KAIRO_TEXT as T } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { clamp, segDist, type Rect } from '../../engine/math';
import { JAM_SLOW } from '../boss';
import type { World } from '../world';
import { HASTE_RATE } from './archiveTime';

type Lane = { x1: number; y1: number; x2: number; y2: number };
interface RushHost {
  pauseT: number;
  time: { mode: string; remaining: number };
}
const HALF_WIDTH = 30;
const LOCK_TIME = 0.12;
const ACTIVE_TIME = 0.045;

export class ArchiveRush {
  dead = false;
  private beat = 0;
  private elapsed = 0;
  private locked = false;
  private lockAtReal = Infinity;
  private struck = false;
  private answered = false;
  private precise = false;
  private x = 320;
  private y = 198;
  private lanes: Lane[] = [];
  private readonly first: number;
  private readonly follow: number;
  private readonly finish: number;
  readonly count: number;
  recovering = false;

  constructor(readonly host: RushHost, readonly phase: number, pace: number) {
    // Constants are real scene durations at haste speed; jam and global bullet time can extend them.
    this.first = Math.max(0.85, pace);
    this.follow = Math.max(0.48, (0.62 - 0.04 * phase) * pace);
    this.finish = Math.max(0.78, 0.88 * pace);
    let count = 5 + phase;
    const budget = host.time.remaining - 0.1;
    while (count > 1 && this.first + (count - 2) * this.follow + this.finish + ACTIVE_TIME + 1 > budget) count--;
    this.count = count;
  }

  get label(): string { return this.dead || this.recovering ? '' : `${T.rush} ${this.beat + 1}/${this.count}`; }
  private get warning(): number { return this.beat === 0 ? this.first : this.beat === this.count - 1 ? this.finish - ACTIVE_TIME : this.follow - ACTIVE_TIME; }
  private get active(): boolean { return this.struck && !this.recovering; }
  cancel(): void { this.dead = true; this.lanes = []; }

  private track(w: World): void {
    const b = w.bounds;
    this.x = clamp(w.player.x, b.x + 8, b.x + b.w - 8);
    this.y = clamp(w.player.y - 4, b.y + 4, b.y + b.h - 4);
    this.lanes = [];
    const cuts = this.beat === this.count - 1 ? 3 : 2;
    const angle = -Math.PI / 4 + this.beat * Math.PI / 6;
    for (let i = 0; i < cuts; i++) this.lanes.push(this.lane(b, angle + i * Math.PI / cuts));
  }

  private lane(b: Rect, angle: number): Lane {
    const endpoint = (sign: number): [number, number] => {
      const dx = Math.cos(angle) * sign, dy = Math.sin(angle) * sign;
      const tx = Math.abs(dx) < 1e-6 ? Infinity : ((dx > 0 ? b.x + b.w - 5 : b.x + 5) - this.x) / dx;
      const ty = Math.abs(dy) < 1e-6 ? Infinity : ((dy > 0 ? b.y + b.h - 3 : b.y + 3) - this.y) / dy;
      const t = Math.max(0, Math.min(tx, ty));
      return [this.x + dx * t, this.y + dy * t];
    };
    const [x1, y1] = endpoint(-1), [x2, y2] = endpoint(1);
    return { x1, y1, x2, y2 };
  }

  /** Only the committed last instant asks the autopilot for a precision dodge. */
  imminent(w: World): boolean {
    if (this.dead || this.recovering || this.host.pauseT > 0 || !this.locked || this.answered) return false;
    const rate = w.bossRate / HASTE_RATE * (w.boss?.jamT ? JAM_SLOW : 1);
    return this.warning - this.elapsed <= 0.09 * rate && this.touches(w.player.x, w.player.y - 4);
  }

  private touches(x: number, y: number): boolean {
    return this.lanes.some(l => segDist(x, y, l.x1, l.y1, l.x2, l.y2) <= HALF_WIDTH + 4);
  }

  private resolve(w: World): void {
    if (this.answered) return;
    const p = w.player;
    // A last-instant blink can leave both lanes outright. It still evades the attack that
    // committed to this player, and must earn the same cooldown refund as an i-frame contact.
    const escapedLate = this.locked && p.iframes > 0 && !p.perfectUsed
      && p.dashStart >= this.lockAtReal && w.realTime - p.dashStart <= 0.22;
    if (!this.touches(p.x, p.y - 4) && !escapedLate) return;
    const before = w.stats.perfectDodges;
    // The simultaneous cuts share one hit result: never two hearts or two refunds on one beat.
    const result = w.hitPlayer(1, { x: this.x, y: this.y, kind: 'beam' });
    if (result !== 'ignored') this.answered = true;
    this.precise = w.stats.perfectDodges > before;
  }

  update(w: World, dt: number): void {
    if (w.state !== 'fight' || !w.boss || w.boss.dying || w.boss.staggered || w.boss.inTransition || this.host.time.mode !== 'haste') {
      this.cancel(); return;
    }
    if (this.host.pauseT > 0) return;
    this.elapsed += dt * w.bossRate / HASTE_RATE * (w.boss.jamT > 0 ? JAM_SLOW : 1);
    if (this.recovering) {
      if (this.elapsed >= 1) this.cancel();
      return;
    }
    if (!this.locked) {
      this.track(w);
      if (this.elapsed >= this.warning - LOCK_TIME) {
        this.locked = true; this.lockAtReal = w.realTime;
        w.sfx('click', 0.7, 1.1 + this.beat * 0.06);
      }
    }
    if (this.elapsed < this.warning) return;
    if (!this.struck) {
      this.struck = true; w.sfx('slash', 0.8, 1.15 + this.beat * 0.05);
      w.fx.ring(this.x, this.y, 3, 28, P.amber, 0.18, 2);
      w.fx.shake(this.beat === this.count - 1 ? 3 : 1, 0.07);
    }
    this.resolve(w);
    if (this.elapsed < this.warning + ACTIVE_TIME) return;
    this.elapsed -= this.warning + ACTIVE_TIME;
    if (++this.beat >= this.count) {
      this.recovering = true; this.lanes = []; this.elapsed = 0;
    } else {
      this.locked = this.struck = this.answered = this.precise = false;
      this.lockAtReal = Infinity;
      this.track(w);
      w.sfx('charge', 0.35, 1.2);
    }
  }

  drawTop(g: Gfx): void {
    if (this.dead || this.recovering) return;
    const active = this.active, color = this.precise ? P.cyan : active ? P.red : this.locked ? P.white : P.amber;
    const progress = clamp(this.elapsed / this.warning, 0, 1);
    for (const l of this.lanes) {
      const a = Math.atan2(l.y2 - l.y1, l.x2 - l.x1), nx = -Math.sin(a) * HALF_WIDTH, ny = Math.cos(a) * HALF_WIDTH;
      g.line(l.x1, l.y1, l.x2, l.y2, HALF_WIDTH * 2, active ? P.red : P.amber, active ? 0.55 : this.locked ? 0.22 : 0.08, 'floor');
      g.line(l.x1 + nx, l.y1 + ny, l.x2 + nx, l.y2 + ny, 1, color, active ? 0.9 : 0.45, 'top');
      g.line(l.x1 - nx, l.y1 - ny, l.x2 - nx, l.y2 - ny, 1, color, active ? 0.9 : 0.45, 'top');
      g.line(l.x1, l.y1, l.x2, l.y2, active ? 4 : 1, color, this.locked || active ? 0.95 : 0.4, 'top');
      for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
        g.img(this.phase >= 1 ? 'kairo_broken' : 'kairo', 'attack', x, y + 20,
          { layer: 'top', tint: active ? P.white : P.amber, alpha: active ? 0.85 : this.locked ? 0.65 : 0.22,
            flipX: x > this.x });
        g.ring(x, y, 10, 1, color, 0.7, 'top');
      }
    }
    // The moving dial contracts, then turns white and stays still for the committed beat.
    g.ring(this.x, this.y, this.locked ? 15 : 15 + 23 * (1 - progress), this.locked ? 2 : 1, color, 0.9, 'top');
    g.line(this.x, this.y, this.x, this.y - 12, 2, color, 0.9, 'top');
    const a = progress * Math.PI * 2 - Math.PI / 2;
    g.line(this.x, this.y, this.x + Math.cos(a) * 10, this.y + Math.sin(a) * 10, 1, color, 0.9, 'top');
  }
}
