/**
 * Hub (据点): walk around between runs. Weapon racks, cyberware bench (practice only),
 * records terminal, training range and the exit elevator.
 */
import Phaser from 'phaser';
import { audio, type MusicTrack } from '../engine/audio';
import { COL, P } from '../engine/gfx';
import { PhaserGfx } from '../engine/gfxPhaser';
import { clearEdges } from '../engine/input';
import { KeyboardMouseInput } from '../engine/inputPhaser';
import { BOSS_TEXT, CYBER_TEXT, SLOT_TEXT, WEAPON_TEXT } from '../data/text';
import { makeHubArena } from '../game/arenas/hub';
import { CYBER_POOL, CYBER_SLOT, SLOTS, STOCK, WEAPONS, newLoadout, type CyberId, type Loadout, type Slot, type WeaponId } from '../game/loadout';
import { Player } from '../game/player';
import { newRun, nextFightParams, saveMeta } from '../game/run';
import { World } from '../game/world';
import { drawHud } from './hud';
import { applySettings, PauseMenu } from './pauseMenu';
import { session } from './session';
import { fmt, goto, H, W } from '../ui/ui';

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

type Overlay = 'bench' | 'records' | 'menu' | null;

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
      swapWeapon: (id) => this.swapWeapon(id),
      openBench: () => this.open('bench'),
      openRecords: () => this.open('records'),
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
      if (this.overlay === 'bench') {
        // mouse hover picks the row
        if (k === 'ArrowUp' || k === 'KeyW') { this.row = (this.row + 3) % 4; audio.sfx('ui'); }
        else if (k === 'ArrowDown' || k === 'KeyS') { this.row = (this.row + 1) % 4; audio.sfx('ui'); }
        else if (k === 'ArrowLeft' || k === 'KeyA' || k === 'MouseRight') this.cycle(SLOTS[this.row], -1);
        else if (k === 'ArrowRight' || k === 'KeyD' || k === 'MouseLeft' || k === 'Enter' || k === 'Space') this.cycle(SLOTS[this.row], 1);
        else if (close) this.overlay = null;
      } else if (this.overlay === 'records') {
        if (close || k === 'Enter' || k === 'Space' || k === 'MouseLeft') this.overlay = null;
      }
    }
    if (this.overlay === 'bench') {
      for (let i = 0; i < 4; i++) if (my > 92 + i * 52 && my < 92 + i * 52 + 46 && inp.ax > 90 && inp.ax < 550) this.row = i;
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
    drawHud(g, w, sx, sy);
    if (!this.overlay) g.text('E 互动 · 武器架换武器 · 义体台试义体 · 右边是训练场 · 电梯出发', W / 2, 344, { layer: 'ui', align: 'center', color: P.slate });
    w.fx.drawFlash(g, W, H);
    if (this.overlay === 'bench') this.drawBench();
    if (this.overlay === 'records') this.drawRecords();
    if (this.overlay === 'menu') this.pause.draw(g);
    g.end();
  }

  private box(x: number, y: number, w: number, h: number, edge: number = P.slate): void {
    const g = this.gfx;
    g.rect(x, y, w, h, P.night, 0.96, 'ui');
    g.strokeRect(x, y, w, h, 1, edge, 1, 'ui');
  }

  private drawBench(): void {
    const g = this.gfx;
    g.rect(0, 0, W, H, P.ink, 0.6, 'ui');
    this.box(80, 46, 480, 290, P.cyan);
    g.text('义体台', 96, 54, { layer: 'ui', color: P.white, scale: 2 });
    g.text('只在据点生效 · 出发时恢复原厂', 544, 60, { layer: 'ui', align: 'right', color: P.amber });
    SLOTS.forEach((slot, i) => {
      const y = 92 + i * 52;
      const f = i === this.row;
      const id = this.loadout.cyber[slot];
      const opts = slotOptions(slot);
      g.rect(92, y, 456, 46, f ? P.navy : P.night, 1, 'ui');
      if (f) g.strokeRect(92, y, 456, 46, 1, P.cyan, 1, 'ui');
      g.text(`${SLOT_TEXT[slot].name}`, 104, y + 6, { layer: 'ui', color: P.slate });
      g.text(SLOT_TEXT[slot].key, 104, y + 24, { layer: 'ui', color: COL.player, alpha: 0.8 });
      g.text(`◀  ${CYBER_TEXT[id].name}  ▶`, 156, y + 6, { layer: 'ui', color: f ? P.white : P.pale });
      g.text(`${opts.indexOf(id) + 1}/${opts.length}`, 536, y + 6, { layer: 'ui', align: 'right', color: P.slate });
      const desc = CYBER_TEXT[id].desc || '无效果';
      g.text(desc.slice(0, 32), 156, y + 21, { layer: 'ui', color: P.steel });
      if (desc.length > 32) g.text(desc.length > 64 ? desc.slice(32, 63) + '…' : desc.slice(32), 156, y + 33, { layer: 'ui', color: P.steel });
    });
    g.text('上下选部位 · 左右切换（鼠标左/右键） · E / Esc 关闭', W / 2, 314, { layer: 'ui', align: 'center', color: P.slate });
  }

  private drawRecords(): void {
    const g = this.gfx;
    const m = session.meta;
    g.rect(0, 0, W, H, P.ink, 0.6, 'ui');
    this.box(140, 60, 360, 240, P.acid);
    g.text('战绩', 156, 68, { layer: 'ui', color: P.white, scale: 2 });
    g.text(`出击 ${m.runs} 次 · 通关 ${m.wins} 次`, 156, 102, { layer: 'ui', color: P.pale });
    g.text('击败头目', 156, 128, { layer: 'ui', color: P.slate });
    (['gearjaw', 'lux', 'octohydra'] as const).forEach((b, i) => {
      g.text(`${BOSS_TEXT[b].name}  ${m.bossKills[b] ?? 0}`, 172, 146 + i * 16, { layer: 'ui', color: P.pale });
    });
    g.text('最快通关', 340, 128, { layer: 'ui', color: P.slate });
    WEAPONS.forEach((wp, i) => {
      const t = m.bestRun[wp];
      g.text(`${WEAPON_TEXT[wp].name}  ${t ? fmt(t) : '—'}`, 356, 146 + i * 16, { layer: 'ui', color: t ? P.amber : P.slate });
    });
    g.text('任意键关闭', W / 2, 276, { layer: 'ui', align: 'center', color: P.slate });
  }

}
