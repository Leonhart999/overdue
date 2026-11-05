import { scrapyard } from '../arenas/scrapyard';
import { Gearjaw } from './gearjaw';
import type { BossDef } from './registry';

export const gearjawDef: BossDef = {
  id: 'gearjaw',
  arena: scrapyard,
  spawn: { x: 320, y: 168 },
  make: (w, tier) => new Gearjaw(w, tier, 320, 168),
  drop: 'arm_fist',
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
