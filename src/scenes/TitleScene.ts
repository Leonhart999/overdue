/** Title screen: the animated cover art with the menu on top. */
import Phaser from 'phaser';
import { audio } from '../engine/audio';
import { P } from '../engine/gfx';
import { UI } from '../data/text';
import { saveMeta } from '../game/run';
import { session } from './session';
import { buildCover, type Cover } from './cover';
import { goto, H, Menu, panel, text, W } from '../ui/ui';

export class TitleScene extends Phaser.Scene {
  private cover!: Cover;

  constructor() { super('Title'); }

  create(): void {
    this.cameras.main.fadeIn(300, 5, 4, 10);
    this.cover = buildCover(this, { animated: true });

    // menu panel on the street, right of Echo
    const PX = 438, PY = 268, PW = 150, PH = 64;
    const g = this.add.graphics();
    panel(g, PX, PY, PW, PH, P.slate, P.ink, 0.8);
    g.fillStyle(P.cyan, 1).fillRect(PX + 6, PY, 30, 1);

    const m = session.meta;
    const t0 = text(this, PX + PW / 2, PY + 8, '', { align: 'center', scale: 2 });
    const t1 = text(this, PX + PW / 2, PY + 40, '', { align: 'center' });
    const refresh = () => {
      t0.setText(menu.focus === 0 ? `> ${UI.start} <` : UI.start).setColor(menu.focus === 0 ? '#2de2f5' : '#9097c0');
      t1.setText(`${UI.mute}：${m.muted ? UI.off : UI.on}`).setColor(menu.focus === 1 ? '#2de2f5' : '#9097c0');
    };
    const menu = new Menu(this, refresh);
    menu.set([
      { x: PX, y: PY + 4, w: PW, h: 32, onSelect: () => { audio.unlock(); goto(this, 'Hub'); } },
      { x: PX, y: PY + 38, w: PW, h: 18, onSelect: () => { m.muted = !m.muted; audio.setMuted(m.muted); saveMeta(m); refresh(); } },
    ]);
    if (m.runs > 0) text(this, PX + PW / 2, PY + PH + 3, `出击 ${m.runs} 次 · 通关 ${m.wins} 次`, { align: 'center', color: P.fog, stroke: true });

    // controls on a dark band along the bottom edge
    const band = this.add.graphics();
    for (let i = 0; i < 4; i++) band.fillStyle(P.ink, 0.25 + i * 0.18).fillRect(0, H - 22 + i * 3, W, i === 3 ? 13 : 3);
    text(this, W / 2, H - 15, UI.controls, { align: 'center', color: P.steel });
  }

  update(_t: number, dt: number): void {
    this.cover.update(dt);
  }
}
