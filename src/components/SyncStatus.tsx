// v0.32 设置 · 同步状态（0564 最近 20 次结果 + 失败原因 + 重试、0660 推 n 收 m 冲突 k、0670 各设备、旧包压缩清理）。
// 只读 localStorage 里两种同步（网盘 glean.sync.v1 / 局域网 glean.lan.v1）的记录；查设备、清旧包时才动态加载同步引擎。
import { useCallback, useEffect, useState } from 'react';

interface Log {
  at: number;
  ok: boolean;
  via: string;
  msg: string;
  push: number;
  pull: number;
  conflicts: number;
}
type Space = 'dav' | 'lan';
interface Dev {
  dev: string;
  name: string;
  plat: string;
  app?: string;
  at: number;
  seq: number;
  me: boolean;
}
const KEYS: Record<Space, string> = { dav: 'glean.sync.v1', lan: 'glean.lan.v1' };
const LABEL: Record<Space, string> = { dav: '网盘', lan: '局域网' };
function read(space: Space): { log?: Log[]; lastAt?: number; last?: { ok: boolean; msg: string; at: number } } | null {
  try {
    return JSON.parse(localStorage.getItem(KEYS[space]) || 'null');
  } catch {
    return null;
  }
}
const when = (t?: number) => {
  if (!t) return '—';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export function SyncStatus({ version }: { version: string }) {
  const [tick, setTick] = useState(0);
  const [devs, setDevs] = useState<Partial<Record<Space, { devices: Dev[]; packs: number; mine: number }>>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener('glean:sync', on);
    return () => window.removeEventListener('glean:sync', on);
  }, []);
  void tick;
  const spaces = (['dav', 'lan'] as Space[]).filter((s) => read(s));
  const logs = spaces
    .flatMap((s) => (read(s)?.log || []).map((l) => ({ ...l, space: s })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 20);
  const last = logs[0];
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
  const lib = () => import('../lib/sync');
  const loadDevs = () =>
    run('查各设备…', async () => {
      const m = await lib();
      const out: typeof devs = {};
      for (const s of spaces) out[s] = await m.spaceStatus(s).catch((e) => (setErr(`${LABEL[s]}：${(e as Error).message}`), undefined));
      setDevs(out);
    });
  const clean = (s: Space) =>
    run('清理旧包…', async () => {
      const m = await lib();
      const n = await m.compactNow(s, version);
      setMsg(n ? `清掉 ${n} 个旧包。` : '没有能清的：有设备还没确认（可移除离线太久的），或包本来就少。');
      const st = await m.spaceStatus(s);
      setDevs((d) => ({ ...d, [s]: st }));
    });
  const remove = (s: Space, d: Dev) =>
    run('移除中…', async () => {
      const m = await lib();
      await m.retireDevice(s, d.dev);
      setMsg(`已移除「${d.name}」；它再同步会自动回来。`);
      const st = await m.spaceStatus(s);
      setDevs((x) => ({ ...x, [s]: st }));
    });
  const retry = (s: Space) =>
    run('重试中…', async () => {
      const m = await lib();
      const st = s === 'dav' ? await m.runSync({ appVersion: version }) : await m.runLanSync({ appVersion: version });
      setMsg(m.describe(st));
    });

  return (
    <section className="set-sec sync-status" id="set-syncstate">
      <h2 className="sec-title">同步状态</h2>
      {!spaces.length ? (
        <p className="meta-text">还没开同步：上面网盘或局域网直连任选。</p>
      ) : (
        <>
          <div className="sync-state">
            <span className="sync-big num st-last">{last ? when(last.at) : '—'}</span>
            <span className={`meta-text st-line${last && !last.ok ? ' sync-err' : ''}`}>{last ? (last.ok ? `${last.via} · 推 ${last.push} 收 ${last.pull}${last.conflicts ? ` · 冲突 ${last.conflicts}` : ''}` : `${last.via} 失败：${last.msg}`) : '还没同步过'}</span>
          </div>
          {logs.length > 0 && (
            <div className="st-table-wrap">
              <table className="st-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>方式</th>
                    <th className="n">推</th>
                    <th className="n">收</th>
                    <th className="n">冲突</th>
                    <th>结果</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l, i) => (
                    <tr key={i} className={l.ok ? '' : 'bad'}>
                      <td className="num">{when(l.at)}</td>
                      <td>{l.via}</td>
                      <td className="n num">{l.push}</td>
                      <td className="n num">{l.pull}</td>
                      <td className="n num">{l.conflicts || ''}</td>
                      <td className="st-msg">
                        {l.ok ? l.msg : `失败：${l.msg}`}
                        {!l.ok && i === logs.findIndex((x) => x.space === l.space) && (
                          <button className="btn text st-retry" onClick={() => retry(l.space)} disabled={!!busy}>
                            重试
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint meta-text">冲突 = 两台设备同步前都改了同一处：取较新的一边，旧值可从「回到同步前」或快照找回。</p>
          <div className="actions">
            <button className="btn text st-devs" onClick={loadDevs} disabled={!!busy}>
              {Object.keys(devs).length ? '刷新各设备' : '查看各设备与旧包'}
            </button>
          </div>
          {spaces.map((s) =>
            devs[s] ? (
              <div key={s} className="st-space">
                <p className="meta-text st-space-h">
                  {LABEL[s]}：{devs[s]!.devices.length} 台设备 · 改动包 <span className="num">{devs[s]!.packs}</span> 个（这台的 {devs[s]!.mine} 个）
                </p>
                <div className="st-table-wrap">
                  <table className="st-table st-devtable">
                    <thead>
                      <tr>
                        <th>设备</th>
                        <th>平台</th>
                        <th>最后同步</th>
                        <th>版本</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {devs[s]!.devices.map((d) => (
                        <tr key={d.dev}>
                          <td>
                            {d.name}
                            {d.me ? '（这台）' : ''}
                          </td>
                          <td>{d.plat || '—'}</td>
                          <td className="num">{when(d.at)}</td>
                          <td className="num">{d.app ? `v${d.app}` : '—'}</td>
                          <td>
                            {!d.me && (
                              <button className="btn text faint st-remove" onClick={() => remove(s, d)} disabled={!!busy}>
                                移除
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="actions">
                  <button className="btn text st-clean" onClick={() => clean(s)} disabled={!!busy}>
                    清理旧包
                  </button>
                </div>
              </div>
            ) : null,
          )}
          <p className="hint meta-text">清理只删这台已进全库快照、且每台设备都确认过的包；落下的设备会读快照补齐。久不用的设备可移除。</p>
        </>
      )}
      {busy ? <p className="meta-text sync-busy">{busy}</p> : err ? <p className="meta-text sync-err" role="alert">{err}</p> : msg ? <p className="meta-text sync-msg st-msg-out">{msg}</p> : null}
    </section>
  );
}
