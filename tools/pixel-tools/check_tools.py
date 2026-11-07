"""Check conversion output and the installed Pixelorama CLI."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageDraw
from pixel_tools import ROOT, EDITOR, convert, export_palettes, load_palette, local_environment, nearest_colors


class ToolChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='check-', dir=ROOT / 'output')
        cls.folder = Path(cls.temp.name) / '中文 path'
        cls.folder.mkdir()
        cls.source = cls.folder / 'source.png'
        image = Image.new('RGBA', (224, 288))
        draw = ImageDraw.Draw(image)
        draw.ellipse((40, 15, 185, 160), fill=(243, 199, 163, 255))
        draw.polygon([(50, 140), (174, 140), (210, 287), (14, 287)], fill=(25, 40, 80, 255))
        draw.rectangle((48, 60, 174, 74), fill=(45, 226, 245, 255))
        image.save(cls.source)
        cls.original = cls.source.read_bytes()
        cls.target = convert(cls.source, output=cls.folder, progress=lambda _: None)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_palette(self):
        colors = export_palettes()
        self.assertEqual(len(colors), 256)
        self.assertEqual(colors[0]['rgba'], [0, 0, 0, 0])
        native = json.loads((EDITOR.parent / 'pixelorama_data/Palettes/OVERDUE.json').read_text())
        self.assertEqual(len(native['colors']), 256)
        self.assertEqual((native['width'], native['height']), (16, 16))

    def test_size_palette_and_alpha(self):
        with Image.open(self.target) as im:
            self.assertEqual(im.size, (112, 144))
            pixels = np.asarray(im.convert('RGBA'))
        self.assertEqual(set(np.unique(pixels[:, :, 3])), {0, 255})
        allowed = {tuple(c['rgba']) for c in load_palette()}
        self.assertTrue(set(map(tuple, pixels.reshape(-1, 4))).issubset(allowed))
        with Image.open(self.target.with_name(self.target.stem + '_4x.png')) as preview:
            self.assertEqual(preview.size, (448, 576))
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_index_data(self):
        data = json.loads(self.target.with_suffix('.json').read_text())
        self.assertEqual(len(data['pixels']), 112 * 144)
        colors = np.array([c['rgba'] for c in load_palette()], dtype=np.uint8)
        reconstructed = colors[np.array(data['pixels']).reshape(144, 112)]
        with Image.open(self.target) as im:
            np.testing.assert_array_equal(reconstructed, np.asarray(im.convert('RGBA')))

    def test_transparent_and_no_overwrite(self):
        source = self.folder / 'empty.png'
        Image.new('RGBA', (50, 80)).save(source)
        first = convert(source, 20, 30, output=self.folder, progress=lambda _: None)
        original = first.read_bytes()
        second = convert(source, 20, 30, output=self.folder, progress=lambda _: None)
        self.assertNotEqual(first, second)
        self.assertEqual(first.read_bytes(), original)
        with Image.open(second) as im:
            self.assertEqual(im.size, (20, 30))
            self.assertEqual(im.getchannel('A').getextrema(), (0, 0))
        with self.assertRaises(ValueError):
            convert(source, 0, 30)

    def test_full_palette_mapping(self):
        palette = np.array([c['rgba'][:3] for c in load_palette()[1:]], dtype=np.int32)
        rgb = np.tile(palette[None, :, :], (10, 1, 1))
        np.testing.assert_array_equal(nearest_colors(rgb, palette), np.tile(np.arange(255), (10, 1)))

    def test_highest_index_is_opaque(self):
        source = self.folder / 'highest.png'
        last = load_palette()[-1]['rgba']
        Image.new('RGBA', (80, 120), tuple(last)).save(source)
        transformed = np.tile(np.array(last[:3], dtype=np.uint8), (30, 20, 1))
        with patch('pyxelate.Pyx.fit_transform', return_value=transformed):
            target = convert(source, 20, 30, output=self.folder, progress=lambda _: None)
        data = json.loads(target.with_suffix('.json').read_text())
        self.assertEqual(set(data['pixels']), {255})
        with Image.open(target) as im:
            self.assertEqual(set(map(tuple, np.asarray(im).reshape(-1, 4))), {tuple(last)})

    def test_pixelorama_import(self):
        env = local_environment()
        command = [str(EDITOR), '--headless', '--quit', '--', str(self.target), '--size']
        run = subprocess.run(command, cwd=EDITOR.parent, env=env, capture_output=True,
                             timeout=45, creationflags=subprocess.CREATE_NO_WINDOW)
        output = (run.stdout + run.stderr).decode('utf-8', errors='replace')
        (ROOT / 'data/editor-check.log').write_text(output, encoding='utf-8')
        self.assertEqual(run.returncode, 0, output)
        self.assertIn('(112, 144)', output)
        self.assertNotIn('SCRIPT ERROR', output)
        self.assertNotIn('JSON palette import error', output)


if __name__ == '__main__':
    unittest.main(verbosity=2)
