import { useCallback, useEffect, useRef, useState } from 'react';
import { onNowPlaying } from '../lib/desktop';
import { addItem } from '../lib/db';
import { NP_ACCESS_WHY, NP_REASON, nowPlayingDraft, nowPlayingSupport, openNowPlayingAccess, readNowPlaying, type NowPlaying } from '../lib/nowplaying';
import { useApp } from '../lib/store';
import { afterAdd } from './QuickBar';

/**
 * v0.22「正在播放一键拾」：读当前播放的歌。
 * 安卓没给「通知使用权」时先弹一句说明（0556），用户点「去打开」才跳系统设置。
 */
export function useNowPlaying() {
  const { settings, toast, confirm } = useApp();
  const [busy, setBusy] = useState(false);

  /** 只读不存（速记表单用来填字段）；拿不到返回 null，并已经提示过 */
  const read = useCallback(async (): Promise<NowPlaying | null> => {
    const r = await readNowPlaying();
    if (r.ok) return r.np;
    if (r.reason === 'no-access') {
      const go = await confirm({ title: '读正在播放的歌', body: NP_ACCESS_WHY, ok: '去打开', cancel: '以后再说' });
      if (go && !openNowPlayingAccess()) toast('打不开系统设置：请在 设置 → 通知 → 通知使用权 里打开拾穗', 'err');
      return null;
    }
    toast(NP_REASON[r.reason], r.reason === 'nothing' ? 'ok' : 'err');
    return null;
  }, [confirm, toast]);

  /** 一键拾：读到就直接存成音乐穗 */
  const grab = useCallback(async (): Promise<number | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const np = await read();
      if (!np) return null;
      const d = nowPlayingDraft(np);
      const id = await addItem(d);
      afterAdd(id, d, settings, (m) => toast(m, 'err'));
      toast(`已拾 ♪ ${np.title}${np.artist ? ' — ' + np.artist : ''}`);
      return id;
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, read, settings, toast]);

  return { support: nowPlayingSupport(), busy, read, grab };
}

/** 「♪ 当前歌曲」按钮：设备不支持时不渲染 */
export function NowPlayingButton({ onDone, className = 'chip np-btn' }: { onDone?: (id: number) => void; className?: string }) {
  const { support, busy, grab } = useNowPlaying();
  if (!support) return null;
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        const id = await grab();
        if (id != null) onDone?.(id);
      }}
      title={support === 'windows' ? '读系统正在播放的歌（网易云 / QQ 音乐 / Spotify 等）' : '读手机正在播放的歌'}
    >
      ♪ 当前歌曲
    </button>
  );
}

/** Windows 托盘菜单「拾正在播放的歌」→ 一键收（不渲染任何东西） */
export function NowPlayingTray() {
  const { grab } = useNowPlaying();
  const ref = useRef(grab);
  ref.current = grab;
  useEffect(() => {
    let off = () => {};
    let dead = false;
    onNowPlaying(() => void ref.current()).then((f) => (dead ? f() : (off = f)));
    return () => {
      dead = true;
      off();
    };
  }, []);
  return null;
}
