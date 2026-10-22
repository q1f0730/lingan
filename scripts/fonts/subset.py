#!/usr/bin/env python3
"""
Rebuild Glean's self-hosted font subsets (src/fonts/*.woff2 + src/fonts/fonts.css).
Nothing is fetched from a CDN at runtime.

Needs: pip install fonttools brotli, and the source fonts in a folder (arg 1, default ./src-fonts):
  NotoSerifSC-Regular.otf, NotoSerifSC-Black.otf   github.com/notofonts/noto-cjk  Serif/SubsetOTF/SC
  CormorantGaramond[wght].ttf, CormorantGaramond-Italic[wght].ttf   github.com/google/fonts ofl/cormorantgaramond
  JetBrainsMono[wght].ttf                          github.com/google/fonts ofl/jetbrainsmono

Sets (scripts/fonts/sets):
  common.txt   ~3,800 most frequent hanzi (sliced by unicode-range; a slice loads only when a page uses it)
  display.txt  what the Black display face covers (page titles, wordmark)
  mono.txt     the wheat field / develop glyphs (ASCII always added)
Every CJK character in src/ (UI words, samples) is added to the first slice automatically.
Slices stay < 90 KB each.
"""
import pathlib, re, subprocess, sys

here = pathlib.Path(__file__).parent
root = here.parent.parent
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'src-fonts')
out = root / 'src/fonts'
sets = here / 'sets'
LATIN = 'U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2013-2014,U+2018-201E,U+2022,U+2026,U+2039-203A,U+20AC'
PUNCT = 'U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+3000-303F,U+FF00-FF5E'
SLICE = 380

CJK = re.compile(r'[\u3400-\u9fff]')


# Content files (the ~80-entry sample pool): only their *rare* characters go into the always-loaded first slice;
# the common ones stay in the on-demand slices so the first slice doesn't balloon. (v0.14)
CONTENT = {'samples.ts'}


def ui_chars():
    s = set()
    common = set((sets / 'common.txt').read_text(encoding='utf-8'))
    for p in (root / 'src').rglob('*'):
        if p.suffix in ('.ts', '.tsx', '.css') and '__tests__' not in p.parts:
            found = CJK.findall(p.read_text(encoding='utf-8'))
            s.update(c for c in found if p.name not in CONTENT or c not in common)
    return s


def sub(font, dest, *extra):
    subprocess.run(['pyftsubset', str(src / font), '--flavor=woff2', f'--output-file={out / dest}', *extra], check=True)


def ranges(cps):
    cps = sorted(set(cps))
    spans, a, b = [], cps[0], cps[0]
    for c in cps[1:]:
        if c == b + 1:
            b = c
        else:
            spans.append((a, b)); a = b = c
    spans.append((a, b))
    return ','.join(f'U+{x:X}' if x == y else f'U+{x:X}-{y:X}' for x, y in spans)


def main():
    try:
        import brotli  # noqa: F401  WOFF2 needs it; fail before deleting anything
    except ImportError:
        sys.exit('pip install brotli first')
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob('*.woff2'):
        f.unlink()
    ui = sorted(ui_chars())
    common = [c for c in (sets / 'common.txt').read_text(encoding='utf-8') if CJK.match(c)]
    order, seen = [], set()
    for c in ui + common:
        if c not in seen:
            seen.add(c); order.append(c)
    first = len(ui)
    slices = [order[:max(first, 1)]]
    rest = order[first:]
    # top the first slice up to SLICE with the most frequent characters
    room = max(0, SLICE - first)
    slices[0] += rest[:room]
    rest = rest[room:]
    while rest:
        slices.append(rest[:SLICE]); rest = rest[SLICE:]

    css = [HEADER]
    for i, chars in enumerate(slices):
        name = f'glean-serif-{i}.woff2'
        txt = here / f'.slice{i}.txt'
        txt.write_text(''.join(chars), encoding='utf-8')
        extra = [f'--text-file={txt}', '--no-hinting', '--desubroutinize', '--layout-features=*']
        if i == 0:
            extra.append(f'--unicodes={PUNCT}')
        sub('NotoSerifSC-Regular.otf', name, *extra)
        txt.unlink()
        rng = ranges([ord(c) for c in chars])
        if i == 0:
            rng = PUNCT + ',' + rng
        css.append(FACE.format(fam='Glean Serif', file=name, w='400', st='normal', rng=f'\n  unicode-range: {rng};'))
    disp = (sets / 'display.txt').read_text(encoding='utf-8').strip()
    sub('NotoSerifSC-Black.otf', 'glean-display.woff2', f'--text=' + disp, '--unicodes=U+0020-007E,U+00B7,U+3000-303F,U+FF00-FF5E', '--no-hinting', '--desubroutinize')
    css.append(FACE.format(fam='Glean Display', file='glean-display.woff2', w='900', st='normal', rng=''))
    sub('CormorantGaramond[wght].ttf', 'glean-latin.woff2', f'--unicodes={LATIN}', '--layout-features=kern,liga,lnum,onum')
    sub('CormorantGaramond-Italic[wght].ttf', 'glean-latin-italic.woff2', f'--unicodes={LATIN}', '--layout-features=kern,liga')
    css.append(FACE.format(fam='Glean Latin', file='glean-latin.woff2', w='300 700', st='normal', rng=f'\n  unicode-range: {LATIN};'))
    css.append(FACE.format(fam='Glean Latin', file='glean-latin-italic.woff2', w='300 700', st='italic', rng=f'\n  unicode-range: {LATIN};'))
    mono = (sets / 'mono.txt').read_text(encoding='utf-8').strip()
    sub('JetBrainsMono[wght].ttf', 'glean-mono.woff2', '--text=' + mono, '--unicodes=U+0020-007E', '--layout-features=')
    css.append(FACE.format(fam='Glean Mono', file='glean-mono.woff2', w='100 800', st='normal', rng=''))
    (out / 'fonts.css').write_text('\n'.join(css), encoding='utf-8')
    for f in sorted(out.glob('*.woff2')):
        print(f.name, f.stat().st_size)


HEADER = """/*
 * Glean's type, self-hosted and subset (generated by scripts/fonts/subset.py — do not edit by hand).
 * All SIL OFL 1.1, see ./licenses.
 *   Glean Display  Noto Serif SC Black, only the words the UI sets large (page titles, wordmark)
 *   Glean Serif    Noto Serif SC Regular, ~3.8k common hanzi in unicode-range slices (loaded on demand)
 *   Glean Latin    Cormorant Garamond (variable, roman + italic): GLEAN, whispers, numbers
 *   Glean Mono     JetBrains Mono (variable), ASCII + a few glyphs: the wheat field and develop
 */"""
FACE = """@font-face {{
  font-family: '{fam}';
  src: url('./{file}') format('woff2');
  font-weight: {w};
  font-style: {st};
  font-display: swap;{rng}
}}"""

if __name__ == '__main__':
    main()
