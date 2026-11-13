/** Stop-watch: a telegraphed ring that stops the player's body inside it, then strikes the stopped spot. */
import { P, type Gfx } from '../../engine/gfx';
import { clamp, dist } from '../../engine/math';
import { JAM_SLOW } from '../boss';
import type { World } from '../world';
import { KAIRO_TEXT as T } from '../../data/text';
import type { Player } from '../player';

interface StopHost { pauseT: number; time: { rates: { boss: number } } }

/** Real (unscaled) seconds the caught player stays stopped; the strike lands just before release. */
export const STOP_FREEZE = 0.7;
const STRIKE_AT = 0.6;
const STRIKE_R = 18;

export class ArchiveStop {
  dead = false;
  /** Boss-clock seconds of warning left. */
  remaining: number;
  private readonly warn: number;
  /** Real seconds since the ring closed (-1 = still warning). */
  private since = -1;
  private caught = false;
  private heldPlayer: Player | null = null;
  private heldMove: Player['forced'] = null;
  private struck = false;
  private fx = 0;
  private fy = 0;

  constructor(readonly host: StopHost, readonly x: number, readonly y: number, readonly r: number, warn: number) {
    // Like every archive warning, keep at least 0.7 unscaled seconds when the boss clock runs fast.
    this.remaining = this.warn = Math.max(warn, host.time.rates.boss * 0.7);
  }

  get warning(): boolean { return this.since < 0; }
  /** The ring closed with the player inside and stopped them. */
  get caughtPlayer(): boolean { return this.caught || this.struck; }
  /** Real seconds until the ring closes (for the autopilot and the countdown text). */
  realLeft(w: World): number { return this.remaining / Math.max(0.1, w.bossRate * (w.boss && w.boss.jamT > 0 ? JAM_SLOW : 1)); }
  contains(x: number, y: number, margin = 0): boolean { return dist(this.x, this.y, x, y) <= this.r + margin; }
  cancel(): void {
    this.release();
    this.dead = true;
  }

  update(w: World, dt: number): void {
    if (this.dead) return;
    const boss = w.boss;
    if (w.state !== 'fight' || !boss || boss.dying || boss.staggered || boss.inTransition) { this.cancel(); return; }
    if (this.warning) {
      if (this.host.pauseT > 0) return;
      this.remaining -= dt * w.bossRate * (boss.jamT > 0 ? JAM_SLOW : 1);
      if (this.remaining > 0) return;
      this.close(w);
      return;
    }
    // The stopped interval is measured in real scene time so a slow field never lengthens it.
    this.since += dt;
    const p = w.player;
    if (this.caught && !this.struck) {
      p.x = this.fx; p.y = this.fy; p.vx = p.vy = 0;
      if (this.since >= STRIKE_AT) {
        this.struck = true;
        w.hitPlayer(1, { x: this.fx, y: this.fy, kind: 'beam' });
        w.fx.ring(this.fx, this.fy - 6, 4, STRIKE_R + 10, P.red, 0.25, 2); w.sfx('slash', 0.8, 0.8);
        w.fx.shake(2, 0.1);
      }
    }
    if (this.since >= (this.caught ? STOP_FREEZE : 0.35)) { this.cancel(); }
  }

  private close(w: World): void {
    this.since = 0;
    const p = w.player;
    w.sfx('click', 0.9, 0.7); w.fx.ring(this.x, this.y, this.r, this.r + 8, P.ice, 0.25, 2);
    if (!this.contains(p.x, p.y - 4, 3)) return;
    if (p.iframes > 0) {
      // Dashing through the closing ring is a dodge, and counts as a perfect one inside the usual window.
      if (!p.perfectUsed && w.realTime - p.dashStart <= 0.22) p.perfectDodge(w);
      return;
    }
    if (p.invuln > 0 || p.hp <= 0) return;
    this.caught = true; this.fx = p.x; this.fy = p.y;
    // A held player cannot answer anything else: shots already in flight nearby are wiped.
    w.clearBullets(p.x, p.y - 9, 160, false);
    // forced movement with zero velocity: no walking, dashing, firing or arm use while stopped
    this.heldPlayer = p;
    this.heldMove = p.forced = { vx: 0, vy: 0, t: STOP_FREEZE * w.playerRate, iframes: false, solids: true };
    w.fx.label(p.x, p.y - 28, T.frozen, P.ice, 0.7);
  }

  private release(): void {
    if (this.heldPlayer && this.heldPlayer.forced === this.heldMove) this.heldPlayer.forced = null;
    this.heldPlayer = null; this.heldMove = null; this.caught = false;
  }

  drawTop(g: Gfx, w: World): void {
    if (this.dead) return;
    if (this.warning) {
      const p = clamp(1 - this.remaining / this.warn, 0, 1), paused = this.host.pauseT > 0;
      const color = paused ? P.ice : P.red;
      g.circle(this.x, this.y, this.r, color, 0.08 + 0.12 * p, 'floor');
      g.ring(this.x, this.y, this.r, 2, color, 0.85, 'top');
      // The inner face fills clockwise: when it is full, the ring stops whoever stands inside.
      g.sector(this.x, this.y, this.r - 3, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, p * Math.PI * 2), P.ice, 0.18, 'floor');
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6 - Math.PI / 2, c = i / 12 < p ? P.white : color;
        g.line(this.x + Math.cos(a) * (this.r - 6), this.y + Math.sin(a) * (this.r - 6),
          this.x + Math.cos(a) * this.r, this.y + Math.sin(a) * this.r, 1, c, 0.9, 'top');
      }
      const a = p * Math.PI * 2 - Math.PI / 2;
      g.line(this.x, this.y, this.x + Math.cos(a) * (this.r - 8), this.y + Math.sin(a) * (this.r - 8), 2, P.white, 0.9, 'top');
      g.crisp(`${T.stop} ${this.realLeft(w).toFixed(1)}`, clamp(this.x, 60, 580), this.y - this.r - 14, { color, align: 'center', layer: 'top' });
    } else if (this.caught && !this.struck) {
      const p = clamp(this.since / STRIKE_AT, 0, 1);
      g.ring(this.fx, this.fy - 6, STRIKE_R + (1 - p) * 20, 2, P.red, 0.9, 'top');
      g.circle(this.fx, this.fy - 6, STRIKE_R, P.red, 0.15 + 0.25 * p, 'floor');
      g.ring(this.fx, this.fy - 13, 12, 1, P.ice, 0.8, 'top');
      g.line(this.fx, this.fy - 13, this.fx, this.fy - 22, 1, P.ice, 0.9, 'top');
    } else {
      g.ring(this.x, this.y, this.r, 1, P.ice, 0.5, 'top');
    }
  }
}
