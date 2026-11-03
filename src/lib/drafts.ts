// v0.22 采集草稿永不丢（0025）：速记框里打的字 500ms 防抖写进 localStorage；App 被杀 / 崩溃后下次打开自动接着写。
// 存进穗仓或手动清空后删掉草稿；超过 7 天的旧草稿不再恢复。

const PREFIX = 'glean.draft.';
const MAX_AGE = 7 * 86400000;

export interface DraftRec {
  t: string;
  at: number;
}

export function loadDraft(key: string, now = Date.now()): string {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return '';
    const o = JSON.parse(raw) as DraftRec;
    if (!o || typeof o.t !== 'string' || typeof o.at !== 'number' || now - o.at > MAX_AGE) {
      localStorage.removeItem(PREFIX + key);
      return '';
    }
    return o.t;
  } catch {
    return '';
  }
}

export function saveDraft(key: string, text: string, now = Date.now()) {
  try {
    if (!text.trim()) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify({ t: text.slice(0, 4000), at: now } satisfies DraftRec));
  } catch {
    /* 存储满了 / 隐私模式：不影响输入 */
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** 防抖写：返回 [写, 立刻落盘, 取消] */
export function draftWriter(key: string, ms = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: string | null = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (last != null) saveDraft(key, last);
    last = null;
  };
  return {
    write(text: string) {
      last = text;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, ms);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      last = null;
    },
  };
}
