// v0.34 公开花园页（懒加载）：把标了「花园」的穗生成一个单文件网页（自带样式、图片内嵌），可以丢到 GitHub Pages / 任何静态空间。
// - 0902 只放标了「花园」的穗（私密穗、回收站、示例穗永远不放），生成前再给一次清单确认
// - 0901 作者默认公开名 Q1f730；0909 生成前扫个人信息
// - 0903 图片在 canvas 里重画再导出 JPEG（EXIF / GPS 全丢），最长边 1080；链接去追踪参数；不带时间到日、不带来源 App、不带 uid
import { cleanUrl } from './cleanurl';
import { TYPE_LABEL, type Item } from './types';

export function gardenItems(all: Item[]): Item[] {
  return all.filter((it) => it.garden && !it.deletedAt && !it.private && !it.locked && !it.sample).sort((a, b) => b.createdAt - a.createdAt);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const month = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 花园里一穗会公开的文字（扫描个人信息用的也是这段） */
export function gardenText(it: Item, withWhy: boolean): string {
  return [it.title, it.creator, it.year, it.content, withWhy ? it.why : '', it.url ? cleanUrl(it.url) : '', it.tags.join(' ')].filter(Boolean).join('\n');
}

/** 重新编码图片：丢掉 EXIF / GPS 等元数据，最长边 1080 */
export async function scrubImage(b: Blob, max = 1080): Promise<string | null> {
  try {
    const bm = await createImageBitmap(b);
    const k = Math.min(1, max / Math.max(bm.width, bm.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bm.width * k);
    cv.height = Math.round(bm.height * k);
    cv.getContext('2d')!.drawImage(bm, 0, 0, cv.width, cv.height);
    bm.close();
    return cv.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

export interface GardenOpts {
  name: string;
  withWhy: boolean;
  /** 某穗的图片（已清洗的 data URL），没有就 null */
  image: (it: Item) => Promise<string | null>;
  now?: number;
}

export async function buildGarden(items: Item[], o: GardenOpts): Promise<string> {
  const cards: string[] = [];
  for (const it of items) {
    const img = await o.image(it);
    const url = it.url ? cleanUrl(it.url) : '';
    const meta = [TYPE_LABEL[it.type], it.creator, it.year, month(it.createdAt)].filter((x): x is string => !!x).map(esc).join(' · ');
    cards.push(
      `<article>${img ? `<img src="${img}" alt="" loading="lazy">` : ''}<p class="m">${meta}</p><h2>${esc(it.type === 'film' ? `《${it.title.replace(/^《|》$/g, '')}》` : it.title)}</h2>` +
        (it.content && it.content !== it.title ? `<p>${esc(it.content).replace(/\n/g, '<br>')}</p>` : '') +
        (o.withWhy && it.why ? `<p class="w">${esc(it.why)}</p>` : '') +
        (url ? `<a href="${esc(url)}" rel="noopener noreferrer nofollow">${esc(url.replace(/^https?:\/\//, '').slice(0, 60))}</a>` : '') +
        (it.tags.length ? `<p class="t">${it.tags.map((t) => '#' + esc(t)).join(' ')}</p>` : '') +
        `</article>`,
    );
  }
  const name = esc(o.name);
  const d = new Date(o.now ?? Date.now());
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Glean"><meta name="referrer" content="no-referrer"><title>${name} 的花园</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f5f1;color:#1d1b18;font:16px/1.65 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
header,main,footer{max-width:1180px;margin:0 auto;padding:0 24px}header{padding-top:72px}h1{font-size:clamp(44px,9vw,104px);line-height:1;margin:0 0 12px;letter-spacing:-.03em}
header p,.m,.t,footer{color:#6b665e;font-size:13px}main{columns:300px 3;column-gap:24px;margin-top:48px}
article{break-inside:avoid;margin:0 0 24px;padding:20px;background:#fff;border:1px solid rgba(29,27,24,.08)}article img{display:block;width:calc(100% + 40px);margin:-20px -20px 16px}
h2{font-size:20px;line-height:1.3;margin:4px 0 8px}article p{margin:8px 0}.w{border-left:2px solid #1d1b18;padding-left:10px}a{color:#1d1b18;word-break:break-all;font-size:13px}
footer{padding:32px 24px 64px}@media(prefers-color-scheme:dark){body{background:#151412;color:#ece9e3}article{background:#1d1b18;border-color:#2b2925}a{color:#ece9e3}.w{border-color:#ece9e3}}
</style></head><body><header><h1>${name} 的花园</h1><p>${items.length} 穗 · ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')} 更新 · 用拾穗 Glean 生成</p></header><main>${cards.join('')}</main><footer>${name} · 拾穗 Glean</footer></body></html>`;
}
