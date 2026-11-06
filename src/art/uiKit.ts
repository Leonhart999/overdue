/**
 * UI kit textures and the micro pixel font.
 *
 * Sheets (all generated here, palette colours only):
 *   uik_m   10x14  mouse icons: mouse_n (no button), mouse_l, mouse_r (pressed button lit cyan),
 *                  mouse_la / mouse_ra (pressed button lit amber, used for "special ready")
 *   uik_c   7x11   HUD cells: hp_full, hp_empty, sh_full, sh_empty
 *   uik_x   24x24  lock cross drawn over a locked cyberware slot
 *   uik_px  1x1    one white pixel; drawn with `fill` it is an exact-colour rect that layers
 *                  with images (Graphics shapes always sit below images on a layer)
 *
 * MICRO is a 3x5 pixel font (A-Z, 0-9, a few symbols and arrows) for key-cap legends, serial
 * numbers, EN tags and compact HUD numbers. It is plain data so node tests can import it;
 * src/ui/crispText.ts turns strings into textures.
 */
import { C } from './palette';
import { PixBuf } from './core/pixbuf';
import type { SheetSpec } from './core/sheet';

/** Micro font glyph rows ('#' = ink). Height is always 5; width varies per glyph. */
const MICRO_SRC: Record<string, string> = {
  A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.',
  E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..', G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#',
  I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
  M: '#...#|##.##|#.#.#|#...#|#...#', N: '#..#|##.#|#.##|#..#|#..#', O: '.#.|#.#|#.#|#.#|.#.',
  P: '##.|#.#|##.|#..|#..', Q: '###|#.#|#.#|###|..#', R: '##.|#.#|##.|#.#|#.#', S: '.##|#..|.#.|..#|##.',
  T: '###|.#.|.#.|.#.|.#.', U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#...#|#...#|#.#.#|##.##|#...#',
  X: '#.#|#.#|.#.|#.#|#.#', Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
  '0': '###|#.#|#.#|#.#|###', '1': '.#.|##.|.#.|.#.|###', '2': '##.|..#|.#.|#..|###', '3': '##.|..#|.#.|..#|##.',
  '4': '#.#|#.#|###|..#|..#', '5': '###|#..|##.|..#|##.', '6': '.##|#..|###|#.#|###', '7': '###|..#|.#.|.#.|.#.',
  '8': '###|#.#|###|#.#|###', '9': '###|#.#|###|..#|##.',
  ' ': '..|..|..|..|..', '.': '.|.|.|.|#', ',': '.|.|.|#|#', ':': '.|#|.|#|.', '-': '...|...|###|...|...',
  '+': '...|.#.|###|.#.|...', '/': '..#|..#|.#.|#..|#..', '#': '#.#|###|#.#|###|#.#', '%': '#.#|..#|.#.|#..|#.#',
  '>': '#..|.#.|..#|.#.|#..', '<': '..#|.#.|#..|.#.|..#', '(': '.#|#.|#.|#.|.#', ')': '#.|.#|.#|.#|#.',
  '=': '...|###|...|###|...', '_': '...|...|...|...|###', '·': '.|.|#|.|.', '×': '...|#.#|.#.|#.#|...',
  '!': '#|#|#|.|#', '?': '##.|..#|.#.|...|.#.', "'": '#|#|.|.|.',
  '↑': '..#..|.###.|#.#.#|..#..|..#..', '↓': '..#..|..#..|#.#.#|.###.|..#..',
  '←': '..#..|.#...|#####|.#...|..#..', '→': '..#..|...#.|#####|...#.|..#..',
  '◀': '..#|.##|###|.##|..#', '▶': '#..|##.|###|##.|#..', '■': '###|###|###|###|###',
  '␣': '.....|.....|.....|#...#|#####',
};

export const MICRO_H = 5;
/** Glyph bitmaps: rows of booleans. Unknown characters fall back to '?'. */
export const MICRO: Record<string, boolean[][]> = Object.fromEntries(
  Object.entries(MICRO_SRC).map(([ch, s]) => [ch, s.split('|').map((r) => [...r].map((c) => c === '#'))]),
);

export function microGlyph(ch: string): boolean[][] {
  return MICRO[ch] ?? MICRO[ch.toUpperCase()] ?? MICRO['?'];
}

/** Advance width of a micro string (1 px between glyphs plus `spacing`). */
export function microWidth(str: string, spacing = 0): number {
  let w = 0, n = 0;
  for (const ch of str) { w += microGlyph(ch)[0].length; n++; }
  return n ? w + (n - 1) * (1 + spacing) : 0;
}

// ------------------------------------------------------------------ textures

function fromRows(rows: string[], legend: Record<string, number>): PixBuf {
  const b = new PixBuf(rows[0].length, rows.length);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (legend[ch]) b.set(x, y, legend[ch]); }));
  return b;
}

/** Mouse 10x14: two buttons split by a seam, body below. `lit` = which button glows. */
function mouse(lit: 'l' | 'r' | null, glow: number): PixBuf {
  const rows = [
    '.kkkkkkk..',
    'kLLLkRRRk.',
    'kLLLkRRRk.',
    'kLLLkRRRk.',
    'kLLLkRRRk.',
    'kkkkkkkkk.',
    'kbhbbbbbk.',
    'kbbbbbbbk.',
    'kbbbbbbbk.',
    'kbbbbbbbk.',
    'kbbbbbbbk.',
    'kdbbbbbdk.',
    '.kdddddk..',
    '..kkkkk...',
  ];
  return fromRows(rows, {
    k: C.ink, b: C.steel, h: C.fog, d: C.slate,
    L: lit === 'l' ? glow : C.slate, R: lit === 'r' ? glow : C.slate,
  });
}

/** Battery-like HUD cell 7x11: ink outline, chrome rim, coloured fill with a highlight column. */
function cell(fill: number | null, hi: number, dark: number): PixBuf {
  const b = new PixBuf(7, 11);
  b.rect(1, 0, 5, 11, C.ink);
  b.rect(0, 1, 7, 9, C.ink);
  b.rect(1, 1, 5, 9, C.steel);
  b.hline(2, 4, 1, C.fog);
  b.rect(2, 2, 3, 7, fill ?? dark);
  if (fill !== null) {
    b.vline(2, 2, 7, hi);
    b.set(4, 8, dark);
  } else {
    b.set(2, 2, C.ink);
  }
  return b;
}

function lockCross(): PixBuf {
  const b = new PixBuf(24, 24);
  for (let i = 3; i <= 20; i++) {
    for (const [x, y] of [[i, i], [23 - i, i]] as const) {
      b.rect(x - 1, y - 1, 3, 3, C.ink);
    }
  }
  for (let i = 3; i <= 20; i++) {
    b.set(i, i, C.red); b.set(i + 1, i, C.red);
    b.set(23 - i, i, C.red); b.set(22 - i, i, C.red);
  }
  return b;
}

export function buildUiKit(): SheetSpec[] {
  const px = new PixBuf(1, 1);
  px.set(0, 0, C.white);
  return [
    {
      key: 'uik_m', group: 'UI', frameW: 10, frameH: 14, columns: 5,
      frames: [
        { name: 'mouse_n', buf: mouse(null, C.cyan) },
        { name: 'mouse_l', buf: mouse('l', C.cyan) },
        { name: 'mouse_r', buf: mouse('r', C.cyan) },
        { name: 'mouse_la', buf: mouse('l', C.amber) },
        { name: 'mouse_ra', buf: mouse('r', C.amber) },
      ],
    },
    {
      key: 'uik_c', group: 'UI', frameW: 7, frameH: 11, columns: 4,
      frames: [
        { name: 'hp_full', buf: cell(C.red, C.rose, C.maroon) },
        { name: 'hp_empty', buf: cell(null, C.rose, C.night) },
        { name: 'sh_full', buf: cell(C.cyan, C.ice, C.teal) },
        { name: 'sh_empty', buf: cell(null, C.ice, C.abyss) },
      ],
    },
    { key: 'uik_x', group: 'UI', frameW: 24, frameH: 24, frames: [{ name: 'lock', buf: lockCross() }] },
    { key: 'uik_px', group: 'UI', frameW: 1, frameH: 1, frames: [{ name: 'px', buf: px }] },
  ];
}
