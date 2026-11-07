/**
 * Standees (立绘): large half-body character portraits for intro cards, the hub and the result screen.
 *
 *   standee  112x144  echo, echo_hurt, echo_win, gearjaw, gearjaw_p2, lux, lux_p2,
 *                     octohydra, octohydra_p2, kade, kade_p2, vesper, vesper_p2,
 *                     kairo, kairo_p2, fold, fold_p2
 *
 * Shared lighting so the cast reads as one set: key light from the upper left front, a neon rim
 * light on the right-hand silhouette edge in each character's signature colour. Echo turns 3/4
 * to the right, the bosses turn 3/4 to the left (they face each other on a versus card).
 * Glows are added at runtime with ADD blend; everything here is opaque palette pixels.
 *
 * How a standee is built: parts are drawn back to front into a `Stage`. Each part stores a
 * material and a continuous light value per pixel (form shading from a distance field, so round
 * parts get round light and plates get bevels). Later parts cast a short shadow onto earlier ones
 * and get a dark seam where they overlap them. `resolve()` quantises light values to the
 * material ramps, adds the rim light, cleans up lone pixels and adds the ink outline.
 * Details (eyes, glowing seams, text) are fixed palette pixels painted on top.
 */
import { C } from './palette';
import { buildExpansionStandeeFrames } from './expansion';
import { grid, legend, type Legend } from './core/grid';
import { Mask, PixBuf, type Pt } from './core/pixbuf';
import { bayer, hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';

export const STANDEE_W = 112;
export const STANDEE_H = 144;

/**
 * Focal points in frame pixels (same for a character's variants): `face` = centre between the
 * eyes (for Octohydra: the front biter's eye), `glow` = where a runtime ADD glow sells the art.
 * The bottom rows are cropped by the frame on purpose; anchor cards at the bottom edge.
 */
export const STANDEE_FOCUS: Record<string, { face: Pt; glow: Pt[] }> = {
  kairo: { face: [51, 40], glow: [[61, 40], [55, 103], [17, 53]] },
  fold: { face: [48, 49], glow: [[38, 49], [55, 127]] },
  echo: { face: [57, 46], glow: [[62, 47], [87, 88]] }, // glows: cyber eye, shoulder joint seam
  gearjaw: { face: [47, 37], glow: [[41, 37], [53, 37], [56, 136]] }, // last glow: P2 engine
  lux: { face: [55, 48], glow: [[26, 51], [58, 48]] },
  octohydra: { face: [37, 55], glow: [[75, 80], [77, 19]] },
  kade: { face: [50, 37], glow: [[48, 37], [24, 112]] },
  vesper: { face: [55, 44], glow: [[48, 42], [109, 8], [89, 97]] }, // glows: visor, muzzle (hot in P2), armband
};

const W = STANDEE_W, H = STANDEE_H;

// ------------------------------------------------------------------ shading engine

interface Mat {
  /** Palette indices, dark -> light. */
  ramp: readonly number[];
  /** Added to the light value before quantising (+ brighter). */
  bias?: number;
  /** Rim colours for this material ([outer, inner]); null = never rim-lit (emissive bits). */
  rim?: readonly number[] | null;
  /** Ordered dither on band edges (large soft surfaces only). */
  dither?: boolean;
  /** Background scenery: figures in front of it still get their rim light along it. */
  back?: boolean;
}

interface PartOpts {
  /** Profile radius in px: large = round (cylinder/ball), small = flat plate with a bevel. */
  r?: number;
  /** Extra light value (+ brighter). */
  bias?: number;
  /** Per-pixel light offset (texture, gradients). */
  tex?: (x: number, y: number) => number;
  /** Shadow cast onto parts drawn before (light value subtracted). 0 = none. */
  cast?: number;
  /** Draw a dark seam on earlier parts along this part's edge. */
  seam?: boolean;
  /** Only paint where something is already drawn (clip to the current silhouette). */
  inside?: boolean;
  /** Only paint inside this mask. */
  clip?: Mask;
}

/** Key light: upper left, towards the viewer. */
const LIGHT = (() => { const v = [-0.55, -0.7, 0.6]; const l = Math.hypot(...v); return v.map((q) => q / l); })();
const AMBIENT = 0.14;

class Stage {
  readonly mat = new Int16Array(W * H).fill(-1);
  readonly lv = new Float32Array(W * H);
  readonly pid = new Int16Array(W * H).fill(-1);
  readonly fix = new Uint8Array(W * H);
  private mats: Mat[] = [];
  private seams: boolean[] = [];

  constructor(readonly rim: readonly number[]) {}

  /** Vertical offset applied to everything drawn (lets a character's body be moved as a block). */
  oy = 0;

  /** Run a draw call into a frame-sized buffer, applying the offset. */
  private scratch = new PixBuf(W, H);
  private scratchBusy = false;

  /** Draw into the shared scratch buffer (or a fresh one if it is busy), run use(), release. */
  private withDrawn<T>(draw: (b: PixBuf) => void, use: (b: PixBuf) => T): T {
    if (this.oy || this.scratchBusy) return use(this.drawn(draw));
    this.scratchBusy = true;
    const b = this.scratch;
    b.px.fill(0);
    draw(b);
    try { return use(b); } finally { this.scratchBusy = false; }
  }

  private drawn(draw: (b: PixBuf) => void): PixBuf {
    if (!this.oy) { const b = new PixBuf(W, H); draw(b); return b; }
    const pad = 64;
    const big = new PixBuf(W, H + pad * 2);
    draw(big);
    const b = new PixBuf(W, H);
    for (let y = 0; y < H; y++) {
      const sy = y - this.oy;
      if (sy < 0 || sy >= big.h) continue;
      b.px.set(big.px.subarray(sy * W, sy * W + W), y * W);
    }
    return b;
  }

  private maskOf(draw: (b: PixBuf) => void): Mask {
    return this.withDrawn(draw, (b) => {
      const m = new Mask(W, H);
      for (let i = 0; i < W * H; i++) if (b.px[i]) m.m[i] = 1;
      return m;
    });
  }

  mask(draw: (b: PixBuf) => void): Mask { return this.maskOf(draw); }

  /** Draw a shaded part. Returns its mask (clipped). */
  part(m: Mat, draw: (b: PixBuf) => void, o: PartOpts = {}): Mask {
    const mask = this.maskOf(draw);
    if (o.inside || o.clip) {
      for (let i = 0; i < W * H; i++) {
        if (!mask.m[i]) continue;
        if (o.inside && this.mat[i] < 0 && !this.fix[i]) mask.m[i] = 0;
        if (o.clip && !o.clip.m[i]) mask.m[i] = 0;
      }
    }
    const id = this.seams.length;
    this.seams.push(o.seam ?? true);
    let mi = this.mats.indexOf(m);
    if (mi < 0) { mi = this.mats.length; this.mats.push(m); }
    // cast shadow on what is already there (down-right of this part)
    const cast = o.cast ?? 0.22;
    const bb = bbox(mask);
    if (!bb) return mask;
    if (cast > 0) {
      for (let y = bb[1]; y <= Math.min(H - 1, bb[3] + 2); y++) for (let x = bb[0]; x <= Math.min(W - 1, bb[2] + 2); x++) {
        const i = y * W + x;
        if (mask.m[i] || this.mat[i] < 0) continue;
        if (mask.has(x - 1, y - 1) || mask.has(x - 2, y - 2) || mask.has(x - 1, y - 2) || mask.has(x - 2, y - 1)) this.lv[i] -= cast;
      }
    }
    const light = formLight(mask, o.r ?? 6);
    for (let y = bb[1]; y <= bb[3]; y++) for (let x = bb[0]; x <= bb[2]; x++) {
      const i = y * W + x;
      if (!mask.m[i]) continue;
      this.mat[i] = mi;
      this.pid[i] = id;
      this.fix[i] = 0;
      this.lv[i] = light[i] + (o.bias ?? 0) + (o.tex ? o.tex(x, y) : 0);
    }
    return mask;
  }

  /** Add to the light value of drawn pixels inside the shape (shadows < 0, highlights > 0). */
  light(delta: number, draw: ((b: PixBuf) => void) | Mask, clip?: Mask): void {
    const mask = draw instanceof Mask ? draw : this.maskOf(draw);
    for (let i = 0; i < W * H; i++) if (mask.m[i] && this.mat[i] >= 0 && (!clip || clip.m[i])) this.lv[i] += delta;
  }

  /** Paint fixed palette pixels (details). Drawn pixels from `draw` are copied as-is. */
  paint(draw: (b: PixBuf) => void, clip?: Mask): void {
    this.withDrawn(draw, (b) => {
      for (let i = 0; i < W * H; i++) if (b.px[i] && (!clip || clip.m[i])) this.fix[i] = b.px[i];
    });
  }

  /** Paint a single fixed pixel. */
  px(x: number, y: number, c: number): void {
    y += this.oy;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    this.fix[y * W + x] = c;
  }

  /** Paint a string grid at (x, y); '.' is skipped. */
  grid(src: string, lg: Legend, x: number, y: number): void {
    const g = grid(src, lg);
    for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) { const c = g.px[j * g.w + i]; if (c) this.px(x + i, y + j, c); }
  }

  /** Colour a material pixel from its light value. */
  private shadeColor(i: number, x: number, y: number): number {
    const m = this.mats[this.mat[i]];
    const n = m.ramp.length;
    let v = (this.lv[i] + (m.bias ?? 0)) * n;
    if (m.dither) v += (bayer(x, y) / 16 - 0.47) * 0.6;
    const k = Math.max(0, Math.min(n - 1, Math.floor(v)));
    return m.ramp[k];
  }

  resolve(post?: (b: PixBuf, s: Stage) => void): PixBuf {
    const b = new PixBuf(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (this.fix[i]) { b.px[i] = this.fix[i]; continue; }
      if (this.mat[i] < 0) continue;
      let c = this.shadeColor(i, x, y);
      // seam: this pixel sits under the edge of a later part
      const p = this.pid[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = this.pid[yy * W + xx];
        if (q > p && this.seams[q] && this.mat[yy * W + xx] !== this.mat[i]) { c = this.mats[this.mat[i]].ramp[0]; break; }
      }
      b.px[i] = c;
    }
    // lone pixel cleanup on shaded (non-fixed) pixels
    const src = b.px.slice();
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!src[i] || this.fix[i]) continue;
      const a = src[i - 1], c2 = src[i + 1], u = src[i - W], d = src[i + W];
      if (a && a === c2 && a === u && a === d && a !== src[i]) b.px[i] = a;
    }
    // rim light on the right silhouette edge
    const pre = b.px.slice();
    // outside the frame on the right counts as covered: parts cropped by the frame edge get no rim there
    const opPre = (x: number, y: number) => x >= W || y < 0 || (x >= 0 && y >= 0 && y < H && pre[y * W + x] !== 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!pre[i]) continue;
      if (this.fix[i]) continue;
      const m = this.mats[this.mat[i]];
      if (m && m.rim === null) continue;
      const rim = m?.rim ?? this.rim;
      // a figure in front of background scenery treats the scenery as empty space
      const op = m?.back ? opPre : (xx: number, yy: number) => opPre(xx, yy) && !(xx >= 0 && xx < W && yy >= 0 && yy < H && this.mats[this.mat[yy * W + xx]]?.back);
      if (!op(x + 1, y)) b.px[i] = rim[0];
      else if (rim[1] && !op(x + 2, y) && !op(x + 2, y - 1) && !op(x + 2, y + 1) && op(x, y - 1) && op(x, y + 1)) b.px[i] = rim[1];
      else if (!op(x, y - 1) && !op(x + 1, y - 1) && rim[1]) b.px[i] = rim[1];
    }
    if (post) post(b, this);
    b.outline(C.ink);
    return b;
  }
}

/**
 * Form light for a mask: a height field from a smoothed distance transform (rounded profile of
 * radius r), lit by LIGHT. Returns light values ~0..1 per pixel.
 */
const SCRATCH = { d: new Float32Array(W * H), h: new Float32Array(W * H), hs: new Float32Array(W * H), out: new Float32Array(W * H) };

function formLight(mask: Mask, r: number): Float32Array {
  const { d, h, hs, out } = SCRATCH;
  const bb = bbox(mask);
  if (!bb) return out;
  const [x0, y0, x1, y1] = bb;
  // scratch buffers are shared: clear the box (+1px border, read by the neighbour lookups)
  for (let y = Math.max(0, y0 - 1); y <= Math.min(H - 1, y1 + 1); y++) {
    const a = y * W + Math.max(0, x0 - 1), b = y * W + Math.min(W - 1, x1 + 1) + 1;
    d.fill(0, a, b); h.fill(0, a, b); hs.fill(0, a, b); out.fill(0, a, b);
  }
  const BIG = 1e4;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (mask.m[y * W + x]) d[y * W + x] = BIG;
  // two-pass chamfer (1, 1.414); pixels outside the frame count as inside (crops at the frame edge)
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? BIG : d[y * W + x]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
  }
  for (let y = y1; y >= y0; y--) for (let x = x1; x >= x0; x--) {
    const i = y * W + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
  }
  // rounded height profile, then a box blur so normals are smooth
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (!mask.m[i]) continue;
    const t = Math.min(1, (d[i] - 0.5) / r);
    h[i] = r * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
  }
  const br = r >= 5 ? 2 : 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (!mask.m[i]) continue;
    let s = 0, n = 0;
    for (let j = -br; j <= br; j++) for (let k = -br; k <= br; k++) {
      const xx = x + k, yy = y + j;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) { s += h[i]; n++; continue; }
      s += mask.m[yy * W + xx] ? h[yy * W + xx] : 0; n++;
    }
    hs[i] = s / n;
  }
  const hv = (x: number, y: number, i: number) => (x < 0 || y < 0 || x >= W || y >= H ? hs[i] : hs[y * W + x]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    if (!mask.m[i]) continue;
    const gx = (hv(x + 1, y, i) - hv(x - 1, y, i)) / 2;
    const gy = (hv(x, y + 1, i) - hv(x, y - 1, i)) / 2;
    const nl = Math.hypot(gx, gy, 1);
    const lam = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / nl;
    out[i] = AMBIENT + (1 - AMBIENT) * Math.max(0, lam);
  }
  return out;
}

/** Bounding box [x0, y0, x1, y1] of a mask, or null when empty. */
function bbox(mask: Mask): [number, number, number, number] | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask.m[y * W + x]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

// ------------------------------------------------------------------ shared materials

const M = {
  skin: { ramp: [C.skinX, C.skinD, C.skinM, C.skinL], bias: 0.22 } as Mat,
  skinTan: { ramp: [C.skinX, C.skinD, C.skinM, C.skinL], bias: -0.05 } as Mat,
  chrome: { ramp: [C.ink, C.slate, C.steel, C.fog, C.pale, C.white], bias: 0.0 } as Mat,
  steel: { ramp: [C.ink, C.night, C.slate, C.steel, C.fog], bias: 0 } as Mat,
  jacket: { ramp: [C.ink, C.night, C.navy, C.indigo, C.slate, C.steel], bias: -0.1 } as Mat,
  hairEcho: { ramp: [C.night, C.navy, C.indigo, C.slate, C.steel, C.fog], bias: 0 } as Mat,
};

// ------------------------------------------------------------------ ECHO

type EchoMood = 'normal' | 'hurt' | 'win';

/**
 * Echo's value plan (brightest -> darkest): chrome arm (pale/white), skin, jacket (steel with fog
 * light, slate shadow), hair (night/navy/indigo with a steel sheen band), backdrop (ink/night).
 * Cyan only on the hair streak, the cyber eye, the collar trim / zip, the arm joint seams and the
 * rim light. One small warm accent: the debt tag on the loaned arm.
 */
const JACKET_E: Mat = { ramp: [C.navy, C.indigo, C.slate, C.steel, C.fog], bias: -0.04 };
const HEM_E: Mat = { ramp: [C.night, C.navy, C.indigo, C.slate], bias: 0 };
const TROUSER_E: Mat = { ramp: [C.ink, C.night, C.navy, C.indigo], bias: -0.04 };
const SLEEVE_E: Mat = { ...JACKET_E };
const FORESLEEVE_E: Mat = { ...JACKET_E };
const COLLAR_E: Mat = { ...JACKET_E, bias: 0.04 };
const LINING_E: Mat = { ramp: [C.ink, C.night, C.navy], bias: -0.05 };
const STRAP_E: Mat = { ramp: [C.ink, C.night, C.navy, C.indigo], bias: -0.02 };
const HAIR_E: Mat = { ramp: [C.night, C.navy, C.indigo], bias: 0.02 };
const BUZZ_E: Mat = { ramp: [C.navy, C.indigo, C.slate], bias: 0 };
const STREAK_E: Mat = { ramp: [C.teal, C.cyan, C.ice], bias: 0.02, rim: [C.ice, C.cyan] };
const SKIN_E: Mat = { ramp: [C.skinX, C.skinD, C.skinM, C.skinL], bias: 0.4 };
const CHROME_E: Mat = { ramp: [C.night, C.slate, C.steel, C.fog, C.pale, C.white], bias: 0.12, rim: [C.ice, C.cyan] };
// same chrome under different names, so the engine draws a dark seam where the plates meet
const FORE_E: Mat = { ...CHROME_E };
const CAP_E: Mat = { ...CHROME_E, bias: 0.04 };
const HAND_E: Mat = { ...CHROME_E, bias: -0.02 };
const FING_A: Mat = { ...CHROME_E, bias: 0.02 };
const FING_B: Mat = { ...CHROME_E, bias: 0.02 };
const JOINT_E: Mat = { ramp: [C.ink, C.night, C.navy, C.slate], bias: 0 };
const BLD_E: Mat = { ramp: [C.ink, C.night, C.navy], bias: -0.3, rim: [C.navy], back: true };
const BLD_FAR_E: Mat = { ramp: [C.ink, C.night], bias: -0.25, rim: null, back: true };

/** Head placement: skull centre. hurt drops the head and turns it down. */
const echoHead = (mood: EchoMood): Pt => (mood === 'hurt' ? [50, 49] : mood === 'win' ? [53, 43] : [52, 44]);

function echo(mood: EchoMood): PixBuf {
  const s = new Stage([C.cyan, C.teal]);
  const win = mood === 'win', hurt = mood === 'hurt';
  echoBackdrop(s);
  const [hx, hy] = echoHead(mood);
  // --- hair, back mass (behind the head and the collar): spikes towards the back (viewer-left)
  echoHairBack(s, hx, hy);
  // --- torso: 3/4 turned right, the centre line (zip) right of the frame centre
  // trousers + belt below the short jacket
  s.part(TROUSER_E, (b) => b.poly([[28, 128], [92, 128], [92, 144], [28, 144]], 1), { r: 6 });
  s.paint((b) => { b.hline(30, 90, 136, C.night); b.hline(30, 90, 137, C.night); b.rect(60, 135, 5, 4, C.steel); b.set(60, 135, C.pale); });
  const torso = s.part(JACKET_E, (b) => b.poly([[22, 100], [26, 86], [36, 78], [48, 73], [68, 73], [82, 77], [90, 86], [93, 102], [94, 128], [80, 131], [60, 133], [40, 133], [24, 131]], 1), { r: 9 });
  // ribbed hem band
  s.part(HEM_E, (b) => b.poly([[23, 126], [40, 128], [60, 128], [80, 126], [94, 123], [94, 128], [80, 131], [60, 133], [40, 133], [23, 131]], 1), { r: 2, clip: torso, cast: 0.1 });
  s.paint((b) => { for (let x = 26; x < 94; x += 3) b.set(x, 130 - Math.round(Math.max(0, x - 60) / 10), C.night); }, torso);
  // far half turns away from the key light
  s.light(-0.32, (b) => b.poly([[66, 70], [104, 70], [104, 144], [68, 144], [67, 104]], 1), torso);
  // the near chest plane faces the key light; the side under the near arm turns away
  s.light(0.08, (b) => b.poly([[40, 78], [64, 76], [66, 128], [42, 130]], 1), torso);
  echoJacketDetail(s, torso);
  // --- near arm (flesh right arm in its sleeve): hooked on the bag strap, or hanging when hurt
  if (hurt) {
    s.part(SLEEVE_E, (b) => { b.capsule(31, 90, 26, 120, 8.5, 1); b.capsule(26, 120, 25, 150, 8, 1); }, { r: 7, bias: 0.06, cast: 0.28 });
  } else {
    s.part(SLEEVE_E, (b) => b.capsule(31, 88, 27, 120, 8.5, 1), { r: 7, bias: 0.06, cast: 0.28 });
    s.part(FORESLEEVE_E, (b) => { b.capsule(27, 121, 40, 104, 7, 1); b.capsule(40, 104, 43, 100, 6, 1); }, { r: 6, bias: 0.08, cast: 0.3 });
    // cuff, then the hand gripping the strap: knuckles over the top, thumb under
    s.part(HEM_E, (b) => b.capsule(39, 106, 46, 99, 3.2, 1), { r: 2, cast: 0.2 });
    s.part(SKIN_E, (b) => { b.ellipse(48.5, 95.5, 4.6, 4.2, 1); b.capsule(46, 99, 51, 100, 1.8, 1); }, { r: 3, cast: 0.3, bias: -0.04 });
    s.paint((b) => {
      for (const [x, y] of [[47, 94], [49, 93], [51, 94]] as Pt[]) { b.set(x, y + 1, C.skinD); b.set(x, y + 2, C.skinD); }
      b.set(46, 93, C.skinL); b.set(48, 92, C.skinL);
    });
  }
  s.light(0.12, (b) => b.ellipse(28, 88, 7, 7, 1));
  // --- neck + high collar
  s.part(SKIN_E, (b) => b.poly([[hx - 7, hy + 12], [hx + 9, hy + 12], [hx + 10, hy + 30], [hx - 6, hy + 30]], 1), { r: 5, bias: -0.32 });
  echoCollar(s, hx, hy);
  // --- chrome left arm (viewer-right)
  if (win) chromeArm(s, mood, [86, 84], [101, 88], [93, 50]);
  else if (hurt) chromeArm(s, mood, [87, 88], [96, 116], [86, 138]);
  else chromeArm(s, mood, [88, 83], [99, 110], [93, 133]);
  // --- head
  echoFaceBase(s, hx, hy);
  echoFace(s, hx, hy, mood);
  echoHairFront(s, hx, hy);
  return s.resolve((b) => {
    if (hurt) {
      // sparks off the shoulder joint seam and the elbow
      for (const [x, y, c] of [[98, 90, C.white], [102, 84, C.ice], [94, 84, C.cyan], [104, 114, C.white], [107, 109, C.ice], [105, 122, C.cyan]] as const) {
        b.set(x, y, c); b.set(x - 1, y, C.cyan); b.set(x + 1, y, C.cyan); b.set(x, y - 1, C.cyan); b.set(x, y + 1, C.cyan);
      }
      b.line(100, 88, 104, 82, C.ice); b.line(106, 112, 110, 106, C.ice);
    }
  });
}

/** Night skyline: a far silhouette band and two near blocks at the frame edges, all dark and dim. */
function echoBackdrop(s: Stage): void {
  // far skyline: flat dark silhouette low behind the shoulders
  s.part(BLD_FAR_E, (b) => {
    for (const [x, w, top] of [[0, 10, 92], [10, 8, 100], [18, 12, 86], [30, 10, 104], [76, 12, 96], [88, 8, 82], [96, 16, 90]] as const) b.rect(x, top, w, H - top, 1);
  }, { r: 1, cast: 0 });
  // near blocks at the edges; nothing above y 70 near the head
  const near = s.mask((b) => { b.rect(0, 74, 13, 70, 1); b.rect(97, 54, 15, 90, 1); b.rect(101, 46, 6, 8, 1); });
  s.part(BLD_E, (b) => { b.rect(0, 74, 13, 70, 1); b.rect(97, 54, 15, 90, 1); b.rect(101, 46, 6, 8, 1); }, { r: 2, cast: 0 });
  s.paint((b) => {
    // windows: sparse dim lights, mostly cool, a few warm
    for (let y = 58; y < H; y += 6) for (let x = 1; x < W - 1; x += 4) {
      const h = hash2(x, y, 41);
      if (h > 0.22) continue;
      const c = h < 0.03 ? C.umber : h < 0.08 ? C.abyss : C.indigo;
      b.set(x, y, c); b.set(x + 1, y, c);
    }
    // aircraft light on the antenna
    b.set(103, 45, C.maroon);
  }, s.mask((b) => { b.rect(1, 76, 11, 68, 1); b.rect(98, 56, 13, 88, 1); }));
  // a dim teal sign strip on the right block, low and away from the head
  s.paint((b) => { b.vline(108, 66, 92, C.abyss); for (let y = 68; y < 92; y += 4) b.set(108, y, C.teal); });
  // rain
  s.paint((b) => {
    for (let k = 0; k < 34; k++) {
      const x = Math.floor(hash2(k, 1, 57) * W), y = 60 + Math.floor(hash2(k, 2, 57) * 84);
      b.line(x, y, x - 1, y + 3, C.navy);
    }
  }, near);
}

/** Zip, strap with a buckle, fold shadows. */
function echoJacketDetail(s: Stage, torso: Mask): void {
  // zip line on the 3/4 centre line, slightly curved over the chest
  s.paint((b) => {
    b.line(64, 80, 66, 104, C.cyan); b.line(66, 104, 66, 132, C.cyan);
    b.line(65, 80, 67, 104, C.teal); b.line(67, 104, 67, 132, C.teal);
  }, torso);
  // bag strap: near shoulder -> far hip, with a chrome buckle
  s.part(STRAP_E, (b) => b.poly([[34, 80], [41, 76], [93, 128], [92, 138]], 1), { r: 2, cast: 0.25 });
  s.paint((b) => b.line(40, 78, 91, 129, C.slate));
  s.part(CHROME_E, (b) => b.rect(58, 96, 7, 8, 1), { r: 2, cast: 0.25, bias: -0.04 });
  s.paint((b) => { b.rect(60, 98, 3, 4, C.navy); b.set(59, 97, C.white); });
}

/** High collar wrapping the neck: lining inside, cyan trim along the top edge. */
function echoCollar(s: Stage, hx: number, hy: number): void {
  const y0 = hy + 18;
  s.part(LINING_E, (b) => b.poly([[hx - 12, y0 + 2], [hx + 14, y0 + 4], [hx + 12, y0 + 12], [hx - 10, y0 + 10]], 1), { r: 3, cast: 0 });
  s.part(COLLAR_E, (b) => b.poly([
    [hx - 14, y0], [hx - 7, y0 + 7], [hx + 4, y0 + 10], [hx + 14, y0 + 6], [hx + 18, y0 + 2],
    [hx + 21, y0 + 14], [hx + 12, y0 + 20], [hx - 2, y0 + 20], [hx - 16, y0 + 14],
  ], 1), { r: 5, bias: 0.04, cast: 0.3 });
  s.paint((b) => {
    b.line(hx - 14, y0, hx - 7, y0 + 7, C.cyan); b.line(hx - 7, y0 + 7, hx + 4, y0 + 10, C.cyan);
    b.line(hx + 4, y0 + 10, hx + 14, y0 + 6, C.teal); b.line(hx + 14, y0 + 6, hx + 18, y0 + 2, C.teal);
    // collar fold seam
    b.line(hx - 15, y0 + 9, hx - 4, y0 + 16, C.indigo);
  });
}

/** Echo's loaned chrome arm: shoulder cap, upper arm, gauntlet, elbow bearing, fist; cyan joint seams. */
function chromeArm(s: Stage, mood: EchoMood, sh: Pt, el: Pt, fist: Pt): void {
  const [ex, ey] = el, [fx, fy] = fist;
  const raised = mood === 'win';
  const dl = Math.hypot(fx - ex, fy - ey);
  const ux = (fx - ex) / dl, uy = (fy - ey) / dl; // along the forearm, towards the fist
  const ax = -uy, ay = ux; // across it
  const wx = fx - ux * 7, wy = fy - uy * 7;
  // upper arm cylinder
  s.part(CHROME_E, (b) => b.capsule(sh[0], sh[1] + 2, ex, ey, 7.5, 1), { r: 7, cast: 0.3 });
  // forearm gauntlet: wider towards the wrist
  s.part(FORE_E, (b) => {
    b.capsule(ex, ey, wx, wy, 6.6, 1);
    b.capsule(ex + (wx - ex) * 0.4, ey + (wy - ey) * 0.4, wx, wy, 8.2, 1);
  }, { r: 6, cast: 0.3 });
  s.paint((b) => {
    // plate split across the gauntlet
    const mx = ex + (wx - ex) * 0.38, my = ey + (wy - ey) * 0.38;
    b.line(Math.round(mx - ax * 6), Math.round(my - ay * 6), Math.round(mx + ax * 6), Math.round(my + ay * 6), C.night);
    // glow seam along the lower edge of the gauntlet
    const side = raised ? -1 : 1;
    for (let t = 0.45; t <= 0.96; t += 0.04) {
      const x = ex + (wx - ex) * t + ax * 3.6 * side, y = ey + (wy - ey) * t + ay * 3.6 * side;
      b.set(Math.round(x), Math.round(y), t > 0.86 ? C.ice : C.cyan);
    }
  });
  // elbow bearing over both segments: dark disc, cyan seam ring, bolt
  s.part(JOINT_E, (b) => b.circle(ex, ey, 4.8, 1), { r: 3, cast: 0.2 });
  s.paint((b) => { b.ring(ex, ey, 3.9, C.cyan); b.set(Math.round(ex - 1), Math.round(ey - 1), C.steel); b.set(Math.round(ex), Math.round(ey - 2), C.ice); });
  // wrist ring
  s.part(JOINT_E, (b) => b.capsule(wx - ax * 7, wy - ay * 7, wx + ax * 7, wy + ay * 7, 1.8, 1), { r: 2, cast: 0.15 });
  s.paint((b) => b.set(Math.round(wx), Math.round(wy), C.cyan));
  // fist: back of the hand, then four curled fingers (alternating materials so seams split them), thumb
  s.part(HAND_E, (b) => b.capsule(fx - ux * 2.5, fy - uy * 2.5, fx + ux * 1, fy + uy * 1, 7, 1), { r: 4, cast: 0.25 });
  for (let k = 0; k < 4; k++) {
    const o = (k - 1.5) * 3.4;
    const m = k % 2 ? FING_A : FING_B;
    s.part(m, (b) => b.capsule(fx + ax * o + ux * 1, fy + ay * o + uy * 1, fx + ax * o + ux * 5, fy + ay * o + uy * 5, 2.1, 1), { r: 2, cast: 0.15 });
  }
  const tside = raised ? 1 : -1;
  s.part(FING_A, (b) => b.capsule(fx + ax * 5 * tside - ux * 2, fy + ay * 5 * tside - uy * 2, fx + ax * 1 * tside + ux * 3, fy + ay * 1 * tside + uy * 3, 2.2, 1), { r: 2, cast: 0.25, bias: 0.04 });
  s.paint((b) => {
    // knuckle glints
    for (const o of [-5.1, -1.7, 1.7]) b.set(Math.round(fx + ax * o + ux * 4.5 - 0.5), Math.round(fy + ay * o + uy * 4.5 - 0.5), C.white);
  });
  // shoulder cap over the top of the arm with a panel line; cyan joint seam below it
  s.part(CAP_E, (b) => b.poly([[sh[0] - 9, sh[1] + 5], [sh[0] - 8, sh[1] - 3], [sh[0] - 2, sh[1] - 8], [sh[0] + 5, sh[1] - 8], [sh[0] + 10, sh[1] - 3], [sh[0] + 10, sh[1] + 4], [sh[0], sh[1] + 7]], 1), { r: 5, cast: 0.3 });
  s.paint((b) => {
    b.line(sh[0] - 8, sh[1] + 6, sh[0], sh[1] + 8, C.cyan); b.line(sh[0], sh[1] + 8, sh[0] + 10, sh[1] + 5, C.cyan);
    b.line(sh[0] - 6, sh[1] - 1, sh[0] + 4, sh[1] - 6, C.steel);
    b.set(sh[0] - 4, sh[1] - 5, C.white); b.set(sh[0] - 3, sh[1] - 6, C.white);
    // debt tag: a small sodium barcode label on the upper arm
    const lx = Math.round(sh[0] + (ex - sh[0]) * 0.45) - 2, ly = Math.round(sh[1] + (ey - sh[1]) * 0.45) - 1;
    b.rect(lx, ly, 5, 3, C.sodium);
    for (const x of [0, 2, 3]) b.vline(lx + x, ly, ly + 1, C.umber);
  });
}

/** Skull, jaw, ear, and the cel shadows that give the face its planes. */
function echoFaceBase(s: Stage, hx: number, hy: number): void {
  const face = s.part(SKIN_E, (b) => {
    b.ellipse(hx + 1, hy - 1, 14.5, 15.5, 1);
    b.poly([[hx - 12, hy + 2], [hx - 9, hy + 12], [hx - 2, hy + 18], [hx + 5, hy + 23], [hx + 8, hy + 23], [hx + 12, hy + 18], [hx + 15, hy + 9], [hx + 15, hy]], 1);
  }, { r: 12, cast: 0.3 });
  // far side of the face turns away: cheekbone to jaw
  s.light(-0.3, (b) => b.poly([[hx + 11, hy + 7], [hx + 14, hy + 1], [hx + 18, hy + 1], [hx + 18, hy + 26], [hx + 7, hy + 26], [hx + 12, hy + 16]], 1), face);
  // jaw edge on the near side
  s.light(-0.25, (b) => b.poly([[hx - 12, hy + 12], [hx - 3, hy + 20], [hx + 6, hy + 23], [hx + 6, hy + 25], [hx - 8, hy + 25]], 1), face);
  // ear (near side)
  s.part(SKIN_E, (b) => b.ellipse(hx - 13, hy + 6, 3.2, 4.8, 1), { r: 2, bias: -0.06, cast: 0 });
  s.paint((b) => { b.vline(hx - 13, hy + 4, hy + 8, C.skinD); b.set(hx - 12, hy + 9, C.skinD); });
}

function echoFace(s: Stage, hx: number, hy: number, mood: EchoMood): void {
  const lg = legend({ x: C.skinX, d: C.skinD, m: C.skinM, L: C.skinL, q: C.navy, Q: C.steel });
  const ey = hy + 2;
  // brows: dark, straight, slightly lowered at the inner ends (focused)
  s.paint((b) => {
    if (mood === 'hurt') {
      b.line(hx - 7, ey - 5, hx + 1, ey - 2, C.night); b.line(hx - 7, ey - 4, hx + 1, ey - 1, C.night);
      b.line(hx + 8, ey - 2, hx + 13, ey - 5, C.night);
    } else {
      b.line(hx - 7, ey - 4, hx + 2, ey - 3, C.night); b.line(hx - 6, ey - 3, hx + 2, ey - 2, C.night);
      b.line(hx + 8, ey - 2, hx + 13, ey - 4, C.night); b.line(hx + 8, ey - 1, hx + 12, ey - 3, C.night);
    }
  });
  // near eye (Echo's right): lash line, steel-blue iris with a glint; far eye: cyber, cyan with a white core
  if (mood === 'hurt') {
    s.grid(`
      .kk.....
      ..kkkkk.
      ....mdd.`, lg, hx - 6, ey);
    s.grid(`
      kkkkk
      cIwck
      .ddd.`, lg, hx + 8, ey + 1);
  } else if (mood === 'win') {
    s.grid(`
      .kkkkkk.
      kpqwqqkk
      .mddddd.`, lg, hx - 6, ey + 1);
    s.grid(`
      kkkkk
      cIwck
      tccck
      .ddd.`, lg, hx + 8, ey);
  } else {
    s.grid(`
      ..kkkkk.
      .kkkkkkk
      kpqwqqk.
      .pqqQk..
      ..mddd..`, lg, hx - 6, ey - 1);
    s.grid(`
      kkkkk
      kIwck
      ccIck
      tccck
      .ddd.`, lg, hx + 8, ey - 1);
  }
  // cyber-eye circuit running back towards the ear on the far temple
  s.paint((b) => { b.line(hx + 13, ey + 2, hx + 15, ey + 2, C.teal); b.set(hx + 15, ey + 3, C.teal); b.set(hx + 15, ey + 4, C.cyan); });
  // nose: bridge shade on the far side, nostril, cast shadow down-right
  s.paint((b) => {
    b.line(hx + 7, ey + 2, hx + 8, ey + 8, C.skinM);
    b.set(hx + 9, ey + 8, C.skinM); b.set(hx + 9, ey + 9, C.skinD); b.set(hx + 9, ey + 10, C.skinD);
    b.hline(hx + 5, hx + 8, ey + 11, C.skinD); b.set(hx + 4, ey + 10, C.skinM);
    b.hline(hx + 7, hx + 9, ey + 12, C.skinM);
  });
  // mouth
  const my = hy + 16;
  if (mood === 'hurt') {
    s.grid(`
      .xxxxx.
      xLmLmLx
      .xxxxx.`, lg, hx + 1, my - 1);
  } else if (mood === 'win') {
    s.grid(`
      x.....x
      .xpppx.
      ..xxx..
      ..mmm..`, lg, hx + 1, my - 1);
  } else {
    // a level line with the far corner tucked up: calm, a little cocky
    s.grid(`
      ......d
      xxxxxx.
      .mmm...`, lg, hx + 2, my - 1);
  }
  if (mood === 'hurt') {
    // scratch across the near cheekbone
    s.paint((b) => { b.line(hx - 9, hy + 11, hx - 3, hy + 8, C.maroon); b.line(hx - 8, hy + 11, hx - 4, hy + 9, C.skinX); b.set(hx - 2, hy + 8, C.skinD); });
  }
}

function echoHairBack(s: Stage, hx: number, hy: number): void {
  s.part(HAIR_E, (b) => {
    b.ellipse(hx - 1, hy - 5, 19, 17.5, 1);
    // spikes swept back (viewer-left) and up
    b.poly([[hx - 12, hy - 14], [hx - 29, hy - 16], [hx - 17, hy - 5]], 1);
    b.poly([[hx - 15, hy - 3], [hx - 27, hy + 1], [hx - 17, hy + 6]], 1);
    b.poly([[hx - 7, hy - 19], [hx - 18, hy - 30], [hx - 1, hy - 21]], 1);
    b.poly([[hx + 1, hy - 21], [hx + 3, hy - 32], [hx + 10, hy - 19]], 1);
    // nape lock down the back of the neck
    b.poly([[hx - 18, hy], [hx - 21, hy + 16], [hx - 12, hy + 10]], 1);
  }, { r: 10, cast: 0.2 });
  // clump lines in the back mass
  s.paint((b) => {
    for (const [x0, y0, x1, y1] of [[-8, -20, -20, -12], [-14, -6, -24, -2], [0, -22, 2, -14], [-16, 2, -19, 12]] as const) b.line(hx + x0, hy + y0, hx + x1, hy + y1, C.night);
  });
}

function echoHairFront(s: Stage, hx: number, hy: number): void {
  // undercut: buzzed far side above the temple
  s.part(BUZZ_E, (b) => b.poly([[hx + 9, hy - 9], [hx + 17, hy - 9], [hx + 17, hy + 3], [hx + 14, hy + 2]], 1), { r: 3, cast: 0.1, clip: s.mask((b) => b.ellipse(hx + 1, hy, 16, 17, 1)) });
  s.paint((b) => { for (let y = hy - 8; y <= hy + 1; y += 2) b.set(hx + 15, y, C.navy); });
  // top hair: swept from the far side over to the near side
  s.part(HAIR_E, (b) => b.poly([
    [hx - 16, hy - 4], [hx - 15, hy - 14], [hx - 6, hy - 20], [hx + 6, hy - 20], [hx + 14, hy - 15], [hx + 18, hy - 9],
    [hx + 10, hy - 9], [hx + 4, hy - 6], [hx - 4, hy - 7], [hx - 11, hy - 3],
  ], 1), { r: 6, cast: 0.25, bias: 0.04 });
  // long fringe locks falling over the near side (big clumps, each its own part)
  const locks: Pt[][] = [
    [[hx - 2, hy - 10], [hx + 6, hy - 9], [hx + 3, hy - 3], [hx + 1, hy - 4]],
    [[hx - 9, hy - 10], [hx - 1, hy - 9], [hx - 4, hy - 1], [hx - 6, hy - 3]],
    [[hx - 16, hy - 8], [hx - 9, hy - 9], [hx - 9, hy + 1], [hx - 12, hy + 12], [hx - 15, hy + 4]],
  ];
  for (const l of locks) s.part(HAIR_E, (b) => b.poly(l, 1), { r: 3, cast: 0.25, bias: 0.02 });
  // the cyan streak: one bold lock from the crown down past the near eye
  s.part(STREAK_E, (b) => b.poly([[hx - 9, hy - 19], [hx - 3, hy - 19], [hx - 6, hy - 8], [hx - 9, hy + 2], [hx - 10, hy + 8], [hx - 12, hy - 4]], 1), { r: 3, cast: 0.25 });
  // sheen band across the crown (lit side), broken where the streak crosses
  s.paint((b) => {
    for (let a = 200; a <= 300; a += 2) {
      const r = a < 250 ? 15 : 14;
      const x = Math.round(hx + Math.cos((a * Math.PI) / 180) * r), y = Math.round(hy - 6 + Math.sin((a * Math.PI) / 180) * r * 0.85);
      if (x >= hx - 12 && x <= hx - 8) continue;
      b.set(x, y, a > 222 && a < 285 ? C.fog : C.steel);
      b.set(x, y + 1, a > 230 && a < 275 ? C.steel : C.slate);
    }
  }, s.mask((b) => { b.ellipse(hx - 1, hy - 5, 19, 17.5, 1); }));
}

// ------------------------------------------------------------------ GEARJAW

const RUST: Mat = { ramp: [C.umber, C.rust, C.orange, C.sodium, C.amber], bias: -0.1 };
const LEATHER: Mat = { ramp: [C.ink, C.umber, C.skinX, C.skinD], bias: -0.05 };
const IRON: Mat = { ramp: [C.ink, C.night, C.navy, C.indigo, C.slate, C.steel], bias: -0.05 };
const MOHAWK: Mat = { ramp: [C.maroon, C.red, C.rose], bias: 0.02, rim: [C.amber, C.sodium] };

/** Lattice girder between two points (two chords + zig-zag braces). */
function girder(s: Stage, m: Mat, a: Pt, b: Pt, w: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  const nx = -dy / len * w, ny = dx / len * w;
  s.part(m, (x) => {
    x.capsule(a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, 1.6, 1);
    x.capsule(a[0] - nx, a[1] - ny, b[0] - nx, b[1] - ny, 1.6, 1);
    const n = Math.floor(len / (w * 1.6));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, sg = i % 2 ? 1 : -1;
      x.capsule(a[0] + dx * t0 + nx * sg, a[1] + dy * t0 + ny * sg, a[0] + dx * t1 - nx * sg, a[1] + dy * t1 - ny * sg, 0.9, 1);
    }
  }, { r: 1.5, cast: 0.15 });
}

function gearWheel(s: Stage, cx: number, cy: number, r: number, teeth: number, m: Mat): void {
  s.part(m, (b) => {
    b.circle(cx, cy, r, 1);
    for (let k = 0; k < teeth; k++) {
      const a = (k / teeth) * Math.PI * 2;
      b.capsule(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r + 1.5), cy + Math.sin(a) * (r + 1.5), 1, 1);
    }
  }, { r: 2, cast: 0.25 });
  s.paint((b) => { b.circle(cx, cy, Math.max(1, r * 0.35), C.ink); b.set(cx - 1, cy - 1, C.fog); });
}

function hazard(s: Stage, clip: Mask, x0: number, y0: number, x1: number, y1: number, a: number = C.amber): void {
  s.paint((b) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) b.set(x, y, ((x - y) >> 2) % 2 === 0 ? C.ink : a);
  }, clip);
}

/** Worn-paint patches as small soft clusters (no single-pixel noise). */
function rustPatches(s: Stage, clip: Mask, x0: number, y0: number, w: number, h: number, seed: number, delta = -0.22): void {
  for (let cy = y0; cy < y0 + h; cy += 4) for (let cx = x0; cx < x0 + w; cx += 7) {
    const r = hash2(cx, cy, seed);
    if (r > 0.3) continue;
    const ox = Math.floor(hash2(cx, cy, seed + 1) * 5), rx = 1.5 + hash2(cx, cy, seed + 2) * 2;
    s.light(delta, (b) => b.ellipse(cx + ox, cy + 1.5, rx, 1.2, 1), clip);
  }
}

function gearjaw(p2: boolean): PixBuf {
  const s = new Stage([C.sodium, C.orange]);
  // --- crane boom behind the right shoulder, cable + hook hanging from off-frame
  girder(s, RUST, [92, 120], [112, -6], 4.5);
  s.part(IRON, (b) => b.line(101, 0, 101, 44, 1), { r: 1, cast: 0 });
  s.part(M.steel, (b) => b.rect(97, 44, 9, 6, 1), { r: 2 });
  s.paint((b) => b.hline(98, 104, 46, C.orange));
  s.part(M.chrome, (b) => {
    const cx = 101, cy = 60;
    for (let a = -Math.PI / 2; a <= Math.PI * 1.1; a += 0.04) b.circle(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6, 1.8, 1);
    b.capsule(101, 50, 101, 54, 2, 1);
  }, { r: 2 });
  // --- exhaust stacks behind the left shoulder, smoke
  s.part({ ramp: [C.night, C.navy, C.indigo, C.slate, C.steel], bias: 0.05 }, (b) => { b.circle(12, 9, 4.5, 1); b.circle(17, 3, 5, 1); b.circle(25, 0, 4, 1); b.circle(8, 1, 3.5, 1); }, { r: 4, cast: 0 });
  s.part(IRON, (b) => { b.rect(8, 16, 8, 70, 1); b.rect(19, 24, 7, 62, 1); }, { r: 3 });
  s.paint((b) => {
    b.hline(8, 15, 16, C.ink); b.hline(8, 15, 17, C.orange); b.hline(9, 14, 18, C.rust);
    b.hline(19, 25, 24, C.ink); b.hline(19, 25, 25, C.orange); b.hline(20, 24, 26, C.rust);
    b.set(11, 15, C.amber); b.set(12, 15, C.sodium); b.set(22, 23, C.sodium);
    for (const y of [36, 52, 68]) { b.hline(8, 15, y, C.ink); b.hline(19, 25, y + 4, C.ink); }
  });
  // --- shoulders / torso (bare, huge)
  const body = s.part(M.skinTan, (b) => b.poly([[2, 104], [8, 82], [26, 70], [40, 64], [66, 64], [84, 70], [100, 82], [108, 102], [108, 144], [2, 144]], 1), { r: 16 });
  // muscle forms: crescent shadows under the pecs and deltoids, lit tops, sternum groove, traps
  const crescent = (cx: number, cy: number, rx: number, ry: number, off: number) =>
    s.mask((b) => b.ellipse(cx, cy, rx, ry, 1)).cut((b) => b.ellipse(cx - off * 0.4, cy - off, rx, ry, 1));
  for (const [cx, cy, rx, ry] of [[36, 102, 17, 12], [74, 100, 15, 11]] as const) {
    s.light(-0.3, crescent(cx, cy, rx, ry, 3), body);
    s.light(0.1, s.mask((b) => b.ellipse(cx - 3, cy - 4, rx - 6, ry - 6, 1)), body);
  }
  s.light(-0.3, crescent(13, 94, 13, 16, 3), body);
  s.light(0.12, s.mask((b) => b.ellipse(10, 88, 7, 7, 1)), body);
  s.light(-0.2, (b) => b.poly([[54, 78], [57, 78], [56, 112], [54, 112]], 1), body);
  s.light(-0.25, (b) => { b.poly([[34, 66], [40, 66], [30, 78], [24, 76]], 1); b.poly([[66, 66], [72, 66], [86, 76], [80, 78]], 1); }, body);
  s.paint((b) => { for (const [x, y] of [[30, 92], [44, 108], [68, 92]] as Pt[]) { b.line(x, y, x + 5, y - 3, C.skinX); b.line(x + 1, y - 2, x + 4, y - 4, C.skinL); } });
  // --- right shoulder: steel pauldron with hazard stripes
  const pauldron: Pt[] = [[74, 72], [92, 70], [106, 82], [110, 98], [96, 100], [80, 88]];
  s.part(M.steel, (b) => b.poly(pauldron, 1), { r: 3, bias: 0.04 });
  hazard(s, s.mask((b) => b.poly(pauldron, 1)), 84, 92, 110, 99, C.sodium);
  s.paint((b) => { for (const [x, y] of [[82, 76], [92, 74], [100, 82]] as Pt[]) { b.set(x, y, C.fog); b.set(x + 1, y + 1, C.ink); } });
  // --- harness: X straps over the chest with a ring at the cross
  s.part(LEATHER, (b) => { b.poly([[24, 74], [32, 70], [80, 126], [72, 130]], 1); b.poly([[80, 70], [88, 74], [40, 130], [32, 126]], 1); }, { r: 2, cast: 0.25 });
  s.part(M.chrome, (b) => b.circle(56, 100, 5, 1), { r: 2, cast: 0.3 });
  s.paint((b) => { b.circle(56, 100, 2.4, C.ink); b.set(54, 98, C.white); });
  // --- cockpit armour (P1) or exposed engine (P2)
  if (!p2) {
    const hullPts: Pt[] = [[0, 124], [18, 116], [56, 120], [94, 114], [112, 120], [112, 144], [0, 144]];
    const hull = s.part(RUST, (b) => b.poly(hullPts, 1), {
      r: 3, cast: 0.35, tex: (_x, y) => (y - 124) * -0.005,
    });
    rustPatches(s, hull, 0, 124, W, 20, 41);
    hazard(s, s.mask((b) => b.poly([[0, 124], [18, 116], [56, 120], [94, 114], [112, 120], [112, 126], [94, 120], [56, 126], [18, 122], [0, 130]], 1)), 0, 114, W - 1, 130);
    s.paint((b) => {
      b.line(0, 131, 18, 123, C.umber); b.line(18, 123, 56, 127, C.umber); b.line(56, 127, 94, 121, C.umber); b.line(94, 121, 112, 127, C.umber);
      for (const [x, y] of [[8, 134], [30, 132], [50, 134], [74, 131], [98, 130]] as Pt[]) { b.set(x, y, C.amber); b.set(x + 1, y + 1, C.umber); }
      b.vline(56, 128, 143, C.umber); b.vline(57, 128, 143, C.sodium);
    }, hull);
  } else {
    const frame = s.part(IRON, (b) => b.poly([[0, 120], [20, 114], [56, 118], [92, 112], [112, 118], [112, 144], [0, 144]], 1), { r: 3, cast: 0.35 });
    // glowing engine grille
    const grille = s.mask((b) => b.ellipse(56, 140, 34, 18, 1));
    s.paint((b) => {
      for (let y = 118; y < H; y++) for (let x = 20; x < 94; x++) {
        if (!grille.has(x, y)) continue;
        const slat = (y - 120) % 5;
        const d = Math.hypot((x - 56) / 34, (y - 140) / 18);
        b.set(x, y, slat === 0 ? C.ink : slat === 1 ? (d < 0.6 ? C.amber : C.orange) : d < 0.45 ? C.white : d < 0.7 ? C.amber : d < 0.9 ? C.sodium : C.orange);
      }
      b.vline(56, 122, 143, C.ink); b.vline(38, 126, 143, C.ink); b.vline(74, 126, 143, C.ink);
    }, frame);
    // hydraulic pistons + bolts on the bare frame
    for (const [x0, y0, x1, y1] of [[10, 126, 22, 112], [102, 126, 90, 110]] as const) {
      s.part(M.chrome, (b) => b.capsule(x0, y0, x1, y1, 2, 1), { r: 2, cast: 0.2 });
      s.part(IRON, (b) => b.capsule(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2, 3, 1), { r: 2, cast: 0.2 });
    }
    s.paint((b) => { for (const x of [8, 30, 82, 104]) { b.set(x, 138, C.steel); b.set(x + 1, 139, C.ink); } });
    // torn plating stubs + loose cables
    s.part(RUST, (b) => { b.poly([[0, 118], [16, 112], [20, 122], [6, 128]], 1); b.poly([[96, 110], [112, 114], [112, 126], [100, 122]], 1); }, { r: 2, cast: 0.3 });
    s.paint((b) => {
      b.line(18, 118, 14, 132, C.red); b.line(19, 118, 15, 132, C.maroon); b.set(14, 133, C.white);
      b.line(96, 116, 100, 134, C.teal); b.set(100, 135, C.ice);
    });
  }
  // --- neck (thick, in shadow under the jaw)
  s.part(M.skinTan, (b) => b.poly([[38, 52], [66, 54], [72, 70], [34, 70]], 1), { r: 8, bias: -0.12 });
  s.light(-0.2, (b) => b.poly([[38, 60], [66, 60], [66, 66], [38, 66]], 1));
  gearjawHead(s, p2);
  return s.resolve();
}

function gearjawHead(s: Stage, p2: boolean): void {
  const hx = 50, hy = 38;
  const head = s.part(M.skinTan, (b) => {
    b.ellipse(hx, hy, 15, 15.5, 1);
    b.poly([[hx - 14, hy + 2], [hx - 12, hy + 14], [hx + 14, hy + 14], [hx + 15, hy]], 1);
  }, { r: 12, cast: 0.3, bias: 0.08 });
  // back of the head turns away from the light
  s.light(-0.2, (b) => b.poly([[hx + 6, hy - 18], [hx + 18, hy - 10], [hx + 18, hy + 16], [hx + 8, hy + 16]], 1), head);
  // ear on the back side
  s.part(M.skinTan, (b) => b.ellipse(hx + 12, hy + 5, 3, 5, 1), { r: 2, bias: -0.06, cast: 0 });
  s.paint((b) => { b.vline(hx + 12, hy + 3, hy + 8, C.skinX); b.set(hx + 13, hy + 2, C.skinM); });
  // scalp scar
  s.paint((b) => { b.line(hx - 2, hy - 12, hx + 6, hy - 8, C.skinX); b.set(hx, hy - 10, C.skinL); b.set(hx + 3, hy - 9, C.skinL); });
  // goggle strap around the head
  s.part(LEATHER, (b) => b.poly([[hx - 15, hy - 4], [hx + 15, hy - 6], [hx + 16, hy - 1], [hx - 15, hy + 2]], 1), { r: 1.5, cast: 0.2, clip: s.mask((b) => b.ellipse(hx, hy, 15.5, 16, 1)) });
  // lenses: far (left, narrower) and near
  const lens = (cx: number, cy: number, rx: number, ry: number, cracked: boolean) => {
    s.part(M.steel, (b) => b.ellipse(cx, cy, rx + 1.6, ry + 1.6, 1), { r: 2, cast: 0.3 });
    s.paint((b) => {
      b.ellipse(cx, cy, rx, ry, cracked ? C.red : C.sodium);
      b.ellipse(cx - 0.6, cy - 0.8, rx - 1.2, ry - 1.4, cracked ? C.rose : C.amber);
      const gx = Math.round(cx - rx / 2), gy = Math.round(cy - ry / 2);
      b.set(gx, gy, C.white); b.set(gx + 1, gy, C.white); b.set(gx, gy + 1, C.white);
      if (cracked) { b.line(cx - rx + 1, cy + 1, cx + 1, cy - 1, C.ink); b.line(cx + 1, cy - 1, cx + rx - 1, cy - ry + 1, C.ink); b.set(cx, cy + 1, C.white); }
    });
  };
  lens(hx - 9, hy - 1, 4, 4.5, false);
  lens(hx + 3, hy - 1, 5.5, 5, p2);
  // brow ridge, pulled down in a scowl
  s.paint((b) => {
    b.line(hx - 14, hy - 9, hx - 4, hy - 6, C.skinX); b.line(hx - 13, hy - 8, hx - 4, hy - 5, C.skinD);
    b.line(hx - 2, hy - 6, hx + 9, hy - 10, C.skinX); b.line(hx - 2, hy - 5, hx + 9, hy - 9, C.skinD);
  });
  // nose: broad, broken
  s.paint((b) => {
    b.set(hx - 4, hy + 4, C.skinL); b.vline(hx - 3, hy + 3, hy + 7, C.skinD);
    b.hline(hx - 7, hx - 2, hy + 8, C.skinX); b.set(hx - 7, hy + 7, C.skinD); b.set(hx - 5, hy + 7, C.skinM);
  });
  // geared steel jaw (drops open in P2)
  const drop = p2 ? 4 : 0;
  if (p2) {
    s.part({ ramp: [C.ink, C.maroon], rim: null }, (b) => b.poly([[hx - 14, hy + 11], [hx + 10, hy + 11], [hx + 10, hy + 17], [hx - 12, hy + 17]], 1), { r: 1, cast: 0 });
  }
  const jaw: Pt[] = [[hx - 15, hy + 11 + drop], [hx + 11, hy + 10 + drop], [hx + 13, hy + 18 + drop], [hx + 6, hy + 25 + drop], [hx - 8, hy + 26 + drop], [hx - 15, hy + 19 + drop]];
  s.part(M.steel, (b) => b.poly(jaw, 1), { r: 3, cast: 0.35, bias: 0.06 });
  s.paint((b) => {
    for (let x = hx - 14; x <= hx + 9; x += 3) { b.rect(x, hy + 10 + drop, 2, 3, C.pale); b.set(x, hy + 10 + drop, C.white); b.set(x + 2, hy + 11 + drop, C.ink); }
    b.hline(hx - 14, hx + 11, hy + 13 + drop, C.ink);
    for (const x of [hx - 10, hx - 5, hx]) b.vline(x, hy + 17 + drop, hy + 22 + drop, C.night);
    b.set(hx - 13, hy + 16 + drop, C.fog); b.set(hx + 8, hy + 15 + drop, C.fog);
  });
  if (p2) s.paint((b) => { for (let x = hx - 13; x <= hx + 8; x += 3) { b.rect(x, hy + 8, 2, 3, C.pale); b.set(x, hy + 10, C.fog); } });
  gearWheel(s, hx + 12, hy + 14 + drop / 2, 4, 8, M.steel);
  // mohawk: spikes along the skull midline, sweeping back
  s.part(MOHAWK, (b) => {
    const pts: [number, number, number, number][] = [
      [hx - 9, hy - 13, -3, -10], [hx - 4, hy - 15, 0, -15], [hx + 1, hy - 16, 4, -17], [hx + 6, hy - 15, 9, -17], [hx + 11, hy - 12, 13, -14], [hx + 14, hy - 8, 17, -9],
    ];
    for (const [x, y, dx, dy] of pts) b.poly([[x - 3.5, y + 3], [x + 3.5, y + 2], [x + dx, y + dy]], 1);
    b.capsule(hx - 9, hy - 12, hx + 13, hy - 8, 3, 1);
    b.ellipse(hx + 2, hy - 14, 10, 3.5, 1);
  }, { r: 3, cast: 0.3 });
  s.paint((b) => { for (const [x, y] of [[hx - 5, hy - 22], [hx, hy - 25], [hx + 6, hy - 25]] as Pt[]) b.line(x, y + 1, x + 2, y + 7, C.maroon); });
}

// ------------------------------------------------------------------ MADAME LUX

const HAIR_LUX: Mat = { ramp: [C.plum, C.grape, C.orchid, C.magenta, C.rose], bias: 0.08, rim: [C.rose, C.magenta] };
const BODICE: Mat = { ramp: [C.ink, C.plum, C.grape, C.orchid, C.magenta], bias: -0.02 };
const GOWN: Mat = { ramp: [C.steel, C.fog, C.pale, C.white], bias: 0.02, rim: [C.rose, C.magenta] };
const GLOVE: Mat = { ramp: [C.slate, C.steel, C.fog, C.pale, C.white], bias: 0.05 };
const BOA: Mat = { ramp: [C.abyss, C.teal, C.cyan, C.ice], bias: 0.02, rim: [C.rose, C.ice] };

/** Hologram brightening: one ramp step up. */
const HOLO_UP: Record<number, number> = {
  [C.plum]: C.grape, [C.grape]: C.orchid, [C.orchid]: C.magenta, [C.magenta]: C.rose,
  [C.skinD]: C.skinM, [C.skinM]: C.skinL, [C.fog]: C.pale, [C.pale]: C.white, [C.steel]: C.fog,
  [C.teal]: C.cyan, [C.cyan]: C.ice, [C.abyss]: C.teal, [C.slate]: C.steel,
};

/** A fluffy feather strand: a chain of small balls along a polyline. */
function featherChain(b: PixBuf, pts: Pt[], r0: number, r1: number): void {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    for (let d = 0; d < len; d += 2.2) {
      const t = (acc + d) / total;
      const r = r0 + (r1 - r0) * t;
      const j = (hash2(Math.round(ax + d), i, 3) - 0.5) * 1.6;
      b.circle(ax + (bx - ax) * (d / len) + j, ay + (by - ay) * (d / len) - j * 0.5, r, 1);
    }
    acc += len;
  }
}

function lux(p2: boolean): PixBuf {
  const s = new Stage([C.magenta, C.orchid]);
  const hx = 60, hy = 46;
  const boaPath: Pt[] = [[30, 146], [29, 120], [33, 100], [42, 90], [52, 92], [62, 94], [74, 90], [84, 92], [90, 104], [93, 124], [95, 146]];
  // --- hair, back mass: a big glossy bob that curls in at the jaw
  s.part(HAIR_LUX, (b) => {
    b.ellipse(hx + 2, hy - 6, 22, 21, 1);
    b.ellipse(hx + 12, hy + 12, 12, 14, 1);
    b.ellipse(hx - 11, hy + 12, 10, 12, 1);
    if (p2) for (const [x, y, dx, dy] of [[hx + 18, hy - 16, 12, -8], [hx + 22, hy, 12, -2], [hx + 20, hy + 18, 10, 6]] as const) b.poly([[x, y - 4], [x + 2, y + 5], [x + dx, y + dy]], 1);
  }, { r: 12 });
  // inner shadow of the bob around the neck
  s.light(-0.3, (b) => b.ellipse(hx + 1, hy + 18, 13, 9, 1));
  // --- shoulders, bodice and gown (body block raised by 8px under the head)
  s.oy = -8;
  s.part(M.skin, (b) => b.poly([[34, 100], [42, 88], [56, 82], [68, 82], [82, 88], [90, 100], [88, 116], [36, 116]], 1), { r: 9, bias: -0.02 });
  s.light(-0.2, (b) => b.poly([[66, 80], [92, 80], [92, 118], [70, 118]], 1));
  s.part(GOWN, (b) => b.poly([[38, 120], [86, 118], [96, 146], [26, 146]], 1), { r: 8, tex: (x, y) => (hash2(x, y, 77) < 0.05 ? 0.4 : 0) });
  s.paint((b) => { b.line(70, 122, 78, 143, C.rose); b.line(71, 122, 79, 143, C.magenta); });
  s.part(BODICE, (b) => b.poly([[40, 102], [50, 98], [62, 103], [74, 98], [84, 102], [82, 122], [62, 126], [42, 122]], 1), { r: 6, cast: 0.25 });
  s.paint((b) => {
    b.line(42, 122, 62, 126, C.amber); b.line(62, 126, 82, 122, C.amber);
    b.line(40, 102, 50, 98, C.sodium); b.line(50, 98, 62, 103, C.amber); b.line(62, 103, 74, 98, C.amber); b.line(74, 98, 84, 102, C.sodium);
    b.line(62, 104, 62, 125, C.plum);
    for (const [x, y] of [[48, 108], [56, 116], [70, 108], [76, 116], [52, 104]] as Pt[]) b.set(x, y, C.rose);
  });
  // --- neck
  s.part(M.skin, (b) => b.poly([[54, 58], [66, 58], [67, 84], [55, 84]], 1), { r: 5, bias: -0.12 });
  s.light(-0.25, (b) => b.poly([[54, 58], [68, 58], [68, 66], [54, 64]], 1));
  // collarbones
  s.paint((b) => { b.line(48, 88, 56, 86, C.skinD); b.line(66, 86, 74, 88, C.skinD); });
  // choker with a gold coin
  s.part(BODICE, (b) => b.rect(54, 72, 14, 3, 1), { r: 1, cast: 0.15 });
  s.paint((b) => { b.circle(60, 76.5, 2, C.sodium); b.set(59, 75, C.amber); });
  // --- feather boa over the shoulders, ends dangling at both sides
  s.part(BOA, (b) => featherChain(b, boaPath, 4.6, 4.2), { r: 4, cast: 0.3, tex: (x, y) => (hash2(x >> 1, y >> 1, 12) < 0.12 ? 0.25 : hash2(x >> 1, y >> 1, 14) < 0.1 ? -0.22 : 0) });
  // --- far arm raised: gloved hand by the chin holding a gold credit card towards the viewer-left
  const hx2 = 36, hy2 = 74;
  s.part(M.skin, (b) => b.capsule(42, 96, 30, 114, 4, 1), { r: 4, cast: 0.25 });
  s.part(GLOVE, (b) => b.capsule(30, 114, hx2, hy2 + 4, 3.6, 1), { r: 4, cast: 0.25 });
  s.part(GLOVE, (b) => { b.ellipse(hx2, hy2, 4, 4.5, 1); b.capsule(hx2 - 1, hy2 - 2, hx2 - 3, hy2 - 8, 1.5, 1); }, { r: 2, cast: 0.25 });
  // the card: tilted, gold, with a chip and a magnetic stripe
  const card: Pt[] = [[hx2 - 18, hy2 - 18], [hx2 - 4, hy2 - 22], [hx2 - 1, hy2 - 12], [hx2 - 15, hy2 - 8]];
  s.part({ ramp: [C.rust, C.orange, C.sodium, C.amber], rim: null }, (b) => b.poly(card, 1), { r: 1.5, cast: 0.25, bias: 0.12 });
  s.paint((b) => {
    b.rect(hx2 - 14, hy2 - 17, 3, 3, C.umber); b.set(hx2 - 13, hy2 - 16, C.sodium);
    b.line(hx2 - 15, hy2 - 12, hx2 - 3, hy2 - 15, C.rust);
    b.set(hx2 - 5, hy2 - 21, C.white); b.set(hx2 - 4, hy2 - 21, C.white);
  });
  // thumb pinching the card corner
  s.part(GLOVE, (b) => b.capsule(hx2 - 3, hy2 - 1, hx2 - 6, hy2 - 9, 1.7, 1), { r: 2, cast: 0.2, bias: 0.06 });
  s.oy = 0;
  // --- face
  s.part(M.skin, (b) => {
    b.ellipse(hx, hy, 12, 13, 1);
    b.poly([[hx - 12, hy + 1], [hx - 10, hy + 9], [hx - 5, hy + 15], [hx + 1, hy + 16], [hx + 8, hy + 12], [hx + 12, hy + 2]], 1);
  }, { r: 8, bias: 0.12, cast: 0.3 });
  s.light(-0.3, (b) => b.poly([[hx + 5, hy + 2], [hx + 14, hy - 4], [hx + 14, hy + 20], [hx + 1, hy + 19], [hx + 7, hy + 10]], 1));
  luxFace(s, hx, hy, p2);
  // --- bangs: one heavy swoop over the forehead, falling to the far side
  s.part(HAIR_LUX, (b) => b.poly([
    [hx - 20, hy - 2], [hx - 16, hy - 16], [hx - 4, hy - 22], [hx + 10, hy - 20], [hx + 18, hy - 10],
    [hx + 14, hy - 4], [hx + 8, hy - 9], [hx + 2, hy - 6], [hx - 6, hy - 7], [hx - 12, hy - 2], [hx - 16, hy + 8],
  ], 1), { r: 7, bias: 0.04, cast: 0.2 });
  // gloss bands on the hair (key light upper left)
  s.paint((b) => {
    b.line(hx - 14, hy - 12, hx - 6, hy - 18, C.rose); b.line(hx - 13, hy - 11, hx - 5, hy - 17, C.rose);
    b.line(hx - 4, hy - 19, hx + 2, hy - 20, C.white); b.line(hx + 8, hy - 18, hx + 12, hy - 16, C.rose);
    b.line(hx - 15, hy - 4, hx - 10, hy - 8, C.grape); b.line(hx + 2, hy - 8, hx + 8, hy - 11, C.grape);
  });
  // gold star hair clip
  s.grid(`
    ..Y..
    .YSY.
    YSwSY
    .YSY.
    .Y.Y.`, legend({}), hx - 18, hy - 13);
  return s.resolve((b) => {
    // hologram: brighter scanline every 4 rows, sparse dropout lines at the bottom
    for (let y = 2; y < H; y += 4) for (let x = 0; x < W; x++) { const c = b.get(x, y); if (c && HOLO_UP[c]) b.set(x, y, HOLO_UP[c]); }
    for (let y = 128; y < H; y++) {
      const t = (y - 128) / 16;
      for (let x = 0; x < W; x++) if (b.get(x, y) && hash2(x >> 2, y, 5) < t * 0.7) b.set(x, y, 0);
      if (y % 3 === 0) for (let x = 0; x < W; x++) if (b.get(x, y) && t > 0.3) b.set(x, y, 0);
    }
    if (p2) {
      // glitch: shifted bands with a chromatic split on their edges
      for (const [y0, h, dx] of [[30, 3, 4], [47, 2, -3], [86, 4, 5], [118, 2, -4]] as const) {
        const strip = b.crop(0, y0, W, h);
        b.rect(0, y0, W, h, 0);
        b.blit(strip, dx, y0);
        for (let y = y0; y < y0 + h; y++) for (let x = 0; x < W; x++) {
          if (b.get(x, y) && !b.get(x - 1, y)) b.set(x, y, C.cyan);
          if (b.get(x, y) && !b.get(x + 1, y)) b.set(x, y, C.magenta);
        }
      }
    }
    // floating kiss hearts
    const heart = grid(`
      .mm.mm.
      mrrmmmm
      mrmmmmm
      .mmmmm.
      ..mmm..
      ...m...`, legend({}));
    b.blit(heart, 10, 38);
    b.blit(heart, 96, 18);
  });
}

function luxFace(s: Stage, hx: number, hy: number, p2: boolean): void {
  const lg = legend({ d: C.skinD, x: C.skinX, L: C.skinL, R: C.red, r: C.rose, M: C.maroon });
  const ey = hy + 1;
  if (!p2) {
    // half-lidded, long lashes flicking out at the outer corner; iris looks left (towards the viewer-left)
    s.grid(`
      .......k
      .kkkkkkk
      kkcIwwk.
      .kccpk..
      ..ddd...`, lg, hx - 4, ey - 1);
    s.grid(`
      k....
      kkkk.
      kcIk.
      .dd..`, lg, hx - 12, ey);
    s.paint((b) => { b.line(hx - 4, ey - 5, hx + 3, ey - 6, C.grape); b.line(hx - 12, ey - 4, hx - 8, ey - 5, C.grape); });
  } else {
    // narrowed, glaring
    s.grid(`
      kk......
      .kkkkkkk
      .kIcwwk.
      ..ddd...`, lg, hx - 4, ey);
    s.grid(`
      ...kk
      kkkk.
      kIk..
      .d...`, lg, hx - 12, ey);
    s.paint((b) => { b.line(hx - 4, ey - 2, hx + 3, ey - 5, C.plum); b.line(hx - 12, ey - 4, hx - 7, ey - 2, C.plum); });
  }
  // nose
  s.paint((b) => { b.set(hx - 9, ey + 4, C.skinD); b.set(hx - 9, ey + 5, C.skinD); b.set(hx - 8, ey + 6, C.skinD); b.set(hx - 10, ey + 6, C.skinX); });
  // blush, beauty mark
  s.paint((b) => { b.hline(hx + 1, hx + 3, ey + 6, C.rose); b.set(hx - 13, ey + 7, C.rose); b.set(hx - 2, ey + 12, C.ink); });
  // lips
  if (!p2) {
    s.grid(`
      ..R.R..
      .RrRRRM
      ..MMM..`, lg, hx - 11, hy + 12);
  } else {
    s.grid(`
      .RRRRR.
      RkwwwkR
      .kkkkk.
      ..MMM..`, lg, hx - 11, hy + 11);
  }
}

// ------------------------------------------------------------------ OCTOHYDRA

const CABLE: Mat = { ramp: [C.ink, C.abyss, C.teal, C.cyan], bias: -0.08 };
const SCALE_PURPLE: Mat = { ramp: [C.plum, C.grape, C.orchid, C.magenta], bias: -0.06 };
const SCALE_GREEN: Mat = { ramp: [C.moss, C.lime, C.acid], bias: -0.08, rim: [C.white, C.acid] };
const MONO: Mat = { ramp: [C.ink, C.night, C.navy, C.indigo, C.slate], bias: -0.1 };
const MOUTH: Mat = { ramp: [C.ink, C.maroon, C.red], bias: -0.1, rim: null };

function bez(p: Pt[], t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
    u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
  ];
}

/** Segmented data-cable neck along a cubic bezier (head end first). */
function cableNeck(s: Stage, ctrl: Pt[], r0: number, r1: number, glow: boolean): void {
  const n = 40;
  const neck = s.part(CABLE, (b) => {
    for (let i = 0; i < n; i++) {
      const a = bez(ctrl, i / n), c = bez(ctrl, (i + 1) / n);
      b.capsule(a[0], a[1], c[0], c[1], r0 + (r1 - r0) * (i / n), 1);
    }
  }, { r: 6, cast: 0.25 });
  // ring segments + glowing data nodes
  for (let i = 2; i < n; i += 4) {
    const a = bez(ctrl, i / n), c = bez(ctrl, (i + 0.6) / n);
    const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const r = r0 + (r1 - r0) * (i / n) + 1;
    s.light(-0.3, (b) => b.line(a[0] - dy / l * r, a[1] + dx / l * r, a[0] + dy / l * r, a[1] - dx / l * r, 1), neck);
    if (glow && i % 8 === 2) { const q = bez(ctrl, (i + 2) / n); s.px(Math.round(q[0]), Math.round(q[1]), C.acid); s.px(Math.round(q[0]) + 1, Math.round(q[1]), C.lime); }
  }
}

function biterHead(s: Stage, x0: number, y0: number, open: number, p2: boolean): void {
  // lower jaw, mouth interior, upper jaw/skull (facing left)
  const o = open;
  s.part(SCALE_PURPLE, (b) => b.poly([[x0 + 40, y0 + 10], [x0 + 24, y0 + 14 + o * 0.5], [x0 + 4, y0 + 18 + o], [x0, y0 + 22 + o], [x0 + 8, y0 + 25 + o], [x0 + 30, y0 + 22 + o * 0.5], [x0 + 44, y0 + 16]], 1), { r: 3, cast: 0.2, bias: -0.05 });
  s.part(MOUTH, (b) => b.poly([[x0 + 38, y0 + 8], [x0 + 4, y0 + 6 - o * 0.4], [x0 + 4, y0 + 19 + o], [x0 + 38, y0 + 13]], 1), { r: 3, cast: 0 });
  // tongue
  s.part({ ramp: [C.maroon, C.red, C.rose], rim: null }, (b) => b.capsule(x0 + 34, y0 + 12, x0 + 12, y0 + 14 + o * 0.6, 2, 1), { r: 2, cast: 0.1 });
  const skull = s.part(SCALE_PURPLE, (b) => {
    b.ellipse(x0 + 38, y0 + 2, 11, 9, 1);
    b.poly([[x0 + 40, y0 - 6], [x0 + 22, y0 - 6 - o * 0.3], [x0 + 6, y0 - 2 - o * 0.6], [x0, y0 + 2 - o * 0.6], [x0 + 2, y0 + 6 - o * 0.5], [x0 + 22, y0 + 6], [x0 + 46, y0 + 10]], 1);
  }, { r: 6, cast: 0.3 });
  // scale bands on the skull
  for (const k of [0, 1, 2]) s.light(-0.18, (b) => b.line(x0 + 26 + k * 6, y0 - 7, x0 + 22 + k * 6, y0 + 6, 1), skull);
  // brow spikes
  s.part(SCALE_PURPLE, (b) => { b.poly([[x0 + 28, y0 - 5], [x0 + 32, y0 - 16], [x0 + 36, y0 - 5]], 1); b.poly([[x0 + 36, y0 - 6], [x0 + 43, y0 - 15], [x0 + 45, y0 - 4]], 1); }, { r: 2, cast: 0.2, bias: -0.1 });
  // teeth: upper row pointing down, lower row pointing up
  s.paint((b) => {
    for (let k = 0; k < 7; k++) {
      const t = k / 7;
      const ux = Math.round(x0 + 5 + t * 30), uy = Math.round(y0 + 6 - o * 0.5 * (1 - t) + t * 1);
      b.set(ux, uy, C.white); b.set(ux + 1, uy, C.pale); b.set(ux, uy + 1, C.white); b.set(ux, uy + 2, C.pale);
      const lx = Math.round(x0 + 7 + t * 28), ly = Math.round(y0 + 18 + o * (1 - t) - t * 4);
      b.set(lx, ly, C.white); b.set(lx + 1, ly, C.pale); b.set(lx, ly - 1, C.white); b.set(lx, ly - 2, C.pale);
    }
  });
  // eye: sodium with a slit pupil under an angry brow
  s.paint((b) => {
    b.ellipse(x0 + 29, y0 - 1, 3, 2.2, p2 ? C.amber : C.sodium);
    b.vline(x0 + 28, y0 - 2, y0, C.ink);
    b.set(x0 + 30, y0 - 2, C.white);
    b.line(x0 + 25, y0 - 4, x0 + 33, y0 - 2, C.ink); b.line(x0 + 25, y0 - 5, x0 + 32, y0 - 4, C.plum);
    b.set(x0 + 4, y0 - 1 - Math.round(o * 0.6), C.ink); b.set(x0 + 5, y0 - 1 - Math.round(o * 0.6), C.ink);
  });
}

function spitterHead(s: Stage, x0: number, y0: number): void {
  // back frill, throat sacs, bulbous skull + snout
  s.part(SCALE_GREEN, (b) => { for (const [x, y, h] of [[10, -6, 9], [15, -9, 10], [20, -8, 8]] as const) b.poly([[x0 + x - 3, y0 + y + 6], [x0 + x + 2, y0 + y - h + 4], [x0 + x + 4, y0 + y + 6]], 1); }, { r: 2, cast: 0.1, bias: -0.15 });
  s.part(SCALE_GREEN, (b) => { b.ellipse(x0 + 4, y0 + 12, 7, 4.5, 1); b.ellipse(x0 + 13, y0 + 13, 6, 4, 1); }, { r: 4, cast: 0.2, bias: 0.08 });
  s.part(SCALE_GREEN, (b) => { b.ellipse(x0 + 10, y0, 11, 9, 1); b.ellipse(x0 - 2, y0 + 4, 7, 5.5, 1); }, { r: 6, cast: 0.3 });
  s.paint((b) => {
    for (const [x, y] of [[12, -5], [16, -1], [8, -6], [18, -5]] as Pt[]) { b.set(x0 + x, y0 + y, C.moss); b.set(x0 + x + 1, y0 + y, C.moss); }
    // eye
    b.ellipse(x0 + 3, y0 - 2, 2.6, 2.3, C.amber); b.set(x0 + 2, y0 - 2, C.ink); b.set(x0 + 2, y0 - 1, C.ink); b.set(x0 + 4, y0 - 3, C.white);
    // mouth + acid drip
    b.line(x0 - 8, y0 + 6, x0 + 2, y0 + 7, C.moss); b.set(x0 - 8, y0 + 5, C.ink);
    b.vline(x0 - 6, y0 + 8, y0 + 12, C.acid); b.set(x0 - 6, y0 + 14, C.acid); b.set(x0 - 6, y0 + 15, C.lime);
  });
}

function beamerHead(s: Stage, x0: number, y0: number, cracked: boolean): void {
  s.part(M.chrome, (b) => b.poly([[x0 + 16, y0 - 6], [x0 + 21, y0 - 16], [x0 + 25, y0 - 5]], 1), { r: 2, cast: 0.15, bias: -0.15 });
  s.part(IRON, (b) => b.poly([[x0 + 4, y0 + 6], [x0 + 32, y0 + 6], [x0 + 30, y0 + 12], [x0 + 6, y0 + 12]], 1), { r: 2, cast: 0.2, bias: 0.1 });
  s.part(M.chrome, (b) => b.poly([[x0 + 36, y0 - 2], [x0 + 28, y0 - 8], [x0 + 8, y0 - 8], [x0 - 2, y0 - 2], [x0 - 2, y0 + 6], [x0 + 34, y0 + 6]], 1), { r: 3, cast: 0.3 });
  s.paint((b) => {
    b.line(x0 + 26, y0 - 7, x0 + 28, y0 + 5, C.slate);
    for (let i = 0; i < 3; i++) b.hline(x0 + 14, x0 + 22, y0 - 2 + i * 2, C.slate);
    // big red lens at the front
    const lx = x0 + 5, ly = y0 - 1;
    b.circle(lx, ly, 5.5, C.ink);
    b.circle(lx, ly, 4.3, cracked ? C.maroon : C.red);
    b.circle(lx - 0.5, ly - 0.5, 2.6, cracked ? C.red : C.rose);
    b.set(lx - 2, ly - 2, C.white); b.set(lx - 1, ly - 2, C.white);
    if (cracked) { b.line(lx - 3, ly + 3, lx + 1, ly - 1, C.ink); b.line(lx + 1, ly - 1, lx + 3, ly - 4, C.ink); }
  });
}

function octohydra(p2: boolean): PixBuf {
  const s = new Stage([C.acid, C.lime]);
  // --- core monolith behind everything
  const mono: Pt[] = [[52, 146], [98, 146], [96, 62], [88, 50], [62, 50], [54, 62]];
  s.part(MONO, (b) => b.poly(mono, 1), { r: 3, cast: 0 });
  const plate = s.part({ ramp: [C.ink, C.night, C.navy] }, (b) => b.poly([[60, 140], [90, 140], [89, 64], [84, 57], [66, 57], [61, 64]], 1), { r: 2, cast: 0 });
  s.paint((b) => {
    for (let x = 63; x <= 87; x += 3) for (let y = 66; y < 140; y++) {
      const h = hash2(x, y >> 2, 77);
      if (h < 0.2) b.set(x, y, h < 0.06 ? C.acid : C.moss);
    }
  }, plate);
  // shield frame (dashed acid line) or exposed core
  s.paint((b) => {
    const eyeR = p2 ? 9 : 6;
    b.circle(75, 80, eyeR + 2, C.ink);
    b.circle(75, 80, eyeR, C.moss);
    b.circle(75, 80, eyeR - 2, C.lime);
    b.circle(75, 80, eyeR - 4, C.acid);
    b.circle(74, 79, Math.max(1, eyeR - 6), C.white);
    if (!p2) {
      for (let i = 0; i < mono.length; i++) {
        const a = mono[i], c = mono[(i + 1) % mono.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        for (let d = 0; d < len; d += 1) if ((Math.floor(d) >> 1) % 2 === 0) b.set(Math.round(a[0] + (c[0] - a[0]) * d / len - (a[0] > 75 ? 2 : -2)), Math.round(a[1] + (c[1] - a[1]) * d / len + 2), C.acid);
      }
    } else {
      // cracked shield shards around the eye
      b.line(64, 70, 70, 76, C.acid); b.line(86, 70, 80, 76, C.acid); b.line(66, 94, 71, 88, C.lime); b.line(84, 92, 80, 87, C.lime);
    }
  }, s.mask((b) => b.poly(mono, 1)));
  // --- necks rising out of the water
  cableNeck(s, [[96, 24], [114, 52], [84, 88], [100, 146]], 5, 7.5, true);
  if (!p2) cableNeck(s, [[30, 30], [50, 56], [6, 92], [28, 146]], 4.5, 7, true);
  cableNeck(s, [[52, 64], [74, 82], [34, 108], [58, 146]], 7, 9, true);
  // --- heads: spitter (back left), beamer (back right), biter (front, lunging left)
  if (!p2) spitterHead(s, 22, 22);
  else {
    // burnt stump where the spitter was
    s.part(CABLE, (b) => b.capsule(30, 92, 24, 146, 7.5, 1), { r: 5, cast: 0.2, bias: -0.15 });
    s.paint((b) => {
      b.ellipse(30, 92, 7, 3, C.ink); b.ellipse(30, 92, 5, 2, C.umber); b.hline(28, 31, 92, C.orange); b.set(29, 91, C.sodium);
      b.line(27, 91, 22, 84, C.slate); b.set(22, 83, C.acid); b.set(21, 82, C.white);
      b.line(33, 91, 37, 85, C.slate); b.set(37, 84, C.ice);
      b.line(30, 90, 30, 86, C.steel); b.set(30, 85, C.amber);
    });
  }
  beamerHead(s, 72, 20, p2);
  biterHead(s, 8, 56, p2 ? 10 : 6, p2);
  // --- flooded floor
  const water = s.part({ ramp: [C.ink, C.abyss, C.teal], rim: null }, (b) => b.rect(0, 130, W, 14, 1), { r: 2, cast: 0, bias: -0.1 });
  s.paint((b) => {
    for (let y = 131; y < H; y += 3) for (let x = 0; x < W; x++) {
      const h = hash2(x >> 2, y, 7);
      if (h < 0.3) b.set(x, y, h < 0.1 ? C.cyan : C.teal);
    }
    // necks reflected as ripples
    for (const x of [30, 56, 102]) { if (p2 && x === 30) continue; b.hline(x - 9, x + 9, 131, C.cyan); b.hline(x - 6, x + 6, 133, C.teal); }
    if (p2) {
      // live current in the water
      let x = 2, y = 136;
      while (x < W - 2) { const nx = x + 4 + Math.floor(hash2(x, y, 3) * 5), ny = 133 + Math.floor(hash2(x, 9, 4) * 9); b.line(x, y, nx, ny, C.acid); x = nx; y = ny; }
    }
  }, water);
  return s.resolve((b) => {
    if (p2) {
      // sparks around the biter and the stump
      for (const [x, y] of [[18, 94], [36, 88], [10, 52], [60, 48]] as Pt[]) { b.set(x, y, C.acid); b.set(x + 1, y - 1, C.white); b.set(x - 1, y + 1, C.lime); }
    }
  });
}

// ------------------------------------------------------------------ DIRECTOR KADE

const ARMOR: Mat = { ramp: [C.slate, C.steel, C.fog, C.pale, C.white], bias: 0.02 };
const SUIT: Mat = { ramp: [C.ink, C.night, C.navy, C.indigo, C.slate], bias: -0.05 };
const GOLD: Mat = { ramp: [C.rust, C.orange, C.sodium, C.amber], bias: 0.05, rim: [C.white, C.amber] };

/** Thin gold trim along the lower edge of a mask. */
function trimBottom(s: Stage, m: Mask, c: number, c2: number): void {
  s.paint((b) => {
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      if (!m.has(x, y)) continue;
      if (!m.has(x, y + 1)) b.set(x, y, c2);
      else if (!m.has(x, y + 2)) b.set(x, y, c);
    }
  });
}

function drone(s: Stage, x: number, y: number, broken: boolean): void {
  s.part(IRON, (b) => b.rect(x - 9, y - 6, 18, 2, 1), { r: 1, cast: 0 });
  s.part(ARMOR, (b) => { b.ellipse(x, y, 7, 4.5, 1); b.rect(x - 1, y - 5, 2, 2, 1); }, { r: 3, cast: 0.2 });
  s.paint((b) => {
    b.hline(x - 6, x + 6, y + 2, C.sodium);
    b.rect(x - 4, y - 1, 3, 2, broken ? C.maroon : C.red); b.set(x - 4, y - 1, broken ? C.ink : C.rose);
    b.set(x - 10, y - 6, C.fog); b.set(x + 9, y - 6, C.fog);
  });
}

function kade(p2: boolean): PixBuf {
  const s = new Stage([C.amber, C.sodium]);
  // --- power pack on the back, poking up behind the near shoulder
  s.part(M.steel, (b) => { b.poly([[78, 44], [100, 40], [106, 46], [106, 76], [80, 78]], 1); b.rect(96, 22, 3, 20, 1); }, { r: 3, cast: 0 });
  s.paint((b) => {
    for (const y of [50, 56, 62]) b.hline(84, 102, y, C.slate);
    b.set(97, 21, p2 ? C.orange : C.red); b.set(97, 20, p2 ? C.sodium : C.rose);
    for (const y of [50, 56, 62]) { b.set(102, y + 2, p2 ? C.orange : C.sodium); b.set(103, y + 2, p2 ? C.red : C.amber); }
  });
  // --- under-suit (dark), visible at the joints
  s.part(SUIT, (b) => b.poly([[24, 84], [40, 66], [76, 66], [96, 84], [94, 144], [22, 144]], 1), { r: 8 });
  // --- chest + abdominal plates
  const chest = s.part(ARMOR, (b) => b.poly([[36, 72], [80, 72], [88, 92], [84, 114], [58, 120], [32, 114], [28, 92]], 1), { r: 7 });
  s.light(-0.16, (b) => b.poly([[60, 70], [92, 70], [92, 120], [60, 122]], 1), chest);
  s.paint((b) => { b.line(58, 74, 58, 118, C.steel); b.line(57, 74, 57, 118, C.pale); }, chest);
  trimBottom(s, chest, C.amber, C.sodium);
  for (let k = 0; k < 3; k++) {
    const y = 122 + k * 8;
    const plate = s.part(ARMOR, (b) => b.poly([[36 + k, y], [80 - k, y], [78 - k, y + 6], [38 + k, y + 6]], 1), { r: 3, cast: 0.25, bias: -0.04 * k });
    s.light(-0.14, (b) => b.rect(60, y, 30, 7, 1), plate);
  }
  // Halcyon halo emblem
  s.paint((b) => {
    b.ring(52, 92, 5.5, C.sodium, 2); b.ring(52, 92, 5, C.amber, 1);
    b.set(50, 89, C.white); b.circle(52, 92, 1.5, C.pale);
  });
  // --- neck seal
  s.part(SUIT, (b) => b.poly([[46, 54], [70, 54], [72, 72], [44, 72]], 1), { r: 4, bias: 0.04 });
  s.paint((b) => { for (let y = 58; y < 72; y += 3) b.hline(47, 70, y, C.night); });
  // --- pauldrons: far (left, smaller) and near (right, bigger), gold trim on the rims
  const farP = s.part(ARMOR, (b) => b.ellipse(26, 82, 15, 12, 1), { r: 6, cast: 0.25, bias: 0.04 });
  trimBottom(s, farP, C.amber, C.sodium);
  s.part(ARMOR, (b) => b.ellipse(24, 92, 12, 5, 1), { r: 3, cast: 0.2, bias: -0.06, clip: s.mask((b) => b.rect(0, 92, 60, 10, 1)) });
  const nearP = s.part(ARMOR, (b) => b.ellipse(90, 80, 19, 14, 1), { r: 7, cast: 0.3 });
  s.light(-0.1, (b) => b.rect(92, 60, 30, 40, 1), nearP);
  trimBottom(s, nearP, C.amber, C.sodium);
  s.paint((b) => { b.line(76, 76, 104, 70, C.steel); b.line(76, 75, 104, 69, C.pale); for (const x of [80, 92, 102]) { b.set(x, 84, C.steel); } });
  // --- near arm hangs down at the side (upper arm only, cropped)
  s.part(SUIT, (b) => b.capsule(94, 96, 98, 146, 8, 1), { r: 6, cast: 0.2 });
  s.part(ARMOR, (b) => b.capsule(95, 100, 98, 128, 8.5, 1), { r: 5, cast: 0.25, bias: -0.06 });
  s.paint((b) => { b.hline(88, 106, 118, C.sodium); b.hline(88, 106, 119, C.rust); }, s.mask((b) => b.capsule(95, 100, 98, 128, 8.5, 1)));
  // --- shield arm (far side) raised in front: forearm with the emitter gauntlet
  s.part(SUIT, (b) => b.capsule(24, 96, 16, 118, 6, 1), { r: 5, cast: 0.2 });
  const gaunt = s.part(ARMOR, (b) => b.capsule(18, 118, 34, 104, 7.5, 1), { r: 5, cast: 0.3, bias: 0.04 });
  trimBottom(s, gaunt, C.amber, C.sodium);
  s.paint((b) => {
    b.circle(24, 112, 4.5, C.ink);
    b.circle(24, 112, 3.5, p2 ? C.rust : C.sodium);
    b.circle(24, 112, 2, p2 ? C.orange : C.amber);
    b.set(23, 111, p2 ? C.ice : C.white);
    if (p2) { b.line(21, 109, 27, 115, C.ink); b.set(28, 108, C.ice); b.set(29, 107, C.white); }
  });
  // --- helmet
  const hx = 56, hy = 36;
  const helm = s.part(ARMOR, (b) => {
    b.ellipse(hx, hy, 15, 16, 1);
    b.poly([[hx - 15, hy + 2], [hx - 13, hy + 16], [hx - 6, hy + 22], [hx + 8, hy + 22], [hx + 15, hy + 14], [hx + 15, hy]], 1);
  }, { r: 9, cast: 0.3, bias: 0.04 });
  s.light(-0.18, (b) => b.poly([[hx + 6, hy - 18], [hx + 18, hy - 8], [hx + 18, hy + 24], [hx + 8, hy + 24]], 1), helm);
  // side ear module with a sodium status light
  s.part(M.steel, (b) => b.ellipse(hx + 9, hy + 6, 4.5, 6, 1), { r: 2, cast: 0.2, bias: 0.05 });
  s.paint((b) => { b.circle(hx + 9, hy + 6, 2, C.slate); b.set(hx + 9, hy + 6, p2 ? C.red : C.sodium); });
  // visor band wrapping the front, red glow
  s.paint((b) => {
    b.poly([[hx - 16, hy - 2], [hx + 5, hy - 3], [hx + 5, hy + 4], [hx - 15, hy + 5]], C.red);
    b.line(hx - 15, hy - 2, hx + 4, hy - 3, C.rose);
    b.line(hx - 15, hy + 5, hx + 4, hy + 4, C.maroon);
    b.hline(hx - 13, hx - 9, hy, C.rose);
    b.set(hx - 12, hy - 1, C.white); b.set(hx - 11, hy - 1, C.white);
    if (p2) { b.line(hx - 6, hy - 2, hx - 3, hy + 4, C.ink); b.line(hx - 3, hy + 4, hx, hy + 1, C.ink); b.hline(hx - 14, hx + 3, hy + 1, C.rose); }
  });
  // jaw guard vents
  s.paint((b) => {
    for (let x = hx - 12; x <= hx + 2; x += 3) b.vline(x, hy + 10, hy + 16, p2 ? C.orange : C.steel);
    b.line(hx - 14, hy + 8, hx + 6, hy + 8, C.steel);
  });
  // gold crest fin sweeping back
  s.part(GOLD, (b) => b.poly([[hx - 10, hy - 12], [hx - 2, hy - 22], [hx + 10, hy - 24], [hx + 22, hy - 20], [hx + 8, hy - 15], [hx - 2, hy - 9]], 1), { r: 2, cast: 0.3 });
  s.paint((b) => b.line(hx - 6, hy - 14, hx + 12, hy - 21, C.amber));
  // --- energy shield in front (P1): a hex lattice projected from the emitter (see-through cells)
  if (!p2) {
    const shield = s.mask((b) => b.ellipse(-2, 98, 22, 50, 1));
    s.paint((b) => {
      const R = 7;
      for (let y = 40; y < H; y++) for (let x = 0; x < 30; x++) {
        if (!shield.has(x, y)) continue;
        // pointy-top hex cells: cube-rounding distance to the cell centre
        const px = x + 0.5, py = y + 0.5;
        const q = ((Math.sqrt(3) / 3) * px - py / 3) / R, r = ((2 / 3) * py) / R;
        const cx = q, cz = r, cy = -q - r;
        let rx = Math.round(cx), ry = Math.round(cy), rz = Math.round(cz);
        const ex = Math.abs(rx - cx), ey = Math.abs(ry - cy), ez = Math.abs(rz - cz);
        if (ex > ey && ex > ez) rx = -ry - rz; else if (ey > ez) ry = -rx - rz; else rz = -rx - ry;
        const d = Math.max(Math.abs(rx - cx), Math.abs(ry - cy), Math.abs(rz - cz));
        // lines fade from the bright rim inwards: sodium near the edge, rust deeper in, gaps further in
        const depth = 1 - Math.hypot((px + 2) / 22, (py - 98) / 50);
        if (d > 0.42 && depth < 0.34) b.set(x, y, depth < 0.14 ? C.sodium : C.orange);
      }
      // bright outer edge
      for (let y = 40; y < H; y++) for (let x = 0; x < 30; x++) {
        if (shield.has(x, y) && !shield.has(x + 1, y)) { b.set(x, y, C.amber); b.set(x - 1, y, C.sodium); }
      }
    }, shield);
  }
  // --- support drones
  drone(s, 16, 26, p2);
  if (!p2) drone(s, 104, 104, false);
  return s.resolve((b) => {
    if (p2) {
      // cracks + chipped plates + exposed wiring at the near shoulder
      for (const [x0, y0, x1, y1] of [[40, 80, 46, 90], [46, 90, 44, 98], [86, 70, 92, 80], [92, 80, 100, 82], [hx - 2, hy - 10, hx + 4, hy - 4]] as const) b.line(x0, y0, x1, y1, C.ink);
      b.line(100, 92, 104, 104, C.red); b.line(101, 92, 106, 103, C.teal); b.set(104, 105, C.white); b.set(106, 104, C.ice);
      for (const [x, y] of [[30, 76], [70, 100], [82, 128]] as Pt[]) { b.set(x, y, C.slate); b.set(x + 1, y, C.steel); b.set(x, y + 1, C.steel); }
      // overload glow seeping from the chest seams
      b.hline(40, 76, 121, C.orange); b.hline(42, 74, 129, C.red);
    }
  });
}

// ------------------------------------------------------------------ VESPER

const COAT_V: Mat = { ramp: [C.ink, C.night, C.navy, C.indigo, C.slate], bias: -0.06 };
const HAIR_V: Mat = { ramp: [C.slate, C.steel, C.fog, C.pale, C.white], bias: 0.06, rim: [C.white, C.pale] };
const SKIN_V: Mat = { ramp: [C.skinD, C.skinM, C.skinL], bias: 0.16 };
const GUN_V: Mat = { ramp: [C.ink, C.night, C.navy, C.slate, C.steel], bias: 0, rim: [C.pale, C.steel] };
const GLOVE_V: Mat = { ramp: [C.ink, C.night, C.navy, C.indigo], bias: 0 };
const BACK_V: Mat = { ramp: [C.ink, C.night, C.navy], bias: -0.2, rim: [C.indigo], back: true };

/** P1: a gantry beam overhead and city lights smeared into speed streaks. P2: a dark tunnel. */
function vesperBackdrop(s: Stage, p2: boolean): void {
  if (!p2) {
    // gantry truss overhead (the arena hazard), red warning lamps
    s.part(BACK_V, (b) => {
      b.rect(0, 4, W, 3, 1); b.rect(0, 14, W, 3, 1);
      for (let x = 0; x < W; x += 10) { b.line(x, 6, x + 5, 14, 1); b.line(x + 5, 14, x + 10, 6, 1); }
    }, { r: 1, cast: 0 });
    s.paint((b) => { for (const x of [8, 56, 104]) { b.set(x, 10, C.red); b.set(x + 1, 10, C.rose); } });
    // speed streaks behind the shoulders
    const streaks: [number, number, number, number][] = [
      [0, 62, 30, C.sodium], [2, 76, 22, C.rose], [0, 92, 36, C.ice], [4, 110, 26, C.sodium], [0, 126, 30, C.pale],
      [80, 58, 32, C.ice], [86, 72, 26, C.sodium], [78, 120, 34, C.rose], [84, 134, 28, C.ice], [70, 40, 42, C.pale],
    ];
    for (const [x, y, len] of streaks) s.part(BACK_V, (b) => b.capsule(x, y, x + len, y, 1.3, 1), { r: 1, cast: 0 });
    s.paint((b) => {
      for (const [x, y, len, c] of streaks) {
        b.hline(x + 2, x + len - 4, y, c);
        b.hline(x + len - 8, x + len - 3, y, c === C.sodium ? C.amber : C.white);
      }
    });
  } else {
    // tunnel: ribbed arch segments, sparse lamps streaking past
    s.part(BACK_V, (b) => {
      b.ring(56, 112, 68, 1, 7);
      b.ring(56, 112, 54, 1, 3);
      b.rect(0, 120, 10, 24, 1); b.rect(102, 118, 10, 26, 1);
    }, { r: 2, cast: 0 });
    s.paint((b) => {
      for (const [x, y] of [[12, 70], [100, 64], [30, 48], [80, 46], [6, 100]] as Pt[]) { b.hline(x - 4, x + 3, y, C.orange); b.hline(x, x + 3, y, C.amber); }
    }, s.mask((b) => b.ring(56, 112, 68, 1, 7)));
  }
}

function vesper(p2: boolean): PixBuf {
  const s = new Stage([C.red, C.maroon]);
  vesperBackdrop(s, p2);
  const hx = 58, hy = 40;
  // --- hair, back mass: a sharp platinum bob cut level at the jaw
  s.part(HAIR_V, (b) => {
    b.ellipse(hx + 3, hy - 4, 17.5, 17, 1);
    b.poly([[hx + 4, hy - 6], [hx + 20, hy - 4], [hx + 21, hy + 12], [hx + 6, hy + 17]], 1);
  }, { r: 10 });
  s.paint((b) => { for (const [x0, x1] of [[hx + 8, hx + 9], [hx + 13, hx + 15], [hx + 18, hx + 20]] as const) b.line(x0, hy - 8, x1, hy + 12, C.steel); });
  s.light(-0.3, (b) => b.ellipse(hx + 4, hy + 14, 12, 6, 1));
  // --- coat: slim shoulders, long and dark
  const coat = s.part(COAT_V, (b) => b.poly([[24, 104], [32, 86], [46, 78], [70, 78], [86, 82], [94, 96], [98, 144], [20, 144]], 1), { r: 8 });
  s.light(-0.14, (b) => b.poly([[66, 76], [100, 76], [100, 144], [62, 144]], 1), coat);
  // lapels + clasps + red piping down the closure
  s.part(COAT_V, (b) => b.poly([[46, 80], [58, 82], [52, 112], [44, 144], [34, 144], [40, 108]], 1), { r: 3, bias: 0.08 });
  s.paint((b) => {
    b.line(58, 82, 52, 112, C.maroon); b.line(52, 112, 44, 143, C.maroon);
    for (const y of [96, 108, 120]) { b.set(56 - (y - 96) / 4, y, C.steel); b.set(57 - (y - 96) / 4, y, C.fog); }
  });
  // --- neck + tall collar
  s.part(SKIN_V, (b) => b.poly([[52, 52], [64, 52], [65, 74], [53, 74]], 1), { r: 5, bias: -0.25 });
  s.part(COAT_V, (b) => b.poly([[44, 62], [52, 70], [66, 70], [74, 60], [78, 80], [46, 82]], 1), { r: 4, bias: 0.05 });
  s.paint((b) => { b.line(44, 62, 52, 70, C.red); b.hline(52, 66, 70, C.maroon); });
  // rifle sling across the chest (near shoulder -> far hip)
  s.part({ ramp: [C.ink, C.umber, C.maroon, C.red], bias: -0.1 }, (b) => b.poly([[80, 80], [86, 84], [38, 144], [30, 144]], 1), { r: 1.5, cast: 0.2 });
  s.paint((b) => { b.rect(60, 108, 4, 5, C.steel); b.set(60, 108, C.pale); b.rect(61, 110, 2, 2, C.ink); });
  // --- near arm (viewer-right) holding the rifle on the shoulder; red Halcyon armband
  const arm = s.part(COAT_V, (b) => b.capsule(86, 86, 92, 114, 7, 1), { r: 6, cast: 0.25 });
  s.part({ ramp: [C.maroon, C.red, C.rose], rim: [C.rose, C.red] }, (b) => b.capsule(82, 98, 97, 96, 3, 1), { r: 2, clip: arm, cast: 0.2 });
  s.paint((b) => { b.ring(89.5, 97.5, 2.2, C.white, 1); b.set(89, 97, C.red); });
  s.part(COAT_V, (b) => b.capsule(92, 114, 80, 104, 6, 1), { r: 5, cast: 0.25 });
  // --- rifle over the shoulder: stock low at the front, long barrel up and back past the frame
  const g0: Pt = [74, 120], g1: Pt = [111, 2];
  const dl = Math.hypot(g1[0] - g0[0], g1[1] - g0[1]);
  const ux = (g1[0] - g0[0]) / dl, uy = (g1[1] - g0[1]) / dl;
  const at = (t: number, off = 0): Pt => [g0[0] + (g1[0] - g0[0]) * t - uy * off, g0[1] + (g1[1] - g0[1]) * t + ux * off];
  const [ax, ay] = at(0), [bx, by] = at(0.42), [cx, cy] = at(0.42), [dx, dy] = at(1);
  s.part(GUN_V, (b) => { b.capsule(ax, ay, bx, by, 3.4, 1); b.poly([at(0.05, -4), at(0.2, -4), at(0.2, 3), at(0.05, 3)], 1); }, { r: 3, cast: 0.3 });
  s.part(GUN_V, (b) => b.capsule(cx, cy, dx, dy, 1.6, 1), { r: 2, cast: 0.25, bias: 0.06 });
  // scope on the head side, muzzle brake
  const [s0x, s0y] = at(0.3, -5), [s1x, s1y] = at(0.48, -5);
  s.part(GUN_V, (b) => { b.capsule(s0x, s0y, s1x, s1y, 2.4, 1); b.capsule(...at(0.36, -1), ...at(0.36, -4), 1, 1); }, { r: 2, cast: 0.25, bias: 0.08 });
  s.paint((b) => { const [lx, ly] = at(0.49, -5); b.set(Math.round(lx), Math.round(ly), C.red); b.set(Math.round(lx) - 1, Math.round(ly), C.rose); });
  s.part(GUN_V, (b) => b.capsule(...at(0.93), ...at(0.99), 2.4, 1), { r: 1.5, cast: 0.15 });
  if (p2) {
    // overcharged barrel: heat glow climbing towards the muzzle
    s.paint((b) => {
      for (let t = 0.44; t <= 0.99; t += 0.004) {
        const [x, y] = at(t);
        const c = t > 0.9 ? C.white : t > 0.78 ? C.amber : t > 0.62 ? C.sodium : C.orange;
        b.set(Math.round(x), Math.round(y), c);
        if (t > 0.7) b.set(Math.round(x) + 1, Math.round(y), t > 0.9 ? C.amber : C.orange);
      }
    });
  } else {
    s.paint((b) => { for (let t = 0.46; t < 0.92; t += 0.08) { const [x, y] = at(t, 1); b.set(Math.round(x), Math.round(y), C.steel); } });
  }
  // gloved hand on the grip
  s.part(GLOVE_V, (b) => { b.ellipse(79, 103, 4.5, 4, 1); b.capsule(76, 101, 74, 96, 1.6, 1); }, { r: 2, cast: 0.25 });
  // --- face
  s.part(SKIN_V, (b) => {
    b.ellipse(hx, hy, 12, 13.5, 1);
    b.poly([[hx - 12, hy + 1], [hx - 10, hy + 10], [hx - 5, hy + 16], [hx + 2, hy + 17], [hx + 9, hy + 11], [hx + 12, hy + 2]], 1);
  }, { r: 8, bias: 0.08, cast: 0.3 });
  s.light(-0.32, (b) => b.poly([[hx + 5, hy + 2], [hx + 14, hy - 4], [hx + 14, hy + 20], [hx + 1, hy + 19], [hx + 7, hy + 10]], 1));
  vesperFace(s, hx, hy, p2);
  // front lock of the A-line bob: longer at the front, cut at an angle below the jaw
  s.part(HAIR_V, (b) => b.poly([[hx - 17, hy - 6], [hx - 10, hy - 6], [hx - 9, hy + 12], [hx - 12, hy + 19], [hx - 18, hy + 15]], 1), { r: 4, bias: 0.04, cast: 0.25 });
  s.paint((b) => { b.line(hx - 14, hy - 4, hx - 15, hy + 14, C.steel); b.line(hx - 11, hy - 2, hx - 11, hy + 14, C.fog); });
  // --- fringe: long and straight, swept over the front of the face
  s.part(HAIR_V, (b) => b.poly([
    [hx - 18, hy + 2], [hx - 15, hy - 14], [hx - 4, hy - 21], [hx + 10, hy - 19], [hx + 18, hy - 10],
    [hx + 14, hy - 6], [hx + 6, hy - 8], [hx - 2, hy - 6], [hx - 9, hy - 4], [hx - 13, hy + 4],
  ], 1), { r: 6, bias: 0.06, cast: 0.25 });
  s.paint((b) => {
    b.line(hx - 12, hy - 13, hx - 3, hy - 19, C.white); b.line(hx - 11, hy - 12, hx - 2, hy - 18, C.white);
    b.line(hx + 4, hy - 17, hx + 10, hy - 15, C.pale);
    b.line(hx - 14, hy - 2, hx - 8, hy - 8, C.steel); b.line(hx + 2, hy - 9, hx + 10, hy - 12, C.steel);
  });
  return s.resolve((b) => {
    if (p2) {
      // torn coat: notches out of the silhouette and a slash across the front showing the red lining
      for (const [x, y, w] of [[22, 116, 4], [21, 132, 5], [96, 128, 3]] as const) b.poly([[x - 1, y - w], [x + w, y], [x - 1, y + w]], 0);
      b.line(30, 112, 46, 124, C.ink); b.line(31, 114, 45, 125, C.maroon); b.line(33, 116, 43, 124, C.red);
      // sparks off the barrel and the broken visor
      for (const [x, y] of [[104, 20], [98, 36], [108, 12], [46, 36]] as Pt[]) { b.set(x, y, C.amber); b.set(x + 1, y - 1, C.white); }
    }
  });
}

function vesperFace(s: Stage, hx: number, hy: number, p2: boolean): void {
  const lg = legend({ d: C.skinD, m: C.skinM, x: C.skinX, R: C.red, r: C.rose, M: C.maroon, P: C.pale });
  const vy = hy + 2;
  // P2: the near half of the visor is broken off
  const visorClip = p2 ? s.mask((b) => { b.rect(0, 0, hx - 4, H, 1); b.rect(hx + 6, 0, W, H, 1); }) : undefined;
  // visor band wrapping from the front of the face round to the ear module
  s.paint((b) => {
    b.poly([[hx - 14, vy], [hx + 13, vy - 2], [hx + 13, vy + 4], [hx - 13, vy + 5]], C.red);
    b.line(hx - 14, vy, hx + 12, vy - 2, C.rose);
    b.line(hx - 13, vy + 5, hx + 12, vy + 4, C.maroon);
    b.hline(hx - 11, hx - 6, vy + 1, C.rose);
    b.set(hx - 10, vy, C.white); b.set(hx - 9, vy, C.white);
  }, visorClip);
  // ear module holding the visor
  s.part(GUN_V, (b) => b.ellipse(hx + 10, vy + 3, 3.5, 4.5, 1), { r: 2, cast: 0.2, bias: 0.1 });
  s.paint((b) => { b.set(hx + 10, vy + 3, C.red); b.set(hx + 10, vy + 2, C.rose); });
  if (p2) {
    // one cold eye shows through the gap, red iris; crack lines through the rest of the visor
    s.grid(`
      kkkkkkk
      kPRrPPk
      .kdddk.`, lg, hx - 3, vy + 1);
    s.paint((b) => {
      b.line(hx - 4, vy - 1, hx - 6, vy + 5, C.ink); b.line(hx - 9, vy + 4, hx - 7, vy, C.ink);
      b.line(hx + 6, vy - 1, hx + 7, vy + 4, C.ink);
      b.line(hx - 3, vy - 3, hx + 5, vy - 3, C.steel);
    });
  }
  // nose, cheek, mouth: cold, a thin straight line
  s.paint((b) => {
    b.set(hx - 10, hy + 6, C.skinM); b.set(hx - 10, hy + 7, C.skinD); b.set(hx - 9, hy + 8, C.skinD);
    b.hline(hx - 8, hx - 4, hy + 13, p2 ? C.skinX : C.skinD); b.set(hx - 8, hy + 13, C.skinX);
    if (p2) { b.set(hx - 10, hy + 12, C.skinX); b.set(hx - 3, hy + 14, C.red); }
  });
}

// ------------------------------------------------------------------ registry

export function buildStandeeArt(): SheetSpec[] {
  const frames: { name: string; buf: PixBuf }[] = [
    { name: 'echo', buf: echo('normal') },
    { name: 'echo_hurt', buf: echo('hurt') },
    { name: 'echo_win', buf: echo('win') },
    { name: 'gearjaw', buf: gearjaw(false) },
    { name: 'gearjaw_p2', buf: gearjaw(true) },
    { name: 'lux', buf: lux(false) },
    { name: 'lux_p2', buf: lux(true) },
    { name: 'octohydra', buf: octohydra(false) },
    { name: 'octohydra_p2', buf: octohydra(true) },
    { name: 'kade', buf: kade(false) },
    { name: 'kade_p2', buf: kade(true) },
    { name: 'vesper', buf: vesper(false) },
    { name: 'vesper_p2', buf: vesper(true) },
    ...buildExpansionStandeeFrames(),
  ];
  return [{
    key: 'standee', group: 'Standees', frameW: W, frameH: H, columns: 6, frames,
    meta: { note: 'Half-body portraits. Echo faces right, bosses face left. Key light upper left, rim on the right.' },
  }];
}

