/** Static key art for export: open `/?cover&shot` and screenshot the page (16:9 window). */
import Phaser from 'phaser';
import { buildCover } from './cover';

export class CoverScene extends Phaser.Scene {
  constructor() { super('Cover'); }

  create(): void {
    buildCover(this, { animated: false });
    // headless windows can report their final size late: re-fit once the page has settled
    this.time.delayedCall(200, () => this.scale.refresh());
  }
}
