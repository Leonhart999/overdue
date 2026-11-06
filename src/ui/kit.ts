/**
 * UI kit drawing helpers on the Gfx interface (HUD, hub overlays, pause, and the menu scenes,
 * which draw through a PhaserGfx too). See docs/UI_STYLE.md for the rules.
 *
 * Grid: positions and sizes are integers, spacing on 4/8 px. Every helper takes a `layer`
 * (default 'ui'); overlays drawn above the HUD use 'over'. Within a layer shapes sit below
 * images and crisp text, so anything that must cover an icon uses `pxRect` (an image).
 */
import { P, type CrispOpts, type Gfx, type Layer } from '../engine/gfx';
import type { Slot, WeaponId } from '../game/loadout';
import { textWidth } from './crispText';

export const KEY_H = 11;
export const MOUSE_W = 10;
export const LINE_H = 14;

/** Slot colours (same code as the icons). */
export const SLOT_COL: Record<Slot, number> = { legs: P.cyan, arm: P.amber, core: P.magenta, head: P.acid };
/** Weapon colours (same code as the mod icons). */
export const WEAPON_COL: Record<WeaponId, number> = { riveter: P.amber, arc: P.cyan, breacher: P.orange, blade: P.ice };

type L = { layer?: Layer };

// ------------------------------------------------------------------ primitives

/** Exact-colour rect drawn as an image, so it layers above icons and crisp text. */
export function pxRect(g: Gfx, x: number, y: number, w: number, h: number, color: number, alpha = 1, layer: Layer = 'ui'): void {
  if (w <= 0 || h <= 0) return;
  g.img('uik_px', 'px', x, y, { layer, ox: 0, oy: 0, sx: w, sy: h, fill: color, alpha });
}

/** Full-screen ink dim behind an overlay. */
export function dim(g: Gfx, alpha = 0.75, layer: Layer = 'over'): void {
  g.rect(0, 0, 640, 360, P.ink, alpha, layer);
}

/** Crisp body text (12 px). */
export function txt(g: Gfx, str: string, x: number, y: number, o: CrispOpts = {}): void {
  g.crisp(str, x, y, { layer: 'ui', color: P.pale, ...o });
}

/** Small letter-spaced EN tag in the micro font. */
export function tagText(g: Gfx, str: string, x: number, y: number, o: CrispOpts = {}): void {
  g.crisp(str, x, y, { layer: 'ui', color: P.fog, font: 'micro', spacing: 1, ...o });
}

export function tagWidth(str: string, spacing = 1): number { return textWidth(str, { font: 'micro', spacing }); }

/** Crisp heading at x2 with an ink drop shadow. */
export function heading(g: Gfx, str: string, x: number, y: number, o: CrispOpts = {}): void {
  g.crisp(str, x, y, { layer: 'ui', color: P.white, shadow: P.ink, scale: 2, ...o });
}

/** Line-break by measured pixel width; closing punctuation never starts a line. */
export function wrapPx(str: string, maxPx: number): string[] {
  const noStart = '，。、；：！？）》」』%…,.;:!?)';
  const out: string[] = [];
  for (const para of str.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (line && textWidth(line + ch) > maxPx) {
        if (noStart.includes(ch)) {
          // carry the last character down with the punctuation
          const chars = [...line];
          const last = chars.pop()!;
          out.push(chars.join('').trimEnd());
          line = last + ch;
        } else {
          out.push(line.trimEnd());
          line = ch === ' ' ? '' : ch;
        }
        continue;
      }
      line += ch;
    }
    out.push(line);
  }
  return out;
}

/** Wrapped body text; returns the number of lines drawn. Overflowing lines end with '…'. */
export function para(g: Gfx, str: string, x: number, y: number, maxPx: number, o: CrispOpts & { lineH?: number; maxLines?: number } = {}): number {
  let lines = wrapPx(str, maxPx);
  if (o.maxLines && lines.length > o.maxLines) {
    lines = lines.slice(0, o.maxLines);
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = (textWidth(last + '…') > maxPx ? last.slice(0, -1) : last) + '…';
  }
  const lh = o.lineH ?? LINE_H;
  lines.forEach((l, i) => txt(g, l, x, y + i * lh, o));
  return lines.length;
}

// ------------------------------------------------------------------ panels

export interface PanelOpts extends L {
  /** Accent colour: a 2 px strip on the left edge (or under the header with accentSide 'top'). */
  accent?: number;
  accentSide?: 'left' | 'top' | 'none';
  /** Outline colour (ink by default; cyan = focused, red = danger). */
  edge?: number;
  fill?: number;
  alpha?: number;
  /** Size of the cut corners (top-left, bottom-right). */
  cut?: number;
  /** Faint scanlines on the body. */
  scan?: boolean;
  /** Bevel: 1 px slate light on top/left. */
  bevel?: boolean;
}

/** Interior spans of a cut-corner rect, one per row: [row, x0, x1) for rows y..y+h-1. */
function spans(x: number, y: number, w: number, h: number, c: number, inset: number, fn: (row: number, x0: number, x1: number) => void): void {
  for (let r = y + inset; r < y + h - inset; r++) {
    const top = r - y, bot = y + h - 1 - r;
    const x0 = x + inset + Math.max(0, c - top);
    const x1 = x + w - inset - Math.max(0, c - bot);
    if (x1 > x0) fn(r, x0, x1);
  }
}

/** Fill a cut-corner shape with merged rects. */
function fillCut(g: Gfx, x: number, y: number, w: number, h: number, c: number, inset: number, color: number, alpha: number, layer: Layer): void {
  let run: [number, number, number, number] | null = null; // y0, x0, x1, rows
  spans(x, y, w, h, c, inset, (r, x0, x1) => {
    if (run && run[1] === x0 && run[2] === x1 && run[0] + run[3] === r) { run[3]++; return; }
    if (run) g.rect(run[1], run[0], run[2] - run[1], run[3], color, alpha, layer);
    run = [r, x0, x1, 1];
  });
  const fin = run as [number, number, number, number] | null;
  if (fin) g.rect(fin[1], fin[0], fin[2] - fin[1], fin[3], color, alpha, layer);
}

/** Collects 1-row rects and merges vertical runs with the same x and width into one rect. */
class RectRuns {
  private open = new Map<string, [number, number, number, number]>(); // x, y0, w, rows
  constructor(private g: Gfx, private color: number, private alpha: number, private layer: Layer) {}
  add(x: number, r: number, w: number): void {
    if (w <= 0) return;
    const k = `${x},${w}`;
    const run = this.open.get(k);
    if (run && run[1] + run[3] === r) { run[3]++; return; }
    if (run) this.flushOne(run);
    this.open.set(k, [x, r, w, 1]);
  }
  private flushOne(run: [number, number, number, number]): void { this.g.rect(run[0], run[1], run[2], run[3], this.color, this.alpha, this.layer); }
  flush(): void { for (const run of this.open.values()) this.flushOne(run); this.open.clear(); }
}

/**
 * Cut-corner panel: 1 px outline, slate bevel on top/left, night body, faint scanlines.
 * Corners are cut at top-left and bottom-right.
 */
export function panel(g: Gfx, x: number, y: number, w: number, h: number, o: PanelOpts = {}): void {
  const layer = o.layer ?? 'ui';
  const c = o.cut ?? 4;
  const a = o.alpha ?? 0.96;
  // outline = outer shape minus the interior shape (inset 1 px, cut 1 px smaller)
  const inner = new Map<number, [number, number]>();
  spans(x + 1, y + 1, w - 2, h - 2, Math.max(0, c - 1), 0, (r, x0, x1) => inner.set(r, [x0, x1]));
  const edge = new RectRuns(g, o.edge ?? P.ink, a, layer);
  spans(x, y, w, h, c, 0, (r, x0, x1) => {
    const s = inner.get(r);
    if (!s) { edge.add(x0, r, x1 - x0); return; }
    edge.add(x0, r, s[0] - x0);
    edge.add(s[1], r, x1 - s[1]);
  });
  edge.flush();
  fillCut(g, x + 1, y + 1, w - 2, h - 2, Math.max(0, c - 1), 0, o.fill ?? P.night, a, layer);
  if (o.scan ?? true) {
    spans(x, y, w, h, c + 1, 2, (r, x0, x1) => { if ((r - y) % 2 === 0) g.rect(x0, r, x1 - x0, 1, P.navy, 0.35 * a, layer); });
  }
  if (o.bevel ?? true) {
    g.rect(x + c, y + 1, w - c - 1, 1, P.slate, a, layer);
    g.rect(x + 1, y + c, 1, h - c - 1, P.slate, a, layer);
    for (let t = 2; t < c; t++) g.rect(x + 1 + c - t, y + t, 1, 1, P.slate, a, layer);
  }
  const side = o.accentSide ?? 'left';
  if (o.accent !== undefined && side === 'left') g.rect(x + 1, y + c + 1, 2, h - c - 2, o.accent, 1, layer);
}

/** Fill the top `h` rows of a panel's interior (follows the cut corner), e.g. a coloured card band. */
export function band(g: Gfx, x: number, y: number, w: number, h: number, color: number, o: L & { cut?: number; alpha?: number } = {}): void {
  const c = Math.max(0, (o.cut ?? 4) - 1);
  const runs = new RectRuns(g, color, o.alpha ?? 1, o.layer ?? 'ui');
  for (let t = 0; t < h; t++) {
    const x0 = x + 1 + Math.max(0, c - t);
    runs.add(x0, y + 1 + t, x + w - 1 - x0);
  }
  runs.flush();
}

/**
 * Header strip at the top of a panel: crisp x2 title on the left, a micro EN tag and a barcode
 * in the accent colour on the right, a navy rule with an accent segment under the title.
 * Returns the strip height.
 */
export function header(g: Gfx, x: number, y: number, w: number, title: string, tag: string, accent: number, o: L & { serial?: string; sub?: string; subColor?: number } = {}): number {
  const layer = o.layer ?? 'ui';
  const H = 34;
  heading(g, title, x + 12, y + 7, { layer });
  const tw = tagWidth(tag);
  const rx = x + w - 12;
  tagText(g, tag, rx - tw, y + 9, { layer, color: accent });
  barcode(g, rx - Math.max(tw, 40), y + 17, Math.max(tw, 40), 6, accent, tag.length * 7 + w, layer);
  if (o.serial) tagText(g, o.serial, rx - tw - 8 - tagWidth(o.serial), y + 9, { layer, color: P.slate });
  if (o.sub) txt(g, o.sub, x + 12 + textWidth(title, { scale: 2 }) + 10, y + 13, { layer, color: o.subColor ?? P.fog });
  g.rect(x + 6, y + H - 1, w - 12, 1, P.navy, 1, layer);
  g.rect(x + 6, y + H - 1, textWidth(title, { scale: 2 }) + 12, 1, accent, 1, layer);
  return H;
}

/** 6x6 L-shaped corner brackets just outside a rect. */
export function brackets(g: Gfx, x: number, y: number, w: number, h: number, color: number, o: L & { len?: number; out?: number; alpha?: number } = {}): void {
  const layer = o.layer ?? 'ui', n = o.len ?? 6, d = o.out ?? 2, a = o.alpha ?? 1;
  const x0 = x - d, y0 = y - d, x1 = x + w + d - 1, y1 = y + h + d - 1;
  for (const [cx, cy, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
    g.rect(sx > 0 ? cx : cx - n + 1, cy, n, 1, color, a, layer);
    g.rect(cx, sy > 0 ? cy : cy - n + 1, 1, n, color, a, layer);
  }
}

/** Focused list row: navy fill, 2 px accent bar on the left, a chevron. */
export function focusRow(g: Gfx, x: number, y: number, w: number, h: number, accent: number, layer: Layer = 'ui'): void {
  g.rect(x, y, w, h, P.navy, 1, layer);
  g.rect(x, y, 2, h, accent, 1, layer);
  g.crisp('▶', x + 6, y + Math.floor((h - 5) / 2), { layer, font: 'micro', color: accent });
}

/** Inset socket for an icon: dark well, light lower/right lip. */
export function socket(g: Gfx, x: number, y: number, w: number, h: number, o: L & { edge?: number; fill?: number } = {}): void {
  const layer = o.layer ?? 'ui';
  g.rect(x, y, w, h, P.ink, 1, layer);
  g.rect(x + 1, y + 1, w - 2, h - 2, o.fill ?? P.night, 1, layer);
  g.rect(x + 1, y + h - 2, w - 2, 1, P.navy, 1, layer);
  g.rect(x + w - 2, y + 1, 1, h - 2, P.navy, 1, layer);
  if (o.edge !== undefined) g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1, 1, o.edge, 1, layer);
}

/** Flat filled tag with micro text; returns its width. */
export function chip(g: Gfx, str: string, x: number, y: number, o: L & { fill?: number; color?: number; align?: 'left' | 'center' | 'right'; image?: boolean } = {}): number {
  const layer = o.layer ?? 'ui';
  const w = tagWidth(str) + 6, h = 9;
  const lx = o.align === 'center' ? x - Math.floor(w / 2) : o.align === 'right' ? x - w : x;
  const r = o.image ? (a: number, b: number, c: number, d: number, col: number) => pxRect(g, a, b, c, d, col, 1, layer)
    : (a: number, b: number, c: number, d: number, col: number) => g.rect(a, b, c, d, col, 1, layer);
  r(lx, y, w, h, P.ink);
  r(lx + 1, y + 1, w - 2, h - 2, o.fill ?? P.navy);
  g.crisp(str, lx + 3, y + 2, { layer, font: 'micro', spacing: 1, color: o.color ?? P.pale });
  return w;
}

// ------------------------------------------------------------------ inputs

const KEY_NAMES: Record<string, string> = { ' ': 'SPACE', Space: 'SPACE', '空格': 'SPACE', Esc: 'ESC', Escape: 'ESC', Enter: 'ENTER' };

export function keyLabel(key: string): string { return (KEY_NAMES[key] ?? key).toUpperCase(); }

export function keyWidth(key: string): number { return Math.max(KEY_H, tagWidth(keyLabel(key), 0) + 6); }

/**
 * Key cap (11 px tall): ink outline with rounded corners, slate cap, fog top highlight, navy
 * lip, white micro legend. `image` draws it with image rects (to sit above icons). Returns width.
 */
export function keycap(g: Gfx, key: string, x: number, y: number, o: L & { alpha?: number; lit?: number; image?: boolean } = {}): number {
  const layer = o.layer ?? 'ui', a = o.alpha ?? 1;
  const label = keyLabel(key);
  const w = keyWidth(key), h = KEY_H;
  const r = o.image ? (a1: number, b: number, c: number, d: number, col: number) => pxRect(g, a1, b, c, d, col, a, layer)
    : (a1: number, b: number, c: number, d: number, col: number) => g.rect(a1, b, c, d, col, a, layer);
  r(x + 1, y, w - 2, h, P.ink);
  r(x, y + 1, w, h - 2, P.ink);
  r(x + 1, y + 1, w - 2, h - 3, o.lit ?? P.slate);
  r(x + 2, y + 1, w - 4, 1, o.lit !== undefined ? P.white : P.fog);
  r(x + 1, y + h - 2, w - 2, 1, P.navy);
  g.crisp(label, x + Math.floor((w - tagWidth(label, 0)) / 2), y + 3, { layer, font: 'micro', color: o.lit !== undefined ? P.ink : P.white, alpha: a });
  return w;
}

/** Mouse icon (10x14) with the left/right button lit; returns its width. */
export function mouseIcon(g: Gfx, btn: 'n' | 'l' | 'r', x: number, y: number, o: L & { amber?: boolean; alpha?: number } = {}): number {
  const f = btn === 'n' ? 'mouse_n' : `mouse_${btn}${o.amber ? 'a' : ''}`;
  g.img('uik_m', f, x, y, { layer: o.layer ?? 'ui', ox: 0, oy: 0, alpha: o.alpha });
  return MOUSE_W - 1;
}

/** One input hint: key caps / mouse icons followed by a label. */
export interface Hint { keys: string[]; label: string }

/** Key tokens: 'mouse', 'mouseL', 'mouseR' draw mouse icons, anything else a key cap. */
function hintKeysWidth(keys: string[]): number {
  return keys.reduce((s, k, i) => s + (k.startsWith('mouse') ? MOUSE_W - 1 : keyWidth(k)) + (i ? 2 : 0), 0);
}

export function hintsWidth(items: Hint[], gap = 12): number {
  return items.reduce((s, it, i) => s + hintKeysWidth(it.keys) + (it.keys.length ? 4 : 0) + textWidth(it.label) + (i ? gap : 0), 0);
}

/**
 * A row of input hints, `y` = top of the 12 px text box. Key caps sit at y+1, mouse icons at y-1.
 * Returns the row width.
 */
export function hints(g: Gfx, items: Hint[], x: number, y: number, o: L & { align?: 'left' | 'center' | 'right'; color?: number; dimColor?: number; gap?: number; alpha?: number } = {}): number {
  const layer = o.layer ?? 'ui', gap = o.gap ?? 12;
  const total = hintsWidth(items, gap);
  let cx = Math.round(o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x);
  for (const it of items) {
    it.keys.forEach((k, i) => {
      if (i) cx += 2;
      if (k.startsWith('mouse')) cx += mouseIcon(g, k === 'mouseL' ? 'l' : k === 'mouseR' ? 'r' : 'n', cx, y - 1, { layer, alpha: o.alpha });
      else cx += keycap(g, k, cx, y + 1, { layer, alpha: o.alpha });
    });
    if (it.keys.length) cx += 4;
    txt(g, it.label, cx, y, { layer, color: it.keys.length ? o.color ?? P.fog : o.dimColor ?? P.steel, alpha: o.alpha });
    cx += textWidth(it.label) + gap;
  }
  return total;
}

/** Turn a controls line like 'WASD 移动   鼠标 瞄准   左键 攻击' into hints. */
export function parseControls(str: string): Hint[] {
  const map: Record<string, string> = { '鼠标': 'mouse', '左键': 'mouseL', '右键': 'mouseR', '空格': 'SPACE' };
  return str.split(/\s{2,}/).filter(Boolean).map((part) => {
    const [k, ...rest] = part.trim().split(/\s+/);
    return { keys: [map[k] ?? k], label: rest.join(' ') };
  });
}

/** Bottom-of-screen hint strip on a plate. */
export function hintStrip(g: Gfx, items: Hint[], y: number, o: L & { accent?: number; alpha?: number } = {}): void {
  const layer = o.layer ?? 'ui';
  const w = hintsWidth(items) + 24;
  const x = Math.round(320 - w / 2);
  panel(g, x, y, w, 18, { layer, alpha: o.alpha ?? 0.9, accent: o.accent, cut: 3, scan: false });
  hints(g, items, 320, y + 3, { layer, align: 'center', alpha: 1 });
}

// ------------------------------------------------------------------ bars and decorations

export interface BarOpts extends L {
  fill: number;
  hi?: number;
  track?: number;
  /** Tick marks at these fractions. */
  ticks?: number[];
  tickColor?: number;
  /** Chip-away trail up to this fraction (drawn white). */
  chip?: number;
  /** Segment ticks every this many pixels. */
  seg?: number;
  alpha?: number;
}

/** Bar with a 1 px ink frame (outside), track, fill with a 1 px highlight line on top. */
export function bar(g: Gfx, x: number, y: number, w: number, h: number, frac: number, o: BarOpts): void {
  const layer = o.layer ?? 'ui', a = o.alpha ?? 1;
  const f = Math.max(0, Math.min(1, frac));
  g.rect(x - 1, y - 1, w + 2, h + 2, P.ink, 1, layer);
  g.rect(x, y, w, h, o.track ?? P.navy, 1, layer);
  const fw = Math.round(w * f);
  if (o.chip !== undefined && o.chip > f) {
    const cw = Math.round(w * Math.min(1, o.chip));
    g.rect(x + fw, y, cw - fw, h, P.white, 0.9, layer);
  }
  if (fw > 0) {
    g.rect(x, y, fw, h, o.fill, a, layer);
    if (h > 2) g.rect(x, y, fw, 1, o.hi ?? P.white, 0.55 * a, layer);
  }
  if (o.seg) for (let sx = x + o.seg; sx < x + w; sx += o.seg) g.rect(sx, y + h - 2, 1, 2, P.ink, 0.6, layer);
  for (const t of o.ticks ?? []) g.rect(x + Math.round(w * t), y - 1, 1, h + 2, o.tickColor ?? P.white, 0.85, layer);
}

export function cellsWidth(n: number, cw = 8): number { return n * (cw + 2) - 2; }

/** Segmented level meter (n cells, `on` lit). Returns its width. */
export function cells(g: Gfx, x: number, y: number, n: number, on: number, color: number, o: L & { w?: number; h?: number } = {}): number {
  const layer = o.layer ?? 'ui', cw = o.w ?? 8, ch = o.h ?? 7;
  for (let i = 0; i < n; i++) {
    const cx = x + i * (cw + 2);
    g.rect(cx, y, cw, ch, P.ink, 1, layer);
    g.rect(cx + 1, y + 1, cw - 2, ch - 2, i < on ? color : P.navy, 1, layer);
    if (i < on) g.rect(cx + 1, y + 1, cw - 2, 1, P.white, 0.5, layer);
  }
  return n * (cw + 2) - 2;
}

/** Deterministic barcode decoration. */
export function barcode(g: Gfx, x: number, y: number, w: number, h: number, color: number, seed: number, layer: Layer = 'ui', alpha = 0.8): void {
  let s = (seed * 9301 + 49297) % 233280;
  let cx = x;
  while (cx < x + w) {
    s = (s * 9301 + 49297) % 233280;
    const bw = 1 + (s % 3 === 0 ? 1 : 0);
    if (cx + bw > x + w) break;
    g.rect(cx, y, bw, h, color, alpha, layer);
    s = (s * 9301 + 49297) % 233280;
    cx += bw + 1 + (s % 2);
  }
}

/** Dotted leader between two x positions (1 px dots every 2 px). */
export function dots(g: Gfx, x0: number, x1: number, y: number, color: number = P.slate, layer: Layer = 'ui'): void {
  for (let x = x0 + ((x0 & 1) ? 1 : 0); x < x1; x += 2) g.rect(x, y, 1, 1, color, 1, layer);
}

/** Perforated edge: 3 px teeth in `color` cut into a sheet ('top' = hanging down from y, 'bottom' = rising to y+3). */
export function perforation(g: Gfx, x: number, y: number, w: number, color: number, dir: 'top' | 'bottom', layer: Layer = 'ui'): void {
  const hs = [3, 2, 1, 1, 2, 3];
  for (let d = 0; d < 3; d++) {
    const ry = dir === 'top' ? y + d : y + 2 - d;
    let start = -1;
    for (let i = 0; i <= w; i++) {
      const on = i < w && hs[i % 6] > d;
      if (on && start < 0) start = i;
      if (!on && start >= 0) { g.rect(x + start, ry, i - start, 1, color, 1, layer); start = -1; }
    }
  }
}

/** Rubber stamp centred on (cx, cy). */
export function stamp(g: Gfx, str: string, cx: number, cy: number, o: L & { color: number; angle?: number; glyph?: number; alpha?: number; scale?: number; seed?: number }): void {
  g.crisp(str, cx, cy, { layer: o.layer ?? 'ui', color: o.color, alpha: o.alpha, scale: o.scale, stamp: { angle: o.angle ?? -8, glyph: o.glyph ?? 2, seed: o.seed ?? 3 } });
}
