// v0.30 出站：ROADMAP v0.25「发出去前看一眼」+ 0906「出站清单：本月发出去了什么」。
// - 每次调模型前（可设「每次」/「只看一次」），弹纸片显示这次会发出去的全部文字和是否含图片；图片像素默认不上传，要勾选。
//   预览的就是实际请求体：ai.ts 先把请求体拼好交给 gateOutbound，用户看完（可能去掉图片）后发的就是返回的那份。
// - 出站记录：每次外联（模型、向量、看图、抓链接）记一笔：时间、域名、种类、发了哪几类字段（文字 / 图片 / 链接）、字节数、成没成。
//   只记这些，不记内容、不记密钥；存在 localStorage，最多 400 条。

export type OutKind = 'chat' | 'vision' | 'embed' | 'link';
export type OutField = '文字' | '图片' | '链接';
export interface OutRecord {
  at: number;
  host: string;
  kind: OutKind;
  fields: OutField[];
  bytes: number;
  ok: boolean;
  /** 在预览里拿掉了图片 */
  stripped?: number;
}
export type PreviewMode = 'off' | 'always' | 'once';

const LOG_KEY = 'glean.outbound.log';
const MODE_KEY = 'glean.outbound.preview';
const MAX = 400;

export const KIND_LABEL: Record<OutKind, string> = { chat: '对话 / 嫁接', vision: '看图', embed: '向量', link: '抓链接' };

export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return (url.match(/^[a-z]+:\/\/([^/]+)/i) || [])[1] || url.slice(0, 40);
  }
}

export function readLog(): OutRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function recordOutbound(r: OutRecord): void {
  try {
    const next = [...readLog(), r].slice(-MAX);
    localStorage.setItem(LOG_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('glean:outbound'));
  } catch {
    /* 隐私模式 / 满了：不记也不能拦请求 */
  }
}
export function clearLog(): void {
  try {
    localStorage.removeItem(LOG_KEY);
    window.dispatchEvent(new Event('glean:outbound'));
  } catch {
    /* ignore */
  }
}

/** 本月按域名汇总：次数、字段类别、字节；按次数倒序 */
export function monthSummary(log: OutRecord[], now = Date.now()): Array<{ host: string; n: number; fields: OutField[]; kinds: OutKind[]; bytes: number; fail: number }> {
  const d = new Date(now);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const by = new Map<string, { host: string; n: number; fields: Set<OutField>; kinds: Set<OutKind>; bytes: number; fail: number }>();
  for (const r of log) {
    if (r.at < start || r.at > now + 60000) continue;
    let g = by.get(r.host);
    if (!g) by.set(r.host, (g = { host: r.host, n: 0, fields: new Set(), kinds: new Set(), bytes: 0, fail: 0 }));
    g.n++;
    r.fields.forEach((f) => g!.fields.add(f));
    g.kinds.add(r.kind);
    g.bytes += r.bytes || 0;
    if (!r.ok) g.fail++;
  }
  return [...by.values()].map((g) => ({ ...g, fields: [...g.fields], kinds: [...g.kinds] })).sort((a, b) => b.n - a.n || a.host.localeCompare(b.host));
}

// ——— 请求体里有什么 ———

type Part = { type: string; text?: string; image_url?: { url: string } };
type Msg = { role: string; content: string | Part[] };
export interface ChatBody {
  messages?: Msg[];
  input?: string[] | string;
  [k: string]: unknown;
}

export function countImages(body: ChatBody): number {
  let n = 0;
  for (const m of body.messages || []) if (Array.isArray(m.content)) n += m.content.filter((p) => p.type === 'image_url').length;
  return n;
}
export function fieldsOf(body: ChatBody, kind: OutKind): OutField[] {
  if (kind === 'link') return ['链接'];
  const out: OutField[] = ['文字'];
  if (countImages(body)) out.push('图片');
  return out;
}
/** 去掉所有图片像素（预览里没勾「这次上传图片」） */
export function stripImages(body: ChatBody): ChatBody {
  return {
    ...body,
    messages: (body.messages || []).map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((p) => p.type !== 'image_url') } : m)),
  };
}
/** 预览纸片里显示的文字：就是请求体里每条消息的原文（图片显示成占位，不显示 base64） */
export function previewText(body: ChatBody): string {
  if (body.input != null) {
    const arr = Array.isArray(body.input) ? body.input : [body.input];
    return arr.map((t, i) => `【向量 ${i + 1}】\n${t}`).join('\n\n');
  }
  return (body.messages || [])
    .map((m) => {
      const who = m.role === 'system' ? '【系统说明】' : m.role === 'user' ? '【发给模型的】' : '【模型上一句】';
      const body = Array.isArray(m.content) ? m.content.map((p) => (p.type === 'image_url' ? `［图片 ${Math.round((p.image_url?.url.length || 0) / 1365)}KB］` : p.text || '')).join('\n') : m.content;
      return `${who}\n${body}`;
    })
    .join('\n\n');
}

// ——— 发出去前看一眼 ———

export function previewMode(): PreviewMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'always' || v === 'once' ? v : 'off';
  } catch {
    return 'off';
  }
}
export function setPreviewMode(m: PreviewMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
  seenOnce = false;
}
let seenOnce = false;

export interface PreviewReq {
  host: string;
  kind: OutKind;
  model?: string;
  temperature?: number;
  text: string;
  images: number;
}
export interface PreviewAnswer {
  ok: boolean;
  /** 勾了「这次上传图片」 */
  images: boolean;
}
type Previewer = (r: PreviewReq) => Promise<PreviewAnswer>;
let previewer: Previewer | null = null;
/** 测试 / 别的界面换掉默认的纸片（默认按需加载 components/OutboundPreview） */
export function setPreviewer(p: Previewer | null): void {
  previewer = p;
}

export class OutboundCancel extends Error {}

/**
 * ai.ts 发请求前调：需要预览就等用户看完。返回真正要发的请求体（可能去掉了图片）。
 * 用户取消 → 抛 OutboundCancel（调用方当成「这次没发」）；去掉图片后只剩空壳的看图请求也当取消。
 */
export async function gateOutbound<T extends ChatBody>(url: string, body: T, kind: OutKind): Promise<{ body: T; stripped: number }> {
  const mode = previewMode();
  const images = countImages(body);
  if (mode === 'off' || (mode === 'once' && seenOnce)) return { body, stripped: 0 };
  // 没挂别的预览器（测试里会挂）：按需加载纸片 UI；加载失败就不发（宁可不发，也不偷偷发）
  const show: Previewer =
    previewer ||
    (await import('../components/OutboundPreview').then(
      (m) => m.showPreview,
      () => async () => ({ ok: false, images: false }),
    ));
  const ans = await show({ host: hostOf(url), kind, model: typeof body.model === 'string' ? body.model : undefined, temperature: typeof body.temperature === 'number' ? body.temperature : undefined, text: previewText(body), images });
  if (!ans.ok) throw new OutboundCancel('没发出去：你在「发出去前看一眼」里取消了');
  seenOnce = true;
  if (images && !ans.images) {
    if (kind === 'vision') throw new OutboundCancel('没上传图片，这次不看图');
    return { body: stripImages(body) as T, stripped: images };
  }
  return { body, stripped: 0 };
}
