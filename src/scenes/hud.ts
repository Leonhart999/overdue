/** Fight HUD, drawn every frame through Gfx on the 'ui' layer. */
import { COL, P, type Gfx } from '../engine/gfx';
import { clamp } from '../engine/math';
import { SLOT_TEXT, WEAPON_TEXT, CYBER_TEXT } from '../data/text';
import type { World } from '../game/world';

const SLOT_SHORT: Record<string, string> = {
  legs_stock: '冲刺', legs_leap: '跳跃', legs_blink: '瞬移', legs_slide: '滑铲',
  arm_shove: '推掌', arm_grapple: '抓钩', arm_fist: '重拳', arm_jack: '骇入',
  core_none: '—', core_plating: '装甲', core_capacitor: '电容', core_debt: '债务', core_overclock: '超频',
  head_none: '—', head_optics: '目镜', head_reflex: '神经', head_ballistic: '弹道',
};

export function drawHud(g: Gfx, w: World, camX: number, camY: number): void {
  const p = w.player;
  // ---- hearts
  const shown = Math.min(p.maxHp, 10);
  for (let i = 0; i < shown; i++) g.img('hud', i < p.hp ? 'heart' : 'heart_empty', 8 + i * 11, 6, { layer: 'ui', ox: 0, oy: 0 });
  if (p.maxHp > shown) g.text(`${p.hp}`, 8 + shown * 11 + 2, 3, { layer: 'ui', color: P.rose });
  for (let i = 0; i < p.shieldMax; i++) g.img('hud', i < p.shield ? 'shield' : 'heart_empty', 8 + (shown + i) * 11 + 3, 6, { layer: 'ui', ox: 0, oy: 0, alpha: i < p.shield ? 1 : 0.4 });

  // ---- weapon
  const wt = WEAPON_TEXT[p.loadout.weapon];
  const h = p.weapon.hud();
  g.text(wt.name, 8, 18, { layer: 'ui', color: P.pale });
  let x = 8 + wt.name.length * 12 + 6;
  if (p.loadout.weapon === 'breacher') {
    for (let i = 0; i < 2; i++) g.img('hud', i < (h.ammo ?? 0) ? 'shell' : 'shell_empty', x + i * 8, 20, { layer: 'ui', ox: 0, oy: 0 });
    x += 20;
  } else if (h.ammo !== undefined) {
    g.img('hud', 'nail', x, 20, { layer: 'ui', ox: 0, oy: 0 });
    g.text(`${h.ammo}`, x + 11, 18, { layer: 'ui', color: h.ammo === 0 ? P.red : P.white });
    x += 32;
  }
  if (h.charge !== undefined) {
    g.rect(x, 22, 50, 4, P.ink, 1, 'ui');
    g.rect(x, 22, 50 * h.charge, 4, h.charge >= 0.25 ? P.cyan : P.teal, 1, 'ui');
    g.rect(x + 12, 21, 1, 6, P.slate, 1, 'ui');
    x += 56;
  }
  if (h.special !== undefined && p.loadout.weapon !== 'riveter') {
    const ready = h.special >= 1;
    g.text('右键', x, 18, { layer: 'ui', color: ready ? P.amber : P.slate });
    if (!ready) { g.rect(x, 31, 24 * clamp(h.special, 0, 1), 2, P.amber, 0.8, 'ui'); }
    x += 30;
  }
  if (h.text) g.text(h.text, x, 18, { layer: 'ui', color: P.fog });

  // ---- cyberware slots (top right)
  const slots: { slot: 'legs' | 'arm' | 'core' | 'head'; frac: number; extra: string }[] = [
    { slot: 'legs', frac: p.legs.readyFrac(), extra: p.legs.hudText() },
    { slot: 'arm', frac: p.arm.readyFrac(), extra: p.arm.hudText() },
    { slot: 'core', frac: p.core.readyFrac(), extra: '' },
    { slot: 'head', frac: 1, extra: '' },
  ];
  slots.forEach((s, i) => {
    const bx = 640 - 8 - (4 - i) * 38, by = 4;
    const id = p.loadout.cyber[s.slot];
    const empty = id === 'core_none' || id === 'head_none';
    g.rect(bx, by, 34, 26, P.night, 0.9, 'ui');
    g.strokeRect(bx, by, 34, 26, 1, empty ? P.navy : s.frac >= 1 ? P.slate : P.indigo, 1, 'ui');
    if (s.frac < 1) g.rect(bx + 1, by + 1, 32, 24 * (1 - s.frac), P.ink, 0.75, 'ui');
    g.text(SLOT_SHORT[id] ?? CYBER_TEXT[id].name, bx + 17, by + 1, { layer: 'ui', align: 'center', color: empty ? P.slate : s.frac >= 1 ? P.pale : P.steel });
    g.text(s.extra || SLOT_TEXT[s.slot].key, bx + 17, by + 13, { layer: 'ui', align: 'center', color: s.slot === 'legs' || s.slot === 'arm' ? COL.player : P.slate, alpha: 0.85 });
    const lock = s.slot === 'legs' ? p.locked.legs : s.slot === 'arm' ? p.locked.arm : 0;
    if (lock > 0) {
      g.rect(bx, by, 34, 26, P.maroon, 0.7, 'ui');
      g.line(bx + 4, by + 4, bx + 30, by + 22, 2, P.red, 1, 'ui');
      g.line(bx + 30, by + 4, bx + 4, by + 22, 2, P.red, 1, 'ui');
      g.text(`封锁 ${Math.ceil(lock)}`, bx + 17, by + 27, { layer: 'ui', align: 'center', color: P.red });
    }
  });

  // ---- boss bar
  const b = w.boss;
  if (b && w.state !== 'intro') {
    const bx = 190, bw = 260, by = 20;
    g.text(b.name, bx, 4, { layer: 'ui', color: P.white });
    if (b.status) g.text(b.status, bx + bw, 4, { layer: 'ui', align: 'right', color: P.amber });
    g.rect(bx - 1, by - 1, bw + 2, 8, P.ink, 1, 'ui');
    const f = clamp(b.hp / b.maxHp, 0, 1);
    g.rect(bx, by, bw, 6, P.maroon, 1, 'ui');
    g.rect(bx, by, Math.round(bw * f), 6, b.staggered ? P.rose : P.red, 1, 'ui');
    g.rect(bx, by, Math.round(bw * f), 1, P.rose, 0.8, 'ui');
    for (const t of b.thresholds) g.rect(bx + Math.round(bw * t), by - 1, 1, 8, P.white, 0.8, 'ui');
    // poise
    const pf = b.staggered ? b.staggerT / b.staggerDur : clamp(b.poise / b.poiseMax, 0, 1);
    g.rect(bx, by + 9, bw, 3, P.ink, 1, 'ui');
    g.rect(bx, by + 9, Math.round(bw * pf), 3, b.staggered ? P.white : P.amber, b.staggered ? 0.6 + 0.4 * Math.sin(w.realTime * 20) : 1, 'ui');
    if (b.staggered) g.text('瘫痪', bx + bw / 2, by + 12, { layer: 'ui', align: 'center', color: P.amber });
  }

  // ---- prompt
  if (w.prompt) g.text(w.prompt, p.x - camX, p.y - camY - 40, { layer: 'ui', align: 'center', color: COL.interact });

  // ---- crosshair
  const inp = w.input;
  if (inp) g.img('cursor', 'cursor', inp.ax - camX, inp.ay - camY, { layer: 'ui', ox: 0.5, oy: 0.5 });
}
