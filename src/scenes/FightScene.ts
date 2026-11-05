/** One boss fight: fixed-step simulation, rendering, HUD, intro card, pause, end of fight. */
import Phaser from 'phaser';
import { audio } from '../engine/audio';
import { P } from '../engine/gfx';
import { PhaserGfx } from '../engine/gfxPhaser';
import { clearEdges, type InputState } from '../engine/input';
import { KeyboardMouseInput } from '../engine/inputPhaser';
import { BOSS_TEXT, UI } from '../data/text';
import { BOSS_DEFS } from '../game/bosses';
import { Bot } from '../game/bot';
import { Player } from '../game/player';
import { finishFight, isLastFight, saveMeta, type FightRecord } from '../game/run';
import { World } from '../game/world';
import { drawHud } from './hud';
import { session } from './session';
import { goto, H, W } from '../ui/ui';

const DT = 1 / 60;

export interface FightData {
  boss: string;
  tier: number;
  hpMul?: number;
  paceMul?: number;
}

export class FightScene extends Phaser.Scene {
  world!: World;
  private gfx!: PhaserGfx;
  private kbm!: KeyboardMouseInput;
  private bot: Bot | null = null;
  private acc = 0;
  private paused = false;
  private pauseFocus = 0;
  private introT = 0;
  private ended = false;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private data0!: FightData;

  constructor() { super('Fight'); }

  init(data: FightData): void {
    this.data0 = data;
    this.acc = 0;
    this.paused = false;
    this.introT = 0;
    this.ended = false;
  }

  create(): void {
    const run = session.run!;
    const def = BOSS_DEFS[this.data0.boss as keyof typeof BOSS_DEFS]!;
    const main = this.cameras.main;
    main.setBackgroundColor(P.ink);
    this.uiCam = this.cameras.add(0, 0, W, H, false, 'ui');
    this.gfx = new PhaserGfx(this, main, this.uiCam);
    this.kbm = new KeyboardMouseInput(this);
    this.bot = session.dev.bot ? new Bot() : null;

    const seed = session.dev.seed ?? ((Math.random() * 2 ** 31) | 0);
    const w = new World(def.arena, this.data0.tier, seed);
    w.hpMul = this.data0.hpMul ?? 1;
    w.paceMul = this.data0.paceMul ?? 1;
    w.player = new Player(run.loadout, def.arena.playerSpawn.x, def.arena.playerSpawn.y);
    if (session.dev.god) { w.player.maxHp = 99; w.player.hp = 99; }
    def.arena.setup(w);
    w.boss = def.make(w, this.data0.tier);
    w.input = this.kbm.state;
    this.world = w;
    audio.startMusic(def.music);
    audio.setMusicVolume(0.3);
    main.fadeIn(250, 5, 4, 10);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      audio.stopMusic();
      audio.stopLoops();
      this.world.player.weapon.dispose();
    });
    if (import.meta.env.DEV) (window as unknown as { __od: Record<string, unknown> }).__od.world = w;
  }

  update(_time: number, delta: number): void {
    const w = this.world;
    const inp: InputState = this.kbm.state;
    this.kbm.poll(this.cameras.main);
    if (inp.pausePressed && w.state === 'fight') {
      inp.pausePressed = false;
      this.paused = !this.paused;
      audio.setMusicVolume(this.paused ? 0.1 : 0.3);
      audio.loop('arc', false);
    }
    if (this.paused) { this.updatePause(inp); this.render(); return; }

    // intro card: the boss and player wait
    if (w.state === 'intro') {
      this.introT += delta / 1000;
      if (this.introT > 1.9 || (this.introT > 0.4 && (inp.firePressed || inp.dashPressed))) { w.state = 'fight'; w.stateT = 0; }
    }
    this.acc += Math.min(delta, 100) / 1000;
    let steps = 0;
    while (this.acc >= DT && steps < 5) {
      if (this.bot && w.state === 'fight') this.bot.update(w, inp, DT);
      w.step(DT, inp);
      clearEdges(inp);
      this.acc -= DT;
      steps++;
    }
    if (steps === 5) this.acc = 0;
    const lim = session.dev.limit;
    if (lim && w.state === 'fight' && w.time > lim) { w.state = 'lost'; w.stateT = 0; }
    this.render();
    this.checkEnd();
  }

  private render(): void {
    const w = this.world;
    const [sx, sy] = w.fx.shakeOffset();
    this.cameras.main.setScroll(sx, sy);
    const g = this.gfx;
    g.begin();
    w.draw(g);
    drawHud(g, w, sx, sy);
    w.fx.drawFlash(g, W, H);
    if (w.state === 'intro') this.drawIntro();
    if (this.paused) this.drawPause();
    if (w.state === 'won' || w.state === 'lost') this.drawEndBanner();
    g.end();
  }

  private drawIntro(): void {
    const g = this.gfx, w = this.world;
    const t = this.introT;
    const a = Math.min(1, t * 4) * Math.min(1, (1.9 - t) * 4);
    const bt = BOSS_TEXT[w.boss!.id];
    const def = BOSS_DEFS[w.boss!.id]!;
    const slide = (1 - Math.min(1, t * 3)) * 60;
    g.rect(0, 140, W, 82, P.ink, 0.85 * a, 'ui');
    g.rect(0, 140, W, 1, P.red, a, 'ui');
    g.rect(0, 221, W, 1, P.red, a, 'ui');
    if (def.portrait) g.img(def.portrait.key, def.portrait.frame, 150 - slide, 149, { layer: 'ui', ox: 0, oy: 0, alpha: a });
    g.text(UI.fight.replace('{n}', String(this.data0.tier)), 232 + slide, 150, { layer: 'ui', color: P.fog, alpha: a });
    g.text(bt.name, 232 + slide, 166, { layer: 'ui', color: P.white, alpha: a, scale: 2 });
    g.text(bt.en, 232 + slide + bt.name.length * 24 + 10, 176, { layer: 'ui', color: P.red, alpha: a });
    g.text(bt.place, 232 + slide, 196, { layer: 'ui', color: P.sodium, alpha: a });
  }

  private updatePause(inp: InputState): void {
    if (inp.dashPressed || inp.armPressed) { /* swallow */ }
    const kb = this.input.keyboard!;
    const up = Phaser.Input.Keyboard.JustDown(kb.addKey('UP')) || Phaser.Input.Keyboard.JustDown(kb.addKey('W'));
    const down = Phaser.Input.Keyboard.JustDown(kb.addKey('DOWN')) || Phaser.Input.Keyboard.JustDown(kb.addKey('S'));
    const ok = Phaser.Input.Keyboard.JustDown(kb.addKey('ENTER')) || inp.interactPressed || inp.firePressed;
    if (up || down) { this.pauseFocus = 1 - this.pauseFocus; audio.sfx('ui'); }
    // mouse hover
    const py = inp.ay - this.cameras.main.scrollY;
    if (py > 170 && py < 186) this.pauseFocus = 0;
    if (py > 192 && py < 208) this.pauseFocus = 1;
    if (ok) {
      audio.sfx('uiConfirm');
      if (this.pauseFocus === 0) { this.paused = false; audio.setMusicVolume(0.3); }
      else { this.ended = true; session.run = null; goto(this, 'Title'); }
    }
    clearEdges(inp);
  }

  private drawPause(): void {
    const g = this.gfx;
    g.rect(0, 0, W, H, P.ink, 0.7, 'ui');
    g.text(UI.pause, W / 2, 130, { layer: 'ui', align: 'center', scale: 2, color: P.white });
    [UI.resume, UI.abandon].forEach((s, i) => {
      const f = i === this.pauseFocus;
      g.text((f ? '> ' : '  ') + s, W / 2, 172 + i * 22, { layer: 'ui', align: 'center', color: f ? P.cyan : P.fog });
    });
    g.text(UI.controls, W / 2, 330, { layer: 'ui', align: 'center', color: P.slate });
  }

  private drawEndBanner(): void {
    const w = this.world;
    const won = w.state === 'won';
    const a = Math.min(1, w.stateT * 2);
    this.gfx.rect(0, 160, W, 40, P.ink, 0.7 * a, 'ui');
    this.gfx.text(won ? UI.victory : UI.defeat, W / 2, 168, { layer: 'ui', align: 'center', scale: 2, color: won ? P.amber : P.red, alpha: a });
  }

  private checkEnd(): void {
    const w = this.world;
    if (this.ended) return;
    const run = session.run!;
    const rec = (): FightRecord => ({
      boss: w.boss!.id, tier: this.data0.tier, time: w.time, hitsTaken: w.stats.hitsTaken,
      perfectDodges: w.stats.perfectDodges, staggers: w.stats.staggers, envDamage: Math.round(w.stats.envDamage), won: w.state === 'won',
    });
    if (w.state === 'won' && w.stateT > 2.6) {
      this.ended = true;
      const last = isLastFight(run);
      const boss = w.boss!.id;
      session.meta.bossKills[boss] = (session.meta.bossKills[boss] ?? 0) + 1;
      finishFight(run, rec(), w.player.hp);
      if (last) {
        session.meta.wins++;
        const total = run.records.reduce((s, r) => s + r.time, 0);
        const best = session.meta.bestRun[run.loadout.weapon];
        if (!best || total < best) session.meta.bestRun[run.loadout.weapon] = total;
        saveMeta(session.meta);
        goto(this, 'Result', { won: true }, 600);
      } else {
        saveMeta(session.meta);
        goto(this, 'Reward', { beaten: boss }, 600);
      }
    } else if (w.state === 'lost' && w.stateT > 2.2) {
      this.ended = true;
      run.records.push(rec());
      saveMeta(session.meta);
      goto(this, 'Result', { won: false }, 600);
    }
  }
}
