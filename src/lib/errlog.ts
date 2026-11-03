// v0.20 本地错误日志：环形缓冲，只存在本机 localStorage（数据库坏了也能写），从不上传。
// 只记 时间 / 版本 / 页面 / 来源 / 错误名 / 消息 / 栈，并脱敏：密钥样式的串、Bearer、长 base64、data: URL 一律抹掉。

export interface ErrEntry {
  t: number;
  v: string;
  view: string;
  src: 'render' | 'error' | 'rejection' | 'manual';
  name: string;
  msg: string;
  stack?: string;
}

export const ERRLOG_KEY = 'glean.errlog.v1';
export const ERRLOG_MAX = 100;
const MSG_MAX = 300;
const STACK_MAX = 1200;

let extraSecrets: () => string[] = () => [];
/** 让脱敏也认得当前在用的密钥值（只在内存里比对，不保存） */
export function setSecretProvider(f: () => string[]) {
  extraSecrets = f;
}

export function scrub(text: string, secrets: string[] = extraSecrets()): string {
  let s = String(text ?? '');
  for (const k of secrets) if (k && k.length >= 6) s = s.split(k).join('[key]');
  s = s
    .replace(/Bearer\s+[A-Za-z0-9._\-~+/=]+/gi, 'Bearer [key]')
    .replace(/\b(sk|ak|pk|rk)-[A-Za-z0-9_\-]{8,}/g, '[key]')
    .replace(/\bAIza[0-9A-Za-z_\-]{20,}/g, '[key]')
    .replace(/\b[0-9a-f]{32}\.[A-Za-z0-9]{10,}\b/g, '[key]') // 智谱 id.secret
    .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, 'data:[…]')
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, '[…]');
  return s;
}

function read(): ErrEntry[] {
  try {
    const a = JSON.parse(localStorage.getItem(ERRLOG_KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

export function readErrors(): ErrEntry[] {
  return read();
}

export function clearErrors() {
  try {
    localStorage.removeItem(ERRLOG_KEY);
  } catch {
    /* ignore */
  }
}

let currentView = 'library';
export function setErrView(v: string) {
  currentView = v;
}

let lastSig = '';
let lastAt = 0;

export function logError(err: unknown, src: ErrEntry['src'], opts: { view?: string; version?: string; now?: number } = {}): ErrEntry | null {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : safeString(err));
    const now = opts.now ?? Date.now();
    const entry: ErrEntry = {
      t: now,
      v: opts.version ?? (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'),
      view: opts.view ?? currentView,
      src,
      name: scrub(e.name || 'Error').slice(0, 60),
      msg: scrub(e.message || '').slice(0, MSG_MAX),
    };
    if (e.stack) entry.stack = scrub(e.stack).slice(0, STACK_MAX);
    // 同一错误 1 秒内连发（渲染循环）只记一次
    const sig = entry.name + entry.msg + entry.src;
    if (sig === lastSig && now - lastAt < 1000) return null;
    lastSig = sig;
    lastAt = now;
    const a = read();
    a.push(entry);
    while (a.length > ERRLOG_MAX) a.shift();
    try {
      localStorage.setItem(ERRLOG_KEY, JSON.stringify(a));
    } catch {
      // 存储满了：砍一半再试
      try {
        localStorage.setItem(ERRLOG_KEY, JSON.stringify(a.slice(-Math.floor(ERRLOG_MAX / 2))));
      } catch {
        /* ignore */
      }
    }
    return entry;
  } catch {
    return null;
  }
}

function safeString(x: unknown): string {
  try {
    if (x && typeof x === 'object' && 'message' in x) return String((x as { message: unknown }).message);
    return typeof x === 'object' ? JSON.stringify(x).slice(0, 200) : String(x);
  } catch {
    return 'unknown error';
  }
}

let installed = false;
/** 全局兜底：window.onerror + unhandledrejection 都写进日志 */
export function installGlobalErrorHandlers(w: Window = window) {
  if (installed) return;
  installed = true;
  w.addEventListener('error', (ev) => {
    // 资源加载失败（img 等）没有 error 对象，不算崩溃
    if (!(ev as ErrorEvent).error && !(ev as ErrorEvent).message) return;
    logError((ev as ErrorEvent).error ?? (ev as ErrorEvent).message, 'error');
  });
  w.addEventListener('unhandledrejection', (ev) => {
    logError((ev as PromiseRejectionEvent).reason, 'rejection');
  });
}

// ---- 安全模式：白屏自救。开着时启动只做最少的事（不跑缩略图 / 索引 / 预取 / 动效） ----
export const SAFE_KEY = 'glean.safe';
export function isSafeMode(): boolean {
  try {
    return localStorage.getItem(SAFE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setSafeMode(on: boolean) {
  try {
    if (on) localStorage.setItem(SAFE_KEY, '1');
    else localStorage.removeItem(SAFE_KEY);
  } catch {
    /* ignore */
  }
}
