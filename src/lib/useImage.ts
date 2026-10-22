// v0.13 图片懒加载与 objectURL 回收：只给挂载着（= 在视口附近，列表是虚拟滚动）的卡片建 objectURL，卸载即回收。
import { useEffect, useRef, useState } from 'react';
import { db } from './db';
import { getOriginalBlob, isDataUrl } from './imagestore';
import type { Item } from './types';

declare global {
  interface Window {
    __gleanImg?: { live: number; created: number; revoked: number };
  }
}
const stat = { live: 0, created: 0, revoked: 0 };
if (typeof window !== 'undefined') window.__gleanImg = stat;

function makeUrl(b: Blob): string {
  stat.created++;
  stat.live++;
  return URL.createObjectURL(b);
}
function dropUrl(u: string) {
  stat.revoked++;
  stat.live--;
  URL.revokeObjectURL(u);
}

/**
 * 给一个 Blob 建 objectURL；key 不变就复用（liveQuery 每次重查都会给出新的 Blob 对象，内容没变不该重建）。
 * load 是取 Blob 的异步函数（只在 key 变时调用）。
 */
function useKeyedBlobUrl(key: string | null, load: () => Promise<Blob | null | undefined> | Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!key) {
      setUrl(undefined);
      return;
    }
    let alive = true;
    let made: string | undefined;
    Promise.resolve(loadRef.current())
      .then((b) => {
        if (!alive || !b) return;
        made = makeUrl(b);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (made) dropUrl(made);
      setUrl(undefined);
    };
  }, [key]);
  return url;
}

/** 列表用：缩略图优先；缩略图还没做好时退回原图（只有挂载时才读 images 表）；旧行内联原图直接用 */
export function useThumbSrc(item: Pick<Item, 'id' | 'thumb' | 'thumbW' | 'thumbH' | 'hasImage' | 'image'>): string | undefined {
  const inline = isDataUrl(item.image) ? item.image : undefined;
  const key = inline ? null : item.thumb ? `t:${item.id}:${item.thumbW}x${item.thumbH}:${item.thumb.size}` : item.hasImage && item.id != null ? `o:${item.id}` : null;
  const thumb = item.thumb;
  const id = item.id;
  const url = useKeyedBlobUrl(key, () => (thumb ? thumb : id != null ? getOriginalBlob(db, id) : null));
  return inline || url;
}

/** 详情用：原图 */
export function useOriginalSrc(item: Pick<Item, 'id' | 'hasImage' | 'image' | 'thumb' | 'updatedAt'> | null): string | undefined {
  const inline = item && isDataUrl(item.image) ? item.image : undefined;
  const id = item?.id;
  const key = !item || inline || id == null || !(item.hasImage || item.thumb) ? null : `o:${id}:${item.updatedAt}`;
  const url = useKeyedBlobUrl(key, () => (id != null ? getOriginalBlob(db, id) : null));
  return inline || url;
}
