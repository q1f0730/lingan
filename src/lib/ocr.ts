// v0.36 0020 + ROADMAP「截图里的字也能搜」：图片穗里的字交给 Windows 自带 OCR（Windows.Media.Ocr，离线、免模型、免 key），
// 结果写进 item.ocr，进全文索引（秒搜「图中文字」），随同步 / 备份走，手机上也搜得到。
// 只在桌面版用（Rust 命令 ocr_image，在 src-tauri/src/ocr.rs）；懒加载，首屏和网页版不加载。
// 安卓没有系统级 OCR（ML Kit 要谷歌服务或往安装包里塞 ~10MB 模型），手机上收的图回到电脑上时可以「识别旧图里的字」补上。
import { invoke } from '@tauri-apps/api/core';
import { db } from './db';
import { getOriginalBlob, itemHasImage } from './imagestore';

/** Windows OcrEngine.MaxImageDimension 是 10000；截图 / 照片缩到长边 2600 足够认字，也快 */
export const OCR_SIDE = 2600;
export const NOLANG_KEY = 'glean.ocr.nolang';
export const OCR_HINT = '没装中文 OCR：Windows 设置 → 时间和语言 → 语言和区域 → 中文（简体）→ 语言选项 → 光学字符识别，装好后在 设置 → 极速采集 里点「识别旧图里的字」';

/** 识别结果整理：行内多余空白压成一个，去空行，最多 8000 字 */
export function cleanOcr(t: string): string {
  return (t || '')
    .split('\n')
    .map((l) => l.replace(/[ \t\u3000]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 8000);
}

/** 原图 → 长边不超过 max 的 PNG 字节（BitmapDecoder 不一定认 webp，统一转 PNG） */
export async function toPng(b: Blob, max = OCR_SIDE): Promise<Uint8Array> {
  const bmp = await createImageBitmap(b);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!out) throw new Error('图片转不了');
  return new Uint8Array(await out.arrayBuffer());
}

export type OcrResult = 'ok' | 'empty' | 'nolang' | 'skip' | 'err';

/** 认一张图里的字；没装语言包返回 null 并记下（以后不再每张都试） */
export async function ocrBlob(b: Blob): Promise<string | null> {
  try {
    const t = await invoke<string>('ocr_image', await toPng(b));
    localStorage.removeItem(NOLANG_KEY);
    return cleanOcr(t);
  } catch (e) {
    if (String(e).includes('nolang')) {
      localStorage.setItem(NOLANG_KEY, '1');
      return null;
    }
    throw e;
  }
}

/** 一穗：有图、还没认过（ocr === undefined）才认 */
export async function ocrItem(id: number, force = false): Promise<OcrResult> {
  const it = await db.items.get(id);
  if (!it || it.deletedAt || !itemHasImage(it) || (!force && it.ocr !== undefined)) return 'skip';
  const blob = await getOriginalBlob(db, id);
  if (!blob) return 'skip';
  try {
    const t = await ocrBlob(blob);
    if (t === null) return 'nolang';
    await db.items.update(id, { ocr: t });
    return t ? 'ok' : 'empty';
  } catch {
    return 'err';
  }
}

/** 新穗入库后（速记 / 截图 / 拖进来 / 发送到）：第一次碰到没装语言包时提示一次 */
export async function ocrAfterAdd(id: number, onErr?: (m: string) => void): Promise<void> {
  const first = !localStorage.getItem(NOLANG_KEY);
  const r = await ocrItem(id);
  if (r === 'nolang' && first) onErr?.(OCR_HINT);
}

/** 设置里「识别旧图里的字」：所有还没认过的图片穗，一张一张来 */
export async function ocrBackfill(onStep?: (done: number, total: number) => void): Promise<{ done: number; found: number; nolang: boolean }> {
  const ids = (await db.items.filter((x) => !x.deletedAt && x.ocr === undefined && itemHasImage(x)).primaryKeys()) as number[];
  let found = 0;
  for (let i = 0; i < ids.length; i++) {
    const r = await ocrItem(ids[i]);
    if (r === 'nolang') return { done: i, found, nolang: true };
    if (r === 'ok') found++;
    onStep?.(i + 1, ids.length);
  }
  return { done: ids.length, found, nolang: false };
}
