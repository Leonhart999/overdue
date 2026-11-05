/** Headless hub check: screenshots of the hub, bench, records, training range. Usage: node tools/cdp-hub.mjs [--port 9334] */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'screenshots', 'cdp');
mkdirSync(SHOTS, { recursive: true });
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1] || 9334);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map(); const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg.result ?? msg.error); pend.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;
const shot = async (n) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${n}.png`), Buffer.from(r.data, 'base64')); };
const key = async (code, key, vk) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: vk }); await sleep(40); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk }); await sleep(120); };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:5174/?hub' });
await sleep(2500);
await ev(`(() => { const w = __od.world; w.player.x = 130; w.player.y = 120; })()`);
await sleep(300);
await shot('hub_1_racks');
// take the blade
await ev(`(() => { const w = __od.world; w.player.x = 192; w.player.y = 100; })()`);
await sleep(200); await key('KeyE', 'e', 69); await sleep(400);
console.log('weapon after E:', await ev(`__od.world.player.loadout.weapon`));
// range: turret on, swing at dummy
await ev(`(() => { const w = __od.world; w.player.x = 470; w.player.y = 200; w.bodies.find(b => b.interactLabel === '开启练习炮台').onInteract(w); })()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1020, y: 380 });
for (let i = 0; i < 12; i++) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1020, y: 380, button: 'left', clickCount: 1 }); await sleep(90); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1020, y: 380, button: 'left', clickCount: 1 }); await sleep(90); }
await shot('hub_2_range');
// bench
await ev(`(() => { const w = __od.world; w.player.x = 110; w.player.y = 322; })()`);
await sleep(200); await key('KeyE', 'e', 69); await sleep(200);
await key('ArrowRight', 'ArrowRight', 39); await key('ArrowDown', 'ArrowDown', 40); await key('ArrowRight', 'ArrowRight', 39); await key('ArrowRight', 'ArrowRight', 39);
await shot('hub_3_bench');
console.log('cyber:', JSON.stringify(await ev(`__od.world.player.loadout.cyber`)));
await key('Escape', 'Escape', 27);
await ev(`(() => { const w = __od.world; w.player.x = 196; w.player.y = 322; })()`);
await sleep(200); await key('KeyE', 'e', 69); await sleep(200);
await shot('hub_4_records');
await key('Escape', 'Escape', 27);
// depart
await ev(`(() => { const w = __od.world; w.player.x = 320; w.player.y = 84; })()`);
await sleep(200); await key('KeyE', 'e', 69); await sleep(3000);
console.log('scene after depart:', await ev(`__od.game.scene.getScenes(true).map(s => s.scene.key).join(',')`), 'weapon', await ev(`__od.session.run?.loadout.weapon`), 'cyber', JSON.stringify(await ev(`__od.session.run?.loadout.cyber`)));
await shot('hub_5_depart');
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors');
process.exit(0);
