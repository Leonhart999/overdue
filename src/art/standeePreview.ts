/**
 * Dev page for the standees (standee-preview.html).
 *   (no params)        every standee frame at x2 on a dark and a mid background, the x1 strip,
 *                      and the in-game sprites / old portraits they replace (for comparison)
 *   ?doc=1             only the x2 dark + mid rows and the x1 strip (used for docs/standees.png)
 *   ?only=a,b          restrict to these frame names
 *   ?zoom=x,y,w,h      only x4 crops of that rectangle of each frame
 *   ?icons=1           the `ico` sheet (cyberware / mod / reward icons) at x1 and x3 with names
 *                      (used for docs/icons.png)
 *   ?sprite=1          Echo's in-fight sprite (pc_echo) vs the old ow_echo on the four arena floors,
 *                      plus the Echo standees (used for docs/echo_sprite.png)
 * Sets `window.__standeeReady = true` when drawn (for headless screenshots).
 */
import { C, PALETTE_RGB } from './palette';
import { buildAllSpecs } from './index';
import { buildStandeeArt, STANDEE_H, STANDEE_W } from './standees';
import { buildIconArt } from './icons';
import type { PixBuf } from './core/pixbuf';
import type { SheetSpec } from './core/sheet';

type Frame = { name: string; buf: PixBuf };

const q = new URLSearchParams(location.search);
const hex = (c: number) => `rgb(${PALETTE_RGB[c].join(',')})`;

function paint(ctx: CanvasRenderingContext2D, b: PixBuf, x0: number, y0: number, s: number): void {
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const c = b.px[y * b.w + x];
    if (!c) continue;
    ctx.fillStyle = hex(c);
    ctx.fillRect(x0 + x * s, y0 + y * s, s, s);
  }
}

/** A row of frames drawn over a crop of an arena floor (scaled like the frames). */
function rowOn(title: string, frames: Frame[], s: number, floor: PixBuf, fx: number, fy: number): void {
  const pad = 4;
  const w = frames.reduce((a, f) => a + f.buf.w + pad, pad);
  const h = Math.max(...frames.map((f) => f.buf.h)) + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = w * s; cv.height = h * s + 16;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = hex(C.ink);
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#9097c0';
  ctx.font = '11px monospace';
  ctx.fillText(title, 4, 12);
  paint(ctx, floor.crop(fx, fy, w, h), 0, 16, s);
  let x = pad;
  for (const f of frames) { paint(ctx, f.buf, x * s, 16 + pad * s, s); x += f.buf.w + pad; }
  document.getElementById('out')!.appendChild(cv);
}

/** Frames in a grid with a name under each (icons). */
function table(title: string, frames: Frame[], s: number, cols: number, bg: number, cellW: number): void {
  const fw = frames[0].buf.w * s, fh = frames[0].buf.h * s;
  const cw = Math.max(fw, cellW) + 8, chh = fh + 22;
  const cv = document.createElement('canvas');
  cv.width = cols * cw + 8; cv.height = Math.ceil(frames.length / cols) * chh + 24;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = hex(bg);
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = '11px monospace';
  ctx.fillStyle = '#9097c0';
  ctx.fillText(title, 6, 13);
  frames.forEach((f, i) => {
    const x = 8 + (i % cols) * cw, y = 22 + Math.floor(i / cols) * chh;
    paint(ctx, f.buf, x + (cw - 8 - fw) / 2, y, s);
    ctx.fillStyle = '#ccd2ea';
    ctx.fillText(f.name, x, y + fh + 13);
  });
  document.getElementById('out')!.appendChild(cv);
}

function row(title: string, frames: Frame[], s: number, bg: number): void {
  if (!frames.length) return;
  const pad = 8;
  const w = frames.reduce((a, f) => a + f.buf.w * s + pad, pad);
  const h = Math.max(...frames.map((f) => f.buf.h)) * s + pad * 2 + 22;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = hex(bg);
  ctx.fillRect(0, 0, w, h);
  const ink = bg === C.slate ? '#ccd2ea' : '#9097c0';
  ctx.fillStyle = ink;
  ctx.font = '11px monospace';
  ctx.fillText(title, pad, 12);
  let x = pad;
  for (const f of frames) {
    paint(ctx, f.buf, x, pad + 14, s);
    ctx.fillStyle = ink;
    ctx.fillText(f.name, x, h - 4);
    x += f.buf.w * s + pad;
  }
  document.getElementById('out')!.appendChild(cv);
}

const pick = (specs: SheetSpec[], key: string, names?: string[]): Frame[] => {
  const s = specs.find((p) => p.key === key);
  if (!s) return [];
  return s.frames.filter((f) => !names || names.includes(f.name)).map((f) => ({ name: `${key}/${f.name}`, buf: f.buf }));
};

let frames: Frame[] = buildStandeeArt()[0].frames;
const only = q.get('only');
if (only) frames = frames.filter((f) => only.split(',').includes(f.name));
const zoom = q.get('zoom');

if (q.get('icons')) {
  const ico = buildIconArt()[0].frames;
  table('ico 24x24 at x3 (dark)', ico, 3, 9, C.ink, 96);
  table('ico at x3 on a card background', ico, 3, 9, C.navy, 96);
  table('ico at x1', ico, 1, 9, C.night, 96);
} else if (q.get('sprite')) {
  const all = buildAllSpecs();
  const sheet = (key: string) => pick(all, key).map((f) => ({ name: f.name.split('/')[1], buf: f.buf }));
  const pc = sheet('pc_echo'), ow = sheet('ow_echo');
  const floor = (key: string) => all.find((p) => p.key === key)!.frames[0].buf;
  const helipad = floor('bg_helipad');
  rowOn('pc_echo 20x30 (new), x4', pc, 4, helipad, 230, 150);
  rowOn('ow_echo 16x24 (old), x4', ow, 4, helipad, 230, 150);
  const idle = (fs: Frame[]) => fs.filter((f) => f.name.endsWith('_idle') || f.name.endsWith('_walkA'));
  for (const [key, x, y] of [['bg_scrapyard', 250, 170], ['bg_club', 240, 160], ['bg_serverfarm', 250, 200], ['bg_helipad', 230, 150]] as const) {
    rowOn(key + ': new (left 8) then old, x1', [...idle(pc), ...idle(ow)], 1, floor(key), x, y);
    rowOn(key + ': new (left 8) then old, x2 = game window scale', [...idle(pc), ...idle(ow)], 2, floor(key), x, y);
  }
  row('Echo standees (x2)', frames.filter((f) => f.name.startsWith('echo')), 2, C.ink);
  row('', frames.filter((f) => f.name.startsWith('echo')), 2, C.slate);
} else if (zoom) {
  const [zx, zy, zw, zh] = zoom.split(',').map(Number);
  row(`zoom x4 ${zoom}`, frames.map((f) => ({ name: f.name, buf: f.buf.crop(zx, zy, zw, zh) })), 4, C.ink);
} else {
  const half = Math.ceil(frames.length / 2);
  row(`standee ${STANDEE_W}x${STANDEE_H} at x2, dark background`, frames.slice(0, half), 2, C.ink);
  row('', frames.slice(half), 2, C.ink);
  row('mid background', frames.slice(0, half), 2, C.slate);
  row('', frames.slice(half), 2, C.slate);
  row('x1', frames, 1, C.night);
  if (!q.get('doc')) {
    const all = buildAllSpecs();
    row('in-game sprites (x3)', [
      ...pick(all, 'ow_echo', ['down_idle']),
      ...pick(all, 'bt_gearjaw', ['idle1']),
      ...pick(all, 'bt_gearjaw_stripped', ['idle1']),
      ...pick(all, 'lux', ['idle1']),
      ...pick(all, 'octo_heads', ['spitter_idle', 'beamer_idle', 'biter_idle']),
      ...pick(all, 'octo_core', ['shielded']),
      ...pick(all, 'kade', ['idle1']),
      ...pick(all, 'kade_broken', ['idle1']),
      ...pick(all, 'kade_drone', ['a']),
    ], 3, C.navy);
    row('old 64x64 portraits (x2)', [
      ...pick(all, 'portraits', ['echo', 'gearjaw_angry']),
      ...pick(all, 'lux_portrait'),
      ...pick(all, 'octo_portrait'),
      ...pick(all, 'kade_portrait'),
    ], 2, C.navy);
  }
}

(window as unknown as { __standeeReady: boolean }).__standeeReady = true;
