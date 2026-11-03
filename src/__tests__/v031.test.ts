// v0.31 同步地基：HLC、字段级合并（属性测试：任意顺序收敛）、端到端加密与恢复码、WebDAV 传输、多设备同步引擎、
// 同步前快照与「回到同步前」、本机偏好进 .glean。
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  } as Storage;
}
(globalThis as unknown as { localStorage: Storage }).localStorage = memStorage();

import { LinganDB, addItem, updateItem, trashItems, purgeTrash, SYNC_TABLES } from '../lib/db';
import { adoptDeviceId } from '../lib/device';
import { fmtHlc, hlcFromWall, parseHlc, recv, tick, HLC_ZERO } from '../lib/hlc';
import { mergeS, sameS, toSRow, type SRow } from '../lib/sync/merge';
import { decodeB32, encodeB32, makeHeader, newRecoveryCode, openHeader, rewrapPass, SyncKey } from '../lib/sync/crypto';
import { MemoryTransport, parseMultistatus, WebDavTransport } from '../lib/sync/transport';
import { freshState, syncOnce, undoLastSync, maybeSnapshot, type SyncState } from '../lib/sync/engine';
import { applyImport, BlobSink, exportGlean, planImport, readBackupFile } from '../lib/backup';
import { mergePrefs, readLocalPrefs, LOCAL_KEYS } from '../lib/localprefs';
import { restoreSnapshot, snapDb, takeSnapshot } from '../lib/snapshots';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
const DEV = (n: number) => `01J000000000000000000DEV0${n}`.slice(0, 26);

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

describe('0602 HLC', () => {
  it('同一毫秒内单调递增，字符串比较 = 先后', () => {
    const a = tick(1000, DEV(1));
    const b = tick(1000, DEV(1));
    const c = tick(999, DEV(1)); // 墙钟回拨也不倒退
    expect(a < b && b < c).toBe(true);
    expect(parseHlc(c)!.ms).toBe(1000);
  });
  it('收到更大的远端 HLC 后，本机的修改排在它后面', () => {
    const far = fmtHlc(Date.now() + 3_600_000, 5, DEV(2));
    recv(far);
    expect(tick(Date.now(), DEV(1)) > far).toBe(true);
  });
  it('旧行按 updatedAt 换算', () => {
    expect(hlcFromWall(1700000000000, DEV(3))).toBe(`1700000000000-0000-${DEV(3)}`);
    expect(HLC_ZERO < hlcFromWall(1, 'A')).toBe(true);
  });
});

// ───────── 0619 / 0620 合并属性测试 ─────────

/** 一行在三台设备上的随机编辑史：每台设备从共同起点出发各改各的字段 */
function randomReplicas(r: () => number, n = 3): SRow[] {
  const hc = fmtHlc(1000, 0, DEV(1));
  const base: SRow = { t: 'items', u: 'U1', r: { title: 't0', why: 'w0', tags: ['a'], type: 'film' }, hc, h: hc };
  const fields = ['title', 'why', 'tags', 'deletedAt', 'creator'];
  const out: SRow[] = [];
  for (let d = 0; d < n; d++) {
    const s: SRow = JSON.parse(JSON.stringify(base));
    const k = 1 + Math.floor(r() * 4);
    for (let i = 0; i < k; i++) {
      const f = fields[Math.floor(r() * fields.length)];
      const h = fmtHlc(1000 + Math.floor(r() * 50), Math.floor(r() * 3), DEV(d + 1));
      if (h <= (s.fh?.[f] ?? s.hc)) continue;
      if (r() < 0.15) delete s.r[f];
      else s.r[f] = f === 'tags' ? [`x${d}${i}`] : f === 'deletedAt' ? 2000 + d : `${f}-${d}-${i}`;
      s.fh = { ...(s.fh || {}), [f]: h };
      if (h > s.h) s.h = h;
    }
    out.push(s);
  }
  return out;
}

describe('0619 字段级 LWW + 0620 属性测试', () => {
  it('交换律 / 结合律 / 幂等：300 组随机编辑史', () => {
    const r = rng(42);
    for (let i = 0; i < 300; i++) {
      const [a, b, c] = randomReplicas(r);
      expect(sameS(mergeS(a, b), mergeS(b, a))).toBe(true);
      expect(sameS(mergeS(mergeS(a, b), c), mergeS(a, mergeS(b, c)))).toBe(true);
      expect(sameS(mergeS(a, a), a) || sameS(mergeS(a, a), mergeS(a, a))).toBe(true);
      const m = mergeS(mergeS(a, b), c);
      expect(sameS(mergeS(m, b), m)).toBe(true);
    }
  });
  it('两台设备改同一穗的不同字段：两处修改都留下', () => {
    const hc = fmtHlc(1000, 0, DEV(1));
    const base: SRow = { t: 'items', u: 'U', r: { title: 'a', why: 'x' }, hc, h: hc };
    const A = { ...base, r: { ...base.r, title: 'A 改了标题' }, fh: { title: fmtHlc(2000, 0, DEV(1)) }, h: fmtHlc(2000, 0, DEV(1)) };
    const B = { ...base, r: { ...base.r, why: 'B 改了为什么' }, fh: { why: fmtHlc(1500, 0, DEV(2)) }, h: fmtHlc(1500, 0, DEV(2)) };
    expect(mergeS(A, B).r).toEqual({ title: 'A 改了标题', why: 'B 改了为什么' });
  });
  it('0628 缩略图、向量、嫁接统计不进同步行', () => {
    const s = toSRow('items', { id: 3, uid: 'U', title: 't', type: 'film', thumb: 'blob', embedding: [1, 2], graftCount: 4, touchedAt: 9, dup: ['k'], hlc: HLC_ZERO, hc: HLC_ZERO } as never);
    expect(Object.keys(s.r).sort()).toEqual(['title', 'type']);
  });
});

// ───────── 0616 / 0618 加密 ─────────

describe('0616 端到端加密 + 0618 恢复码', () => {
  it('Base32 恢复码：八组四位，往返一致，大小写 / I L O 宽容', () => {
    const c = newRecoveryCode();
    expect(c).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    const b = decodeB32(c)!;
    expect(encodeB32(b)).toBe(c);
    expect(decodeB32(c.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o'))).toEqual(b);
    expect(decodeB32('ABC')).toBeNull();
  });
  it('口令 / 恢复码都能解开数据钥；错的解不开；换口令后旧口令失效', async () => {
    const k = SyncKey.generate();
    const code = newRecoveryCode();
    const h = await makeHeader('correct horse', k, code, 1, { m: 1024, t: 1, p: 1 });
    expect(JSON.stringify(h)).not.toContain('correct horse');
    expect((await openHeader(h, { pass: 'correct horse' })).raw).toEqual(k.raw);
    expect((await openHeader(h, { code })).raw).toEqual(k.raw);
    await expect(openHeader(h, { pass: 'wrong pass' })).rejects.toThrow('同步口令不对');
    await expect(openHeader(h, { code: newRecoveryCode() })).rejects.toThrow('恢复码不对');
    const h2 = await rewrapPass(h, k, 'new pass 123');
    await expect(openHeader(h2, { pass: 'correct horse' })).rejects.toThrow();
    expect((await openHeader(h2, { pass: 'new pass 123' })).raw).toEqual(k.raw);
    expect((await openHeader(h2, { code })).raw).toEqual(k.raw);
  });
  it('密文绑定路径：挪了地方解不开；改一个字节解不开', async () => {
    const k = SyncKey.generate();
    const box = await k.sealJson({ a: '秘密' }, 'ops/A/00000001.op');
    expect(new TextDecoder().decode(box)).not.toContain('秘密');
    expect(await k.openJson(box, 'ops/A/00000001.op')).toEqual({ a: '秘密' });
    await expect(k.openJson(box, 'ops/A/00000002.op')).rejects.toThrow();
    box[30] ^= 1;
    await expect(k.openJson(box, 'ops/A/00000001.op')).rejects.toThrow();
  });
});

// ───────── 0614 WebDAV ─────────

/** 极简 WebDAV 服务（内存）：PROPFIND Depth 1 / GET / PUT（If-None-Match）/ MKCOL / DELETE */
export function fakeDav(root = '/dav/') {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([root]);
  let auths = 0;
  const fn = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname);
    const hdr = (init.headers || {}) as Record<string, string>;
    if (hdr.Authorization !== 'Basic ' + btoa('me@x.com:app-pass')) return (auths++, new Response('', { status: 401 }));
    const m = init.method || 'GET';
    if (m === 'MKCOL') {
      if (dirs.has(p.replace(/\/?$/, '/'))) return new Response('', { status: 405 });
      dirs.add(p.replace(/\/?$/, '/'));
      return new Response('', { status: 201 });
    }
    if (m === 'PUT') {
      if (hdr['If-None-Match'] === '*' && files.has(p)) return new Response('', { status: 412 });
      files.set(p, new Uint8Array(init.body as ArrayBuffer));
      return new Response('', { status: 201 });
    }
    if (m === 'GET') return files.has(p) ? new Response(files.get(p)!.slice().buffer as ArrayBuffer, { status: 200 }) : new Response('', { status: 404 });
    if (m === 'DELETE') return (files.delete(p), new Response(null, { status: 204 }));
    if (m === 'PROPFIND') {
      const d = p.replace(/\/?$/, '/');
      if (!dirs.has(d)) return new Response('', { status: 404 });
      const kids = new Set<string>();
      for (const x of [...files.keys(), ...dirs]) if (x.startsWith(d) && x !== d) kids.add(d + x.slice(d.length).split('/')[0] + (x.slice(d.length).includes('/') ? '/' : ''));
      const resp = (href: string, dir: boolean, size = 0) => `<D:response><D:href>${encodeURI(href)}</D:href><D:propstat><D:prop>${dir ? '<D:resourcetype><D:collection/></D:resourcetype>' : `<D:resourcetype/><D:getcontentlength>${size}</D:getcontentlength><D:getetag>"e${size}"</D:getetag>`}</D:prop></D:propstat></D:response>`;
      const body = `<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${resp(d, true)}${[...kids].map((k) => resp(k, k.endsWith('/'), files.get(k)?.length || 0)).join('')}</D:multistatus>`;
      return new Response(body, { status: 207 });
    }
    return new Response('', { status: 400 });
  };
  return { fn, files, dirs, auths: () => auths };
}

describe('0612 / 0614 传输层', () => {
  it('解析 multistatus（命名空间前缀随意）', () => {
    const x = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/Glean/ops/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/dav/Glean/a%20b.op</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>12</d:getcontentlength></d:prop></d:propstat></d:response></d:multistatus>';
    expect(parseMultistatus(x)).toEqual([
      { href: '/dav/Glean/ops/', size: 0, etag: undefined, dir: true },
      { href: '/dav/Glean/a%20b.op', size: 12, etag: undefined, dir: false },
    ]);
  });
  it('WebDAV：建目录、只追加（已存在不覆盖）、列目录、取、删；账号不对报中文错', async () => {
    const dav = fakeDav();
    const tr = new WebDavTransport({ url: 'https://dav.example.com/dav/', user: 'me@x.com', pass: 'app-pass' }, dav.fn as never);
    expect(await tr.put('ops/D1/00000001.op', new Uint8Array([1, 2, 3]), { ifNone: true })).toBe(true);
    expect(await tr.put('ops/D1/00000001.op', new Uint8Array([9]), { ifNone: true })).toBe(false);
    expect(await tr.get('ops/D1/00000001.op')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await tr.list('ops')).toEqual([{ path: 'ops/D1', size: 0, etag: undefined, dir: true }]);
    expect((await tr.list('ops/D1')).map((e) => [e.path, e.size, e.dir])).toEqual([['ops/D1/00000001.op', 3, false]]);
    expect(await tr.list('nothing')).toEqual([]);
    await tr.delete('ops/D1/00000001.op');
    expect(await tr.get('ops/D1/00000001.op')).toBeNull();
    const bad = new WebDavTransport({ url: 'https://dav.example.com/dav/', user: 'me@x.com', pass: 'nope' }, dav.fn as never);
    await expect(bad.get('x')).rejects.toThrow('拒绝了账号');
  });
});

// ───────── 0613 多设备同步引擎 ─────────

interface Dev {
  id: string;
  d: LinganDB;
  st: SyncState;
}
async function mkDev(n: number): Promise<Dev> {
  const id = DEV(n);
  adoptDeviceId(id);
  const d = new LinganDB(uniq('sync-' + n));
  await d.open();
  return { id, d, st: freshState() };
}
async function on<T>(dev: Dev, fn: () => Promise<T>): Promise<T> {
  adoptDeviceId(dev.id);
  return fn();
}
async function sync(dev: Dev, tr: MemoryTransport, key: SyncKey, snapshot?: (l: string) => Promise<number | null>) {
  return on(dev, () => syncOnce({ d: dev.d, tr, key, state: dev.st, dev: dev.id, snapshot }));
}
/** 一台设备上会同步的内容（按 uid），比较用 */
async function view(d: LinganDB) {
  const out: Record<string, unknown> = {};
  for (const t of SYNC_TABLES) {
    const idToUid = new Map<number, string>();
    if (t === 'developments') for (const it of await d.items.toArray()) idToUid.set(it.id!, it.uid!);
    for (const r of (await d.table(t).toArray()) as Array<Record<string, unknown>>) {
      const s = toSRow(t, r as never, (id) => idToUid.get(id) ?? null);
      out[`${t}:${s.u}`] = JSON.stringify(Object.fromEntries(Object.entries(s.r).sort(([a], [b]) => (a < b ? -1 : 1))));
    }
  }
  return out;
}
const item = (title: string, extra: Record<string, unknown> = {}) => ({ type: 'film' as const, title, tags: [] as string[], ...extra });

describe('0613 文件型同步协议（内存传输）', () => {
  beforeEach(() => localStorage.clear());
  it('手机收 5 条、电脑收 5 条：同步后两边都是 10 条且无重复；再同步只传增量', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    for (let i = 0; i < 5; i++) await on(A, () => addItem(item(`手机 ${i}`), A.d));
    for (let i = 0; i < 5; i++) await on(B, () => addItem(item(`电脑 ${i}`), B.d));
    await sync(A, tr, key);
    const sB = await sync(B, tr, key);
    const sA = await sync(A, tr, key);
    expect(sB.pushedRows).toBe(5);
    expect(sB.changed).toBe(5);
    expect(sA.changed).toBe(5);
    expect(await A.d.items.count()).toBe(10);
    expect(await B.d.items.count()).toBe(10);
    expect(await view(A.d)).toEqual(await view(B.d));
    // 增量：什么都没改 → 不推不收
    const puts = tr.puts;
    const s2 = await sync(A, tr, key);
    expect(s2.pushedRows + s2.changed).toBe(0);
    expect(tr.puts).toBe(puts);
    // 改一条 → 只推这一行
    const one = (await A.d.items.toArray())[0];
    await on(A, () => updateItem(one.id!, { why: '新写的为什么' }, A.d));
    const s3 = await sync(A, tr, key);
    expect(s3.pushedRows).toBe(1);
    await sync(B, tr, key);
    expect((await B.d.items.where('uid').equals(one.uid!).first())!.why).toBe('新写的为什么');
    // 云上全是密文
    for (const [p, b] of tr.files) expect(p.endsWith('.op') || p.endsWith('.snap') ? new TextDecoder().decode(b).includes('手机') : false).toBe(false);
  });

  it('属性测试：3 台设备随机增 / 改 / 删 / 彻底删 / 随机顺序同步，最后都收敛到同一份', async () => {
    for (const seed of [1, 7, 23]) {
      localStorage.clear();
      localStorage.setItem('glean.sync.v1', '{}'); // 开着同步：彻底删记墓碑
      const r = rng(seed);
      const tr = new MemoryTransport();
      const key = SyncKey.generate();
      const devs = [await mkDev(1), await mkDev(2), await mkDev(3)];
      for (let step = 0; step < 60; step++) {
        const dv = devs[Math.floor(r() * 3)];
        const x = r();
        const rows = await dv.d.items.toArray();
        const pick = rows[Math.floor(r() * rows.length)];
        if (x < 0.35 || !pick) await on(dv, () => addItem(item(`s${seed}-${step}`, { why: `w${step}` }), dv.d));
        else if (x < 0.6) await on(dv, () => updateItem(pick.id!, r() < 0.5 ? { title: `改${step}` } : { tags: [`t${step}`] }, dv.d));
        else if (x < 0.7) await on(dv, () => trashItems([pick.id!], dv.d));
        else if (x < 0.75 && pick.deletedAt) await on(dv, () => purgeTrash({ items: [pick.id!] }, dv.d));
        else await sync(dv, tr, key);
      }
      for (let round = 0; round < 2; round++) for (const dv of devs) await sync(dv, tr, key);
      const v0 = await view(devs[0].d);
      expect(Object.keys(v0).length).toBeGreaterThan(5);
      expect(await view(devs[1].d)).toEqual(v0);
      expect(await view(devs[2].d)).toEqual(v0);
    }
  });

  it('同一条穗两台设备同时改不同字段：字段级合并，两处都留', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    const id = await on(A, () => addItem(item('原标题', { why: '原因' }), A.d));
    await sync(A, tr, key);
    await sync(B, tr, key);
    const bid = (await B.d.items.toArray())[0].id!;
    await on(A, () => updateItem(id, { title: 'A 改的标题' }, A.d));
    await on(B, () => updateItem(bid, { why: 'B 改的为什么' }, B.d));
    await sync(A, tr, key);
    await sync(B, tr, key);
    await sync(A, tr, key);
    for (const d of [A.d, B.d]) {
      const it = (await d.items.toArray())[0];
      expect([it.title, it.why]).toEqual(['A 改的标题', 'B 改的为什么']);
    }
  });

  it('原图：加密内容寻址，同一张只传一次，对端拿到逐字节一样的图；新枝的穗引用换成对端本机 id', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    await on(B, () => addItem(item('B 先有一条'), B.d)); // 让两边本机 id 错开
    const bytes = new Uint8Array(3000).map((_, i) => (i * 7) & 255);
    const id = await on(A, () => addItem(item('有图'), A.d));
    await A.d.images.put({ itemId: id, blob: new Blob([bytes], { type: 'image/png' }) });
    await A.d.items.update(id, { hasImage: 1 });
    const id2 = await on(A, () => addItem(item('第二条'), A.d));
    await on(A, () => A.d.developments.add({ itemIds: [id, id2], jump: 1, idea: { title: '新枝', body: 'x' } as never, source: 'offline', createdAt: Date.now() }));
    const s = await sync(A, tr, key);
    expect(s.imagesUp).toBe(1);
    await sync(B, tr, key);
    const bi = (await B.d.items.toArray()).find((x) => x.title === '有图');
    const im = await B.d.images.get(bi!.id!);
    expect(new Uint8Array(await im!.blob.arrayBuffer())).toEqual(bytes);
    expect(im!.blob.type).toBe('image/png');
    expect(bi!.hasImage).toBe(1);
    const dv = (await B.d.developments.toArray())[0];
    const b2 = (await B.d.items.toArray()).find((x) => x.title === '第二条');
    expect(dv.itemIds).toEqual([bi!.id, b2!.id]);
    // 再同步：图不再传
    await on(A, () => updateItem(id, { why: '改一下' }, A.d));
    expect((await sync(A, tr, key)).imagesUp).toBe(0);
    expect([...tr.files.keys()].filter((p) => p.startsWith('img/')).length).toBe(1);
  });

  it('新设备从全库快照起步：少拉很多包，结果一样', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    for (let i = 0; i < 12; i++) {
      await on(A, () => addItem(item(`第 ${i} 条`), A.d));
      await sync(A, tr, key);
    }
    await on(A, () => maybeSnapshot({ d: A.d, tr, key, state: A.st, dev: A.id }, true));
    const C = await mkDev(3);
    tr.gets = 0;
    const s = await sync(C, tr, key);
    expect(s.fromSnapshot).toBe(true);
    expect(s.pulledOps).toBe(0);
    expect(await view(C.d)).toEqual(await view(A.d));
    await on(A, () => addItem(item('快照之后'), A.d));
    await sync(A, tr, key);
    expect((await sync(C, tr, key)).pulledOps).toBe(1);
    expect(await C.d.items.count()).toBe(13);
  });

  it('0615 同步前自动快照 + 回到同步前：本机回去，别的设备也跟着回去（新来的进回收站）', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const sdb = snapDb(uniq('snap'));
    const A = await mkDev(1);
    const B = await mkDev(2);
    const id = await on(A, () => addItem(item('共同的', { why: '原来的为什么' }), A.d));
    await sync(A, tr, key);
    await sync(B, tr, key);
    // A 改了为什么、又新收了一条；B 同步时拍快照
    await on(A, () => updateItem(id, { why: 'A 后来改坏了' }, A.d));
    await on(A, () => addItem(item('A 新收的'), A.d));
    await sync(A, tr, key);
    const s = await sync(B, tr, key, (label) => on(B, () => takeSnapshot(label, B.d, { s: sdb })));
    expect(s.snapId).not.toBeNull();
    expect(await B.d.items.count()).toBe(2);
    const r = await on(B, () => undoLastSync({ d: B.d, tr, key, state: B.st, dev: B.id }, async (sid) => void (await restoreSnapshot(sid, B.d, { s: sdb }))));
    expect(r).toEqual({ restamped: 1, trashed: 1 });
    expect((await B.d.items.toArray()).map((x) => x.why)).toEqual(['原来的为什么']);
    await sync(B, tr, key);
    await sync(A, tr, key);
    const a = await A.d.items.toArray();
    expect(a.find((x) => x.title === '共同的')!.why).toBe('原来的为什么');
    expect(a.find((x) => x.title === 'A 新收的')!.deletedAt).toBeGreaterThan(0);
  });

  it('本机状态丢了也不覆盖云上自己的旧包（序号接着往后）', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    await on(A, () => addItem(item('一'), A.d));
    await sync(A, tr, key);
    const before = new Map(tr.files);
    A.st = freshState();
    await on(A, () => addItem(item('二'), A.d));
    await sync(A, tr, key);
    for (const [p, b] of before) if (p.startsWith('ops/')) expect(tr.files.get(p)).toEqual(b);
    expect([...tr.files.keys()].filter((p) => p.startsWith(`ops/${A.id}/`)).length).toBe(2);
  });

  it('从别的设备备份导进来的旧行也会被推出去（行 hlc 重新盖本机章，字段 HLC 保留）', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const X = await mkDev(5);
    await on(X, () => addItem(item('别处的穗'), X.d));
    const sink = new BlobSink();
    await exportGlean(sink, X.d, { now: Date.now() });
    const A = await mkDev(1);
    await on(A, () => addItem(item('本机的'), A.d));
    await sync(A, tr, key); // 已经推过一次：之后只推本机章
    const inc = await readBackupFile(sink.blob());
    await on(A, async () => applyImport(inc, await planImport(inc, A.d, 'merge'), A.d));
    const s = await sync(A, tr, key);
    expect(s.pushedRows).toBe(1);
    const B = await mkDev(2);
    await sync(B, tr, key);
    expect((await B.d.items.toArray()).map((x) => x.title).sort()).toEqual(['本机的', '别处的穗'].sort());
  });
});

// ───────── v0.30 遗留：本机偏好进 .glean / 快照 ─────────

describe('口味原子 / 自写斜策略卡 / 出站记录进 .glean 备份与快照', () => {
  beforeEach(() => localStorage.clear());
  const atoms = { at: 1, source: 'offline', atoms: [{ atom: '留白', uids: ['U1'], weight: 4 }, { atom: '手写感', uids: [], weight: 5, mine: 1 as const }] };
  it('导出带上，清掉后导入回来；合并 = 并集去重', async () => {
    localStorage.setItem(LOCAL_KEYS.atoms, JSON.stringify(atoms));
    localStorage.setItem(LOCAL_KEYS.cards, JSON.stringify(['拿掉最重要的那个']));
    localStorage.setItem(LOCAL_KEYS.outbound, JSON.stringify([{ at: 5, host: 'api.x.com', kind: 'chat', fields: ['文字'], bytes: 10, ok: true }]));
    const d = new LinganDB(uniq('lp'));
    await addItem(item('一条'), d);
    const sink = new BlobSink();
    await exportGlean(sink, d, { now: Date.now() });
    localStorage.clear();
    localStorage.setItem(LOCAL_KEYS.cards, JSON.stringify(['本机自己的卡']));
    const inc = await readBackupFile(sink.blob());
    expect(inc.problems).toEqual([]);
    await applyImport(inc, await planImport(inc, d, 'merge'), d);
    const lp = readLocalPrefs();
    expect(lp.atoms!.atoms.map((a) => a.atom)).toEqual(['留白', '手写感']);
    expect(lp.cards).toEqual(['本机自己的卡', '拿掉最重要的那个']);
    expect(lp.outbound.length).toBe(1);
    // 再导一次：不重复
    await applyImport(inc, await planImport(inc, d, 'merge'), d);
    expect(readLocalPrefs().outbound.length).toBe(1);
    expect(readLocalPrefs().cards.length).toBe(2);
    // 替换：备份为准
    await applyImport(inc, await planImport(inc, d, 'replace'), d);
    expect(readLocalPrefs().cards).toEqual(['拿掉最重要的那个']);
  });
  it('合并：本机已有的原子留着（自己改过的排前面），备份里多的补上', () => {
    const local = { atoms: { at: 2, source: 'ai', atoms: [{ atom: '夜车', uids: [], weight: 3 }] }, cards: [], outbound: [] };
    const m = mergePrefs(local, { atoms, cards: [], outbound: [] }, 'merge');
    expect(m.atoms!.atoms.map((a) => a.atom)).toEqual(['手写感', '夜车', '留白']);
    expect(mergePrefs(local, { atoms, cards: [], outbound: [] }, 'missing').atoms!.atoms.length).toBe(3);
  });
  it('操作快照带上本机偏好，恢复时一起回去', async () => {
    localStorage.setItem(LOCAL_KEYS.cards, JSON.stringify(['快照前的卡']));
    const d = new LinganDB(uniq('lps'));
    const sdb = snapDb(uniq('snap2'));
    const sid = await takeSnapshot('测试', d, { s: sdb });
    localStorage.setItem(LOCAL_KEYS.cards, JSON.stringify(['后来的卡']));
    await restoreSnapshot(sid, d, { s: sdb });
    expect(readLocalPrefs().cards).toEqual(['快照前的卡']);
  });
});
