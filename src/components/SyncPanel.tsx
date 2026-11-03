// v0.31 设置 · 同步（0614 WebDAV / 坚果云 + 0616 端到端加密 + 0618 恢复码 + 0615 回到同步前）。
// 面板本身很小；同步引擎、加密（含 Argon2id wasm）只在点按钮时动态加载。
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../lib/store';
import '../styles/sync.css';
import { LanSync } from './LanSync';
import { SyncStatus } from './SyncStatus';

const SYNC_KEY = 'glean.sync.v1';
interface Cfg {
  provider: 'jianguoyun' | 'custom';
  url: string;
  user: string;
  folder: string;
  confirm?: string;
  auto: boolean;
  lastAt?: number;
  last?: { ok: boolean; msg: string; at: number; stats?: { snapId: number | null } };
  state: { lastSnapId?: number | null };
}
function readCfg(): Cfg | null {
  try {
    const v = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
    return v && v.url ? v : null;
  } catch {
    return null;
  }
}
export function syncSummary(): string {
  const c = readCfg();
  if (!c) return '关';
  if (c.confirm) return '待确认恢复码';
  return c.last && !c.last.ok ? '上次失败' : c.provider === 'jianguoyun' ? '坚果云' : 'WebDAV';
}
const PRESETS = [
  { id: 'jianguoyun' as const, label: '坚果云', url: 'https://dav.jianguoyun.com/dav/', hint: '账号是坚果云登录邮箱；密码用「应用密码」：坚果云网页 → 账户信息 → 安全选项 → 第三方应用管理 → 添加应用。' },
  { id: 'custom' as const, label: '自定义 WebDAV', url: '', hint: 'Nextcloud、群晖、Alist 等，填完整的 WebDAV 地址。' },
];
const when = (t?: number) => {
  if (!t) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** v0.32：同步 = 网盘（v0.31）+ 局域网直连 + 同步状态 三块 */
export function SyncPanel({ version }: { version: string }) {
  return (
    <>
      <DavPanel version={version} />
      <LanSync version={version} />
      <SyncStatus version={version} />
    </>
  );
}

function DavPanel({ version }: { version: string }) {
  const [cfg, setCfg] = useState<Cfg | null>(readCfg);
  const [provider, setProvider] = useState<'jianguoyun' | 'custom'>('jianguoyun');
  const [url, setUrl] = useState(PRESETS[0].url);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [secret, setSecret] = useState('');
  const [step, setStep] = useState<'account' | 'new' | 'join'>('account');
  const [useCode, setUseCode] = useState(false);
  const [code, setCode] = useState('');
  const [check, setCheck] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newPass, setNewPass] = useState<string | null>(null);
  const { confirm: ask } = useApp();
  useEffect(() => {
    const on = () => setCfg(readCfg());
    window.addEventListener('glean:sync', on);
    return () => window.removeEventListener('glean:sync', on);
  }, []);
  const lib = () => import('../lib/sync');
  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr('');
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error)?.message || String(e));
    } finally {
      setBusy('');
    }
  }, []);
  const account = () => ({ provider, url: url.trim(), user: user.trim(), pass, folder: 'Glean' });

  const next = () =>
    run('连接中…', async () => {
      if (!/^https?:\/\//i.test(url.trim())) throw new Error('WebDAV 地址要以 https:// 开头');
      if (!user.trim() || !pass) throw new Error('账号和应用密码都要填');
      setStep(await (await lib()).probe(account()));
    });
  const create = () =>
    run('生成数据钥…', async () => {
      const c = await (await lib()).createRemote(account(), secret);
      setCode(c);
      setPass('');
      setSecret('');
    });
  const join = () =>
    run('解开数据钥…', async () => {
      const m = await lib();
      await m.joinRemote(account(), useCode ? { code: secret } : { pass: secret });
      setPass('');
      setSecret('');
      const st = await m.runSync({ appVersion: version });
      setMsg(`已加入。${m.describe(st)}`);
    });
  const confirm = () =>
    run('确认中…', async () => {
      const m = await lib();
      if (!m.confirmRecovery(check)) throw new Error('最后一组对不上：再看一眼你抄下的恢复码');
      setCode('');
      setCheck('');
      const st = await m.runSync({ appVersion: version });
      setMsg(`同步已开。${m.describe(st)}`);
    });
  const syncNow = () =>
    run('同步中…', async () => {
      const m = await lib();
      setMsg(m.describe(await m.runSync({ appVersion: version, onProgress: (p) => setBusy(p) })));
    });
  const undo = () =>
    run('回到同步前…', async () => {
      if (!(await ask({ title: '回到同步前？', body: '这台设备回到上次同步之前：那次同步带来的修改撤回，下次同步时别的设备也跟着撤回（那次新来的穗进回收站，30 天内能找回）。', ok: '回去', cancel: '算了' }))) return;
      const r = await (await lib()).undoSync(version);
      setMsg(`已回去：${r.restamped} 行改回，${r.trashed} 行进回收站。`);
    });
  const off = () =>
    run('断开中…', async () => {
      if (!(await ask({ title: '断开同步？', body: '这台设备忘掉网盘账号和数据钥，不再同步。云端的数据不动，别的设备照常。', ok: '断开', cancel: '算了', danger: true }))) return;
      await (await lib()).disconnect();
      setStep('account');
      setCode('');
    });
  const changePass = () =>
    run('换口令…', async () => {
      await (await lib()).changeSyncPass(newPass || '');
      setNewPass(null);
      setMsg('同步口令已换。别的设备不用重新加入。');
    });
  const printCard = () => {
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(`<title>拾穗 · 同步恢复码</title><body style="font:16px/1.6 Inter,system-ui,sans-serif;padding:32px"><h1 style="font-size:28px;margin:0 0 8px">拾穗 · 同步恢复码</h1><p>忘了同步口令时，用它在新设备上「加入」。谁拿到它就能解开你云上的数据：收好，别拍照发人。</p><pre style="font:600 22px/1.8 ui-monospace,monospace;border:1px solid #000;padding:16px">${code.replace(/-/g, ' ')}</pre><p>${when(Date.now())} · 生成于 ${location.host || '拾穗'}</p></body>`);
    w.document.close();
    w.print();
  };

  const status = busy ? <p className="meta-text sync-busy" aria-live="polite">{busy}</p> : err ? <p className="meta-text sync-err" role="alert">{err}</p> : msg ? <p className="meta-text sync-msg" aria-live="polite">{msg}</p> : null;

  // ── 刚建好：恢复码（只显示这一次）+ 强制确认 ──
  if (cfg?.confirm || code) {
    return (
      <section className="set-sec sync-panel" id="set-sync">
        <h2 className="sec-title">同步 · 网盘</h2>
        <p className="meta-text">这是恢复码，只显示这一次。忘了同步口令时，凭它在新设备上加入。抄下来或打印出来，收在手机以外的地方。</p>
        {code ? (
          <>
            <div className="sync-code" aria-label="恢复码">
              {code.split('-').map((g, i) => (
                <span key={i} className="sync-code-g">
                  {g}
                </span>
              ))}
            </div>
            <div className="actions">
              <button className="btn text sync-copy" onClick={() => void navigator.clipboard?.writeText(code).then(() => setMsg('已复制。贴到密码管理器里，别发给别人。'))}>
                复制
              </button>
              <button className="btn text sync-print" onClick={printCard}>
                打印卡片
              </button>
            </div>
          </>
        ) : (
          <p className="meta-text">恢复码在刚才那一屏显示过。找出你抄下的那张，输入最后一组完成确认；找不到就断开后重新建。</p>
        )}
        <label className="field">
          <span className="label">抄好了？输入最后一组（4 位）</span>
          <input className="sync-check" value={check} maxLength={4} onChange={(e) => setCheck(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} />
        </label>
        <div className="actions">
          <button className="btn primary sync-confirm" onClick={confirm} disabled={!!busy || check.trim().length !== 4}>
            确认并开始同步
          </button>
          <button className="btn text faint sync-off" onClick={off} disabled={!!busy}>
            取消
          </button>
        </div>
        {status}
      </section>
    );
  }

  // ── 已开 ──
  if (cfg) {
    const ok = cfg.last?.ok !== false;
    return (
      <section className="set-sec sync-panel" id="set-sync">
        <h2 className="sec-title">同步 · 网盘</h2>
        <div className="sync-state">
          <span className="sync-big num">{cfg.lastAt ? when(cfg.lastAt) : '—'}</span>
          <span className="meta-text">
            {cfg.provider === 'jianguoyun' ? '坚果云' : new URL(cfg.url).host} · {cfg.user} · 端到端加密
          </span>
        </div>
        <p className={`meta-text sync-last${ok ? '' : ' sync-err'}`}>{cfg.last ? `${ok ? '上次：' : '上次失败：'}${cfg.last.msg}` : '还没同步过。'}</p>
        <div className="actions">
          <button className="btn primary sync-now" onClick={syncNow} disabled={!!busy}>
            {busy === '' ? '立即同步' : '同步中…'}
          </button>
          {cfg.state.lastSnapId != null && (
            <button className="btn text sync-undo" onClick={undo} disabled={!!busy}>
              回到同步前
            </button>
          )}
        </div>
        <label className="check">
          <input className="sync-auto" type="checkbox" checked={cfg.auto} onChange={(e) => void lib().then((m) => m.setAuto(e.target.checked))} /> 打开时、回到前台时和开着的时候每 10 分钟自动同步
        </label>
        <p className="hint meta-text">云上只有密文：穗、新枝、作品、原图都先在本机用数据钥加密再上传，服务商看不到内容。缩略图、向量这些对端自己重建，不传。每次拉到东西之前先拍一张快照。</p>
        {newPass != null && (
          <label className="field">
            <span className="label">新的同步口令（至少 8 位；只重新包一下数据钥，云上数据不用重传）</span>
            <div className="inline">
              <input className="sync-newpass" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} autoComplete="off" />
              <button type="button" className="btn text sync-newpass-save" onClick={changePass} disabled={!!busy || newPass.length < 8}>
                保存
              </button>
            </div>
          </label>
        )}
        <div className="actions">
          <button className="btn text sync-pass" onClick={() => setNewPass(newPass == null ? '' : null)} disabled={!!busy}>
            {newPass == null ? '换同步口令' : '不换了'}
          </button>
          <button className="btn text faint sync-off" onClick={off} disabled={!!busy}>
            断开
          </button>
        </div>
        {status}
      </section>
    );
  }

  // ── 没开：账号 → 新建 / 加入 ──
  const preset = PRESETS.find((p) => p.id === provider)!;
  return (
    <section className="set-sec sync-panel" id="set-sync">
      <h2 className="sec-title">同步 · 网盘</h2>
      <p className="meta-text">手机和电脑经你自己的网盘（WebDAV）同步穗、新枝、作品和原图。上传前先在本机加密，只有知道同步口令或恢复码的设备能解开。</p>
      {step === 'account' ? (
        <>
          <div className="radio-list" role="radiogroup" aria-label="同步服务">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                role="radio"
                aria-checked={provider === p.id}
                className={`radio chip${provider === p.id ? ' on' : ''}`}
                onClick={() => {
                  setProvider(p.id);
                  setUrl(p.url);
                }}
              >
                <i className="sq" aria-hidden />
                <span className="radio-name">{p.label}</span>
              </button>
            ))}
          </div>
          <p className="hint meta-text">{preset.hint}</p>
          {provider === 'custom' && (
            <label className="field">
              <span className="label">WebDAV 地址</span>
              <input className="sync-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/dav/" autoComplete="off" />
            </label>
          )}
          <div className="row2">
            <label className="field">
              <span className="label">账号</span>
              <input className="sync-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" placeholder={provider === 'jianguoyun' ? '坚果云登录邮箱' : ''} />
            </label>
            <label className="field">
              <span className="label">应用密码（存进系统钥匙串）</span>
              <input className="sync-davpass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="off" />
            </label>
          </div>
          <div className="actions">
            <button className="btn primary sync-next" onClick={next} disabled={!!busy}>
              下一步
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="meta-text sync-found">{step === 'new' ? '网盘里的 Glean 文件夹还没有同步数据：这台设备第一个开，设一个同步口令。' : '网盘里已经有同步数据了：输入同步口令（或恢复码）加入。'}</p>
          {step === 'join' && (
            <div className="seg sync-seg" role="radiogroup" aria-label="用什么解开">
              <button role="radio" aria-checked={!useCode} className={!useCode ? 'on' : ''} onClick={() => setUseCode(false)}>
                同步口令
              </button>
              <button role="radio" aria-checked={useCode} className={useCode ? 'on' : ''} onClick={() => setUseCode(true)}>
                恢复码
              </button>
            </div>
          )}
          <label className="field">
            <span className="label">{step === 'join' && useCode ? '恢复码（8 组 4 位，横线空格随意）' : step === 'new' ? '同步口令（至少 8 位，和网盘密码不要一样）' : '同步口令'}</span>
            <input className="sync-secret" type={useCode && step === 'join' ? 'text' : 'password'} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <div className="actions">
            <button className="btn primary sync-go" onClick={step === 'new' ? create : join} disabled={!!busy || (step === 'new' ? secret.length < 8 : !secret)}>
              {step === 'new' ? '生成恢复码' : '加入并同步'}
            </button>
            <button className="btn text sync-back" onClick={() => setStep('account')} disabled={!!busy}>
              返回
            </button>
          </div>
        </>
      )}
      {status}
    </section>
  );
}
