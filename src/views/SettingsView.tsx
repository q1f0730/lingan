import { Seg } from '../components/rw/Seg';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { testConnection } from '../lib/ai';
import { clearAll, liveCounts } from '../lib/db';
import { applyImport, exportGlean, gleanName, GLEAN_MIME, MODE_LABEL, planImport, previewImport, readBackupFile, type ImportCounts, type ImportMode, type Incoming } from '../lib/backup';
import { TrashPanel } from '../components/Trash';
import { CapturePanel, captureSummary } from '../components/CapturePanel';
import { embedAllMissing } from '../lib/enrich';
import { androidFiles, deliverZip, openFileSink, type ZipTarget } from '../lib/files';
import { exportObsidianZip, vaultZipName } from '../lib/obsidian';
import { db } from '../lib/db';
import { PRESETS, embedConfig, vaultKind, withPreset, type Settings } from '../lib/settings';
import { VAULT_LABEL } from '../lib/vault';
import { clearErrors, isSafeMode, readErrors, setSafeMode } from '../lib/errlog';
import { collectDiagnostics } from '../lib/diagcollect';
import { copyText } from '../components/ErrorBoundary';
import { useApp } from '../lib/store';
import { DisplayTitle } from '../components/DisplayTitle';
import { THEME_LABEL, THEME_ORDER } from '../lib/theme';

export const APP_VERSION = __APP_VERSION__;

export function SettingsView() {
  const { settings, setSettings, toast, confirm } = useApp();
  const counts = useLiveQuery(() => liveCounts(db), []);
  const [backing, setBacking] = useState('');
  const [pending, setPending] = useState<{ name: string; inc: Incoming; preview: Record<ImportMode, ImportCounts>; mode: ImportMode } | null>(null);
  const [importing, setImporting] = useState(false);
  const [s, setS] = useState<Settings>(settings);
  const [testing, setTesting] = useState(false);
  const [embedding, setEmbedding] = useState<string>('');
  const [showKey, setShowKey] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [withSamples, setWithSamples] = useState(false);
  const [vaulting, setVaulting] = useState(false);
  const onAndroid = !!androidFiles();
  const [errCount, setErrCount] = useState(() => readErrors().length);
  const vk = vaultKind();
  const safe = isSafeMode();
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

  // v0.21 .glean 流式备份：一张一张读原图写出去，不在内存里拼整库
  async function doExport(target: ZipTarget = 'save') {
    if (backing) return;
    const now = Date.now();
    let sink: Awaited<ReturnType<typeof openFileSink>> = null;
    try {
      sink = await openFileSink(gleanName(now), { mime: GLEAN_MIME, ext: 'glean', label: '拾穗备份', target, shareTitle: '拾穗备份' });
      if (!sink) return;
      setBacking('0%');
      const t0 = performance.now();
      const st = await exportGlean(sink, db, { now, appVersion: APP_VERSION, onProgress: (a, t) => setBacking(`${Math.round((a / Math.max(1, t)) * 100)}%`) });
      const where = await sink.close();
      (window as unknown as { __gleanBackup?: unknown }).__gleanBackup = { ...st, ms: Math.round(performance.now() - t0) };
      if (where) toast(`已导出 ${st.items} 穗 · ${st.developments} 新枝 · ${st.images} 张图${target === 'downloads' ? `（${where}）` : ''}`);
    } catch (e) {
      await sink?.abort();
      toast('导出失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBacking('');
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

  // v0.21 导入：先读目录与条目、按 uid 去重算出三种模式各会怎样，选好再写
  async function doImport(f?: File | null) {
    if (!f) return;
    try {
      const inc = await readBackupFile(f);
      const preview = await previewImport(inc, db);
      setPending({ name: f.name, inc, preview, mode: 'merge' });
      requestAnimationFrame(() => document.querySelector('.import-preview')?.scrollIntoView({ block: 'nearest' }));
    } catch (e) {
      toast('导入失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  }

  async function runImport() {
    if (!pending || importing) return;
    const { inc, mode } = pending;
    const c = pending.preview[mode];
    if (mode === 'replace' && (c.items.trash || c.developments.trash)) {
      const ok = await confirm({ title: '用这份备份替换本机？', body: `本机不在备份里的 ${c.items.trash} 穗、${c.developments.trash} 根新枝会移进回收站（30 天内可恢复），同一件以备份为准。`, ok: '替换', cancel: '算了', danger: true });
      if (!ok) return;
    }
    setImporting(true);
    try {
      const plan = await planImport(inc, db, mode);
      const r = await applyImport(inc, plan, db);
      setPending(null);
      const parts = [`新增 ${r.items.add} 穗`];
      if (r.items.update) parts.push(`更新 ${r.items.update} 穗`);
      if (r.items.skip) parts.push(`跳过重复 ${r.items.skip}`);
      if (r.developments.add + r.developments.update) parts.push(`新枝 ${r.developments.add + r.developments.update} 根`);
      if (r.items.trash) parts.push(`${r.items.trash} 穗进回收站`);
      toast(`已${MODE_LABEL[mode]}：${parts.join(' · ')}${r.problems.length ? `。注意：${r.problems.join('；')}` : ''}`, r.badImages ? 'err' : 'ok');
      (window as unknown as { __gleanImport?: unknown }).__gleanImport = r;
    } catch (e) {
      toast('导入失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setImporting(false);
    }
  }

  async function wipe() {
    if (!(await confirm({ title: '清空所有穗和新枝？', body: '此操作不能撤销。建议先导出备份。', ok: '清空', cancel: '留着', danger: true }))) return;
    if (!(await confirm({ title: '再确认一次：真的清空？', ok: '真的清空', cancel: '算了', danger: true }))) return;
    await clearAll();
    toast('已清空');
  }

  async function copyDiag() {
    const ok = await copyText(await collectDiagnostics());
    toast(ok ? '诊断信息已复制（不含密钥和内容）' : '复制失败', ok ? 'ok' : 'err');
  }

  const SECTIONS: Array<[string, string, string]> = [
    ['set-ai', 'AI 服务', PRESETS.find((p) => p.id === settings.preset)?.name.replace(/（.*）/, '') || ''],
    ['set-embed', '向量', settings.embed.model || '不用'],
    ['set-look', '外观', THEME_LABEL[settings.theme]],
    ['set-capture', '极速采集', captureSummary()],
    ['set-data', '备份与导入', counts ? `${counts.items} 穗 · ${counts.devs} 新枝` : ''],
    ['set-trash', '回收站', counts ? `${counts.trash} 件` : ''],
    ['set-obsidian', '搬去 Obsidian', 'Markdown'],
    ['set-diag', '诊断', errCount ? `${errCount} 条错误` : '无错误'],
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
            <p className="meta-text">key 只存在这台手机 / 电脑上，不会上传到 Glean，也不进备份和诊断信息。</p>
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
              <span className="label">API Key（存在{vk ? VAULT_LABEL[vk].replace(/（.*）/, '') : '本机'}）</span>
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

          <CapturePanel />

          <section className="set-sec" id="set-data">
            <h2 className="sec-title">备份与导入</h2>
            <dl className="kv">
              <div>
                <dt>本机</dt>
                <dd className="num backup-counts">{counts ? `${counts.items} 穗 · ${counts.devs} 新枝 · ${counts.imgs} 张图` : '…'}</dd>
              </div>
            </dl>
            <div className="table action-table">
              {onAndroid ? (
                <>
                  <button className="trow backup-export" onClick={() => doExport('share')} disabled={!!backing}>
                    <span className="tc tc-title">{backing ? `打包中 ${backing}` : '导出备份'}</span>
                    <span className="tc tc-src">全部穗、新枝、原图，用系统分享发出去</span>
                    <span className="tc tc-date">.glean</span>
                  </button>
                  <button className="trow backup-downloads" onClick={() => doExport('downloads')} disabled={!!backing}>
                    <span className="tc tc-title">存到「下载」</span>
                    <span className="tc tc-src">同样的备份，直接存进手机的下载文件夹</span>
                    <span className="tc tc-date">.glean</span>
                  </button>
                </>
              ) : (
                <button className="trow backup-export" onClick={() => doExport('save')} disabled={!!backing}>
                  <span className="tc tc-title">{backing ? `打包中 ${backing}` : '导出备份'}</span>
                  <span className="tc tc-src">全部穗、新枝、原图（原样二进制），可在另一台设备导入</span>
                  <span className="tc tc-date">.glean</span>
                </button>
              )}
              <button className="trow backup-import" onClick={() => fileRef.current?.click()}>
                <span className="tc tc-title">导入备份</span>
                <span className="tc tc-src">先看条数再选：合并 / 只补缺 / 替换，重复的按 uid 认出来</span>
                <span className="tc tc-date">.glean</span>
              </button>
              <button className="trow danger" onClick={wipe}>
                <span className="tc tc-title">清空</span>
                <span className="tc tc-src">删掉这台设备上的所有穗和新枝</span>
                <span className="tc tc-date" />
              </button>
            </div>
            <input ref={fileRef} className="backup-file" type="file" accept=".glean,.json,.zip,application/json,application/zip,application/octet-stream" hidden onChange={(e) => { doImport(e.target.files?.[0]); e.target.value = ''; }} />
            {pending && (
              <div className="import-preview" data-format={pending.inc.format}>
                <p className="meta-text import-src">
                  {pending.name} · {pending.inc.format === 'glean' ? '.glean' : '旧版 JSON'}
                  {pending.inc.exportedAt ? ` · ${new Date(pending.inc.exportedAt).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 导出` : ''} · {pending.inc.items.length} 穗 · {pending.inc.developments.length} 新枝 · {pending.inc.imageCount} 张图
                </p>
                {pending.inc.problems.length > 0 && <p className="meta-text import-problems">注意：{pending.inc.problems.join('；')}</p>}
                <div className="radio-list" role="radiogroup" aria-label="导入方式">
                  {(['merge', 'missing', 'replace'] as ImportMode[]).map((m) => {
                    const c = pending.preview[m];
                    const note =
                      m === 'merge'
                        ? `新增 ${c.items.add} · 更新 ${c.items.update} · 跳过 ${c.items.skip}（同一件以较新的为准）`
                        : m === 'missing'
                          ? `新增 ${c.items.add} · 已有的 ${c.items.skip} 件一件不动`
                          : `新增 ${c.items.add} · 覆盖 ${c.items.update} · 本机另外 ${c.items.trash} 穗移进回收站`;
                    return (
                      <div key={m} className="radio-item">
                        <button role="radio" aria-checked={pending.mode === m} className={`radio chip import-mode${pending.mode === m ? ' on' : ''}`} data-mode={m} onClick={() => setPending({ ...pending, mode: m })}>
                          <i className="sq" aria-hidden />
                          <span className="radio-name">{MODE_LABEL[m]}</span>
                        </button>
                        <p className="meta-text radio-note import-note" data-mode={m} data-add={c.items.add} data-update={c.items.update} data-skip={c.items.skip} data-trash={c.items.trash}>
                          {note}；新枝 +{c.developments.add + c.developments.update}
                          {c.images ? ` · 图 ${c.images}` : ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
                <div className="actions">
                  <button className="btn primary import-go" onClick={runImport} disabled={importing}>
                    {importing ? '导入中…' : `${MODE_LABEL[pending.mode]}导入`}
                  </button>
                  <button className="btn text import-cancel" onClick={() => setPending(null)} disabled={importing}>
                    取消
                  </button>
                </div>
              </div>
            )}
            <p className="hint meta-text">手机和电脑之间可以用「导出 → 导入」搬运。旧版的 .json 备份照样能导入。</p>
          </section>

          <TrashPanel />

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

          <section className="set-sec" id="set-diag">
            <h2 className="sec-title">诊断</h2>
            <p className="meta-text">出问题时把诊断信息发给作者。只含版本、平台、库条数和最近错误的摘要，不含密钥、接口密钥和穗的内容；错误日志只存在本机，不上传。</p>
            <dl className="kv">
              <div>
                <dt>密钥存放</dt>
                <dd className="diag-vault">{vk ? VAULT_LABEL[vk] : '…'}</dd>
              </div>
              <div>
                <dt>错误日志</dt>
                <dd className="num diag-errs">{errCount} 条</dd>
              </div>
              <div>
                <dt>安全模式</dt>
                <dd>{safe ? '开（动效和后台任务已关）' : '关'}</dd>
              </div>
            </dl>
            <div className="table action-table">
              <button className="trow diag-copy" onClick={copyDiag}>
                <span className="tc tc-title">复制诊断信息</span>
                <span className="tc tc-src">版本 · 平台 · 库条数 · 最近 20 条错误</span>
                <span className="tc tc-date" />
              </button>
              <button
                className="trow diag-clear"
                onClick={() => {
                  clearErrors();
                  setErrCount(0);
                  toast('错误日志已清空');
                }}
              >
                <span className="tc tc-title">清空错误日志</span>
                <span className="tc tc-src">只删本机的错误记录</span>
                <span className="tc tc-date" />
              </button>
              <button
                className="trow diag-safe"
                onClick={() => {
                  setSafeMode(!safe);
                  location.reload();
                }}
              >
                <span className="tc tc-title">{safe ? '退出安全模式' : '进安全模式'}</span>
                <span className="tc tc-src">{safe ? '恢复动效和后台任务' : '白屏或卡顿时用：关掉动效、缩略图和索引等后台任务'}</span>
                <span className="tc tc-date" />
              </button>
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
