// v0.34 ROADMAP「新枝明信片」：把一根新枝画成 1080 宽的竖版 PNG（标题、正文、溯源穗缩略图、落款），走系统分享 / 存相册。
// 纯 canvas、自托管字体（先 document.fonts.load 把要用的字片拉下来，canvas 才画得出思源黑体）；不加依赖。
// 0916 溯源穗：显示（缩略图 + 类型 · 标题 · 作者）/ 只写类型和标题（灰块，不画图）/ 不带；私密穗永远是灰块「一穗私密的」。
// 图片重画到 canvas 再导出 PNG，原图的 EXIF / GPS 不会带出去。
import { TYPE_LABEL, type Item } from './types';
import type { SprigMode } from './sharekit';

export const W = 1080;
const PAD = 88;
const INNER = W - PAD * 2;
const C = { bg: '#f7f5f1', fg: '#1d1b18', fg2: '#6b665e', line: 'rgba(29,27,24,0.16)', tile: '#e8e4dc' };
const SANS = "'Glean Sans', 'Glean Inter', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";

/** 行首不许出现的标点（挂到上一行行尾） */
const NO_HEAD = /^[，。、；：！？）》」』”’…—,.;:!?)\]]/;

/** 按宽度断行（中文按字、西文按词；行首禁则）。measure 给出一段字的宽度。纯函数，单测覆盖 */
export function wrapText(text: string, maxW: number, measure: (s: string) => number, maxLines = 99): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const toks = para.match(/[A-Za-z0-9@#'’.\-_/:%]+|\s+|./gu) || [''];
    let line = '';
    for (const t of toks) {
      const next = line + t;
      if (!line || measure(next) <= maxW || NO_HEAD.test(t)) {
        line = next;
        continue;
      }
      out.push(line.trimEnd());
      line = t.trimStart();
    }
    out.push(line.trimEnd());
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && measure(last + '…') > maxW) last = last.slice(0, -1);
    cut[maxLines - 1] = last + '…';
    return cut;
  }
  return out;
}

export interface Sprig {
  item: Item;
  thumb?: Blob | null;
}
export interface CardInput {
  title: string;
  body: string;
  form?: string;
  sprigs: Sprig[];
  mode: SprigMode;
  name: string;
  date: number;
}

async function bitmap(b: Blob | null | undefined): Promise<ImageBitmap | null> {
  if (!b) return null;
  try {
    return await createImageBitmap(b);
  } catch {
    return null;
  }
}

/** 画明信片：返回 PNG（1080 × 自适应高度，至少 1350） */
export async function renderPostcard(c: CardInput): Promise<Blob> {
  const title = c.title.replace(/^《|》$/g, '');
  const sprigs = c.mode === 'none' ? [] : c.sprigs.slice(0, 5);
  const lines = (it: Item) => (it.private || it.locked ? '一穗私密的' : c.mode === 'show' ? [TYPE_LABEL[it.type], it.title.replace(/^《|》$/g, ''), it.creator].filter(Boolean).join(' · ') : `${TYPE_LABEL[it.type]} · ${it.title.replace(/^《|》$/g, '')}`);
  const all = [title, c.body, c.form || '', c.name, '新枝因为这几穗拾穗', ...sprigs.map((s) => lines(s.item))].join('');
  try {
    await Promise.all([document.fonts.load(`700 80px ${SANS}`, all), document.fonts.load(`400 38px ${SANS}`, all)]);
  } catch {
    /* 字体拉不到就用系统字 */
  }
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d')!;
  const font = (w: number, px: number) => (ctx.font = `${w} ${px}px ${SANS}`);
  const m = (s: string) => ctx.measureText(s).width;
  // 标题字号：最多 4 行，太长就缩
  let tpx = 88;
  let tl: string[] = [];
  for (; tpx >= 56; tpx -= 8) {
    font(700, tpx);
    tl = wrapText(title, INNER, m);
    if (tl.length <= 4) break;
  }
  font(700, tpx);
  tl = wrapText(title, INNER, m, 4);
  font(400, 38);
  const bl = wrapText(c.body, INNER, m, 14);
  const ROW = 168;
  const h = Math.max(1350, PAD + 60 + 56 + tl.length * tpx * 1.22 + 48 + bl.length * 38 * 1.62 + (c.form ? 70 : 0) + (sprigs.length ? 110 + sprigs.length * ROW : 0) + 140 + PAD);
  cv.width = W;
  cv.height = Math.ceil(h);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, cv.height);
  ctx.textBaseline = 'top';
  let y = PAD;
  // 页眉
  font(500, 26);
  ctx.fillStyle = C.fg2;
  ctx.fillText('GLEAN · 新枝', PAD, y);
  const d = new Date(c.date);
  const ds = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  ctx.fillText(ds, W - PAD - m(ds), y);
  y += 60;
  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, y, INNER, 2);
  y += 56;
  // 标题
  font(700, tpx);
  ctx.fillStyle = C.fg;
  for (const l of tl) {
    ctx.fillText(l, PAD, y);
    y += tpx * 1.22;
  }
  y += 48;
  // 正文
  font(400, 38);
  for (const l of bl) {
    ctx.fillText(l, PAD, y);
    y += 38 * 1.62;
  }
  if (c.form) {
    y += 22;
    font(500, 30);
    ctx.fillStyle = C.fg2;
    ctx.fillText(wrapText('形式 · ' + c.form, INNER, m, 1)[0], PAD, y);
    y += 48;
  }
  // 因为这几穗
  if (sprigs.length) {
    y += 54;
    font(500, 26);
    ctx.fillStyle = C.fg2;
    ctx.fillText('因为这几穗', PAD, y);
    y += 56;
    for (const s of sprigs) {
      const T = 136;
      const bm = c.mode === 'show' && !s.item.private && !s.item.locked ? await bitmap(s.thumb) : null;
      if (bm) {
        const k = Math.max(T / bm.width, T / bm.height);
        const sw = T / k;
        const sh = T / k;
        ctx.drawImage(bm, (bm.width - sw) / 2, (bm.height - sh) / 2, sw, sh, PAD, y, T, T);
        bm.close();
      } else {
        ctx.fillStyle = C.tile;
        ctx.fillRect(PAD, y, T, T);
        font(500, 28);
        ctx.fillStyle = C.fg2;
        const lb = s.item.private || s.item.locked ? '私密' : TYPE_LABEL[s.item.type];
        ctx.fillText(lb, PAD + (T - m(lb)) / 2, y + T / 2 - 16);
      }
      font(400, 32);
      ctx.fillStyle = C.fg;
      const tx = wrapText(lines(s.item), INNER - T - 36, m, 2);
      tx.forEach((l, i) => ctx.fillText(l, PAD + T + 36, y + 30 + i * 46));
      y += ROW;
    }
  }
  // 落款
  const fy = cv.height - PAD - 30;
  ctx.fillStyle = C.line;
  ctx.fillRect(PAD, fy - 40, INNER, 2);
  font(500, 28);
  ctx.fillStyle = C.fg;
  ctx.fillText('— ' + c.name, PAD, fy);
  ctx.fillStyle = C.fg2;
  const brand = '拾穗 Glean';
  ctx.fillText(brand, W - PAD - m(brand), fy);
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('画不出图片'))), 'image/png'));
}
