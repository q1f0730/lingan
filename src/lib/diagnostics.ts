// v0.20「复制诊断信息」：版本、平台、WebView、库规模、钥匙串 / 存储状态、最近错误。
// 不含任何密钥、接口地址里的凭据、穗的标题或内容。
import { readErrors, scrub, isSafeMode, type ErrEntry } from './errlog';

export interface DiagInput {
  version: string;
  ua: string;
  counts?: { items?: number; devs?: number; imgs?: number; cliches?: number } | null;
  vault?: string | null;
  persisted?: boolean | null;
  aiPreset?: string;
  aiReady?: boolean;
  online?: boolean;
  safeMode?: boolean;
  errors?: ErrEntry[];
  secrets?: string[];
  now?: number;
}

export function platformOf(ua: string, isTauri: boolean, isAndroidApp: boolean): string {
  const os = /Android\s([\d.]+)/.exec(ua)?.[0] || (/Windows NT 10/.test(ua) ? 'Windows 10/11' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '未知');
  const shell = isAndroidApp ? '安卓 App' : isTauri ? '桌面 App' : '浏览器';
  return `${shell} · ${os}`;
}

export function webviewOf(ua: string): string {
  const edg = /Edg\/([\d.]+)/.exec(ua);
  if (edg) return `WebView2 / Edge ${edg[1]}`;
  const chrome = /Chrome\/([\d.]+)/.exec(ua);
  if (chrome) return `Chromium ${chrome[1]}`;
  const sf = /Version\/([\d.]+).*Safari/.exec(ua);
  if (sf) return `Safari ${sf[1]}`;
  const ff = /Firefox\/([\d.]+)/.exec(ua);
  if (ff) return `Firefox ${ff[1]}`;
  return '未知';
}

function hhmm(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function buildDiagnostics(x: DiagInput): string {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const isAndroidApp = typeof window !== 'undefined' && 'LinganFiles' in window;
  const errs = (x.errors ?? readErrors()).slice(-20);
  const c = x.counts || {};
  const lines = [
    '拾穗 Glean 诊断信息',
    `生成时间：${hhmm(x.now ?? Date.now())}`,
    `版本：v${x.version}`,
    `平台：${platformOf(x.ua, isTauri, isAndroidApp)}`,
    `WebView：${webviewOf(x.ua)}`,
    `库：${c.items ?? '?'} 穗 · ${c.devs ?? '?'} 新枝 · ${c.imgs ?? '?'} 张图 · ${c.cliches ?? '?'} 条套路`,
    `AI：${x.aiPreset || '?'}（${x.aiReady ? '已配置' : '未配置'}）`,
    `密钥存放：${x.vault || '?'}`,
    `存储：${x.persisted == null ? '未知' : x.persisted ? '已持久' : '可能被系统清理'}`,
    `网络：${x.online === false ? '离线' : '在线'}`,
    `安全模式：${(x.safeMode ?? isSafeMode()) ? '开' : '关'}`,
    `最近错误（${errs.length}）：`,
  ];
  if (!errs.length) lines.push('  （无）');
  for (const e of errs) {
    lines.push(`  [${hhmm(e.t)}] v${e.v} ${e.view} ${e.src} ${e.name}: ${e.msg}`);
    if (e.stack) {
      const frames = e.stack
        .split('\n')
        .slice(1, 4)
        .map((l) => '      ' + l.trim());
      lines.push(...frames);
    }
  }
  return scrub(lines.join('\n'), x.secrets);
}
