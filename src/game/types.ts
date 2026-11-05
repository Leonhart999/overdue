/** Shared gameplay types. */
import { angleDiff, closestOnSegment, clamp } from '../engine/math';

export type Team = 'player' | 'enemy' | 'neutral';
export type DmgKind = 'bullet' | 'melee' | 'blast' | 'shock' | 'fire' | 'crush' | 'beam' | 'impact';

/** One instance of damage. Everything that hurts a body goes through this. */
export interface Hit {
  dmg: number;
  kind: DmgKind;
  /** Impact point (screen space). */
  x: number;
  y: number;
  /** Travel direction (unit vector) — used for armour sides and knockback. */
  dx?: number;
  dy?: number;
  poise?: number;
  /** Armour plates removed (Gearjaw P1 etc.). */
  armorBreak?: number;
  from: 'player' | 'enemy' | 'env';
  /** Source id: 'nail' | 'rip' | 'pellet' | 'slug' | 'arc' | 'overload' | 'blade' | 'iaido' | 'deflect' | 'barrel' | 'crane' ... */
  src?: string;
  /** Impulse applied to movable bodies. */
  knock?: number;
  /** Sets flammable bodies alight / cauterises stumps. */
  ignite?: boolean;
  /** No damage number, no flash (damage over time). */
  quiet?: boolean;
  /** Id of the projectile, so multi-part bosses can count a piercing shot once. */
  srcId?: number;
}

export type Shape =
  | { k: 'circle'; x: number; y: number; r: number }
  | { k: 'ring'; x: number; y: number; r: number; w: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; w: number }
  | { k: 'sector'; x: number; y: number; r: number; a: number; span: number; inner?: number };

/** Does a circle (px, py, pr) overlap the shape? */
export function shapeHits(s: Shape, px: number, py: number, pr = 0): boolean {
  switch (s.k) {
    case 'circle': return (px - s.x) ** 2 + (py - s.y) ** 2 <= (s.r + pr) ** 2;
    case 'ring': {
      const d = Math.hypot(px - s.x, py - s.y);
      return d <= s.r + s.w / 2 + pr && d >= s.r - s.w / 2 - pr;
    }
    case 'rect': {
      const cx = clamp(px, s.x, s.x + s.w), cy = clamp(py, s.y, s.y + s.h);
      return (px - cx) ** 2 + (py - cy) ** 2 <= pr * pr;
    }
    case 'line': {
      const c = closestOnSegment(px, py, s.x1, s.y1, s.x2, s.y2);
      return Math.hypot(px - c.x, py - c.y) <= s.w / 2 + pr;
    }
    case 'sector': {
      const d = Math.hypot(px - s.x, py - s.y);
      if (d > s.r + pr || d < (s.inner ?? 0) - pr) return false;
      if (d < pr) return true;
      const a = Math.atan2(py - s.y, px - s.x);
      return Math.abs(angleDiff(s.a, a)) <= s.span / 2 + Math.asin(Math.min(1, pr / Math.max(d, 1e-3)));
    }
  }
}

export interface Cable {
  x1: number; y1: number; x2: number; y2: number;
  dead?: boolean;
  onCut(): void;
}
