// v0.39 0805 接入的权限清单与一键停用：拾穗没有第三方插件市场，「插件」= 每一样会往外连、或会读 / 写你穗仓的接入
// （抓链接、订阅、网易云歌单、模型下载、AI 服务、Agent / MCP）。每一样在 PLUG_SPECS 里声明读什么、写什么、只连哪些域名；
// 运行时 assertPlug 把关：停用了就拒绝，域名不在声明里也拒绝（不是 CSP，是 getFetch 之前这一层；出站总开关仍在更外面一层）。
// 停用状态存本机 localStorage，不同步。这个文件在首屏（ai.ts 要用），所以只放判断，说明文字在设置页的面板里。

export type PlugId = 'link' | 'feeds' | 'netease' | 'mini' | 'ai' | 'agent' | 'push';
export const PLUG_OFF_KEY = 'glean.plugs.off';

function offSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(PLUG_OFF_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
export function plugOn(id: PlugId): boolean {
  return !offSet().has(id);
}
export function setPlug(id: PlugId, on: boolean): void {
  const s = offSet();
  if (on) s.delete(id);
  else s.add(id);
  try {
    if (s.size) localStorage.setItem(PLUG_OFF_KEY, JSON.stringify([...s]));
    else localStorage.removeItem(PLUG_OFF_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('glean:plugs'));
}

export const PLUG_NAME: Record<PlugId, string> = { link: '抓链接与快照', feeds: '订阅（RSS）', netease: '网易云歌单', mini: '本机小模型下载', ai: 'AI 服务', agent: 'Agent 与 API', push: '微信推送（Server酱）' };

/** 域名匹配：'*' = 任何（只给「抓你贴的链接」用）；'*.x.com' = x.com 及其子域 */
export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.toLowerCase();
  return allow.some((a) => a === '*' || a === h || (a.startsWith('*.') && (h === a.slice(2) || h.endsWith(a.slice(1)))));
}

export class PlugBlocked extends Error {}

/** 这个接入现在能不能连这个地址：停用了 / 域名没声明都抛错（错误文案给人看） */
export function assertPlug(id: PlugId, url: string, allow: string[]): void {
  if (!plugOn(id)) throw new PlugBlocked(`「${PLUG_NAME[id]}」已停用：设置 → 出站 → 接入与权限 里打开`);
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new PlugBlocked('地址不对');
  }
  if (!hostAllowed(host, allow)) throw new PlugBlocked(`「${PLUG_NAME[id]}」没声明要访问 ${host}，已拦下`);
}

/** 网易云歌单只连这些（接口 + 封面图床） */
export const NETEASE_HOSTS = ['music.163.com', 'y.music.163.com', '163cn.tv', '*.music.126.net'];
