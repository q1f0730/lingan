// 麦田的心跳：时钟和调度器注入（可脱离浏览器单测）。
// 有东西在动时 ACTIVE 帧率；静下来降到 IDLE；很久没人碰再降到 DEEP；有输入立刻唤醒。暂停时什么都不排。

export interface Rates {
  active: number;
  idle: number;
  deep: number;
}
export const FULL_RATES: Rates = { active: 24, idle: 8, deep: 3 };
export const LITE_RATES: Rates = { active: 14, idle: 5, deep: 2 };
/** 多久没有输入就进入 DEEP（秒） */
export const DEEP_AFTER = 25;

export interface LoopDeps {
  tick: (dtSec: number) => boolean; // 推进并绘制一帧，返回是否还在动
  now: () => number;
  schedule: (cb: () => void, delayMs: number) => number;
  cancel: (id: number) => void;
  rates?: Rates;
}

export interface FieldLoop {
  play: () => void;
  pause: () => void;
  wake: () => void;
  interval: () => number | null;
}

export function intervalFor(r: Rates, active: boolean, quietSec: number): number {
  if (active) return 1000 / r.active;
  return 1000 / (quietSec > DEEP_AFTER ? r.deep : r.idle);
}

export function createLoop(d: LoopDeps): FieldLoop {
  const r = d.rates ?? FULL_RATES;
  let playing = false;
  let id: number | null = null;
  let prev: number | null = null;
  let active = true;
  let lastInput = d.now();
  let dueAt = 0;
  const quiet = () => (d.now() - lastInput) / 1000;
  const plan = (delay: number) => {
    dueAt = d.now() + delay;
    id = d.schedule(frame, Math.max(0, delay));
  };
  function frame() {
    id = null;
    if (!playing) return;
    const now = d.now();
    const dt = prev === null ? 0 : Math.min(now - prev, 250) / 1000;
    prev = now;
    active = d.tick(dt);
    plan(intervalFor(r, active, quiet()) - (d.now() - now));
  }
  return {
    play() {
      if (playing) return;
      playing = true;
      prev = null;
      plan(0);
    },
    pause() {
      playing = false;
      if (id !== null) d.cancel(id);
      id = null;
      prev = null;
    },
    wake() {
      lastInput = d.now();
      if (!playing || active) return;
      active = true;
      const soon = (prev ?? d.now()) + 1000 / r.active;
      if (id !== null && dueAt > soon) {
        d.cancel(id);
        plan(soon - d.now());
      }
    },
    interval: () => (playing ? intervalFor(r, active, quiet()) : null),
  };
}
