import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { addItem, LinganDB, replayPendingWrites, trashItems } from '../lib/db';
import { BlobSink, exportGlean, incomingFromObject } from '../lib/backup';
import {
  autoBackupTick,
  backupName,
  blobLike,
  keepSet,
  librarySig,
  parseBackupName,
  runBackup,
  toDelete,
  verifyGlean,
  type BackupFile,
  type BackupTarget,
} from '../lib/autobackup';
import { dumpBeforeUpgrade, KEEP, listSnapshots, restoreSnapshot, snapDb, snapshotToBackupJson, takeSnapshot, withSnapshot } from '../lib/snapshots';
import { enqueuePending, isStorageError, PendingWriteError, readPending, replayPending, PENDING_IMAGE_MAX } from '../lib/safewrite';
import { needsPreUpgradeDump } from '../lib/upgradeguard';
import { apkName, parseSums, sumsUrl } from '../lib/update';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
function jpeg(tag: string, kb = 2): string {
  return 'data:image/jpeg;base64,' + btoa('\xff\xd8' + tag.padEnd(kb * 1024, '#'));
}
function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
async function seed(d: LinganDB, n = 4) {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(await addItem({ type: i % 2 ? 'image' : 'text', title: `穗 ${i}`, content: `内容 ${i}`, tags: ['夜'], ...(i % 2 ? { image: jpeg(`img${i}`) } : {}) }, d));
  return ids;
}
/** 内存里的备份目标（测试用） */
function memTarget(): BackupTarget & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>();
  return {
    id: 'memory',
    files,
    where: async () => 'memory',
    list: async () => [...files].map(([name, b]) => ({ name, bytes: b.size })),
    create: async (name) => {
      const parts: BlobPart[] = [];
      return {
        write: async (c) => void parts.push(c as BlobPart),
        close: async () => void files.set(name, new Blob(parts)),
        abort: async () => undefined,
      };
    },
    remove: async (name) => void files.delete(name),
    reader: async (name) => {
      const b = files.get(name)!;
      return blobLike(b.size, async (off, len) => new Uint8Array(await b.slice(off, off + len).arrayBuffer()));
    },
  };
}

describe('v0.26 自动备份：名字与 GFS 轮转（0606 0508）', () => {
  const day = 86400000;
  const base = new Date(2026, 10, 3, 10, 0, 0).getTime();
  it('名字能解析回时间与种类', () => {
    const n = backupName('auto', base);
    expect(n).toBe('glean-auto-2026-11-03-100000.glean');
    expect(parseBackupName(n, 9)).toEqual({ name: n, bytes: 9, at: base, kind: 'auto' });
    const p = backupName('pre-update', base, 'v0.26.0');
    expect(p).toBe('glean-pre-update-0.26.0-2026-11-03-100000.glean');
    expect(parseBackupName(p)?.kind).toBe('pre-update');
    expect(parseBackupName('glean-backup-2026-11-03-1000.glean')).toBeNull();
    expect(parseBackupName('random.glean')).toBeNull();
  });
  it('GFS：每天一份留 7 天、每周一份留 4 周、每月一份留 12 月', () => {
    // 400 天，每天两份
    const files: BackupFile[] = [];
    for (let i = 0; i < 400; i++)
      for (const h of [0, 6]) {
        const at = base - i * day - h * 3600000;
        files.push({ name: backupName('auto', at), at, bytes: 1, kind: 'auto' });
      }
    const keep = keepSet(files, 'gfs');
    const kept = files.filter((f) => keep.has(f.name)).sort((a, b) => b.at - a.at);
    // 最近 7 天每天最新的一份
    for (let i = 0; i < 7; i++) expect(keep.has(backupName('auto', base - i * day))).toBe(true);
    expect(keep.has(backupName('auto', base - 6 * 3600000))).toBe(false);
    // 总数 ≤ 7 + 4 + 12，且最老的一份不超过 12 个月
    expect(kept.length).toBeLessThanOrEqual(23);
    expect(kept.length).toBeGreaterThanOrEqual(15);
    expect(base - kept[kept.length - 1].at).toBeLessThan(366 * day);
    const months = new Set(kept.map((f) => `${new Date(f.at).getFullYear()}-${new Date(f.at).getMonth()}`));
    expect(months.size).toBe(12);
  });
  it('只留最近 7 份；更新前的备份另算，留最近 3 份；手动的不删', () => {
    const files: BackupFile[] = [];
    for (let i = 0; i < 10; i++) files.push({ name: backupName('auto', base - i * day), at: base - i * day, bytes: 1, kind: 'auto' });
    for (let i = 0; i < 5; i++) files.push({ name: backupName('pre-update', base - i * day, '0.2' + i + '.0'), at: base - i * day, bytes: 1, kind: 'pre-update' });
    files.push({ name: backupName('manual', base - 99 * day), at: base - 99 * day, bytes: 1, kind: 'manual' });
    const del = toDelete(files, 'last7');
    expect(del.filter((n) => n.includes('-auto-'))).toHaveLength(3);
    expect(del.filter((n) => n.includes('pre-update'))).toHaveLength(2);
    expect(del.some((n) => n.includes('manual'))).toBe(false);
    // 删掉的更新前备份是最老的两份
    expect(del).toContain(backupName('pre-update', base - 4 * day, '0.24.0'));
  });
});

describe('v0.26 备份回读校验（0637）', () => {
  it('完好的 .glean 通过；改一个字节就报哈希不对；截断报目录读不出', async () => {
    const d = new LinganDB(uniq('vf'));
    await seed(d, 6);
    const sink = new BlobSink();
    await exportGlean(sink, d, { now: 1_800_000_000_000 });
    const blob = sink.blob();
    const ok = await verifyGlean(blob);
    expect(ok.ok).toBe(true);
    expect(ok.files).toBe(4); // data.jsonl + 3 张图
    expect(ok.counts?.items).toBe(6);
    // 随机读的 BlobLike 也一样能验
    const like = blobLike(blob.size, async (o, l) => new Uint8Array(await blob.slice(o, o + l).arrayBuffer()));
    expect((await verifyGlean(like)).ok).toBe(true);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bytes[200] ^= 0xff; // 第一张图的数据里
    const bad = await verifyGlean(new Blob([bytes]));
    expect(bad.ok).toBe(false);
    expect(bad.problems.join()).toMatch(/哈希不对|大小不对|读不出/);
    const cut = await verifyGlean(blob.slice(0, blob.size - 30));
    expect(cut.ok).toBe(false);
  });
});

describe('v0.26 跑一次备份 + 自动备份节奏', () => {
  it('写 → 校验 → 轮转；库没变不重复写；空库不写', async () => {
    const d = new LinganDB(uniq('ab'));
    const t = memTarget();
    expect(await autoBackupTick('0.26.0', Date.now(), d)).toBeNull(); // 网页版（node）没有目标
    await seed(d, 3);
    const now = new Date(2026, 10, 3, 9).getTime();
    const r = await runBackup('auto', '0.26.0', { target: t, d, now });
    expect(r.verify.ok).toBe(true);
    expect(r.stats.items).toBe(3);
    expect([...t.files.keys()]).toEqual([backupName('auto', now)]);
    // 旧的自动备份超过 7 份时（last7 由 localStorage 设；这里默认 GFS）：同一天的旧份被顶掉
    const r2 = await runBackup('auto', '0.26.0', { target: t, d, now: now + 3600000 });
    expect(r2.removed).toEqual([backupName('auto', now)]);
    expect(t.files.size).toBe(1);
    // 库签名：改一穗就变
    const s1 = await librarySig(d);
    await trashItems([1], d);
    expect(await librarySig(d)).not.toBe(s1);
  });
  it('同时点两次只跑一份', async () => {
    const d = new LinganDB(uniq('ab2'));
    await seed(d, 2);
    const t = memTarget();
    const [a, b] = await Promise.all([runBackup('manual', 'x', { target: t, d, now: 1 }), runBackup('manual', 'x', { target: t, d, now: 2 })]);
    expect(a.name).toBe(b.name);
    expect(t.files.size).toBe(1);
  });
});

describe('v0.26 操作前快照（0621）', () => {
  it('拍快照 → 乱删 → 回到快照：穗、新枝、原图都回来，且恢复前又拍了一张', async () => {
    const d = new LinganDB(uniq('sn'));
    const s = snapDb(uniq('snapdb'));
    const ids = await seed(d, 4);
    await d.developments.add({ itemIds: [ids[0], ids[1]], jump: 0.5, idea: { title: '枝', bridge: 'b', idea: 'i', cliches: [], refs: [1, 2], evidence: 'ok' }, createdAt: 1, source: 'llm' } as never);
    const imgId = ids[1];
    const { snapId } = await withSnapshot('清空回收站前', d, async () => {
      await d.transaction('rw', [d.items, d.images, d.developments], async () => {
        await d.items.bulkDelete(ids);
        await d.images.bulkDelete(ids);
        await d.developments.clear();
      });
    }, { s, imagesOf: ids });
    expect(await d.items.count()).toBe(0);
    const list = await listSnapshots(s);
    expect(list[0].label).toBe('清空回收站前');
    expect(list[0].counts).toEqual({ items: 4, developments: 1, cliches: 0, images: 2 });
    // 新收一穗再恢复：它不在快照里（恢复前的快照里有它）
    await addItem({ type: 'text', title: '之后收的', tags: [] }, d);
    const r = await restoreSnapshot(snapId!, d, { s });
    expect(r.items).toBe(4);
    expect((await d.items.toArray()).map((x) => x.title).sort()).toEqual(['穗 0', '穗 1', '穗 2', '穗 3']);
    expect(await d.developments.count()).toBe(1);
    expect((await d.images.get(imgId))?.blob).toBeTruthy();
    expect(await d.items.get(ids[2])).toBeTruthy(); // 同一个本机 id
    const after = await listSnapshots(s);
    expect(after[0].label).toBe('恢复「清空回收站前」前');
    expect(after[0].counts.items).toBe(1);
  });
  it('只留最近 10 张；required=false 时快照失败也照做', async () => {
    const d = new LinganDB(uniq('sn2'));
    const s = snapDb(uniq('snapdb2'));
    await seed(d, 1);
    for (let i = 0; i < 13; i++) await takeSnapshot(`第 ${i} 张`, d, { s, now: i });
    const list = await listSnapshots(s);
    expect(list).toHaveLength(KEEP.op);
    expect(list[list.length - 1].label).toBe('第 3 张');
    const broken = { snaps: { add: async () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } } } as unknown as ReturnType<typeof snapDb>;
    let ran = 0;
    const r = await withSnapshot('x', d, async () => ++ran, { s: broken, required: false });
    expect(r).toEqual({ result: 1, snapId: null });
    await expect(withSnapshot('x', d, async () => ++ran, { s: broken })).rejects.toThrow(/什么都没改/);
    expect(ran).toBe(1);
  });
});

describe('v0.26 升级前副本（0624）', () => {
  it('旧版本的库：按旧版本原样读出存一份，转成「导入备份」认的 JSON', async () => {
    const name = uniq('old');
    // 用原生 IndexedDB 建一个「v9」库（IndexedDB 版本 90），只放 items / developments
    await new Promise<void>((res, rej) => {
      const r = indexedDB.open(name, 90);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('items', { keyPath: 'id', autoIncrement: true }).createIndex('createdAt', 'createdAt');
        db.createObjectStore('developments', { keyPath: 'id', autoIncrement: true });
        const tx = r.transaction!;
        tx.objectStore('items').add({ type: 'text', title: '老穗', tags: ['旧'], createdAt: 5, uid: '01HZZZZZZZZZZZZZZZZZZZZZZZ' });
        tx.objectStore('items').add({ type: 'film', title: '老电影', tags: [], createdAt: 6 });
      };
      r.onsuccess = () => {
        r.result.close();
        res();
      };
      r.onerror = () => rej(r.error);
    });
    expect(await needsPreUpgradeDump(name, 10, 0)).toBe(90);
    expect(await needsPreUpgradeDump(name, 10, 10)).toBe(0); // 上次已经是 10：平常启动直接跳过
    expect(await needsPreUpgradeDump(name, 9, 0)).toBe(0); // 不比代码旧
    expect(await needsPreUpgradeDump(uniq('none'), 10, 0)).toBe(0); // 新装
    const s = snapDb(uniq('snapdb3'));
    const id = await dumpBeforeUpgrade(name, 90, 10, { s, appVersion: '0.26.0' });
    const snap = await s.snaps.get(id!);
    expect(snap?.kind).toBe('pre-upgrade');
    expect(snap?.schema).toBe(9);
    expect(snap?.items.map((x) => x.title)).toEqual(['老穗', '老电影']);
    const inc = incomingFromObject(JSON.parse(snapshotToBackupJson(snap!)));
    expect(inc.items).toHaveLength(2);
    // 迁移自己照常（库还在、版本没被改）
    const d = new LinganDB(name);
    await d.open();
    expect(await d.items.count()).toBe(2);
    d.close();
  });
});

describe('v0.26 写入失败兜底（0605）', () => {
  it('认得出存储层错误，不把数据错误当成存储问题', () => {
    expect(isStorageError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }))).toBe(true);
    expect(isStorageError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(isStorageError(Object.assign(new Error('x'), { name: 'DatabaseClosedError' }))).toBe(true);
    expect(isStorageError(Object.assign(new Error('x'), { name: 'ConstraintError' }))).toBe(false);
    expect(isStorageError(new TypeError('bad'))).toBe(false);
  });
  it('暂存（大图只留文字）→ 重放：补进去、重复 uid 只算一次、写不进去的留到下次', async () => {
    const st = memStorage();
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(PENDING_IMAGE_MAX + 10);
    const e1 = enqueuePending({ type: 'text', title: '一', tags: [] }, { createdAt: 100 }, st);
    const e2 = enqueuePending({ type: 'image', title: '二', image: big, tags: [] }, { createdAt: 200 }, st);
    enqueuePending({ type: 'text', title: '三', tags: [] }, { createdAt: 300 }, st);
    expect(e2.imageDropped).toBe(true);
    expect(readPending(st)).toHaveLength(3);
    const got: string[] = [];
    let fail = true;
    const r = await replayPending(
      async (e) => {
        if (e.data.title === '三' && fail) throw new Error('still full');
        got.push(String(e.data.title));
      },
      async (uid) => uid === e1.uid,
      st,
    );
    expect(r).toEqual({ done: 2, left: 1 });
    expect(got).toEqual(['二']); // 一已在库里
    fail = false;
    expect(await replayPending(async (e) => void got.push(String(e.data.title)), async () => false, st)).toEqual({ done: 1, left: 0 });
    expect(st.m.has('glean.pending.v1')).toBe(false);
  });
  it('addItem 写库失败 → 抛 PendingWriteError 并暂存；下次重放按原时间和 uid 补进库', async () => {
    const st = memStorage();
    const g = globalThis as unknown as { localStorage?: unknown };
    const prev = g.localStorage;
    g.localStorage = st;
    try {
      const d = new LinganDB(uniq('pw'));
      await d.open();
      const spy = vi.spyOn(d, 'transaction').mockImplementationOnce((() => Promise.reject(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }))) as never);
      const err = await addItem({ type: 'text', title: '差点丢了', why: '因为', tags: ['夜'] }, d, { inbox: true }).catch((e) => e);
      spy.mockRestore();
      expect(err).toBeInstanceOf(PendingWriteError);
      expect(String(err.message)).toMatch(/存储空间不够.*下次打开自动补进穗仓/);
      expect(await d.items.count()).toBe(0);
      const q = readPending(st);
      expect(q).toHaveLength(1);
      expect(await replayPendingWrites(d)).toEqual({ done: 1, left: 0 });
      const rows = await d.items.toArray();
      expect(rows.map((x) => [x.title, x.why, x.uid, x.createdAt])).toEqual([['差点丢了', '因为', q[0].uid, q[0].createdAt]]);
      // 再重放一次不会重复
      enqueuePending({ type: 'text', title: '差点丢了', tags: [] }, { uid: q[0].uid, createdAt: q[0].createdAt }, st);
      expect(await replayPendingWrites(d)).toEqual({ done: 1, left: 0 });
      expect(await d.items.count()).toBe(1);
      // 数据本身不合法（不是存储问题）照常抛原错误，不暂存
      const spy2 = vi.spyOn(d, 'transaction').mockImplementationOnce((() => Promise.reject(Object.assign(new Error('dup'), { name: 'ConstraintError' }))) as never);
      await expect(addItem({ type: 'text', title: 'x', tags: [] }, d)).rejects.toThrow('dup');
      spy2.mockRestore();
      expect(readPending(st)).toHaveLength(0);
    } finally {
      g.localStorage = prev;
    }
  });
});

describe('v0.26 安卓应用内更新（0512 0732）', () => {
  it('从 SHA256SUMS.txt 找安装包哈希', () => {
    const txt = `2ec2220ec4b1e3a70fcf9bf8a6a1fcfd26ccfe4ddde655e70fc3c1c5e8b6da6f  Glean_0.26.0_android.apk\n3287f0c55d320fbb0a091f0c073868811cf6726a3cac8d575d05bf79adc0970d  Glean_0.26.0_x64-setup.exe\n`;
    expect(parseSums(txt, apkName('v0.26.0'))).toBe('2ec2220ec4b1e3a70fcf9bf8a6a1fcfd26ccfe4ddde655e70fc3c1c5e8b6da6f');
    expect(parseSums(txt.replace(/\n/g, '\r\n'), 'Glean_0.26.0_x64-setup.exe')).toMatch(/^3287/);
    expect(parseSums(txt, 'Glean_0.25.0_android.apk')).toBeNull();
    expect(parseSums('', 'x')).toBeNull();
    expect(sumsUrl('0.26.0')).toBe('https://github.com/q1f0730/lingan/releases/download/v0.26.0/SHA256SUMS.txt');
  });
});
