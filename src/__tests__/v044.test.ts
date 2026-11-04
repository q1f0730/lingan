// v0.44 常驻得安静 · 配方跟着走：速记条草稿首帧恢复、配方 / 智能穗束进同步、桌面 / 安卓外壳（窗口首帧再亮、
// 开机静默启动推迟后台活、崩溃记录、第一次关窗口提示、托盘从剪贴板拾 / 暂停剪贴板提示、跟着鼠标换屏、记住窗口、
// 正式版日志、release profile、安卓最近任务隐藏画面）。
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

import { LinganDB, addItem } from '../lib/db';
import { adoptDeviceId } from '../lib/device';
import { SyncKey } from '../lib/sync/crypto';
import { MemoryTransport } from '../lib/sync/transport';
import { freshState, syncOnce, type SyncState } from '../lib/sync/engine';
import { listsOf, mergeReg, stampLocal, type PrefReg } from '../lib/sync/prefs';
import { secureOn, SECURE_KEY } from '../lib/chrome';

const DEV = (n: number) => `01J000000000000000000PRF0${n}`.slice(0, 26);
interface Dev {
  id: string;
  d: LinganDB;
  st: SyncState;
  ls: Storage;
}
async function mkDev(n: number): Promise<Dev> {
  const id = DEV(n);
  adoptDeviceId(id);
  const d = new LinganDB('prefs-' + n + '-' + Math.random().toString(36).slice(2));
  await d.open();
  return { id, d, st: freshState(), ls: memStorage() };
}
function sync(dev: Dev, tr: MemoryTransport, key: SyncKey, now?: number) {
  adoptDeviceId(dev.id);
  return syncOnce({ d: dev.d, tr, key, state: dev.st, dev: dev.id, prefsStore: dev.ls, now });
}
const recipes = (ls: Storage) => JSON.parse(ls.getItem('glean.recipes') || '[]') as Array<{ name: string; mode: string; count?: number }>;
const smart = (ls: Storage) => JSON.parse(ls.getItem('glean.smart') || '[]') as Array<{ q: string; at: number }>;
const setR = (ls: Storage, list: unknown[]) => ls.setItem('glean.recipes', JSON.stringify(list));
const setS = (ls: Storage, list: unknown[]) => ls.setItem('glean.smart', JSON.stringify(list));

describe('v0.43 遗留：配方与智能穗束进同步', () => {
  beforeEach(() => localStorage.clear());

  it('手机存的配方、电脑存的智能穗束，同步后两边都有；改名不撞、同名取新', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    setR(A.ls, [{ name: '远距 · 3 穗', mode: 'far', count: 3 }]);
    setS(B.ls, [{ q: '#雨 电影', at: 1 }]);
    await sync(A, tr, key);
    const sB = await sync(B, tr, key);
    await sync(A, tr, key);
    expect(sB.prefs).toBeGreaterThan(0);
    expect(recipes(B.ls).map((r) => r.name)).toEqual(['远距 · 3 穗']);
    expect(smart(A.ls).map((s) => s.q)).toEqual(['#雨 电影']);
    // 同名配方两边都改：后改的赢
    setR(A.ls, [{ name: '远距 · 3 穗', mode: 'far', count: 4 }]);
    await sync(A, tr, key);
    setR(B.ls, [{ name: '远距 · 3 穗', mode: 'far', count: 5 }]);
    await sync(B, tr, key);
    await sync(A, tr, key);
    expect(recipes(A.ls)[0].count).toBe(5);
    expect(recipes(B.ls)[0].count).toBe(5);
  });

  it('一边删了，另一边同步后也删掉（墓碑），不会被同步回来', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    setS(A.ls, [{ q: '夜晚', at: 2 }, { q: '城市', at: 1 }]);
    await sync(A, tr, key);
    await sync(B, tr, key);
    expect(smart(B.ls).length).toBe(2);
    setS(B.ls, [{ q: '城市', at: 1 }]);
    await sync(B, tr, key);
    await sync(A, tr, key);
    await sync(B, tr, key);
    expect(smart(A.ls).map((s) => s.q)).toEqual(['城市']);
    expect(smart(B.ls).map((s) => s.q)).toEqual(['城市']);
  });

  it('什么都没改再同步：不多列目录、不重传（回执里的指纹没变就不下 prefs 文件）', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    setR(A.ls, [{ name: '时间差', mode: 'span' }]);
    adoptDeviceId(A.id);
    await addItem({ type: 'film', title: '一', tags: [] }, A.d);
    await sync(A, tr, key);
    await sync(B, tr, key);
    await sync(A, tr, key);
    await sync(B, tr, key);
    const [lists, puts, gets] = [tr.lists, tr.puts, tr.gets];
    const s = await sync(B, tr, key);
    expect(s.prefs).toBe(0);
    expect(tr.lists - lists).toBe(2);
    expect(tr.puts).toBe(puts);
    expect(tr.gets).toBe(gets);
    expect([...tr.files.keys()].filter((p) => p.startsWith('prefs/')).sort()).toEqual([`prefs/${A.id}.json`, `prefs/${B.id}.json`]);
  });

  it('云端的 prefs 文件是密文；没开配方 / 智能穗束的设备不上传', async () => {
    const tr = new MemoryTransport();
    const key = SyncKey.generate();
    const A = await mkDev(1);
    const B = await mkDev(2);
    setR(A.ls, [{ name: '只想看的那一束', mode: 'near' }]);
    await sync(A, tr, key);
    const box = tr.files.get(`prefs/${A.id}.json`)!;
    expect(new TextDecoder().decode(box)).not.toContain('只想看的那一束');
    await sync(B, tr, key);
    expect(recipes(B.ls).length).toBe(1);
    // B 只是收下了 A 的配方（自己没新建）：登记表和 A 那份一样，也会上传自己那份（别的设备按回执指纹认），但 C 这种什么都没有的不传
    const C = await mkDev(3);
    C.ls = memStorage();
    const tr2 = new MemoryTransport();
    await sync(C, tr2, key);
    expect([...tr2.files.keys()].some((p) => p.startsWith('prefs/'))).toBe(false);
  });

  it('合并按名字、HLC 大的赢；上限 8 / 12；坏条目丢掉', () => {
    const a: PrefReg = { r: { x: ['2', { name: 'x', mode: 'm', v: 1 }] }, s: {} };
    const b: PrefReg = { r: { x: ['3', { name: 'x', mode: 'm', v: 2 }], y: ['1', { name: '冒名', mode: 'm' }] }, s: { q: ['9', 0] } };
    const m = mergeReg(a, b);
    expect((m.r.x[1] as { v: number }).v).toBe(2);
    expect(m.r.y).toBeUndefined();
    expect(m.s.q).toEqual(['9', 0]);
    const ls = memStorage();
    setR(ls, Array.from({ length: 12 }, (_, i) => ({ name: 'r' + i, mode: 'far' })));
    const reg = stampLocal(ls, { r: {}, s: {} });
    expect(listsOf(reg).r.length).toBe(8);
  });
});

describe('v0.43 遗留：速记条草稿首帧恢复', () => {
  const src = import.meta.glob('../components/QuickBar.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const q = Object.values(src)[0];
  it('useDraft 在 useState 初始化里读草稿（只读不删），不再 effect 里 setText', () => {
    expect(q).toMatch(/useState\(\(\) => loadDraft\(key\)\)/);
    expect(q).not.toMatch(/const t = loadDraft\(key\);\s*if \(t\) \{\s*setText\(t\)/);
    expect(q).toMatch(/useDraft\('quick'\)/);
    expect(q).toMatch(/useDraft\('qw'\)/);
  });
});

describe('外壳：窗口 / 托盘 / 崩溃 / 日志（源码核对）', () => {
  const rs = import.meta.glob(['../../src-tauri/src/lib.rs', '../../src-tauri/src/shell.rs', '../../src-tauri/src/shelllogic.rs', '../../src-tauri/src/entry.rs', '../../src-tauri/Cargo.toml', '../../scripts/android/GleanChrome.kt', '../main.tsx', '../lib/entryboot.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const f = (end: string) => Object.entries(rs).find(([k]) => k.endsWith(end))![1];
  it('0741 / 0563：setup 不再直接亮窗口，前端首帧后 main_ready；静默启动后台活再晚 60 秒', () => {
    expect(f('lib.rs')).not.toMatch(/if !std::env::args\(\)\.any\(\|a\| a == "--hidden"\) \{\s*entry::show_main/);
    expect(f('lib.rs')).toMatch(/shell::main_ready,/);
    expect(f('lib.rs')).toMatch(/now_playing, shell::main_ready, shell::crash_take, shell::quiet_now\]/); // v0.45 安卓也注册 quiet_now
    expect(f('main.tsx')).toMatch(/invoke<boolean>\('main_ready'\)/);
    expect(f('main.tsx').match(/void later\(/g)?.length).toBe(4);
    expect(f('main.tsx')).toMatch(/h \? 60000 : 0/);
  });
  it('0746 / 0747 / 0718 / 0565：panic 写 crash.txt 并在下次启动取走；正式版 Warn 日志轮转；release profile；记住窗口', () => {
    expect(f('shell.rs')).toMatch(/std::panic::set_hook/);
    expect(f('entryboot.ts')).toMatch(/invoke<string \| null>\('crash_take'\)/);
    expect(f('lib.rs')).toMatch(/LevelFilter::Warn/);
    expect(f('lib.rs')).toMatch(/RotationStrategy::KeepOne/);
    expect(f('lib.rs')).not.toMatch(/if cfg!\(debug_assertions\) \{\s*app\.handle\(\)\.plugin/);
    expect(f('Cargo.toml')).toMatch(/\[profile\.release\][\s\S]*lto = true[\s\S]*codegen-units = 1/);
    expect(f('Cargo.toml')).toMatch(/tauri-plugin-window-state = "2"/);
    expect(f('lib.rs')).toMatch(/StateFlags::all\(\) & !tauri_plugin_window_state::StateFlags::VISIBLE/);
  });
  it('0561 / 0538 / 0562：第一次关窗口提示、托盘从剪贴板拾 + 暂停提示、热键 / 托盘唤出挪到鼠标所在屏', () => {
    expect(f('lib.rs')).toMatch(/shell::first_close\(/);
    expect(f('lib.rs')).toMatch(/"clip", "从剪贴板拾"/);
    // v0.45：菜单文字只从状态算（shelllogic::pause_label），初始 = 没暂停
    expect(f('lib.rs')).toMatch(/"clippause", shelllogic::pause_label\(false\)/);
    expect(f('shelllogic.rs')).toMatch(/"暂停剪贴板提示 1 小时"/);
    expect(f('entry.rs')).toMatch(/crate::shell::clip_paused\(&app\)/);
    expect(f('entry.rs')).toMatch(/crate::shell::to_cursor_monitor\(app\)/);
    expect(f('lib.rs')).toMatch(/fn show_quick[\s\S]{0,80}shell::to_cursor_monitor\(app\)/);
  });
  it('0567：安卓桥有 secure()，加 / 清 FLAG_SECURE', () => {
    expect(f('GleanChrome.kt')).toMatch(/fun secure\(on: Boolean\)/);
    expect(f('GleanChrome.kt')).toMatch(/FLAG_SECURE/);
  });
});

describe('0567 最近任务隐藏画面的默认值', () => {
  beforeEach(() => localStorage.clear());
  it('没设 = 跟着上锁 PIN；手动开 / 关优先', () => {
    expect(secureOn()).toBe(false);
    localStorage.setItem('glean.lock.v1', '{"h":"x"}');
    expect(secureOn()).toBe(true);
    localStorage.setItem(SECURE_KEY, '0');
    expect(secureOn()).toBe(false);
    localStorage.removeItem('glean.lock.v1');
    localStorage.setItem(SECURE_KEY, '1');
    expect(secureOn()).toBe(true);
  });
});
