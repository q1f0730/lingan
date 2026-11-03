import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { applyTag, existingTags, loadTagCounts, suggestTags, tagQueryAt, type TagQuery } from '../lib/tagsuggest';

type El = HTMLInputElement | HTMLTextAreaElement;

/**
 * v0.27 0413：在输入框下面给一排标签候选。↑↓ 选、Tab / 回车填、Esc 收；点一下也行（不抢焦点）。
 * 用法：const ts = useTagSuggest(text, setText, ref)；onKeyDown 里先 `if (ts.onKey(e)) return;`，再把 ts.box 放在输入框后面。
 */
export function useTagSuggest(text: string, setText: (t: string) => void, ref: RefObject<El | null>, opts: { bare?: boolean; className?: string } = {}) {
  const [qr, setQr] = useState<TagQuery | null>(null);
  const [list, setList] = useState<string[]>([]);
  const [act, setAct] = useState(0);
  // 回车只在用户用 ↑↓ 挑过候选之后才填；否则回车照常（存穗），免得打完 #雨 回车被换成「雨夜」
  const [nav, setNav] = useState(false);
  const [shut, setShut] = useState<string | null>(null);
  const bare = !!opts.bare;
  const seq = useRef(0);

  useEffect(() => {
    const el = ref.current;
    const focused = !!el && document.activeElement === el;
    const q = focused ? tagQueryAt(text, el!.selectionStart ?? text.length, bare) : null;
    if (!q || shut === text) {
      setQr(null);
      setList([]);
      return;
    }
    const my = ++seq.current;
    void loadTagCounts().then((counts) => {
      if (my !== seq.current) return;
      const l = suggestTags(q.q, counts, existingTags(text, bare), 6);
      setQr(q);
      setList(l);
      setAct(0);
      setNav(false);
    });
  }, [text, bare, ref, shut]);

  // 失焦就收（点候选用 onMouseDown 抢在失焦前）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const off = () => setTimeout(() => setList([]), 120);
    el.addEventListener('blur', off);
    return () => el.removeEventListener('blur', off);
  }, [ref]);

  const pick = (tag: string) => {
    if (!qr) return;
    const r = applyTag(text, qr, tag);
    setText(r.text);
    setList([]);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      try {
        el.setSelectionRange(r.caret, r.caret);
      } catch {
        /* type=search 等不支持 */
      }
    });
  };

  const open = list.length > 0 && !!qr;
  const onKey = (e: KeyboardEvent<El>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setAct((a) => (nav ? (a + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length : e.key === 'ArrowDown' ? 0 : list.length - 1));
      setNav(true);
      return true;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && nav)) {
      e.preventDefault();
      pick(list[act]);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setShut(text);
      setList([]);
      return true;
    }
    return false;
  };

  const box = open ? (
    <div className={`tag-suggest${opts.className ? ' ' + opts.className : ''}`} role="listbox" aria-label="标签候选">
      {list.map((t, i) => (
        <button
          key={t}
          type="button"
          role="option"
          aria-selected={i === act && nav}
          className={`tag-suggest-opt${i === act && nav ? ' on' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            pick(t);
          }}
        >
          #{t}
        </button>
      ))}
      <span className="tag-suggest-hint meta-text" aria-hidden>
        Tab 填第一个 · ↑↓ 挑
      </span>
    </div>
  ) : null;

  return { open, onKey, box, list };
}
