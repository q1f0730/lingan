import { db } from './db';

// v0.28 从 views/Onboarding 拆出来：引导页本身懒加载（老用户冷启动不下载它）
export const ONBOARD_KEY = 'glean.onboarded';

/** 只有第一次打开、穗仓还是空的时候才走引导；老用户升级、已有穗的直接进穗仓 */
export async function needsOnboarding(): Promise<boolean> {
  try {
    if (localStorage.getItem(ONBOARD_KEY)) return false;
    const n = await db.items.count(); // 回收站里的也算「用过」
    if (n > 0 || localStorage.getItem('lingan.settings.v1')) {
      localStorage.setItem(ONBOARD_KEY, '1');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

