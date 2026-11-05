/**
 * Dialogue portraits: 64x64 busts, 3/4 view facing right (flipX on the client to face left).
 * One atlas `portraits` with frames named like dialogue keys: 'echo', 'echo_hurt', 'mara_angry'...
 *
 * Built from a shared parametric face (head planes, key light from the upper left, a neon rim
 * light on the right edge in the character's accent colour) plus per-character hair, clothes
 * and details. Moods change brows, eyes and mouth.
 */
import { C } from '../palette';
import { grid } from '../core/grid';
import { Mask, PixBuf, Pt, shadeInto } from '../core/pixbuf';
import { bayer } from '../core/rng';
import { SheetSpec } from '../core/sheet';

export const PT = 64;
export type Mood = 'normal' | 'angry' | 'smile' | 'hurt';

interface SkinTones { L: number; M: number; D: number; X: number }
const SKIN_LIGHT: SkinTones = { L: C.skinL, M: C.skinL, D: C.skinM, X: C.skinD };
const SKIN_MID: SkinTones = { L: C.skinL, M: C.skinM, D: C.skinD, X: C.skinX };
const SKIN_DARK: SkinTones = { L: C.skinM, M: C.skinD, D: C.skinX, X: C.ink };

interface Face {
  skin: SkinTones;
  iris: number;
  /** Optional different far-eye iris (cyber eye) that glows. */
  irisFar?: number;
  rim: number;
  /** Jaw width tweak (+ wider). */
  jaw?: number;
  /** Chin y tweak (+ longer). */
  chin?: number;
  brow: number;
  lips?: number;
}

// ---------------------------------------------------------------------------
// Shared geometry
// ---------------------------------------------------------------------------

const EYE_Y = 27;
const NEAR_X = 28;
const FAR_X = 38;

function headMask(f: Face): Mask {
  const j = f.jaw ?? 0, c = f.chin ?? 0;
  return new Mask(PT, PT).draw((b) => {
    b.ellipse(31.5, 23.5, 12, 13, 1);
    b.poly([[19.5 - j, 24], [21 - j, 32], [26 - j / 2, 38 + c], [33, 41 + c], [37 + j / 2, 40 + c], [41 + j, 34], [43.5 + j / 2, 25]], 1);
  });
}

/** Skin with planar lighting: lit upper-left, mid front, shadow on the right side and under the jaw. */
function paintSkin(b: PixBuf, m: Mask, f: Face): void {
  const s = f.skin;
  for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) {
    if (!m.has(x, y)) continue;
    let c = s.M;
    const lit = (x - 22) * 0.7 + (y - 16) * 0.6;
    if (lit < 4) c = s.L;
    else if (lit < 5.5 && bayer(x, y) < 8) c = s.L;
    if (x >= 41 || (x >= 39 && bayer(x, y) < 8)) c = s.D;
    if (!m.has(x, y + 2) && y > 32) c = s.D;
    if (!m.has(x + 1, y)) c = f.rim;
    b.set(x, y, c);
  }
}

function neck(b: PixBuf, f: Face, wide = 0): void {
  const m = new Mask(PT, PT).draw((x) => x.poly([[25 - wide, 34], [38 + wide, 34], [39 + wide, 50], [25 - wide, 50]], 1));
  for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) {
    if (!m.has(x, y)) continue;
    let c = y < 42 ? f.skin.D : f.skin.M;
    if (x < 28 + (y > 44 ? 0 : 2) && y > 40) c = f.skin.M;
    if (!m.has(x + 1, y)) c = f.rim;
    if (y < 41 && x > 34) c = f.skin.X;
    b.set(x, y, c);
  }
}

function ear(b: PixBuf, f: Face): void {
  b.ellipse(20.5, 28.5, 2.2, 3.5, f.skin.M);
  b.set(20, 28, f.skin.D); b.set(20, 29, f.skin.D); b.set(21, 27, f.skin.L);
}

function eye(b: PixBuf, cx: number, w: number, iris: number, mood: Mood, far: boolean, f: Face): void {
  const y = EYE_Y;
  const x0 = cx - (w >> 1);
  if (mood === 'smile' && !far) {
    // happy closed arc
    b.hline(x0 + 1, x0 + w - 2, y, C.ink); b.set(x0, y + 1, C.ink); b.set(x0 + w - 1, y + 1, C.ink);
    return;
  }
  if (mood === 'hurt') {
    // squeezed shut
    b.hline(x0, x0 + w - 1, y + 1, C.ink); b.set(x0 + (far ? 0 : w - 1), y, C.ink);
    b.hline(x0 + 1, x0 + w - 2, y + 2, f.skin.D);
    return;
  }
  const lid = mood === 'angry' ? 1 : 0;
  // upper lash line (heavier at the outer corner)
  b.hline(x0, x0 + w - 1, y - 1 + lid, C.ink);
  if (!far) b.set(x0 - 1, y + lid, C.ink); else b.set(x0 + w, y + lid, C.ink);
  // sclera + iris
  for (let i = 0; i < w; i++) b.set(x0 + i, y + lid, C.pale);
  if (!lid) for (let i = 0; i < w; i++) b.set(x0 + i, y + 1, C.pale);
  const ix = far ? x0 + w - 3 : x0 + w - 3;
  b.rect(ix, y + lid, 2, 2 - lid, iris);
  b.set(ix + 1, y + 1, C.ink);
  if (!lid) b.set(ix, y, C.white);
  // lower lid
  b.hline(x0 + 1, x0 + w - 2, y + 2, f.skin.D);
}

function brow(b: PixBuf, cx: number, w: number, mood: Mood, far: boolean, c: number): void {
  const y = EYE_Y - 4;
  const x0 = cx - (w >> 1) - (far ? 0 : 1), x1 = x0 + w;
  // inner end = towards the nose (right end for near eye, left end for far eye)
  let yIn = y, yOut = y;
  if (mood === 'angry') { yIn = y + 2; yOut = y - 1; }
  if (mood === 'hurt') { yIn = y - 1; yOut = y + 1; }
  if (mood === 'smile') { yIn = y - 1; yOut = y - 1; }
  const [ya, yb] = far ? [yIn, yOut] : [yOut, yIn];
  b.line(x0, ya, x1, yb, c);
  b.line(x0, ya + 1, x1 - 1, yb + 1, c);
}

function nose(b: PixBuf, f: Face): void {
  b.vline(36, 28, 31, f.skin.D);
  b.set(37, 32, f.skin.D); b.set(38, 32, f.skin.D); b.set(35, 33, f.skin.X); b.set(36, 33, f.skin.D);
  b.set(37, 31, f.skin.L);
}

function mouth(b: PixBuf, mood: Mood, f: Face): void {
  const y = 36, lips = f.lips ?? f.skin.X;
  if (mood === 'smile') {
    b.set(31, y - 1, lips); b.hline(32, 37, y, lips); b.set(38, y - 1, lips);
    b.hline(33, 36, y + 1, f.skin.D);
  } else if (mood === 'angry') {
    b.rect(32, y - 1, 6, 3, C.ink); b.hline(33, 36, y - 1, C.pale); b.hline(33, 36, y + 1, C.maroon);
  } else if (mood === 'hurt') {
    b.rect(32, y - 1, 6, 2, C.ink); b.hline(33, 37, y - 1, C.pale); b.hline(33, 37, y, C.fog);
  } else {
    b.hline(32, 37, y, lips); b.set(33, y + 1, f.skin.D); b.set(36, y + 1, f.skin.D);
  }
}

/** Shoulders/torso silhouette shaded with a ramp, rim-lit on the right. */
function shoulders(b: PixBuf, pts: Pt[], ramp: readonly number[], base: number, rim: number): void {
  const m = new Mask(PT, PT).draw((x) => x.poly(pts, 1));
  shadeInto(b, m, { ramp, base, light: [-1, -1], innerLine: false });
  for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) if (m.has(x, y) && !m.has(x + 1, y)) b.set(x, y, rim);
}

function shaded(b: PixBuf, ramp: readonly number[], base: number, draw: (x: PixBuf) => void, rim?: number): Mask {
  const m = new Mask(PT, PT).draw(draw);
  shadeInto(b, m, { ramp, base, light: [-1, -1], innerLine: false });
  if (rim !== undefined) for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) if (m.has(x, y) && !m.has(x + 1, y) && x > 30) b.set(x, y, rim);
  return m;
}

/** Apply a horizontal glitch to some rows (used for Echo's 'hurt'). */
function glitch(b: PixBuf, rows: [number, number, number][]): void {
  for (const [y0, h, dx] of rows) {
    const strip = b.crop(0, y0, PT, h);
    b.rect(0, y0, PT, h, 0);
    b.blit(strip, dx, y0);
    for (let y = y0; y < y0 + h; y++) {
      for (let x = 0; x < PT; x++) {
        if (b.get(x, y) && !b.get(x - 1, y)) b.set(x, y, C.cyan);
        if (b.get(x, y) && !b.get(x + 1, y)) b.set(x, y, C.magenta);
      }
    }
  }
}

interface PortraitDef {
  id: string;
  moods: Mood[];
  face: Face;
  draw: (b: PixBuf, mood: Mood) => void;
}

/** Standard face pass: head, ear, features. Call from character draw functions. */
function face(b: PixBuf, f: Face, mood: Mood, opts: { farEyeHidden?: boolean; eyes?: boolean } = {}): Mask {
  const m = headMask(f);
  paintSkin(b, m, f);
  ear(b, f);
  if (opts.eyes !== false) {
    eye(b, NEAR_X, 5, f.iris, mood, false, f);
    if (!opts.farEyeHidden) eye(b, FAR_X, 4, f.irisFar ?? f.iris, mood, true, f);
    brow(b, NEAR_X, 5, mood, false, f.brow);
    if (!opts.farEyeHidden) brow(b, FAR_X, 4, mood, true, f.brow);
  }
  nose(b, f);
  mouth(b, mood, f);
  return m;
}

// ---------------------------------------------------------------------------
// ECHO
// ---------------------------------------------------------------------------
const ECHO_FACE: Face = { skin: SKIN_LIGHT, iris: C.slate, irisFar: C.cyan, rim: C.cyan, brow: C.indigo };
const ECHO: PortraitDef = {
  id: 'echo', moods: ['normal', 'hurt', 'smile', 'angry'], face: ECHO_FACE,
  draw: (b, mood) => {
    // jacket with high collar + chrome shoulder on the right
    shoulders(b, [[4, 64], [8, 52], [18, 46], [30, 47], [46, 46], [56, 52], [60, 64]], [C.ink, C.night, C.navy, C.indigo, C.slate], 3, C.cyan);
    shaded(b, [C.slate, C.steel, C.fog, C.pale, C.white], 3, (x) => x.poly([[42, 47], [52, 47], [59, 55], [61, 64], [44, 64]], 1), C.ice);
    b.line(46, 52, 52, 64, C.slate); b.set(50, 50, C.white); b.set(51, 50, C.white);
    neck(b, ECHO_FACE);
    // collar
    shaded(b, [C.ink, C.night, C.navy, C.indigo, C.slate], 3, (x) => x.poly([[20, 42], [26, 40], [27, 50], [22, 52]], 1));
    shaded(b, [C.ink, C.night, C.navy, C.indigo, C.slate], 2, (x) => x.poly([[38, 40], [43, 42], [42, 52], [37, 50]], 1));
    b.line(26, 41, 27, 50, C.cyan); b.line(38, 41, 37, 50, C.cyan);
    // neck jack port
    b.rect(35, 43, 2, 2, C.steel); b.set(35, 43, C.cyan);
    // hair back mass
    const hair = [C.ink, C.navy, C.indigo, C.slate, C.steel];
    shaded(b, hair, 2, (x) => x.poly([[17, 30], [16, 18], [21, 9], [30, 5], [39, 6], [45, 11], [46, 19], [44, 22], [21, 24], [20, 31]], 1));
    face(b, ECHO_FACE, mood);
    // fringe: sweeping spikes over the forehead, covering part of the near brow
    shaded(b, hair, 3, (x) => x.poly([[19, 20], [24, 11], [33, 9], [42, 12], [45, 19], [43, 22], [40, 18], [38, 23], [35, 18], [31, 24], [29, 18], [25, 23], [23, 19], [21, 26]], 1), C.cyan);
    b.line(24, 14, 31, 12, C.steel); b.line(33, 11, 39, 13, C.steel);
    // spikes on top
    shaded(b, hair, 3, (x) => { x.poly([[22, 10], [24, 3], [28, 8]], 1); x.poly([[31, 6], [36, 1], [37, 7]], 1); x.poly([[40, 8], [47, 6], [44, 13]], 1); });
    // cyber-eye glow + circuit trace on the cheek
    if (mood !== 'hurt') { b.set(FAR_X, EYE_Y, C.ice); b.set(FAR_X + 1, EYE_Y + 3, C.teal); b.set(FAR_X + 2, EYE_Y + 4, C.teal); b.set(FAR_X + 2, EYE_Y + 5, C.cyan); }
    b.outline(C.ink);
    if (mood === 'hurt') glitch(b, [[14, 2, 2], [27, 2, -2], [40, 1, 3], [52, 2, -2]]);
  },
};

// ---------------------------------------------------------------------------
// MARA
// ---------------------------------------------------------------------------
const MARA_FACE: Face = { skin: SKIN_MID, iris: C.umber, rim: C.magenta, brow: C.umber, chin: -1, lips: C.maroon };
const MARA: PortraitDef = {
  id: 'mara', moods: ['normal', 'angry', 'smile', 'hurt'], face: MARA_FACE,
  draw: (b, mood) => {
    const coat = [C.ink, C.plum, C.grape, C.orchid, C.rose];
    shoulders(b, [[3, 64], [7, 51], [18, 45], [32, 47], [46, 45], [57, 51], [61, 64]], coat, 2, C.magenta);
    // dark scrubs V-neck + coat lapels with magenta piping
    shaded(b, [C.ink, C.night, C.navy, C.indigo], 2, (x) => x.poly([[25, 46], [40, 46], [33, 60]], 1));
    b.line(24, 46, 33, 62, C.magenta); b.line(41, 46, 33, 62, C.magenta);
    // stethoscope-like cable
    b.line(21, 50, 26, 58, C.slate); b.line(26, 58, 30, 60, C.slate); b.set(30, 60, C.fog);
    neck(b, MARA_FACE, -1);
    // hair: pulled back, bun at the back, grey streak
    const hair = [C.ink, C.umber, C.rust, C.orange];
    shaded(b, hair, 1, (x) => { x.circle(15.5, 15.5, 6, 1); x.poly([[17, 30], [17, 16], [24, 8], [34, 7], [43, 11], [45, 18], [44, 21], [24, 19], [20, 31]], 1); });
    face(b, MARA_FACE, mood);
    // age lines
    b.set(23, EYE_Y + 1, MARA_FACE.skin.D); b.set(23, EYE_Y + 2, MARA_FACE.skin.D);
    b.line(33, 34, 31, 37, MARA_FACE.skin.D);
    // hairline sweeping back + streak
    shaded(b, hair, 2, (x) => x.poly([[20, 22], [24, 12], [34, 9], [43, 13], [44, 18], [36, 15], [28, 16], [22, 23]], 1), C.magenta);
    b.line(27, 11, 19, 13, C.fog); b.line(28, 12, 20, 15, C.pale); b.line(18, 12, 13, 13, C.fog);
    // magnifier visor: band + articulated lens over the far eye
    b.line(19, 21, 45, 20, C.slate); b.line(19, 22, 45, 21, C.steel);
    b.line(43, 21, 45, 25, C.slate);
    if (mood !== 'smile') {
      b.ring(FAR_X + 1.5, EYE_Y + 1.5, 4.5, C.steel);
      b.ring(FAR_X + 1.5, EYE_Y + 1.5, 3.5, C.slate);
      b.circle(FAR_X + 1.5, EYE_Y + 1.5, 2.5, C.magenta);
      b.set(FAR_X, EYE_Y, C.rose); b.set(FAR_X + 1, EYE_Y + 1, C.ink);
    } else {
      // lens flipped up
      b.ring(FAR_X + 3.5, 15.5, 3.5, C.steel); b.circle(FAR_X + 3.5, 15.5, 2.3, C.magenta); b.set(FAR_X + 2, 14, C.rose);
    }
    b.outline(C.ink);
  },
};

// ---------------------------------------------------------------------------
// ANVIL
// ---------------------------------------------------------------------------
const ANVIL_FACE: Face = { skin: SKIN_DARK, iris: C.umber, irisFar: C.orange, rim: C.sodium, brow: C.ink, jaw: 3, chin: 1, lips: C.ink };
const ANVIL: PortraitDef = {
  id: 'anvil', moods: ['normal', 'smile', 'angry', 'hurt'], face: ANVIL_FACE,
  draw: (b, mood) => {
    // massive shoulders: hazard vest left, scrap pauldron right
    shoulders(b, [[0, 64], [2, 50], [14, 43], [32, 45], [50, 43], [62, 50], [64, 64]], [C.ink, C.navy, C.indigo, C.slate, C.steel], 2, C.sodium);
    shaded(b, [C.umber, C.rust, C.orange, C.sodium, C.amber], 2, (x) => x.poly([[2, 64], [4, 52], [14, 45], [22, 46], [24, 64]], 1));
    for (const y of [53, 58]) b.line(4, y, 23, y - 1, C.amber);
    // scrap pauldron with hazard stripes and rivets
    const pm = shaded(b, [C.ink, C.slate, C.steel, C.fog, C.pale], 2, (x) => x.poly([[40, 46], [52, 42], [62, 47], [64, 56], [64, 64], [44, 64], [40, 54]], 1), C.sodium);
    for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) if (pm.has(x, y) && y > 55 && y < 60 && pm.has(x + 1, y) && pm.has(x - 1, y)) b.set(x, y, ((x + y) >> 1) % 2 ? C.orange : C.ink);
    for (const [x, y] of [[44, 50], [50, 46], [57, 47], [61, 52]] as Pt[]) b.set(x, y, C.white);
    b.line(46, 49, 54, 53, C.rust); b.line(50, 50, 55, 49, C.rust);
    neck(b, ANVIL_FACE, 4);
    // buzzcut cap of hair
    shaded(b, [C.ink, C.night, C.navy, C.indigo], 2, (x) => x.poly([[18, 26], [18, 15], [24, 9], [33, 7], [42, 10], [45, 17], [44, 19], [33, 15], [24, 17], [20, 26]], 1));
    face(b, ANVIL_FACE, mood);
    // beard: jaw + chin
    const beard = new Mask(PT, PT).draw((x) => x.poly([[20, 28], [22, 35], [27, 41], [33, 44], [39, 42], [44, 34], [45, 28], [41, 33], [37, 35], [31, 35], [26, 33], [22, 28]], 1));
    for (let y = 0; y < PT; y++) for (let x = 0; x < PT; x++) if (beard.has(x, y)) b.set(x, y, (x + y) % 3 === 0 ? C.navy : C.night);
    // mouth again over the beard
    if (mood === 'smile') { b.hline(32, 38, 37, C.pale); b.set(31, 36, C.ink); b.set(39, 36, C.ink); b.hline(32, 38, 38, C.ink); }
    else if (mood === 'angry') { b.rect(32, 36, 7, 3, C.ink); b.hline(33, 37, 36, C.pale); }
    else b.hline(32, 38, 37, C.ink);
    // scar through the near brow + cyber eye glow
    b.line(25, 20, 29, 30, C.skinD); b.line(26, 20, 30, 30, C.skinM);
    b.set(FAR_X + 1, EYE_Y, C.amber);
    b.outline(C.ink);
    if (mood !== 'hurt') { b.setIfEmpty(46, EYE_Y, C.orange); }
  },
};

// ---------------------------------------------------------------------------
// PING
// ---------------------------------------------------------------------------
const PING_FACE: Face = { skin: SKIN_LIGHT, iris: C.grape, rim: C.acid, brow: C.grape, jaw: -1, chin: -2, lips: C.orchid };
const PING: PortraitDef = {
  id: 'ping', moods: ['normal', 'smile', 'angry', 'hurt'], face: PING_FACE,
  draw: (b, mood) => {
    const hoodie = [C.ink, C.night, C.moss, C.lime, C.acid];
    // oversized hoodie with the hood bunched around the neck
    shoulders(b, [[2, 64], [6, 50], [16, 44], [32, 46], [48, 44], [58, 50], [62, 64]], hoodie, 2, C.acid);
    shaded(b, hoodie, 2, (x) => x.ellipse(31.5, 47, 15, 6, 1), C.acid);
    shaded(b, [C.ink, C.night, C.moss], 1, (x) => x.ellipse(31.5, 46, 10, 3.5, 1));
    b.vline(27, 50, 58, C.pale); b.vline(36, 50, 57, C.pale); b.set(27, 59, C.fog); b.set(36, 58, C.fog);
    // chest print: a little ">_" glyph
    b.line(14, 56, 16, 58, C.acid); b.line(16, 58, 14, 60, C.acid); b.hline(18, 21, 60, C.acid);
    neck(b, PING_FACE, -2);
    const hair = [C.ink, C.plum, C.grape, C.orchid, C.rose];
    // bob: back mass then face then fringe
    shaded(b, hair, 3, (x) => x.poly([[16, 38], [15, 20], [20, 10], [31, 6], [41, 8], [46, 15], [46, 26], [44, 22], [22, 22], [21, 38]], 1));
    face(b, PING_FACE, mood);
    // freckles
    for (const [x, y] of [[24, 31], [26, 32], [25, 30], [40, 31], [41, 32]] as Pt[]) b.set(x, y, C.skinM);
    shaded(b, hair, 3, (x) => x.poly([[19, 24], [21, 13], [30, 9], [40, 10], [45, 16], [45, 23], [42, 20], [40, 24], [37, 19], [33, 23], [30, 19], [26, 23], [23, 20], [21, 27]], 1), C.rose);
    b.line(23, 15, 30, 12, C.rose); b.line(25, 17, 29, 15, C.orchid);
    // headphones: band over the head + big cups with acid rings
    b.line(20, 10, 30, 4, C.night); b.line(30, 4, 40, 5, C.night); b.line(21, 11, 30, 5, C.slate);
    shaded(b, [C.ink, C.night, C.navy, C.slate, C.steel], 3, (x) => x.ellipse(17.5, 27.5, 5, 7, 1));
    b.ring(17.5, 27.5, 4, C.acid); b.set(16, 25, C.white);
    // mic boom
    b.line(19, 33, 28, 39, C.slate); b.rect(28, 38, 2, 2, C.night); b.set(29, 38, C.acid);
    b.outline(C.ink);
    if (mood === 'smile') { b.set(38, 36, C.white); }
  },
};

// ---------------------------------------------------------------------------
// VESPER
// ---------------------------------------------------------------------------
const VESPER_FACE: Face = { skin: SKIN_LIGHT, iris: C.red, rim: C.red, brow: C.fog, jaw: -1, lips: C.skinD };
const VESPER: PortraitDef = {
  id: 'vesper', moods: ['normal', 'smile', 'angry', 'hurt'], face: VESPER_FACE,
  draw: (b, mood) => {
    const coat = [C.ink, C.night, C.navy, C.indigo, C.slate];
    shoulders(b, [[4, 64], [8, 51], [19, 45], [32, 47], [45, 45], [56, 51], [60, 64]], coat, 2, C.red);
    // tall collar
    shaded(b, coat, 2, (x) => x.poly([[19, 38], [26, 40], [27, 52], [20, 50]], 1));
    shaded(b, coat, 1, (x) => x.poly([[38, 40], [44, 37], [44, 50], [37, 52]], 1), C.red);
    b.line(20, 50, 27, 52, C.maroon);
    // rifle strap
    b.line(12, 47, 22, 64, C.maroon); b.line(13, 47, 23, 64, C.umber); b.set(16, 53, C.fog);
    neck(b, VESPER_FACE, -1);
    const hair = [C.slate, C.steel, C.fog, C.pale, C.white];
    shaded(b, hair, 2, (x) => x.poly([[16, 40], [15, 20], [20, 9], [31, 5], [42, 8], [47, 16], [47, 30], [44, 24], [22, 22], [21, 40]], 1));
    const visorDown = mood === 'normal' || mood === 'angry';
    face(b, VESPER_FACE, mood, { eyes: !visorDown });
    // long fringe swept over the far side
    shaded(b, hair, 3, (x) => x.poly([[19, 22], [22, 12], [32, 8], [43, 11], [47, 19], [47, 34], [44, 33], [43, 24], [39, 19], [33, 20], [27, 18], [22, 24]], 1), C.red);
    b.line(25, 13, 34, 11, C.white); b.line(38, 13, 44, 19, C.pale);
    if (visorDown) {
      // red visor band with scanline glow
      for (let x = 20; x <= 44; x++) {
        b.set(x, EYE_Y - 1, C.maroon); b.set(x, EYE_Y, C.red); b.set(x, EYE_Y + 1, C.red); b.set(x, EYE_Y + 2, C.maroon);
      }
      b.hline(22, 30, EYE_Y, C.rose); b.set(36, EYE_Y + 1, C.rose);
      if (mood === 'angry') { b.hline(24, 27, EYE_Y + 1, C.white); b.hline(36, 39, EYE_Y + 1, C.white); }
    } else {
      // visor pushed up into the hair
      b.hline(21, 43, 14, C.maroon); b.hline(21, 43, 15, C.red); b.hline(23, 28, 15, C.rose);
    }
    b.outline(C.ink);
    if (visorDown) b.setIfEmpty(45, EYE_Y, C.red);
  },
};

// ---------------------------------------------------------------------------
// GEARJAW
// ---------------------------------------------------------------------------
const GJ_FACE: Face = { skin: SKIN_MID, iris: C.amber, rim: C.sodium, brow: C.maroon, jaw: 4, chin: 2 };
const GEARJAW: PortraitDef = {
  id: 'gearjaw', moods: ['normal', 'angry'], face: GJ_FACE,
  draw: (b, mood) => {
    // bare shoulders under a scrap harness, cables into the neck
    shoulders(b, [[0, 64], [2, 50], [14, 44], [32, 46], [50, 44], [62, 50], [64, 64]], [C.skinX, C.skinD, C.skinM, C.skinL], 2, C.sodium);
    b.line(6, 50, 26, 64, C.ink); b.line(7, 50, 27, 64, C.night);
    b.line(58, 50, 40, 64, C.ink);
    shaded(b, [C.ink, C.slate, C.steel, C.fog], 2, (x) => x.poly([[44, 44], [56, 44], [64, 50], [64, 58], [50, 54]], 1), C.sodium);
    for (const [x, y] of [[48, 46], [54, 47], [60, 50]] as Pt[]) b.set(x, y, C.amber);
    // tattoo
    b.line(10, 56, 14, 52, C.magenta); b.line(14, 52, 16, 56, C.magenta);
    neck(b, GJ_FACE, 4);
    for (const x of [27, 31, 35]) { b.line(x, 44, x - 2, 50, C.slate); b.set(x, 44, C.steel); }
    face(b, GJ_FACE, mood, { eyes: false });
    // shaved sides + tall red mohawk
    // shaved stubble on the skull
    for (let y = 8; y < 22; y++) for (let x = 18; x < 46; x++) {
      const c = b.get(x, y);
      if ((c === GJ_FACE.skin.L || c === GJ_FACE.skin.M) && (x * 3 + y * 5) % 4 === 0) b.set(x, y, GJ_FACE.skin.D);
    }
    const mm = new Mask(PT, PT).draw((x) => x.poly([[28, 16], [27, 7], [28, 1], [30, 5], [32, 0], [34, 5], [36, 1], [37, 6], [39, 3], [38, 10], [36, 16]], 1));
    shadeInto(b, mm, { ramp: [C.ink, C.maroon, C.red, C.rose], base: 2, light: [-1, -1] });
    b.line(31, 6, 31, 15, C.maroon); b.line(34, 6, 34, 15, C.rose);
    // goggles
    b.line(19, EYE_Y - 2, 45, EYE_Y - 3, C.ink);
    for (const [cx, r] of [[NEAR_X, 4], [FAR_X + 1, 3.5]] as [number, number][]) {
      b.circle(cx + 0.5, EYE_Y + 0.5, r + 1, C.ink);
      b.circle(cx + 0.5, EYE_Y + 0.5, r, mood === 'angry' ? C.red : C.sodium);
      b.circle(cx - 0.5, EYE_Y - 0.5, r - 2, mood === 'angry' ? C.rose : C.amber);
    }
    // the gear jaw: steel lower jaw with teeth, cogs on the side
    const open = mood === 'angry' ? 3 : 0;
    if (open) b.rect(26, 34, 15, 3 + open, C.maroon);
    const jm = new Mask(PT, PT).draw((x) => x.poly([[22, 34 + open], [44, 33 + open], [45, 38 + open], [40, 45 + open], [28, 46 + open], [22, 40 + open]], 1));
    shadeInto(b, jm, { ramp: [C.ink, C.slate, C.steel, C.fog, C.pale], base: 2, light: [-1, -1] });
    for (let x = 25; x <= 42; x += 2) { b.set(x, 34 + open, C.white); b.set(x, 35 + open, C.pale); }
    if (open) for (let x = 26; x <= 40; x += 2) b.set(x, 33, C.pale);
    b.circle(24.5, 40.5 + open, 3.5, C.slate); b.ring(24.5, 40.5 + open, 3.5, C.steel); b.set(24, 40 + open, C.ink);
    for (const [x, y] of [[21, 40], [28, 40], [24, 36], [24, 44]] as Pt[]) b.set(x, y + open, C.fog);
    // scars
    b.line(34, 26, 40, 33, C.skinD); b.line(35, 26, 41, 33, C.skinL);
    b.outline(C.ink);
    // steam from the jaw when angry
    if (mood === 'angry') for (const [x, y] of [[46, 36], [48, 34], [47, 31], [50, 32]] as Pt[]) b.setIfEmpty(x, y, C.fog);
  },
};

export const PORTRAITS: PortraitDef[] = [ECHO, MARA, ANVIL, PING, VESPER, GEARJAW];

export function buildPortraitSheet(): SheetSpec {
  const frames: { name: string; buf: PixBuf }[] = [];
  for (const p of PORTRAITS) {
    for (const mood of p.moods) {
      const b = new PixBuf(PT, PT);
      p.draw(b, mood);
      frames.push({ name: mood === 'normal' ? p.id : `${p.id}_${mood}`, buf: b });
    }
  }
  return {
    key: 'portraits', group: 'Portraits (64x64)', frameW: PT, frameH: PT, columns: 8, frames,
    meta: {
      facing: 'right',
      note: "Frame names match DialogueNode.portrait ('mara', 'mara_angry'). Unknown mood -> fall back to the bare id.",
      moods: Object.fromEntries(PORTRAITS.map((p) => [p.id, p.moods])),
    },
  };
}

void grid;
