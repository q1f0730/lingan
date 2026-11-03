// v0.20 安全加固：AI 密钥不再放进 localStorage 的设置里，而是交给系统钥匙串。
// - 安卓：MainActivity 注入的 LinganVault（Android Keystore AES-GCM 包裹，密文存 SharedPreferences）
// - 桌面（Tauri）：Rust 端 keyring（Windows 凭据管理器）命令 secret_get / secret_set / secret_delete
// - 浏览器 / E2E：没有钥匙串，降级为单独的 localStorage 条目（不进设置、不进备份、不进诊断），界面如实标注
// 本模块不打日志、不把值写进任何错误信息。

export type VaultKind = 'android' | 'keychain' | 'browser' | 'memory';
// v0.31 同步：WebDAV 应用密码、同步数据钥（base64）
export type SecretName = 'chat.apiKey' | 'embed.apiKey' | 'sync.davPass' | 'sync.key';
export const SECRET_NAMES: SecretName[] = ['chat.apiKey', 'embed.apiKey', 'sync.davPass', 'sync.key'];

export interface VaultBackend {
  kind: VaultKind;
  get(name: SecretName): Promise<string>;
  set(name: SecretName, value: string): Promise<void>;
  del(name: SecretName): Promise<void>;
}

interface AndroidVault {
  get(name: string): string;
  set(name: string, value: string): boolean;
}

const BROWSER_KEY = 'glean.vault.v1';
const ERR = '\u0000';

export const VAULT_LABEL: Record<VaultKind, string> = {
  android: '安卓系统密钥库（Android Keystore）',
  keychain: '系统钥匙串（Windows 凭据管理器）',
  browser: '本浏览器存储（网页版没有系统钥匙串）',
  memory: '仅本次运行的内存（钥匙串不可用，重启后需重新填）',
};

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* 存储不可用：忽略 */
  }
}

export function browserBackend(): VaultBackend {
  const read = (): Record<string, string> => {
    try {
      const o = JSON.parse(lsGet(BROWSER_KEY) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  };
  return {
    kind: 'browser',
    async get(name) {
      const v = read()[name];
      return typeof v === 'string' ? v : '';
    },
    async set(name, value) {
      const o = read();
      if (value) o[name] = value;
      else delete o[name];
      lsSet(BROWSER_KEY, Object.keys(o).length ? JSON.stringify(o) : null);
    },
    async del(name) {
      const o = read();
      delete o[name];
      lsSet(BROWSER_KEY, Object.keys(o).length ? JSON.stringify(o) : null);
    },
  };
}

export function memoryBackend(): VaultBackend {
  const m = new Map<string, string>();
  return {
    kind: 'memory',
    async get(name) {
      return m.get(name) || '';
    },
    async set(name, value) {
      if (value) m.set(name, value);
      else m.delete(name);
    },
    async del(name) {
      m.delete(name);
    },
  };
}

export function androidBackend(a: AndroidVault): VaultBackend {
  return {
    kind: 'android',
    async get(name) {
      const v = a.get(name);
      if (v === ERR) throw new Error('keystore read failed');
      return v || '';
    },
    async set(name, value) {
      if (!a.set(name, value)) throw new Error('keystore write failed');
    },
    async del(name) {
      a.set(name, '');
    },
  };
}

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
export function keychainBackend(invoke: Invoke): VaultBackend {
  // 不把 Rust 端的错误原文往外抛（可能带平台细节），统一成固定文案
  const wrap = async <T,>(p: Promise<T>, what: string): Promise<T> => {
    try {
      return await p;
    } catch {
      throw new Error(`keychain ${what} failed`);
    }
  };
  return {
    kind: 'keychain',
    async get(name) {
      return (await wrap(invoke<string | null>('secret_get', { name }), 'read')) || '';
    },
    async set(name, value) {
      if (!value) await wrap(invoke('secret_delete', { name }), 'delete');
      else await wrap(invoke('secret_set', { name, value }), 'write');
    },
    async del(name) {
      await wrap(invoke('secret_delete', { name }), 'delete');
    },
  };
}

/** 按运行环境挑后端：安卓接口 > Tauri 钥匙串 > 浏览器 */
export async function detectBackend(w: unknown = typeof window !== 'undefined' ? window : undefined): Promise<VaultBackend> {
  const win = w as (Record<string, unknown> & { LinganVault?: AndroidVault }) | undefined;
  if (!win) return memoryBackend();
  if (win.LinganVault && typeof win.LinganVault.get === 'function') return androidBackend(win.LinganVault);
  if ('__TAURI_INTERNALS__' in win) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const b = keychainBackend(invoke as Invoke);
      await b.get('chat.apiKey'); // 探一下：钥匙串能用才选它
      return b;
    } catch {
      return memoryBackend();
    }
  }
  return browserBackend();
}
