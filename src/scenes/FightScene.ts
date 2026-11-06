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
import { applySettings, PauseMenu } from './pauseMenu';
import { session } from './session';
import { goto, H, W } from '../ui/ui';
import { textWidth } from '../ui/crispText';
import { heading, panel, stamp, tagText, tagWidth, txt } from '../ui/kit';

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
  private pause!: PauseMenu;
  private introT = 0;
  private ended = false;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private data0!: FightData;
  private musicOn = false;

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
    w.updateCamera(0, true);
    this.world = w;
    this.warmGlyphs();
    applySettings(w.fx);
    this.pause = new PauseMenu(this, UI.abandon, () => { this.paused = false; audio.setMusicVolume(0.3); }, () => {
      this.paused = false; this.ended = true; session.run = null; goto(this, 'Hub');
    }, w.fx);
    this.musicOn = false;
    this.input.setDefaultCursor('none');
    main.fadeIn(250, 5, 4, 10);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      audio.stopMusic();
      audio.stopLoops();
      this.input.setDefaultCursor('default');
      this.world.player.weapon.dispose();
    });
    if (import.meta.env.DEV) (window as unknown as { __od: Record<string, unknown> }).__od.world = w;
  }

  /**
   * Build the jack-arm glyph textures now (hidden under the fade-in) instead of on the first hack:
   * draw one frame with every body in glyph mode, then build the mirrored variants too.
   */
  private warmGlyphs(): void {
    const w = this.world, b = w.boss!;
    const jam = b.jamT;
    const saved = w.bodies.map((o) => o.glyphUntil);
    b.jamT = 1;
    for (const o of w.bodies) o.glyphUntil = w.time + 1;
    this.gfx.begin();
    w.draw(this.gfx);
    this.gfx.end();
    this.gfx.warmGlyphFlips();
    b.jamT = jam;
    w.bodies.forEach((o, i) => { o.glyphUntil = saved[i]; });
  }

  update(_time: number, delta: number): void {
    const w = this.world;
    const inp: InputState = this.kbm.state;
    this.kbm.poll(this.cameras.main);
    if (!this.musicOn && audio.ctx) {
      this.musicOn = true;
      audio.startMusic(BOSS_DEFS[w.boss!.id]!.music);
      audio.setMusicVolume(0.3);
    }
    if (inp.pausePressed && w.state === 'fight') {
      inp.pausePressed = false;
      this.paused = true;
      this.pause.show();
    }
    if (this.paused) { this.pause.update(inp.ay - this.cameras.main.scrollY); clearEdges(inp); this.render(); return; }

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
      if (!w.frozen) clearEdges(inp);
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
    const [shx, shy] = w.fx.shakeOffset();
    const sx = w.camX + shx, sy = w.camY + shy;
    this.cameras.main.setScroll(sx, sy);
    const g = this.gfx;
    g.begin();
    w.draw(g);
    drawHud(g, w, sx, sy, (f) => this.textures.exists('ico') && this.textures.get('ico').has(f));
    w.fx.drawFlash(g, W, H);
    if (w.state === 'intro') this.drawIntro();
    this.drawPhaseCard();
    this.drawHint();
    if (this.paused) this.pause.draw(this.gfx, UI.controls);
    if (w.state === 'won' || w.state === 'lost') this.drawEndBanner();
    g.end();
  }

  private drawIntro(): void {
    const g = this.gfx, w = this.world;
    const t = this.introT;
    const a = Math.min(1, t * 4) * Math.min(1, (1.9 - t) * 4);
    const bt = BOSS_TEXT[w.boss!.id];
    const def = BOSS_DEFS[w.boss!.id]!;
    const slide = Math.round((1 - Math.min(1, t * 3)) * 60);
    g.rect(0, 140, W, 82, P.ink, 0.85 * a, 'ui');
    g.rect(0, 140, W, 1, P.red, a, 'ui');
    g.rect(0, 221, W, 1, P.red, a, 'ui');
    // tick marks on the rules, every 16 px, sliding in
    for (let x = (slide * 2) % 16; x < W; x += 16) { g.rect(x, 141, 1, 2, P.maroon, a, 'ui'); g.rect(x, 219, 1, 2, P.maroon, a, 'ui'); }
    const boss = w.boss!.id;
    if (this.hasStandee(boss)) {
      // versus card: Echo (faces right) on the left, the boss (faces left) on the right;
      // the standees break out of the band, bottoms on its lower edge
      g.circle(540 + slide, 176, 74, P.red, 0.14 * a, 'ui');
      g.circle(100 - slide, 176, 64, P.cyan, 0.08 * a, 'ui');
      if (this.hasStandee('echo')) g.img('standee', 'echo', 100 - slide, 222, { layer: 'ui', ox: 0.5, oy: 1, alpha: a });
      g.img('standee', boss, 540 + slide, 222, { layer: 'ui', ox: 0.5, oy: 1, alpha: a });
      txt(g, UI.fight.replace('{n}', String(this.data0.tier)), W / 2, 147, { color: P.fog, alpha: a, align: 'center' });
      heading(g, bt.name, W / 2, 162, { alpha: a, align: 'center' });
      const en = bt.en.toUpperCase();
      tagText(g, en, W / 2, 191, { color: P.red, alpha: a, align: 'center', spacing: 2 });
      const ew = tagWidth(en, 2);
      g.rect(W / 2 - ew / 2 - 22, 193, 14, 1, P.red, a, 'ui');
      g.rect(W / 2 + ew / 2 + 8, 193, 14, 1, P.red, a, 'ui');
      txt(g, bt.place, W / 2, 202, { color: P.sodium, alpha: a, align: 'center' });
      return;
    }
    if (def.portrait) g.img(def.portrait.key, def.portrait.frame, 150 - slide, 149, { layer: 'ui', ox: 0, oy: 0, alpha: a });
    txt(g, UI.fight.replace('{n}', String(this.data0.tier)), 232 + slide, 150, { color: P.fog, alpha: a });
    heading(g, bt.name, 232 + slide, 166, { alpha: a });
    tagText(g, bt.en.toUpperCase(), 232 + slide + textWidth(bt.name, { scale: 2 }) + 10, 181, { color: P.red, alpha: a, spacing: 2 });
    txt(g, bt.place, 232 + slide, 196, { color: P.sodium, alpha: a });
  }

  private seenPhase = 0;
  private phaseCardT = 0;

  private drawPhaseCard(): void {
    const w = this.world, b = w.boss!;
    if (b.phase !== this.seenPhase) { this.seenPhase = b.phase; if (b.phase > 0 && !b.dying) this.phaseCardT = 1.3; }
    if (this.phaseCardT <= 0) return;
    this.phaseCardT -= this.game.loop.delta / 1000;
    const frame = this.hasStandee(`${b.id}_p2`) ? `${b.id}_p2` : this.hasStandee(b.id) ? b.id : null;
    if (!frame) return;
    const t = 1.3 - this.phaseCardT;
    const a = Math.min(1, t * 5, this.phaseCardT * 4);
    const slide = Math.round((1 - Math.min(1, t * 4)) * 80);
    const g = this.gfx;
    g.rect(470 + slide, 244, 170, 116, P.ink, 0.6 * a, 'ui');
    g.rect(470 + slide, 244, 2, 116, P.red, a, 'ui');
    g.rect(470 + slide, 244, 170, 1, P.red, a, 'ui');
    g.circle(570 + slide, 300, 60, P.red, 0.15 * a, 'ui');
    g.img('standee', frame, 572 + slide, H, { layer: 'ui', ox: 0.5, oy: 1, alpha: a });
    tagText(g, `PHASE ${String(b.phase + 1).padStart(2, '0')}`, 480 + slide, 250, { color: P.red, alpha: a, spacing: 2 });
    g.crisp(`第 ${b.phase + 1} 阶段`, 480 + slide, 260, { color: P.white, outline: P.ink, alpha: a });
  }

  private hasStandee(frame: string): boolean {
    return this.textures.exists('standee') && this.textures.get('standee').has(frame);
  }

  private drawHint(): void {
    const w = this.world;
    const hint = BOSS_DEFS[w.boss!.id]?.hint;
    if (!hint || w.state !== 'fight' || w.stateT > 9 || this.paused) return;
    if ((session.meta.bossKills[w.boss!.id] ?? 0) >= 2) return;
    const a = Math.min(1, w.stateT * 2, (9 - w.stateT) * 1.5);
    const g = this.gfx;
    const tag = 'TIP';
    const tw = textWidth(hint) + tagWidth(tag) + 30;
    const x = Math.round(W / 2 - tw / 2), y = H - 22;
    panel(g, x, y, tw, 18, { accent: P.amber, cut: 3, scan: false, alpha: 0.9 * a });
    tagText(g, tag, x + 10, y + 7, { color: P.amber, alpha: a });
    txt(g, hint, x + 20 + tagWidth(tag), y + 3, { color: P.amber, alpha: a });
  }

  private drawEndBanner(): void {
    const w = this.world;
    const won = w.state === 'won';
    const a = Math.min(1, w.stateT * 2);
    const g = this.gfx;
    g.rect(0, 150, W, 60, P.ink, 0.7 * a, 'ui');
    g.rect(0, 150, W, 1, won ? P.orange : P.red, a, 'ui');
    g.rect(0, 209, W, 1, won ? P.orange : P.red, a, 'ui');
    // the verdict stamp slams down: x2 for the first frames, then x1
    const slam = w.stateT < 0.12;
    stamp(g, won ? UI.victory : UI.defeat, W / 2, 180, { color: won ? P.orange : P.red, angle: -6, glyph: 3, scale: slam ? 2 : 1, alpha: slam ? 0.5 * a : a, seed: won ? 5 : 9 });
  }

  private checkEnd(): void {
    const w = this.world;
    if (this.ended) return;
    const run = session.run!;
    const rec = (): FightRecord => ({
      boss: w.boss!.id, tier: this.data0.tier, time: w.time, hitsTaken: w.stats.hitsTaken,
      perfectDodges: w.stats.perfectDodges, staggers: w.stats.staggers, envDamage: Math.round(w.stats.envDamage), won: w.state === 'won',
    });
    if (run.practice && ((w.state === 'won' && w.stateT > 2.6) || (w.state === 'lost' && w.stateT > 2.2))) {
      this.ended = true;
      session.run = null;
      goto(this, 'Hub', undefined, 600);
      return;
    }
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
