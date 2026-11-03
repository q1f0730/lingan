"""v0.28 0112 生成 src/lib/pinyin-table.ts：GB2312 一二级 6763 字 → 常用读音（pypinyin，多音字最多收 3 个读音）。
用法：PYTHONPATH=/workspace/tools/py python3 scripts/pinyin/gen.py"""
from pypinyin import lazy_pinyin, Style
import collections, os
chars = []
for hi in range(0xB0, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            c = bytes([hi, lo]).decode('gb2312')
        except UnicodeDecodeError:
            continue
        chars.append(c)
from pypinyin import pinyin
g = collections.OrderedDict()   # 常用读音
alt = collections.OrderedDict()  # 多音字的其它读音（最多再 2 个，如 重 = chong）
n = 0
for c in chars:
    py = pinyin(c, style=Style.NORMAL, heteronym=True, errors='ignore')
    rs = []
    for s in (py[0] if py else []):
        s = s.lower().replace('ü', 'v')
        if s.isascii() and s.isalpha() and s not in rs:
            rs.append(s)
    if not rs:
        continue
    g.setdefault(rs[0], []).append(c)
    for s in rs[1:3]:
        alt.setdefault(s, []).append(c)
    n += min(3, len(rs))
enc = lambda d: '|'.join(k + ':' + ''.join(v) for k, v in sorted(d.items()))
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'lib', 'pinyin-table.ts')
open(out, 'w', encoding='utf-8').write('// 自动生成（scripts/pinyin/gen.py，pypinyin，GB2312 一二级 6763 字，共 %d 个读音）：读音:字…，| 分隔。不要手改\n// 常用读音\nexport const PINYIN_TABLE =\n  %r;\n// 多音字的其它读音\nexport const PINYIN_ALT =\n  %r;\n' % (n, enc(g), enc(alt)))
print(len(g), len(alt), n)
