"""Local Pyxelate front end using OVERDUE's palette and frame sizes."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
EDITOR = ROOT / 'Pixelorama' / 'Pixelorama-Windows-64bit' / 'Pixelorama.exe'


def load_palette():
    source = (PROJECT / 'src/art/palette.ts').read_text(encoding='utf-8-sig')
    block = source.split('export const PALETTE: PaletteEntry[] = [', 1)[1].split('];', 1)[0]
    colors = []
    for index, (name, color) in enumerate(re.findall(r"name:\s*'([^']+)',\s*hex:\s*'(#[0-9a-fA-F]{6})'", block)):
        rgb = [int(color[i:i+2], 16) for i in (1, 3, 5)]
        colors.append(dict(index=index, name=name, hex=color, rgba=rgb + [0 if index == 0 else 255]))
    if not 2 <= len(colors) <= 256 or colors[0]['name'] != 'clear':
        raise ValueError('Expected 1-255 opaque colors and transparent index 0 in palette.ts')
    if len({c['hex'].lower() for c in colors}) != len(colors):
        raise ValueError('Palette colors must be unique.')
    if len({c['name'] for c in colors}) != len(colors):
        raise ValueError('Palette names must be unique.')
    return colors


def export_palettes():
    colors = load_palette()
    folder = ROOT / 'palettes'
    folder.mkdir(exist_ok=True)
    (folder / 'overdue.json').write_text(json.dumps(colors, indent=2) + '\n', encoding='utf-8')
    columns = 16 if len(colors) > 64 else 8
    gpl = ['GIMP Palette', 'Name: OVERDUE', f'Columns: {columns}',
           f'# {len(colors)-1} opaque colors; transparency is separate.']
    for entry in colors[1:]:
        r, g, b, _ = entry['rgba']
        gpl.append(f"{r:3} {g:3} {b:3} {entry['name']}")
    (folder / 'OVERDUE.gpl').write_text('\n'.join(gpl) + '\n', encoding='utf-8')
    from PIL import Image, ImageDraw
    rows = (len(colors) + columns - 1) // columns
    rgba = bytes(channel for color in colors for channel in color['rgba'])
    rgba += bytes((columns * rows - len(colors)) * 4)
    swatches = Image.frombytes('RGBA', (columns, rows), rgba)
    swatches.save(folder / 'OVERDUE-swatch.png')
    preview = Image.new('RGB', (columns * 32, rows * 32 + 40), '#161528')
    draw = ImageDraw.Draw(preview)
    draw.text((8, 12), f"OVERDUE / {len(colors)-1} colors + transparency", fill='#ccd2ea')
    for color in colors:
        i = color['index']
        x, y = (i % columns) * 32, (i // columns) * 32 + 40
        if i == 0:
            for dy in range(0, 32, 8):
                for dx in range(0, 32, 8):
                    shade = '#63679a' if (dx + dy) % 16 == 0 else '#444474'
                    draw.rectangle((x+dx, y+dy, x+dx+7, y+dy+7), fill=shade)
        else:
            draw.rectangle((x, y, x+31, y+31), fill=color['hex'])
        r, g, b, _ = color['rgba']
        ink = '#0b0a12' if 0.2126*r + 0.7152*g + 0.0722*b > 145 else '#f5f6ff'
        draw.text((x+3, y+17), str(i), fill=ink)
    preview.save(folder / 'OVERDUE-preview.png')
    native = dict(width=columns, height=(len(colors) + columns - 1) // columns,
                  comment=f'OVERDUE: transparent + {len(colors)-1} colors from src/art/palette.ts', colors=[
        dict(index=c['index'], color='(' + ', '.join(f'{v / 255:.8f}' for v in c['rgba']) + ')') for c in colors
    ])
    target = ROOT / 'Pixelorama/Pixelorama-Windows-64bit/pixelorama_data/Palettes'
    if target.exists():
        (target / 'OVERDUE.json').write_text(json.dumps(native, indent=2) + '\n', encoding='utf-8')
    return colors


def local_environment():
    env = dict(os.environ)
    paths = {'APPDATA': ROOT / 'data/roaming', 'LOCALAPPDATA': ROOT / 'data/local',
             'TEMP': ROOT / 'data/temp', 'TMP': ROOT / 'data/temp'}
    for key, path in paths.items():
        path.mkdir(parents=True, exist_ok=True)
        env[key] = str(path)
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    return env


def open_editor(image=None):
    if not EDITOR.exists():
        raise FileNotFoundError('Pixelorama is missing. Run Install.ps1.')
    export_palettes()
    command = [str(EDITOR)]
    if image:
        command += ['--', str(Path(image).resolve())]
    subprocess.Popen(command, cwd=EDITOR.parent, env=local_environment(), creationflags=subprocess.CREATE_NO_WINDOW)


def nearest_colors(rgb, palette):
    """Map to palette indices in small batches rather than allocating a full image x palette cube."""
    import numpy as np
    flat = np.asarray(rgb, dtype=np.int32).reshape(-1, 3)
    palette = np.asarray(palette, dtype=np.int32)
    indices = np.empty(len(flat), dtype=np.uint8)
    for start in range(0, len(flat), 2048):
        chunk = flat[start:start+2048]
        delta = chunk[:, None, :] - palette[None, :, :]
        distance = np.sum(delta * delta, axis=2, dtype=np.int32)
        indices[start:start+len(chunk)] = distance.argmin(axis=1)
    return indices.reshape(rgb.shape[:2])


def convert(source, width=112, height=144, fit='contain', dither='none', output=None, progress=print):
    from PIL import Image, ImageOps
    import numpy as np
    from pyxelate import Pal, Pyx

    if not (8 <= width <= 512 and 8 <= height <= 512):
        raise ValueError('Width and height must be between 8 and 512.')
    colors = export_palettes()
    source = Path(source).resolve()
    with Image.open(source) as original:
        original.load()
        image = ImageOps.exif_transpose(original).convert('RGBA')
    # Work on a bounded image. Preserve the silhouette's alpha separately from color fitting.
    work_size = (width * 4, height * 4)
    if fit == 'cover':
        work = ImageOps.fit(image, work_size, Image.Resampling.LANCZOS)
    else:
        fitted = ImageOps.contain(image, work_size, Image.Resampling.LANCZOS)
        work = Image.new('RGBA', work_size)
        # Portraits are anchored to their bottom edge in the game.
        work.alpha_composite(fitted, ((work.width - fitted.width) // 2, work.height - fitted.height))
    alpha = np.asarray(work.getchannel('A').resize((width, height), Image.Resampling.BOX)) >= 153
    palette = np.array([c['rgba'][:3] for c in colors[1:]], dtype=np.int32)
    if not alpha.any():
        result = np.zeros((height, width, 4), dtype=np.uint8)
        indices = np.zeros((height, width), dtype=np.uint8)
    else:
        matte = Image.new('RGBA', work_size, tuple(colors[1]['rgba']))
        matte.alpha_composite(work)
        progress('正在转换，首次运行需要编译像素算法…')
        transformer = Pyx(width=width, height=height, palette=Pal.from_hex([c['hex'] for c in colors[1:]]),
                          dither=dither, svd=False)
        # Keep palette fitting bounded when using the full 8-bit palette.
        if len(palette) > 64:
            transformer.BGM_RESIZE = 64
        pixels = transformer.fit_transform(np.asarray(matte.convert('RGB')))
        if np.issubdtype(pixels.dtype, np.floating):
            pixels = np.rint(pixels * 255)
        rgb = np.asarray(pixels[:, :, :3], dtype=np.int32)
        # Enforce exact palette bytes, including any upstream floating point rounding.
        closest = nearest_colors(rgb, palette)
        indices = np.where(alpha, closest.astype(np.uint16) + 1, 0).astype(np.uint8)
        result = np.zeros((height, width, 4), dtype=np.uint8)
        result[:, :, :3] = palette[closest]
        result[:, :, 3] = np.where(alpha, 255, 0)
        result[~alpha, :3] = 0
    folder = Path(output).resolve() if output else ROOT / 'output'
    folder.mkdir(parents=True, exist_ok=True)
    name = f'{source.stem}_{width}x{height}'
    suffix = 1
    while any((folder / f'{name}{ext}').exists() for ext in ('.png', '.json', '_4x.png')):
        suffix += 1
        name = f'{source.stem}_{width}x{height}_{suffix}'
    target = folder / f'{name}.png'
    out = Image.fromarray(result)
    out.save(target)
    out.resize((width * 4, height * 4), Image.Resampling.NEAREST).save(folder / f'{name}_4x.png')
    data = dict(width=width, height=height, palette='OVERDUE', colors=[c['hex'] for c in colors],
                transparentIndex=0, pixels=indices.reshape(-1).tolist())
    (folder / f'{name}.json').write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf-8')
    progress(f'已保存：{target.name}')
    return target


def gui(initial=None):
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
    from PIL import Image, ImageOps, ImageTk

    window = tk.Tk()
    window.title('OVERDUE · 图片转像素')
    window.geometry('900x730')
    window.minsize(800, 700)
    window.configure(bg='#161528')
    style = ttk.Style()
    style.theme_use('clam')
    style.configure('.', font=('Microsoft YaHei UI', 10), background='#161528', foreground='#ccd2ea')
    style.configure('TButton', background='#2f2d58', padding=8)
    style.configure('TEntry', fieldbackground='#22213f', foreground='#f5f6ff')
    style.configure('TCombobox', fieldbackground='#22213f', foreground='#f5f6ff')
    body = ttk.Frame(window, padding=20)
    body.pack(fill='both', expand=True)
    ttk.Label(body, text='图片转像素', font=('Microsoft YaHei UI', 19, 'bold'), foreground='#2de2f5').pack(anchor='w')
    ttk.Label(body, text=f'OVERDUE 色板 · {len(load_palette())-1} 色 + 透明').pack(anchor='w', pady=(2, 14))
    path = tk.StringVar(value=initial or '')
    status = tk.StringVar(value='选择图片开始；透明 PNG 会保留透明背景。')
    row = ttk.Frame(body)
    row.pack(fill='x')
    entry = ttk.Entry(row, textvariable=path)
    entry.pack(side='left', fill='x', expand=True)
    canvases = []
    photos = {}
    def show_image(canvas, file):
        with Image.open(file) as opened:
            image = ImageOps.exif_transpose(opened).convert('RGBA')
            ratio = min(350 / image.width, 365 / image.height)
            image = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
                                 Image.Resampling.NEAREST)
        photo = ImageTk.PhotoImage(image)
        photos[canvas] = photo
        canvas.delete('preview')
        canvas.create_image(180, 190, image=photo, tags='preview')
    def choose():
        file = filedialog.askopenfilename(title='选择原图', filetypes=[('图片', '*.png *.jpg *.jpeg *.webp *.bmp'), ('所有文件', '*.*')])
        if file:
            path.set(file)
            try: show_image(canvases[0], file)
            except Exception as exc: messagebox.showerror('无法打开图片', str(exc))
    ttk.Button(row, text='选择图片', command=choose).pack(side='left', padx=(8, 0))
    options = ttk.Frame(body)
    options.pack(fill='x', pady=14)
    preset = tk.StringVar(value='立绘 112 × 144')
    width, height = tk.StringVar(value='112'), tk.StringVar(value='144')
    combo = ttk.Combobox(options, textvariable=preset, width=19, state='readonly', values=['立绘 112 × 144', '主角精灵 20 × 30', '齿颚精灵 96 × 96', '自定义'])
    combo.pack(side='left')
    def select_preset(_):
        sizes = {'立绘 112 × 144': (112, 144), '主角精灵 20 × 30': (20, 30), '齿颚精灵 96 × 96': (96, 96)}
        if preset.get() in sizes:
            w, h = sizes[preset.get()]
            width.set(str(w)); height.set(str(h))
    combo.bind('<<ComboboxSelected>>', select_preset)
    ttk.Entry(options, textvariable=width, width=5).pack(side='left', padx=(12, 4))
    ttk.Label(options, text='×').pack(side='left')
    ttk.Entry(options, textvariable=height, width=5).pack(side='left', padx=(4, 12))
    fit = tk.StringVar(value='保留全图')
    ttk.Combobox(options, textvariable=fit, state='readonly', width=10, values=['保留全图', '居中裁切']).pack(side='left')
    dither = tk.StringVar(value='none')
    ttk.Label(options, text='  抖动').pack(side='left')
    ttk.Combobox(options, textvariable=dither, state='readonly', width=9, values=['none', 'bayer', 'naive']).pack(side='left', padx=(4, 0))
    preview = ttk.Frame(body)
    preview.pack(fill='both', expand=True)
    for index, title in enumerate(['原图', '转换结果']):
        frame = ttk.Frame(preview)
        frame.pack(side='left', fill='both', expand=True, padx=(0, 10) if index == 0 else (10, 0))
        ttk.Label(frame, text=title).pack(anchor='w', pady=(0, 6))
        canvas = tk.Canvas(frame, width=360, height=380, bg='#22213f', highlightthickness=0)
        canvas.pack(expand=True)
        for y in range(0, 380, 16):
            for x in range(0, 360, 16):
                if (x // 16 + y // 16) % 2 == 0:
                    canvas.create_rectangle(x, y, x+16, y+16, fill='#2f2d58', outline='')
        canvases.append(canvas)
    messages = queue.Queue()
    result = [None]
    def work(source, w, h, layout, dithering):
        try: messages.put(('done', convert(source, w, h, layout, dithering, progress=lambda text: messages.put(('status', text)))))
        except Exception as exc: messages.put(('error', str(exc)))
    def run():
        try:
            if not Path(path.get()).is_file(): raise ValueError('请先选择一张图片。')
            w, h = int(width.get()), int(height.get())
            if not (8 <= w <= 512 and 8 <= h <= 512): raise ValueError('宽和高需在 8–512 之间。')
            show_image(canvases[0], path.get())
        except Exception as exc:
            messagebox.showerror('检查输入', str(exc)); return
        button.configure(state='disabled')
        status.set('正在加载转换引擎…')
        threading.Thread(target=work, args=(path.get(), w, h, 'cover' if fit.get() == '居中裁切' else 'contain', dither.get()), daemon=True).start()
    def edit():
        try: open_editor(result[0])
        except Exception as exc: messagebox.showerror('无法启动编辑器', str(exc))
    controls = ttk.Frame(body)
    controls.pack(fill='x', pady=(14, 0))
    button = ttk.Button(controls, text='转换并保存', command=run)
    button.pack(side='left')
    ttk.Button(controls, text='用 Pixelorama 精修', command=edit).pack(side='left', padx=10)
    ttk.Button(controls, text='打开输出目录', command=lambda: os.startfile(ROOT / 'output')).pack(side='left')
    ttk.Label(body, textvariable=status, wraplength=820).pack(anchor='w', pady=(12, 0))
    def poll():
        while not messages.empty():
            kind, value = messages.get_nowait()
            if kind == 'status': status.set(value)
            else:
                button.configure(state='normal')
                if kind == 'done':
                    result[0] = value
                    status.set(f'已保存：{value.name}')
                    show_image(canvases[1], value)
                else:
                    status.set('转换失败')
                    messagebox.showerror('转换失败', value)
        window.after(100, poll)
    if initial:
        try: show_image(canvases[0], initial)
        except Exception: pass
    window.after(100, poll)
    window.mainloop()


def main():
    parser = argparse.ArgumentParser(description='Convert images using the OVERDUE palette.')
    parser.add_argument('image', nargs='?')
    parser.add_argument('--gui', action='store_true')
    parser.add_argument('--editor', action='store_true')
    parser.add_argument('--export-palette', action='store_true')
    parser.add_argument('--width', type=int, default=112)
    parser.add_argument('--height', type=int, default=144)
    parser.add_argument('--fit', choices=['contain', 'cover'], default='contain')
    parser.add_argument('--dither', choices=['none', 'bayer', 'naive'], default='none')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    os.environ.update(local_environment())
    export_palettes()
    if args.export_palette: return
    if args.editor: open_editor(args.image)
    elif args.gui or not args.image: gui(args.image)
    else: print(convert(args.image, args.width, args.height, args.fit, args.dither, args.output))


if __name__ == '__main__':
    main()
