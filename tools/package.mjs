/** Build a self-contained Windows ZIP. No runtime Node/npm dependency is shipped. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (process.platform !== 'win32') throw new Error('The portable Windows package must be assembled on Windows.');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit']);
run(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build']);
const releases = join(root, 'releases');
const name = `OVERDUE-${pkg.version}-windows-portable`;
const stage = join(releases, name);
const zip = stage + '.zip';
mkdirSync(releases, { recursive: true });
// Only replace this generated release folder; never touch project sources or other releases.
if (dirname(stage) !== releases || !name.startsWith('OVERDUE-')) throw new Error('Invalid release path');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
cpSync(join(root, 'dist'), join(stage, 'game'), { recursive: true });
cpSync(join(root, 'tools/release/Start.bat'), join(stage, 'Start.bat'));
cpSync(join(root, 'tools/release/server.ps1'), join(stage, 'server.ps1'));
mkdirSync(join(stage, 'licenses'));
cpSync(join(root, 'node_modules/phaser/LICENSE.md'), join(stage, 'licenses/Phaser.txt'));
cpSync(join(root, 'public/fonts/OFL-fusion-pixel.txt'), join(stage, 'licenses/FusionPixel.txt'));
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]).sort();
}
const digest = createHash('sha256');
for (const file of files(join(stage, 'game'))) {
  digest.update(relative(stage, file).replaceAll('\\', '/'));
  digest.update(readFileSync(file));
}
writeFileSync(join(stage, 'release.json'), JSON.stringify({
  name: 'OVERDUE', version: pkg.version, platform: 'windows', build: digest.digest('hex'),
  builtAt: new Date().toISOString(),
}, null, 2) + '\n');
const instructions = `OVERDUE《逾期》 ${pkg.version} / Windows 便携版

开始游戏
1. 先把整个 ZIP 解压到任意文件夹（支持中文和空格路径）。
2. 双击 Start.bat，游戏会在默认浏览器中打开。
3. 游玩时保留启动窗口，退出后关闭该窗口。

无需安装 Node.js、Python 或开发工具，无需联网。
需要 Windows 10/11、系统自带的 Windows PowerShell，以及支持 WebGL 的新版 Edge 或 Chrome。
不要直接双击 game/index.html，也不要单独移动 game 文件夹内的资源。

操作
WASD 移动 / 鼠标瞄准 / 左键攻击 / 右键特技
空格冲刺 / Q 手臂技能 / E 互动 / Esc 暂停

存档
战绩和设置保存在当前浏览器的本地数据中，包内不含开发者存档。
同一浏览器、同一启动地址会保留战绩；换浏览器、使用隐私模式或清理网站数据会分开或清除记录。
默认地址为 http://127.0.0.1:18746/；端口被占用时会选择后续空闲端口，该地址的存档独立。
本包不保存未完成的战斗进度。

文件
Start.bat       启动入口
server.ps1      仅监听本机的静态文件服务
release.json    版本信息
game/           游戏及本地字体
licenses/       第三方许可证
SHA256SUMS.txt  文件校验值

启动失败时，确认已经完整解压。若电脑策略禁止 PowerShell 脚本，需要在允许运行脚本的个人电脑上启动。
`;
writeFileSync(join(stage, 'README.txt'), '\ufeff' + instructions.replaceAll('\n', '\r\n'));
const sums = files(stage).map(file => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${relative(stage, file).replaceAll('\\', '/')}`).join('\n');
writeFileSync(join(stage, 'SHA256SUMS.txt'), sums + '\n');
// Pass paths via environment variables, so spaces, Unicode and shell metacharacters remain literal.
const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command',
  "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path -LiteralPath $env:OVERDUE_ZIP) { Remove-Item -LiteralPath $env:OVERDUE_ZIP }; [IO.Compression.ZipFile]::CreateFromDirectory($env:OVERDUE_STAGE, $env:OVERDUE_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)"],
{ cwd: root, stdio: 'inherit', env: { ...process.env, OVERDUE_STAGE: stage, OVERDUE_ZIP: zip } });
if (result.error) throw result.error;
if (result.status !== 0 || !existsSync(zip)) throw new Error('ZIP creation failed');
console.log(`\nRelease: ${zip}`);
