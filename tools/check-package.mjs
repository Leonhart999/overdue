/** Exercise the actual ZIP after extraction, without Node on the launcher's PATH. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const zip = join(root, 'releases', `OVERDUE-${pkg.version}-windows-portable.zip`);
assert(existsSync(zip), 'Run npm run package first');
const tempBase = resolve(root, '../../tmp');
mkdirSync(tempBase, { recursive: true });
const temp = mkdtempSync(join(tempBase, 'overdue-package-'));
const extraction = join(temp, '朋友 游戏');
const ps = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const extracted = spawnSync(ps, ['-NoProfile', '-Command',
  "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:OVERDUE_ZIP, $env:OVERDUE_EXTRACT)"],
{ env: { ...process.env, OVERDUE_ZIP: zip, OVERDUE_EXTRACT: extraction }, encoding: 'utf8' });
assert.equal(extracted.status, 0, extracted.stderr);
const folder = join(extraction, readdirSync(extraction)[0]);
for (const line of readFileSync(join(folder, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')) {
  const [hash, file] = line.split('  ');
  assert.equal(createHash('sha256').update(readFileSync(join(folder, file))).digest('hex'), hash, file);
}
assert(!existsSync(join(folder, 'node_modules')));
assert(!existsSync(join(folder, 'src')));
const children = [];
function launch(port) {
  const child = spawn(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(folder, 'server.ps1'), '-NoBrowser', '-StartPort', String(port)], {
    cwd: temp, env: { ...process.env, PATH: join(process.env.SystemRoot, 'System32') }, windowsHide: true,
  });
  child.output = '';
  child.stdout.on('data', b => { child.output += b.toString(); });
  child.stderr.on('data', b => { child.output += b.toString(); });
  children.push(child);
  return child;
}
async function ready(child) {
  for (let i = 0; i < 150; i++) {
    const match = child.output.match(/READY (http:\/\/127\.0\.0\.1:\d+\/)/);
    if (match) return match[1];
    if (child.exitCode !== null) throw new Error(child.output);
    await delay(100);
  }
  throw new Error('Server startup timed out: ' + child.output);
}
function get(port, path, method = 'GET', host = `127.0.0.1:${port}`) {
  return new Promise((res, rej) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers: { Host: host }, timeout: 8000 }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', rej);
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.end();
  });
}
const blocker = createServer((req, res) => res.end('Unrelated service'));
await new Promise(r => blocker.listen(0, '127.0.0.1', r));
const occupied = blocker.address().port;
try {
  const server = launch(occupied);
  const base = await ready(server);
  const port = Number(new URL(base).port);
  assert(port > occupied && port < occupied + 20, 'Must select a free fallback port');
  const page = await get(port, '/');
  assert.equal(page.status, 200);
  const html = page.body.toString('utf8');
  assert(!html.includes('/@vite/client') && !html.includes('./src/main.ts'));
  const script = html.match(/src="([^"]+\.js)"/)[1];
  const font = html.match(/url\('([^']+\.woff2)'\)/)[1];
  for (const [resource, mime] of [[script, 'text/javascript'], [font, 'font/woff2']]) {
    const path = new URL(resource, base).pathname;
    const response = await get(port, path);
    assert.equal(response.status, 200, path);
    assert(response.headers['content-type'].startsWith(mime));
    assert.deepEqual(response.body, readFileSync(join(folder, 'game', path)));
  }
  assert.equal((await get(port, '/missing')).status, 404);
  assert.equal((await get(port, '/%2e%2e/release.json')).status, 403);
  assert.equal((await get(port, '/%2e%2e%5crelease.json')).status, 403);
  assert.equal((await get(port, '/', 'POST')).status, 405);
  assert.equal((await get(port, '/', 'GET', 'other.example')).status, 403);
  const head = await get(port, '/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(Number(head.headers['content-length']), page.body.length);
  const repeat = launch(occupied);
  assert.equal(await ready(repeat), base);
  for (let i = 0; i < 30 && repeat.exitCode === null; i++) await delay(100);
  assert.equal(repeat.exitCode, 0, repeat.output);
  console.log('PASS: ZIP hashes, Unicode/space paths, offline resources, MIME, HEAD, port conflict and repeated launch');

  if (process.argv.includes('--browser')) {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    assert(existsSync(edge), 'Edge not installed');
    const browser = spawn(edge, ['--headless=new', '--remote-debugging-port=0', '--remote-allow-origins=*',
      `--user-data-dir=${join(temp, 'edge-profile')}`, '--window-size=1280,720', '--no-first-run', '--no-default-browser-check',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
    children.push(browser);
    const activePort = join(temp, 'edge-profile', 'DevToolsActivePort');
    for (let i = 0; i < 150 && !existsSync(activePort); i++) await delay(100);
    assert(existsSync(activePort), 'Edge debugging port unavailable');
    const debugPort = readFileSync(activePort, 'utf8').split('\n')[0].trim();
    const tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    const tab = tabs.find(t => t.type === 'page');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let sequence = 0;
    const pending = new Map();
    const errors = [];
    const external = [];
    ws.onmessage = m => {
      const msg = JSON.parse(m.data);
      if (msg.id) {
        const item = pending.get(msg.id);
        if (item) { pending.delete(msg.id); msg.error ? item.reject(msg.error) : item.resolve(msg.result); }
      }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails);
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args);
      if (msg.method === 'Network.requestWillBeSent') {
        const url = msg.params.request.url;
        if (!url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    // Block any remote request: all playable assets must be available inside the ZIP.
    await send('Network.setBlockedURLs', { urls: ['https://*', 'http://*.com/*'] });
    await send('Page.navigate', { url: base });
    for (let i = 0; i < 100; i++) {
      await delay(200);
      if (await evaluate('!!document.querySelector("canvas") && !document.getElementById("loading")')) break;
    }
    assert(await evaluate('!!document.querySelector("canvas") && !document.getElementById("loading")'));
    assert(await evaluate('document.fonts.check("12px FusionPixel")'));
    assert.equal(await evaluate('typeof window.__od'), 'undefined');
    await delay(1200);
    const titleShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(temp, 'title.png'), Buffer.from(titleShot.data, 'base64'));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await delay(2000);
    const hubShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(temp, 'hub.png'), Buffer.from(hubShot.data, 'base64'));
    await evaluate('localStorage.setItem("overdue.package.check", "saved")');
    await send('Page.reload');
    await delay(3500);
    assert.equal(await evaluate('localStorage.getItem("overdue.package.check")'), 'saved');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.deepEqual(external, []);
    console.log('PASS: production browser boot, local font, title/hub, reload persistence, no remote requests or console errors');
    await send('Browser.close');
    ws.close();
  }
  console.log(`Checks and screenshots: ${temp}`);
} finally {
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
  await new Promise(r => blocker.close(r));
}
