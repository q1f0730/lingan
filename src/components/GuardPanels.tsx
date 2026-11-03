// v0.39 设置里的两块：0907 上锁（PIN）与 0805 接入与权限（每个接入读什么 / 写什么 / 只连哪些域名 + 一键停用）。
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { lockReady, relock, useUnlocked } from '../lib/lock';
import { NETEASE_HOSTS, PLUG_NAME, plugOn, setPlug, type PlugId } from '../lib/plugs';
import { readAgentCfg, writeAgentCfg } from '../lib/agent';
import { MINI_HOSTS } from '../lib/mini';
import { useApp } from '../lib/store';
import { embedConfig } from '../lib/settings';
import '../styles/v039.css';

export function LockPanel() {
  const { toast, confirm } = useApp();
  const [ready, setReady] = useState(lockReady);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [mode, setMode] = useState<'' | 'change' | 'off'>('');
  const unl = useUnlocked();
  const n = useLiveQuery(() => db.items.filter((x) => !!x.locked && !x.deletedAt).count(), []);
  const clear = () => (setA(''), setB(''), setMode(''));

  async function set() {
    const P = await import('../lib/lockpin');
    if (!P.PIN_RE.test(a)) return toast('PIN 要 4–12 位数字', 'err');
    if (a !== b) return toast('两次不一样', 'err');
    await P.setPin(a);
    setReady(true);
    clear();
    toast('PIN 设好了：在详情或速记里给穗「上锁」');
  }
  async function change() {
    const P = await import('../lib/lockpin');
    if (!(await P.checkPin(a, false))) return toast(P.waitLeft() ? `输错太多次，${P.waitLeft()} 秒后再试` : '原来的 PIN 不对', 'err');
    if (!P.PIN_RE.test(b)) return toast('新 PIN 要 4–12 位数字', 'err');
    await P.setPin(b);
    clear();
    toast('PIN 改好了');
  }
  async function off() {
    if (n) return toast(`还有 ${n} 穗上着锁：先在详情里解除，再关`, 'err');
    const P = await import('../lib/lockpin');
    if (!(await P.clearPin(a))) return toast('PIN 不对', 'err');
    setReady(false);
    clear();
    toast('上锁功能关了');
  }
  async function forgot() {
    const ok = await confirm({ title: '忘了 PIN？', body: '可以重设一个新的。上锁的穗仍然上锁，用新 PIN 打开。上锁防的是别人随手翻和所有外发，不是加密。', ok: '重设', cancel: '算了', danger: true });
    if (!ok) return;
    localStorage.removeItem('glean.lock.v1');
    setReady(false);
    relock();
  }
  return (
    <section className="set-sec lock-panel" id="set-lock">
      <h2 className="sec-title">上锁</h2>
      <p className="meta-text">心事一样的穗可以上锁：要输入这台设备的 PIN 才显示（解锁 5 分钟，切到后台就重新锁上）；不管解没解锁，都永远不进分享、花园、Agent / MCP 和任何 AI（连本机模型也不发）。PIN 只存在这台设备上；这不是加密，库还是存在本机，同步时照常端到端加密。指纹 / Windows Hello 要真机接系统接口，这版还没有。</p>
      <dl className="kv">
        <div>
          <dt>PIN</dt>
          <dd className="lock-state">{ready ? (unl ? '已设 · 现在解锁着' : '已设') : '没设'}</dd>
        </div>
        <div>
          <dt>上锁的穗</dt>
          <dd className="num lock-n">{n ?? '…'} 穗</dd>
        </div>
      </dl>
      {!ready ? (
        <div className="row2">
          <label className="field">
            <span className="label">新 PIN（4–12 位数字）</span>
            <input className="pin-new" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} />
          </label>
          <label className="field">
            <span className="label">再输一次</span>
            <input className="pin-again" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && void set()} />
          </label>
        </div>
      ) : mode ? (
        <div className="row2">
          <label className="field">
            <span className="label">{mode === 'change' ? '原来的 PIN' : '输入 PIN 确认关闭'}</span>
            <input className="pin-old" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} />
          </label>
          {mode === 'change' && (
            <label className="field">
              <span className="label">新 PIN</span>
              <input className="pin-new" type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} />
            </label>
          )}
        </div>
      ) : null}
      <div className="actions">
        {!ready ? (
          <button className="btn primary pin-set" onClick={set} disabled={a.length < 4 || b.length < 4}>
            设 PIN
          </button>
        ) : mode ? (
          <>
            <button className="btn primary" onClick={mode === 'change' ? change : off} disabled={a.length < 4}>
              {mode === 'change' ? '改好了' : '关闭上锁'}
            </button>
            <button className="btn text" onClick={clear}>
              取消
            </button>
          </>
        ) : (
          <>
            {unl && (
              <button className="btn text lock-now" onClick={relock}>
                立即锁上
              </button>
            )}
            <button className="btn text" onClick={() => setMode('change')}>
              改 PIN
            </button>
            <button className="btn text faint" onClick={() => setMode('off')}>
              关闭上锁
            </button>
            <button className="btn text faint lock-forgot" onClick={forgot}>
              忘了 PIN
            </button>
          </>
        )}
      </div>
    </section>
  );
}

const host = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

export function PlugPanel() {
  const { settings, toast } = useApp();
  const [n, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((x) => x + 1);
    window.addEventListener('glean:plugs', on);
    window.addEventListener('glean:feeds', on);
    return () => {
      window.removeEventListener('glean:plugs', on);
      window.removeEventListener('glean:feeds', on);
    };
  }, []);
  const feedHosts = useLiveQuery(async () => {
    if (!localStorage.getItem('glean.feeds.n')) return [] as string[];
    const { fdb } = await import('../lib/feeds');
    return [...new Set((await fdb().feeds.toArray()).map((f) => host(f.url)).filter(Boolean))];
  }, [n]);
  const agent = readAgentCfg();
  const ec = embedConfig(settings);
  const aiHosts = [...new Set([host(settings.chat.baseUrl), ec && ec.baseUrl !== 'local:mini' ? host(ec.baseUrl) : ''].filter(Boolean))];
  const rows: Array<{ id: PlugId; reads: string; writes: string; hosts: string; on: boolean }> = [
    { id: 'link', reads: '不读穗仓；只发出你贴的链接本身', writes: '这一穗的标题、封面、正文快照', hosts: '你贴的链接所在的网站 + 它的封面图（任意网站）', on: plugOn('link') },
    { id: 'feeds', reads: '不读穗仓', writes: '只写「待拾」，拾不拾你定', hosts: feedHosts?.length ? feedHosts.join('、') : '你订阅的源（还没有）', on: plugOn('feeds') },
    { id: 'netease', reads: '不读穗仓；只发歌单 id', writes: '导入前你勾选的歌（先拍快照）', hosts: NETEASE_HOSTS.join('、'), on: plugOn('netease') },
    { id: 'mini', reads: '不读穗仓', writes: '本机模型库（独立，下载完核对 SHA-256）', hosts: MINI_HOSTS.join('、'), on: plugOn('mini') },
    { id: 'ai', reads: '穗的标题 / 正文 / 为什么；看图时读图片（私密穗不发云端，上锁的穗一律不发）', writes: '标签建议、图片描述、向量、新枝', hosts: aiHosts.join('、') || '还没配', on: plugOn('ai') },
    { id: 'agent', reads: '穗的元数据和正文（私密、上锁的不给）', writes: agent.write ? '代拾一穗进待理（每次弹窗确认）' : '不能写（只读）', hosts: `只本机 127.0.0.1:${agent.port}`, on: plugOn('agent') && agent.on },
  ];
  function flip(id: PlugId, on: boolean) {
    setPlug(id, on);
    if (id === 'agent' && !on && agent.on) writeAgentCfg({ ...agent, on: false });
    toast(on ? `「${PLUG_NAME[id]}」恢复了${id === 'agent' ? '（本地 API 要在 Agent 与 API 里再打开）' : ''}` : `「${PLUG_NAME[id]}」停用了：它不会再连外面、不再读写`);
  }
  const anyOn = rows.some((r) => r.on);
  return (
    <section className="set-sec plug-panel" id="set-plugs">
      <h2 className="sec-title">接入与权限</h2>
      <p className="meta-text">每一样会往外连、或会读写穗仓的接入，都在这里写清楚读什么、写什么、只连哪些域名；运行时不在名单里的域名会被拦下。停用后立刻生效，只在这台设备上。</p>
      <div className="table action-table plug-table">
        {rows.map((r) => (
          <button key={r.id} className="trow cap-switch plug-row" role="switch" aria-checked={r.on} data-plug={r.id} onClick={() => flip(r.id, !r.on)}>
            <span className="tc tc-title">{PLUG_NAME[r.id]}</span>
            <span className="tc tc-src">
              读：{r.reads}；写：{r.writes}；连：{r.hosts}
            </span>
            <span className="tc tc-date">{r.on ? '开' : '停用'}</span>
          </button>
        ))}
      </div>
      <div className="actions">
        <button
          className="btn text faint plug-all-off"
          disabled={!anyOn}
          onClick={() => {
            for (const r of rows) if (r.on) setPlug(r.id, false);
            if (agent.on) writeAgentCfg({ ...agent, on: false });
            toast('全部接入都停用了');
          }}
        >
          一键全部停用
        </button>
      </div>
    </section>
  );
}
