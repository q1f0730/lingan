const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Save text to a user-chosen file. Returns a description of where, or null if cancelled. */
export async function saveTextFile(name: string, text: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
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
export async function deliverZip(name: string, bytes: Uint8Array, target: ZipTarget = 'save'): Promise<string | null> {
  const mime = 'application/zip';
  const bridge = androidFiles();
  if (bridge) {
    await pushToAndroid(bridge, name, bytes);
    if (target === 'downloads') {
      const where = bridge.saveDownloads(mime);
      if (!where) throw new Error('存到下载失败');
      return where;
    }
    if (!bridge.share(mime, '导出到 Obsidian')) throw new Error('打不开系统分享');
    return '分享面板';
  }
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ defaultPath: name, filters: [{ name: 'ZIP', extensions: ['zip'] }] });
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
