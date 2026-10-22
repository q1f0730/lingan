// 后台补缩略图：启动后先让首屏画完，再在空闲时分批做；有新图入库时立刻排一轮。
import { db, onNewImage } from './db';
import { browserThumbMaker, healImages, type HealReport } from './imagestore';

declare global {
  interface Window {
    __gleanThumbs?: { running: boolean; runs: number; made: number; failed: number; detached: number; left: number; lastMs: number };
  }
}

const status = { running: false, runs: 0, made: 0, failed: 0, detached: 0, left: -1, lastMs: 0 };
if (typeof window !== 'undefined') window.__gleanThumbs = status;

let again = false;

function idle(): Promise<void> {
  return new Promise((res) => {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => res(), { timeout: 300 });
    else setTimeout(res, 16);
  });
}

export async function runThumbs(): Promise<void> {
  if (status.running) {
    again = true;
    return;
  }
  status.running = true;
  const t0 = performance.now();
  try {
    do {
      again = false;
      const r: HealReport = await healImages(db, browserThumbMaker, {
        batch: 6,
        yieldFn: idle,
      });
      status.made += r.made;
      status.failed += r.failed;
      status.detached += r.detached;
      status.left = r.left;
    } while (again);
  } catch (e) {
    console.warn('[glean] thumbs', e);
  } finally {
    status.runs++;
    status.lastMs = Math.round(performance.now() - t0);
    status.running = false;
  }
}

let started = false;
/** 首屏之后 delay 毫秒开始；之后每次有新图入库都会再跑一轮 */
export function startThumbJob(delay = 1200) {
  if (started) return;
  started = true;
  onNewImage(() => void runThumbs());
  setTimeout(() => void idle().then(runThumbs), delay);
}
