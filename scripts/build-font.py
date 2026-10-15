"""Rebuild the homepage-only WOFF2; requires fonttools and brotli.

python -m pip install --target .tools/fonttools fonttools==4.67.0 brotli==1.2.0
python scripts/build-font.py
"""
from pathlib import Path
import hashlib
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / '.tools/fonttools'))
from fontTools import subset
from fontTools.ttLib import TTFont

source = ROOT / 'resources/fonts/LXGWWenKai-Regular.ttf'
text_source = (ROOT / 'src/lib/heroText.js').read_text(encoding='utf-8')
strings = re.findall(r"export const \w+ = '([^']*)'", text_source)
if len(strings) != 3:
    raise ValueError('Homepage text could not be read; update build-font.py before publishing.')
text = ''.join(chr(n) for n in range(32, 127)) + ''.join(strings)
font = TTFont(source, recalcTimestamp=False)
missing = set(map(ord, text)) - set(font.getBestCmap())
if missing:
    raise ValueError(f'Missing glyphs: {missing}')
options = subset.Options()
options.name_IDs = ['*']
options.name_languages = ['*']
options.hinting = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(text=text)
subsetter.subset(font)
names = {1: 'Portfolio Hero', 2: 'Regular', 3: 'PortfolioHero-Regular', 4: 'Portfolio Hero Regular', 6: 'PortfolioHero-Regular', 16: 'Portfolio Hero', 17: 'Regular'}
for name in font['name'].names:
    if name.nameID in names:
        name.string = names[name.nameID].encode(name.getEncoding())
font.flavor = 'woff2'
output = ROOT / 'src/assets/fonts/portfolio-hero.woff2'
output.parent.mkdir(parents=True, exist_ok=True)
font.save(output)
check = TTFont(output)
assert set(map(ord, text)) <= set(check.getBestCmap())
print(f'{source.stat().st_size:,} bytes -> {output.stat().st_size:,} bytes')
print(f'SHA256: {hashlib.sha256(output.read_bytes()).hexdigest()}')
