// 收集诊断信息（读库条数、设置状态、钥匙串 / 存储状态），数据库打不开也能出结果
import { buildDiagnostics } from './diagnostics';
import { aiReady, loadSettings, PRESETS, vaultKind } from './settings';
import { VAULT_LABEL } from './vault';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export async function collectDiagnostics(): Promise<string> {
  const s = loadSettings();
  const counts = await withTimeout(
    (async () => {
      const { db } = await import('./db');
      const { liveCounts } = await import('./db');
      const c = await liveCounts(db);
      return { items: c.items, devs: c.devs, imgs: c.imgs, cliches: await db.cliches.count(), trash: c.trash };
    })(),
    2500,
  );
  const persisted = await withTimeout(navigator.storage?.persisted ? navigator.storage.persisted() : Promise.resolve(null), 1000);
  const vk = vaultKind();
  return buildDiagnostics({
    version: __APP_VERSION__,
    ua: navigator.userAgent,
    counts,
    vault: vk ? VAULT_LABEL[vk] : null,
    persisted: persisted as boolean | null,
    aiPreset: PRESETS.find((p) => p.id === s.preset)?.name || s.preset,
    aiReady: aiReady(s),
    online: navigator.onLine !== false,
    secrets: [s.chat.apiKey, s.embed.apiKey].filter(Boolean),
  });
}
