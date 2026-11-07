/** Non-combat hub NPC. The neural-upgrade service is a placeholder. */
import { DAFEYU_TEXT } from '../../data/text';
import { P, type Gfx } from '../../engine/gfx';
import { Body } from '../body';
import type { World } from '../world';

export class Dafeyu extends Body {
  constructor(x: number, y: number, private openNeural: () => void) {
    super();
    this.x = x; this.y = y;
    this.r = 10; this.hz = 20; this.hr = 10;
    this.mass = 0;
    this.solid = true;
    this.targetable = false;
    this.interactable = true;
    this.interactLabel = DAFEYU_TEXT.interact;
  }

  onInteract(w: World): void {
    w.sfx('uiConfirm');
    this.openNeural();
  }

  draw(g: Gfx, w: World): void {
    const lift = Math.round(Math.sin(w.realTime * 2) * 0.75);
    g.ellipse(this.x, this.y + 1, 15, 5, P.ink, 0.6, 'floor');
    g.ellipse(this.x, this.y, 13, 4, P.teal, 0.25, 'floor');
    g.line(this.x - 16, this.y, this.x - 11, this.y + 3, 1, P.cyan, 0.5, 'floor');
    g.line(this.x + 11, this.y + 3, this.x + 16, this.y, 1, P.cyan, 0.5, 'floor');
    g.img('npc_dafeyu', 'idle', this.x, this.y + 2 + lift, { depth: this.y });
    g.text(DAFEYU_TEXT.name, this.x, this.y + 9, { color: P.ice, align: 'center' });
  }
}
