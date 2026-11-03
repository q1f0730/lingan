import { describe, expect, it } from 'vitest';
import { applyDisplayEdit, dispToMd, mdToDisp, refLayout, snapCaret } from '../lib/works';

const U1 = '01HZZZZZZZZZZZZZZZZZZZZZZ1';
const U2 = '01HZZZZZZZZZZZZZZZZZZZZZZ2';

describe('v0.30 草稿编辑区隐藏 uid', () => {
  const md = `他站在[[花样年华|${U1}]]的楼梯上，[[梦二|${U2}]]响起。`;
  it('显示文本只留 [[标题]]', () => {
    const L = refLayout(md);
    expect(L.display).toBe('他站在[[花样年华]]的楼梯上，[[梦二]]响起。');
    expect(L.spans.map((s) => s.uid)).toEqual([U1, U2]);
    expect(L.display.slice(L.spans[0].ds, L.spans[0].de)).toBe('[[花样年华]]');
  });
  it('位置互换：引用外一一对应，引用中间就近落到边上', () => {
    const L = refLayout(md);
    const after = L.spans[0].de; // 「的」前
    expect(md.slice(dispToMd(L, after), dispToMd(L, after) + 1)).toBe('的');
    expect(mdToDisp(L, dispToMd(L, after))).toBe(after);
    expect(dispToMd(L, L.spans[0].ds + 1)).toBe(L.spans[0].ms);
    expect(snapCaret(L, L.spans[0].de - 1)).toBe(L.spans[0].de);
    expect(snapCaret(L, 1)).toBe(1);
  });
  it('普通打字：引用 uid 原样保留', () => {
    const L = refLayout(md);
    const next = L.display.replace('响起。', '响起了。');
    const r = applyDisplayEdit(md, next);
    expect(r.md).toBe(md.replace('响起。', '响起了。'));
    expect(refLayout(r.md).display).toBe(next);
  });
  it('退格碰到引用：整块删掉', () => {
    const L = refLayout(md);
    const cut = L.spans[0].de;
    const next = L.display.slice(0, cut - 1) + L.display.slice(cut);
    const r = applyDisplayEdit(md, next);
    expect(r.md).toBe(`他站在的楼梯上，[[梦二|${U2}]]响起。`);
    expect(r.caret).toBe(3);
  });
  it('在引用中间插字：插到引用后面', () => {
    const L = refLayout(md);
    const at = L.spans[1].ds + 3;
    const next = L.display.slice(0, at) + 'X' + L.display.slice(at);
    const r = applyDisplayEdit(md, next);
    expect(r.md).toBe(md.replace(`[[梦二|${U2}]]`, `[[梦二|${U2}]]X`));
    expect(refLayout(r.md).display.slice(r.caret - 1, r.caret)).toBe('X');
  });
  it('粘贴 / 拖进带 uid 的完整引用：进草稿，显示时收起', () => {
    const L = refLayout('a');
    const tok = `[[一一|${U1}]]`;
    const r = applyDisplayEdit('a', L.display + tok);
    expect(r.md).toBe('a' + tok);
    expect(refLayout(r.md).display).toBe('a[[一一]]');
    expect(r.caret).toBe('a[[一一]]'.length);
  });
  it('选中一段（含引用）替换', () => {
    const L = refLayout(md);
    const next = '他站在' + '这里' + L.display.slice(L.spans[0].de + 1);
    const r = applyDisplayEdit(md, next);
    expect(r.md).toBe(`他站在这里楼梯上，[[梦二|${U2}]]响起。`);
  });
  it('同标题两次引用不同穗也不串', () => {
    const m2 = `[[雨|${U1}]] 和 [[雨|${U2}]]`;
    const L = refLayout(m2);
    const r = applyDisplayEdit(m2, L.display.replace(' 和 ', ' 与 '));
    expect(r.md).toBe(`[[雨|${U1}]] 与 [[雨|${U2}]]`);
  });
});
