/** Small math helpers shared by the whole game. Pure, no Phaser. */

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sign = (v: number) => (v < 0 ? -1 : 1);
export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const dist2 = (ax: number, ay: number, bx: number, by: number) => (bx - ax) ** 2 + (by - ay) ** 2;
export const angleTo = (ax: number, ay: number, bx: number, by: number) => Math.atan2(by - ay, bx - ax);

/** Smallest signed difference b - a in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Rotate angle `a` toward `b` by at most `step` radians. */
export function turnToward(a: number, b: number, step: number): number {
  const d = angleDiff(a, b);
  return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

export function norm(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  return l > 1e-6 ? [x / l, y / l] : [0, 0];
}

export interface Rect { x: number; y: number; w: number; h: number }

export function pointInRect(px: number, py: number, r: Rect): boolean {
  return px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;
}

/** Closest point on segment a-b to p, plus the parameter t in [0, 1]. */
export function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { x: number; y: number; t: number } {
  const vx = bx - ax, vy = by - ay;
  const l2 = vx * vx + vy * vy || 1e-9;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / l2, 0, 1);
  return { x: ax + vx * t, y: ay + vy * t, t };
}

export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const c = closestOnSegment(px, py, ax, ay, bx, by);
  return Math.hypot(px - c.x, py - c.y);
}

/** Do segments p1-p2 and p3-p4 intersect? */
export function segmentsCross(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Ray vs axis-aligned rect (slab method). Returns distance along the unit direction
 * (dx, dy) to the first hit, or Infinity.
 */
export function rayRect(ox: number, oy: number, dx: number, dy: number, r: Rect): number {
  let tmin = -Infinity, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < r.x || ox > r.x + r.w) return Infinity;
  } else {
    const t1 = (r.x - ox) / dx, t2 = (r.x + r.w - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < r.y || oy > r.y + r.h) return Infinity;
  } else {
    const t1 = (r.y - oy) / dy, t2 = (r.y + r.h - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < Math.max(0, tmin)) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

/** Ray vs circle. Returns distance to entry point or Infinity. */
export function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Seeded RNG (mulberry32) with helpers. */
export class Rng {
  private a: number;
  constructor(seed: number) { this.a = seed >>> 0; }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number { return lo + (hi - lo) * this.next(); }
  int(lo: number, hiInclusive: number): number { return lo + Math.floor(this.next() * (hiInclusive - lo + 1)); }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Weighted pick from [item, weight] pairs; weights <= 0 are skipped. */
  weighted<T>(items: [T, number][]): T {
    let total = 0;
    for (const [, w] of items) if (w > 0) total += w;
    let r = this.next() * total;
    for (const [it, w] of items) {
      if (w <= 0) continue;
      r -= w;
      if (r <= 0) return it;
    }
    return items[items.length - 1][0];
  }
}
