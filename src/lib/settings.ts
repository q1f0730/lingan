import { themeFromLegacy, type ThemePref } from './theme';
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

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings();
    const s = JSON.parse(raw);
    const d = defaultSettings();
    s.theme = themeFromLegacy(s); // v0.16：旧的 phase（随时间变色）换成 跟随系统 / 白 / 黑
    delete s.phase;
    delete s.fieldStill;
    return { ...d, ...s, chat: { ...d.chat, ...(s.chat || {}) }, embed: { ...d.embed, ...(s.embed || {}) } };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function aiReady(s: Settings): boolean {
  return !!(s.chat.baseUrl && s.chat.chatModel && (s.chat.apiKey || s.preset === 'custom'));
}

export function embedConfig(s: Settings): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = s.embed.sameAsChat ? s.embed.baseUrl || s.chat.baseUrl : s.embed.baseUrl;
  const apiKey = s.embed.sameAsChat ? s.chat.apiKey : s.embed.apiKey;
  if (!s.embed.model || !baseUrl || (!apiKey && s.preset !== 'custom')) return null;
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
