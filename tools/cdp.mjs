/**
 * Headless client check over the Chrome DevTools Protocol (Node 22+: built-in WebSocket + fetch).
 *
 *   1. npm run dev                      (port 5174)
 *   2. msedge --headless=new --remote-debugging-port=9334 --user-data-dir=D:/AI/tmp/edge-od
 *        --window-size=1280,720 --use-angle=swiftshader --enable-unsafe-swiftshader about:blank
 *   3. node tools/cdp.mjs [--port 9334] [--boss gearjaw] [--weapons riveter,arc] [--secs 20] [--flow]
 *
 * For each weapon: loads ?boss=..&weapon=..&bot&god, lets the bot fight, takes screenshots and
 * reports boss HP, console errors and exceptions. --flow also walks title -> select -> fight -> reward.
 * Screenshots: screenshots/cdp/.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'cdp');
mkdirSync(SHOTS, { recursive: true });
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(arg('port', 9334));
const BASE = arg('url', 'http://127.0.0.1:5174/');
const BOSS = arg('boss', 'gearjaw');
const WEAPONS = arg('weapons', 'riveter,arc,breacher,blade').split(',');
const SECS = Number(arg('secs', 20));
const EXTRA = arg('extra', '');
const FLOW = args.includes('--flow');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
let page = pages.find((p) => p.type === 'page');
if (!page) page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert')) {
    errors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    errors.push(`${d.exception?.description ?? d.text} @${d.url ?? ''}:${d.lineNumber}`);
  }
};
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = join(SHOTS, `${name}.png`);
  writeFileSync(f, Buffer.from(r.data, 'base64'));
  return f;
}
async function key(code, keyName, vk) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(50);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(150);
}
const ENTER = () => key('Enter', 'Enter', 13);

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

const STATE = `(() => { const w = window.__od?.world; if (!w) return null; return { state: w.state, t: Math.round(w.time), hp: w.player.hp, boss: Math.round(w.boss.hp), max: w.boss.maxHp, phase: w.boss.phase, bullets: w.bullets.length, bodies: w.bodies.length, scene: window.__od.game.scene.getScenes(true).map(s => s.scene.key).join(',') }; })()`;

for (const weapon of WEAPONS) {
  const url = `${BASE}?boss=${BOSS}&weapon=${weapon}&bot&god&seed=7${EXTRA ? '&' + EXTRA : ''}`;
  await send('Page.navigate', { url });
  await sleep(2500);
  const shotsAt = [3, Math.round(SECS / 2), SECS];
  let last = 0;
  for (const s of shotsAt) {
    await sleep((s - last) * 1000);
    last = s;
    await shot(`${BOSS}_${weapon}_${s}s`);
  }
  const st = await ev(STATE);
  console.log(weapon, JSON.stringify(st));
}

if (FLOW) {
  await send('Page.navigate', { url: `${BASE}?bot&god&seed=3` });
  await sleep(2500);
  await shot('flow_1_title');
  await ENTER();
  await sleep(600);
  await shot('flow_2_select');
  await key('ArrowDown', 'ArrowDown', 40);
  await ENTER();
  await sleep(2500);
  await shot('flow_3_fight');
  // fast-forward: kill the boss
  await ev(`(() => { const w = window.__od.world; w.boss.hp = 1; w.damage(w.boss.parts[0], { dmg: 50, kind: 'bullet', x: w.boss.x, y: w.boss.y - 30, from: 'player' }); })()`);
  await sleep(4500);
  await shot('flow_4_reward');
  console.log('flow scene:', await ev(`window.__od.game.scene.getScenes(true).map(s => s.scene.key).join(',')`));
  await ENTER();
  await sleep(800);
  await shot('flow_5_after_pick');
  await ENTER();
  await sleep(2500);
  await shot('flow_6_next');
  console.log('flow scene:', await ev(`window.__od.game.scene.getScenes(true).map(s => s.scene.key).join(',')`));
}

console.log(errors.length ? `ERRORS (${errors.length}):\n` + [...new Set(errors)].join('\n') : 'no console errors');
ws.close();
process.exit(0);
