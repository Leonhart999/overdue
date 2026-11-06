/**
 * Immediate-mode drawing interface used by all gameplay code.
 *
 * Gameplay objects never touch Phaser: every frame they call these methods from `draw()`.
 * The Phaser implementation (gfxPhaser.ts) pools images/texts and clears its shape layers each
 * frame. A NullGfx lets the simulation run headless (tests, bots).
 *
 * Layers (back to front):
 *   floor  decals, telegraphs, zones (shapes + images)
 *   world  y-sorted sprites (images only). `depth` defaults to the y passed in.
 *   top    bullets, beams, particles, overhead objects
 *   light  additive glows
 *   ui     screen-space overlay (HUD draws here)
 */
import { PALETTE } from '../art/palette';

export type Layer = 'floor' | 'world' | 'top' | 'light' | 'ui';

export interface ImgOpts {
  layer?: Layer;
  /** Sort key inside the world layer (defaults to y). */
  depth?: number;
  ox?: number; // origin 0..1, default 0.5
  oy?: number; // origin 0..1, default 1 (feet)
  flipX?: boolean;
  flipY?: boolean;
  rot?: number;
  scale?: number;
  sx?: number;
  sy?: number;
  alpha?: number;
  /** Multiply tint (0xRRGGBB). */
  tint?: number;
  /** Fill the sprite with a flat colour (hit flash). */
  fill?: number;
  add?: boolean;
}

export interface TextOpts {
  layer?: Layer;
  color?: number;
  align?: 'left' | 'center' | 'right';
  alpha?: number;
  scale?: number;
  stroke?: boolean;
  /** World text drawn above blackout darkness (labels, damage numbers). */
  overDark?: boolean;
}

export interface Gfx {
  img(key: string, frame: string | number, x: number, y: number, o?: ImgOpts): void;
  text(str: string, x: number, y: number, o?: TextOpts): void;
  /** Shapes are not available on the 'world' layer (they would ignore y-sorting). */
  circle(x: number, y: number, r: number, color: number, alpha?: number, layer?: Layer): void;
  ring(x: number, y: number, r: number, width: number, color: number, alpha?: number, layer?: Layer): void;
  ellipse(x: number, y: number, rx: number, ry: number, color: number, alpha?: number, layer?: Layer): void;
  rect(x: number, y: number, w: number, h: number, color: number, alpha?: number, layer?: Layer): void;
  strokeRect(x: number, y: number, w: number, h: number, width: number, color: number, alpha?: number, layer?: Layer): void;
  line(x1: number, y1: number, x2: number, y2: number, width: number, color: number, alpha?: number, layer?: Layer): void;
  poly(pts: number[], color: number, alpha?: number, layer?: Layer): void;
  /** Filled circular sector from angle a0 to a1 (radians, a1 > a0), optional inner radius. */
  sector(x: number, y: number, r: number, a0: number, a1: number, color: number, alpha?: number, layer?: Layer, inner?: number): void;
  /** Full-screen darkness with circular holes (blackouts). alpha 0 = off. */
  darkness(alpha: number, holes: { x: number; y: number; r: number }[]): void;
  /** While on, floor/world images are drawn as glyph art (hacked look). Shapes, text and other layers are unchanged. */
  glyphs(on: boolean): void;
}

/** Palette colours as 0xRRGGBB numbers, by palette name. */
export const P = Object.fromEntries(PALETTE.map((p) => [p.name, parseInt(p.hex.slice(1), 16)])) as Record<
  'ink' | 'night' | 'navy' | 'indigo' | 'slate' | 'steel' | 'fog' | 'pale' | 'white' | 'plum' | 'grape' | 'orchid' |
  'magenta' | 'rose' | 'abyss' | 'teal' | 'cyan' | 'ice' | 'moss' | 'lime' | 'acid' | 'maroon' | 'red' | 'umber' |
  'rust' | 'orange' | 'sodium' | 'amber' | 'skinL' | 'skinM' | 'skinD' | 'skinX', number>;

/** Semantic colours. Keep the meaning consistent everywhere. */
export const COL = {
  danger: P.red,
  dangerLight: P.rose,
  soft: P.orange,
  softAlt: P.magenta,
  hard: P.red,
  player: P.cyan,
  interact: P.amber,
  shock: P.ice,
  fire: P.sodium,
};

export class NullGfx implements Gfx {
  img(): void {}
  text(): void {}
  circle(): void {}
  ring(): void {}
  ellipse(): void {}
  rect(): void {}
  strokeRect(): void {}
  line(): void {}
  poly(): void {}
  sector(): void {}
  darkness(): void {}
  glyphs(): void {}
}
