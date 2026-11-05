/** Weapon select: list on the left, full rules on the right. */
import Phaser from 'phaser';
import { P } from '../engine/gfx';
import { CYBER_TEXT, UI, WEAPON_TEXT } from '../data/text';
import { STOCK, WEAPONS } from '../game/loadout';
import { newRun, nextFightParams, saveMeta } from '../game/run';
import { session } from './session';
import { goto, H, Menu, panel, text, W } from '../ui/ui';

export class SelectScene extends Phaser.Scene {
  constructor() { super('Select'); }

  create(): void {
    this.cameras.main.fadeIn(200, 5, 4, 10);
    this.add.rectangle(0, 0, W, H, P.ink).setOrigin(0, 0);
    text(this, 24, 14, UI.chooseWeapon, { scale: 2, color: P.white });
    const g = this.add.graphics();
    const dyn: Phaser.GameObjects.GameObject[] = [];
    const icons: Phaser.GameObjects.Image[] = [];
    const names: Phaser.GameObjects.Text[] = [];

    WEAPONS.forEach((id, i) => {
      const y = 52 + i * 70;
      icons.push(this.add.image(58, y + 30, 'wpn', id).setScale(3));
      names.push(text(this, 104, y + 14, WEAPON_TEXT[id].name, { scale: 2 }));
      text(this, 104, y + 40, WEAPON_TEXT[id].tag, { color: P.slate });
    });

    const refresh = () => {
      g.clear();
      dyn.forEach((o) => o.destroy());
      dyn.length = 0;
      WEAPONS.forEach((_, i) => {
        const f = i === menu.focus;
        panel(g, 16, 50 + i * 70, 200, 64, f ? P.cyan : P.navy, f ? P.navy : P.night);
        names[i].setColor(f ? '#2de2f5' : '#ccd2ea');
      });
      const id = WEAPONS[menu.focus];
      const t = WEAPON_TEXT[id];
      panel(g, 232, 50, 392, 274, P.slate);
      dyn.push(text(this, 248, 60, t.name, { scale: 2, color: P.white }));
      dyn.push(text(this, 248, 88, t.tag, { color: P.amber }));
      dyn.push(text(this, 248, 112, UI.primary, { color: P.cyan }));
      dyn.push(text(this, 290, 112, t.primary, { wrap: 320 }));
      dyn.push(text(this, 248, 186, UI.special, { color: P.cyan }));
      dyn.push(text(this, 290, 186, t.special, { wrap: 320 }));
      dyn.push(text(this, 248, 272, `开局义体：${CYBER_TEXT[STOCK.legs].name}（空格） · ${CYBER_TEXT[STOCK.arm].name}（Q）`, { color: P.slate }));
      const best = session.meta.bestRun[id];
      if (best) dyn.push(text(this, 248, 290, `最快通关 ${fmt(best)}`, { color: P.slate }));
      dyn.push(text(this, 608, 304, 'Enter / 点击 出发', { align: 'right', color: P.fog }));
    };
    const menu = new Menu(this, refresh);
    menu.set(WEAPONS.map((id, i) => ({
      x: 16, y: 50 + i * 70, w: 200, h: 64,
      onSelect: () => {
        session.run = newRun(id);
        session.meta.runs++;
        saveMeta(session.meta);
        const p = nextFightParams(session.run)!;
        goto(this, 'Fight', { boss: p.boss, tier: p.tier, hpMul: p.hpMul, paceMul: p.paceMul });
      },
    })));
    this.input.keyboard!.on('keydown-ESC', () => goto(this, 'Title'));
    void icons;
  }
}

export function fmt(s: number): string {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
