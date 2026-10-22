import { useRef, useState } from 'react';
import { testConnection } from '../lib/ai';
import { db, exportAll, importAll } from '../lib/db';
import { embedAllMissing } from '../lib/enrich';
import { readFileText, saveTextFile } from '../lib/files';
import { PRESETS, embedConfig, type Settings } from '../lib/settings';
import { useApp } from '../lib/store';
import { PageTitle } from '../components/PageTitle';
import { PHASE_LABEL, PHASE_ORDER, type PhasePref } from '../lib/phases';

export const APP_VERSION = __APP_VERSION__;

export function SettingsView() {
  const { settings, setSettings, toast } = useApp();
  const [s, setS] = useState<Settings>(settings);
  const [testing, setTesting] = useState(false);
  const [embedding, setEmbedding] = useState<string>('');
  const [showKey, setShowKey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const preset = PRESETS.find((p) => p.id === s.preset) || PRESETS[PRESETS.length - 1];

  function applyPreset(id: string) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setS((x) => ({
      ...x,
      preset: id,
      chat: { ...x.chat, ...p.chat, apiKey: x.preset === id ? x.chat.apiKey : '' },
      embed: { ...x.embed, baseUrl: p.embed.baseUrl, model: p.embed.model, sameAsChat: true },
    }));
  }
  const setChat = (k: keyof Settings['chat'], v: string) => setS((x) => ({ ...x, chat: { ...x.chat, [k]: v } }));
  const setEmbed = (k: keyof Settings['embed'], v: string | boolean) => setS((x) => ({ ...x, embed: { ...x.embed, [k]: v } }));

  function save() {
    setSettings(s);
    toast('设置已保存');
  }

  async function test() {
    setTesting(true);
    try {
      const r = await testConnection(s);
      toast(`连接成功：${r}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setTesting(false);
    }
  }

  async function doEmbed() {
    setSettings(s);
    setEmbedding('开始…');
    const r = await embedAllMissing(s, (d, t) => setEmbedding(`${d}/${t}`));
    setEmbedding('');
    if (r.error) toast(`向量化中断：${r.error}`, 'err');
    else toast(`已向量化 ${r.done} 穗`);
  }

  async function doExport() {
    try {
      const b = await exportAll();
      const name = `glean-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const where = await saveTextFile(name, JSON.stringify(b));
      if (where) toast(`已导出 ${b.items.length} 穗`);
    } catch (e) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  }

  async function doImport(f?: File | null) {
    if (!f) return;
    try {
      const txt = await readFileText(f);
      const r = await importAll(JSON.parse(txt));
      toast(`已导入 ${r.items} 穗、${r.developments} 根新枝`);
    } catch (e) {
      toast('导入失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  }

  async function wipe() {
    if (!confirm('清空所有穗和新枝？此操作不能撤销。建议先导出备份。')) return;
    if (!confirm('再确认一次：真的清空？')) return;
    await db.items.clear();
    await db.developments.clear();
    toast('已清空');
  }

  return (
    <section className="view">
      <PageTitle title="设置" whisper="Tend the field your way" />

      <div className="paper panel">
        <div className="label">AI 服务</div>
        <div className="chips wrap">
          {PRESETS.map((p) => (
            <button key={p.id} className={`chip${s.preset === p.id ? ' on' : ''}`} onClick={() => applyPreset(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="hint">
          {preset.note}
          {preset.keyUrl && (
            <>
              {' '}获取密钥：<span className="sel">{preset.keyUrl}</span>
            </>
          )}
        </p>
        <label className="field">
          <span className="label">接口地址 Base URL</span>
          <input value={s.chat.baseUrl} onChange={(e) => setChat('baseUrl', e.target.value.trim())} placeholder="https://…/v1" />
        </label>
        <label className="field">
          <span className="label">API Key（只保存在本机）</span>
          <div className="inline">
            <input type={showKey ? 'text' : 'password'} value={s.chat.apiKey} onChange={(e) => setChat('apiKey', e.target.value.trim())} placeholder="粘贴你的密钥" autoComplete="off" />
            <button type="button" className="btn ghost small" onClick={() => setShowKey((x) => !x)}>
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
        </label>
        <div className="row2">
          <label className="field">
            <span className="label">对话模型</span>
            <input value={s.chat.chatModel} onChange={(e) => setChat('chatModel', e.target.value.trim())} />
          </label>
          <label className="field">
            <span className="label">看图模型（可空）</span>
            <input value={s.chat.visionModel} onChange={(e) => setChat('visionModel', e.target.value.trim())} />
          </label>
        </div>
        <label className="field">
          <span className="label">创意温度 {s.temperature.toFixed(1)}（越高越野）</span>
          <input type="range" min={0.3} max={1.5} step={0.1} value={s.temperature} onChange={(e) => setS((x) => ({ ...x, temperature: parseFloat(e.target.value) }))} />
        </label>
        <details>
          <summary>高级</summary>
          <label className="field">
            <span className="label">附加请求参数（JSON）</span>
            <input value={s.chat.extraBody || ''} onChange={(e) => setChat('extraBody', e.target.value)} placeholder='{"thinking":{"type":"disabled"}}' />
          </label>
          <label className="check">
            <input type="checkbox" checked={s.autoCaption} onChange={(e) => setS((x) => ({ ...x, autoCaption: e.target.checked }))} /> 保存图片后自动让 AI 看图打标签
          </label>
        </details>
        <div className="actions">
          <button className="btn ghost" onClick={test} disabled={testing || !s.chat.apiKey}>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button className="btn primary" onClick={save} disabled={!dirty}>
            保存
          </button>
        </div>
      </div>

      <div className="paper panel">
        <div className="label">向量（让「跳跃度」更准，可选）</div>
        <p className="hint">没有向量时用文字相似度近似。硅基流动的 BAAI/bge-m3 免费。</p>
        <label className="check">
          <input type="checkbox" checked={s.embed.sameAsChat} onChange={(e) => setEmbed('sameAsChat', e.target.checked)} /> 与对话使用同一个服务和密钥
        </label>
        {!s.embed.sameAsChat && (
          <>
            <label className="field">
              <span className="label">向量接口地址</span>
              <input value={s.embed.baseUrl} onChange={(e) => setEmbed('baseUrl', e.target.value.trim())} placeholder="https://api.siliconflow.cn/v1" />
            </label>
            <label className="field">
              <span className="label">向量 API Key</span>
              <input type="password" value={s.embed.apiKey} onChange={(e) => setEmbed('apiKey', e.target.value.trim())} autoComplete="off" />
            </label>
          </>
        )}
        <label className="field">
          <span className="label">向量模型（空 = 不用）</span>
          <input value={s.embed.model} onChange={(e) => setEmbed('model', e.target.value.trim())} placeholder="BAAI/bge-m3" />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoEmbed} onChange={(e) => setS((x) => ({ ...x, autoEmbed: e.target.checked }))} /> 新拾的穗自动向量化
        </label>
        <div className="actions">
          <button className="btn ghost" onClick={doEmbed} disabled={!embedConfig(s) || !!embedding}>
            {embedding ? `向量化 ${embedding}` : '补全全部向量'}
          </button>
          <button className="btn primary" onClick={save} disabled={!dirty}>
            保存
          </button>
        </div>
      </div>

      <div className="paper panel">
        <div className="label">外观 · 一天里的颜色</div>
        <div className="seg wrap phase-seg">
          {(['auto', ...PHASE_ORDER] as PhasePref[]).map((p) => (
            <button
              key={p}
              className={settings.phase === p ? 'on' : ''}
              onClick={() => {
                setS((x) => ({ ...x, phase: p }));
                setSettings({ ...settings, phase: p });
              }}
            >
              {p === 'auto' ? '跟随时间' : PHASE_LABEL[p]}
            </button>
          ))}
        </div>
        <p className="hint">跟随时间：清晨暖橙、白天麦金、黄昏玫瑰、夜晚萤火。</p>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.fieldStill}
            onChange={(e) => {
              setS((x) => ({ ...x, fieldStill: e.target.checked }));
              setSettings({ ...settings, fieldStill: e.target.checked });
            }}
          />{' '}
          麦田静止（更省电；系统开启「减少动态效果」时会自动静止）
        </label>
      </div>

      <div className="paper panel">
        <div className="label">数据（全部保存在这台设备上）</div>
        <div className="actions left">
          <button className="btn ghost" onClick={doExport}>
            导出备份
          </button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>
            导入备份
          </button>
          <button className="btn ghost danger" onClick={wipe}>
            清空
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <p className="hint">手机和电脑之间可以用「导出 → 导入」搬运。</p>
      </div>

      <p className="colophon">
        拾穗 <i>Glean</i> v{APP_VERSION} · by Q1f730 · 数据只在本机
      </p>
    </section>
  );
}
