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
  theme: 'paper' | 'darkroom';
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

const KEY = 'lingan.settings.v1';

export function defaultSettings(): Settings {
  const p = PRESETS[0];
  return {
    preset: p.id,
    chat: { ...p.chat, apiKey: '' },
    embed: { baseUrl: '', apiKey: '', model: '', sameAsChat: true },
    theme: 'paper',
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
    return { ...d, ...s, chat: { ...d.chat, ...(s.chat || {}) }, embed: { ...d.embed, ...(s.embed || {}) } };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function aiReady(s: Settings): boolean {
  return !!(s.chat.baseUrl && s.chat.apiKey && s.chat.chatModel);
}

export function embedConfig(s: Settings): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = s.embed.sameAsChat ? s.embed.baseUrl || s.chat.baseUrl : s.embed.baseUrl;
  const apiKey = s.embed.sameAsChat ? s.chat.apiKey : s.embed.apiKey;
  if (!s.embed.model || !baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model: s.embed.model };
}
