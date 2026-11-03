// v0.23 从别的页跳进穗仓的「待理」/「缺为什么」：sessionStorage 里放一个记号，穗仓打开时取走
const SUB_KEY = 'glean.libsub';
export type LibSub = 'inbox' | 'why';
export function openLibSub(sub: LibSub, go: (v: 'library') => void) {
  try {
    sessionStorage.setItem(SUB_KEY, sub);
  } catch {
    /* ignore */
  }
  go('library');
}
export function takeLibSub(): LibSub | null {
  try {
    const v = sessionStorage.getItem(SUB_KEY);
    sessionStorage.removeItem(SUB_KEY);
    return v === 'inbox' || v === 'why' ? v : null;
  } catch {
    return null;
  }
}
