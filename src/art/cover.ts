/**
 * Cover / key art layers (palette indices only, drawn in code).
 *   cover_sky        640x360  night sky with smog, mirrored below the horizon for reflections
 *   cover_far        640x200  distant skyline (bottom edge on the horizon, y = 92..292)
 *   cover_mid        640x170  mid skyline with lit windows and small neon icons (y = 122..292)
 *   cover_near       640x360  framing buildings at the left/right edges
 *   cover_street     640x68   wet street; puddles and wet sheen are transparent so reflections show
 *   cover_refl       640x68   mirrored skyline + bosses, drawn under the street
 *   cover_echo       40x68    Echo seen from behind, backlit (cyan left rim, magenta right rim)
 *   cover_gearjaw    96x96    Gearjaw silhouette (stripped, glowing engine), sodium rim
 *   cover_lux        40x56    Madame Lux as a pink hologram (drawn with ADD blend)
 *   cover_octo       80x110   three Octohydra heads on necks, acid rim
 *   cover_sign       30x62    vertical neon sign boxes: pink, cyan
 *   cover_glow       32x32    soft white glow with stepped alpha (tinted at runtime, ADD blend)
 *   cover_grit       128x64   speckle mask used to wear the debt stamp
 *
 * Positions shared with the scene (beacons, neon icons) live in COVER_LAYOUT.
 */
import { buildBossFrames } from './actors/gearjaw';
import { buildLuxArt } from './lux';
import { buildOctohydraArt } from './octohydra';
import { C, PALETTE_RGB, RAMP } from './palette';
import { Mask, PixBuf, shadeInto, type Pt } from './core/pixbuf';
import { bayer, hash2, mulberry32 } from './core/rng';
import type { SheetSpec } from './core/sheet';

export const COVER_W = 640;
export const COVER_H = 360;
export const HORIZON = 292;
export const FAR_Y = 92;
export const MID_Y = 122;

export interface NeonSpot { x: number; y: number; color: number; r: number }

/** Scene-space positions of lights baked into the layers (the scene adds glows there). */
export const COVER_LAYOUT = {
  /** Red aircraft beacons on antenna tips (blink in the animated version). */
  beacons: [[178, 118], [404, 160], [610, 176], [440, 150], [24, 132]] as Pt[],
  /** Neon icons on the mid skyline. */
  midNeon: [] as NeonSpot[],
  /** Boss silhouettes: top-left corner and integer scale. */
  gearjaw: { x: 196, y: 70, s: 3 },
  /** Frame coordinates of Gearjaw's lights: engine grill, eye, exhaust tips. */
  gearjawLights: { engine: [47, 47] as Pt, eye: [55, 16] as Pt, stacks: [[31, 12], [37, 15]] as Pt[] },
  octo: { x: 452, y: 82, s: 3 },
  /** Frame coordinates of the Octohydra eyes (cover_octo). */
  octoEyes: [] as Pt[],
  /** Vertical neon signs on the near buildings (top-left corners) and their bracket rows. */
  signs: [[34, 150], [578, 196]] as Pt[],
  signBrackets: [[156, 204], [202, 250]],
};

// ------------------------------------------------------------------ helpers
const LUM = PALETTE_RGB.map(([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255);

function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, seed: number): number {
  return vnoise(x, y, seed) * 0.55 + vnoise(x * 2.1, y * 2.1, seed + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, seed + 2) * 0.15;
}

/** Pick from a dark -> light band list with ordered dithering between neighbours. */
function band(x: number, y: number, t: number, bands: readonly number[]): number {
  const f = Math.max(0, Math.min(0.999, t)) * (bands.length - 1);
  const i = Math.floor(f);
  return bayer(x, y) < (f - i) * 16 ? bands[Math.min(bands.length - 1, i + 1)] : bands[i];
}

const opaque = (b: PixBuf, x: number, y: number) => b.get(x, y) !== 0;

/**
 * Rim light: pixels on the left/right silhouette edge get the rim colours
 * (index 0 = outermost pixel, index 1 = one pixel in). Pixels for which `keep` is true are untouched.
 */
function rimLight(b: PixBuf, left: number[], right: number[], top?: number, keep: (x: number, y: number) => boolean = () => false): void {
  const src = b.clone();
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (!opaque(src, x, y) || keep(x, y)) continue;
      let c = 0;
      if (top !== undefined && !opaque(src, x, y - 1)) c = top;
      if (!opaque(src, x + 1, y)) c = right[0];
      else if (right[1] && !opaque(src, x + 2, y)) c = right[1];
      if (!opaque(src, x - 1, y)) c = left[0];
      else if (left[1] && !opaque(src, x - 2, y)) c = left[1];
      if (c) b.set(x, y, c);
    }
  }
}

/** Darken a sprite into a night silhouette: luminance -> dark ramp, keeping emissive pixels. */
function silhouette(src: PixBuf, ramp: readonly number[], keep: (c: number, x: number, y: number) => boolean): { buf: PixBuf; kept: (x: number, y: number) => boolean } {
  const b = new PixBuf(src.w, src.h);
  const keptMask = new Uint8Array(src.w * src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (!c) continue;
      if (keep(c, x, y)) { b.set(x, y, c); keptMask[y * src.w + x] = 1; continue; }
      const t = Math.min(0.999, LUM[c] * 1.25);
      b.set(x, y, ramp[Math.floor(t * ramp.length)]);
    }
  }
  return { buf: b, kept: (x, y) => keptMask[y * src.w + x] === 1 };
}

function frameOf(specs: SheetSpec[], key: string, name: string): PixBuf {
  const s = specs.find((q) => q.key === key);
  const f = s?.frames.find((q) => q.name === name);
  if (!f) throw new Error(`[art] cover: missing ${key}/${name}`);
  return f.buf;
}

// ------------------------------------------------------------------ sky
function sky(): PixBuf {
  const b = new PixBuf(COVER_W, COVER_H);
  const bands = [C.ink, C.night, C.plum, C.grape, C.orchid];
  for (let y = 0; y < COVER_H; y++) {
    // below the horizon: mirrored (reflected sky), squashed
    const yy = y <= HORIZON ? y : HORIZON - (y - HORIZON) * 2.2;
    const h = Math.max(0, yy / HORIZON);
    for (let x = 0; x < COVER_W; x++) {
      let t = h ** 2.1 * 0.82;
      const dx = (x - 330) / 300;
      t += 0.22 * Math.exp(-dx * dx * 2.5) * h ** 3;
      // smog bands, lit from below by the city
      const n = fbm(x / 110, yy / 18, 7);
      if (n > 0.5) t += (n - 0.5) * 0.85 * (0.25 + h * 0.75);
      const n2 = fbm(x / 60 + 9, yy / 9, 11);
      if (n2 > 0.62 && h < 0.55) t += 0.12;
      if (y > HORIZON) t *= 0.9;
      b.set(x, y, band(x, y, t, bands));
    }
  }
  return b;
}

// ------------------------------------------------------------------ far skyline
function far(): PixBuf {
  const W = COVER_W, H = 200;
  const b = new PixBuf(W, H);
  const rng = mulberry32(41);
  // farthest row: grape against the orchid haze
  for (let x = -10; x < W;) {
    const w = 6 + Math.floor(rng() * 16);
    const top = 120 + Math.floor(rng() * 60);
    b.rect(x, top, w, H - top, C.grape);
    if (rng() < 0.3) b.rect(x + Math.floor(w / 2) - 1, top - 6, 3, 6, C.grape);
    for (let y = top + 3; y < H; y += 3) for (let i = x + 1; i < x + w - 1; i += 2) if (hash2(i, y, 5) < 0.07) b.set(i, y, C.orchid);
    x += w + Math.floor(rng() * 3);
  }
  // far row: plum blocks, some tall towers with stepped crowns
  for (let x = -6; x < W;) {
    const w = 10 + Math.floor(rng() * 24);
    const tall = rng() < 0.18;
    const top = tall ? 40 + Math.floor(rng() * 50) : 110 + Math.floor(rng() * 70);
    b.rect(x, top, w, H - top, C.plum);
    if (tall) {
      b.rect(x + 2, top - 5, w - 4, 5, C.plum);
      b.rect(x + Math.floor(w / 2) - 1, top - 14, 2, 9, C.plum);
    }
    b.vline(x + w - 1, top, H - 1, C.grape);
    for (let y = top + 3; y < H; y += 4) {
      const lit = hash2(x, y, 9) < 0.35;
      for (let i = x + 2; i < x + w - 2; i += 3) {
        const r = hash2(i, y, 13);
        if (lit && r < 0.5) b.set(i, y, r < 0.12 ? C.amber : r < 0.3 ? C.magenta : C.orchid);
      }
    }
    x += w + Math.floor(rng() * 4);
  }
  // antenna masts for the beacons that sit on this layer
  for (const [bx, by] of COVER_LAYOUT.beacons) {
    const ly = by - FAR_Y;
    if (ly < 0 || ly >= H) continue;
    let base = ly;
    while (base < H && !b.get(bx, base)) base++;
    b.vline(bx, ly, base, C.plum);
    b.set(bx, ly, C.red);
  }
  return b;
}

// ------------------------------------------------------------------ mid skyline
interface Bld { x: number; w: number; top: number; roof?: 'tank' | 'ant' | 'ac' | 'step' }
const MID: Bld[] = [
  { x: 0, w: 64, top: 156, roof: 'ac' }, { x: 62, w: 52, top: 182, roof: 'tank' }, { x: 112, w: 40, top: 206, roof: 'ant' },
  { x: 150, w: 48, top: 228, roof: 'ac' }, { x: 196, w: 36, top: 252 }, { x: 230, w: 38, top: 264, roof: 'tank' },
  { x: 266, w: 30, top: 272 }, { x: 294, w: 58, top: 278 }, { x: 350, w: 34, top: 270, roof: 'ac' },
  { x: 382, w: 40, top: 258, roof: 'ant' }, { x: 420, w: 36, top: 250 }, { x: 454, w: 48, top: 242, roof: 'step' },
  { x: 500, w: 44, top: 230, roof: 'tank' }, { x: 542, w: 56, top: 216, roof: 'ac' }, { x: 596, w: 48, top: 196, roof: 'ant' },
];

function neonGlyph(b: PixBuf, kind: 'gear' | 'heart' | 'cross' | 'bars' | 'bowl', cx: number, cy: number, core: number, edge: number): void {
  if (kind === 'gear') {
    b.ring(cx, cy, 6, edge, 2); b.ring(cx, cy, 5.2, core, 1);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.set(Math.round(cx - 0.5 + Math.cos(a) * 7), Math.round(cy - 0.5 + Math.sin(a) * 7), core);
    }
    b.circle(cx, cy, 1.5, core);
  } else if (kind === 'heart') {
    const pts: Pt[] = [];
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * Math.PI * 2;
      pts.push([cx + 0.42 * 16 * Math.sin(t) ** 3, cy - 0.34 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
    }
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; b.line(a[0], a[1] + 1, c[0], c[1] + 1, edge); }
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; b.line(a[0], a[1], c[0], c[1], core); }
  } else if (kind === 'cross') {
    b.rect(cx - 2, cy - 6, 5, 13, edge); b.rect(cx - 6, cy - 2, 13, 5, edge);
    b.rect(cx - 1, cy - 5, 3, 11, core); b.rect(cx - 5, cy - 1, 11, 3, core);
  } else if (kind === 'bars') {
    for (let i = 0; i < 4; i++) { b.hline(cx - 10, cx + 10, cy + i * 3 + 1, edge); b.hline(cx - 10 + i * 2, cx + 10 - i * 2, cy + i * 3, core); }
  } else {
    b.hline(cx - 7, cx + 7, cy, core); b.hline(cx - 7, cx + 7, cy + 1, edge);
    for (let i = 0; i < 5; i++) { b.set(cx - 6 + i, cy + 1 + i, core); b.set(cx + 6 - i, cy + 1 + i, core); }
    b.hline(cx - 2, cx + 2, cy + 6, core);
    b.line(cx + 2, cy - 1, cx + 6, cy - 7, edge); b.line(cx + 4, cy - 1, cx + 8, cy - 6, edge);
  }
}

function mid(): PixBuf {
  const W = COVER_W, H = 170;
  const b = new PixBuf(W, H);
  const winCols = [C.sodium, C.sodium, C.amber, C.teal, C.teal, C.pale, C.rose, C.cyan];
  for (const [bi, d] of MID.entries()) {
    const top = d.top - MID_Y;
    b.rect(d.x, top, d.w, H - top, C.navy);
    // roof structures
    if (d.roof === 'tank') {
      const tx = d.x + 6 + (bi % 3) * 4;
      b.rect(tx, top - 9, 10, 7, C.navy); b.hline(tx, tx + 9, top - 10, C.indigo);
      for (let i = 0; i < 3; i++) b.vline(tx + 1 + i * 4, top - 2, top - 1, C.navy);
    } else if (d.roof === 'ant') {
      const ax = d.x + Math.floor(d.w * 0.65);
      b.vline(ax, top - 22, top, C.navy); b.vline(ax - 4, top - 10, top, C.navy);
      b.hline(ax - 2, ax + 2, top - 14, C.navy);
    } else if (d.roof === 'ac') {
      for (let i = 0; i < 3; i++) b.rect(d.x + 4 + i * 9, top - 4, 6, 4, C.navy);
    } else if (d.roof === 'step') {
      b.rect(d.x + 6, top - 8, d.w - 12, 8, C.navy); b.rect(d.x + 14, top - 14, d.w - 28, 6, C.navy);
    }
    // parapet and the edge facing the street centre
    b.hline(d.x, d.x + d.w - 1, top, C.indigo);
    const towardCentre = d.x + d.w / 2 < 320 ? d.x + d.w - 1 : d.x;
    b.vline(towardCentre, top, H - 1, C.indigo);
    // window grid
    const floorH = 5 + (bi % 2);
    for (let y = top + 4; y < H - 3; y += floorH) {
      const floorLit = hash2(bi, y, 21);
      for (let x = d.x + 3; x < d.x + d.w - 3; x += 4) {
        const r = hash2(x, y, 23);
        const lit = floorLit < 0.12 ? r < 0.9 : r < 0.24;
        if (!lit) { b.rect(x, y, 2, 2, C.night); continue; }
        const col = floorLit < 0.12 ? C.teal : winCols[Math.floor(hash2(x, y, 29) * winCols.length)];
        b.rect(x, y, 2, 2, col);
        if (col === C.sodium || col === C.teal) b.set(x, y, col === C.sodium ? C.amber : C.cyan);
      }
    }
  }
  // neon icons
  COVER_LAYOUT.midNeon = [];
  const icon = (kind: 'gear' | 'heart' | 'cross' | 'bars' | 'bowl', x: number, y: number, core: number, edge: number, color: number, r: number) => {
    b.rect(x - 9, y - 9 - MID_Y, 19, 19, C.night);
    neonGlyph(b, kind, x, y - MID_Y, core, edge);
    COVER_LAYOUT.midNeon.push({ x, y, color, r });
  };
  icon('gear', 132, 222, C.amber, C.orange, 0xffab38, 1.2);
  icon('heart', 88, 202, C.rose, C.magenta, 0xff2a8f, 1.2);
  icon('cross', 521, 252, C.acid, C.lime, 0xa8ff3c, 1.1);
  icon('bowl', 566, 236, C.ice, C.cyan, 0x2de2f5, 1.0);
  // horizontal neon trims on a few roofs
  for (const [x0, x1, y, core, edge] of [[454, 501, 248, C.ice, C.teal], [150, 197, 236, C.rose, C.magenta], [382, 421, 266, C.amber, C.orange]] as const) {
    b.hline(x0, x1, y - MID_Y, core); b.hline(x0, x1, y - MID_Y + 1, edge);
  }
  // beacons on mid antennas
  for (const [bx, by] of COVER_LAYOUT.beacons) {
    const ly = by - MID_Y;
    if (ly < 0 || ly >= H || b.get(bx, ly + 1) === 0) continue;
    b.set(bx, ly, C.red);
  }
  return b;
}

// ------------------------------------------------------------------ near buildings
function near(): PixBuf {
  const b = new PixBuf(COVER_W, COVER_H);
  const VP: Pt = [320, 268];
  const side = (fx: number, ex: number) => {
    // side wall from facade edge fx towards the vanishing point until x = ex
    const k = (ex - fx) / (VP[0] - fx);
    const yt = 0 + (VP[1] - 0) * k, yb = COVER_H + (VP[1] - COVER_H) * k;
    return { yt, yb };
  };
  for (const dir of [-1, 1] as const) {
    const fx = dir < 0 ? 26 : COVER_W - 26;           // facade edge
    const ex = dir < 0 ? 48 : COVER_W - 48;           // far edge of the side wall
    const { yt, yb } = side(fx, ex);
    const x0 = Math.min(fx, ex), x1 = Math.max(fx, ex);
    // front face
    if (dir < 0) b.rect(0, 0, fx, COVER_H, C.ink); else b.rect(fx, 0, COVER_W - fx, COVER_H, C.ink);
    // side wall
    b.poly([[fx, 0], [ex, yt], [ex, yb], [fx, COVER_H]], C.night);
    // side wall windows along perspective rows
    for (let row = 0; row < 26; row++) {
      const v = (row + 0.5) / 26;
      for (let col = 0; col < 4; col++) {
        const u = (col + 0.6) / 4.4;
        const x = Math.round(fx + (ex - fx) * u);
        const yTop = 0 + yt * u, yBot = COVER_H + (yb - COVER_H) * u;
        const y = Math.round(yTop + (yBot - yTop) * v);
        const lit = hash2(row, col + dir * 7, 31) < 0.22;
        const c = lit ? (hash2(row, col, 37) < 0.5 ? C.sodium : C.teal) : C.navy;
        b.set(x, y, c); b.set(x, y + 1, c); b.set(x + (dir < 0 ? 1 : -1), y, c);
      }
    }
    // edge highlight where the side wall meets the facade
    b.vline(fx, 0, COVER_H - 1, dir < 0 ? C.abyss : C.plum);
    b.line(ex, yt, ex, yb, C.navy);
    // pipes and fire escape on the front face
    const px = dir < 0 ? 8 : COVER_W - 9;
    b.vline(px, 0, COVER_H - 1, C.night); b.vline(px + 1, 0, COVER_H - 1, C.navy);
    for (let y = 30; y < COVER_H; y += 54) {
      const a = dir < 0 ? 0 : COVER_W - 24, w = 23;
      b.hline(a, a + w, y, C.navy); b.hline(a, a + w, y + 1, C.night);
      for (let i = a; i <= a + w; i += 3) b.vline(i, y - 7, y, C.night);
      b.hline(a, a + w, y - 8, C.navy);
    }
    // AC units hanging off the facade
    for (const y of [96, 188, 262]) {
      const a = dir < 0 ? 12 : COVER_W - 25;
      b.rect(a, y, 14, 9, C.night); b.strokeRect(a, y, 14, 9, C.navy);
      b.circle(a + 7, y + 4.5, 3, C.ink);
    }
    // sign brackets
    for (const y of COVER_LAYOUT.signBrackets[dir < 0 ? 0 : 1]) b.hline(x0, x1, y, C.slate);
  }
  // overhanging cables between the near buildings
  for (const [y0, sag, c] of [[40, 22, C.ink], [62, 16, C.night]] as const) {
    for (let x = 26; x <= COVER_W - 26; x++) {
      const t = (x - 26) / (COVER_W - 52);
      const y = Math.round(y0 + sag * 4 * t * (1 - t));
      b.set(x, y, c);
    }
  }
  return b;
}

// ------------------------------------------------------------------ street
function street(): PixBuf {
  const W = COVER_W, H = COVER_H - HORIZON;
  const b = new PixBuf(W, H);
  const cx = 320;
  // puddles in road space (u = -1..1 across the road, z = 0 far .. 1 near)
  const puddles: [number, number, number, number][] = [
    [-0.5, 0.6, 0.38, 0.16], [0.4, 0.78, 0.42, 0.14], [0.0, 0.32, 0.6, 0.12], [0.72, 0.4, 0.3, 0.1],
    [-0.82, 0.9, 0.3, 0.12], [-0.25, 0.14, 0.5, 0.08], [0.45, 0.16, 0.35, 0.07],
  ];
  for (let y = 0; y < H; y++) {
    const z = (y + 1) / H;
    const half = 52 + 250 * z;           // road half width
    const walk = 34 + 120 * z;           // sidewalk width
    for (let x = 0; x < W; x++) {
      const u = (x - cx) / half;
      const au = Math.abs(u);
      let c: number;
      if (au > 1) {
        // sidewalk tiles
        const s = (au - 1) * half / walk;
        if (s > 1.6) { c = C.ink; } else {
          const tile = (Math.floor(s * 6) + Math.floor(y / (2 + z * 6))) & 1;
          c = tile ? C.navy : C.night;
          if (au - 1 < 0.02 + 0.01 * z) c = C.slate;       // curb edge
          if (hash2(x, y, 51) < 0.15 * z) c = 0;            // wet sheen
        }
      } else {
        const grain = vnoise(x / (3 + 9 * z), y / (1 + 3 * z), 55);
        c = grain < 0.45 ? C.night : grain < 0.8 ? C.navy : C.indigo;
        // wet sheen: transparent dither, stronger near the horizon (grazing angle)
        const wet = 0.3 - 0.26 * z;
        if (bayer(x, y) < wet * 16) c = 0;
        // lane markings
        const lane = Math.abs(au - 0.5) * half;
        const dash = Math.floor((1 / (z + 0.08)) * 3) & 1;
        if (lane < 0.5 + 1.2 * z && dash) c = bayer(x, y) < 8 ? C.steel : 0;
        if (au < 0.012 + 0.006 / (z + 0.1) * 0 && dash) c = C.sodium;
      }
      for (const [pu, pz, pw, ph] of puddles) {
        const du = (u - pu) / pw, dz = (z - pz) / ph;
        const d = du * du + dz * dz + 0.25 * vnoise(x / 6, y / 2, 61);
        if (d < 1) c = 0;
        else if (d < 1.12 && c) c = C.slate;
      }
      b.set(x, y, c);
    }
  }
  // the horizon seam
  b.hline(0, W - 1, 0, 0);
  return b;
}

// ------------------------------------------------------------------ reflection
function upscale(src: PixBuf, s: number): PixBuf {
  const b = new PixBuf(src.w * s, src.h * s);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) b.px[y * b.w + x] = src.px[Math.floor(y / s) * src.w + Math.floor(x / s)];
  return b;
}

const DARKER: Record<number, number> = {
  [C.indigo]: C.navy, [C.navy]: C.night, [C.slate]: C.indigo, [C.steel]: C.slate, [C.grape]: C.plum, [C.plum]: C.night,
  [C.orange]: C.rust, [C.sodium]: C.orange, [C.rust]: C.umber, [C.amber]: C.sodium, [C.lime]: C.moss,
  [C.teal]: C.abyss, [C.pale]: C.fog, [C.fog]: C.steel,
};

/** Mirror everything above the horizon into the street band, with a slight ripple. */
function reflection(layers: { buf: PixBuf; x: number; y: number }[]): PixBuf {
  const H = COVER_H - HORIZON;
  const b = new PixBuf(COVER_W, H);
  for (let r = 0; r < H; r++) {
    const sy = HORIZON - 1 - Math.floor(r * 1.15);
    const wob = Math.round(Math.sin(r * 0.45 + 1) * (0.4 + r / 40));
    for (let x = 0; x < COVER_W; x++) {
      const sx = x + wob;
      for (const L of layers) {
        const c = L.buf.get(sx - L.x, sy - L.y);
        if (c) { b.set(x, r, DARKER[c] ?? c); break; }
      }
    }
  }
  return b;
}

// ------------------------------------------------------------------ Echo (back view, backlit)
/**
 * Rim light for a backlit figure: the outermost pixel of each row gets the bright rim,
 * inner edges (between legs, arm and body) a dim one.
 */
function backRim(b: PixBuf, left: [number, number], right: [number, number], keep: (x: number, y: number) => boolean): void {
  const src = b.clone();
  for (let y = 0; y < b.h; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < b.w; x++) if (opaque(src, x, y)) { if (first < 0) first = x; last = x; }
    if (first < 0) continue;
    for (let x = first; x <= last; x++) {
      if (!opaque(src, x, y) || keep(x, y)) continue;
      const dim = y < 12;
      if (!opaque(src, x - 1, y)) b.set(x, y, x === first && !dim ? left[0] : left[1]);
      else if (!opaque(src, x + 1, y)) b.set(x, y, x === last && !dim ? right[0] : right[1]);
    }
  }
}

function echo(): PixBuf {
  const b = new PixBuf(44, 68);
  const fill = (m: readonly number[], base: number, draw: (x: PixBuf) => void, light: Pt = [0, -1]) =>
    shadeInto(b, new Mask(b.w, b.h).draw(draw), { ramp: m, base, light, innerLine: true });
  const DARK = [C.ink, C.night, C.navy, C.indigo, C.slate] as const;
  // legs + boots (wide stance)
  fill(DARK, 1, (x) => { x.capsule(17, 44, 15, 53, 3, 1); x.capsule(15, 53, 14, 61, 2.5, 1); });
  fill(DARK, 1, (x) => { x.capsule(25, 44, 27, 53, 3, 1); x.capsule(27, 53, 28, 61, 2.5, 1); });
  fill(RAMP.cool, 2, (x) => { x.poly([[11, 60], [17, 60], [17.5, 67], [10, 67]], 1); x.poly([[25, 60], [31, 60], [32, 67], [24.5, 67]], 1); });
  // weapon (arc caster) held low in the right hand, pointing down and out
  fill(RAMP.chrome, 2, (x) => { x.capsule(35, 38, 40.5, 52, 2.1, 1); x.poly([[33, 39], [37, 37], [38, 41], [34, 42]], 1); });
  for (const [cx, cy] of [[38, 47], [39, 50]] as Pt[]) { b.set(cx - 1, cy, C.teal); b.set(cx + 1, cy, C.teal); b.set(cx, cy, C.cyan); }
  b.set(40, 53, C.ice); b.set(41, 53, C.ice); b.set(40, 54, C.cyan); b.set(42, 54, C.cyan); b.set(39, 55, C.cyan); b.set(41, 52, C.white);
  // right arm: sleeve + hand
  fill(DARK, 2, (x) => { x.capsule(30, 18, 33, 28, 3, 1); x.capsule(33, 28, 34.5, 36, 2.6, 1); });
  fill(RAMP.skin, 1, (x) => x.circle(35, 38.5, 2.2, 1));
  // coat: shoulders to mid-thigh, back vent
  fill(DARK, 2, (x) => x.poly([[10, 17], [32, 17], [30, 30], [29.5, 37], [32, 49], [10, 49], [12.5, 37], [12, 30]], 1));
  b.vline(21, 39, 48, C.ink); b.vline(22, 39, 48, C.night);
  b.hline(10, 32, 48, C.indigo);
  b.hline(13, 29, 36, C.night);
  // collar
  fill(DARK, 3, (x) => x.poly([[15, 11], [27, 11], [29, 17.5], [13, 17.5]], 1));
  b.hline(15, 27, 11, C.teal); b.set(21, 11, C.cyan);
  // left arm (chrome) with shoulder plate
  fill(RAMP.chrome, 2, (x) => { x.capsule(11, 19, 8.5, 28, 2.8, 1); x.capsule(8.5, 28, 8, 36, 2.4, 1); x.circle(8, 38.5, 2.7, 1); }, [-1, -1]);
  fill(RAMP.chrome, 3, (x) => x.ellipse(11.5, 19, 3.8, 3, 1), [-1, -1]);
  b.vline(9, 23, 27, C.pale); b.vline(8, 30, 34, C.rose); b.set(9, 31, C.white); b.set(7, 38, C.white);
  b.hline(7, 10, 29, C.slate);
  // hair: round head, short messy tufts, two locks at the nape
  fill(RAMP.cool, 3, (x) => {
    x.ellipse(21, 9, 6.9, 6.8, 1);
    // messy crown: soft bumps instead of spikes, one lock flicking out to the right
    for (const [px, py, r] of [[17, 4, 2], [20, 2.6, 2.1], [23.5, 2.8, 2], [26, 5, 1.8]] as const) x.circle(px, py, r, 1);
    x.poly([[26.5, 6.5], [29.5, 7.5], [27.5, 10]], 1);
    x.poly([[14.5, 10], [12.5, 15], [17.5, 13]], 1); x.poly([[27.5, 10], [29.5, 14.5], [24.5, 13]], 1);
    x.poly([[17, 13], [18.5, 17], [21, 14]], 1); x.poly([[21, 14], [23.5, 17], [25, 13]], 1);
  });
  for (const [x0, y0, x1, y1, c] of [[20, 4, 16, 11, C.slate], [21, 4, 21, 12, C.navy], [22, 4, 26, 11, C.slate], [20, 4, 14, 7, C.navy], [22, 4, 28, 7, C.navy], [18, 9, 18, 14, C.navy], [24, 9, 24, 14, C.navy]] as const) b.line(x0, y0, x1, y1, c);
  b.set(20, 3, C.steel); b.set(21, 3, C.slate); b.set(22, 4, C.steel);
  // neural port at the nape + a debtor barcode printed across the upper back
  b.set(21, 17, C.cyan); b.set(20, 17, C.teal); b.set(22, 17, C.teal);
  [1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 1].forEach((on, i) => { if (on) b.vline(15 + i, 23, 26, i % 3 ? C.teal : C.cyan); });
  b.hline(15, 26, 28, C.abyss);
  // coat panel lines catching a little light
  b.line(14, 21, 15, 34, C.indigo); b.line(28, 21, 27, 34, C.indigo);
  // backlight rims
  backRim(b, [C.cyan, C.teal], [C.magenta, C.grape], (x, y) => x >= 37 && y >= 46);
  b.outline(C.ink);
  return b;
}

// ------------------------------------------------------------------ bosses
function gearjaw(): PixBuf {
  const src = buildBossFrames().find((f) => f.id === 'gearjaw_stripped')!.frames.find((f) => f.name === 'idle1')!.buf;
  const warm = new Set<number>([C.orange, C.sodium, C.amber]);
  const hot = new Set<number>([C.red, C.rose, C.magenta, C.white, C.amber, C.sodium]);
  const { buf, kept } = silhouette(src, [C.ink, C.night, C.night, C.navy, C.indigo], (c, x, y) =>
    (warm.has(c) && y >= 26 && y <= 60 && x >= 12 && x <= 58) || (hot.has(c) && y < 24) || (c === C.magenta || c === C.rose));
  rimLight(buf, [C.orange, C.rust], [C.sodium, C.orange], C.rust, kept);
  return buf;
}

function lux(): PixBuf {
  const src = frameOf(buildLuxArt(), 'lux', 'cast');
  const b = new PixBuf(src.w, src.h);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const c = src.get(x, y);
      if (!c) continue;
      const l = LUM[c];
      b.set(x, y, l < 0.12 ? C.grape : l < 0.3 ? C.orchid : l < 0.55 ? C.magenta : l < 0.85 ? C.rose : C.white);
    }
  }
  return b;
}

function octo(): PixBuf {
  const specs = buildOctohydraArt();
  const b = new PixBuf(80, 110);
  // necks: thick serpentine curves rising from below the frame towards the back of each head
  const neck = (x0: number, x1: number, y1: number, wob: number, r: number) => {
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const y = 114 + (y1 - 114) * t;
      const x = x0 + (x1 - x0) * t + Math.sin(t * Math.PI * 1.4) * wob;
      b.circle(x, y, r * (1 - t * 0.3), (i & 3) === 0 ? C.slate : C.steel);
    }
  };
  // heads are flipped to face left (towards the street); eye = head position + mirrored eye pixel
  const heads: [string, number, number, Pt][] = [
    ['beamer_idle', -4, 28, [24, 13]],
    ['spitter_idle', 34, 16, [18, 12]],
    ['biter_attack', 14, 0, [13, 12]],
  ];
  neck(16, 20, 50, -6, 6.5);
  neck(58, 60, 38, 6, 6);
  neck(38, 38, 22, 8, 7);
  COVER_LAYOUT.octoEyes = [];
  for (const [name, x, y, [ex, ey]] of heads) {
    b.blit(frameOf(specs, 'octo_heads', name).flipX(), x, y);
    COVER_LAYOUT.octoEyes.push([x + 31 - ex, y + ey]);
  }
  const glow = new Set<number>([C.amber, C.sodium, C.red, C.rose, C.white]);
  const { buf, kept } = silhouette(b, [C.ink, C.night, C.navy, C.navy, C.indigo], (c) => glow.has(c));
  rimLight(buf, [C.acid, C.lime], [C.lime, C.moss], C.moss, kept);
  return buf;
}

// ------------------------------------------------------------------ small sprites
function sign(edge: number, core: number, inner: number): PixBuf {
  const b = new PixBuf(30, 62);
  b.rect(1, 1, 28, 60, inner);
  b.strokeRect(1, 1, 28, 60, edge);
  b.strokeRect(2, 2, 26, 58, core);
  b.strokeRect(3, 3, 24, 56, edge);
  for (const [x, y] of [[1, 1], [28, 1], [1, 60], [28, 60]] as Pt[]) b.set(x, y, 0);
  b.outline(C.ink);
  return b;
}

function glowTex(): PixBuf {
  const b = new PixBuf(32, 32);
  b.alpha = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
      if (d >= 1) continue;
      const a = (1 - d) ** 2;
      b.set(x, y, C.white);
      b.alpha[y * 32 + x] = Math.round(Math.round(a * 8) / 8 * 255);
    }
  }
  return b;
}

function grit(): PixBuf {
  const b = new PixBuf(128, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 128; x++) {
      const n = vnoise(x / 5, y / 5, 71);
      if (hash2(x, y, 73) < 0.05 || (n > 0.72 && hash2(x, y, 79) < 0.6)) b.set(x, y, C.white);
    }
  }
  return b;
}

export function buildCoverArt(): SheetSpec[] {
  const one = (key: string, buf: PixBuf, name = 'img'): SheetSpec => ({ key, group: 'Cover', frameW: buf.w, frameH: buf.h, frames: [{ name, buf }] });
  const L = COVER_LAYOUT;
  const farB = far(), midB = mid(), gj = gearjaw(), oc = octo();
  const refl = reflection([
    { buf: midB, x: 0, y: MID_Y },
    { buf: upscale(oc, L.octo.s), x: L.octo.x, y: L.octo.y },
    { buf: upscale(gj, L.gearjaw.s), x: L.gearjaw.x, y: L.gearjaw.y },
    { buf: farB, x: 0, y: FAR_Y },
  ]);
  return [
    one('cover_sky', sky()),
    one('cover_far', farB),
    one('cover_mid', midB),
    one('cover_near', near()),
    one('cover_street', street()),
    one('cover_refl', refl),
    one('cover_echo', echo()),
    one('cover_gearjaw', gj),
    one('cover_lux', lux()),
    one('cover_octo', oc),
    {
      key: 'cover_sign', group: 'Cover', frameW: 30, frameH: 62, columns: 2,
      frames: [{ name: 'pink', buf: sign(C.magenta, C.rose, C.plum) }, { name: 'cyan', buf: sign(C.teal, C.ice, C.abyss) }],
    },
    one('cover_glow', glowTex()),
    one('cover_grit', grit()),
  ];
}
