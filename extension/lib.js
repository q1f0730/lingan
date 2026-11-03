// 拾穗 · Glean 浏览器扩展的纯函数（background.js 用，vitest 单测：src/__tests__/v036.test.ts）。
// 所有东西都拼成 glean://capture?… 交给本机 App（v0.33 深链接），扩展自己不联网、不存东西。

/** Text Fragment 里要转义的字符：encodeURIComponent 之外还有 - , & */
export function encFrag(s) {
  return encodeURIComponent(s).replace(/-/g, '%2D').replace(/,/g, '%2C');
}

/** 0008：网页 + 选中的那句 → 点开能直接滚到那一句的链接（#:~:text=）。长句用「开头,结尾」 */
export function fragmentUrl(pageUrl, sel) {
  const t = String(sel || '').replace(/\s+/g, ' ').trim();
  const base = String(pageUrl || '').split('#')[0];
  if (!t || !/^https?:\/\//i.test(base)) return base;
  const chars = Array.from(t);
  const frag = chars.length <= 60 ? encFrag(t) : `${encFrag(chars.slice(0, 20).join('').trim())},${encFrag(chars.slice(-20).join('').trim())}`;
  return `${base}#:~:text=${frag}`;
}

/** 页面标题去掉站名尾巴 */
export function cleanTitle(t) {
  return String(t || '')
    .replace(/_哔哩哔哩_bilibili$/i, '')
    .replace(/[-_\s]*哔哩哔哩[-_\s]*(bilibili)?$/i, '')
    .replace(/\s*-\s*YouTube$/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim();
}

export function isVideoPage(url) {
  return /^https?:\/\/(www\.|m\.)?(bilibili\.com\/(video|bangumi)\/|youtube\.com\/(watch|shorts\/)|youtu\.be\/)/i.test(String(url || ''));
}

/** 3:12 / 1:02:03 */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** 0009：视频链接带上秒数（B 站 ?t=192，YouTube &t=192s），顺手去掉追踪参数 */
export function timeUrl(pageUrl, sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return String(pageUrl || '');
  }
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (/^(spm_id_from|vd_source|from_spmid|share_|si$|feature$|pp$|utm_)/i.test(k)) u.searchParams.delete(k);
  if (/youtube\.com|youtu\.be/i.test(u.hostname)) u.searchParams.set('t', `${s}s`);
  else u.searchParams.set('t', String(s));
  return u.toString();
}

/** 拼 glean://capture；字段太长截断（App 那边单字段 4000 字、整条 8192） */
export function captureUrl(o) {
  const p = new URLSearchParams();
  const put = (k, v, n) => {
    const s = String(v || '').trim();
    if (s) p.set(k, Array.from(s).slice(0, n).join(''));
  };
  put('text', o.text, 1500);
  put('url', o.url, 1800);
  put('title', o.title, 120);
  put('why', o.why, 300);
  put('img', o.img, 1500);
  if (o.tags && o.tags.length) p.set('tags', o.tags.slice(0, 8).join(','));
  if (o.clip) p.set('clip', '1');
  let out = 'glean://capture?' + p.toString().replace(/\+/g, '%20');
  // 中文按 UTF-8 转义后一个字 9 个字符：整条超过 8000 就把正文砍短
  for (let n = 1500; out.length > 8000 && n > 20; n = Math.floor(n * 0.7)) {
    put('text', o.text, n);
    out = 'glean://capture?' + p.toString().replace(/\+/g, '%20');
  }
  return out;
}

/** 右键 / 工具栏点击 → 要交给 App 的链接（时间点那一项要先在页面里读 video，见 background.js） */
export function menuToLink(id, info, tab, video) {
  const page = (info && info.pageUrl) || (tab && tab.url) || '';
  const title = cleanTitle(tab && tab.title);
  if (id === 'sel') return captureUrl({ text: info.selectionText, url: fragmentUrl(page, info.selectionText), title: '', tags: ['摘抄'] });
  if (id === 'img') return captureUrl({ img: info.srcUrl, url: page, title: title || '网页里的图' });
  if (id === 'link') return captureUrl({ url: info.linkUrl, text: info.selectionText || '' });
  if (id === 'time' && video) {
    const at = fmtTime(video.t);
    return captureUrl({ text: `${title || '视频'} ${at}`, url: timeUrl(video.url || page, video.t), title: `${title || '视频'} · ${at}`, clip: video.frame });
  }
  return captureUrl({ url: page, title });
}
