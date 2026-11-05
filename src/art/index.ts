/**
 * Art registry. Every texture is generated here at boot (no image files).
 *   buildAllSpecs()        pure data (safe in node tests)
 *   registerAllTextures()  renders the specs into Phaser canvas textures (idempotent)
 *
 * Boss/arena art added by other modules must be listed in `buildAllSpecs`.
 */
import type Phaser from 'phaser';
import { renderSheet, type SheetSpec } from './core/sheet';
import { buildOwFrames, MAIN_CHARACTERS, owSheet } from './actors/characters';
import { buildBossFrames } from './actors/gearjaw';
import { buildPortraitSheet } from './actors/portraits';
import { buildSprites } from './sprites';
import { buildArenaBackgrounds } from './arenas';
import { buildBossArt } from './bossArt';
import { buildHubArt } from './hub';

let specs: SheetSpec[] | null = null;

/** Extra sheet builders registered by boss modules (keeps this file free of merge conflicts). */
const extra: (() => SheetSpec[])[] = [];
export function registerArt(build: () => SheetSpec[]): void { extra.push(build); specs = null; }

export function buildAllSpecs(): SheetSpec[] {
  if (specs) return specs;
  const echo = MAIN_CHARACTERS.find((c) => c.id === 'echo')!;
  const bosses = buildBossFrames().map((b) => ({
    key: `bt_${b.id}`, group: 'Bosses', frameW: 96, frameH: 96, columns: 4, frames: b.frames,
  }) satisfies SheetSpec);
  specs = [
    owSheet('echo', buildOwFrames(echo), 'Player'),
    ...bosses,
    buildPortraitSheet(),
    ...buildSprites(),
    ...buildArenaBackgrounds(),
    ...buildBossArt(),
    ...buildHubArt(),
    ...extra.flatMap((f) => f()),
  ];
  const seen = new Set<string>();
  for (const s of specs) {
    if (seen.has(s.key)) throw new Error(`[art] duplicate texture key ${s.key}`);
    seen.add(s.key);
  }
  return specs;
}

export function registerAllTextures(scene: Phaser.Scene): void {
  for (const spec of buildAllSpecs()) {
    if (scene.textures.exists(spec.key)) continue;
    const b = renderSheet(spec);
    const tex = scene.textures.addCanvas(spec.key, b.canvas);
    if (!tex) continue;
    b.rects.forEach((r, i) => {
      tex.add(i, 0, r.x, r.y, r.w, r.h);
      if (r.name && !r.name.startsWith('_pad')) tex.add(r.name, 0, r.x, r.y, r.w, r.h);
    });
  }
  // soft radial hole used to cut light into blackout darkness
  if (!scene.textures.exists('fx_hole')) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    scene.textures.addCanvas('fx_hole', c);
  }
}
