/** Run-level ids and the loadout carried between fights. */

export type WeaponId = 'riveter' | 'arc' | 'breacher' | 'blade';
export const WEAPONS: WeaponId[] = ['riveter', 'arc', 'breacher', 'blade'];

export type Slot = 'legs' | 'arm' | 'core' | 'head';
export const SLOTS: Slot[] = ['legs', 'arm', 'core', 'head'];

export type CyberId =
  | 'legs_stock' | 'legs_leap' | 'legs_blink' | 'legs_slide'
  | 'arm_shove' | 'arm_grapple' | 'arm_fist' | 'arm_jack'
  | 'core_none' | 'core_plating' | 'core_capacitor' | 'core_debt' | 'core_overclock'
  | 'head_none' | 'head_optics' | 'head_reflex' | 'head_ballistic';

export const STOCK: Record<Slot, CyberId> = { legs: 'legs_stock', arm: 'arm_shove', core: 'core_none', head: 'head_none' };

export const CYBER_SLOT: Record<CyberId, Slot> = {
  legs_stock: 'legs', legs_leap: 'legs', legs_blink: 'legs', legs_slide: 'legs',
  arm_shove: 'arm', arm_grapple: 'arm', arm_fist: 'arm', arm_jack: 'arm',
  core_none: 'core', core_plating: 'core', core_capacitor: 'core', core_debt: 'core', core_overclock: 'core',
  head_none: 'head', head_optics: 'head', head_reflex: 'head', head_ballistic: 'head',
};

/** Cyberware that can appear as rewards (stock parts excluded). */
export const CYBER_POOL: CyberId[] = [
  'legs_leap', 'legs_blink', 'legs_slide',
  'arm_grapple', 'arm_fist', 'arm_jack',
  'core_plating', 'core_capacitor', 'core_debt', 'core_overclock',
  'head_optics', 'head_reflex', 'head_ballistic',
];

export type ModId =
  | 'riveter_barbed' | 'riveter_magnet' | 'riveter_blast'
  | 'arc_mine' | 'arc_web' | 'arc_aftershock'
  | 'breacher_dragon' | 'breacher_recoil' | 'breacher_overload'
  | 'blade_return' | 'blade_afterimage' | 'blade_flow';

/** Every weapon has exactly three available modifications. */
export const WEAPON_MODS: Record<WeaponId, readonly [ModId, ModId, ModId]> = {
  riveter: ['riveter_barbed', 'riveter_magnet', 'riveter_blast'],
  arc: ['arc_mine', 'arc_web', 'arc_aftershock'],
  breacher: ['breacher_dragon', 'breacher_recoil', 'breacher_overload'],
  blade: ['blade_return', 'blade_afterimage', 'blade_flow'],
};

export type BossId = 'gearjaw' | 'lux' | 'octohydra' | 'kade' | 'vesper' | 'kairo' | 'fold';

export interface Loadout {
  weapon: WeaponId;
  mods: ModId[];
  cyber: Record<Slot, CyberId>;
  /** Base max HP before cyberware modifiers. */
  maxHp: number;
  hp: number;
}

export function newLoadout(weapon: WeaponId): Loadout {
  return { weapon, mods: [], cyber: { ...STOCK }, maxHp: 5, hp: 5 };
}

/** Max HP after cyberware (debt core costs 2). */
export function effectiveMaxHp(l: Loadout): number {
  return Math.max(1, l.maxHp - (l.cyber.core === 'core_debt' ? 2 : 0));
}
