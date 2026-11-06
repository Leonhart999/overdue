/** Title screen: the animated cover art with a slim menu panel and the controls as key caps. */
import Phaser from 'phaser';
import { audio } from '../engine/audio';
import { P } from '../engine/gfx';
import { PhaserGfx } from '../engine/gfxPhaser';
import { UI } from '../data/text';
import { saveMeta } from '../game/run';
import { session } from './session';
import { buildCover, type Cover } from './cover';
import { goto, H, Menu, W } from '../ui/ui';
import { brackets, focusRow, heading, hints, panel, parseControls, tagText, txt, type Hint } from '../ui/kit';

// menu panel on the street, right of Echo
const PX = 440, PY = 256, PW = 152, PH = 78;
const START = { y: PY + 6, h: 32 };
const MUTE = { y: PY + 42, h: 16 };

export class TitleScene extends Phaser.Scene {
  private cover!: Cover;
  private gfx!: PhaserGfx;
  private menu!: Menu;
  private controls: Hint[] = parseControls(UI.controls);

  constructor() { super('Title'); }

  create(): void {
    const cam = this.cameras.main;
    cam.fadeIn(300, 5, 4, 10);
    this.cover = buildCover(this, { animated: true });
    this.gfx = new PhaserGfx(this, cam, cam);
    const m = session.meta;
    this.menu = new Menu(this, () => {});
    this.menu.set([
      { x: PX, y: START.y, w: PW, h: START.h, onSelect: () => { audio.unlock(); goto(this, 'Hub'); } },
      { x: PX, y: MUTE.y, w: PW, h: MUTE.h, onSelect: () => { m.muted = !m.muted; audio.setMuted(m.muted); saveMeta(m); }, stay: true },
    ]);
  }

  update(_t: number, dt: number): void {
    this.cover.update(dt);
    const g = this.gfx, m = session.meta, f = this.menu.focus;
    g.begin();
    panel(g, PX, PY, PW, PH, { accent: P.cyan, alpha: 0.88 });
    // start
    if (f === 0) focusRow(g, PX + 4, START.y, PW - 8, START.h, P.cyan);
    heading(g, UI.start, PX + PW / 2, START.y + 4, { align: 'center', color: f === 0 ? P.white : P.fog });
    if (f === 0) brackets(g, PX + 4, START.y, PW - 8, START.h, P.cyan, { len: 4, out: 1 });
    // sound toggle
    if (f === 1) focusRow(g, PX + 4, MUTE.y, PW - 8, MUTE.h, P.cyan);
    txt(g, UI.mute, PX + 20, MUTE.y + 2, { color: f === 1 ? P.white : P.fog });
    const on = !m.muted;
    const sx = PX + PW - 12 - 40;
    g.rect(sx - 1, MUTE.y, 42, 16, P.ink, 1, 'ui');
    g.rect(on ? sx + 20 : sx, MUTE.y + 1, 20, 14, on ? P.cyan : P.slate, 1, 'ui');
    txt(g, UI.off, sx + 10, MUTE.y + 2, { align: 'center', color: on ? P.slate : P.white });
    txt(g, UI.on, sx + 30, MUTE.y + 2, { align: 'center', color: on ? P.ink : P.slate });
    // footer: run counters and the menu keys
    g.rect(PX + 8, PY + PH - 15, PW - 16, 1, P.navy, 1, 'ui');
    if (m.runs > 0) tagText(g, `RUNS ${m.runs} · CLEARED ${m.wins}`, PX + 10, PY + PH - 10, { color: P.steel });
    else tagText(g, 'HALCYON CREDIT', PX + 10, PY + PH - 10, { color: P.slate });
    tagText(g, '↑↓ ENTER', PX + PW - 10, PY + PH - 10, { align: 'right', color: P.slate, spacing: 0 });

    // controls on a dark band along the bottom edge
    for (let i = 0; i < 4; i++) g.rect(0, H - 24 + i * 3, W, i === 3 ? 15 : 3, P.ink, 0.25 + i * 0.18, 'ui');
    hints(g, this.controls, W / 2, H - 16, { align: 'center', color: P.fog });
    g.end();
  }
}
