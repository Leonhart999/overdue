/** Reward pick after a won fight (3 cards), then an optional loan contract. */
import Phaser from 'phaser';
import { P } from '../engine/gfx';
import { BOSS_TEXT, CYBER_TEXT, MOD_TEXT, SLOT_TEXT, UI, WEAPON_TEXT } from '../data/text';
import { CYBER_SLOT, SLOTS, effectiveMaxHp, type BossId } from '../game/loadout';
import { applyCard, nextFightParams, rollLoan, rollRewards, type Card } from '../game/run';
import { session } from './session';
import { goto, H, Menu, panel, text, W } from '../ui/ui';

function cardInfo(c: Card): { kind: string; name: string; desc: string; replaces?: string } {
  const l = session.run!.loadout;
  if (c.kind === 'cyber') {
    const slot = CYBER_SLOT[c.id];
    const cur = l.cyber[slot];
    const curName = CYBER_TEXT[cur].name;
    return {
      kind: `义体 · ${SLOT_TEXT[slot].name}`, name: CYBER_TEXT[c.id].name, desc: CYBER_TEXT[c.id].desc,
      replaces: cur.endsWith('_none') ? UI.newPart : `${UI.replaces}：${curName}`,
    };
  }
  if (c.kind === 'mod') return { kind: `改装 · ${WEAPON_TEXT[l.weapon].name}`, name: MOD_TEXT[c.id].name, desc: MOD_TEXT[c.id].desc };
  return { kind: '机体', name: '生命上限 +1', desc: '生命上限 +1，并回复 1 格。' };
}

export class RewardScene extends Phaser.Scene {
  private beaten!: BossId;
  constructor() { super('Reward'); }

  init(d: { beaten: BossId }): void { this.beaten = d.beaten; }

  create(): void {
    const run = session.run!;
    this.cameras.main.fadeIn(250, 5, 4, 10);
    this.add.rectangle(0, 0, W, H, P.ink).setOrigin(0, 0);
    const l = run.loadout;
    text(this, 24, 12, UI.chooseReward, { scale: 2, color: P.white });
    text(this, 616, 14, `击败 ${BOSS_TEXT[this.beaten].name} · 生命 ${l.hp}/${effectiveMaxHp(l)}（已修复）`, { align: 'right', color: P.fog });
    // current loadout strip
    const mods = l.mods.map((m) => MOD_TEXT[m].name).join(' ');
    text(this, 24, 42, `${WEAPON_TEXT[l.weapon].name}${mods ? ' + ' + mods : ''}`, { color: P.amber });
    text(this, 616, 42, SLOTS.map((s) => `${SLOT_TEXT[s].name}:${CYBER_TEXT[l.cyber[s]].name}`).join('  '), { align: 'right', color: P.steel });

    const cards = rollRewards(run, this.beaten);
    const loan = rollLoan(run, cards);
    const g = this.add.graphics();
    const objs: Phaser.GameObjects.Text[][] = [];
    const CW = 192, CY = 70, CH = 230;
    cards.forEach((c, i) => {
      const x = 16 + i * (CW + 16);
      const info = cardInfo(c);
      const o: Phaser.GameObjects.Text[] = [];
      o.push(text(this, x + 12, CY + 10, info.kind, { color: P.slate }));
      if (c.kind === 'cyber' && c.signature) o.push(text(this, x + CW - 12, CY + 10, `${BOSS_TEXT[this.beaten].name}掉落`, { align: 'right', color: P.red }));
      o.push(text(this, x + 12, CY + 28, info.name, { scale: 2, color: P.white }));
      o.push(text(this, x + 12, CY + 64, info.desc, { wrap: CW - 24 }));
      if (info.replaces) o.push(text(this, x + 12, CY + CH - 22, info.replaces, { color: P.fog }));
      objs.push(o);
    });

    let stage: 'pick' | 'loan' = 'pick';
    let loanObjs: Phaser.GameObjects.GameObject[] = [];
    const lg = this.add.graphics().setDepth(10);

    const refresh = () => {
      g.clear();
      cards.forEach((_, i) => {
        const f = stage === 'pick' && menu.focus === i;
        panel(g, 16 + i * (CW + 16), CY, CW, CH, f ? P.cyan : P.slate, f ? P.navy : P.night);
        objs[i][1]?.setColor(f ? '#f5f6ff' : '#ccd2ea');
      });
      if (stage === 'loan') {
        lg.clear();
        panel(lg, 110, 92, 420, 190, P.red, P.ink, 0.97);
        [0, 1].forEach((i) => {
          const f = menu.focus === i;
          panel(lg, 150 + i * 180, 240, 160, 28, f ? P.cyan : P.slate, f ? P.navy : P.night);
        });
        loanObjs.forEach((o, i) => { if (i >= loanObjs.length - 2) (o as Phaser.GameObjects.Text).setColor(menu.focus === i - (loanObjs.length - 2) ? '#2de2f5' : '#9097c0'); });
      }
    };

    const proceed = () => {
      const p = nextFightParams(run)!;
      goto(this, 'Fight', { boss: p.boss, tier: p.tier, hpMul: p.hpMul, paceMul: p.paceMul });
    };

    const openLoan = () => {
      if (!loan) { proceed(); return; }
      stage = 'loan';
      const info = cardInfo(loan.card);
      loanObjs = [
        text(this, 130, 102, UI.loan, { scale: 2, color: P.red }).setDepth(11),
        text(this, 510, 108, UI.loanHint, { align: 'right', color: P.fog }).setDepth(11),
        text(this, 130, 136, `获得：${info.name}（${info.kind}）`, { color: P.white }).setDepth(11),
        text(this, 130, 154, info.desc, { wrap: 380, color: P.pale }).setDepth(11),
        text(this, 130, 214, `代价：${loan.loan.text}`, { color: P.amber }).setDepth(11),
        text(this, 230, 246, '签', { align: 'center' }).setDepth(11),
        text(this, 410, 246, '不签', { align: 'center' }).setDepth(11),
      ];
      menu.set([
        { x: 150, y: 240, w: 160, h: 28, onSelect: () => { applyCard(run, loan.card); run.pendingLoans.push(loan.loan.id); if (loan.loan.id === 'loan_heal') run.loadout.hp = Math.max(1, run.loadout.hp - 2); menu.lock(true); proceed(); } },
        { x: 330, y: 240, w: 160, h: 28, onSelect: () => { menu.lock(true); proceed(); } },
      ], 1);
    };

    const menu = new Menu(this, refresh);
    menu.set(cards.map((c, i) => ({
      x: 16 + i * (CW + 16), y: CY, w: CW, h: CH,
      onSelect: () => { applyCard(run, c); openLoan(); },
    })));
    text(this, W / 2, 316, '方向键 / 鼠标选择，Enter / 点击确认', { align: 'center', color: P.slate });
  }
}
