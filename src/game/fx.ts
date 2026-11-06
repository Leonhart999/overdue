/** Visual effects state: particles, damage numbers, labels, afterimages, screen shake/flash. */
import type { Gfx, ImgOpts } from '../engine/gfx';
import { P } from '../engine/gfx';
import { Rng } from '../engine/math';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  c: number; size: number;
  grav: number; drag: number;
  /** 0 square, 1 streak, 2 smoke puff, 3 ring, 4 glow */
  kind: 0 | 1 | 2 | 3 | 4;
  r0?: number; r1?: number; w?: number;
}

interface Num { key: number; x: number; y: number; v: number; t: number; c: number; big: boolean }
interface Label { x: number; y: number; text: string; t: number; dur: number; c: number }
interface Ghost { key: string; frame: string | number; x: number; y: number; o: ImgOpts; t: number; dur: number }

export class Fx {
  private parts: Particle[] = [];
  private nums: Num[] = [];
  private labels: Label[] = [];
  private ghosts: Ghost[] = [];
  private rng = new Rng(99);
  shakeAmt = 0;
  private shakeT = 0;
  flashC = 0;
  flashA = 0;
  private flashT = 0;
  private flashDur = 0;
  showNumbers = true;

  get count(): number { return this.parts.length; }

  private add(p: Particle): void {
    if (this.parts.length > 900) this.parts.shift();
    this.parts.push(p);
  }

  /** Square particles flying outward. */
  burst(x: number, y: number, n: number, c: number, speed = 80, life = 0.4, size = 2, grav = 0, angle?: number, spread = Math.PI * 2): void {
    for (let i = 0; i < n; i++) {
      const a = angle === undefined ? this.rng.next() * Math.PI * 2 : angle + (this.rng.next() - 0.5) * spread;
      const s = speed * (0.4 + this.rng.next() * 0.8);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + this.rng.next() * 0.6), max: life, c, size, grav, drag: 3, kind: 0 });
    }
  }

  /** Fast streak sparks. */
  sparks(x: number, y: number, n: number, c: number, speed = 120, angle?: number, spread = Math.PI * 2): void {
    for (let i = 0; i < n; i++) {
      const a = angle === undefined ? this.rng.next() * Math.PI * 2 : angle + (this.rng.next() - 0.5) * spread;
      const s = speed * (0.5 + this.rng.next());
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.12 + this.rng.next() * 0.15, max: 0.25, c, size: 1, grav: 0, drag: 6, kind: 1 });
    }
  }

  smoke(x: number, y: number, n: number, c = P.slate, size = 4, rise = 20): void {
    for (let i = 0; i < n; i++) {
      this.add({
        x: x + (this.rng.next() - 0.5) * 6, y: y + (this.rng.next() - 0.5) * 4,
        vx: (this.rng.next() - 0.5) * 20, vy: -rise * (0.5 + this.rng.next()),
        life: 0.5 + this.rng.next() * 0.5, max: 1, c, size: size * (0.7 + this.rng.next() * 0.6), grav: 0, drag: 1.5, kind: 2,
      });
    }
  }

  flame(x: number, y: number): void {
    const c = this.rng.pick([P.orange, P.sodium, P.amber, P.red]);
    this.add({ x, y, vx: (this.rng.next() - 0.5) * 10, vy: -30 - this.rng.next() * 30, life: 0.35, max: 0.35, c, size: 2 + this.rng.int(0, 2), grav: 0, drag: 1, kind: 0 });
  }

  ring(x: number, y: number, r0: number, r1: number, c: number, dur = 0.3, w = 2): void {
    this.add({ x, y, vx: 0, vy: 0, life: dur, max: dur, c, size: 0, grav: 0, drag: 0, kind: 3, r0, r1, w });
  }

  glow(x: number, y: number, r: number, c: number, dur = 0.2): void {
    this.add({ x, y, vx: 0, vy: 0, life: dur, max: dur, c, size: r, grav: 0, drag: 0, kind: 4 });
  }

  debris(x: number, y: number, n: number, colors: number[], speed = 140): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (this.rng.next() - 0.5) * 2.6;
      const s = speed * (0.4 + this.rng.next() * 0.8);
      this.add({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + this.rng.next() * 0.4, max: 1, c: this.rng.pick(colors), size: 2 + this.rng.int(0, 1), grav: 380, drag: 0.8, kind: 0 });
    }
  }

  explosion(x: number, y: number, r: number): void {
    this.ring(x, y, r * 0.3, r * 1.1, P.amber, 0.25, 3);
    this.glow(x, y, r * 1.4, P.orange, 0.35);
    this.burst(x, y, 26, P.sodium, r * 3, 0.35, 3);
    this.burst(x, y, 14, P.orange, r * 2, 0.5, 4);
    this.smoke(x, y - 6, 10, P.slate, 6, 25);
    this.debris(x, y, 8, [P.rust, P.umber, P.slate]);
  }

  /** Damage number; hits with the same key within 0.25s are merged. */
  number(key: number, x: number, y: number, v: number, c: number = P.white, big = false): void {
    if (!this.showNumbers || v <= 0) return;
    const ex = this.nums.find((n) => n.key === key && n.t < 0.25);
    if (ex) { ex.v += v; ex.t = Math.min(ex.t, 0.1); ex.big = ex.big || big; return; }
    this.nums.push({ key, x: x + (this.rng.next() - 0.5) * 10, y, v, t: 0, c, big });
  }

  /** On-screen part of the map (World keeps it in sync with the camera). */
  view = { x: 0, y: 0, w: 640, h: 360 };

  label(x: number, y: number, text: string, c: number = P.amber, dur = 0.9): void {
    // stack labels that would overlap a fresh one at the same spot; keep them on screen, below the HUD
    const v = this.view;
    const top = v.y + 72;
    let yy = Math.min(Math.max(y, top), v.y + v.h - 8);
    x = Math.max(v.x + 40, Math.min(v.x + v.w - 40, x));
    // stack upward, or downward when that would run into the HUD
    const dir = yy - 4 * 13 < top ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      if (!this.labels.some((l) => l.t < 0.5 && Math.abs(l.x - x) < 40 && Math.abs(l.y - yy) < 12)) break;
      yy += dir * 13;
    }
    this.labels.push({ x, y: yy, text, t: 0, dur, c });
  }

  ghost(key: string, frame: string | number, x: number, y: number, o: ImgOpts, dur = 0.25): void {
    this.ghosts.push({ key, frame, x, y, o, t: 0, dur });
  }

  /** Screen-shake setting (0 = off). */
  shakeScale = 1;

  shake(px: number, dur = 0.15): void {
    px *= this.shakeScale;
    if (px <= 0) return;
    if (px >= this.shakeAmt * (this.shakeT > 0 ? 1 : 0)) { this.shakeAmt = px; this.shakeT = dur; }
  }

  flash(c: number, a: number, dur = 0.12): void {
    this.flashC = c; this.flashA = a; this.flashT = dur; this.flashDur = dur;
  }

  /** Current shake offset. */
  shakeOffset(): [number, number] {
    if (this.shakeT <= 0) return [0, 0];
    const a = this.shakeAmt;
    return [Math.round((this.rng.next() - 0.5) * 2 * a), Math.round((this.rng.next() - 0.5) * 2 * a)];
  }

  update(dt: number): void {
    if (this.shakeT > 0) { this.shakeT -= dt; if (this.shakeT <= 0) this.shakeAmt = 0; }
    if (this.flashT > 0) this.flashT -= dt;
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.grav * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const n of this.nums) { n.t += dt; n.y -= 22 * dt * Math.max(0, 1 - n.t * 1.2); }
    this.nums = this.nums.filter((n) => n.t < 0.75);
    for (const l of this.labels) l.t += dt;
    this.labels = this.labels.filter((l) => l.t < l.dur);
    for (const g of this.ghosts) g.t += dt;
    this.ghosts = this.ghosts.filter((g) => g.t < g.dur);
  }

  draw(g: Gfx): void {
    for (const gh of this.ghosts) {
      const a = (1 - gh.t / gh.dur) * (gh.o.alpha ?? 0.6);
      g.img(gh.key, gh.frame, gh.x, gh.y, { ...gh.o, alpha: a, depth: gh.y - 0.5 });
    }
    for (const p of this.parts) {
      const f = Math.max(0, p.life / p.max);
      switch (p.kind) {
        case 0: g.rect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size, p.c, Math.min(1, f * 2), 'top'); break;
        case 1: g.line(p.x, p.y, p.x - p.vx * 0.03, p.y - p.vy * 0.03, 1, p.c, Math.min(1, f * 3), 'top'); break;
        case 2: g.circle(p.x, p.y, p.size * (1.6 - f * 0.6), p.c, 0.45 * f, 'top'); break;
        case 3: {
          const t = 1 - f;
          g.ring(p.x, p.y, (p.r0 ?? 0) + ((p.r1 ?? 10) - (p.r0 ?? 0)) * t, Math.max(1, (p.w ?? 2) * f), p.c, f, 'top');
          break;
        }
        case 4: g.circle(p.x, p.y, p.size, p.c, 0.5 * f, 'light'); break;
      }
    }
    for (const n of this.nums) {
      const a = n.t > 0.5 ? 1 - (n.t - 0.5) / 0.25 : 1;
      g.text(String(Math.round(n.v)), n.x, n.y - 12, { color: n.c, align: 'center', alpha: a, layer: 'top', overDark: true });
    }
    for (const l of this.labels) {
      const a = l.t > l.dur - 0.25 ? (l.dur - l.t) / 0.25 : 1;
      g.text(l.text, l.x, l.y - 16 - l.t * 10, { color: l.c, align: 'center', alpha: a, layer: 'top', overDark: true });
    }
  }

  drawFlash(g: Gfx, w: number, h: number): void {
    if (this.flashT > 0) g.rect(0, 0, w, h, this.flashC, this.flashA * (this.flashT / this.flashDur), 'ui');
  }
}
