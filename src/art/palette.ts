/**
 * CHROME DEBT master palette.
 *
 * Every pixel of every generated texture is one of these 32 colours (index 0 = transparent).
 * Glow textures (fx_glow_*) are the only exception: they reuse palette colours with partial alpha.
 *
 * Ramps run dark -> light. Sprites never pick arbitrary hex values; they pick palette indices,
 * which keeps the whole game coherent and makes palette swaps trivial.
 */

export interface PaletteEntry {
  name: string;
  hex: string;
  role: string;
}

export const PALETTE: PaletteEntry[] = [
  { name: 'clear', hex: '#000000', role: 'transparent' },
  // cool neutrals: the night itself, wet concrete, chrome
  { name: 'ink', hex: '#0b0a12', role: 'outlines, deepest shadow' },
  { name: 'night', hex: '#161528', role: 'darkest base, sky, shadowed cloth' },
  { name: 'navy', hex: '#22213f', role: 'base dark (asphalt, jackets)' },
  { name: 'indigo', hex: '#2f2d58', role: 'base (walls, cloth mid)' },
  { name: 'slate', hex: '#444474', role: 'cool mid tone, metal shadow' },
  { name: 'steel', hex: '#63679a', role: 'cool light, metal mid' },
  { name: 'fog', hex: '#9097c0', role: 'chrome mid-light, wet highlights' },
  { name: 'pale', hex: '#ccd2ea', role: 'chrome light, Halcyon white shadow' },
  { name: 'white', hex: '#f5f6ff', role: 'speculars, Halcyon white' },
  // purples: neon-soaked shadows
  { name: 'plum', hex: '#2c1833', role: 'purple shadow' },
  { name: 'grape', hex: '#4d2560', role: 'purple dark' },
  { name: 'orchid', hex: '#8e3d92', role: 'purple mid' },
  { name: 'magenta', hex: '#ff2a8f', role: 'NEON magenta (Mara, signs, enemies)' },
  { name: 'rose', hex: '#ff9bd2', role: 'neon magenta light / core' },
  // teals: cyan neon
  { name: 'abyss', hex: '#0d3442', role: 'teal shadow, deep water' },
  { name: 'teal', hex: '#157f99', role: 'teal mid' },
  { name: 'cyan', hex: '#2de2f5', role: 'NEON cyan (Echo, UI focus, shock)' },
  { name: 'ice', hex: '#c0f8ff', role: 'neon cyan light / core' },
  // greens: acid / virus / Ping
  { name: 'moss', hex: '#1b4429', role: 'green shadow' },
  { name: 'lime', hex: '#46a52b', role: 'green mid' },
  { name: 'acid', hex: '#a8ff3c', role: 'NEON acid green (Ping, virus, heal)' },
  // reds
  { name: 'maroon', hex: '#651427', role: 'red shadow' },
  { name: 'red', hex: '#e62a3e', role: 'danger, Vesper visor, HP' },
  // warm: Rustport sodium light, rust, hazard
  { name: 'umber', hex: '#3b2119', role: 'brown dark, rust shadow' },
  { name: 'rust', hex: '#8c3f1d', role: 'rust mid' },
  { name: 'orange', hex: '#e07a1f', role: 'hazard orange, thermal' },
  { name: 'sodium', hex: '#ffab38', role: 'sodium street light' },
  { name: 'amber', hex: '#ffe27a', role: 'warm light core, gold, credits' },
  // skin
  { name: 'skinL', hex: '#f3c7a3', role: 'skin light' },
  { name: 'skinM', hex: '#d08d68', role: 'skin mid' },
  { name: 'skinD', hex: '#91543f', role: 'skin shadow / dark skin mid' },
  { name: 'skinX', hex: '#55302a', role: 'dark skin shadow' },
];

/** Palette indices by name. */
export const C = {
  clear: 0,
  ink: 1, night: 2, navy: 3, indigo: 4, slate: 5, steel: 6, fog: 7, pale: 8, white: 9,
  plum: 10, grape: 11, orchid: 12, magenta: 13, rose: 14,
  abyss: 15, teal: 16, cyan: 17, ice: 18,
  moss: 19, lime: 20, acid: 21,
  maroon: 22, red: 23,
  umber: 24, rust: 25, orange: 26, sodium: 27, amber: 28,
  skinL: 29, skinM: 30, skinD: 31, skinX: 32,
} as const;

export type ColorName = keyof typeof C;

/** Shading ramps, dark -> light. */
export const RAMP = {
  cool: [C.ink, C.night, C.navy, C.indigo, C.slate, C.steel, C.fog, C.pale, C.white],
  chrome: [C.ink, C.slate, C.steel, C.fog, C.pale, C.white],
  white: [C.slate, C.steel, C.fog, C.pale, C.white],
  purple: [C.ink, C.plum, C.grape, C.orchid, C.magenta, C.rose],
  teal: [C.ink, C.abyss, C.teal, C.cyan, C.ice],
  green: [C.ink, C.moss, C.lime, C.acid],
  red: [C.ink, C.maroon, C.red, C.rose],
  rust: [C.ink, C.umber, C.rust, C.orange, C.sodium, C.amber],
  skin: [C.skinX, C.skinD, C.skinM, C.skinL],
  skinDark: [C.ink, C.skinX, C.skinD, C.skinM],
} as const;

/** Grid character -> palette index, used by sprites that do not define their own legend. */
export const DEFAULT_LEGEND: Record<string, number> = {
  '.': C.clear,
  k: C.ink, n: C.night, v: C.navy, i: C.indigo, s: C.slate, e: C.steel, f: C.fog, p: C.pale, w: C.white,
  u: C.plum, g: C.grape, o: C.orchid, m: C.magenta, r: C.rose,
  a: C.abyss, t: C.teal, c: C.cyan, I: C.ice,
  G: C.moss, l: C.lime, A: C.acid,
  M: C.maroon, R: C.red,
  b: C.umber, x: C.rust, O: C.orange, S: C.sodium, Y: C.amber,
  '1': C.skinL, '2': C.skinM, '3': C.skinD, '4': C.skinX,
};

/** 0xAABBGGRR words for fast ImageData writes (little-endian). */
export const PALETTE_U32: Uint32Array = (() => {
  const out = new Uint32Array(PALETTE.length);
  PALETTE.forEach((p, i) => {
    if (i === 0) return;
    const v = parseInt(p.hex.slice(1), 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    out[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  });
  return out;
})();

export const PALETTE_RGB: [number, number, number][] = PALETTE.map((p) => {
  const v = parseInt(p.hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
});
