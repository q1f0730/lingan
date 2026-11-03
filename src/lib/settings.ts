import { themeFromLegacy, type ThemePref } from './theme';
import { detectBackend, type SecretName, type VaultBackend, type VaultKind } from './vault';
export interface Provider {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  visionModel: string;
  extraBody?: string; // JSON merged into chat body
}
export interface Settings {
  preset: string;
  chat: Provider;
  embed: { baseUrl: string; apiKey: string; model: string; sameAsChat: boolean };
  theme: ThemePref; // v0.16：跟随系统 | 白 | 黑
  temperature: number;
  autoCaption: boolean;
  autoEmbed: boolean;
  /** v0.24 0209 手机连电脑上的本地模型：上次填的电脑地址（局域网 IP / *.local） */
  localHost?: string;
  /** v0.24 0242 私密穗也可以发给本地模型（接口在本机 / 局域网时才生效；云端永远不发） */
  privateLocal?: boolean;
  /** v0.24 三枝不撞车：两根新枝相似度的上限（字面 = 去掉素材名和固定句式后的二元组 Jaccard；向量 = 余弦） */
  distinct?: { text: number; vector: number };
  /** v0.24 0210 我的文风：最多 3 段、每段 300 字，开着时作为语气样本写进嫁接提示词 */
  style?: { on: boolean; samples: string[] };
}

export const DISTINCT_DEFAULT = { text: 0.45, vector: 0.9 };
export const STYLE_MAX = 3;
export const STYLE_LEN = 300;
export function distinctOf(s: Pick<Settings, 'distinct'>): { text: number; vector: number } {
  const d = s.distinct || DISTINCT_DEFAULT;
  const clamp = (x: unknown, lo: number, hi: number, dft: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : dft);
  return { text: clamp(d.text, 0.1, 0.95, DISTINCT_DEFAULT.text), vector: clamp(d.vector, 0.5, 0.99, DISTINCT_DEFAULT.vector) };
}
/** 开着、且有内容的文风样本（每段截到 300 字，最多 3 段） */
export function styleSamples(s: Pick<Settings, 'style'>): string[] {
  if (!s.style?.on) return [];
  return (s.style.samples || []).map((x) => String(x || '').trim().slice(0, STYLE_LEN)).filter(Boolean).slice(0, STYLE_MAX);
}

export interface Preset {
  id: string;
  name: string;
  note: string;
  chat: Omit<Provider, 'apiKey'>;
  embed: { baseUrl: string; model: string };
  keyUrl?: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'zhipu',
    name: '智谱 GLM（免费）',
    note: 'glm-4.7-flash 对话免费，glm-4.6v-flash 看图免费。手机号注册即可。',
    chat: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', chatModel: 'glm-4.7-flash', visionModel: 'glm-4.6v-flash', extraBody: '{"thinking":{"type":"disabled"}}' },
    embed: { baseUrl: '', model: '' },
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
  {
    id: 'siliconflow',
    name: '硅基流动（免费模型）',
    note: 'GLM-4-9B 对话、bge-m3 向量免费；需实名认证。',
    chat: { baseUrl: 'https://api.siliconflow.cn/v1', chatModel: 'THUDM/GLM-4-9B-0414', visionModel: '', extraBody: '' },
    embed: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3' },
    keyUrl: 'https://cloud.siliconflow.cn/me/account/ak',
  },
  {
    id: 'gemini',
    name: 'Google Gemini（免费层）',
    note: '需能访问 Google。gemini-2.5-flash 免费层有限速。',
    chat: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', chatModel: 'gemini-2.5-flash', visionModel: 'gemini-2.5-flash', extraBody: '' },
    embed: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-embedding-001' },
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'local',
    name: '本地模型（LM Studio / Ollama）',
    note: '模型跑在你自己的电脑上：不要密钥、不联网也能用、素材不出门。点「探测」自动找 LM Studio（1234）和 Ollama（11434）；手机填电脑的局域网 IP 也能用电脑上的模型。',
    chat: { baseUrl: 'http://127.0.0.1:1234/v1', chatModel: '', visionModel: '', extraBody: '' },
    embed: { baseUrl: '', model: '' },
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    note: '任何 OpenAI 兼容接口，例如本地 LM Studio：http://电脑IP:1234/v1',
    chat: { baseUrl: '', chatModel: '', visionModel: '', extraBody: '' },
    embed: { baseUrl: '', model: '' },
  },
];

const KEY = 'lingan.settings.v1'; // 不改键名：升级后保留旧设置

export function defaultSettings(): Settings {
  const p = PRESETS[0];
  return {
    preset: p.id,
    chat: { ...p.chat, apiKey: '' },
    embed: { baseUrl: '', apiKey: '', model: '', sameAsChat: true },
    theme: 'auto',
    temperature: 1.0,
    autoCaption: true,
    autoEmbed: true,
  };
}

// v0.20：密钥另存系统钥匙串。启动时 initSecrets() 读进内存缓存，loadSettings 再合进去；
// localStorage 里的设置只剩非敏感字段。
const secrets: Record<SecretName, string> = { 'chat.apiKey': '', 'embed.apiKey': '' };
let backend: VaultBackend | null = null;
let keysInSettings = true; // 还没接上持久钥匙串（或只剩内存）时，密钥仍跟旧版一样留在设置里，免得丢
let writeChain: Promise<unknown> = Promise.resolve();

export function vaultKind(): VaultKind | null {
  return backend?.kind ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rawSettings(): Record<string, any> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

/** 去掉密钥后的可持久化设置（导出 / 诊断 / localStorage 都只用这个） */
export function stripSecrets<T extends { chat?: { apiKey?: string }; embed?: { apiKey?: string } }>(s: T): T {
  const o = JSON.parse(JSON.stringify(s));
  if (o.chat) o.chat.apiKey = '';
  if (o.embed) o.embed.apiKey = '';
  return o;
}

/**
 * 启动时调用一次：选钥匙串后端、把旧版留在 localStorage 的密钥搬进去并清掉、读出缓存。
 * 失败不抛：退回旧行为（密钥留在设置里），保证不丢 key、不白屏。
 */
export async function initSecrets(pick: () => Promise<VaultBackend> = () => detectBackend()): Promise<{ kind: VaultKind; migrated: number }> {
  let b: VaultBackend;
  try {
    b = await pick();
  } catch {
    const { memoryBackend } = await import('./vault');
    b = memoryBackend();
  }
  backend = b;
  const persistent = b.kind !== 'memory';
  const raw = rawSettings();
  let migrated = 0;
  if (!raw) {
    // 设置被清掉 = 重置：钥匙串里残留的旧密钥也一起清，避免默认服务 + 旧 key 的错配
    secrets['chat.apiKey'] = '';
    secrets['embed.apiKey'] = '';
    if (persistent) for (const n of ['chat.apiKey', 'embed.apiKey'] as SecretName[]) await b.del(n).catch(() => {});
    keysInSettings = !persistent;
    return { kind: b.kind, migrated };
  }
  const legacy: Record<SecretName, string> = { 'chat.apiKey': String(raw.chat?.apiKey || ''), 'embed.apiKey': String(raw.embed?.apiKey || '') };
  if (!persistent) {
    keysInSettings = true;
    secrets['chat.apiKey'] = legacy['chat.apiKey'];
    secrets['embed.apiKey'] = legacy['embed.apiKey'];
    return { kind: b.kind, migrated };
  }
  let ok = true;
  for (const n of ['chat.apiKey', 'embed.apiKey'] as SecretName[]) {
    if (legacy[n]) {
      try {
        await b.set(n, legacy[n]);
        migrated++;
      } catch {
        ok = false;
      }
    }
  }
  if (!ok) {
    // 钥匙串写不进去：保持旧行为
    keysInSettings = true;
    secrets['chat.apiKey'] = legacy['chat.apiKey'];
    secrets['embed.apiKey'] = legacy['embed.apiKey'];
    return { kind: b.kind, migrated: 0 };
  }
  keysInSettings = false;
  for (const n of ['chat.apiKey', 'embed.apiKey'] as SecretName[]) {
    secrets[n] = legacy[n] || (await b.get(n).catch(() => ''));
  }
  if (migrated) {
    try {
      localStorage.setItem(KEY, JSON.stringify(stripSecrets(raw)));
    } catch {
      /* ignore */
    }
  }
  return { kind: b.kind, migrated };
}

export function loadSettings(): Settings {
  try {
    const s = rawSettings();
    if (!s) return defaultSettings();
    const d = defaultSettings();
    s.theme = themeFromLegacy(s); // v0.16：旧的 phase（随时间变色）换成 跟随系统 / 白 / 黑
    delete s.phase;
    delete s.fieldStill;
    const out: Settings = { ...d, ...s, chat: { ...d.chat, ...(s.chat || {}) }, embed: { ...d.embed, ...(s.embed || {}) } };
    if (!keysInSettings) {
      out.chat.apiKey = secrets['chat.apiKey'];
      out.embed.apiKey = secrets['embed.apiKey'];
    }
    return out;
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings) {
  if (keysInSettings) {
    secrets['chat.apiKey'] = s.chat.apiKey;
    secrets['embed.apiKey'] = s.embed.apiKey;
    localStorage.setItem(KEY, JSON.stringify(s));
    return;
  }
  localStorage.setItem(KEY, JSON.stringify(stripSecrets(s)));
  const b = backend;
  if (!b) return;
  for (const [n, v] of [['chat.apiKey', s.chat.apiKey], ['embed.apiKey', s.embed.apiKey]] as Array<[SecretName, string]>) {
    if (secrets[n] === v) continue;
    secrets[n] = v;
    // 串行写，保证最后一次输入落盘
    writeChain = writeChain.then(() => b.set(n, v)).catch(() => {
      reportVaultError?.();
    });
  }
}

/** 等待未完成的钥匙串写入（测试 / 退出前用） */
export function flushSecrets(): Promise<unknown> {
  return writeChain;
}

let reportVaultError: (() => void) | null = null;
export function onVaultError(f: () => void) {
  reportVaultError = f;
}

/** 测试用：回到未初始化状态 */
export function _resetSecretsForTest() {
  secrets['chat.apiKey'] = '';
  secrets['embed.apiKey'] = '';
  backend = null;
  keysInSettings = true;
  writeChain = Promise.resolve();
}

/** 不要密钥也能用的预设：自定义（自己负责）、本地模型 */
export function keyOptional(s: Pick<Settings, 'preset'>): boolean {
  return s.preset === 'custom' || s.preset === 'local';
}
export function aiReady(s: Settings): boolean {
  return !!(s.chat.baseUrl && s.chat.chatModel && (s.chat.apiKey || keyOptional(s)));
}

export function embedConfig(s: Settings): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = s.embed.sameAsChat ? s.embed.baseUrl || s.chat.baseUrl : s.embed.baseUrl;
  const apiKey = s.embed.sameAsChat ? s.chat.apiKey : s.embed.apiKey;
  if (!s.embed.model || !baseUrl || (!apiKey && !keyOptional(s))) return null;
  return { baseUrl, apiKey, model: s.embed.model };
}

/** 换 AI 服务预设：换了服务就清掉旧 key（同一家保留） */
export function withPreset(x: Settings, id: string): Settings {
  const p = PRESETS.find((q) => q.id === id);
  if (!p) return x;
  return {
    ...x,
    preset: id,
    chat: { ...x.chat, ...p.chat, apiKey: x.preset === id ? x.chat.apiKey : '' },
    embed: { ...x.embed, baseUrl: p.embed.baseUrl, model: p.embed.model, sameAsChat: true },
  };
}
