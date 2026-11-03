// v0.39 0017 / 0829 链接快照 + 0013 / 0827 公众号：抓链接时顺手把正文抽成纯文本（≤50KB）存进穗里（item.snap），原链接失效也能看。
// 不需要另外发请求：用的就是抓标题封面时已经拿到的那份网页。只在要存快照或是公众号链接时懒加载，首屏不带。
// 抽正文是「够用的 Readability」：先认常见正文容器（公众号 #js_content、<article>、articleBody、*-content、<main>），
// 都不像正文时退回「所有 ≥20 字的段落」。全是正则，单测在 node 里直接跑。

export const SNAP_MAX = 50 * 1024; // 字节（UTF-8）

const JUNK = /<(script|style|noscript|svg|template|iframe|form|button|select|textarea|nav|footer|aside)\b[\s\S]*?<\/\1\s*>/gi;

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => safeCp(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCp(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
function safeCp(n: number): string {
  try {
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

/** 从 open 标签开始取到配对的结束标签（同名标签嵌套计数），返回里面的 HTML */
export function innerAt(html: string, at: number): string {
  const m = /^<([a-z][a-z0-9]*)\b[^>]*>/i.exec(html.slice(at, at + 4000));
  if (!m) return '';
  const name = m[1].toLowerCase();
  const re = new RegExp(`<(/?)${name}\\b[^>]*>`, 'gi');
  re.lastIndex = at + m[0].length;
  let depth = 1;
  for (let x = re.exec(html); x; x = re.exec(html)) {
    if (x[0].endsWith('/>')) continue;
    depth += x[1] ? -1 : 1;
    if (!depth) return html.slice(at + m[0].length, x.index);
  }
  return html.slice(at + m[0].length);
}

/** HTML → 纯文本：块级标签换行，其余去掉，实体还原，空白收拢 */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(JUNK, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|blockquote|tr|table|pre|figure|figcaption|header|main|hr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0\u3000]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, a) => l || (i > 0 && a[i - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 截到 ≤ max 字节（UTF-8），不切断字 */
export function clipBytes(s: string, max = SNAP_MAX): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (enc.encode(s.slice(0, mid)).length <= max - 3) lo = mid;
    else hi = mid - 1;
  }
  return s.slice(0, lo).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

const CONTAINERS: RegExp[] = [
  /<div\b[^>]*\bid=["']js_content["'][^>]*>/i,
  /<article\b[^>]*>/i,
  /<[a-z]+\b[^>]*\bitemprop=["']articleBody["'][^>]*>/i,
  /<[a-z]+\b[^>]*\bclass=["'][^"']*\b(?:post-content|entry-content|article-content|article-body|article__body|rich_media_content|post-body|story-body|markdown-body|note-content)\b[^"']*["'][^>]*>/i,
  /<main\b[^>]*>/i,
];

function firstImage(html: string, base: string): string | undefined {
  const re = /<img\b[^>]*>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const tag = m[0];
    const src = /\bdata-src=["']([^"']+)["']/i.exec(tag)?.[1] || /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!src || /^data:/i.test(src) || /(icon|logo|avatar|qrcode|emoji|spacer|pixel)/i.test(src)) continue;
    const w = /\bwidth=["']?(\d+)/i.exec(tag)?.[1];
    if (w && +w < 120) continue;
    try {
      const u = new URL(decodeEntities(src), base);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch {
      /* skip */
    }
  }
  return undefined;
}

export interface Article {
  text: string;
  image?: string;
  /** 用的是哪种办法认出正文（单测 / 诊断用） */
  how: 'container' | 'paragraphs' | 'none';
}

/** 抽正文：返回纯文本（≤50KB）+ 正文里第一张像样的图 */
export function extractArticle(html: string, url: string): Article {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(JUNK, '');
  for (const re of CONTAINERS) {
    const m = re.exec(body);
    if (!m) continue;
    const inner = innerAt(body, m.index);
    const text = htmlText(inner);
    if (text.length >= (re === CONTAINERS[0] ? 20 : 60)) return { text: clipBytes(text), image: firstImage(inner, url), how: 'container' };
  }
  const paras: string[] = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const t = htmlText(m[1]);
    if (t.length >= 20) paras.push(t);
  }
  if (paras.length) return { text: clipBytes(paras.join('\n\n')), image: firstImage(body, url), how: 'paragraphs' };
  return { text: '', how: 'none' };
}

export function isWx(url: string): boolean {
  try {
    return new URL(url).hostname === 'mp.weixin.qq.com';
  } catch {
    return false;
  }
}

export interface WxMeta {
  title?: string;
  creator?: string;
  image?: string;
  description?: string;
  at?: number;
}

/** 公众号文章页里的脚本变量：标题、公众号名、封面、摘要、发布时间。删了 / 违规 / 要验证时抛出能看懂的原因 */
export function wxMeta(html: string): WxMeta {
  if (!/var\s+msg_title/.test(html)) {
    if (/该内容已被发布者删除|此内容因违规无法查看|内容已删除|该公众号已迁移/.test(html)) throw new Error('这篇公众号文章已被删除或无法查看');
    if (/环境异常|完成验证后即可继续访问|去验证/.test(html)) throw new Error('微信要求先验证，过一会儿再抓');
    throw new Error('没读到这篇公众号文章（链接不完整或已失效）');
  }
  const str = (name: string) => {
    const m = new RegExp(`var\\s+${name}\\s*=\\s*(?:htmlDecode\\()?\\s*(["'])([\\s\\S]*?)\\1`).exec(html);
    return m ? decodeEntities(m[2].replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(["'\\/])/g, '$1')).trim() || undefined : undefined;
  };
  const ct = str('ct');
  const img = str('msg_cdn_url');
  return {
    title: str('msg_title')?.slice(0, 120),
    creator: str('nickname'),
    image: img && /^https?:\/\//.test(img) ? img : undefined,
    description: str('msg_desc')?.slice(0, 400),
    at: ct && /^\d{9,11}$/.test(ct) ? +ct * 1000 : undefined,
  };
}
