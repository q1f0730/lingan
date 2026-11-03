const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Save text to a user-chosen file. Returns a description of where, or null if cancelled. */
export async function saveTextFile(name: string, text: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('./tfs');
    const path = await save({ defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return null;
    await writeTextFile(path, text);
    return String(path);
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('读取文件失败'));
    r.readAsText(file);
  });
}

/** v0.15 安卓原生桥（scripts/patch-android.mjs 注入的 LinganFiles）：分块写进缓存，再走系统分享或存到「下载」 */
export interface AndroidFiles {
  begin(name: string): boolean;
  append(b64: string): boolean;
  share(mime: string, title: string): boolean;
  saveDownloads(mime: string): string;
}
export function androidFiles(): AndroidFiles | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { LinganFiles?: AndroidFiles }).LinganFiles;
  return b && typeof b.begin === 'function' ? b : null;
}

/** 字节 → base64（分段，避免 String.fromCharCode 爆栈） */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

/** 安卓：每块 384KB 原始字节（≈512KB base64）交给原生层 */
export const ANDROID_CHUNK = 384 * 1024;
async function pushToAndroid(bridge: AndroidFiles, name: string, bytes: Uint8Array) {
  if (!bridge.begin(name)) throw new Error('无法写入临时文件');
  for (let i = 0; i < bytes.length; i += ANDROID_CHUNK) {
    if (!bridge.append(bytesToBase64(bytes.subarray(i, i + ANDROID_CHUNK)))) throw new Error('写入临时文件失败');
    // 让出主线程，大包时界面不卡死
    if (i && i % (ANDROID_CHUNK * 8) === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

export type ZipTarget = 'save' | 'share' | 'downloads';

/**
 * 把 ZIP 交给用户：
 * - 安卓（有原生桥）：share = 系统分享面板；downloads = 存进「下载」文件夹
 * - Windows（Tauri 桌面）：系统保存对话框
 * - 浏览器：直接下载
 * 返回给人看的位置；用户取消返回 null。
 */
export function deliverZip(name: string, bytes: Uint8Array, target: ZipTarget = 'save'): Promise<string | null> {
  return deliverFile(name, bytes, target, 'application/zip', 'ZIP', '导出到 Obsidian');
}

/** v0.34 通用版：明信片 PNG、花园 HTML 也走这条（安卓分享 / 存下载，Windows 保存对话框，浏览器下载） */
export async function deliverFile(name: string, bytes: Uint8Array, target: ZipTarget, mime: string, label: string, shareTitle: string): Promise<string | null> {
  const bridge = androidFiles();
  if (bridge) {
    await pushToAndroid(bridge, name, bytes);
    if (target === 'downloads') {
      const where = bridge.saveDownloads(mime);
      if (!where) throw new Error('存到下载失败');
      return where;
    }
    if (!bridge.share(mime, shareTitle)) throw new Error('打不开系统分享');
    return '分享面板';
  }
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('./tfs');
    const path = await save({ defaultPath: name, filters: [{ name: label, extensions: [name.split('.').pop() || 'zip'] }] });
    if (!path) return null;
    await writeFile(path, bytes);
    return String(path);
  }
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

// ───────── v0.21 流式写文件（.glean 备份）─────────
// 安卓：分块 base64 交给原生桥；Windows：保存对话框 + plugin-fs 打开文件逐块写；浏览器：Blob 拼接（库里的原图 Blob 不复制）后下载。
// 小块（ZIP 头）先攒到 384KB 再交出去，大块（原图 Blob）按 384KB 切片读，任何时候内存里最多一两块。
export interface FileSink {
  write(chunk: Uint8Array | Blob): Promise<void>;
  /** 写完：返回给人看的位置（取消返回 null） */
  close(): Promise<string | null>;
  abort(): Promise<void>;
}

class Coalesce {
  private parts: Uint8Array[] = [];
  private size = 0;
  private out: (b: Uint8Array) => Promise<void>;
  constructor(out: (b: Uint8Array) => Promise<void>) {
    this.out = out;
  }
  async push(c: Uint8Array | Blob) {
    if (c instanceof Blob) {
      for (let i = 0; i < c.size; i += ANDROID_CHUNK) await this.pushBytes(new Uint8Array(await c.slice(i, i + ANDROID_CHUNK).arrayBuffer()));
      return;
    }
    await this.pushBytes(c);
  }
  private async pushBytes(b: Uint8Array) {
    if (!b.length) return;
    this.parts.push(b);
    this.size += b.length;
    if (this.size >= ANDROID_CHUNK) await this.flush();
  }
  async flush() {
    if (!this.size) return;
    const all = new Uint8Array(this.size);
    let p = 0;
    for (const x of this.parts) {
      all.set(x, p);
      p += x.length;
    }
    this.parts = [];
    this.size = 0;
    for (let i = 0; i < all.length; i += ANDROID_CHUNK) await this.out(all.subarray(i, i + ANDROID_CHUNK));
  }
}

/** 打开一个「要保存的文件」。用户在保存对话框里取消时返回 null */
export async function openFileSink(name: string, opts: { mime: string; ext: string; label: string; target?: ZipTarget; shareTitle?: string }): Promise<FileSink | null> {
  const target = opts.target || 'save';
  const bridge = androidFiles();
  if (bridge) {
    if (!bridge.begin(name)) throw new Error('无法写入临时文件');
    let n = 0;
    const co = new Coalesce(async (b) => {
      if (!bridge.append(bytesToBase64(b))) throw new Error('写入临时文件失败');
      if (++n % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    });
    return {
      write: (c) => co.push(c),
      close: async () => {
        await co.flush();
        if (target === 'downloads') {
          const where = bridge.saveDownloads(opts.mime);
          if (!where) throw new Error('存到下载失败');
          return where;
        }
        if (!bridge.share(opts.mime, opts.shareTitle || name)) throw new Error('打不开系统分享');
        return '分享面板';
      },
      abort: async () => undefined,
    };
  }
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const fs = await import('./tfs');
    const path = await save({ defaultPath: name, filters: [{ name: opts.label, extensions: [opts.ext] }] });
    if (!path) return null;
    const fh = await fs.open(path, { write: true, create: true, truncate: true });
    const co = new Coalesce(async (b) => {
      await fh.write(b);
    });
    return {
      write: (c) => co.push(c),
      close: async () => {
        await co.flush();
        await fh.close();
        return String(path);
      },
      abort: async () => {
        await fh.close().catch(() => undefined);
      },
    };
  }
  const parts: BlobPart[] = [];
  return {
    write: async (c) => {
      parts.push(c as BlobPart);
    },
    close: async () => {
      const blob = new Blob(parts, { type: opts.mime });
      parts.length = 0;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return name;
    },
    abort: async () => {
      parts.length = 0;
    },
  };
}
