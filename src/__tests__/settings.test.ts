import { beforeEach, describe, expect, it } from 'vitest';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

describe('设置迁移（v0.16）', () => {
  it('旧的 phase / fieldStill 换成 theme，其余设置原样保留', async () => {
    const { loadSettings } = await import('../lib/settings');
    store.set('lingan.settings.v1', JSON.stringify({ phase: 'night', fieldStill: true, temperature: 1.3, chat: { apiKey: 'k' } }));
    const s = loadSettings() as unknown as Record<string, unknown>;
    expect(s.theme).toBe('dark');
    expect('phase' in s).toBe(false);
    expect('fieldStill' in s).toBe(false);
    expect(s.temperature).toBe(1.3);
    expect((s.chat as { apiKey: string }).apiKey).toBe('k');
  });
  it('换预设：换家清 key，同一家保留', async () => {
    const { defaultSettings, withPreset } = await import('../lib/settings');
    const s = { ...defaultSettings(), chat: { ...defaultSettings().chat, apiKey: 'abc' } };
    expect(withPreset(s, 'zhipu').chat.apiKey).toBe('abc');
    const g = withPreset(s, 'gemini');
    expect(g.preset).toBe('gemini');
    expect(g.chat.apiKey).toBe('');
    expect(g.chat.chatModel).toBe('gemini-2.5-flash');
  });
});
