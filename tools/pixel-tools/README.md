# OVERDUE 图片工具

已部署 Pyxelate 自动转换和 Pixelorama 1.2.4 可视化编辑器。

## 使用

- 双击上一级的 `PixelTools.bat`：选图，调整尺寸，点击“转换并保存”。也可以把图片拖到这个 BAT 上。
- 默认尺寸 112×144，色板取自游戏源码，抖动默认关闭。保留全图会等比缩放、水平居中、底部对齐；居中裁切会填满画布。
- 转换后点“用 Pixelorama 精修”。也可以双击上一级的 `Pixelorama.bat`，或把图片拖到该入口。
- 编辑器默认中文、112×144 画布，色板选中 OVERDUE。
- 原图有透明背景时会保留透明轮廓；工具不会自动把照片背景抠掉。

## 输出

`output/` 内保存原尺寸 PNG、4 倍预览 PNG 和游戏色板索引 JSON。
PNG 使用游戏的 255 种不透明颜色，透明度仅为 0 或 255。索引 0 为透明，1–255 与 `src/art/palette.ts` 一致。
重复转换会生成新文件，不覆盖原图或已有输出。
这些文件不会自动替换游戏立绘；游戏仍使用代码生成的素材。

## 命令行

在本目录运行：

```powershell
.\.venv\Scripts\python.exe .\pixel_tools.py "D:\Art\portrait.png"
.\.venv\Scripts\python.exe .\pixel_tools.py "D:\Art\portrait.png" --width 96 --height 96 --fit cover
.\.venv\Scripts\python.exe .\pixel_tools.py --export-palette
.\.venv\Scripts\python.exe .\check_tools.py
```

`palettes/OVERDUE.gpl` 可在其他像素编辑器中导入。
色板预览为 `palettes/OVERDUE-preview.png`，纯色样本为 `palettes/OVERDUE-swatch.png`。
每次启动工具都会从游戏源码同步色板。Pixelorama 的原生色板放在其 `pixelorama_data/Palettes/OVERDUE.json`。

## 路径与维护

环境、第三方源码、下载缓存、编辑器设置和作品均位于本目录；游戏分享包不会包含它们。
启动器使用自身位置解析路径，不要求从特定工作目录启动。
本地 Python 环境绑定其安装位置；若移动项目，需要安装 Python 3.12 和 Git，再在本目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1 -RebuildEnvironment
```

安装过程需要联网，日常转换和编辑无需联网。安装时优先保留已有环境和用户设置。
`toolchain.json` 记录上游来源、固定版本和官方安装包 SHA256；`requirements.lock.txt` 记录 Python 依赖版本。
Pyxelate 与 Pixelorama 均采用 MIT 许可证，副本在 `licenses/`。

色板现为 255 种不透明颜色＋透明色，旧编号 0–32 保持兼容。新颜色按肤色、金属、布料和光照色阶排列，编辑器以 16×16 网格显示。色板更新后请重新打开转换工具和编辑器。
