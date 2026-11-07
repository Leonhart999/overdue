/**
 * Hub (据点): walk around between runs. Armory, cyberware bench (practice only),
 * records terminal, training range and the exit elevator.
 */
import Phaser from 'phaser';
import { audio, type MusicTrack } from '../engine/audio';
import { COL, P } from '../engine/gfx';
import { PhaserGfx } from '../engine/gfxPhaser';
import { clearEdges } from '../engine/input';
import { KeyboardMouseInput } from '../engine/inputPhaser';
import { BOSS_TEXT, CYBER_TEXT, DAFEYU_TEXT, MOD_TEXT, SLOT_TEXT, WEAPON_TEXT } from '../data/text';
import { makeHubArena } from '../game/arenas/hub';
import { availableBosses } from '../game/bosses';
import { CYBER_POOL, CYBER_SLOT, SLOTS, STOCK, WEAPON_MODS, WEAPONS, newLoadout, type CyberId, type Loadout, type Slot, type WeaponId } from '../game/loadout';
import { Player } from '../game/player';
import { newRun, nextFightParams, saveMeta } from '../game/run';
import { World } from '../game/world';
import { drawHud } from './hud';
import { applySettings, PauseMenu } from './pauseMenu';
import { session } from './session';
import { fmt, goto, H, W } from '../ui/ui';
import { textWidth } from '../ui/crispText';
import {
  cells, cellsWidth, chip, dim, dots, focusRow, header, heading, hints, keycap, mouseIcon, panel, para, SLOT_COL, socket, tagText, txt, WEAPON_COL, type Hint,
} from '../ui/kit';

const DT = 1 / 60;

const HUB_MUSIC: MusicTrack = {
  bpm: 84,
  kick: 'x.......x.......',
  snare: '........x.......',
  hat: '..x...x...x...x.',
  bass: [0, null, null, null, 7, null, null, null, 5, null, null, null, 3, null, null, null],
  lead: [12, null, null, 15, null, null, 19, null, null, null, 17, null, 15, null, null, null],
  root: 38,
  chords: [0, -4, -2, -7],
  wave: 'triangle',
};

type Overlay = 'armory' | 'bench' | 'records' | 'menu' | 'sim' | 'neural' | null;

// overlay layouts (screen space) and their hint rows
const ARMORY = { x: 24, y: 40, w: 592, h: 292, rowY: 80, rowH: 46, listW: 180 };
const BENCH = { x: 72, y: 40, w: 496, h: 292, rowY: 80, rowH: 52 };
const SIM = { x: 64, y: 40, w: 512, h: 292, rowY: 80, rowH: 30, listW: 268 };
const RECORDS = { x: 120, y: 52, w: 400, h: 256 };
const ARMORY_HINTS: Hint[] = [
  { keys: ['↑↓'], label: '选武器' },
  { keys: ['Enter', 'mouseL'], label: '拿上' },
  { keys: ['E', 'Esc'], label: '关闭' },
];
const BENCH_HINTS: Hint[] = [
  { keys: ['↑↓'], label: '选部位' },
  { keys: ['←→', 'mouseL', 'mouseR'], label: '切换' },
  { keys: ['E', 'Esc'], label: '关闭' },
];
const SIM_HINTS: Hint[] = [
  { keys: ['↑↓'], label: '选头目' },
  { keys: ['←→'], label: '选难度' },
  { keys: ['Enter'], label: '开打' },
  { keys: ['E', 'Esc'], label: '关闭' },
];
const RECORDS_HINTS: Hint[] = [{ keys: ['Esc'], label: '任意键关闭' }];
const SIM_TIER_TEXT = ['生命 ×1', '生命 ×1.35 · 更快', '生命 ×1.7 · 更快', '生命 ×2 · 最快'];

/** Options per slot on the bench: stock part first, then every reward part of that slot. */
function slotOptions(slot: Slot): CyberId[] {
  return [STOCK[slot], ...CYBER_POOL.filter((c) => CYBER_SLOT[c] === slot)];
}

export class HubScene extends Phaser.Scene {
  private world!: World;
  private gfx!: PhaserGfx;
  private kbm!: KeyboardMouseInput;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private acc = 0;
  private overlay: Overlay = null;
  private keys: string[] = [];
  private row = 0;
  private leaving = false;
  private musicOn = false;
  private loadout!: Loadout;
  private pause!: PauseMenu;

  constructor() { super('Hub'); }

  create(): void {
    this.acc = 0;
    this.overlay = null;
    this.leaving = false;
    this.musicOn = false;
    const main = this.cameras.main;
    main.setBackgroundColor(P.ink);
    this.uiCam = this.cameras.add(0, 0, W, H, false, 'ui');
    this.gfx = new PhaserGfx(this, main, this.uiCam);
    this.kbm = new KeyboardMouseInput(this);
    this.input.setDefaultCursor('none');

    const weapon = (session.meta.lastWeapon ?? 'riveter') as WeaponId;
    this.loadout = newLoadout(WEAPONS.includes(weapon) ? weapon : 'riveter');
    this.loadout.cyber = { ...STOCK, ...session.hubCyber };

    const arena = makeHubArena({
      current: () => this.loadout.weapon,
      openArmory: () => { this.open('armory'); this.row = Math.max(0, WEAPONS.indexOf(this.loadout.weapon)); },
      openBench: () => this.open('bench'),
      openRecords: () => this.open('records'),
      openSim: () => this.open('sim'),
      openNeural: () => this.open('neural'),
      depart: () => this.depart(),
    });
    const w = new World(arena, 1, 11);
    w.player = new Player(this.loadout, arena.playerSpawn.x, arena.playerSpawn.y);
    arena.setup(w);
    w.state = 'fight';
    w.input = this.kbm.state;
    this.world = w;
    applySettings(w.fx);
    this.pause = new PauseMenu(this, '回到标题', () => { this.overlay = null; audio.setMusicVolume(0.22); }, () => {
      this.overlay = null; this.leaving = true; goto(this, 'Title');
    }, w.fx);

    this.input.keyboard!.on('keydown', (ev: KeyboardEvent) => this.keys.push(ev.code));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.keys.push(p.rightButtonDown() ? 'MouseRight' : 'MouseLeft'));
    main.fadeIn(250, 5, 4, 10);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      audio.stopMusic();
      audio.stopLoops();
      this.world.player.weapon.dispose();
      this.input.setDefaultCursor('default');
    });
    if (import.meta.env.DEV) (window as unknown as { __od: Record<string, unknown> }).__od.world = w;
  }

  // ------------------------------------------------------------------ actions
  private rebuildPlayer(): void {
    const w = this.world;
    const old = w.player;
    old.weapon.dispose();
    const p = new Player(this.loadout, old.x, old.y);
    p.hp = p.maxHp;
    p.aim = old.aim;
    w.player = p;
  }

  private swapWeapon(id: WeaponId): void {
    if (this.loadout.weapon === id) return;
    this.loadout.weapon = id;
    this.rebuildPlayer();
    session.meta.lastWeapon = id;
    saveMeta(session.meta);
    const p = this.world.player;
    this.world.fx.label(p.x, p.y - 24, WEAPON_TEXT[id].name, COL.player, 1);
    this.world.sfx('reload');
  }

  private open(o: Overlay): void {
    this.overlay = o;
    this.keys = [];
    this.row = 0;
    audio.loop('arc', false);
  }

  private depart(): void {
    if (this.leaving) return;
    this.leaving = true;
    const run = newRun(this.loadout.weapon);
    session.run = run;
    session.meta.runs++;
    saveMeta(session.meta);
    const p = nextFightParams(run)!;
    this.world.sfx('siren', 0.5);
    goto(this, 'Fight', { boss: p.boss, tier: p.tier, hpMul: p.hpMul, paceMul: p.paceMul }, 500);
  }

  private simBoss = 0;
  private simTier = 1;

  /** Simulator: fight one boss with the current hub loadout (incl. practice cyberware). */
  private startSim(): void {
    if (this.leaving) return;
    const ids = availableBosses();
    const boss = ids[this.simBoss % ids.length];
    this.leaving = true;
    this.overlay = null;
    const run = newRun(this.loadout.weapon);
    run.order = [boss];
    run.practice = true;
    run.loadout.cyber = { ...this.loadout.cyber };
    session.run = run;
    goto(this, 'Fight', { boss, tier: this.simTier }, 400);
  }

  private cycle(slot: Slot, dir: number): void {
    const opts = slotOptions(slot);
    const i = opts.indexOf(this.loadout.cyber[slot]);
    const next = opts[(i + dir + opts.length) % opts.length];
    this.loadout.cyber[slot] = next;
    session.hubCyber[slot] = next;
    this.rebuildPlayer();
    audio.sfx('ui');
  }

  // ------------------------------------------------------------------ loop
  update(_t: number, delta: number): void {
    const w = this.world;
    const inp = this.kbm.state;
    this.kbm.poll(this.cameras.main);
    if (!this.musicOn && audio.ctx) { this.musicOn = true; audio.startMusic(HUB_MUSIC); audio.setMusicVolume(0.22); }

    if (this.overlay === 'menu') {
      this.pause.update(inp.ay - this.cameras.main.scrollY);
      clearEdges(inp);
    } else if (this.overlay) {
      this.handleOverlay();
      clearEdges(inp);
    } else {
      if (inp.pausePressed) { inp.pausePressed = false; this.open('menu'); this.pause.show(); }
      this.keys = [];
      this.acc += Math.min(delta, 100) / 1000;
      let n = 0;
      while (this.acc >= DT && n < 5) { w.step(DT, inp); if (!w.frozen) clearEdges(inp); this.acc -= DT; n++; }
      if (n === 5) this.acc = 0;
    }
    this.render();
  }

  private handleOverlay(): void {
    const keys = this.keys;
    this.keys = [];
    const inp = this.kbm.state;
    const my = inp.ay - this.cameras.main.scrollY;
    for (const k of keys) {
      const close = k === 'Escape' || k === 'KeyE' || k === 'KeyF' || k === 'KeyP';
      if (this.overlay === 'armory') {
        const n = WEAPONS.length;
        if (k === 'ArrowUp' || k === 'KeyW') { this.row = (this.row + n - 1) % n; audio.sfx('ui'); }
        else if (k === 'ArrowDown' || k === 'KeyS') { this.row = (this.row + 1) % n; audio.sfx('ui'); }
        else if (k === 'Enter' || k === 'Space' || k === 'MouseLeft') { this.swapWeapon(WEAPONS[this.row]); this.overlay = null; }
        else if (close) this.overlay = null;
      } else if (this.overlay === 'bench') {
        if (k === 'ArrowUp' || k === 'KeyW') { this.row = (this.row + 3) % 4; audio.sfx('ui'); }
        else if (k === 'ArrowDown' || k === 'KeyS') { this.row = (this.row + 1) % 4; audio.sfx('ui'); }
        else if (k === 'ArrowLeft' || k === 'KeyA' || k === 'MouseRight') this.cycle(SLOTS[this.row], -1);
        else if (k === 'ArrowRight' || k === 'KeyD' || k === 'MouseLeft' || k === 'Enter' || k === 'Space') this.cycle(SLOTS[this.row], 1);
        else if (close) this.overlay = null;
      } else if (this.overlay === 'sim') {
        const n = availableBosses().length;
        if (k === 'ArrowUp' || k === 'KeyW') { this.simBoss = (this.simBoss + n - 1) % n; audio.sfx('ui'); }
        else if (k === 'ArrowDown' || k === 'KeyS') { this.simBoss = (this.simBoss + 1) % n; audio.sfx('ui'); }
        else if (k === 'ArrowLeft' || k === 'KeyA' || k === 'MouseRight') { this.simTier = Math.max(1, this.simTier - 1); audio.sfx('ui'); }
        else if (k === 'ArrowRight' || k === 'KeyD') { this.simTier = Math.min(4, this.simTier + 1); audio.sfx('ui'); }
        else if (k === 'Enter' || k === 'Space' || k === 'MouseLeft') { audio.sfx('uiConfirm'); this.startSim(); }
        else if (close) this.overlay = null;
      } else if (this.overlay === 'neural') {
        const mx = inp.ax - this.cameras.main.scrollX;
        if (close || k === 'Enter' || (k === 'MouseLeft' && mx >= 452 && mx <= 528 && my >= 279 && my <= 304)) this.overlay = null;
      } else if (this.overlay === 'records') {
        if (close || k === 'Enter' || k === 'Space' || k === 'MouseLeft') this.overlay = null;
      }
    }
    // mouse hover picks the row
    const mx = inp.ax - this.cameras.main.scrollX;
    if (this.overlay === 'armory' && mx > ARMORY.x && mx < ARMORY.x + 6 + ARMORY.listW) {
      for (let i = 0; i < WEAPONS.length; i++) if (my >= ARMORY.rowY + i * ARMORY.rowH - 2 && my < ARMORY.rowY + (i + 1) * ARMORY.rowH - 2) this.row = i;
    }
    if (this.overlay === 'bench' && mx > BENCH.x && mx < BENCH.x + BENCH.w) {
      for (let i = 0; i < 4; i++) if (my >= BENCH.rowY + i * BENCH.rowH - 2 && my < BENCH.rowY + (i + 1) * BENCH.rowH - 2) this.row = i;
    }
    if (this.overlay === 'sim' && mx > SIM.x && mx < SIM.x + 6 + SIM.listW) {
      const n = availableBosses().length;
      for (let i = 0; i < n; i++) if (my >= SIM.rowY + i * SIM.rowH - 2 && my < SIM.rowY + (i + 1) * SIM.rowH - 2) this.simBoss = i;
    }
  }

  // ------------------------------------------------------------------ drawing
  private render(): void {
    const w = this.world;
    const [sx, sy] = w.fx.shakeOffset();
    this.cameras.main.setScroll(sx, sy);
    const g = this.gfx;
    g.begin();
    if (this.overlay) w.prompt = null;
    w.draw(g);
    drawHud(g, w, sx, sy, (f) => this.textures.exists('ico') && this.textures.get('ico').has(f));
    w.fx.drawFlash(g, W, H);
    if (this.overlay === 'armory') this.drawArmory();
    if (this.overlay === 'bench') this.drawBench();
    if (this.overlay === 'records') this.drawRecords();
    if (this.overlay === 'sim') this.drawSim();
    if (this.overlay === 'neural') this.drawNeural();
    if (this.overlay === 'menu') this.pause.draw(g);
    g.end();
  }

  private hasTex(key: string, frame: string): boolean {
    return this.textures.exists(key) && this.textures.get(key).has(frame);
  }

  /** Overlay frame: dim the hub, panel with header strip, key-cap hints in the footer. */
  private frame(x: number, y: number, w: number, h: number, title: string, tag: string, accent: number, hintsRow: Hint[], sub?: string): void {
    const g = this.gfx;
    dim(g, 0.72);
    panel(g, x, y, w, h, { layer: 'over', accent, alpha: 1 });
    header(g, x, y, w, title, tag, accent, { layer: 'over', sub, subColor: P.amber });
    g.rect(x + 8, y + h - 25, w - 16, 1, P.navy, 1, 'over');
    hints(g, hintsRow, x + w / 2, y + h - 19, { layer: 'over', align: 'center' });
  }

  /** Armory: weapon list on the left, the focused weapon's rules and mods on the right. */
  private drawArmory(): void {
    const g = this.gfx, L = 'over' as const;
    const A = ARMORY;
    this.frame(A.x, A.y, A.w, A.h, '武器库', 'ARMORY', P.amber, ARMORY_HINTS, '一局只带一把 · 奖励里会出现它的改装');
    const held = this.loadout.weapon;
    WEAPONS.forEach((id, i) => {
      const y = A.rowY + i * A.rowH;
      const f = i === this.row;
      const x = A.x + 6, w = A.listW;
      if (f) focusRow(g, x, y, w, A.rowH - 4, WEAPON_COL[id], L);
      if (i > 0) g.rect(x + 8, y - 3, w - 16, 1, P.navy, 1, L);
      socket(g, x + 16, y + 6, 28, 28, { layer: L, edge: f ? WEAPON_COL[id] : undefined });
      g.img('wpn', id, x + 30, y + 20, { layer: L, ox: 0.5, oy: 0.5 });
      txt(g, WEAPON_TEXT[id].name, x + 52, y + 5, { layer: L, color: f ? P.white : P.pale });
      txt(g, WEAPON_TEXT[id].tag, x + 52, y + 21, { layer: L, color: f ? P.fog : P.slate });
      if (id === held) chip(g, 'HELD', x + w - 8, y + 7, { layer: L, align: 'right', color: P.ink, fill: COL.player });
    });
    // detail pane
    const id = WEAPONS[this.row];
    const col = WEAPON_COL[id];
    const px = A.x + A.listW + 18, pw = A.x + A.w - 14 - px;
    let y = A.rowY;
    socket(g, px, y, 76, 40, { layer: L, edge: col });
    g.img('wpn', id, px + 38, y + 20, { layer: L, ox: 0.5, oy: 0.5, scale: 3 });
    heading(g, WEAPON_TEXT[id].name, px + 88, y + 1, { layer: L });
    txt(g, WEAPON_TEXT[id].tag, px + 88, y + 27, { layer: L, color: col });
    const best = session.meta.bestRun[id];
    tagText(g, 'BEST', px + pw, y + 4, { layer: L, align: 'right', color: P.slate });
    txt(g, best ? fmt(best) : '—', px + pw, y + 13, { layer: L, align: 'right', color: best ? P.amber : P.slate });
    y += 44;
    const LH = 12;
    const rule = (btn: 'l' | 'r', label: string, body: string, maxLines: number) => {
      mouseIcon(g, btn, px, y - 1, { layer: L });
      txt(g, label, px + 14, y, { layer: L, color: P.fog });
      const n = para(g, body, px + 64, y, pw - 64, { layer: L, color: P.pale, lineH: LH, maxLines });
      y += n * LH + 4;
    };
    rule('l', '主武器', WEAPON_TEXT[id].primary, 3);
    rule('r', '特殊', WEAPON_TEXT[id].special, 4);
    g.rect(px, y, pw, 1, P.navy, 1, L);
    y += 5;
    txt(g, '改装', px, y, { layer: L, color: P.fog });
    tagText(g, 'MODS', px + pw, y + 4, { layer: L, align: 'right', color: col });
    y += 16;
    for (const m of WEAPON_MODS[id]) {
      txt(g, MOD_TEXT[m].name, px, y, { layer: L, color: col });
      const n = para(g, MOD_TEXT[m].desc, px + 64, y, pw - 64, { layer: L, color: P.steel, lineH: LH, maxLines: 2 });
      y += n * LH + 4;
    }
  }

  private drawBench(): void {
    const g = this.gfx, L = 'over' as const;
    const B = BENCH;
    this.frame(B.x, B.y, B.w, B.h, '义体台', 'CYBERWARE BENCH', P.cyan, BENCH_HINTS, '只在据点生效 · 出发时恢复原厂');
    SLOTS.forEach((slot, i) => {
      const y = B.rowY + i * B.rowH;
      const f = i === this.row;
      const id = this.loadout.cyber[slot];
      const opts = slotOptions(slot);
      const x = B.x + 6, w = B.w - 12;
      if (f) focusRow(g, x, y, w, B.rowH - 4, P.cyan, L);
      if (i > 0) g.rect(x + 8, y - 3, w - 16, 1, P.navy, 1, L);
      // slot name + its key
      txt(g, SLOT_TEXT[slot].name, x + 16, y + 6, { layer: L, color: f ? P.white : P.fog });
      if (slot === 'legs' || slot === 'arm') keycap(g, SLOT_TEXT[slot].key, x + 16, y + 24, { layer: L });
      else chip(g, 'AUTO', x + 16, y + 25, { layer: L, color: P.slate });
      // icon socket
      socket(g, x + 52, y + 8, 28, 28, { layer: L, edge: f ? SLOT_COL[slot] : undefined });
      if (this.hasTex('ico', id)) g.img('ico', id, x + 54, y + 10, { layer: L, ox: 0, oy: 0 });
      // ◀ name ▶ and the option counter
      const nx = x + 92;
      arrowChip(g, '◀', nx, y + 6, f, L);
      txt(g, CYBER_TEXT[id].name, nx + 16, y + 5, { layer: L, color: f ? P.white : P.pale });
      arrowChip(g, '▶', nx + 22 + textWidth(CYBER_TEXT[id].name), y + 6, f, L);
      tagText(g, `${opts.indexOf(id) + 1} / ${opts.length}`, x + w - 12, y + 8, { layer: L, align: 'right', color: P.slate });
      para(g, CYBER_TEXT[id].desc || '无效果', nx, y + 21, w - (nx - x) - 16, { layer: L, color: f ? P.pale : P.steel, maxLines: 2, lineH: 13 });
    });
  }

  private drawSim(): void {
    const g = this.gfx, L = 'over' as const;
    const S = SIM;
    const ids = availableBosses();
    this.frame(S.x, S.y, S.w, S.h, '头目模拟器', 'SIMULATOR', P.acid, SIM_HINTS, '用当前武器和义体台上的义体 · 不计战绩');
    const sel = this.simBoss % ids.length;
    ids.forEach((id, i) => {
      const y = S.rowY + i * S.rowH;
      const f = i === sel;
      const x = S.x + 6, w = S.listW;
      if (f) focusRow(g, x, y, w, S.rowH - 4, P.acid, L);
      if (i > 0) g.rect(x + 8, y - 3, w - 16, 1, P.navy, 1, L);
      txt(g, BOSS_TEXT[id].name, x + 16, y + 3, { layer: L, color: f ? P.white : P.pale });
      txt(g, BOSS_TEXT[id].place, x + 16, y + 16, { layer: L, color: f ? P.fog : P.slate });
      const kills = session.meta.bossKills[id] ?? 0;
      tagText(g, 'KILLS', x + w - 12, y + 6, { layer: L, align: 'right', color: P.slate });
      txt(g, String(kills), x + w - 12, y + 15, { layer: L, align: 'right', color: kills ? P.acid : P.slate });
    });
    // preview window: standee over a grid, difficulty below
    const px = S.x + S.listW + 16, pw = S.x + S.w - 12 - px, py = S.rowY, ph = 156;
    socket(g, px, py, pw, ph, { layer: L, edge: P.moss });
    for (let gx = px + 8; gx < px + pw - 2; gx += 16) g.rect(gx, py + 2, 1, ph - 4, P.moss, 0.5, L);
    for (let gy = py + 12; gy < py + ph - 2; gy += 16) g.rect(px + 2, gy, pw - 4, 1, P.moss, 0.5, L);
    const boss = ids[sel];
    if (this.hasTex('standee', boss)) g.img('standee', boss, px + pw / 2, py + ph - 1, { layer: L, ox: 0.5, oy: 1 });
    tagText(g, BOSS_TEXT[boss].en.toUpperCase(), px + 6, py + 6, { layer: L, color: P.acid });
    const dy = py + ph + 10;
    txt(g, '难度', px, dy, { layer: L, color: P.fog });
    arrowChip(g, '◀', px + 32, dy + 1, true, L);
    txt(g, `第 ${this.simTier} 场`, px + 48, dy, { layer: L, color: P.white });
    arrowChip(g, '▶', px + 54 + textWidth(`第 ${this.simTier} 场`), dy + 1, true, L);
    cells(g, px + pw - cellsWidth(4, 6), dy + 3, 4, this.simTier, P.acid, { layer: L, w: 6, h: 7 });
    txt(g, SIM_TIER_TEXT[this.simTier - 1], px, dy + 17, { layer: L, color: P.slate });
  }

  private drawNeural(): void {
    const g = this.gfx, L = 'over' as const;
    this.frame(96, 56, 448, 252, DAFEYU_TEXT.title, 'NEURAL INTERFACE', P.cyan, []);
    // The character art is the identity; no biography or dialogue is shown here.
    socket(g, 112, 102, 136, 168, { layer: L, edge: P.teal });
    for (let y = 114; y < 264; y += 16) g.rect(114, y, 132, 1, P.teal, 0.2, L);
    g.ellipse(180, 255, 44, 7, P.teal, 0.35, L);
    g.img('portrait_dafeyu', 'portrait', 180, 258, { layer: L });
    chip(g, DAFEYU_TEXT.name, 180, 107, { layer: L, align: 'center', color: P.ice, fill: P.abyss });
    heading(g, DAFEYU_TEXT.talent, 268, 108, { layer: L });
    chip(g, DAFEYU_TEXT.pending, 268, 141, { layer: L, color: P.amber });
    para(g, DAFEYU_TEXT.rule, 268, 165, 244, { layer: L, color: P.fog, lineH: 16, maxLines: 2 });
    g.line(294, 220, 486, 220, 1, P.teal, 0.6, L);
    for (const [i, icon] of ['head_optics', 'head_reflex', 'head_ballistic'].entries()) {
      const x = 278 + i * 88;
      socket(g, x, 204, 32, 32, { layer: L, edge: P.slate });
      g.img('ico', icon, x + 4, 208, { layer: L, ox: 0, oy: 0, alpha: 0.35 });
    }
    txt(g, DAFEYU_TEXT.unavailable, 390, 250, { layer: L, color: P.slate, align: 'center' });
    keycap(g, 'Esc', 452, 285, { layer: L });
    txt(g, DAFEYU_TEXT.close, 480, 284, { layer: L, color: P.fog });
  }

  private drawRecords(): void {
    const g = this.gfx, L = 'over' as const;
    const R = RECORDS;
    const m = session.meta;
    this.frame(R.x, R.y, R.w, R.h, '战绩', 'LEDGER', P.amber, RECORDS_HINTS);
    // summary tiles
    const tiles: [string, string, number][] = [['出击', 'RUNS', m.runs], ['通关', 'CLEARED', m.wins]];
    tiles.forEach(([label, tag, n], i) => {
      const tx = R.x + 16 + i * 92, ty = R.y + 42;
      socket(g, tx, ty, 84, 36, { layer: L });
      tagText(g, tag, tx + 6, ty + 5, { layer: L, color: P.slate });
      txt(g, label, tx + 6, ty + 16, { layer: L, color: P.fog });
      heading(g, String(n), tx + 78, ty + 7, { layer: L, align: 'right', color: i ? P.amber : P.white });
    });
    // two-column ledger
    const colW = (R.w - 48) / 2;
    const cols: { title: string; tag: string; rows: [string, string, number][] }[] = [
      { title: '击败头目', tag: 'KILLS', rows: availableBosses().map((b): [string, string, number] => [BOSS_TEXT[b].name, String(m.bossKills[b] ?? 0), (m.bossKills[b] ?? 0) ? P.pale : P.slate]) },
      { title: '最快通关', tag: 'BEST', rows: WEAPONS.map((wp): [string, string, number] => { const t = m.bestRun[wp]; return [WEAPON_TEXT[wp].name, t ? fmt(t) : '—', t ? P.amber : P.slate]; }) },
    ];
    cols.forEach((c, i) => {
      const cx = R.x + 16 + i * (colW + 16), cy = R.y + 90;
      txt(g, c.title, cx, cy, { layer: L, color: P.fog });
      tagText(g, c.tag, cx + colW, cy + 4, { layer: L, align: 'right', color: P.amber });
      g.rect(cx, cy + 15, colW, 1, P.slate, 1, L);
      c.rows.forEach(([name, val, col], j) => {
        const ry = cy + 20 + j * 16;
        txt(g, name, cx, ry, { layer: L, color: col === P.slate ? P.steel : P.pale });
        txt(g, val, cx + colW, ry, { layer: L, align: 'right', color: col });
        dots(g, cx + textWidth(name) + 4, cx + colW - textWidth(val) - 4, ry + 9, P.indigo, L);
      });
    });
  }
}

/** Small ◀ / ▶ chip (lit in the focused row). */
function arrowChip(g: PhaserGfx, a: '◀' | '▶', x: number, y: number, lit: boolean, layer: 'over'): void {
  g.rect(x, y, 9, 11, P.ink, 1, layer);
  g.rect(x + 1, y + 1, 7, 9, lit ? P.indigo : P.night, 1, layer);
  g.crisp(a, x + 3, y + 3, { layer, font: 'micro', color: lit ? P.cyan : P.slate });
}
