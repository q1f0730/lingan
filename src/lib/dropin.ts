import { parseQuick, type QuickDraft } from './quick';

/**
 * v0.27 0405 / 0406 / 0407：粘贴、拖进来的东西 → 穗。
 * 只认三种：图片文件（压缩后成图片穗）、小文本文件（.txt / .md ≤ 256KB 成文案穗）、文字 / 链接（走速记同一套识别）。
 * 其它文件（PDF、压缩包…）不收，告诉用户跳过了几个。
 */
export interface TransferFile {
  name: string;
  type: string;
  size: number;
}
export interface TransferLike {
  files: TransferFile[];
  /** text/uri-list（浏览器拖链接时给的），已去掉 # 注释行 */
  uris: string[];
  text: string;
}
export type PlanStep = { kind: 'image'; index: number } | { kind: 'textfile'; index: number } | { kind: 'text'; text: string };

export const TEXT_FILE_MAX = 256 * 1024;
export const MAX_DROP = 20;
const TEXT_EXT = /\.(txt|md|markdown)$/i;

export function isImageFile(f: TransferFile): boolean {
  return /^image\/(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.type) || (!f.type && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name));
}

/** 决定这一把粘贴 / 拖放收成哪几穗（纯函数，单测覆盖）。有文件时忽略随文件附带的文字（拖文件时浏览器会塞文件名进 text）。 */
export function planTransfer(t: TransferLike): { steps: PlanStep[]; skipped: number } {
  const steps: PlanStep[] = [];
  let skipped = 0;
  t.files.forEach((f, i) => {
    if (isImageFile(f)) steps.push({ kind: 'image', index: i });
    else if ((f.type.startsWith('text/') || TEXT_EXT.test(f.name)) && f.size <= TEXT_FILE_MAX) steps.push({ kind: 'textfile', index: i });
    else skipped++;
  });
  if (!t.files.length) {
    const uris = t.uris.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
    const text = t.text.trim();
    // 拖链接：uri-list 和 text 往往是同一个地址，只收一次
    if (uris.length > 1) for (const u of uris) steps.push({ kind: 'text', text: u });
    else if (text) steps.push({ kind: 'text', text: uris[0] && !text.includes(uris[0]) ? `${text} ${uris[0]}` : text });
    else if (uris[0]) steps.push({ kind: 'text', text: uris[0] });
  }
  if (steps.length > MAX_DROP) {
    skipped += steps.length - MAX_DROP;
    steps.length = MAX_DROP;
  }
  return { steps, skipped };
}

export function fileTitle(name: string): string {
  return name.replace(/\.[a-z0-9]{1,8}$/i, '').slice(0, 60) || '无题';
}

/** DataTransfer / ClipboardData → TransferLike（取真实 File 留给执行步骤用） */
export function readTransfer(dt: DataTransfer | null): { t: TransferLike; files: File[] } {
  if (!dt) return { t: { files: [], uris: [], text: '' }, files: [] };
  const files = Array.from(dt.files || []);
  let uris: string[] = [];
  let text = '';
  try {
    uris = (dt.getData('text/uri-list') || '').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    text = dt.getData('text/plain') || '';
  } catch {
    /* 有的浏览器在非 drop 阶段读不了 */
  }
  return { t: { files: files.map((f) => ({ name: f.name, type: f.type, size: f.size })), uris, text }, files };
}

/** 拖进来的是不是外面的东西（文件 / 链接 / 文字），而不是页面里自己拖动的元素 */
export function isOutsideDrag(types: readonly string[] | null | undefined, internal: boolean): boolean {
  if (internal || !types) return false;
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
}

export async function buildDrafts(steps: PlanStep[], files: File[], opts: { compress: (f: File) => Promise<string>; readText: (f: File) => Promise<string>; caption?: string }): Promise<{ drafts: QuickDraft[]; failed: number }> {
  const drafts: QuickDraft[] = [];
  let failed = 0;
  for (const s of steps) {
    try {
      if (s.kind === 'image') {
        const f = files[s.index];
        const image = await opts.compress(f);
        const cap = (opts.caption || '').trim();
        const title = cap ? cap.slice(0, 60) : /^image\.(png|jpe?g)$/i.test(f.name) || !f.name ? '粘贴的图片' : fileTitle(f.name);
        drafts.push({ type: 'image', title, image, content: '', creator: '', year: '', url: '', why: '', tags: [] });
      } else if (s.kind === 'textfile') {
        const f = files[s.index];
        const body = (await opts.readText(f)).replace(/\r/g, '').trim();
        if (!body) {
          failed++;
          continue;
        }
        drafts.push({ type: 'text', title: fileTitle(f.name), content: body.slice(0, 20000), creator: '', year: '', url: '', why: '', tags: [] });
      } else {
        const d = parseQuick(s.text);
        if (d) drafts.push(d);
        else failed++;
      }
    } catch {
      failed++;
    }
  }
  return { drafts, failed };
}

export function dropSummary(n: number, skipped: number, failed: number): string {
  const parts = [n ? `已拾 ${n} 穗` : '没拾到东西'];
  if (skipped) parts.push(`跳过 ${skipped} 个（只收图片、文字和 .txt / .md）`);
  if (failed) parts.push(`${failed} 个没读出来`);
  return parts.join(' · ');
}
