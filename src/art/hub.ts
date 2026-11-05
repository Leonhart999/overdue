/**
 * Hub (据点) art: background `bg_hub` (640x360) and station sprites `hub` (frames below).
 *   rack       16x32  weapon stand (weapon sprite drawn on top at runtime)
 *   bench      48x32  cyberware workbench with a robot arm
 *   terminal   24x32  records terminal (screen glow drawn at runtime)
 *   dummy      24x40  training dummy, dummy_hit (dented)
 *   turret     24x24  practice turret facing left, turret_off
 *   elevator   48x48  exit elevator door (drawn over the top wall)
 */
import { C } from './palette';
import { PixBuf } from './core/pixbuf';
import { hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';
import { autotileWalls } from './tiles/autotile';
import { buildHideout } from './tiles/hideout';

const W = 640, H = 360;

function frame(w: number, h: number, draw: (b: PixBuf) => void): PixBuf {
  const b = new PixBuf(w, h);
  draw(b);
  return b;
}

function rack(): PixBuf {
  return frame(16, 32, (b) => {
    // pegboard back panel
    b.rect(1, 2, 14, 22, C.navy);
    b.rect(2, 3, 12, 20, C.indigo);
    for (let y = 5; y < 22; y += 3) for (let x = 3; x < 14; x += 3) b.set(x, y, C.night);
    b.hline(1, 14, 2, C.slate);
    // shelf + legs
    b.rect(0, 24, 16, 3, C.slate);
    b.hline(0, 15, 24, C.fog);
    b.rect(2, 27, 2, 5, C.navy);
    b.rect(12, 27, 2, 5, C.navy);
    // hooks
    b.set(5, 10, C.fog); b.set(10, 10, C.fog);
    b.outline(C.ink);
  });
}

function bench(): PixBuf {
  return frame(48, 32, (b) => {
    // table top + body
    b.rect(2, 12, 44, 6, C.slate);
    b.hline(2, 45, 12, C.fog);
    b.rect(3, 18, 42, 10, C.navy);
    for (let x = 6; x < 44; x += 8) b.rect(x, 20, 6, 6, C.indigo);
    for (let x = 4; x < 45; x++) b.set(x, 28, (x >> 1) % 2 ? C.amber : C.ink);
    // spare limb on the table
    b.capsule(12, 10, 24, 9, 2, C.fog);
    b.capsule(24, 9, 29, 11, 1.6, C.steel);
    b.set(14, 9, C.white);
    for (let i = 0; i < 3; i++) b.set(30 + i, 11 + (i % 2), C.steel);
    // robot arm
    b.rect(38, 4, 4, 8, C.steel);
    b.line(40, 4, 34, 0, C.fog);
    b.line(41, 4, 35, 0, C.steel);
    b.set(34, 1, C.cyan); b.set(33, 2, C.ice);
    // small screen
    b.rect(4, 6, 8, 6, C.ink);
    b.rect(5, 7, 6, 4, C.abyss);
    b.hline(5, 9, 8, C.cyan);
    b.hline(5, 7, 10, C.teal);
    b.outline(C.ink);
  });
}

function terminal(): PixBuf {
  return frame(24, 32, (b) => {
    b.rect(3, 4, 18, 24, C.slate);
    b.rect(4, 5, 16, 22, C.navy);
    b.rect(5, 6, 14, 11, C.ink);
    b.rect(6, 7, 12, 9, C.moss);
    for (let y = 8; y < 15; y += 2) b.hline(7, 7 + Math.floor(hash2(y, 3) * 9), y, C.acid);
    b.rect(5, 19, 14, 4, C.indigo);
    for (let x = 6; x < 18; x += 2) b.set(x, 20, C.fog);
    b.rect(2, 28, 20, 3, C.navy);
    b.hline(2, 21, 28, C.steel);
    b.set(18, 24, C.red);
    b.outline(C.ink);
  });
}

function dummy(hit: boolean): PixBuf {
  return frame(24, 40, (b) => {
    // post + base
    b.rect(10, 26, 4, 10, C.slate);
    b.ellipse(12, 37, 9, 2.5, C.navy);
    b.hline(4, 20, 36, C.steel);
    // torso: armoured target
    b.poly([[4, 10], [20, 10], [21, 24], [12, 28], [3, 24]], C.rust);
    b.poly([[5, 11], [19, 11], [20, 23], [12, 26], [4, 23]], C.orange);
    b.ring(12, 18, 5, C.amber);
    b.ring(12, 18, 2.5, C.red);
    b.set(12, 18, C.white);
    // head
    b.rect(8, 2, 8, 7, C.steel);
    b.rect(9, 3, 6, 5, C.fog);
    b.hline(9, 14, 5, C.ink);
    b.set(10, 5, C.red); b.set(13, 5, C.red);
    // shoulders
    b.rect(1, 10, 4, 4, C.slate);
    b.rect(19, 10, 4, 4, C.slate);
    if (hit) {
      b.line(7, 14, 10, 20, C.ink);
      b.line(15, 13, 17, 19, C.ink);
      b.set(16, 16, C.white);
    }
    b.outline(C.ink);
  });
}

function turret(on: boolean): PixBuf {
  return frame(24, 24, (b) => {
    // wall mount
    b.rect(16, 4, 7, 18, C.slate);
    b.vline(16, 4, 21, C.fog);
    for (let y = 6; y < 20; y += 4) b.set(20, y, C.ink);
    // housing
    b.ellipse(13, 13, 6, 6, C.indigo);
    b.ellipse(12, 12, 5, 5, C.steel);
    // barrels pointing left
    b.rect(1, 10, 9, 2, C.slate);
    b.rect(1, 14, 9, 2, C.slate);
    b.hline(1, 9, 10, C.fog);
    b.hline(1, 9, 14, C.fog);
    // eye
    b.circle(12.5, 12.5, 2, on ? C.red : C.navy);
    b.set(12, 12, on ? C.rose : C.slate);
    b.outline(C.ink);
  });
}

function elevator(): PixBuf {
  return frame(48, 48, (b) => {
    // frame
    b.rect(2, 4, 44, 44, C.slate);
    b.rect(4, 6, 40, 42, C.ink);
    b.hline(2, 45, 4, C.fog);
    // doors
    b.rect(5, 10, 18, 38, C.indigo);
    b.rect(25, 10, 18, 38, C.indigo);
    b.vline(23, 10, 47, C.ink); b.vline(24, 10, 47, C.ink);
    b.vline(6, 10, 47, C.steel); b.vline(26, 10, 47, C.steel);
    for (let y = 14; y < 46; y += 6) { b.hline(8, 20, y, C.navy); b.hline(28, 40, y, C.navy); }
    // hazard header + indicator
    for (let x = 4; x < 44; x++) b.set(x, 7, (x >> 1) % 2 ? C.amber : C.ink);
    b.set(4 + 20, 5, C.red); b.set(4 + 19, 5, C.red);
    b.rect(20, 0, 8, 4, C.navy);
    b.hline(21, 26, 1, C.red);
    b.hline(22, 25, 2, C.rose);
    b.outline(C.ink);
  });
}

function background(): PixBuf {
  const spec = buildHideout();
  const idx = spec.meta!.tiles as Record<string, number>;
  const T = (n: string) => spec.frames[idx[n]].buf;
  const cols = 40, rows = 23;
  const isWall = (x: number, y: number) => y <= 2 || y >= 21 || x === 0 || x === 39;
  const at = autotileWalls(cols, rows, isWall);
  const b = new PixBuf(W, H);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let name = at.wall[y][x];
    if (!name) {
      if (at.shadow[y][x]) name = 'floor_shadow';
      else if (x >= 21) name = 'floor_concrete';
      else if (x >= 3 && x <= 9 && y >= 15 && y <= 19) name = 'rug';
      else name = hash2(x, y, 4) < 0.5 ? 'floor_0' : 'floor_1';
    } else if (y === 2) {
      // decorate the wall face row
      if ([4, 5, 13, 14, 26, 27, 34, 35].includes(x)) name = 'window_city';
      else if (x === 10) name = 'poster_idol';
      else if (x === 31) name = 'poster_halcyon';
    }
    b.blit(T(name), x * 16, y * 16);
  }
  // furniture overlays
  b.blit(T('crate'), 36 * 16, 19 * 16);
  b.blit(T('crate'), 37 * 16, 19 * 16);
  b.blit(T('crate'), 37 * 16, 18 * 16);
  b.blit(T('bed_top'), 1 * 16, 18 * 16);
  b.blit(T('bed_bottom'), 1 * 16, 19 * 16);
  // divider between living side and range: a painted hazard line on the concrete edge
  for (let y = 48; y < 336; y++) if ((y >> 2) % 2 === 0) { b.set(336, y, C.amber); b.set(337, y, C.amber); } else { b.set(336, y, C.ink); b.set(337, y, C.ink); }
  // range floor markings: lanes and a target circle around the dummy spot
  for (let a = 0; a < Math.PI * 2; a += 0.006) {
    const x = Math.round(510 + Math.cos(a) * 46), y = Math.round(196 + Math.sin(a) * 30);
    if (Math.floor(a * 16) % 2 === 0) b.set(x, y, C.orange);
  }
  for (let x = 360; x < 600; x += 2) { b.set(x, 120, C.slate); b.set(x, 280, C.slate); }
  return b;
}

export function buildHubArt(): SheetSpec[] {
  const tall = (n: string, buf: PixBuf, w: number, h: number) => {
    const out = new PixBuf(w, h);
    out.blit(buf, Math.floor((w - buf.w) / 2), h - buf.h);
    return { name: n, buf: out };
  };
  return [
    { key: 'bg_hub', group: 'Hub', frameW: W, frameH: H, frames: [{ name: 'bg', buf: background() }] },
    {
      key: 'hub', group: 'Hub', frameW: 48, frameH: 48, columns: 5,
      frames: [
        tall('rack', rack(), 48, 48),
        tall('bench', bench(), 48, 48),
        tall('terminal', terminal(), 48, 48),
        tall('dummy', dummy(false), 48, 48),
        tall('dummy_hit', dummy(true), 48, 48),
        tall('turret', turret(true), 48, 48),
        tall('turret_off', turret(false), 48, 48),
        tall('elevator', elevator(), 48, 48),
      ],
    },
  ];
}
