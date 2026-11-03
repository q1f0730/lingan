// v0.24 0242 私密穗 + 本机 / 局域网地址判断：放在一个很小的模块里（首屏的 enrich 要用，探测本地模型的大段文字不进首包）

/** 是不是本机 / 局域网地址（http 只允许这些；和 tauri.conf.json 的 http scope 一致） */
export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** 这个接口地址是不是本地模型（本机 / 局域网的 http(s)）：设置里「私密穗可发给本地模型」只对它生效 */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return (u.protocol === 'http:' || u.protocol === 'https:') && isLocalHost(u.hostname);
  } catch {
    return false;
  }
}

/** v0.24 0242 私密穗能不能发给当前的模型：只有「接口在本机 / 局域网」且设置里允许时才行；云端永远不行 */
export function allowPrivate(s: { privateLocal?: boolean; chat: { baseUrl: string } }, baseUrl = s.chat.baseUrl): boolean {
  return baseUrl === MINI || (!!s.privateLocal && isLocalBaseUrl(baseUrl));
}
/** v0.39 0934 每穗的出口：关掉的出口永远拿不到这一穗；上锁（0907）= 全关。拾穗没有第三方插件，「插件」出口就是 Agent / MCP */
export type Exit = 'ai' | 'agent' | 'share' | 'garden';
export const EXITS: [Exit, string][] = [['ai', 'AI'], ['agent', 'Agent / MCP'], ['share', '分享'], ['garden', '花园']];
export const exitOpen = (it: { locked?: 1; shut?: string[] }, e: Exit): boolean => !it.locked && !it.shut?.includes(e);
export function aiVisible(it: { private?: 1; locked?: 1; shut?: string[] }, s: { privateLocal?: boolean; chat: { baseUrl: string } }, baseUrl?: string): boolean {
  // v0.39 0907 上锁的穗：任何模型（连本机的）都不发；0934 关了 AI 出口的也不发
  return exitOpen(it, 'ai') && (!it.private || allowPrivate(s, baseUrl));
}

/** v0.38 端侧向量：本机小模型（lib/mini.ts）的「接口地址」——不出设备，私密穗也能算 */
export const MINI = 'local:mini';
export const MINI_KEY = 'glean.mini';
