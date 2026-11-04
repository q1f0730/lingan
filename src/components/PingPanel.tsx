// v0.45 设置 → 到点递一穗（ROADMAP v0.33）+ 0843 带上没写为什么的数 + 0839 同时推到微信（Server酱）+ 0528 让提醒更准时（vivo）
import { useEffect, useState } from 'react';
import { isTauriEnv } from '../lib/desktop';
import { notifyBridge, readNotify, requestNotify } from '../lib/notify';
import { readPing, sctUrl, writePing, type PingCfg } from '../lib/rhythm';
import { useApp } from '../lib/store';

export function PingPanel() {
  const { toast } = useApp();
  const [c, setC] = useState<PingCfg>(readPing);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const daily = (window as { LinganDaily?: { guide(): boolean; brand(): string } }).LinganDaily;
  const app = isTauriEnv();
  useEffect(() => {
    void import('../lib/vault').then((m) => m.detectBackend()).then((v) => v.get('push.key')).then((k) => setHasKey(!!k), () => undefined);
  }, []);
  const save = (n: PingCfg) => (setC(n), writePing(n));

  async function flip() {
    if (!c.on) {
      // 安卓 13+：第一次打开才要通知权限（和常驻通知同一个系统权限，理由一起说清楚）
      const nb = notifyBridge();
      if (nb && readNotify(nb)?.perm !== 'granted') {
        const r = await requestNotify(nb);
        if (r !== 'granted') return toast('没有通知权限就递不到：系统设置 → 应用 → 拾穗 → 通知 里打开', 'err');
      }
    }
    save({ ...c, on: !c.on });
    toast(c.on ? '不递了' : `每天 ${c.at} 递一穗${app ? '' : '（网页版只在 App 里递得到）'}`);
  }
  async function saveKey() {
    const k = key.trim();
    if (k && !sctUrl(k)) return toast('SendKey 认不出：Server酱 Turbo 是 SCT 开头，Server酱³ 是 sctp 开头', 'err');
    const v = await (await import('../lib/vault')).detectBackend();
    await (k ? v.set('push.key', k) : v.del('push.key'));
    setKey('');
    setHasKey(!!k);
    if (!k && c.wx) save({ ...c, wx: false });
    toast(k ? 'SendKey 存进了钥匙串（不进备份 / 同步 / 诊断）' : '删掉了 SendKey');
  }
  async function test() {
    setBusy(true);
    try {
      const m = await import('../lib/ping');
      const msg = await m.pingNow(c, true);
      if (c.wx && hasKey) await m.pushWx(msg);
      toast(`试了一条：${msg.title} · ${msg.body}${c.wx && hasKey ? '（微信也发了）' : ''}`);
    } catch (e) {
      toast('没发出去：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="set-sec ping-panel" id="set-ping">
      <h2 className="sec-title">到点递一穗</h2>
      <p className="meta-text">
        每天你定的时间，系统通知递来今日一穗（很久没碰的那一穗），点开直接到今日卡。
        {daily ? '手机上由系统闹钟递，拾穗没开着也会到。' : app ? '电脑上拾穗在托盘里就会递；全屏游戏、演示或专注助手开着时先憋着，结束后再递（最多晚 3 小时）。' : '网页版没有系统通知，装上安卓 / Windows 版才递得到。'}
        只说标题，不带正文；上锁 / 私密的只说「一穗」，设了上锁 PIN 就一个标题都不说。
      </p>
      <div className="table action-table">
        <button className="trow cap-switch ping-on" role="switch" aria-checked={c.on} onClick={() => void flip()}>
          <span className="tc tc-title">每天递一穗</span>
          <span className="tc tc-src">有到期的「给未来的穗」那天先说它（不剧透是哪一穗）</span>
          <span className="tc tc-date">{c.on ? '开' : '关'}</span>
        </button>
        <button className="trow cap-switch ping-why" role="switch" aria-checked={c.why} onClick={() => save({ ...c, why: !c.why })}>
          <span className="tc tc-title">顺带说一句没写为什么的</span>
          <span className="tc tc-src">拾进来 24 小时还没写为什么的有 3 穗以上，通知末尾加一句「还有 n 穗没写为什么」</span>
          <span className="tc tc-date">{c.why ? '开' : '关'}</span>
        </button>
        <button className="trow cap-switch ping-wx" role="switch" aria-checked={c.wx} disabled={!hasKey} onClick={() => save({ ...c, wx: !c.wx })}>
          <span className="tc tc-title">同时推到微信</span>
          <span className="tc tc-src">经 Server酱 推同一句（只在那一刻拾穗开着时；先在下面填 SendKey）</span>
          <span className="tc tc-date">{!hasKey ? '没填' : c.wx ? '开' : '关'}</span>
        </button>
        {daily && (
          <button className="trow ping-guide" onClick={() => (daily.guide() ? toast('在打开的页面里允许拾穗自启动、后台不限制耗电') : toast('没打开设置页：手动到 设置 → 电池 → 后台耗电管理 里找拾穗', 'err'))}>
            <span className="tc tc-title">让提醒更准时</span>
            <span className="tc tc-src">{/vivo|iqoo/i.test(daily.brand()) ? 'vivo / iQOO 会清后台：去「自启动」和「后台耗电管理」里给拾穗放行' : '去系统的电池优化里把拾穗设成不优化'}</span>
            <span className="tc tc-date">去设置 →</span>
          </button>
        )}
      </div>
      <div className="row2">
        <label className="field">
          <span className="label">几点递</span>
          <input className="ping-at" type="time" value={c.at} onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && save({ ...c, at: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Server酱 SendKey{hasKey ? '（已存，填新的会替换）' : ''}</span>
          <div className="inline">
            <input className="ping-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={hasKey ? '••••••' : 'SCT… 或 sctp…'} autoComplete="off" />
            <button type="button" className="btn text ping-key-save" disabled={!key.trim() && !hasKey} onClick={() => void saveKey()}>
              {key.trim() || !hasKey ? '存' : '删掉'}
            </button>
          </div>
        </label>
      </div>
      <div className="actions">
        <button className="btn text ping-test" disabled={busy} onClick={() => void test()}>
          {busy ? '…' : '现在试一条'}
        </button>
      </div>
    </section>
  );
}
