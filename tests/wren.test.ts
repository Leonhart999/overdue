import { describe, expect, it } from 'vitest';
import { emptyInput } from '../src/engine/input';
import { BOSS_DEFS } from '../src/game/bosses';
import { Wren } from '../src/game/bosses/wren';
import { diveOf, freeIn, NET_WALLS, PODS, podFront, REAL_WALLS, WREN_POD, WrenBullet, type DiveState } from '../src/game/arenas/divecafe';
import { Hazard } from '../src/game/hazard';
import { newLoadout, WEAPONS, type CyberId, type WeaponId } from '../src/game/loadout';
import { Player } from '../src/game/player';
import { World } from '../src/game/world';
import { Bot } from '../src/game/bot';
import { NullGfx } from '../src/engine/gfx';

function setup(weapon: WeaponId = 'blade', cyber: CyberId[] = []): { w: World; b: Wren; st: DiveState } {
  const def = BOSS_DEFS.wren!;
  const w = new World(def.arena, 1, 7);
  const l = newLoadout(weapon);
  for (const c of cyber) l.cyber.arm = c;
  w.player = new Player(l, def.arena.playerSpawn.x, def.arena.playerSpawn.y);
  def.arena.setup(w);
  const b = def.make(w, 1) as Wren;
  w.boss = b;
  w.state = 'fight';
  return { w, b, st: diveOf(w)! };
}

function steps(w: World, n: number, inp = emptyInput()): void {
  for (let i = 0; i < n; i++) w.step(1 / 60, inp);
}

/** Dive at pod i (stand in front, press E, wait for the switch). */
function dive(w: World, st: DiveState, i: number): void {
  const f = podFront(PODS[i]);
  w.player.x = f.x; w.player.y = f.y;
  const inp = emptyInput();
  inp.interactPressed = true;
  w.step(1 / 60, inp);
  steps(w, 60);
  expect(st.layer).toBe('net');
  expect(st.bodyPod).toBe(i);
}

describe('wren', () => {
  it('layout: pods, her pod, ports and spawns are clear in both layers', () => {
    const def = BOSS_DEFS.wren!;
    for (const p of PODS) {
      const f = podFront(p);
      expect(freeIn(REAL_WALLS, f.x, f.y, 6)).toBe(true);
      expect(freeIn(NET_WALLS, f.x, f.y, 6)).toBe(true);
    }
    const s = def.arena.playerSpawn;
    expect(freeIn(REAL_WALLS, s.x, s.y, 6) && freeIn(NET_WALLS, s.x, s.y, 6)).toBe(true);
    const f = podFront(WREN_POD);
    expect(freeIn(REAL_WALLS, f.x, f.y, 8)).toBe(true);
  });

  it('the autopilot wins with every weapon (god mode, tier 1)', () => {
    for (const weapon of WEAPONS) {
      const { w, b } = setup(weapon);
      w.player.maxHp = w.player.hp = 999;
      const inp = emptyInput(), bot = new Bot(), g = new NullGfx();
      let i = 0;
      for (; i < 300 * 60 && w.state === 'fight'; i++) {
        bot.update(w, inp, 1 / 60);
        w.step(1 / 60, inp);
        if (i % 30 === 0) w.draw(g);
      }
      expect(w.state, `${weapon} after ${i / 60}s, hp ${Math.round(b.hp)}`).toBe('won');
    }
  }, 60000);

  it('layer isolation: a net needle passes through a real-layer player, a net hazard does not hit', () => {
    const { w, st } = setup();
    steps(w, 5);
    const p = w.player;
    const hp = p.hp;
    // needle in the net flying straight through the player
    const nb = w.addBullet(new WrenBullet(p.x - 40, p.y - 11, 300, 0, 'net', st));
    nb.soft = false; nb.r = 3;
    const h = st.addHazard(w, new Hazard({ k: 'circle', x: p.x, y: p.y, r: 30 }, 0.05, 0.3), 'net');
    steps(w, 40);
    expect(p.hp).toBe(hp);
    expect(h.hitsPlayer).toBe(false);
    // the same needle in the real layer hits
    w.addBullet(new WrenBullet(p.x - 40, p.y - 11, 300, 0, 'real', st));
    steps(w, 30);
    expect(p.hp).toBeLessThan(hp);
  });

  it('player hits do not reach bodies in the other layer', () => {
    const { w, b, st } = setup();
    steps(w, 5);
    dive(w, st, 0);
    expect(w.bodies.includes(b.body)).toBe(false);
    const hp = b.hp;
    w.damage(b.body, { dmg: 200, kind: 'blast', x: b.body.x, y: b.body.y - 20, from: 'player' });
    expect(b.hp).toBe(hp);
    // ports are in the net with the player now
    const port = st.ports.find((q) => !q.dead)!;
    expect(w.bodies.includes(port)).toBe(true);
  });

  it('pulling the plug costs a heart and ejects the player at the body pod', () => {
    const { w, b, st } = setup();
    steps(w, 5);
    dive(w, st, 0);
    const hp = w.player.hp;
    w.player.x = 560; w.player.y = 190;
    // put her next to the pod and let her work
    b.body.x = podFront(PODS[0]).x + 10; b.body.y = podFront(PODS[0]).y;
    let warned = false;
    for (let i = 0; i < 60 * 8 && st.layer === 'net'; i++) { steps(w, 1); warned ||= !!st.plug; }
    expect(warned).toBe(true);
    expect(st.layer).toBe('real');
    expect(st.bodyPod).toBe(null);
    expect(w.player.hp).toBe(hp - 1);
    const f = podFront(PODS[0]);
    expect(Math.hypot(w.player.x - f.x, w.player.y - f.y)).toBeLessThan(20);
  });

  it('leaving through another node moves the body there and dodges the pull', () => {
    const { w, st } = setup();
    steps(w, 5);
    dive(w, st, 0);
    const f = podFront(PODS[3]);
    w.player.x = f.x; w.player.y = f.y;
    const inp = emptyInput();
    inp.interactPressed = true;
    w.step(1 / 60, inp);
    steps(w, 30);
    expect(st.layer).toBe('real');
    expect(Math.hypot(w.player.x - f.x, w.player.y - f.y)).toBeLessThan(4);
  });

  it('breaking every port drops the shield (stagger, normal damage) and the ports come back', () => {
    const { w, b, st } = setup();
    steps(w, 5);
    expect(b.shieldUp).toBe(true);
    // shielded: x0.2 and no poise
    let hp = b.hp;
    w.damage(b.body, { dmg: 100, kind: 'blast', x: b.body.x, y: b.body.y - 20, from: 'player', poise: 50 });
    expect(hp - b.hp).toBeCloseTo(20, 5);
    expect(b.poise).toBe(0);
    dive(w, st, 0);
    for (const q of st.ports) w.damage(q, { dmg: 999, kind: 'blast', x: q.x, y: q.y, from: 'player' });
    steps(w, 2);
    expect(st.portsAlive).toBe(0);
    expect(b.shieldUp).toBe(false);
    expect(b.staggered).toBe(true);
    // back in reality: full damage
    st.setPlayerLayer(w, 'real');
    hp = b.hp;
    w.damage(b.body, { dmg: 100, kind: 'blast', x: b.body.x, y: b.body.y - 20, from: 'player' });
    expect(hp - b.hp).toBeGreaterThan(99);
    steps(w, 60 * 13);
    expect(b.shieldUp).toBe(true);
    expect(st.portsAlive).toBe(3);
  });

  it('the jack arm hacks a port across layers', () => {
    const { w, st } = setup('blade', ['arm_jack']);
    steps(w, 5);
    expect(st.layer).toBe('real');
    const port = st.ports[0];
    w.player.x = port.x + 60; w.player.y = port.y + 30;
    const inp = emptyInput();
    inp.ax = port.x; inp.ay = port.y - 12;
    inp.armPressed = true; inp.arm = true;
    w.step(1 / 60, inp);
    inp.armPressed = false;
    steps(w, 40, inp);
    expect(port.dead).toBe(true);
  });

  it('phase 3 swaps layers every 8 s and never leaves anyone inside a wall', () => {
    const { w, b, st } = setup();
    steps(w, 5);
    b.shieldDownT = 30;
    b.hp = b.maxHp * 0.26;
    w.damage(b.body, { dmg: b.maxHp * 0.02, kind: 'blast', x: b.body.x, y: b.body.y - 20, from: 'player' });
    expect(b.phase).toBe(2);
    steps(w, 90);
    expect(st.swapIn).not.toBe(null);
    expect(st.podsOpen).toBe(false);
    const start = st.layer;
    // stand inside a net firewall: the swap must push the player out
    const fw = NET_WALLS[0];
    w.player.x = fw.x + fw.w / 2; w.player.y = fw.y + fw.h / 2;
    if (st.layer === 'net') steps(w, 60 * 8.2);
    w.player.x = fw.x + fw.w / 2; w.player.y = fw.y + fw.h / 2;
    let swapped = 0, last = st.layer;
    for (let i = 0; i < 60 * 17; i++) {
      steps(w, 1);
      if (st.layer !== last) {
        swapped++; last = st.layer;
        expect(freeIn(st.walls[st.layer], w.player.x, w.player.y, 4)).toBe(true);
        expect(freeIn(st.walls[st.layer], b.body.x, b.body.y, 6)).toBe(true);
      }
    }
    expect(swapped).toBeGreaterThanOrEqual(2);
    void start;
  });

  it('skipping the entrance leaves her in place and the fight clean', () => {
    const def = BOSS_DEFS.wren!;
    const w = new World(def.arena, 1, 3);
    w.player = new Player(newLoadout('arc'), def.arena.playerSpawn.x, def.arena.playerSpawn.y);
    def.arena.setup(w);
    const b = def.make(w, 1) as Wren;
    w.boss = b;
    const inp = emptyInput();
    for (let i = 0; i < 70; i++) w.step(1 / 60, inp); // part-way through the entrance
    b.skipIntro();
    expect(b.introDone).toBe(true);
    expect(b.body.x).toBe(def.spawn.x);
    expect(b.body.y).toBe(def.spawn.y);
    expect(b.invuln).toBe(false);
    expect(b.diving).toBe(false);
    w.state = 'fight';
    const hp = b.hp;
    w.damage(b.body, { dmg: 50, kind: 'blast', x: b.body.x, y: b.body.y - 20, from: 'player' });
    expect(b.hp).toBeLessThan(hp);
    const st = diveOf(w)!;
    expect(st.layer).toBe('real');
    expect(st.portsAlive).toBe(3);
  });

  it('a stagger or phase change during a hunt leaves no plug warning behind', () => {
    const { w, b, st } = setup();
    steps(w, 5);
    dive(w, st, 0);
    b.body.x = podFront(PODS[0]).x + 10; b.body.y = podFront(PODS[0]).y;
    for (let i = 0; i < 60 * 5 && !st.plug; i++) steps(w, 1);
    expect(st.plug).not.toBe(null);
    b.stagger(w);
    expect(st.plug).toBe(null);
    steps(w, 60 * 4);
    expect(b.invuln).toBe(false);
  });
});
