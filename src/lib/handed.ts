// v0.34 0900「别人递来的」：别人用拾穗「递一穗」发来的 glean://capture?…&from=名字 链接不直接进穗仓，先放这里（只存本机，不同步、不算口味、不进嫁接）。
// 「也拾一穗」= 复制进穗仓并要求写一句自己的为什么；「不要」= 丢掉。
export interface Handed {
  id: string;
  from: string;
  title: string;
  text: string;
  url: string;
  tags: string[];
  at: number;
}
const KEY = 'glean.handed.v1';
const MAX = 100;

export function readHanded(): Handed[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string') : [];
  } catch {
    return [];
  }
}
function write(list: Handed[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('glean:handed'));
}
export function addHanded(h: Omit<Handed, 'id' | 'at'>, now = Date.now()): Handed {
  const list = readHanded();
  // 同一个人递来同一穗（同标题 + 同链接）只留一份
  const same = list.find((x) => x.from === h.from && x.title === h.title && x.url === h.url && x.text === h.text);
  if (same) return same;
  const row = { ...h, id: now.toString(36) + Math.random().toString(36).slice(2, 6), at: now };
  write([...list, row]);
  return row;
}
export function dropHanded(id: string): void {
  write(readHanded().filter((x) => x.id !== id));
}
