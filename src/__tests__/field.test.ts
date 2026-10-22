import { describe, expect, it } from 'vitest';
import { createLoop, DEEP_AFTER, FULL_RATES, intervalFor, LITE_RATES } from '../lib/field/loop';
import { createField, fieldPalette, GLYPHS, noInput, renderField, setFieldPhase, SETTLED, stepField, type FieldInput } from '../lib/field/wheat';
import { PHASE_ORDER } from '../lib/phases';

const run = (s: ReturnType<typeof createField>, sec: number, inp: () => FieldInput = noInput) => {
  for (let i = 0; i < Math.round(sec * 24); i++) stepField(s, 1 / 24, inp());
};

describe('麦田模拟', () => {
  it('确定性：同样的输入得到同样的画面', () => {
    const a = createField({ cols: 50, rows: 60, phase: 'day', seed: 3 });
    const b = createField({ cols: 50, rows: 60, phase: 'day', seed: 3 });
    run(a, 2);
    run(b, 2);
    renderField(a);
    renderField(b);
    expect(Array.from(a.chars)).toEqual(Array.from(b.chars));
    expect(Array.from(a.colors)).toEqual(Array.from(b.colors));
  });
  it('画面里有天、有树、有麦穗，字符和颜色都在表内', () => {
    const s = createField({ cols: 60, rows: 70, phase: 'day' });
    renderField(s);
    const text = Array.from(s.chars, (c) => GLYPHS[c]).join('');
    expect(text).toContain('@'); // 树冠 / 麦穗
    expect(text).toMatch(/[|/\\l!]/); // 麦秆
    const pal = fieldPalette('day');
    expect(Math.max(...s.colors)).toBeLessThan(pal.length);
    // 天上（地平线以上、树以外）大部分是空的
    const skyRows = s.layout.horizon - 8;
    let ink = 0;
    for (let i = 0; i < skyRows * s.cols; i++) if (s.chars[i]) ink++;
    expect(ink / (skyRows * s.cols)).toBeLessThan(0.05);
    // 最底下一行几乎铺满
    let foot = 0;
    for (let x = 0; x < s.cols; x++) if (s.chars[(s.rows - 1) * s.cols + x]) foot++;
    expect(foot / s.cols).toBeGreaterThan(0.6);
  });
  it('指针划过：附近的麦子被推开，之后弹回去并安静下来', () => {
    const s = createField({ cols: 60, rows: 70, phase: 'day' });
    run(s, 1);
    const y = s.rows - 10;
    const i = y * s.cols + 33;
    const rest = s.bend[i];
    // 指针停在第 30 列：右边的麦子应被推向右（正）
    run(s, 0.25, () => ({ pointer: { x: 30, y, vx: 0, vy: 0 }, bursts: [], breeze: 0 }));
    expect(s.bend[i]).toBeGreaterThan(rest + 0.2);
    expect(s.active).toBe(true);
    run(s, 4);
    expect(Math.abs(s.bend[i] - s.target[i])).toBeLessThan(0.1);
    expect(s.deviation).toBeLessThan(SETTLED * 2);
  });
  it('快速横扫会起一阵风，风会滚过麦田', () => {
    const s = createField({ cols: 80, rows: 70, phase: 'day' });
    run(s, 0.5);
    stepField(s, 1 / 24, { pointer: { x: 10, y: s.rows - 8, vx: 90, vy: 0 }, bursts: [], breeze: 0 });
    expect(s.gusts.length).toBe(1);
    const x0 = s.gusts[0].x;
    run(s, 0.5);
    expect(s.gusts[0].x).toBeGreaterThan(x0 + 5);
    run(s, 3);
    expect(s.gusts.length).toBe(0);
  });
  it('点空地会飞起种子，种子会落下消失', () => {
    const s = createField({ cols: 60, rows: 70, phase: 'day' });
    stepField(s, 1 / 24, { pointer: null, bursts: [{ x: 20, y: s.rows - 15 }], breeze: 0 });
    const alive = () => Array.from(s.mkind).filter((k) => k === 1 || k === 2).length;
    expect(alive()).toBeGreaterThanOrEqual(9);
    run(s, 12);
    expect(alive()).toBeLessThan(4);
  });
  it('夜晚有萤火，换回白天萤火消失', () => {
    const s = createField({ cols: 60, rows: 70, phase: 'night' });
    expect(Array.from(s.mkind).filter((k) => k === 3).length).toBeGreaterThan(5);
    setFieldPhase(s, 'day');
    expect(Array.from(s.mkind).filter((k) => k === 3).length).toBe(0);
  });
  it('没人碰时会安静下来（允许降帧）', () => {
    const s = createField({ cols: 60, rows: 70, phase: 'day' });
    run(s, 3);
    expect(s.deviation).toBeLessThan(SETTLED);
  });
  it('四段都有完整调色板', () => {
    for (const p of PHASE_ORDER) expect(fieldPalette(p).length).toBe(20);
  });
});

describe('麦田心跳', () => {
  it('动时高帧率、静下来降帧、很久没人碰再降', () => {
    expect(intervalFor(FULL_RATES, true, 0)).toBeCloseTo(1000 / 24);
    expect(intervalFor(FULL_RATES, false, 1)).toBeCloseTo(1000 / 8);
    expect(intervalFor(FULL_RATES, false, DEEP_AFTER + 1)).toBeCloseTo(1000 / 3);
    expect(intervalFor(LITE_RATES, true, 0)).toBeGreaterThan(intervalFor(FULL_RATES, true, 0));
  });
  it('暂停后不再排任何帧；唤醒切回高帧率', () => {
    let now = 0;
    const q: Array<{ cb: () => void; at: number; id: number }> = [];
    let nid = 1;
    let moving = false;
    let ticks = 0;
    const loop = createLoop({
      now: () => now,
      schedule: (cb, ms) => {
        const id = nid++;
        q.push({ cb, at: now + ms, id });
        return id;
      },
      cancel: (id) => {
        const k = q.findIndex((e) => e.id === id);
        if (k >= 0) q.splice(k, 1);
      },
      tick: () => {
        ticks++;
        return moving;
      },
    });
    const advance = (ms: number) => {
      const end = now + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        const e = q[0];
        if (!e || e.at > end) break;
        q.shift();
        now = e.at;
        e.cb();
      }
      now = end;
    };
    loop.play();
    advance(1000);
    expect(loop.interval()).toBeCloseTo(125); // 静止：8fps
    const idleTicks = ticks;
    expect(idleTicks).toBeLessThan(12);
    moving = true;
    loop.wake();
    advance(1000);
    expect(ticks - idleTicks).toBeGreaterThan(18);
    loop.pause();
    expect(loop.interval()).toBeNull();
    const t0 = ticks;
    advance(2000);
    expect(ticks).toBe(t0);
    expect(q.length).toBe(0);
  });
});
