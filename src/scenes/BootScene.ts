/** Boot: generate textures, wait for the pixel font, then go to the title (or a dev fight). */
import Phaser from 'phaser';
import { registerAllTextures } from '../art';
import { BOSS_DEFS } from '../game/bosses';
import { CYBER_SLOT, WEAPONS, type CyberId, type ModId, type WeaponId } from '../game/loadout';
import { newRun, nextFightParams } from '../game/run';
import { audio } from '../engine/audio';
import { session } from './session';

export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  create(): void {
    registerAllTextures(this);
    audio.setMuted(session.meta.muted);
    const go = () => {
      const d = session.dev;
      if (d.boss && BOSS_DEFS[d.boss as keyof typeof BOSS_DEFS]) {
        const weapon = (WEAPONS.includes(d.weapon as WeaponId) ? d.weapon : 'riveter') as WeaponId;
        const run = newRun(weapon, d.seed ?? 1);
        run.order = [d.boss as keyof typeof BOSS_DEFS];
        for (const c of d.cyber) if (c in CYBER_SLOT) run.loadout.cyber[CYBER_SLOT[c as CyberId]] = c as CyberId;
        run.loadout.mods = d.mods as ModId[];
        session.run = run;
        const p = nextFightParams(run)!;
        this.scene.start('Fight', { boss: p.boss, tier: d.tier || 1 });
        return;
      }
      this.scene.start('Title');
    };
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      Promise.race([fonts.load('12px FusionPixel'), new Promise((r) => setTimeout(r, 1500))]).then(go, go);
    } else go();
  }
}
