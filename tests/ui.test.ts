import { describe, expect, it } from 'vitest';
import { MICRO, MICRO_H, microGlyph } from '../src/art/uiKit';
import { NullGfx, type CrispOpts } from '../src/engine/gfx';
import { BOSS_DEFS } from '../src/game/bosses';
import { newLoadout } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { World } from '../src/game/world';
import { drawHud } from '../src/scenes/hud';
import { textWidth } from '../src/ui/crispText';
import { parseControls, wrapPx } from '../src/ui/kit';
import { UI } from '../src/data/text';

/** NullGfx that records crisp-text calls. */
function recordingGfx(): NullGfx & { crisps: { str: string; x: number; y: number; o?: CrispOpts }[] } {
  const g = Object.assign(new NullGfx(), { crisps: [] as { str: string; x: number; y: number; o?: CrispOpts }[] });
  (g as unknown as { crisp: (str: string, x: number, y: number, o?: CrispOpts) => void }).crisp = (str, x, y, o) => { g.crisps.push({ str, x, y, o }); };
  return g;
}

describe('ui kit', () => {
  it('micro font glyphs are 5 rows of equal width', () => {
    for (const [ch, rows] of Object.entries(MICRO)) {
      expect(rows.length, ch).toBe(MICRO_H);
      for (const r of rows) expect(r.length, ch).toBe(rows[0].length);
    }
  });

  it('micro font covers the EN tags and key legends', () => {
    const tags = ['PAUSED', 'CONTRACT OFFER · 1 / 3', 'LOAN CONTRACT', 'HALCYON CREDIT · SETTLEMENT', 'CYBERWARE BENCH', 'SIMULATOR',
      'LEDGER', 'KILLS', 'BEST', 'RUNS', 'CLEARED', 'TOTAL', 'AUTO', 'LOCK 3', 'TIP', 'PHASE 02', 'NO.0042', 'ENTER', 'ESC', 'SPACE', 'WASD', '↑↓', '←→', '␣', '◀', '▶'];
    for (const t of tags) for (const ch of t) expect(microGlyph(ch) === MICRO['?'] && ch !== '?', `${t} '${ch}'`).toBe(false);
  });

  it('wraps text within the width', () => {
    const lines = wrapPx('受伤时放出电磁脉冲，清除周围所有子弹并推开物体。冷却 12 秒。', 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textWidth(l)).toBeLessThanOrEqual(120);
    // closing punctuation never starts a line
    for (const l of lines.slice(1)) expect('，。）'.includes(l[0])).toBe(false);
  });

  it('parses the controls line into key hints', () => {
    const h = parseControls(UI.controls);
    expect(h.length).toBeGreaterThanOrEqual(6);
    for (const it of h) { expect(it.keys.length).toBe(1); expect(it.label.length).toBeGreaterThan(0); }
  });

  it('draws the HUD headless for every boss', () => {
    for (const def of Object.values(BOSS_DEFS)) {
      const w = new World(def!.arena, 1, 1);
      w.player = new Player(newLoadout('breacher'), def!.arena.playerSpawn.x, def!.arena.playerSpawn.y);
      def!.arena.setup(w);
      w.boss = def!.make(w, 1);
      w.state = 'fight';
      w.prompt = 'E  互动';
      w.player.locked.arm = 2;
      const g = recordingGfx();
      drawHud(g, w, 0, 0, () => true);
      expect(g.crisps.some((c) => c.str === w.boss!.name)).toBe(true);
      expect(g.crisps.some((c) => c.str === 'LOCK 2')).toBe(true);
      // the HUD stays in the top band (the prompt follows the player)
      for (const c of g.crisps) if (c.str !== '互动' && c.str !== 'E') expect(c.y, c.str).toBeLessThan(48);
    }
  });
});
