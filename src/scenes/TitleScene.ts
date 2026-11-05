/** Title screen. */
import Phaser from 'phaser';
import { audio } from '../engine/audio';
import { P } from '../engine/gfx';
import { UI } from '../data/text';
import { saveMeta } from '../game/run';
import { session } from './session';
import { goto, H, Menu, text, W } from '../ui/ui';

export class TitleScene extends Phaser.Scene {
  private t = 0;
  private lines!: Phaser.GameObjects.Graphics;

  constructor() { super('Title'); }

  create(): void {
    this.t = 0;
    this.cameras.main.fadeIn(300, 5, 4, 10);
    this.add.image(0, 0, 'bg_scrapyard').setOrigin(0, 0).setAlpha(0.28);
    this.add.rectangle(0, 0, W, H, P.ink, 0.45).setOrigin(0, 0);
    this.lines = this.add.graphics();
    this.add.image(470, 250, 'bt_gearjaw', 'idle1').setScale(2).setFlipX(true).setAlpha(0.9).setTint(0x8080a0);
    this.add.image(150, 258, 'ow_echo', 'right_idle').setScale(4);

    text(this, W / 2, 46, 'OVERDUE', { scale: 4, align: 'center', color: P.white, stroke: true });
    text(this, W / 2, 100, UI.title, { scale: 2, align: 'center', color: P.red, stroke: true });

    const m = session.meta;
    const items = [UI.start, '', ''];
    const t0 = text(this, W / 2, 160, '', { align: 'center', scale: 2 });
    const t1 = text(this, W / 2, 196, '', { align: 'center' });
    const refresh = () => {
      t0.setText(menu.focus === 0 ? `> ${items[0]} <` : items[0]).setColor(menu.focus === 0 ? '#2de2f5' : '#9097c0');
      t1.setText(`${UI.mute}：${m.muted ? UI.off : UI.on}`).setColor(menu.focus === 1 ? '#2de2f5' : '#9097c0');
    };
    const menu = new Menu(this, refresh);
    menu.set([
      { x: W / 2 - 60, y: 156, w: 120, h: 30, onSelect: () => { audio.unlock(); goto(this, 'Select'); } },
      { x: W / 2 - 60, y: 192, w: 120, h: 18, onSelect: () => { m.muted = !m.muted; audio.setMuted(m.muted); saveMeta(m); refresh(); } },
    ]);
    if (m.runs > 0) text(this, W / 2, 226, `出击 ${m.runs} 次 · 通关 ${m.wins} 次`, { align: 'center', color: P.slate });
    text(this, W / 2, 336, UI.controls, { align: 'center', color: P.slate });
  }

  update(_t: number, dt: number): void {
    this.t += dt / 1000;
    const g = this.lines;
    g.clear();
    for (let i = 0; i < 6; i++) {
      const y = ((this.t * 40 + i * 60) % 360);
      g.fillStyle(P.red, 0.08).fillRect(0, y, W, 1);
    }
  }
}
