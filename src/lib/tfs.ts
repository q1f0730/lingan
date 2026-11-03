// v0.37 体积：@tauri-apps/plugin-fs 的 JS 包（FileHandle / Resource / Watcher……约 6.9KB）只为几条命令。
// 这里按 plugin-fs 2.7.1 dist-js 的调用原样直连插件命令（参数名、读出时末尾 8 字节大端长度、写文件走原始字节 + 头部
// 都和官方实现一致），Rust 端仍是 tauri-plugin-fs，权限仍由 capabilities 的 fs:* 管。升级 plugin-fs 时对一遍 dist-js。
import { invoke } from '@tauri-apps/api/core';

export interface FileHandle {
  read(buf: Uint8Array): Promise<number | null>;
  seek(offset: number, whence: 0 | 1 | 2): Promise<number>;
  write(data: Uint8Array): Promise<number>;
  close(): Promise<void>;
}

function be(bytes: Uint8Array): number {
  let x = 0;
  for (let i = 0; i < bytes.length; i++) x = x * 256 + bytes[i];
  return x;
}

export async function open(path: string, options: { read?: boolean; write?: boolean; create?: boolean; truncate?: boolean }): Promise<FileHandle> {
  const rid = await invoke<number>('plugin:fs|open', { path, options });
  return {
    async read(buf) {
      if (!buf.byteLength) return 0;
      const data = await invoke<ArrayBuffer | number[]>('plugin:fs|read', { rid, len: buf.byteLength });
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
      const n = be(bytes.subarray(bytes.length - 8));
      buf.set(bytes.subarray(0, bytes.length - 8));
      return n === 0 ? null : n;
    },
    seek: (offset, whence) => invoke<number>('plugin:fs|seek', { rid, offset, whence }),
    write: (data) => invoke<number>('plugin:fs|write', { rid, data }),
    close: () => invoke<void>('plugin:resources|close', { rid }),
  };
}

export const exists = (path: string) => invoke<boolean>('plugin:fs|exists', { path });
export const readDir = (path: string) => invoke<Array<{ name: string; isFile: boolean; isDirectory: boolean }>>('plugin:fs|read_dir', { path });
export const stat = (path: string) => invoke<{ size: number }>('plugin:fs|stat', { path });
export const mkdir = (path: string, options?: { recursive?: boolean }) => invoke<void>('plugin:fs|mkdir', { path, options });
export const remove = (path: string) => invoke<void>('plugin:fs|remove', { path });

/** 整块写文件（原始字节进 IPC body，路径放头部，和 plugin-fs writeFile 一样；不带 options 头 = Rust 端 None，与官方传 undefined 等效） */
export const writeFile = (path: string, data: Uint8Array) =>
  invoke<void>('plugin:fs|write_file', data, { headers: { path: encodeURIComponent(path) } });
export const writeTextFile = (path: string, text: string) =>
  invoke<void>('plugin:fs|write_text_file', new TextEncoder().encode(text), { headers: { path: encodeURIComponent(path) } });
