// v0.23 这穗收过了（ROADMAP v0.31）：同链接（去掉追踪参数）、同图片（原图 SHA-256）、几乎相同的文字（去标点 / 空白 / 大小写 / 全半角后相同）。
// 每件穗算出几把「重复钥匙」存进多值索引 items.dup（u:… / i:… / t:…），收的时候按钥匙查一下就知道收没收过，不扫整表。
import type { Item } from './types';

/** 追踪 / 分享用的查询参数：去掉后同一链接才认得出 */
const TRACK = /^(utm_\w+|spm|spm_id_from|from|from_source|from_spmid|share_\w+|share|shareid|si|fbclid|gclid|igshid|igsh|vd_source|ref|ref_src|ref_url|source|src|timestamp|ts|t|unique_k|mid|scm|xsec_source|xsec_token|app_platform|app_version|is_from_webapp|sender_device|sec_user_id|wechat_\w+|mpshare|scene|clicktime|enterid|sharer_\w+|_wv|_s|seid|bbid|ad_\w+|tt_\w+|lang)$/i;

export function canonicalUrl(raw: string | undefined | null): string {
  if (!raw) return '';
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol)) return '';
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  const keep: Array<[string, string]> = [];
  u.searchParams.forEach((v, k) => {
    if (!TRACK.test(k)) keep.push([k, v]);
  });
  keep.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  let path = u.pathname.replace(/\/+$/, '') || '';
  // 网易云 / 部分站点把 id 放在 #/song?id= 里：hash 里有路由就保留
  const hash = /^#\/./.test(u.hash) ? u.hash : '';
  if (hash) path += hash.replace(/[?&](utm_\w+|from|si|share_\w+)=[^&]*/g, '');
  const q = keep.map(([k, v]) => `${k}=${v}`).join('&');
  return `${host}${port(u)}${path}${q ? '?' + q : ''}`;
}
function port(u: URL): string {
  return u.port && u.port !== '80' && u.port !== '443' ? ':' + u.port : '';
}

/** 文字的「几乎相同」：NFKC、小写、去掉所有空白和标点符号后的样子（太短的不算，免得误报） */
export function textKey(s: string | undefined | null, min = 6): string {
  if (!s) return '';
  const n = s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  return n.length >= min ? n.slice(0, 400) : '';
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let h2 = 0x01000193;
  for (let i = s.length - 1; i >= 0; i--) {
    h2 ^= s.charCodeAt(i);
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  return (h >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

/** 一件穗的文字指纹来源：文案 / 想法看正文（没有正文看标题）；音乐、电影看 标题 + 作者 */
function textBasis(it: Pick<Item, 'type' | 'title' | 'content' | 'creator' | 'url'>): string {
  // v0.35 0016：音乐 / 电影带链接也按「作品名 + 作者」认（豆瓣导入的和速记的《片名》是同一部）
  if (it.type === 'music' || it.type === 'film') return (it.title || '') + '|' + (it.creator || '');
  if (it.url) return '';
  if (it.type === 'text' || it.type === 'idea') return it.content || it.title || '';
  return it.content || '';
}

/** 链接 + 文字两把钥匙（图片钥匙要读原图算哈希，另算：imageKey） */
export function dupKeys(it: Pick<Item, 'type' | 'title' | 'content' | 'creator' | 'url'>, img?: string): string[] {
  const out: string[] = [];
  const cu = canonicalUrl(it.url);
  if (cu) out.push('u:' + fnv(cu));
  const media = it.type === 'music' || it.type === 'film';
  const tk = media && !(it.title || '').trim() ? '' : textKey(textBasis(it), media ? 2 : 6);
  if (tk) out.push('t:' + fnv(media ? it.type + ':' + tk : tk));
  if (img) out.push(img);
  return out;
}

export function imageKey(hex: string): string {
  return 'i:' + hex.slice(0, 32);
}

/** 保留已有的图片钥匙，重算链接 / 文字钥匙 */
export function refreshDup(it: Pick<Item, 'type' | 'title' | 'content' | 'creator' | 'url' | 'dup'>): string[] {
  const img = (it.dup || []).find((k) => k.startsWith('i:') || k === 'x:noimg');
  return dupKeys(it, img);
}

/** 重复提示里的人话：「同一个链接」/「同一张图」/「几乎一样的文字」 */
export function dupReason(a: string[] | undefined, b: string[] | undefined): string {
  const s = new Set(a || []);
  const hit = (b || []).filter((k) => s.has(k));
  if (hit.some((k) => k.startsWith('i:'))) return '同一张图';
  if (hit.some((k) => k.startsWith('u:'))) return '同一个链接';
  if (hit.some((k) => k.startsWith('t:'))) return '几乎一样的文字';
  return '';
}

/** 合并两穗：保留旧的那件，标签取并集，为什么两段都留（不同才拼），缺的字段用新的补 */
export function mergedPatch(keep: Item, drop: Item): Partial<Item> {
  const tags = [...keep.tags];
  for (const t of drop.tags) if (!tags.includes(t)) tags.push(t);
  const whys = [keep.why, drop.why].map((x) => (x || '').trim()).filter(Boolean);
  const why = [...new Set(whys)].join(' / ');
  const p: Partial<Item> = { tags: tags.slice(0, 12) };
  if (why !== (keep.why || '')) p.why = why;
  for (const k of ['creator', 'year', 'content', 'source'] as const) if (!keep[k] && drop[k]) p[k] = drop[k];
  if (!keep.url && drop.url) p.url = drop.url;
  // v0.35 0016 再次遇见：合并 = 又遇见了它一次，记下那次的时间
  const meets = [...new Set([...(keep.meets || []), drop.createdAt, ...(drop.meets || [])])].filter((t) => t !== keep.createdAt).sort((a, b) => a - b).slice(-50);
  if (meets.length) p.meets = meets;
  return p;
}
