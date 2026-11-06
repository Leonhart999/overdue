/** End of run: a settlement receipt (per-fight records), a verdict stamp, back to the hub. */
import Phaser from 'phaser';
import { P } from '../engine/gfx';
import { PhaserGfx } from '../engine/gfxPhaser';
import { BOSS_TEXT, CYBER_TEXT, MOD_TEXT, UI, WEAPON_TEXT } from '../data/text';
import { SLOTS } from '../game/loadout';
import type { RunState } from '../game/run';
import { session } from './session';
import { fmt, goto, H, Menu, W } from '../ui/ui';
import { textWidth } from '../ui/crispText';
import { barcode, brackets, dots, heading, keycap, keyWidth, panel, perforation, stamp, tagText, txt } from '../ui/kit';

const RECEIPT_TITLE = '结算单';
const BACK = '回到据点';

const RX = 176, RW = 320, RY = 12, RH = 336;
/** Table columns: x offset inside the receipt and alignment. */
const COLS: { x: number; align: 'left' | 'right' }[] = [
  { x: 16, align: 'left' }, { x: 120, align: 'right' }, { x: 154, align: 'right' },
  { x: 210, align: 'right' }, { x: 246, align: 'right' }, { x: 304, align: 'right' },
];
const BTN = { x: 512, y: 312, w: 112, h: 24 };

export class ResultScene extends Phaser.Scene {
  private won = false;
  private gfx!: PhaserGfx;
  private menu!: Menu;
  private run: RunState | null = null;
  private t = 0;

  constructor() { super('Result'); }
  init(d: { won: boolean }): void { this.won = d.won; this.t = 0; }

  create(): void {
    this.run = session.run;
    const cam = this.cameras.main;
    cam.fadeIn(300, 5, 4, 10);
    this.gfx = new PhaserGfx(this, cam, cam);
    this.menu = new Menu(this, () => {});
    this.menu.set([{ x: BTN.x, y: BTN.y, w: BTN.w, h: BTN.h, onSelect: () => { session.run = null; goto(this, 'Hub'); } }]);
  }

  update(_t: number, dt: number): void {
    this.t += dt / 1000;
    const g = this.gfx;
    g.begin();
    g.rect(0, 0, W, H, P.ink, 1, 'ui');
    // Echo's standee on the left: win or hurt expression
    const face = this.won ? 'echo_win' : 'echo_hurt';
    if (this.textures.exists('standee') && this.textures.get('standee').has(face)) {
      g.circle(84, 290, 76, this.won ? P.amber : P.red, 0.08, 'ui');
      g.img('standee', face, 84, H, { layer: 'ui', ox: 0.5, oy: 1 });
    }
    this.drawReceipt();
    // verdict stamp: lands 0.35 s after the screen opens
    const st = Math.min(1, Math.max(0, (this.t - 0.35) / 0.12));
    if (st > 0) {
      stamp(g, this.won ? UI.victory : UI.defeat, RX + RW - 96, 292, {
        color: this.won ? P.orange : P.red, angle: -9, glyph: 3, scale: st < 1 ? 2 : 1, alpha: st < 1 ? 0.5 : 0.92, seed: this.won ? 5 : 9,
      });
    }
    // button
    const f = this.menu.focus === 0;
    panel(g, BTN.x, BTN.y, BTN.w, BTN.h, { edge: f ? P.cyan : P.ink, fill: P.navy, cut: 3, scan: false, alpha: 1 });
    const kw = keyWidth('Enter');
    const bw = kw + 6 + textWidth(BACK);
    const bx = Math.round(BTN.x + BTN.w / 2 - bw / 2);
    keycap(g, 'Enter', bx, BTN.y + 7);
    txt(g, BACK, bx + kw + 6, BTN.y + 6, { color: P.white });
    if (f) brackets(g, BTN.x, BTN.y, BTN.w, BTN.h, P.cyan, { len: 4 });
    g.end();
  }

  private drawReceipt(): void {
    const g = this.gfx, run = this.run;
    const x = RX, y = RY, w = RW, h = RH;
    // paper with a soft drop shadow and perforated ends
    g.rect(x + 4, y + 4, w, h, P.night, 1, 'ui');
    g.rect(x, y, w, h, P.pale, 1, 'ui');
    g.rect(x, y + 3, 1, h - 6, P.white, 1, 'ui');
    perforation(g, x, y, w, P.ink, 'top');
    perforation(g, x, y + h - 3, w, P.ink, 'bottom');
    const cx = x + w / 2;
    tagText(g, 'HALCYON CREDIT · SETTLEMENT', cx, y + 10, { align: 'center', color: P.slate });
    heading(g, RECEIPT_TITLE, cx, y + 20, { align: 'center', color: P.ink, shadow: undefined });
    const runNo = `RUN NO.${String(session.meta.runs).padStart(4, '0')}`;
    tagText(g, runNo, x + 16, y + 52, { color: P.steel });
    barcode(g, x + w - 16 - 64, y + 50, 64, 8, P.ink, session.meta.runs + 11, 'ui', 1);
    const rule = (ry: number) => { for (let i = x + 12; i < x + w - 12; i += 4) g.rect(i, ry, 2, 1, P.steel, 1, 'ui'); };
    rule(y + 64);
    if (!run) return;

    // loadout
    const l = run.loadout;
    const mods = l.mods.map((m) => MOD_TEXT[m].name).join(' ');
    txt(g, `${WEAPON_TEXT[l.weapon].name}${mods ? ' + ' + mods : ''}`, x + 16, y + 70, { color: P.rust });
    txt(g, SLOTS.map((s) => CYBER_TEXT[l.cyber[s]].name).filter((n) => n !== '空').join(' · '), x + 16, y + 86, { color: P.slate });
    rule(y + 104);

    // table
    const head = ['头目', UI.stats.time, UI.stats.hits, UI.stats.dodges, UI.stats.staggers, UI.stats.env];
    head.forEach((s, i) => txt(g, s, x + COLS[i].x, y + 110, { align: COLS[i].align, color: P.steel }));
    g.rect(x + 12, y + 125, w - 24, 1, P.ink, 1, 'ui');
    run.records.forEach((r, j) => {
      const ry = y + 130 + j * 18;
      const col = r.won ? P.ink : P.red;
      const row = [BOSS_TEXT[r.boss].name + (r.won ? '' : ' ×'), fmt(r.time), String(r.hitsTaken), String(r.perfectDodges), String(r.staggers), String(r.envDamage)];
      row.forEach((s, i) => txt(g, s, x + COLS[i].x, ry, { align: COLS[i].align, color: col }));
      dots(g, x + 16 + textWidth(row[0]) + 4, x + COLS[1].x - textWidth(row[1]) - 4, ry + 9, P.fog);
    });
    const ty = y + 130 + Math.max(4, run.records.length) * 18 + 4;
    g.rect(x + 12, ty, w - 24, 1, P.ink, 1, 'ui');
    g.rect(x + 12, ty + 2, w - 24, 1, P.ink, 1, 'ui');

    // total
    const total = run.records.reduce((s, r) => s + r.time, 0);
    txt(g, '总用时', x + 16, ty + 14, { color: P.ink });
    tagText(g, 'TOTAL', x + 16, ty + 28, { color: P.steel });
    const tt = fmt(total);
    heading(g, tt, x + w - 16, ty + 10, { align: 'right', color: P.ink, shadow: undefined });
    dots(g, x + 16 + textWidth('总用时') + 6, x + w - 16 - textWidth(tt, { scale: 2 }) - 6, ty + 23, P.steel);
    rule(ty + 40);
    const wins = run.records.filter((r) => r.won).length;
    tagText(g, `FIGHTS ${run.records.length} · CLEARED ${wins}`, x + 16, ty + 48, { color: P.steel });
    barcode(g, x + 16, y + h - 22, 120, 10, P.ink, total | 0, 'ui', 1);
  }
}
