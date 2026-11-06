import { scrapyard } from '../arenas/scrapyard';
import { Gearjaw } from './gearjaw';
import type { BossDef } from './registry';

export const gearjawDef: BossDef = {
  id: 'gearjaw',
  arena: scrapyard,
  spawn: { x: 320, y: 196 },
  make: (w, tier) => new Gearjaw(w, tier, 320, 196),
  drop: 'arm_fist',
  hint: '吊车只砸中线 · 引它撞中线上的钢柱 · 废车堆会被撞散 · 正面有装甲，打背后',
  portrait: { key: 'portraits', frame: 'gearjaw_angry' },
  music: {
    bpm: 132,
    kick: 'x...x...x...x.x.',
    snare: '....x.......x...',
    hat: '..x...x...x...xx',
    bass: [0, null, 0, null, 12, null, 0, 3, 0, null, 0, null, 10, null, 7, null],
    lead: [null, null, null, null, null, null, null, null, 12, null, 15, null, 12, null, 10, null],
    root: 33,
    chords: [0, 0, 5, 3],
    wave: 'sawtooth',
  },
};
