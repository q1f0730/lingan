import { useCallback, useEffect, useState } from 'react';
import { isTauriEnv } from '../lib/desktop';
import { NP_ACCESS_WHY, nowPlayingAccess, nowPlayingSupport, openNowPlayingAccess } from '../lib/nowplaying';
import { NOTIFY_WHY, notifyBridge, readNotify, requestNotify, type NotifyStatus } from '../lib/notify';
import { useApp } from '../lib/store';
import { EntryPanel } from './EntryPanel';

const ANDROID_WAYS: Array<[string, string]> = [
  ['分享 → 拾穗', '在任何 App 里分享文字、链接或图片给「拾穗」：弹出半屏「极速拾」，补一句为什么就存，存完自动回到原来的 App。'],
  ['长按选字 → 拾穗', '在微信读书、浏览器、知乎里选中一句话，菜单里点「拾穗」：收成摘抄，自动记下来自哪个 App，作者之后可以补。'],
  ['下拉快捷设置', '编辑快捷设置面板，把「拾一穗」「拾这首歌」两个磁贴拖进来：一下拉就能记，或一点收下正在放的歌。'],
  ['桌面小部件', '长按桌面空白处 → 小部件 → 拾穗：拾一穗 / 粘贴 / ♪ 这首歌 / 穗仓 四个按钮。'],
  ['长按图标', '长按拾穗图标：拾一穗 / 粘贴拾 / 拾这首歌 / 今日一穗 / 搜索。'],
];
const DESKTOP_WAYS: Array<[string, string]> = [
  ['速记小窗', '按速记热键（默认 Ctrl+Shift+L）在任何程序里唤出，回车即存；「♪ 当前歌曲」一键收歌。'],
  ['托盘菜单', '右键托盘图标 →「拾正在播放的歌」：读系统媒体控件（网易云 / QQ 音乐 / Spotify 等），一键存成音乐穗。'],
  ['发送到', '资源管理器里右键图片或 .txt / .md →「发送到 → 拾穗 Glean」。'],
];
const LINK_WAY: [string, string] = ['glean:// 链接', 'glean://capture?text=… 放进书签 / 快捷指令一点就拾；卡片菜单「复制链接」得到 glean://item/…'];

/** v0.22 设置 → 极速采集：入口说明 + 安卓的常驻通知 / 通知使用权开关（权限都在第一次用时说明再请求） */
export function CapturePanel() {
  const { toast, confirm } = useApp();
  const nb = notifyBridge();
  const android = nowPlayingSupport() === 'android' || !!nb;
  const desktop = isTauriEnv() && !android;
  const [ns, setNs] = useState<NotifyStatus | null>(() => readNotify());
  const [access, setAccess] = useState(() => nowPlayingAccess());
  const [asking, setAsking] = useState(false);

  const refresh = useCallback(() => {
    setNs(readNotify());
    setAccess(nowPlayingAccess());
  }, []);
  useEffect(() => {
    const f = () => document.visibilityState === 'visible' && refresh();
    window.addEventListener('focus', f);
    document.addEventListener('visibilitychange', f);
    return () => {
      window.removeEventListener('focus', f);
      document.removeEventListener('visibilitychange', f);
    };
  }, [refresh]);

  async function toggleNotify() {
    if (!nb || asking) return;
    const cur = readNotify(nb);
    if (cur?.on) {
      nb.setOn(false);
      refresh();
      toast('常驻通知已关');
      return;
    }
    setAsking(true);
    try {
      if (cur?.perm !== 'granted') {
        if (cur?.perm === 'blocked') {
          const go = await confirm({ title: '通知被关掉了', body: '拾穗的通知在系统设置里是关着的（或之前选了「不再询问」）。要用常驻通知，请在系统设置里允许拾穗发通知，回来再点一次。', ok: '去系统设置', cancel: '算了' });
          if (go) nb.openSettings();
          return;
        }
        const ok = await confirm({ title: '打开常驻通知？', body: NOTIFY_WHY, ok: '继续', cancel: '先不用' });
        if (!ok) return;
        const r = await requestNotify(nb);
        if (r !== 'granted') {
          toast(r === 'blocked' ? '没允许通知：可以在系统设置里打开' : '没允许通知，常驻通知没打开', 'err');
          return;
        }
      }
      nb.setOn(true);
      toast('常驻通知已打开 · 下拉通知栏就能拾');
    } finally {
      setAsking(false);
      refresh();
    }
  }

  async function askAccess() {
    if (access) {
      toast('已经允许了 · 想收回可以在系统「通知使用权」里关掉');
      return;
    }
    const go = await confirm({ title: '读正在播放的歌', body: NP_ACCESS_WHY, ok: '去打开', cancel: '以后再说' });
    if (go && !openNowPlayingAccess()) toast('打不开系统设置：请在 设置 → 通知 → 通知使用权 里打开拾穗', 'err');
  }

  const ways = [...(android ? ANDROID_WAYS : desktop ? DESKTOP_WAYS : [...ANDROID_WAYS, ...DESKTOP_WAYS]), LINK_WAY];
  return (
    <section className="set-sec capture-panel" id="set-capture">
      <h2 className="sec-title">极速采集</h2>
      <p className="meta-text">不用打开整个拾穗也能收：{android ? '下面这些入口都不启动主界面，1 秒存完；回到拾穗时自动收进穗仓。' : desktop ? '速记小窗和托盘都不打断你手上的事。' : '装上安卓 / Windows 版后可以用这些入口。'}</p>
      {android && (
        <div className="table action-table">
          {nb && (
            <button className="trow cap-switch cap-notify" role="switch" aria-checked={!!ns?.on} onClick={toggleNotify} disabled={asking}>
              <span className="tc tc-title">常驻通知</span>
              <span className="tc tc-src">通知栏里打字就存 · 一键拾歌（第一次打开才要通知权限）</span>
              <span className="tc tc-date">{asking ? '…' : ns?.on ? (ns.perm === 'granted' ? '开' : '开 · 缺权限') : '关'}</span>
            </button>
          )}
          {nowPlayingSupport() === 'android' && (
            <button className="trow cap-switch cap-access" role="switch" aria-checked={access} onClick={askAccess}>
              <span className="tc tc-title">通知使用权</span>
              <span className="tc tc-src">读正在播放的歌：只读歌名 / 歌手 / 专辑 / 封面，不读通知内容</span>
              <span className="tc tc-date">{access ? '已允许' : '未允许'}</span>
            </button>
          )}
        </div>
      )}
      {desktop && <EntryPanel />}
      <dl className="kv cap-ways">
        {ways.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="cap-entry">
              <span className="cap-v">{v}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function captureSummary(): string {
  const s = readNotify();
  if (s) return s.on ? '常驻通知开' : '分享 · 选字 · 磁贴';
  return isTauriEnv() ? '小窗 · 托盘收歌' : '分享 · 选字 · 磁贴';
}
