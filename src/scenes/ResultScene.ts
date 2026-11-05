/** End of run: victory or defeat, per-fight records. */
import Phaser from 'phaser';
import { P } from '../engine/gfx';
import { BOSS_TEXT, CYBER_TEXT, MOD_TEXT, UI, WEAPON_TEXT } from '../data/text';
import { SLOTS } from '../game/loadout';
import { session } from './session';
import { fmt, goto, H, Menu, text, W } from '../ui/ui';

export class ResultScene extends Phaser.Scene {
  private won = false;
  constructor() { super('Result'); }
  init(d: { won: boolean }): void { this.won = d.won; }

  create(): void {
    const run = session.run;
    this.cameras.main.fadeIn(300, 5, 4, 10);
    this.add.rectangle(0, 0, W, H, P.ink).setOrigin(0, 0);
    text(this, W / 2, 30, this.won ? UI.victory : UI.defeat, { scale: 3, align: 'center', color: this.won ? P.amber : P.red, stroke: true });
    if (run) {
      const l = run.loadout;
      const mods = l.mods.map((m) => MOD_TEXT[m].name).join(' ');
      text(this, W / 2, 84, `${WEAPON_TEXT[l.weapon].name}${mods ? ' + ' + mods : ''}`, { align: 'center', color: P.amber });
      text(this, W / 2, 102, SLOTS.map((s) => CYBER_TEXT[l.cyber[s]].name).filter((n) => n !== '空').join(' · '), { align: 'center', color: P.steel });
      const cols = [80, 220, 300, 370, 460, 550];
      const head = ['头目', UI.stats.time, UI.stats.hits, UI.stats.dodges, UI.stats.staggers, UI.stats.env];
      head.forEach((h, i) => text(this, cols[i], 136, h, { color: P.slate }));
      run.records.forEach((r, j) => {
        const y = 156 + j * 20;
        const row = [BOSS_TEXT[r.boss].name + (r.won ? '' : ' ×'), fmt(r.time), String(r.hitsTaken), String(r.perfectDodges), String(r.staggers), String(r.envDamage)];
        row.forEach((s, i) => text(this, cols[i], y, s, { color: r.won ? P.pale : P.red }));
      });
      const total = run.records.reduce((s, r) => s + r.time, 0);
      text(this, W / 2, 156 + run.records.length * 20 + 16, `总用时 ${fmt(total)}`, { align: 'center', color: P.fog });
    }
    const t = text(this, W / 2, 300, '> 回到据点 <', { align: 'center', color: P.cyan });
    const menu = new Menu(this, () => {});
    menu.set([{ x: W / 2 - 80, y: 294, w: 160, h: 24, onSelect: () => { session.run = null; goto(this, 'Hub'); } }]);
    void t;
  }
}
