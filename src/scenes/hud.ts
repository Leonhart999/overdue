/**
 * Fight/hub HUD, drawn every frame through Gfx on the 'ui' layer (screen space).
 *
 * Three plates along the top 37 px: player (HP cells, shield cells, weapon line), boss (name,
 * status, HP bar with phase ticks and chip-away, poise strip) and cyberware (4 sockets with
 * key-cap badges hanging under them). Plus the interact prompt tag, off-screen edge markers on
 * scrolling maps, and the crosshair.
 */
import { COL, P, type Gfx } from '../engine/gfx';
import { clamp } from '../engine/math';
import { WEAPON_TEXT, CYBER_TEXT } from '../data/text';
import type { Boss } from '../game/boss';
import type { Shape } from '../game/types';
import { SCREEN_H, SCREEN_W, type World } from '../game/world';
import { textWidth } from '../ui/crispText';
import { bar, chip, keycap, keyWidth, mouseIcon, panel, pxRect, socket, txt } from '../ui/kit';

const SLOT_SHORT: Record<string, string> = {
  legs_stock: '冲刺', legs_leap: '跳跃', legs_blink: '瞬移', legs_slide: '滑铲',
  arm_shove: '推掌', arm_grapple: '抓钩', arm_fist: '重拳', arm_jack: '骇入',
  core_none: '—', core_plating: '装甲', core_capacitor: '电容', core_debt: '债务', core_overclock: '超频',
  head_none: '—', head_optics: '目镜', head_reflex: '神经', head_ballistic: '弹道',
};

/** Badge key per active slot (micro font glyphs). */
const SLOT_KEY: Record<string, string> = { legs: '␣', arm: 'Q' };

const PLATE_Y = 3, PLATE_H = 36, PLATE_A = 0.9;
const LEFT = { x: 4, w: 176 };
const MID = { x: 184, w: 272 };
const RIGHT = { x: 460, w: 176 };
const BAR = { x: 190, y: 22, w: 260, h: 7 };

/** HP chip-away: the white trail holds for 0.4 s after a hit, then catches up. */
const chipState = new WeakMap<Boss, { last: number; chip: number; hitAt: number; t: number }>();

function chipFrac(b: Boss, f: number, now: number): number {
  let s = chipState.get(b);
  if (!s) { s = { last: f, chip: f, hitAt: -1, t: now }; chipState.set(b, s); }
  const dt = clamp(now - s.t, 0, 0.1);
  s.t = now;
  if (f < s.last) s.hitAt = now;
  if (f > s.chip) s.chip = f;
  s.last = f;
  if (now - s.hitAt > 0.4) s.chip = Math.max(f, s.chip - dt * 0.8);
  return s.chip;
}

/**
 * `hasIcon` tells whether the 'ico' sheet has a frame (scenes pass a texture-manager check);
 * without it the slots fall back to short text names.
 */
export function drawHud(g: Gfx, w: World, camX: number, camY: number, hasIcon: (frame: string) => boolean = () => false): void {
  drawPlayerPlate(g, w);
  drawSlots(g, w, hasIcon);
  const b = w.boss;
  if (b && w.state !== 'intro') drawBossPlate(g, w, b);

  // ---- off-screen warnings (scrolling maps)
  if (w.scrolls) drawOffscreen(g, w, camX, camY);

  // ---- prompt
  if (w.prompt) drawPrompt(g, w.prompt, w.player.x - camX, w.player.y - camY - 40);

  // ---- crosshair
  const inp = w.input;
  if (inp) g.img('cursor', 'cursor', inp.ax - camX, inp.ay - camY, { layer: 'ui', ox: 0.5, oy: 0.5 });
}

// ------------------------------------------------------------------ player plate

function drawPlayerPlate(g: Gfx, w: World): void {
  const p = w.player;
  panel(g, LEFT.x, PLATE_Y, LEFT.w, PLATE_H, { accent: P.cyan, alpha: PLATE_A });
  // row 1: HP cells (max 10 drawn), shield cells, number when there are more than 10
  const x0 = LEFT.x + 7, y0 = PLATE_Y + 4;
  const shown = Math.min(p.maxHp, 10);
  g.crisp('HP', x0, y0 + 3, { font: 'micro', color: P.rose });
  const hx = x0 + 11;
  for (let i = 0; i < shown; i++) g.img('uik_c', i < p.hp ? 'hp_full' : 'hp_empty', hx + i * 8, y0, { layer: 'ui', ox: 0, oy: 0 });
  let x = hx + shown * 8;
  if (p.maxHp > shown) {
    g.crisp(`${p.hp}`, x + 2, y0, { color: P.rose });
    x += 4 + textWidth(`${p.hp}`);
  }
  if (p.shieldMax > 0) {
    x += 4;
    for (let i = 0; i < p.shieldMax; i++) g.img('uik_c', i < p.shield ? 'sh_full' : 'sh_empty', x + i * 8, y0, { layer: 'ui', ox: 0, oy: 0 });
  }

  // row 2: weapon sprite, name, ammo / shells, charge, special readiness, status
  const wt = WEAPON_TEXT[p.loadout.weapon];
  const h = p.weapon.hud();
  const ry = PLATE_Y + 19;
  g.rect(x0, ry - 1, LEFT.w - 14, 1, P.navy, 1, 'ui');
  g.img('wpn', p.loadout.weapon, x0 - 1, ry + 2, { layer: 'ui', ox: 0, oy: 0 });
  x = x0 + 21;
  txt(g, wt.name, x, ry + 1);
  x += textWidth(wt.name) + 6;
  if (p.loadout.weapon === 'breacher') {
    for (let i = 0; i < 2; i++) g.img('hud', i < (h.ammo ?? 0) ? 'shell' : 'shell_empty', x + i * 8 - 2, ry + 2, { layer: 'ui', ox: 0, oy: 0 });
    x += 18;
  } else if (h.ammo !== undefined) {
    const n = `${h.ammo}`, max = h.ammoMax !== undefined ? `/${h.ammoMax}` : '';
    const nx = x + Math.max(0, 12 - textWidth(n));
    txt(g, n, nx, ry + 1, { color: h.ammo === 0 ? P.red : P.white });
    if (max) txt(g, max, nx + textWidth(n), ry + 1, { color: P.slate });
    x = nx + textWidth(n) + textWidth(max) + 6;
  }
  if (h.charge !== undefined) {
    const ready = h.charge >= 0.25;
    bar(g, x, ry + 6, 40, 3, h.charge, { fill: ready ? P.cyan : P.teal, hi: P.ice, track: P.abyss, ticks: [0.25], tickColor: P.slate });
    x += 46;
  }
  if (h.special !== undefined && p.loadout.weapon !== 'riveter') {
    const ready = h.special >= 1;
    mouseIcon(g, ready ? 'r' : 'n', x, ry, { amber: true, alpha: ready ? 1 : 0.6 });
    if (!ready) g.rect(x, ry + 15, Math.round(9 * clamp(h.special, 0, 1)), 1, P.amber, 1, 'ui');
    x += 14;
  }
  if (h.text) txt(g, h.text, x, ry + 1, { color: P.fog });
}

// ------------------------------------------------------------------ cyberware sockets

function drawSlots(g: Gfx, w: World, hasIcon: (frame: string) => boolean): void {
  const p = w.player;
  panel(g, RIGHT.x, PLATE_Y, RIGHT.w, PLATE_H, { alpha: PLATE_A });
  const slots: { slot: 'legs' | 'arm' | 'core' | 'head'; frac: number; extra: string }[] = [
    { slot: 'legs', frac: p.legs.readyFrac(), extra: p.legs.hudText() },
    { slot: 'arm', frac: p.arm.readyFrac(), extra: p.arm.hudText() },
    { slot: 'core', frac: p.core.readyFrac(), extra: '' },
    { slot: 'head', frac: 1, extra: '' },
  ];
  slots.forEach((s, i) => {
    const cx = RIGHT.x + 28 + i * 40;
    const sx = cx - 13, sy = PLATE_Y + 3;
    const id = p.loadout.cyber[s.slot];
    const empty = id === 'core_none' || id === 'head_none';
    const active = s.slot === 'legs' || s.slot === 'arm';
    const ready = s.frac >= 1;
    socket(g, sx, sy, 26, 26, { edge: empty ? undefined : ready && active ? P.slate : undefined });
    if (hasIcon(id)) g.img('ico', id, sx + 1, sy + 1, { layer: 'ui', ox: 0, oy: 0, alpha: empty ? 0.4 : 1 });
    else txt(g, SLOT_SHORT[id] ?? CYBER_TEXT[id].name, cx, sy + 7, { align: 'center', color: empty ? P.slate : ready ? P.pale : P.steel });
    // cooldown: the unready part is shaded from the top, with a lit edge
    if (!ready) {
      const ch = Math.round(24 * (1 - s.frac));
      pxRect(g, sx + 1, sy + 1, 24, ch, P.ink, 0.72);
      pxRect(g, sx + 1, sy + 1 + ch, 24, 1, active ? P.teal : P.grape, 1);
    }
    const lock = s.slot === 'legs' ? p.locked.legs : s.slot === 'arm' ? p.locked.arm : 0;
    if (lock > 0) {
      pxRect(g, sx + 1, sy + 1, 24, 24, P.maroon, 0.6);
      g.img('uik_x', 'lock', sx + 1, sy + 1, { layer: 'ui', ox: 0, oy: 0 });
      chip(g, `LOCK ${Math.ceil(lock)}`, cx, sy + 23, { align: 'center', fill: P.red, color: P.white, image: true });
      return;
    }
    // badge hanging under the socket: key cap for active slots, AUTO tag for passive ones
    if (active) keycap(g, SLOT_KEY[s.slot], cx - Math.floor(keyWidth(SLOT_KEY[s.slot]) / 2), sy + 22, { image: true, alpha: ready ? 1 : 0.85 });
    else if (!empty) chip(g, 'AUTO', cx, sy + 23, { align: 'center', fill: P.night, color: P.slate, image: true });
    // charges (e.g. blink) in the top-right corner
    if (s.extra) chip(g, s.extra, sx + 25, sy - 1, { align: 'right', fill: P.ink, color: COL.player, image: true });
  });
}

// ------------------------------------------------------------------ boss plate

function drawBossPlate(g: Gfx, w: World, b: Boss): void {
  panel(g, MID.x, PLATE_Y, MID.w, PLATE_H, { accent: P.red, alpha: PLATE_A });
  txt(g, b.name, BAR.x + 2, PLATE_Y + 4, { color: P.white });
  if (b.status) txt(g, b.status, BAR.x + BAR.w, PLATE_Y + 4, { align: 'right', color: P.amber });
  const f = clamp(b.hp / b.maxHp, 0, 1);
  const chipF = chipFrac(b, f, w.realTime);
  bar(g, BAR.x, BAR.y, BAR.w, BAR.h, f, {
    fill: b.staggered ? P.rose : P.red, hi: P.rose, track: P.maroon, chip: chipF, ticks: b.thresholds, tickColor: P.white,
  });
  // poise / stagger strip
  const pf = b.staggered ? b.staggerT / b.staggerDur : clamp(b.poise / b.poiseMax, 0, 1);
  const pulse = b.staggered ? 0.6 + 0.4 * Math.sin(w.realTime * 20) : 1;
  bar(g, BAR.x, BAR.y + BAR.h + 3, BAR.w, 2, pf, { fill: b.staggered ? P.white : P.amber, track: P.night, alpha: pulse });
  if (b.staggered) {
    const tw = textWidth('瘫痪') + 12;
    const tx = Math.round(320 - tw / 2);
    panel(g, tx, PLATE_Y + PLATE_H - 1, tw, 16, { edge: P.amber, cut: 3, scan: false, bevel: false });
    txt(g, '瘫痪', 320, PLATE_Y + PLATE_H + 1, { align: 'center', color: P.amber });
  }
}

// ------------------------------------------------------------------ prompt

/** Interact prompt: an amber-edged tag with the key cap and the verb (prompt text 'E  verb'). */
function drawPrompt(g: Gfx, prompt: string, x: number, y: number): void {
  const m = /^([A-Z])\s+(.*)$/.exec(prompt);
  const key = m ? m[1] : null;
  const label = m ? m[2] : prompt;
  const kw = key ? keyWidth(key) + 4 : 0;
  const w = kw + textWidth(label) + 12;
  const left = Math.round(x - w / 2), top = Math.round(y - 2);
  panel(g, left, top, w, 17, { accent: P.amber, cut: 3, scan: false, alpha: 0.94 });
  let cx = left + 6;
  if (key) { keycap(g, key, cx, top + 3); cx += kw; }
  txt(g, label, cx, top + 3, { color: COL.interact });
  // pointer notch under the tag
  g.rect(Math.round(x) - 1, top + 17, 3, 1, P.ink, 0.94, 'ui');
  g.rect(Math.round(x), top + 18, 1, 1, P.ink, 0.94, 'ui');
}

// ------------------------------------------------------------------ off-screen markers

/** Point of a shape closest to (x, y). */
function nearestOnShape(s: Shape, x: number, y: number): [number, number] {
  switch (s.k) {
    case 'rect': return [clamp(x, s.x, s.x + s.w), clamp(y, s.y, s.y + s.h)];
    case 'line': {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - s.x1) * dx + (y - s.y1) * dy) / l2, 0, 1);
      return [s.x1 + dx * t, s.y1 + dy * t];
    }
    default: {
      const dx = x - s.x, dy = y - s.y, d = Math.hypot(dx, dy) || 1, r = Math.min(d, s.r);
      return [s.x + (dx / d) * r, s.y + (dy / d) * r];
    }
  }
}

/**
 * Scrolling maps: a marker on the screen edge for every enemy telegraph and boss part that is
 * off screen, so a warning is never invisible. Red triangle = telegraph, magenta chevron = boss.
 */
function drawOffscreen(g: Gfx, w: World, camX: number, camY: number): void {
  const cx = camX + SCREEN_W / 2, cy = camY + SCREEN_H / 2;
  const m = 10, top = 40;
  const mark = (x: number, y: number, color: number, size: number, alpha: number) => {
    const sx = x - camX, sy = y - camY;
    if (sx >= 0 && sx <= SCREEN_W && sy >= 0 && sy <= SCREEN_H) return;
    const ex = clamp(sx, m, SCREEN_W - m), ey = clamp(sy, top, SCREEN_H - m);
    const a = Math.atan2(sy - ey, sx - ex);
    const ca = Math.cos(a), sa = Math.sin(a);
    const tip = [ex + ca * size, ey + sa * size];
    const l = [ex - ca * size * 0.6 - sa * size * 0.8, ey - sa * size * 0.6 + ca * size * 0.8];
    const r = [ex - ca * size * 0.6 + sa * size * 0.8, ey - sa * size * 0.6 - ca * size * 0.8];
    g.poly([tip[0], tip[1], l[0], l[1], r[0], r[1]], color, alpha, 'ui');
  };
  const pulse = 0.65 + 0.35 * Math.sin(w.realTime * 14);
  for (const h of w.hazards) {
    if (h.dead || !h.visible || h.team === 'player' || (!h.hitsPlayer && !h.marker)) continue;
    const [x, y] = nearestOnShape(h.shape, cx, cy);
    mark(x, y, h.warning ? P.red : P.rose, 7, h.warning ? pulse : 0.9);
  }
  const b = w.boss;
  if (b && !b.dying) {
    const seen = new Set<string>();
    for (const pt of b.parts) {
      if (pt.dead || !pt.targetable) continue;
      const k = `${Math.round(pt.x / 40)}:${Math.round(pt.y / 40)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      mark(pt.hx, pt.hy, P.magenta, 5, 0.85);
    }
  }
}
