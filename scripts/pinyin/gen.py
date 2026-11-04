"""v0.28 0112 生成 src/lib/pinyin-table.ts：GB2312 一二级 6763 字 → 常用读音（pypinyin，多音字最多收 3 个读音）。
v0.35 改成紧凑编码（31KB → 约 18.5KB）：字不再直接写汉字（UTF-8 每字 3 字节），写它在 GB2312 一二级里的序号；
每个读音下的序号排好序，记「和上一个的间隔 - 1」，用 52 个结尾符 + 34 个前缀符的变长数字。运行时用 TextDecoder('gbk') 还原 6763 个字。
用法：PYTHONPATH=/workspace/tools/py python3 scripts/pinyin/gen.py"""
from pypinyin import pinyin, Style
import collections, os
chars = []
for hi in range(0xB0, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            c = bytes([hi, lo]).decode('gb2312')
        except UnicodeDecodeError:
            continue
        chars.append(c)
assert len(chars) == 6763
idx = {c: i for i, c in enumerate(chars)}
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
# 必须和 src/lib/pinyin.ts 的 DIGITS / NT 一致
DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./;<=>?@[]^_{}~'
NT = 52
T, C = DIGITS[:NT], DIGITS[NT:]
def num(v):
    out = T[v % NT]
    q = v // NT
    while q:
        out = C[q % len(C)] + out
        q //= len(C)
    return out
def enc(d):
    parts = []
    for k, v in sorted(d.items()):
        prev, s = -1, ''
        for i in sorted(idx[c] for c in v):
            s += num(i - prev - 1)
            prev = i
        parts.append(k + ':' + s)
    return '|'.join(parts)
out = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'lib', 'pinyin-table.ts')
# v0.42 瘦身：两段字表用 \n 接起来 → zlib deflate(9) → base64（运行时 DecompressionStream 解，见 src/lib/inflate.ts）
import zlib, base64
z = base64.b64encode(zlib.compress((enc(g) + '\n' + enc(alt)).encode(), 9)).decode()
open(out, 'w', encoding='utf-8').write('// 自动生成（scripts/pinyin/gen.py，pypinyin，GB2312 一二级 6763 字，共 %d 个读音）：读音:GB2312 序号间隔的变长编码，| 分隔；常用读音 \\n 多音字的其它读音，deflate + base64。不要手改\nexport const PINYIN_Z =\n  %s;\n' % (n, repr(z)))
print(len(g), len(alt), n)
