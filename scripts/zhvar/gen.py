"""v0.41 0134 繁简互搜：生成 src/lib/zhvar-table.ts。
数据来自 OpenCC 的 STCharacters.txt（Apache-2.0，opencc-python-reimplemented 自带，装在 /workspace/tools/py）。
只收「简体字在 GB2312 一二级 6763 字里、繁体字在 BMP 汉字区、且和简体不同」的对。
编码同 pinyin-table：简体字记 GB2312 序号间隔（变长，DIGITS / NT 与 src/lib/pinyin.ts 一致），后面直接跟它的繁体字（非 ASCII，天然分隔）。
用法：PYTHONPATH=/workspace/tools/py python3 scripts/zhvar/gen.py"""
import os, opencc
chars = []
for hi in range(0xB0, 0xF8):
    for lo in range(0xA1, 0xFF):
        try:
            chars.append(bytes([hi, lo]).decode('gb2312'))
        except UnicodeDecodeError:
            pass
assert len(chars) == 6763
idx = {c: i for i, c in enumerate(chars)}
src = os.path.join(os.path.dirname(opencc.__file__), 'dictionary', 'STCharacters.txt')
m = {}
for line in open(src, encoding='utf-8'):
    if '\t' not in line: continue
    s, ts = line.rstrip('\n').split('\t')
    if s not in idx: continue
    ts = [t for t in ts.split(' ') if len(t) == 1 and t != s and 0x3400 <= ord(t) <= 0x9fff]
    if ts: m[s] = ts
DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-./;<=>?@[]^_{}~'
NT = 52
T, C = DIGITS[:NT], DIGITS[NT:]
def num(v):
    out = T[v % NT]; q = v // NT
    while q:
        out = C[q % len(C)] + out; q //= len(C)
    return out
prev, out = -1, ''
for s in sorted(m, key=lambda c: idx[c]):
    out += num(idx[s] - prev - 1) + ''.join(m[s]); prev = idx[s]
dst = os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'lib', 'zhvar-table.ts')
open(dst, 'w', encoding='utf-8').write('// 自动生成（scripts/zhvar/gen.py，数据：OpenCC STCharacters，Apache-2.0）：%d 个简体字 → 繁体。简体记 GB2312 序号间隔，后跟繁体字。不要手改\nexport const ZHVAR_TABLE =\n  %s;\n' % (len(m), repr(out)))
print(len(m), sum(len(v) for v in m.values()), len(out.encode()))
