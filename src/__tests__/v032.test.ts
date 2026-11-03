// v0.32 同步 · 二：局域网直连（真实 HTTP 往返到参考柜子 e2e/lanmock.mjs）、二维码配对、旧包压缩清理（含被清后读快照补齐）、
// 冲突计数、回执省请求、坚果云限频退避、网盘 ↔ 局域网转发、daily 不同步、同步日志。
import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterAll } from 'vitest';

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

import { LinganDB, addItem, updateItem, SYNC_TABLES } from '../lib/db';
import { adoptDeviceId } from '../lib/device';
import { toSRow } from '../lib/sync/merge';
import { SyncKey } from '../lib/sync/crypto';
import { MemoryTransport, TransportError, WebDavTransport, type SyncTransport } from '../lib/sync/transport';
import { compact, freshState, maybeSnapshot, readDevs, retire, syncOnce, type SyncState } from '../lib/sync/engine';
import { encodePair, isLanHost, lanAuthKey, LanTransport, pairKeys, parsePair, redeem, sealBundle, toHex } from '../lib/sync/lan';
import { LOG_MAX, pushLog } from '../lib/sync/index';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
const DEV = (n: number) => `01J000000000000000000DEV0${n}`.slice(0, 26);
interface Dev {
  id: string;
  d: LinganDB;
  st: SyncState;
}
async function mkDev(n: number): Promise<Dev> {
  const id = DEV(n);
  adoptDeviceId(id);
  const d = new LinganDB(uniq('v032-' + n));
  await d.open();
  return { id, d, st: freshState() };
}
async function on<T>(dev: Dev, fn: () => Promise<T>): Promise<T> {
  adoptDeviceId(dev.id);
  return fn();
}
const sync = (dev: Dev, tr: SyncTransport, key: SyncKey, opts?: { compactNow?: boolean }) => on(dev, () => syncOnce({ d: dev.d, tr, key, state: dev.st, dev: dev.id, info: { name: `设备 ${dev.id.slice(-1)}`, plat: '测试' } }, opts));
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
const opsOf = (tr: MemoryTransport, dev: string) => [...tr.files.keys()].filter((p) => p.startsWith(`ops/${dev}/`)).length;

// 参考柜子（Node http，协议同 lancore.rs）
interface Mock {
  port: number;
  files: Map<string, { b: Uint8Array }>;
  stats: Record<string, number>;
  setAuth(hex: string | null): void;
  setOffer(authHex: string, bundle: Uint8Array, ttl?: number): void;
  stop(): Promise<void>;
}
const mocks: Mock[] = [];
async function mock(): Promise<Mock> {
  const mod = (await import(/* @vite-ignore */ '../../e2e/lanmock.mjs' as string)) as { startLanMock: (p?: number) => Promise<Mock> };
  const m = await mod.startLanMock(0);
  mocks.push(m);
  return m;
}
afterAll(async () => {
  for (const m of mocks) await m.stop();
});
const nf = (u: string, i?: RequestInit) => fetch(u, i);

describe('ROADMAP v0.22 局域网直连（真实 HTTP 到参考柜子）', () => {
  beforeEach(() => localStorage.clear());
  it('签名请求：列 / 取 / 只追加 / 覆盖 / 删；钥匙不对、没签名都被拒（中文原因）', async () => {
    const m = await mock();
    const key = SyncKey.generate();
    const auth = await lanAuthKey(key.raw);
    m.setAuth(toHex(auth));
    const tr = await LanTransport.connect(['127.0.0.1'], m.port, auth, nf);
    expect(await tr.put('ops/A/00000001.op', new Uint8Array([1, 2, 3]), { ifNone: true })).toBe(true);
    expect(await tr.put('ops/A/00000001.op', new Uint8Array([9]), { ifNone: true })).toBe(false);
    expect([...(await tr.get('ops/A/00000001.op'))!]).toEqual([1, 2, 3]);
    expect((await tr.list('ops')).map((e) => [e.path, e.dir])).toEqual([['ops/A', true]]);
    expect((await tr.list('ops/A')).map((e) => e.path)).toEqual(['ops/A/00000001.op']);
    await tr.put('dev/x.json', new Uint8Array([1]));
    await tr.put('dev/x.json', new Uint8Array([2, 2]));
    expect((await tr.get('dev/x.json'))!.length).toBe(2);
    await tr.delete('ops/A/00000001.op');
    expect(await tr.get('ops/A/00000001.op')).toBeNull();
    expect(await tr.list('nothing')).toEqual([]);
    const wrong = await LanTransport.connect(['127.0.0.1'], m.port, await lanAuthKey(SyncKey.generate().raw), nf);
    await expect(wrong.list('ops')).rejects.toThrow(/重新显示二维码/);
    const raw = await fetch(`http://127.0.0.1:${m.port}/lan/v1/list?dir=`);
    expect(raw.status).toBe(401);
    await expect(LanTransport.connect(['127.0.0.1'], 1, auth, nf, 500)).rejects.toThrow(/同一个 Wi-Fi/);
  });

  it('手机收 5 条、电脑收 5 条（含 1 张图）：同步后两边都是 10 条且无重复；断开再同步只传增量', async () => {
    const m = await mock();
    const key = SyncKey.generate();
    const auth = await lanAuthKey(key.raw);
    m.setAuth(toHex(auth));
    const phone = await mkDev(1);
    const pc = await mkDev(2);
    for (let i = 0; i < 5; i++) await on(phone, () => addItem(item(`手机 ${i}`), phone.d));
    const imgId = await on(phone, () => addItem(item('手机拍的图', { type: 'image' }), phone.d));
    await on(phone, async () => {
      await phone.d.images.put({ itemId: imgId, blob: new Blob([new Uint8Array([7, 7, 7, 7])], { type: 'image/png' }) });
      await phone.d.items.update(imgId, { hasImage: 1 });
    });
    for (let i = 0; i < 4; i++) await on(pc, () => addItem(item(`电脑 ${i}`), pc.d));
    const trPc = await LanTransport.connect(['127.0.0.1'], m.port, auth, nf);
    const trPhone = await LanTransport.connect(['10.255.255.1', '127.0.0.1'].filter(isLanHost).slice(1), m.port, auth, nf);
    await sync(pc, trPc, key); // 电脑先把自己的放进柜子
    const s1 = await sync(phone, trPhone, key); // 手机推 6 收 4
    const s2 = await sync(pc, trPc, key); // 电脑收到手机推送的通知后合并
    expect(s1.pushedRows).toBe(6);
    expect(s1.changed).toBe(4);
    expect(s2.changed).toBe(6);
    expect(s1.imagesUp).toBe(1);
    expect(s2.imagesDown).toBe(1);
    expect(await phone.d.items.count()).toBe(10);
    expect(await pc.d.items.count()).toBe(10);
    expect(await view(phone.d)).toEqual(await view(pc.d));
    const pcImg = await pc.d.items.where('uid').equals((await phone.d.items.get(imgId))!.uid!).first();
    expect([...new Uint8Array(await (await pc.d.images.get(pcImg!.id!))!.blob.arrayBuffer())]).toEqual([7, 7, 7, 7]);
    // 柜子里全是密文
    for (const [, f] of m.files) expect(new TextDecoder().decode(f.b).includes('手机')).toBe(false);
    // 「断开」后再连：只传新的那一条
    const t2 = await LanTransport.connect(['127.0.0.1'], m.port, auth, nf);
    await on(phone, () => addItem(item('断开后新收的'), phone.d));
    const before = m.stats.bytesIn;
    const s3 = await sync(phone, t2, key);
    expect(s3.pushedRows).toBe(1);
    expect(s3.changed).toBe(0);
    expect(m.stats.bytesIn - before).toBeLessThan(4000);
    expect((await sync(pc, trPc, key)).changed).toBe(1);
    expect(await pc.d.items.count()).toBe(11);
  });

  it('0645 二维码配对：一次性、过期作废，配对包只有扫到码的能解开；二维码只认局域网地址', async () => {
    const m = await mock();
    const key = SyncKey.generate();
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const text = encodePair({ hosts: ['127.0.0.1'], port: m.port, secret, name: '我的电脑' });
    expect(text.startsWith('glean://lan?v=1&')).toBe(true);
    const p = parsePair(text);
    expect(p.name).toBe('我的电脑');
    expect([...p.secret]).toEqual([...secret]);
    m.setOffer(toHex((await pairKeys(secret)).auth), await sealBundle(secret, { v: 1, key: btoa(String.fromCharCode(...key.raw)), name: '我的电脑', dev: DEV(9) }));
    const r = await redeem(p, nf);
    expect(r.bundle.name).toBe('我的电脑');
    expect(r.bundle.key).toBe(btoa(String.fromCharCode(...key.raw)));
    await expect(redeem(p, nf)).rejects.toThrow(/用过或过期/);
    // 别的配对码解不开、签不过
    m.setOffer(toHex((await pairKeys(secret)).auth), await sealBundle(secret, { v: 1, key: 'x', name: 'n', dev: DEV(9) }));
    const other = parsePair(encodePair({ hosts: ['127.0.0.1'], port: m.port, secret: crypto.getRandomValues(new Uint8Array(32)), name: 'x' }));
    await expect(redeem(other, nf)).rejects.toThrow(/配对失败（401）/);
    m.setOffer(toHex((await pairKeys(secret)).auth), new Uint8Array(4), -1);
    await expect(redeem(p, nf)).rejects.toThrow(/用过或过期/);
    expect(() => parsePair('https://example.com')).toThrow(/不是拾穗/);
    expect(() => parsePair(encodePair({ hosts: ['8.8.8.8'], port: 1, secret, name: 'x' }))).toThrow(/局域网地址/);
    expect(['192.168.1.5', '10.0.0.2', '172.20.1.1', '127.0.0.1'].every(isLanHost)).toBe(true);
    expect(['8.8.8.8', '172.32.0.1', 'evil.com', '192.168.1'].some(isLanHost)).toBe(false);
  });
});

describe('旧包压缩清理（快照后删所有设备都确认过的包）', () => {
  beforeEach(() => localStorage.clear());
  it('只删已进快照且所有设备回执都确认的自己的包；没确认的设备挡住清理；移除后照清；回来的设备读快照补齐', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    const C = await mkDev(3);
    for (let i = 0; i < 6; i++) {
      await on(A, () => addItem(item(`A${i}`), A.d));
      await sync(A, tr, key);
    }
    await sync(B, tr, key);
    await sync(C, tr, key);
    expect(opsOf(tr, A.id)).toBe(6);
    // C 之后不再同步（离线），A 继续写；B 跟上
    for (let i = 6; i < 9; i++) {
      await on(A, () => addItem(item(`A${i}`), A.d));
      await sync(A, tr, key);
    }
    await sync(B, tr, key);
    const s = await sync(A, tr, key, { compactNow: true });
    expect(s.compacted).toBe(6); // C 只确认到 6
    expect(opsOf(tr, A.id)).toBe(3);
    // 移除 C：不再等它
    await on(A, () => retire({ d: A.d, tr, key, state: A.st, dev: A.id }, C.id));
    expect((await on(A, () => readDevs({ tr, key, state: A.st }))).gone.has(C.id)).toBe(true);
    expect((await sync(A, tr, key, { compactNow: true })).compacted).toBe(3);
    expect(opsOf(tr, A.id)).toBe(0);
    // C 回来：中间的包没了 → 读 A 的全库快照补齐，结果一致；它的 .gone 也自己删掉
    await on(A, () => addItem(item('清理之后'), A.d));
    await sync(A, tr, key);
    const sc = await sync(C, tr, key);
    expect(sc.gapSnaps).toBe(1);
    expect(await C.d.items.count()).toBe(10);
    expect(await view(C.d)).toEqual(await view(A.d));
    expect(tr.files.has(`dev/${C.id}.gone`)).toBe(false);
    // 新设备 D 从快照起步也一样
    const D = await mkDev(4);
    await sync(D, tr, key);
    expect(await view(D.d)).toEqual(await view(A.d));
  });

  it('只有一台设备、或别的设备还是 v0.31（没回执）时不清', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    for (let i = 0; i < 3; i++) {
      await on(A, () => addItem(item(`A${i}`), A.d));
      await sync(A, tr, key);
    }
    expect((await sync(A, tr, key, { compactNow: true })).compacted).toBe(0);
    // 模拟 v0.31 设备：只推过包、不写回执
    tr.files.set('ops/01J000000000000000000OLD01/00000001.op', new Uint8Array([0]));
    await on(A, () => maybeSnapshot({ d: A.d, tr, key, state: A.st, dev: A.id }, true));
    expect(await on(A, () => compact({ d: A.d, tr, key, state: A.st, dev: A.id }))).toBe(0);
    expect(opsOf(tr, A.id)).toBe(3);
  });
});

describe('0660 冲突计数 / 0659 省请求与退避 / 转发 / 0663', () => {
  beforeEach(() => localStorage.clear());
  it('两台设备在上次同步后都改了同一字段：记 1 次冲突（取较新的一边）；改不同字段不算', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    const id = await on(A, () => addItem(item('共同', { why: '原来' }), A.d));
    await sync(A, tr, key);
    await sync(B, tr, key);
    const bid = (await B.d.items.toArray())[0].id!;
    await on(A, () => updateItem(id, { why: 'A 改的' }, A.d));
    await on(B, () => updateItem(bid, { why: 'B 改的' }, B.d));
    await sync(A, tr, key);
    const sb = await sync(B, tr, key);
    expect(sb.conflicts).toBe(1);
    await sync(A, tr, key);
    expect((await A.d.items.get(id))!.why).toBe((await B.d.items.get(bid))!.why);
    await on(A, () => updateItem(id, { title: 'A 改标题' }, A.d));
    await on(B, () => updateItem(bid, { why: 'B 再改' }, B.d));
    await sync(A, tr, key);
    expect((await sync(B, tr, key)).conflicts).toBe(0);
  });

  it('回执说没新包就不列那台设备的目录；回执没变也不重写', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    await on(A, () => addItem(item('一'), A.d));
    await sync(A, tr, key);
    await sync(B, tr, key);
    await sync(A, tr, key);
    const lists = tr.lists;
    const puts = tr.puts;
    const gets = tr.gets;
    const s = await sync(B, tr, key);
    expect(s.skippedLists).toBe(1);
    expect(tr.lists - lists).toBe(2); // 只列 ops/ 和 dev/
    expect(tr.puts).toBe(puts);
    expect(tr.gets).toBe(gets);
    // A 推了新包 → 回执变了 → B 去列、拉到
    await on(A, () => addItem(item('二'), A.d));
    await sync(A, tr, key);
    const s2 = await sync(B, tr, key);
    expect(s2.skippedLists).toBe(0);
    expect(s2.changed).toBe(1);
  });

  it('坚果云限频：429 按 Retry-After 退避后成功；一直 429 给中文原因', async () => {
    const waits: number[] = [];
    WebDavTransport.sleep = async (ms) => void waits.push(ms);
    let n = 0;
    const fn = async () => (n++ < 2 ? new Response('', { status: 429, headers: { 'Retry-After': '3' } }) : new Response(new Uint8Array([5]).buffer as ArrayBuffer, { status: 200 }));
    const dav = new WebDavTransport({ url: 'https://dav.example.com/dav/', user: 'u', pass: 'p' }, fn);
    expect([...(await dav.get('x'))!]).toEqual([5]);
    expect(waits).toEqual([3000, 3000]);
    waits.length = 0;
    const always = new WebDavTransport({ url: 'https://dav.example.com/dav/', user: 'u', pass: 'p' }, async () => new Response('', { status: 503 }));
    await expect(always.get('x')).rejects.toBeInstanceOf(TransportError);
    expect(waits).toEqual([1000, 2000, 4000]);
    const busy = new WebDavTransport({ url: 'https://dav.example.com/dav/', user: 'u', pass: 'p' }, async () => new Response('', { status: 429 }));
    await expect(busy.get('x')).rejects.toThrow(/太频繁/);
  });

  it('网盘 ↔ 局域网转发：只在网盘里的设备的穗，经同时开两种的电脑转给只在局域网里的手机', async () => {
    const cloud = new MemoryTransport();
    const lan = new MemoryTransport();
    const k1 = SyncKey.generate();
    const k2 = SyncKey.generate();
    const laptop = await mkDev(1);
    const pc = await mkDev(2);
    const pcLan = { ...pc, st: freshState() };
    const phone = await mkDev(3);
    await sync(pc, cloud, k1);
    await sync(pcLan, lan, k2);
    await sync(phone, lan, k2);
    await on(laptop, () => addItem(item('笔记本上收的'), laptop.d));
    await sync(laptop, cloud, k1);
    await sync(pc, cloud, k1);
    pcLan.st.relay = [...(pc.st.touched || [])]; // index.ts 里由 queueRelay 做
    const s = await sync(pcLan, lan, k2);
    expect(s.pushedRows).toBe(1);
    await sync(phone, lan, k2);
    expect((await phone.d.items.toArray()).map((x) => x.title)).toEqual(['笔记本上收的']);
  });

  it('0663 每日一穗 daily 表不同步；同步日志只留最近 20 次', async () => {
    expect((SYNC_TABLES as readonly string[]).includes('daily')).toBe(false);
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    await on(A, () => addItem(item('穗'), A.d));
    await A.d.daily.put({ day: '2026-11-03', ids: [1] } as never);
    await sync(A, tr, key);
    await sync(B, tr, key);
    expect(await B.d.daily.count()).toBe(0);
    let log = undefined as ReturnType<typeof pushLog> | undefined;
    for (let i = 0; i < 25; i++) log = pushLog(log, { at: i, ok: i % 2 === 0, via: '局域网', msg: `第 ${i} 次`, push: 0, pull: 0, conflicts: 0, ms: 1 });
    expect(log!.length).toBe(LOG_MAX);
    expect(log![0].msg).toBe('第 24 次');
  });
});

describe('0645 配对二维码生成（lib/qrcode.ts，用独立解码器解回来核对）', () => {
  it('短 / 配对链接长度 / 带中文名 / 长内容都能被解码器读回原文', async () => {
    const { qrMatrix, qrSvg } = await import('../lib/qrcode');
    const { default: decodeQR } = (await import(/* @vite-ignore */ 'qr/decode.js' as string)) as { default: (img: { width: number; height: number; data: Uint8Array }) => string };
    const secret = new Uint8Array(32).map((_, i) => (i * 37) & 255);
    const cases = ['glean', encodePair({ hosts: ['192.168.1.23', '10.0.0.8'], port: 47322, secret, name: 'Windows电脑 7K2Q' }), 'x'.repeat(300) + '尾巴'];
    for (const text of cases) {
      const m = qrMatrix(text);
      const sc = 4;
      const border = 4;
      const n = (m.length + border * 2) * sc;
      const data = new Uint8Array(n * n * 4).fill(255);
      for (let y = 0; y < m.length; y++)
        for (let x = 0; x < m.length; x++)
          if (m[y][x])
            for (let dy = 0; dy < sc; dy++)
              for (let dx = 0; dx < sc; dx++) {
                const o = (((y + border) * sc + dy) * n + (x + border) * sc + dx) * 4;
                data[o] = data[o + 1] = data[o + 2] = 0;
              }
      expect(decodeQR({ width: n, height: n, data })).toBe(text);
    }
    expect(qrSvg('glean')).toMatch(/^<svg [^>]*viewBox="0 0 29 29"/);
  });
});
