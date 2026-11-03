// v0.35 拾穗 · 认得出常用 App（ROADMAP v0.27）：短链展开（0012）、B 站视频取标题 / UP 主 / 封面 + 时间点（0803）、
// 播客时间点（0062）。只在抓链接时懒加载；出站总开关关着时 getFetch 会直接拒绝，这里什么都不发。
import type { LinkMeta } from './linkmeta';

/** 0012 这些站的链接只是跳板：先跟着跳到真实地址再抓 */
const SHORT = /^(b23\.tv|bili2233\.cn|xhslink\.com|v\.douyin\.com|163cn\.tv|c\.tb\.cn|m\.tb\.cn|url\.cn|t\.cn|dwz\.cn|v\.kuaishou\.com|c6\.y\.qq\.com|xyzfm\.link)$/i;

export function isShort(url: string): boolean {
  try {
    return SHORT.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 0803 / 0062 链接里的时间点（秒）：?t=192 / t=3m12s / t=03:12 / #t=192 */
export function timeMark(url: string | undefined): number {
  const m = /[?&#]t=([\d.:hms]+)/i.exec(url || '');
  if (!m) return 0;
  const v = m[1];
  let s = 0;
  if (v.includes(':')) for (const p of v.split(':')) s = s * 60 + (+p || 0);
  else if (/[hms]/i.test(v)) for (const [, n, u] of v.matchAll(/(\d+)([hms])/gi)) s += +n * (u.toLowerCase() === 'h' ? 3600 : u.toLowerCase() === 'm' ? 60 : 1);
  else s = +v;
  return Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
}

/** 192 → 3:12，3725 → 1:02:05 */
export function clock(s: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
}

/** B 站视频号：BV… 或 av… */
export function biliId(url: string): string | null {
  const m = /bilibili\.com\/(?:video|s\/video)\/(BV[0-9A-Za-z]{10}|av\d+)/i.exec(url);
  return m ? m[1] : null;
}

type Fetch = (u: string, init?: RequestInit & { maxRedirections?: number }) => Promise<Response>;

/** B 站公开接口取标题 / UP 主 / 封面 / 年份（网页版会被跨域拦，返回 null 让调用方退回读网页） */
export async function biliMeta(id: string, url: string, f: Fetch): Promise<LinkMeta | null> {
  const q = /^av/i.test(id) ? 'aid=' + id.slice(2) : 'bvid=' + id;
  try {
    const r = await f('https://api.bilibili.com/x/web-interface/view?' + q, { headers: { Accept: 'application/json' } });
    const d = (await r.json())?.data;
    if (!d?.title) return null;
    return { url, type: 'film', title: String(d.title).slice(0, 120), creator: d.owner?.name, image: d.pic ? String(d.pic).replace(/^http:/, 'https:') : undefined, year: d.pubdate ? String(new Date(d.pubdate * 1000).getFullYear()) : undefined, description: d.desc && d.desc !== '-' ? String(d.desc).slice(0, 400) : undefined, siteName: '哔哩哔哩' };
  } catch {
    return null;
  }
}
