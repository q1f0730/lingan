// v0.16 Studio：只有白、黑两套 token（<html data-theme>）。默认跟随系统，设置里可固定。
export type ThemePref = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';
export const THEME_LABEL: Record<ThemePref, string> = { auto: '跟随系统', light: '白', dark: '黑' };
export const THEME_ORDER: ThemePref[] = ['auto', 'light', 'dark'];

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'light' || pref === 'dark') return pref;
  return systemDark ? 'dark' : 'light';
}

/** 旧设置迁移：v0.10–v0.15 的 phase（清晨/白天/黄昏/夜晚）→ 新主题。固定「夜晚」的人改成黑，其余跟随系统 */
export function themeFromLegacy(s: { theme?: unknown; phase?: unknown }): ThemePref {
  if (s.theme === 'auto' || s.theme === 'light' || s.theme === 'dark') return s.theme;
  if (s.phase === 'night') return 'dark';
  if (s.phase === 'dawn' || s.phase === 'day' || s.phase === 'dusk') return 'light';
  return 'auto';
}
