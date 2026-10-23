import { Seg } from '../components/rw/Seg';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { testConnection } from '../lib/ai';
import { clearAll, exportAll, importAll } from '../lib/db';
import { embedAllMissing } from '../lib/enrich';
import { androidFiles, deliverZip, readFileText, saveTextFile, type ZipTarget } from '../lib/files';
import { exportObsidianZip, vaultZipName } from '../lib/obsidian';
import { db } from '../lib/db';
import { PRESETS, embedConfig, withPreset, type Settings } from '../lib/settings';
import { useApp } from '../lib/store';
import { DisplayTitle } from '../components/DisplayTitle';
import { THEME_LABEL, THEME_ORDER } from '../lib/theme';

export const APP_VERSION = __APP_VERSION__;

export function SettingsView() {
  const { settings, setSettings, toast, confirm } = useApp();
  const counts = useLiveQuery(async () => ({ items: await db.items.count(), devs: await db.developments.count(), imgs: await db.images.count() }), []);
  const [s, setS] = useState<Settings>(settings);
  const [testing, setTesting] = useState(false);
  const [embedding, setEmbedding] = useState<string>('');
  const [showKey, setShowKey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [withSamples, setWithSamples] = useState(false);
  const [vaulting, setVaulting] = useState(false);
  const onAndroid = !!androidFiles();
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const preset = PRESETS.find((p) => p.id === s.preset) || PRESETS[PRESETS.length - 1];

  function applyPreset(id: string) {
    setS((x) => withPreset(x, id));
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

  async function doObsidian(target: ZipTarget) {
    if (vaulting) return;
    setVaulting(true);
    try {
      const now = Date.now();
      const { zip, stats } = await exportObsidianZip(db, { includeSamples: withSamples, now });
      if (!stats.items && !stats.branches) {
        toast(stats.skippedSamples ? '只有示例穗：勾上「包含示例穗」再导出' : '穗仓是空的，没有可导出的', 'err');
        return;
      }
      const where = await deliverZip(vaultZipName(now), zip, target);
      if (where) toast(`已导出 ${stats.items} 穗、${stats.branches} 根新枝${target === 'downloads' ? `（${where}）` : ''}`);
    } catch (e) {
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setVaulting(false);
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
    if (!(await confirm({ title: '清空所有穗和新枝？', body: '此操作不能撤销。建议先导出备份。', ok: '清空', cancel: '留着', danger: true }))) return;
    if (!(await confirm({ title: '再确认一次：真的清空？', ok: '真的清空', cancel: '算了', danger: true }))) return;
    await clearAll();
    toast('已清空');
  }

  const SECTIONS: Array<[string, string, string]> = [
    ['set-ai', 'AI 服务', PRESETS.find((p) => p.id === settings.preset)?.name.replace(/（.*）/, '') || ''],
    ['set-embed', '向量', settings.embed.model || '不用'],
    ['set-look', '外观', THEME_LABEL[settings.theme]],
    ['set-data', '备份与导入', counts ? `${counts.items} 穗 · ${counts.devs} 新枝` : ''],
    ['set-obsidian', '搬去 Obsidian', 'Markdown'],
    ['set-about', '关于', `v${APP_VERSION}`],
  ];
  return (
    <section className="view settings">
      <DisplayTitle title="设置" />
      <div className="settings-layout">
        <nav className="settings-index" aria-label="设置分组">
          {SECTIONS.map(([id, label, value]) => (
            <button key={id} className="set-link" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className="set-link-k">{label}</span>
              <span className="set-link-v">{value} →</span>
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <section className="set-sec" id="set-ai">
            <h2 className="sec-title">AI 服务</h2>
            <p className="meta-text">key 只存在这台手机 / 电脑上，不会上传到 Glean。</p>
            <div className="radio-list" role="radiogroup" aria-label="AI 服务">
              {PRESETS.map((p) => (
                <button key={p.id} role="radio" aria-checked={s.preset === p.id} className={`radio chip${s.preset === p.id ? ' on' : ''}`} onClick={() => applyPreset(p.id)}>
                  <i className="sq" aria-hidden />
                  <span className="radio-name">{p.name}</span>
                </button>
              ))}
            </div>
            <p className="hint meta-text">
              {preset.note}
              {preset.keyUrl && (
                <>
                  {' '}获取密钥：<span className="sel">{preset.keyUrl}</span>
                </>
              )}
            </p>
            <label className="field">
              <span className="label">接口地址</span>
              <input value={s.chat.baseUrl} onChange={(e) => setChat('baseUrl', e.target.value.trim())} placeholder="https://…/v1" />
            </label>
            <label className="field">
              <span className="label">API Key（只保存在本机）</span>
              <div className="inline">
                <input type={showKey ? 'text' : 'password'} value={s.chat.apiKey} onChange={(e) => setChat('apiKey', e.target.value.trim())} placeholder="粘贴你的密钥" autoComplete="off" />
                <button type="button" className="btn text" onClick={() => setShowKey((x) => !x)}>
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
              <span className="label">创意温度 <span className="num">{s.temperature.toFixed(1)}</span>（越高越野）</span>
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
              <button className="btn primary" onClick={save} disabled={!dirty}>
                保存
              </button>
              <button className="btn text" onClick={test} disabled={testing || !s.chat.apiKey}>
                {testing ? '测试中…' : '测试连接'}
              </button>
            </div>
          </section>

          <section className="set-sec" id="set-embed">
            <h2 className="sec-title">向量</h2>
            <p className="meta-text">让「跳跃度」更准，可选。没有向量时用文字相似度近似。硅基流动的 BAAI/bge-m3 免费。</p>
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
              <button className="btn primary" onClick={save} disabled={!dirty}>
                保存
              </button>
              <button className="btn text" onClick={doEmbed} disabled={!embedConfig(s) || !!embedding}>
                {embedding ? `向量化 ${embedding}` : '补全全部向量'}
              </button>
            </div>
          </section>

          <section className="set-sec" id="set-look">
            <h2 className="sec-title">外观</h2>
            <div className="kv-row">
              <span className="label">主题</span>
              <Seg
                id="theme"
                className="seg theme-seg"
                role="radiogroup"
                label="主题"
                value={settings.theme}
                options={THEME_ORDER.map((p) => [p, THEME_LABEL[p]] as [typeof p, string])}
                onPick={(p) => {
                  setS((x) => ({ ...x, theme: p }));
                  setSettings({ ...settings, theme: p });
                }}
              />
            </div>
            <p className="hint meta-text">只有黑、白两套。跟随系统时随手机 / 电脑的深色模式切换。系统开启「减少动态效果」时，弹簧、淡入、流光这些动效全部关闭。</p>
          </section>

          <section className="set-sec" id="set-data">
            <h2 className="sec-title">备份与导入</h2>
            <dl className="kv">
              <div>
                <dt>本机</dt>
                <dd className="num backup-counts">{counts ? `${counts.items} 穗 · ${counts.devs} 新枝 · ${counts.imgs} 张图` : '…'}</dd>
              </div>
            </dl>
            <div className="table action-table">
              <button className="trow" onClick={doExport}>
                <span className="tc tc-title">导出备份</span>
                <span className="tc tc-src">全部穗与新枝，可在另一台设备导入</span>
                <span className="tc tc-date">.json</span>
              </button>
              <button className="trow" onClick={() => fileRef.current?.click()}>
                <span className="tc tc-title">导入备份</span>
                <span className="tc tc-src">合并进来，不覆盖现有的</span>
                <span className="tc tc-date">.json</span>
              </button>
              <button className="trow danger" onClick={wipe}>
                <span className="tc tc-title">清空</span>
                <span className="tc tc-src">删掉这台设备上的所有穗和新枝</span>
                <span className="tc tc-date" />
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = ''; }} />
            <p className="hint meta-text">手机和电脑之间可以用「导出 → 导入」搬运。</p>
          </section>

          <section className="set-sec obsidian-panel" id="set-obsidian">
            <h2 className="sec-title">搬去 Obsidian</h2>
            <p className="meta-text">导出成 Markdown + 图片的 ZIP。解压后在 Obsidian 里「打开文件夹作为仓库」：每穗一篇笔记（按类型分文件夹），图片在 attachments/，新枝用双链指回它的来源穗，从「拾穗索引」开始逛。</p>
            <label className="check">
              <input className="obsidian-samples" type="checkbox" checked={withSamples} onChange={(e) => setWithSamples(e.target.checked)} /> 包含示例穗
            </label>
            <div className="actions">
              {onAndroid ? (
                <>
                  <button className="btn primary obsidian-share" onClick={() => doObsidian('share')} disabled={vaulting}>
                    {vaulting ? '打包中…' : '分享 ZIP…'}
                  </button>
                  <button className="btn text obsidian-downloads" onClick={() => doObsidian('downloads')} disabled={vaulting}>
                    存到「下载」
                  </button>
                </>
              ) : (
                <button className="btn primary obsidian-export" onClick={() => doObsidian('save')} disabled={vaulting}>
                  {vaulting ? '打包中…' : '导出为 Markdown'}
                </button>
              )}
            </div>
          </section>

          <section className="set-sec" id="set-about">
            <h2 className="sec-title">关于</h2>
            <dl className="kv">
              <div>
                <dt>版本</dt>
                <dd className="num">v{APP_VERSION}</dd>
              </div>
              <div>
                <dt>署名</dt>
                <dd>Q1f730</dd>
              </div>
              <div>
                <dt>隐私</dt>
                <dd>素材只存在本机</dd>
              </div>
              <div>
                <dt>快捷键</dt>
                <dd>N 速记展开 · Ctrl+Shift+L 全局速记（桌面）</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </section>
  );
}
