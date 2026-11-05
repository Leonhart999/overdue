/** Boss definitions: arena, spawn point, factory, signature drop and music. */
import type { MusicTrack } from '../../engine/audio';
import type { Boss } from '../boss';
import type { BossId, CyberId } from '../loadout';
import type { Arena, World } from '../world';

export interface BossDef {
  id: BossId;
  arena: Arena;
  spawn: { x: number; y: number };
  make(w: World, tier: number): Boss;
  /** Signature cyberware offered after beating this boss. */
  drop: CyberId;
  music: MusicTrack;
  /** Frame in the 'portraits' sheet (64x64) or another texture for the intro card. */
  portrait?: { key: string; frame: string | number };
}
