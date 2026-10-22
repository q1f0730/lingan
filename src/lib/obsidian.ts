// v0.15 搬去 Obsidian：把穗仓导出成一个解压即用的 Obsidian 仓库（ZIP）。
//
// 仓库结构
//   拾穗索引.md                 索引页：按类型列出每一穗、全部新枝
//   音乐/ 电影/ 图片/ 文案/ 链接/ 想法/   每穗一个 .md，YAML 头：类型、作者、年份、标签、来源、记录时间…
//   新枝/                       每根新枝一个 .md，用 [[双链]] 指回它的来源穗
//   attachments/                原图（glean-<id>.jpg 等），笔记里用 ![[attachments/…]] 嵌入
//   .obsidian/app.json          让 Obsidian 以后新贴的图也放进 attachments/
//
// 纯函数 buildVault 负责全部内容（单测直接测它）；exportObsidianZip 从数据库读数据再打包。
import { transformName } from './graft';
import { sourceIds } from './provenance';
import { dataUrlToBlob } from './imagestore';
import { makeZip, type ZipEntry } from './zip';
import { TYPE_LABEL, TYPE_ORDER, type Development, type Item, type ItemType } from './types';

export const INDEX_NOTE = '拾穗索引';
export const BRANCH_DIR = '新枝';
export const ATTACH_DIR = 'attachments';
const NAME_MAX = 60;

export interface VaultImage {
  bytes: Uint8Array;
  mime: string;
}

export interface VaultInput {
  items: Item[];
  developments: Development[];
  /** itemId → 原图 */
  images: Map<number, VaultImage>;
  /** 是否带上示例穗（默认不带） */
  includeSamples?: boolean;
  now?: number;
}

export interface VaultStats {
  items: number;
  branches: number;
  images: number;
  skippedSamples: number;
}

export interface Vault {
  files: ZipEntry[];
  stats: VaultStats;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** 文件名安全化：去掉 Obsidian 链接会断的字符（# ^ [ ] |）和 Windows 不允许的字符，限长 */
export function safeName(raw: string | undefined, fallback = '未命名'): string {
  let s = (raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > NAME_MAX) s = s.slice(0, NAME_MAX).trim();
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!s) s = fallback;
  if (RESERVED.test(s)) s += '_';
  return s;
}

/** 整个仓库里按「不分大小写」去重（Windows 文件系统不分大小写；双链按文件名找） */
function makeNamer() {
  const used = new Set<string>();
  return (base: string): string => {
    let n = base;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base} ${i}`;
    used.add(n.toLowerCase());
    return n;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 本地时间 YYYY-MM-DDTHH:mm:ss（Obsidian 的「日期和时间」属性能直接认） */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** YAML 标量：一律 JSON 双引号字符串（合法 YAML，任何字符都安全） */
const q = (s: string) => JSON.stringify(s);

/** Obsidian 标签不能有空格和部分符号 */
export function obsidianTag(t: string): string {
  return t
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_\-/]/gu, '');
}

type FM = Array<[string, string | number | boolean | string[] | undefined]>;
function frontmatter(fields: FM): string {
  const lines = ['---'];
  for (const [k, v] of fields) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (!v.length) lines.push(`${k}: []`);
      else {
        lines.push(`${k}:`);
        for (const x of v) lines.push(`  - ${q(x)}`);
      }
    } else if (typeof v === 'string') lines.push(`${k}: ${q(v)}`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

export function imageExt(mime: string): string {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/heic': 'heic',
  };
  return map[m] || 'jpg';
}

/** 双链：带路径（不会和别的同名笔记混），显示纯标题 */
export const wikilink = (path: string, label: string) => `[[${path}|${label}]]`;

/** Markdown 正文里避免把用户文字当成标题 / 列表 / 引用以外的语法：只转义行首 # 和 --- */
function bodyText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => (/^(#|---\s*$)/.test(l) ? '\\' + l : l))
    .join('\n');
}
const quoteBlock = (s: string) =>
  bodyText(s)
    .split('\n')
    .map((l) => (l ? `> ${l}` : '>'))
    .join('\n');

export function buildVault(input: VaultInput): Vault {
  const now = input.now ?? Date.now();
  const include = !!input.includeSamples;
  const all = input.items.filter((it) => it.id != null);
  const items = all.filter((it) => include || !it.sample).sort((a, b) => b.createdAt - a.createdAt);
  const skippedSamples = all.length - items.length;
  const byId = new Map(all.map((it) => [it.id!, it]));
  const exported = new Set(items.map((it) => it.id!));
  const name = makeNamer();
  // 保留名先占上，免得穗和索引页撞名
  name(INDEX_NOTE);

  // 1. 先给每一穗定好路径（新枝要链过去）
  const notePath = new Map<number, { path: string; label: string }>();
  // 起名按「先拾的先占」：同名时老的一穗保留干净的名字，之后再导出也稳定
  for (const it of [...items].reverse()) {
    const n = name(safeName(it.title));
    notePath.set(it.id!, { path: `${TYPE_LABEL[it.type] || '想法'}/${n}`, label: n });
  }
  const linkTo = (id: number): string | null => {
    const p = notePath.get(id);
    return p ? wikilink(p.path, p.label) : null;
  };
  /** 链不过去的来源（示例没导出 / 已删除）写成纯文字，不留会断的链接 */
  const sourceText = (id: number): string => {
    const l = linkTo(id);
    if (l) return l;
    const it = byId.get(id);
    if (!it) return '（已删除的穗）';
    return `「${it.title}」（示例穗，未导出）`;
  };

  // 2. 新枝：只由「未导出的示例」长出来的不导（与 v0.14「清掉示例」同一口径）
  const devs = input.developments
    .filter((d) => d && d.idea && d.id != null)
    .filter((d) => {
      const real = (d.itemIds || []).filter((x) => x > 0);
      if (!real.length) return true;
      return real.some((x) => exported.has(x) || !byId.get(x)?.sample);
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  const devPath = new Map<number, { path: string; label: string }>();
  for (const d of [...devs].reverse()) {
    const n = name(safeName(d.idea.title, '新枝'));
    devPath.set(d.id!, { path: `${BRANCH_DIR}/${n}`, label: n });
  }
  const grownFrom = new Map<number, number[]>(); // itemId → devIds
  for (const d of devs) for (const id of sourceIds(d, d.idea)) if (exported.has(id)) grownFrom.set(id, [...(grownFrom.get(id) || []), d.id!]);

  const files: ZipEntry[] = [];
  let imageCount = 0;

  // 3. 每穗一个 md
  for (const it of items) {
    const p = notePath.get(it.id!)!;
    const img = input.images.get(it.id!);
    let embed = '';
    if (img && img.bytes.length) {
      const file = `${ATTACH_DIR}/glean-${it.id}.${imageExt(img.mime)}`;
      files.push({ path: file, data: img.bytes, mtime: it.createdAt });
      embed = `![[${file}]]`;
      imageCount++;
    }
    const tags = it.tags || [];
    const fm = frontmatter([
      ['类型', TYPE_LABEL[it.type] || it.type],
      ['标题', it.title || ''],
      ['作者', it.creator || ''],
      ['年份', it.year || ''],
      ['标签', tags],
      ['tags', tags.map(obsidianTag).filter(Boolean)],
      ['来源', it.url || ''],
      ['记录时间', localStamp(it.createdAt)],
      ['修改时间', it.updatedAt && it.updatedAt !== it.createdAt ? localStamp(it.updatedAt) : undefined],
      ['为什么', it.why || undefined],
      ['示例', it.sample ? true : undefined],
      ['glean_id', it.id!],
    ]);
    const body: string[] = [];
    if (embed) body.push(embed, '');
    const meta = [it.creator, it.year].filter(Boolean).join(' · ');
    if (meta) body.push(`*${bodyText(meta)}*`, '');
    if (it.content) body.push(it.type === 'text' ? quoteBlock(it.content) : bodyText(it.content), '');
    if (it.why) body.push(`**为什么拾它**：${bodyText(it.why)}`, '');
    if (it.caption) body.push(`**看图**：${bodyText(it.caption)}`, '');
    if (it.url) body.push(`[打开来源](<${it.url}>)`, '');
    const grown = grownFrom.get(it.id!) || [];
    if (grown.length) {
      body.push('## 长出的新枝', '');
      for (const did of grown) {
        const dp = devPath.get(did)!;
        body.push(`- ${wikilink(dp.path, dp.label)}`);
      }
      body.push('');
    }
    body.push(`← ${wikilink(INDEX_NOTE, '拾穗索引')}`, '');
    files.push({ path: `${p.path}.md`, data: fm + body.join('\n'), mtime: it.updatedAt || it.createdAt });
  }

  // 4. 每根新枝一个 md
  const batchMembers = new Map<string, number[]>();
  for (const d of devs) if (d.batch?.id) batchMembers.set(d.batch.id, [...(batchMembers.get(d.batch.id) || []), d.id!]);
  for (const d of devs) {
    const p = devPath.get(d.id!)!;
    const idea = d.idea;
    const src = sourceIds(d, idea);
    const ev = idea.evidence || d.evidence || 'legacy';
    const fm = frontmatter([
      ['类型', '新枝'],
      ['标题', idea.title || ''],
      ['形式', idea.form || undefined],
      ['变形', idea.transform ? transformName(idea.transform) : undefined],
      ['来源穗', src.map((id) => linkTo(id)).filter((x): x is string => !!x)],
      ['生成', d.source === 'ai' ? 'AI' : '离线'],
      ['证据', ev === 'ok' ? '充分' : ev === 'weak' ? '证据不足' : '早先长的'],
      ['收藏', !!d.starred],
      ['主题', d.theme || undefined],
      ['记录时间', localStamp(d.createdAt)],
      ['tags', ['新枝']],
      ['glean_id', d.id!],
    ]);
    const body: string[] = [];
    if (idea.idea) body.push(bodyText(idea.idea), '');
    if (idea.bridge) body.push(`**桥**：${bodyText(idea.bridge)}`, '');
    if (idea.form) body.push(`**形式**：${bodyText(idea.form)}`, '');
    if (idea.transform) body.push(`**用了什么变形**：${transformName(idea.transform)}`, '');
    if (idea.unlike) body.push(`**和另外两根哪里不同**：${bodyText(idea.unlike)}`, '');
    const exp = idea.experiment || idea.firstStep;
    if (exp) body.push(`**20 分钟小实验**：${bodyText(exp)}`, '');
    if (idea.oblique) body.push(`**斜策略**：${bodyText(idea.oblique)}`, '');
    if (idea.cliches?.length) body.push(`**避开的套路**：${idea.cliches.map(bodyText).join('；')}`, '');
    if (ev === 'weak' && idea.evidenceNote) body.push(`> 证据不足：${bodyText(idea.evidenceNote)}`, '');
    body.push('## 因为这几穗', '');
    if (src.length) for (const id of src) body.push(`- ${sourceText(id)}`);
    else body.push('- （没有记录来源）');
    body.push('');
    const others = (d.itemIds || []).filter((x) => x > 0 && !src.includes(x));
    const gone = (d.itemIds || []).filter((x) => x <= 0).length;
    if (others.length || gone) {
      body.push('## 这次嫁接的其余素材', '');
      for (const id of others) body.push(`- ${sourceText(id)}`);
      if (gone) body.push(`- （另有 ${gone} 穗已删除）`);
      body.push('');
    }
    const sib = d.batch?.id ? (batchMembers.get(d.batch.id) || []).filter((x) => x !== d.id) : [];
    if (sib.length) {
      body.push('## 同一次嫁接的另外几根', '');
      for (const s of sib) {
        const sp = devPath.get(s)!;
        body.push(`- ${wikilink(sp.path, sp.label)}`);
      }
      body.push('');
    }
    body.push(`← ${wikilink(INDEX_NOTE, '拾穗索引')}`, '');
    files.push({ path: `${p.path}.md`, data: fm + body.join('\n'), mtime: d.createdAt });
  }

  // 5. 索引页
  const idx: string[] = [
    frontmatter([
      ['类型', '索引'],
      ['导出时间', localStamp(now)],
      ['穗', items.length],
      ['新枝', devs.length],
    ]),
    '# 拾穗 · Glean',
    '',
    `导出于 ${localStamp(now).replace('T', ' ')}，共 ${items.length} 穗、${devs.length} 根新枝${imageCount ? `、${imageCount} 张图` : ''}。${skippedSamples ? `示例穗 ${skippedSamples} 件未导出。` : ''}`,
    '',
  ];
  const groups = new Map<ItemType, Item[]>();
  for (const it of items) groups.set(it.type, [...(groups.get(it.type) || []), it]);
  for (const t of TYPE_ORDER) {
    const g = groups.get(t);
    if (!g?.length) continue;
    idx.push(`## ${TYPE_LABEL[t]}（${g.length}）`, '');
    for (const it of g) {
      const meta = [it.creator, it.year].filter(Boolean).join(' · ');
      idx.push(`- ${linkTo(it.id!)}${meta ? ` · ${bodyText(meta)}` : ''} · ${localStamp(it.createdAt).slice(0, 10)}`);
    }
    idx.push('');
  }
  if (devs.length) {
    idx.push(`## 新枝（${devs.length}）`, '');
    for (const d of devs) {
      const dp = devPath.get(d.id!)!;
      const from = sourceIds(d, d.idea)
        .map((id) => linkTo(id))
        .filter(Boolean);
      idx.push(`- ${wikilink(dp.path, dp.label)}${d.starred ? ' ★' : ''}${from.length ? ` ← ${from.join('、')}` : ''}`);
    }
    idx.push('');
  }
  if (!items.length && !devs.length) idx.push('（穗仓是空的）', '');
  files.unshift({ path: `${INDEX_NOTE}.md`, data: idx.join('\n'), mtime: now });

  files.push({
    path: '.obsidian/app.json',
    data: JSON.stringify({ attachmentFolderPath: ATTACH_DIR, newLinkFormat: 'relative', useMarkdownLinks: false, alwaysUpdateLinks: true }, null, 2),
    mtime: now,
  });

  return { files, stats: { items: items.length, branches: devs.length, images: imageCount, skippedSamples } };
}

export function vaultZipName(now = Date.now()): string {
  return `glean-obsidian-${localStamp(now).slice(0, 10)}.zip`;
}

/** 数据库 → ZIP 字节。db 用结构类型，单测可以传 fake-indexeddb 的库 */
export async function exportObsidianZip(
  d: {
    items: { toArray(): Promise<Item[]> };
    developments: { toArray(): Promise<Development[]> };
    images: { get(id: number): Promise<{ blob: Blob } | undefined> };
  },
  opts: { includeSamples?: boolean; now?: number } = {},
): Promise<{ zip: Uint8Array; stats: VaultStats }> {
  const now = opts.now ?? Date.now();
  const [items, developments] = await Promise.all([d.items.toArray(), d.developments.toArray()]);
  const images = new Map<number, VaultImage>();
  for (const it of items) {
    if (it.id == null || (!opts.includeSamples && it.sample)) continue;
    let blob: Blob | null = null;
    const r = await d.images.get(it.id);
    if (r?.blob) blob = r.blob;
    else if (typeof it.image === 'string' && it.image.startsWith('data:')) {
      try {
        blob = dataUrlToBlob(it.image);
      } catch {
        blob = null;
      }
    }
    if (blob) images.set(it.id, { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type || 'image/jpeg' });
  }
  const v = buildVault({ items, developments, images, includeSamples: opts.includeSamples, now });
  return { zip: makeZip(v.files, now), stats: v.stats };
}
