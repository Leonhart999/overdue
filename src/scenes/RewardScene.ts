/** Reward pick after a won fight (3 contract cards), then an optional loan contract. */
import Phaser from 'phaser';
import { P } from '../engine/gfx';
import { PhaserGfx } from '../engine/gfxPhaser';
import { BOSS_TEXT, CYBER_TEXT, MOD_TEXT, SLOT_TEXT, UI, WEAPON_TEXT } from '../data/text';
import { CYBER_SLOT, SLOTS, effectiveMaxHp, type BossId } from '../game/loadout';
import { applyCard, nextFightParams, rollLoan, rollRewards, type Card, type RunState } from '../game/run';
import { session } from './session';
import { goto, H, Menu, W } from '../ui/ui';
import { textWidth } from '../ui/crispText';
import {
  band, barcode, brackets, dim, heading, hints, panel, para, SLOT_COL, socket, stamp, tagText, txt, WEAPON_COL, type Hint,
} from '../ui/kit';

const CW = 192, CH = 244, CY = 64, GAP = 16;
const cardX = (i: number) => 16 + i * (CW + GAP);

const PICK_HINTS: Hint[] = [
  { keys: ['←→'], label: '选择' },
  { keys: ['Enter'], label: '确认' },
  { keys: ['mouseL'], label: '点击' },
];
const LOAN_HINTS: Hint[] = [
  { keys: ['←→'], label: '选择' },
  { keys: ['Enter'], label: '确认' },
];
const LOAN = { x: 104, y: 64, w: 432, h: 232 };
const BTN = { y: LOAN.y + LOAN.h - 38, w: 128, h: 24 };
const btnX = (i: number) => LOAN.x + LOAN.w / 2 - BTN.w - 8 + i * (BTN.w + 16);

interface CardInfo { kind: string; name: string; desc: string; replaces?: string; color: number }

function cardInfo(c: Card): CardInfo {
  const l = session.run!.loadout;
  if (c.kind === 'cyber') {
    const slot = CYBER_SLOT[c.id];
    const cur = l.cyber[slot];
    const curName = CYBER_TEXT[cur].name;
    return {
      kind: `义体 · ${SLOT_TEXT[slot].name}`, name: CYBER_TEXT[c.id].name, desc: CYBER_TEXT[c.id].desc, color: SLOT_COL[slot],
      replaces: cur.endsWith('_none') ? UI.newPart : `${UI.replaces}：${curName}`,
    };
  }
  if (c.kind === 'mod') return { kind: `改装 · ${WEAPON_TEXT[l.weapon].name}`, name: MOD_TEXT[c.id].name, desc: MOD_TEXT[c.id].desc, color: WEAPON_COL[l.weapon] };
  return { kind: '机体', name: '生命上限 +1', desc: '生命上限 +1，并回复 1 格。', color: P.red };
}

/** Frame in the 'ico' sheet for a reward card. */
function cardIcon(c: Card): string {
  return c.kind === 'maxhp' ? 'maxhp' : c.id;
}

/** Stable 4-digit serial for a card (decoration only). */
function serial(s: string): string {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return `NO.${String(h).padStart(4, '0')}`;
}

export class RewardScene extends Phaser.Scene {
  private beaten!: BossId;
  private gfx!: PhaserGfx;
  private menu!: Menu;
  private stage: 'pick' | 'loan' = 'pick';
  private cards: Card[] = [];
  private loan: ReturnType<typeof rollLoan> = null;
  private run!: RunState;

  constructor() { super('Reward'); }

  init(d: { beaten: BossId }): void { this.beaten = d.beaten; this.stage = 'pick'; }

  private hasIcon(frame: string): boolean {
    return this.textures.exists('ico') && this.textures.get('ico').has(frame);
  }

  create(): void {
    const run = session.run!;
    this.run = run;
    const cam = this.cameras.main;
    cam.fadeIn(250, 5, 4, 10);
    this.gfx = new PhaserGfx(this, cam, cam);
    this.cards = rollRewards(run, this.beaten);
    this.loan = rollLoan(run, this.cards);

    const proceed = () => {
      const p = nextFightParams(run)!;
      goto(this, 'Fight', { boss: p.boss, tier: p.tier, hpMul: p.hpMul, paceMul: p.paceMul });
    };
    const openLoan = () => {
      const loan = this.loan;
      if (!loan) { proceed(); return; }
      this.stage = 'loan';
      this.menu.set([
        { x: btnX(0), y: BTN.y, w: BTN.w, h: BTN.h, onSelect: () => { applyCard(run, loan.card); if (loan.loan.id === 'loan_heal') run.loadout.hp = Math.max(1, run.loadout.hp - (run.lastRepair ?? 0)); else run.pendingLoans.push(loan.loan.id); proceed(); } },
        { x: btnX(1), y: BTN.y, w: BTN.w, h: BTN.h, onSelect: () => { proceed(); } },
      ], 1);
    };
    this.menu = new Menu(this, () => {});
    this.menu.set(this.cards.map((c, i) => ({
      x: cardX(i), y: CY, w: CW, h: CH,
      onSelect: () => { applyCard(run, c); openLoan(); },
    })));
  }

  update(): void {
    const g = this.gfx;
    g.begin();
    this.drawPick();
    if (this.stage === 'loan') this.drawLoan();
    g.end();
  }

  // ------------------------------------------------------------------ cards

  private drawPick(): void {
    const g = this.gfx, run = this.run, l = run.loadout;
    g.rect(0, 0, W, H, P.ink, 1, 'ui');
    // page header
    heading(g, UI.chooseReward, 20, 12);
    tagText(g, 'CONTRACT OFFER · 1 / 3', 20, 40, { color: P.amber });
    txt(g, `击败 ${BOSS_TEXT[this.beaten].name} · 生命 ${l.hp}/${effectiveMaxHp(l)}（已修复）`, 620, 12, { align: 'right', color: P.fog });
    const mods = l.mods.map((m) => MOD_TEXT[m].name).join(' ');
    const wline = `${WEAPON_TEXT[l.weapon].name}${mods ? ' + ' + mods : ''}`;
    const cline = SLOTS.map((s) => `${SLOT_TEXT[s].name} ${CYBER_TEXT[l.cyber[s]].name}`).join('  ');
    txt(g, cline, 620, 30, { align: 'right', color: P.steel });
    txt(g, wline, 620 - textWidth(cline) - 16, 30, { align: 'right', color: P.amber });
    g.rect(16, 52, 608, 1, P.navy, 1, 'ui');
    g.rect(16, 52, 48, 1, P.amber, 1, 'ui');

    this.cards.forEach((c, i) => this.drawCard(c, i, this.stage === 'pick' && this.menu.focus === i));
    if (this.stage === 'pick') hints(g, PICK_HINTS, W / 2, 330, { align: 'center' });
  }

  private drawCard(c: Card, i: number, f: boolean): void {
    const g = this.gfx;
    const info = cardInfo(c);
    const x = cardX(i), y = CY - (f ? 2 : 0);
    panel(g, x, y, CW, CH, { edge: f ? P.cyan : P.ink, alpha: 1, fill: f ? P.night : P.night });
    // kind band
    band(g, x, y, CW, 17, info.color);
    txt(g, info.kind, x + 10, y + 3, { color: info.color === P.red ? P.white : P.ink });
    tagText(g, serial(cardIcon(c)), x + CW - 10, y + 7, { align: 'right', color: info.color === P.red ? P.white : P.ink, spacing: 0 });
    // signature drop ribbon
    if (c.kind === 'cyber' && c.signature) {
      const label = `${BOSS_TEXT[this.beaten].name}掉落`;
      const rw = textWidth(label) + 14, rx = x + CW - rw;
      g.rect(rx, y + 18, rw - 1, 14, P.red, 1, 'ui');
      g.rect(rx, y + 32, rw - 1, 1, P.maroon, 1, 'ui');
      // notched tail on the left
      for (let k = 0; k < 7; k++) g.rect(rx - 1 - Math.min(k, 6 - k), y + 18 + k * 2, 1 + Math.min(k, 6 - k), 2, P.red, 1, 'ui');
      txt(g, label, rx + 7, y + 19, { color: P.white });
    }
    // name, rule text
    heading(g, info.name, x + 12, y + 36, { color: f ? P.white : P.pale });
    g.rect(x + 12, y + 66, CW - 24, 1, P.navy, 1, 'ui');
    para(g, info.desc, x + 12, y + 72, CW - 24, { color: f ? P.pale : P.fog, maxLines: 5 });
    // icon socket
    const icon = cardIcon(c);
    const sx = x + CW / 2 - 28, sy = y + 148;
    socket(g, sx, sy, 56, 56, { edge: f ? info.color : undefined });
    if (this.hasIcon(icon)) g.img('ico', icon, sx + 4, sy + 4, { layer: 'ui', ox: 0, oy: 0, scale: 2 });
    // footer: what it replaces
    g.rect(x + 12, y + CH - 28, CW - 24, 1, P.navy, 1, 'ui');
    if (info.replaces) txt(g, info.replaces, x + 12, y + CH - 21, { color: info.replaces === UI.newPart ? P.acid : P.fog });
    barcode(g, x + CW - 52, y + CH - 19, 40, 8, f ? P.cyan : P.slate, i * 13 + icon.length);
    if (f) brackets(g, x, y, CW, CH, P.cyan);
  }

  // ------------------------------------------------------------------ loan contract

  private drawLoan(): void {
    const g = this.gfx, loan = this.loan!;
    const L = 'over' as const;
    const info = cardInfo(loan.card);
    const { x, y, w, h } = LOAN;
    dim(g, 0.82, L);
    panel(g, x, y, w, h, { layer: L, edge: P.red, accent: P.red, alpha: 1 });
    // header
    heading(g, UI.loan, x + 14, y + 8, { layer: L, color: P.red });
    tagText(g, 'LOAN CONTRACT', x + w - 14, y + 10, { layer: L, color: P.red, align: 'right' });
    barcode(g, x + w - 14 - 60, y + 18, 60, 6, P.red, 77, L);
    txt(g, UI.loanHint, x + 14 + textWidth(UI.loan, { scale: 2 }) + 12, y + 14, { layer: L, color: P.fog });
    g.rect(x + 6, y + 37, w - 12, 1, P.maroon, 1, L);

    // clauses: label column + text column; icons in sockets on the right
    const lx = x + 16, vx = x + 64, vw = w - 64 - 96;
    tagText(g, 'GET', lx, y + 50, { layer: L, color: P.slate });
    txt(g, '获得', lx, y + 58, { layer: L, color: P.fog });
    txt(g, info.name, vx, y + 47, { layer: L, color: P.white });
    txt(g, `（${info.kind}）`, vx + textWidth(info.name), y + 47, { layer: L, color: P.steel });
    const n = para(g, info.desc, vx, y + 63, vw, { layer: L, color: P.pale, maxLines: 3 });
    const cy = y + 63 + n * 14 + 10;
    g.rect(lx, cy - 5, w - 32 - 80, 1, P.navy, 1, L);
    tagText(g, 'COST', lx, cy + 3, { layer: L, color: P.slate });
    txt(g, '代价', lx, cy + 11, { layer: L, color: P.fog });
    para(g, loan.loan.text, vx, cy, vw, { layer: L, color: P.amber, maxLines: 3 });

    const sx = x + w - 76;
    socket(g, sx, y + 46, 56, 56, { layer: L, edge: info.color });
    const icon = cardIcon(loan.card);
    if (this.hasIcon(icon)) g.img('ico', icon, sx + 4, y + 50, { layer: L, ox: 0, oy: 0, scale: 2 });
    socket(g, sx, y + 110, 56, 56, { layer: L, edge: P.red });
    if (this.hasIcon('loan')) g.img('ico', 'loan', sx + 4, y + 114, { layer: L, ox: 0, oy: 0, scale: 2 });

    // signature line + buttons
    const by = BTN.y;
    g.rect(x + 6, by - 10, w - 12, 1, P.maroon, 1, L);
    ['签', '不签'].forEach((label, i) => {
      const f = this.menu.focus === i;
      const bx = btnX(i);
      panel(g, bx, by, BTN.w, BTN.h, { layer: L, edge: f ? (i === 0 ? P.red : P.cyan) : P.ink, fill: f ? P.navy : P.night, cut: 3, scan: false, alpha: 1 });
      txt(g, label, bx + BTN.w / 2, by + 6, { layer: L, align: 'center', color: f ? P.white : P.fog });
      if (f) brackets(g, bx, by, BTN.w, BTN.h, i === 0 ? P.red : P.cyan, { layer: L, len: 4 });
    });
    // red stamp in the free space under the clauses
    stamp(g, '贷款', x + 280, y + 156, { layer: L, color: P.red, angle: -8, alpha: 0.85 });
    hints(g, LOAN_HINTS, W / 2, 330, { layer: L, align: 'center' });
  }
}
