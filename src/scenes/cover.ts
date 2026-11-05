/**
 * Cover / key art composition (640x360). Used by CoverScene (static export) and TitleScene (animated).
 *
 * Back to front: sky, searchlights, far skyline, Lux hologram, Gearjaw, Octohydra, haze,
 * mid skyline + neon, street reflections, wet street, near buildings + signs, Echo, rain, title.
 */
import Phaser from 'phaser';
import { COVER_LAYOUT, FAR_Y, HORIZON, MID_Y } from '../art/cover';
import { P } from '../engine/gfx';
import { C } from '../art/palette';
import { PixBuf } from '../art/core/pixbuf';
import { bayer, hash2, mulberry32 } from '../art/core/rng';
import { renderSheet } from '../art/core/sheet';

const ADD = Phaser.BlendModes.ADD;

export interface Cover { update(dt: number): void }

// ------------------------------------------------------------------ pixel lettering
/**
 * FusionPixel glyphs as exact 12px bitmaps. Chromium draws the font with fractional horizontal
 * offsets (vertical strokes smear over two pixels), so we render at 8x and sample the centre
 * of each glyph pixel cell.
 */
const K = 8;
interface Bits { w: number; h: number; on: Uint8Array }

function glyphBits(ch: string): Bits {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = `${12 * K}px FusionPixel`;
  ctx.font = font;
  const adv = Math.max(1, Math.round(ctx.measureText(ch).width / K));
  const gw = adv + 2, gh = 14;
  c.width = gw * K; c.height = gh * K;
  ctx.font = font; ctx.textBaseline = 'top'; ctx.fillStyle = '#fff';
  ctx.fillText(ch, K, K);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const alpha = (x: number, y: number) => d[(y * c.width + x) * 4 + 3];
  // glyph pixel boundaries sit at the first ink column/row + n*K: sample in the middle of each cell
  let ex = c.width, ey = c.height;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (alpha(x, y) >= 128) { ex = Math.min(ex, x); ey = Math.min(ey, y); }
  const ox = (ex + K / 2) % K, oy = (ey + K / 2) % K;
  const on = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const sx = gx * K + ox, sy = gy * K + oy;
    on[gy * gw + gx] = sx < c.width && sy < c.height && alpha(sx, sy) >= 128 ? 1 : 0;
  }
  return { w: gw, h: gh, on };
}

/** Lay glyphs out left to right with `gap` empty columns between their ink boxes; empty rows are trimmed. */
function wordBits(str: string, gap: number): Bits {
  const glyphs = [...str].map(glyphBits);
  const h = glyphs[0].h;
  const boxes = glyphs.map((g) => {
    let x0 = g.w, x1 = -1;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.on[y * g.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    return x1 < 0 ? [0, 3] : [x0, x1];
  });
  const w = boxes.reduce((s, [x0, x1]) => s + x1 - x0 + 1, 0) + gap * (glyphs.length - 1);
  const on = new Uint8Array(w * h);
  let cx = 0;
  glyphs.forEach((g, i) => {
    const [x0, x1] = boxes[i];
    for (let y = 0; y < h; y++) for (let x = x0; x <= x1; x++) if (g.on[y * g.w + x]) on[y * w + cx + x - x0] = 1;
    cx += x1 - x0 + 1 + gap;
  });
  let y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on[y * w + x]) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (y1 < 0) return { w, h: 1, on: new Uint8Array(w) };
  return { w, h: y1 - y0 + 1, on: on.slice(y0 * w, (y1 + 1) * w) };
}

function addPixTex(scene: Phaser.Scene, key: string, buf: PixBuf): void {
  if (scene.textures.exists(key)) return;
  scene.textures.addCanvas(key, renderSheet({ key, group: 'Cover', frameW: buf.w, frameH: buf.h, frames: [{ name: 'img', buf }] }).canvas);
}

/**
 * Title: bold glyphs (each stroke doubled to the right), chrome rows, and a red / cyan
 * chromatic fringe one glyph pixel wide. Gaps of 3 or less (narrow counters) stay dark so
 * letters like U keep their shape.
 */
function titleTexture(scene: Phaser.Scene): void {
  const m = wordBits('OVERDUE', 3);
  const W = m.w + 5, H = m.h + 2;
  const B = (x: number, y: number) => {
    const gx = x - 2;
    if (y < 0 || y >= m.h) return false;
    const at = (xx: number) => xx >= 0 && xx < m.w && m.on[y * m.w + xx] === 1;
    return at(gx) || at(gx - 1);
  };
  /** Length of the empty run containing (x, y), counting the frame edges as open (long). */
  const run = (x: number, y: number) => {
    let a = x, z = x;
    while (a > 0 && !B(a - 1, y)) a--;
    while (z < W - 1 && !B(z + 1, y)) z++;
    return a === 0 || z === W - 1 ? 99 : z - a + 1;
  };
  const b = new PixBuf(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (B(x, y)) {
        const r = y / (m.h - 1);
        b.set(x, y, y === m.h - 1 ? C.fog : r < 0.45 ? C.white : r < 0.56 ? C.fog : C.pale);
        continue;
      }
      const wide = run(x, y) > 3;
      if (wide && B(x + 1, y)) b.set(x, y, C.red);
      else if (wide && B(x - 1, y)) b.set(x, y, C.cyan);
      else if (B(x, y - 1) || B(x, y - 2)) b.set(x, y, C.ink);
    }
  }
  addPixTex(scene, 'cover_title', b);
}

/** The red debt-collection stamp: double frame, glyphs at x3, worn ink. */
function stampTexture(scene: Phaser.Scene): void {
  const m = wordBits('逾期', 2);
  const S = 3, pad = 9;
  const W = m.w * S + pad * 2, H = m.h * S + pad * 2;
  const b = new PixBuf(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bayer(x, y) < 3) b.set(x, y, C.maroon);
  b.strokeRect(0, 0, W, H, C.red); b.strokeRect(1, 1, W - 2, H - 2, C.red);
  b.strokeRect(4, 4, W - 8, H - 8, C.red);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.on[y * m.w + x]) b.rect(pad + x * S, pad + y * S, S, S, C.red);
  // worn ink: speckles and a few dry patches
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const patch = hash2(x >> 2, y >> 2, 91) < 0.08 && hash2(x, y, 93) < 0.6;
      if (b.get(x, y) && (hash2(x, y, 95) < 0.035 || patch)) b.set(x, y, 0);
    }
  }
  addPixTex(scene, 'cover_stamp', b);
}

/** Vertical sign lettering (characters stacked, x2), with the tube's darker edge underneath. */
function signTexture(scene: Phaser.Scene, key: string, chars: string, core: number, edge: number): void {
  const glyphs = [...chars].map((ch) => wordBits(ch, 0));
  const S = 2, W = 12 * S + 2, step = 13 * S;
  const b = new PixBuf(W, step * glyphs.length + 2);
  glyphs.forEach((m, i) => {
    const ox = Math.floor((W - m.w * S) / 2), oy = i * step + Math.floor((12 - m.h) / 2) * S;
    for (const [dy, c] of [[1, edge], [0, core]] as const) {
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.on[y * m.w + x]) b.rect(ox + x * S, oy + y * S + dy, S, S, c);
    }
  });
  addPixTex(scene, key, b);
}

export function buildCover(scene: Phaser.Scene, opts: { animated: boolean }): Cover {
  const A = opts.animated;
  const add = scene.add;
  let t = 0;
  const tickers: ((t: number, dt: number) => void)[] = [];

  const glow = (x: number, y: number, sx: number, sy: number, color: number, alpha: number) =>
    add.image(x, y, 'cover_glow').setBlendMode(ADD).setTint(color).setScale(sx, sy).setAlpha(alpha);

  // ---------------------------------------------------------------- sky
  add.image(0, 0, 'cover_sky').setOrigin(0, 0);
  glow(330, HORIZON - 10, 14, 5, P.magenta, 0.22);
  glow(330, HORIZON - 30, 8, 4, P.orange, 0.12);

  // searchlights from behind the far skyline
  const beams = add.graphics().setBlendMode(ADD);
  const beamDefs = [
    { x: 236, y: 250, a: -1.95, w: 0.05, c: P.ice },
    { x: 420, y: 255, a: -1.2, w: 0.045, c: P.rose },
  ];
  const drawBeams = (tt: number) => {
    beams.clear();
    for (const [i, b] of beamDefs.entries()) {
      const a = b.a + (A ? Math.sin(tt * 0.35 + i * 2) * 0.18 : 0);
      const L = 360;
      beams.fillStyle(b.c, 0.07);
      beams.fillTriangle(b.x, b.y, b.x + Math.cos(a - b.w) * L, b.y + Math.sin(a - b.w) * L, b.x + Math.cos(a + b.w) * L, b.y + Math.sin(a + b.w) * L);
      beams.fillStyle(b.c, 0.05);
      beams.fillTriangle(b.x, b.y, b.x + Math.cos(a - b.w * 0.4) * L, b.y + Math.sin(a - b.w * 0.4) * L, b.x + Math.cos(a + b.w * 0.4) * L, b.y + Math.sin(a + b.w * 0.4) * L);
    }
  };
  drawBeams(0);
  if (A) tickers.push((tt) => drawBeams(tt));

  // ---------------------------------------------------------------- far skyline
  add.image(0, FAR_Y, 'cover_far').setOrigin(0, 0);

  // ---------------------------------------------------------------- Madame Lux hologram (left)
  const LX = 92, LY = 40, LS = 3;
  const holoG = add.graphics();
  holoG.fillStyle(P.magenta, 0.06).fillRect(LX - 66, LY - 6, 132, 186);
  holoG.setBlendMode(ADD);
  const bracket = (x: number, y: number, dx: number, dy: number) => {
    holoG.fillStyle(P.rose, 0.9).fillRect(x, y, 10 * dx || 2, 2).fillRect(x, y, 2, 10 * dy || 2);
  };
  bracket(LX - 66, LY - 6, 1, 1);
  holoG.fillStyle(P.rose, 0.9).fillRect(LX + 56, LY - 6, 10, 2).fillRect(LX + 64, LY - 6, 2, 10);
  holoG.fillStyle(P.rose, 0.9).fillRect(LX - 66, LY + 178, 10, 2).fillRect(LX - 66, LY + 170, 2, 10);
  holoG.fillStyle(P.rose, 0.9).fillRect(LX + 56, LY + 178, 10, 2).fillRect(LX + 64, LY + 170, 2, 10);
  // projector cone from the roof below
  holoG.fillStyle(P.magenta, 0.07).fillTriangle(LX - 8, 186, LX - 64, LY + 176, LX + 64, LY + 176);
  glow(LX, LY + 90, 5, 6, P.magenta, 0.25);
  // the figure, split into horizontal slices so it can glitch
  const luxSlices: Phaser.GameObjects.Image[] = [];
  const SL = 4;
  for (let i = 0; i < 56 / SL; i++) {
    const im = add.image(LX - 20 * LS, LY, 'cover_lux').setOrigin(0, 0).setScale(LS).setBlendMode(ADD).setAlpha(0.85);
    im.setCrop(0, i * SL, 40, SL);
    luxSlices.push(im);
  }
  const glitchLux = (seed: number, amount: number) => {
    const r = mulberry32(seed);
    luxSlices.forEach((im, i) => {
      const off = r() < amount ? Math.round((r() - 0.5) * 4) * LS : 0;
      im.x = LX - 20 * LS + off;
      im.setAlpha(i % 2 ? 0.85 : 0.65);
    });
  };
  glitchLux(3, 0.25);
  const scan = add.graphics();
  scan.fillStyle(P.ink, 0.35);
  for (let y = LY; y < LY + 172; y += 3) scan.fillRect(LX - 64, y, 128, 1);
  if (A) {
    let next = 1;
    tickers.push((tt) => {
      if (tt > next) { glitchLux(Math.floor(tt * 100), 0.35); next = tt + (Math.random() < 0.3 ? 0.08 : 0.6 + Math.random() * 1.6); }
      for (const im of luxSlices) im.y = LY + Math.sin(tt * 1.2) * 2;
    });
  }

  // ---------------------------------------------------------------- Gearjaw (centre)
  const { s: GS, x: GX, y: GY } = COVER_LAYOUT.gearjaw;
  add.image(GX, GY, 'cover_gearjaw').setOrigin(0, 0).setScale(GS);
  const GL = COVER_LAYOUT.gearjawLights;
  const gpt = (p: readonly number[]) => [GX + (p[0] + 0.5) * GS, GY + (p[1] + 0.5) * GS] as const;
  const [enx, eny] = gpt(GL.engine);
  const engine = glow(enx, eny, 3.5, 3, P.orange, 0.55);
  glow(...gpt(GL.eye), 1.2, 1.2, P.red, 0.8);
  for (const p of GL.stacks) glow(...gpt(p), 0.9, 1.4, P.sodium, 0.45);
  if (A) tickers.push((tt) => engine.setAlpha(0.45 + 0.12 * Math.sin(tt * 3.1) + 0.05 * Math.sin(tt * 11)));

  // ---------------------------------------------------------------- Octohydra (right)
  const { s: OS, x: OX, y: OY } = COVER_LAYOUT.octo;
  const octo = add.image(OX, OY, 'cover_octo').setOrigin(0, 0).setScale(OS);
  const octoGlows = COVER_LAYOUT.octoEyes.map(([x, y], i) =>
    glow(OX + (x + 0.5) * OS, OY + (y + 0.5) * OS, 1.1, 1.1, i === 0 ? P.red : P.amber, 0.6));
  glow(OX + 40 * OS, OY + 70 * OS, 5, 4, P.acid, 0.12);
  if (A) tickers.push((tt) => {
    const dy = Math.round(Math.sin(tt * 0.9) * 1.5) * OS / 3;
    octo.y = OY + dy;
    octoGlows.forEach((g, i) => { g.y = OY + dy + (COVER_LAYOUT.octoEyes[i][1] + 0.5) * OS; g.setAlpha(0.45 + 0.15 * Math.sin(tt * 2 + i)); });
  });

  // haze between the bosses and the mid skyline (aerial perspective)
  const haze = add.graphics();
  for (let i = 0; i < 12; i++) haze.fillStyle(P.plum, 0.05 + i * 0.025).fillRect(0, 196 + i * 8, 640, 8);

  // ---------------------------------------------------------------- mid skyline
  add.image(0, MID_Y, 'cover_mid').setOrigin(0, 0);
  for (const n of COVER_LAYOUT.midNeon) glow(n.x, n.y, n.r, n.r, n.color, 0.45);
  for (const [x, y, c] of [[478, 232, P.cyan], [174, 236, P.magenta], [402, 266, P.orange]] as const) glow(x, y, 2, 0.6, c, 0.4);
  const beaconGlows = COVER_LAYOUT.beacons.map(([x, y]) => glow(x, y, 0.35, 0.35, P.red, 0.8));
  if (A) tickers.push((tt) => beaconGlows.forEach((g, i) => g.setAlpha(((tt * 0.8 + i * 0.37) % 1) < 0.5 ? 0.9 : 0.1)));
  glow(320, HORIZON, 20, 1.2, P.grape, 0.35);

  // ---------------------------------------------------------------- reflections + street
  const refl = add.image(0, HORIZON, 'cover_refl').setOrigin(0, 0).setAlpha(0.75).setTint(0xc8d0ff);
  for (const n of COVER_LAYOUT.midNeon) glow(n.x, HORIZON + (HORIZON - n.y) + 6, 0.8, 2.6, n.color, 0.3);
  glow(enx, HORIZON + (HORIZON - eny) * 0.9, 3, 2, P.orange, 0.3);
  glow(LX, HORIZON + 30, 4, 2.4, P.magenta, 0.25);
  glow(COVER_LAYOUT.signs[0][0] + 15, 336, 1.4, 3.5, P.magenta, 0.4);
  glow(COVER_LAYOUT.signs[1][0] + 15, 330, 1.4, 3.5, P.cyan, 0.35);
  if (A) tickers.push((tt) => { refl.x = Math.round(Math.sin(tt * 1.7)); });
  // Echo's reflection (in the puddle under her feet)
  const EX = 262, EY = 346, ES = 3;
  add.image(EX, EY, 'cover_echo').setOrigin(0.5, 0).setScale(ES).setFlipY(true).setAlpha(0.35).setTint(0x9fb0ff);
  add.image(0, HORIZON, 'cover_street').setOrigin(0, 0);

  // ---------------------------------------------------------------- near buildings + vertical signs
  add.image(0, 0, 'cover_near').setOrigin(0, 0);
  const signs: { x: number; y: number; frame: 'pink' | 'cyan'; chars: string; core: number; edge: number }[] = [
    { x: COVER_LAYOUT.signs[0][0], y: COVER_LAYOUT.signs[0][1], frame: 'pink', chars: '当铺', core: P.rose, edge: P.magenta },
    { x: COVER_LAYOUT.signs[1][0], y: COVER_LAYOUT.signs[1][1], frame: 'cyan', chars: '贷款', core: P.ice, edge: P.cyan },
  ];
  const signParts: Phaser.GameObjects.Image[][] = [];
  signs.forEach((sg, i) => {
    const key = `cover_signtext_${i}`;
    signTexture(scene, key, sg.chars, sg.frame === 'pink' ? C.rose : C.ice, sg.frame === 'pink' ? C.magenta : C.teal);
    const g = glow(sg.x + 15, sg.y + 31, 2.4, 3.6, sg.edge, 0.4);
    const box = add.image(sg.x, sg.y, 'cover_sign', sg.frame).setOrigin(0, 0);
    const letters = add.image(sg.x + 15, sg.y + 31, key).setOrigin(0.5, 0.5);
    signParts.push([g, box, letters]);
  });
  if (A) {
    // the pink sign stutters now and then
    let off = 0;
    tickers.push((tt) => {
      const flick = (tt % 7) > 6.4 && Math.sin(tt * 60) > 0;
      if (flick !== (off === 1)) { off = flick ? 1 : 0; for (const p of signParts[0]) p.setAlpha(flick ? 0.25 : 1); }
    });
  }

  // ---------------------------------------------------------------- Echo
  glow(EX, EY - 2, 4, 0.8, P.cyan, 0.3);
  glow(EX - 4 * ES, EY - 120, 1.5, 6, P.cyan, 0.12);
  glow(EX + 4 * ES, EY - 120, 1.5, 6, P.magenta, 0.12);
  add.image(EX, EY, 'cover_echo').setOrigin(0.5, 1).setScale(ES);
  const coil = glow(EX + (40.5 - 22) * ES, EY - (68 - 53.5) * ES, 1.3, 1.3, P.cyan, 0.85);
  if (A) tickers.push((tt) => coil.setAlpha(0.6 + 0.3 * Math.abs(Math.sin(tt * 7))));

  // ---------------------------------------------------------------- rain
  const rain = add.graphics();
  const R = mulberry32(17);
  const drops = Array.from({ length: 260 }, () => {
    const z = R();
    return { x: R() * 700, y: R() * 360, z, len: 3 + z * 10, sp: 260 + z * 320 };
  });
  const drawRain = () => {
    rain.clear();
    for (const d of drops) {
      const a = 0.12 + d.z * 0.3;
      rain.lineStyle(1, d.z > 0.7 ? P.pale : P.fog, a);
      rain.lineBetween(d.x, d.y, d.x - d.len * 0.18, d.y + d.len);
    }
    // splashes on the street
    rain.fillStyle(P.fog, 0.5);
    for (const d of drops) if (d.z > 0.4 && d.y > HORIZON + 8) rain.fillRect(Math.round(d.x - 30), Math.round(HORIZON + ((d.x * 7) % (360 - HORIZON))), 2, 1);
  };
  drawRain();
  if (A) tickers.push((_tt, dt) => {
    for (const d of drops) {
      d.y += d.sp * dt; d.x -= d.sp * dt * 0.18;
      if (d.y > 360) { d.y -= 380; d.x = Math.random() * 700; }
    }
    drawRain();
  });

  // ---------------------------------------------------------------- vignette
  const vig = add.graphics();
  for (let i = 0; i < 6; i++) {
    const a = 0.1 + (5 - i) * 0.04;
    vig.fillStyle(P.ink, a).fillRect(0, i * 4, 640, 4).fillRect(0, 356 - i * 4, 640, 4);
    vig.fillStyle(P.ink, a * 0.7).fillRect(i * 4, 0, 4, 360).fillRect(636 - i * 4, 0, 4, 360);
  }

  // ---------------------------------------------------------------- title
  titleTexture(scene);
  const TS = 5, TY = 12;
  const tw = (scene.textures.get('cover_title').getSourceImage() as HTMLCanvasElement).width;
  const TX = Math.round(320 - (tw * TS) / 2);
  glow(320, TY + 26, 12, 2.2, P.magenta, 0.14);
  glow(320, TY + 26, 8, 1.4, P.cyan, 0.1);
  add.image(TX, TY, 'cover_title').setOrigin(0, 0).setScale(TS);
  // glitch: one band of rows shoved sideways
  const slice = add.image(TX, TY, 'cover_title').setOrigin(0, 0).setScale(TS).setVisible(false);
  const sliceAt = (row: number, rows: number, dx: number) => {
    slice.setCrop(0, row, tw, rows).setVisible(true);
    slice.x = TX + dx * TS;
  };
  if (A) {
    let next = 2, until = 0;
    tickers.push((tt) => {
      if (tt > next) {
        until = tt + 0.1 + Math.random() * 0.08;
        next = tt + 2 + Math.random() * 3;
        sliceAt(1 + Math.floor(Math.random() * 8), 1 + Math.floor(Math.random() * 2), (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 3)));
      } else if (tt > until) slice.setVisible(false);
    });
  }

  // ---------------------------------------------------------------- debt stamp
  stampTexture(scene);
  add.image(TX + tw * TS - 36, TY + 64, 'cover_stamp').setRotation(-0.17).setAlpha(0.95);

  return {
    update(dt: number) {
      if (!A) return;
      const s = Math.min(0.05, dt / 1000);
      t += s;
      for (const f of tickers) f(t, s);
    },
  };
}
