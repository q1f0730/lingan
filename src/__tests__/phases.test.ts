import { describe, expect, it } from 'vitest';
import { contrast, msToNextPhase, PHASE_ORDER, PHASES, phaseAt, phaseCssVars, resolvePhase } from '../lib/phases';

const at = (h: number, m = 0) => new Date(2026, 9, 22, h, m, 0);

describe('一天的四段', () => {
  it('按本地时间分段', () => {
    expect(phaseAt(at(4, 59))).toBe('night');
    expect(phaseAt(at(5, 0))).toBe('dawn');
    expect(phaseAt(at(7, 59))).toBe('dawn');
    expect(phaseAt(at(8, 0))).toBe('day');
    expect(phaseAt(at(16, 59))).toBe('day');
    expect(phaseAt(at(17, 0))).toBe('dusk');
    expect(phaseAt(at(19, 29))).toBe('dusk');
    expect(phaseAt(at(19, 30))).toBe('night');
    expect(phaseAt(at(23, 59))).toBe('night');
  });
  it('设置里固定时优先，auto 跟随时间', () => {
    expect(resolvePhase('dusk', at(10))).toBe('dusk');
    expect(resolvePhase('auto', at(10))).toBe('day');
    expect(resolvePhase(undefined, at(6))).toBe('dawn');
  });
  it('距下一段的毫秒数', () => {
    expect(msToNextPhase(at(7, 0))).toBe(60 * 60000);
    expect(msToNextPhase(at(23, 0))).toBe(6 * 60 * 60000);
    expect(msToNextPhase(at(19, 29))).toBe(60000);
  });
  it('每段的正文、弱文字、强调文字在纸片上都过 WCAG AA（正文过 AAA）', () => {
    for (const p of PHASE_ORDER) {
      const u = PHASES[p].ui;
      expect(contrast(u.ink, u.panelSolid), `${p} ink`).toBeGreaterThanOrEqual(7);
      expect(contrast(u.inkSoft, u.panelSolid), `${p} inkSoft`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.accentInk, u.panelSolid), `${p} accentInk`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.accentInk, u.accentSoft), `${p} accentInk on soft`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.buttonInk, u.buttonBg), `${p} button`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(u.inkSoft, u.paper), `${p} inkSoft on paper`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('夜晚是深色纸，其余是浅色纸', () => {
    expect(PHASES.night.ui.dark).toBe(true);
    for (const p of ['dawn', 'day', 'dusk'] as const) expect(PHASES[p].ui.dark).toBe(false);
  });
  it('麦秆越靠下越深（浅色纸时段）', () => {
    for (const p of ['dawn', 'day', 'dusk'] as const) {
      const s = PHASES[p].ink.stalk;
      for (let i = 1; i < s.length; i++) expect(contrast(s[i], '#ffffff')).toBeGreaterThan(contrast(s[i - 1], '#ffffff'));
    }
  });
  it('CSS 变量齐全（含热力图五档麦金）', () => {
    const v = phaseCssVars('day');
    for (const k of ['--paper', '--ink', '--accent', '--accent-ink', '--panel', '--btn-bg', '--sky-top', '--gold-0', '--gold-4']) expect(v[k]).toBeTruthy();
  });
});
