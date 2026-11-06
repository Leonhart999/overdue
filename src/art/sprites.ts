/**
 * OVERDUE sprites drawn in code (palette indices only).
 *   proj    12x12  projectiles + small markers (origin centre, drawn pointing right)
 *   wpn     20x10  held weapons (pointing right, grip near x=4)
 *   props   16x24  barrel, barrel_lit, lever_up, lever_down (origin bottom centre)
 *   pillar  16x40  steel column
 *   block   32x32  scrap_block, trolley
 *   stack   48x48  car_stack, car_stack_dent, car_rubble (48x32 footprint, origin bottom centre)
 *   hud     10x10  heart, heart_empty, shield, nail, shell, shell_empty
 *   cursor  13x13  crosshair
 */
import { C } from './palette';
import { grid, legend } from './core/grid';
import { PixBuf } from './core/pixbuf';
import { hash2 } from './core/rng';
import type { SheetSpec } from './core/sheet';

const L = legend({});

function frame(w: number, h: number, draw: (b: PixBuf) => void): PixBuf {
  const b = new PixBuf(w, h);
  draw(b);
  return b;
}

function centered(src: PixBuf, w: number, h: number): PixBuf {
  const b = new PixBuf(w, h);
  b.blit(src, Math.floor((w - src.w) / 2), Math.floor((h - src.h) / 2));
  return b;
}

// ------------------------------------------------------------------ projectiles
function projFrames(): { name: string; buf: PixBuf }[] {
  const S = 12;
  const g = (s: string) => centered(grid(s, L), S, S);
  return [
    { name: 'nail', buf: g(`
      ......
      kfpwwI
      ksfppw
      ......`) },
    { name: 'nail_stuck', buf: g(`
      kfpwc
      ksfpc`) },
    { name: 'pellet', buf: g(`
      SY
      OS`) },
    { name: 'pellet_fire', buf: g(`
      .Y.
      SYO
      .O.`) },
    { name: 'slug', buf: g(`
      .kSSYw.
      kOSSYww
      .kOOS..`) },
    { name: 'orb_o', buf: g(`
      .kkkk.
      kOSSOk
      kSYwSk
      kSYYSk
      kOSSOk
      .kkkk.`) },
    { name: 'orb_m', buf: g(`
      .kkkk.
      kmrrmk
      krwwrk
      krwrrk
      kmrrmk
      .kkkk.`) },
    { name: 'scrap', buf: g(`
      ..kkk.
      .kOSxk
      kOSYOk
      kxOSk.
      .kkk..`) },
    { name: 'bolt', buf: g(`
      ..kkkkkk..
      kRRrwwwwwk
      kMRRrrwwk.
      ..kkkkkk..`) },
    { name: 'deflect', buf: g(`
      .kkkk.
      kcIIck
      kIwwIk
      kIwwIk
      kcIIck
      .kkkk.`) },
    { name: 'arcball', buf: g(`
      ..kkkk..
      .kcIIck.
      kcIwwIck
      kIwwwwIk
      kIwwwwIk
      kcIwwIck
      .kcIIck.
      ..kkkk..`) },
    { name: 'claw', buf: g(`
      .kk...
      kffk..
      .kffkk
      ..kfpw
      .kffkk
      kffk..
      .kk...`) },
    { name: 'hook', buf: g(`
      ..kkk...
      .kfffk..
      kfk.kfk.
      kfk..kfk
      .k...kfk
      ....kffk
      ..kkffk.
      ...kkk..`) },
    { name: 'acid', buf: g(`
      .kkk.
      kAllk
      klAGk
      .kkk.`) },
    { name: 'heart', buf: g(`
      .kk.kk.
      kmrkrmk
      kmrrrmk
      .kmrmk.
      ..kmk..
      ...k...`) },
    { name: 'magnet', buf: g(`
      kkkkkk
      kssssk
      kx..xk
      kx..xk
      kR..Rk`) },
    { name: 'star', buf: g(`
      ..k..
      .kYk.
      kYwYk
      .kYk.
      ..k..`) },
  ];
}

// ------------------------------------------------------------------ held weapons (20x10)
function wpnFrames(): { name: string; buf: PixBuf }[] {
  const W = 20, H = 10;
  const at = (s: string) => { const b = new PixBuf(W, H); b.blit(grid(s, L), 2, 1); return b; };
  return [
    // nail gun: boxy body, magazine strip on top, short barrel
    { name: 'riveter', buf: at(`
      ...kkkkkk.......
      ..kYYYYYYk......
      .kseeeeefsskk...
      kseeffffeessfk..
      ksessssseekkk...
      .kkxk.kss.......
      ...kk..kk.......`) },
    // arc caster: coil emitter with glowing prongs
    { name: 'arc', buf: at(`
      ..........kc.....
      ..kkkkkkkkIck....
      .ksffffstcItk....
      ksetttttsfcIIw...
      .kseeeeeskIck....
      ..kkskkkkkck.....
      ...kk............`) },
    // breacher: pump shotgun, long dark barrel, wood-ish rust grip
    { name: 'breacher', buf: at(`
      .................
      kkkkkkkkkkkkkkkk.
      kxxbsseeeeeeeeefk
      kxbksssskssssssk.
      .kbk.kxxxk.......
      ..kk..kkk........`) },
    // monoblade: thin glowing edge, short guard
    { name: 'blade', buf: at(`
      ...k..............
      ..kpk.kkkkkkkkkk..
      kkkskkIwwwwwwwwwIk
      ..kpk.kkkkkkkkkk..
      ...k..............`) },
  ];
}

// ------------------------------------------------------------------ props (16x24)
function barrel(lit: boolean): PixBuf {
  return frame(16, 24, (b) => {
    // body
    b.rect(3, 9, 10, 14, C.maroon);
    b.rect(4, 9, 8, 14, C.red);
    b.rect(5, 9, 2, 14, C.rose);
    b.rect(11, 9, 1, 14, C.maroon);
    // ribs
    b.hline(3, 12, 12, C.maroon); b.hline(3, 12, 19, C.maroon);
    b.hline(4, 11, 13, C.ink); b.hline(4, 11, 20, C.ink);
    // top ellipse
    b.ellipse(8, 8.5, 5, 2.2, C.maroon);
    b.ellipse(8, 8.3, 4, 1.4, C.night);
    b.set(10, 8, C.slate); b.set(11, 8, C.slate);
    // hazard label
    b.rect(6, 15, 4, 3, C.amber);
    b.set(7, 16, C.ink); b.set(8, 16, C.ink);
    if (lit) {
      for (let i = 0; i < 7; i++) {
        const x = 5 + Math.floor(hash2(i, 3) * 7), h = 2 + Math.floor(hash2(i, 4) * 4);
        b.vline(x, 7 - h, 7, i % 2 ? C.sodium : C.orange);
        b.set(x, 7 - h, C.amber);
      }
      b.hline(4, 11, 16, C.orange);
    }
    b.outline(C.ink);
  });
}

function lever(down: boolean): PixBuf {
  return frame(16, 24, (b) => {
    // wall box
    b.rect(3, 6, 10, 15, C.slate);
    b.rect(4, 7, 8, 13, C.indigo);
    b.hline(4, 11, 7, C.steel);
    // hazard stripes on the base
    for (let x = 3; x < 13; x++) b.set(x, 20, (x >> 1) % 2 ? C.amber : C.ink);
    b.rect(3, 21, 10, 2, C.navy);
    // handle
    const top = down ? 16 : 2;
    b.line(8, 13, down ? 12 : 11, top, C.fog);
    b.line(9, 13, down ? 13 : 12, top, C.steel);
    b.circle(down ? 13 : 12, top, 2, C.amber);
    b.set(down ? 12 : 11, top - 1, C.white);
    // light
    b.set(5, 9, down ? C.acid : C.red);
    b.set(6, 9, down ? C.acid : C.red);
    b.outline(C.ink);
  });
}

function pillar(): PixBuf {
  return frame(16, 40, (b) => {
    // I-beam column: front flange + web
    b.rect(3, 4, 10, 34, C.slate);
    b.rect(4, 4, 3, 34, C.steel);
    b.rect(5, 4, 1, 34, C.fog);
    b.rect(10, 4, 2, 34, C.indigo);
    // top cap
    b.rect(2, 2, 12, 3, C.steel);
    b.hline(2, 13, 2, C.pale);
    // hazard band
    for (let y = 26; y < 32; y++) for (let x = 3; x < 13; x++) b.set(x, y, ((x + y) >> 1) % 2 ? C.amber : C.ink);
    // base plate + bolts
    b.rect(1, 35, 14, 4, C.navy);
    b.hline(1, 14, 35, C.steel);
    b.set(3, 37, C.fog); b.set(12, 37, C.fog);
    // rivets
    for (let y = 8; y < 24; y += 5) { b.set(8, y, C.fog); b.set(8, y + 1, C.ink); }
    b.outline(C.ink);
  });
}

function scrapBlock(): PixBuf {
  return frame(32, 32, (b) => {
    // crushed car cube in 3/4 view: top face + front face
    b.rect(2, 6, 28, 9, C.rust);
    b.rect(2, 15, 28, 15, C.umber);
    for (let i = 0; i < 40; i++) {
      const x = 2 + Math.floor(hash2(i, 9) * 28), y = 6 + Math.floor(hash2(i, 10) * 24);
      const w = 2 + Math.floor(hash2(i, 11) * 6);
      const c = [C.rust, C.orange, C.slate, C.steel, C.red, C.navy, C.teal][Math.floor(hash2(i, 12) * 7)];
      b.hline(x, Math.min(29, x + w), y, c);
    }
    b.hline(2, 29, 15, C.ink);
    b.hline(2, 29, 6, C.orange);
    b.hline(3, 28, 16, C.rust);
    // a squashed headlight and wheel
    b.circle(7, 24, 2.5, C.ink); b.circle(7, 24, 1.2, C.slate);
    b.rect(22, 20, 4, 2, C.amber);
    b.outline(C.ink);
  });
}

/**
 * Stack of crushed cars in 3/4 view: a 48x32 top face over a 16 px front face of two squashed
 * car bodies. `dent` knocks the top car askew and adds dark gaps.
 */
function carStack(dent: boolean): PixBuf {
  return frame(48, 48, (b) => {
    // top face: the upper car seen from above, nose to the left
    const ox = dent ? 2 : 0;
    b.rect(1, 4, 46, 28, C.umber); // scrap bed under it
    for (let i = 0; i < 40; i++) {
      const x = 1 + Math.floor(hash2(i, 21) * 44), y = 4 + Math.floor(hash2(i, 22) * 27);
      b.hline(x, Math.min(46, x + 1 + Math.floor(hash2(i, 23) * 4)), y, [C.rust, C.slate, C.skinX][Math.floor(hash2(i, 24) * 3)]);
    }
    b.rect(3 + ox, 7, 42, 22, C.teal); // body
    b.rect(5 + ox, 7, 3, 22, C.abyss); // front bumper shadow
    b.rect(15 + ox, 9, 18, 18, C.ice); // roof
    b.rect(16 + ox, 10, 16, 16, C.teal);
    b.rect(12 + ox, 9, 3, 18, C.abyss); b.rect(33 + ox, 9, 3, 18, C.abyss); // windscreens
    b.line(18 + ox, 12, 26 + ox, 20, C.abyss); // roof crease
    b.line(38 + ox, 9, 43 + ox, 15, C.ink);
    b.set(4 + ox, 9, C.amber); b.set(4 + ox, 26, C.amber); // headlights
    // front face: the side of the upper car over a squashed red one
    b.rect(2, 32, 44, 7, C.teal);
    b.hline(2, 45, 32, C.ice);
    b.vline(18, 33, 38, C.abyss); b.vline(30, 33, 38, C.abyss); // door seams
    b.rect(1, 39, 46, 8, C.maroon);
    b.rect(3, 40, 42, 3, C.red);
    b.hline(1, 46, 39, C.ink);
    for (const [x, y] of [[9, 38], [39, 38], [7, 46], [41, 46]] as [number, number][]) { b.circle(x, y, 2.5, C.ink); b.circle(x, y, 1, C.slate); }
    if (dent) {
      b.line(6, 33, 14, 38, C.ink); b.line(24, 40, 34, 46, C.ink);
      b.rect(26, 12 , 5, 3, C.ink);
      b.vline(20, 7, 28, C.abyss);
    }
    b.outline(C.ink);
  });
}

/** Flattened cars on the floor after a stack collapses (bottom 18 px of the frame). */
function carRubble(): PixBuf {
  return frame(48, 48, (b) => {
    for (let i = 0; i < 26; i++) {
      const x = 2 + Math.floor(hash2(i, 41) * 40), y = 32 + Math.floor(hash2(i, 42) * 14);
      const w = 3 + Math.floor(hash2(i, 43) * 8);
      b.rect(x, y, w, 2, [C.red, C.teal, C.navy, C.rust, C.umber, C.slate][Math.floor(hash2(i, 44) * 6)]);
    }
    b.outline(C.ink);
  });
}

function trolley(): PixBuf {
  return frame(32, 32, (b) => {
    b.rect(6, 22, 20, 8, C.slate);
    b.rect(7, 23, 18, 3, C.steel);
    b.hline(6, 25, 22, C.fog);
    b.circle(9, 30, 2, C.ink); b.circle(23, 30, 2, C.ink);
    for (let x = 7; x < 25; x++) b.set(x, 28, (x >> 1) % 2 ? C.amber : C.ink);
    b.set(16, 25, C.red);
    b.outline(C.ink);
  });
}

// ------------------------------------------------------------------ hud (10x10)
function hudFrames(): { name: string; buf: PixBuf }[] {
  const g = (s: string) => centered(grid(s, L), 10, 10);
  return [
    { name: 'heart', buf: g(`
      .kk.kk.
      kRrkrRk
      kRrrrRk
      kMRRRMk
      .kMRMk.
      ..kMk..
      ...k...`) },
    { name: 'heart_empty', buf: g(`
      .kk.kk.
      kvvkvvk
      kvnnnvk
      kvnnnvk
      .kvnvk.
      ..kvk..
      ...k...`) },
    { name: 'shield', buf: g(`
      kkkkkkk
      kcIIIck
      kcIwIck
      kcIIIck
      .kcIck.
      ..kck..
      ...k...`) },
    { name: 'nail', buf: g(`
      kk....
      kfpwwI
      kk....`) },
    { name: 'shell', buf: g(`
      kkkk
      kRRk
      kRRk
      kRRk
      kYYk
      kSSk
      kkkk`) },
    { name: 'shell_empty', buf: g(`
      kkkk
      knnk
      knnk
      knnk
      kvvk
      kvvk
      kkkk`) },
  ];
}

function cursor(): PixBuf {
  return grid(`
    .....k.....
    .....w.....
    .....c.....
    ...........
    ...........
    kwc..k..cwk
    ...........
    ...........
    .....c.....
    .....w.....
    .....k.....`, L);
}

export function buildSprites(): SheetSpec[] {
  return [
    { key: 'proj', group: 'Projectiles', frameW: 12, frameH: 12, columns: 8, frames: projFrames() },
    { key: 'wpn', group: 'Weapons', frameW: 20, frameH: 10, columns: 4, frames: wpnFrames() },
    {
      key: 'props', group: 'Props', frameW: 16, frameH: 24, columns: 4,
      frames: [
        { name: 'barrel', buf: barrel(false) },
        { name: 'barrel_lit', buf: barrel(true) },
        { name: 'lever_up', buf: lever(false) },
        { name: 'lever_down', buf: lever(true) },
      ],
    },
    { key: 'pillar', group: 'Props', frameW: 16, frameH: 40, frames: [{ name: 'pillar', buf: pillar() }] },
    { key: 'block', group: 'Props', frameW: 32, frameH: 32, columns: 2, frames: [{ name: 'scrap_block', buf: scrapBlock() }, { name: 'trolley', buf: trolley() }] },
    {
      key: 'stack', group: 'Props', frameW: 48, frameH: 48, columns: 3,
      frames: [{ name: 'car_stack', buf: carStack(false) }, { name: 'car_stack_dent', buf: carStack(true) }, { name: 'car_rubble', buf: carRubble() }],
    },
    { key: 'hud', group: 'HUD', frameW: 10, frameH: 10, columns: 6, frames: hudFrames() },
    { key: 'cursor', group: 'HUD', frameW: 11, frameH: 11, frames: [{ name: 'cursor', buf: cursor() }] },
  ];
}
