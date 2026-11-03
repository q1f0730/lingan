// v0.33 系统入口启动（桌面 + 安卓，首屏空闲后才加载，网页版不加载）：
// - 0520 外链交给系统（桌面 opener / 安卓 Intent），装了网易云、B 站等 App 的会被它们接走
// - 0510 冷启动时攒下的 glean:// 链接；0518「发送到 → 拾穗」带进来的文件；0507 摘抄热键
import type { LinkCtx } from './deeplink';

let booted = false;

export function externalHref(a: HTMLAnchorElement | null, origin: string): string {
  if (!a) return '';
  const h = a.href || '';
  if (!/^https?:\/\//i.test(h)) return '';
  try {
    return new URL(h).origin === origin ? '' : h;
  } catch {
    return '';
  }
}

export async function boot(ref: { current: LinkCtx }): Promise<void> {
  if (booted) return;
  booted = true;
  const { invoke } = await import('@tauri-apps/api/core');
  const share = (window as unknown as { LinganShare?: { openExternal?: (u: string) => boolean } }).LinganShare;
  document.addEventListener(
    'click',
    (e) => {
      const href = externalHref((e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null, location.origin);
      if (!href || e.defaultPrevented) return;
      e.preventDefault();
      if (share) {
        if (!share.openExternal?.(href)) window.open(href, '_blank');
      } else void invoke('open_external', { url: href }).catch(() => window.open(href, '_blank'));
    },
    true,
  );
  if (share) return; // 安卓：深链接走 MainActivity → takeGo，没有热键 / 发送到
  const { listen } = await import('@tauri-apps/api/event');
  const links = await invoke<string[]>('link_take').catch(() => [] as string[]);
  for (const u of links) window.dispatchEvent(new CustomEvent('glean:link', { detail: u }));
  const add = async (d: Parameters<typeof import('../components/QuickBar').quickAdd>[0]) => {
    const { quickAdd } = await import('../components/QuickBar');
    return quickAdd(d, ref.current.settings, (m) => ref.current.toast(m, 'err'));
  };
  const takeSend = async () => {
    const list = await invoke<{ name: string; mime: string }[]>('send_list').catch(() => []);
    if (!list.length) return;
    const files: File[] = [];
    for (let i = 0; i < list.length; i++) files.push(new File([await invoke<ArrayBuffer>('send_read', { index: i })], list[i].name, { type: list[i].mime }));
    await invoke('send_clear');
    const { takeTransfer } = await import('../components/DropIn');
    const r = await takeTransfer({ files, getData: () => '' } as unknown as DataTransfer, add);
    if (r) ref.current.toast(r.msg, r.ids.length ? 'ok' : 'err');
  };
  await takeSend();
  void listen('glean-send', () => void takeSend());
  void listen<string>('glean-excerpt', async (e) => {
    const { parseQuick } = await import('./quick');
    const d = parseQuick(String(e.payload || ''));
    if (!d) return;
    d.tags = Array.from(new Set([...d.tags, '摘抄']));
    await add(d);
    ref.current.toast(`摘抄已拾「${d.title.slice(0, 16)}」`);
  });
}
