// v0.26 0624 / 0513：Dexie 升级前先存一份原始库。
// 平常启动零成本：localStorage 记着上次成功打开时的库版本，和代码里的一样就直接返回（不碰 IndexedDB）。
// 不一样（刚装了新版、或第一次装 v0.26）才用 indexedDB.databases() 看现有库的版本；比代码旧 = 马上要迁移，
// 先把旧库原样读出存进快照库（snapshots.ts 只在这时才加载），再让 Dexie 打开。
export const SCHEMA_KEY = 'glean.schema.v1';

export function schemaSeen(): number {
  try {
    return Number(localStorage.getItem(SCHEMA_KEY)) || 0;
  } catch {
    return 0;
  }
}
export function markSchema(verno: number) {
  try {
    localStorage.setItem(SCHEMA_KEY, String(Math.round(verno)));
  } catch {
    /* ignore */
  }
}

/** 需要先存副本时返回旧库的 IndexedDB 版本号，否则 0 */
export async function needsPreUpgradeDump(name: string, verno: number, seen = schemaSeen()): Promise<number> {
  if (seen === Math.round(verno)) return 0;
  const list = await (indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string; version?: number }>> }).databases?.().catch(() => []);
  const cur = (list || []).find((x) => x.name === name)?.version || 0;
  // Dexie 的 IndexedDB 版本 = version × 10
  return cur > 0 && cur < Math.round(verno * 10) ? cur : 0;
}

export async function guardUpgrade(name: string, verno: number, appVersion: string): Promise<void> {
  try {
    const from = await needsPreUpgradeDump(name, verno);
    if (!from) return;
    const { dumpBeforeUpgrade } = await import('./snapshots');
    const id = await dumpBeforeUpgrade(name, from, Math.round(verno), { appVersion });
    (window as unknown as { __gleanPreUpgrade?: unknown }).__gleanPreUpgrade = { from: Math.round(from / 10), to: Math.round(verno), id };
  } catch (e) {
    // 存副本失败不能拦着打开（打不开更糟）；记一笔
    console.warn('[glean] pre-upgrade dump failed', e);
    (window as unknown as { __gleanPreUpgrade?: unknown }).__gleanPreUpgrade = { error: String((e as Error)?.message || e) };
  }
}
