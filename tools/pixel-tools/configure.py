"""Write first-run Pixelorama settings without overwriting later user changes."""
from pathlib import Path
from pixel_tools import ROOT, export_palettes

export_palettes()
folder = ROOT / 'data/roaming/pixelorama'
folder.mkdir(parents=True, exist_ok=True)
config = folder / 'config.ini'
if not config.exists():
    config.write_text('''[preferences]
locale="zh_CN"
default_width=112
default_height=144
startup=false

[data]
last_palette="OVERDUE"
''', encoding='utf-8')
