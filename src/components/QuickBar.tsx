import { m } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconEnter } from './rw/icons';
import { addItem, db, normalizeTags, updateItem } from '../lib/db';
import { itemHasImage } from '../lib/imagestore';
import { enrichItem } from '../lib/enrich';
import { fetchLinkMeta } from '../lib/linkmeta';
import { clipMemory, parseQuick, readClipboard, shouldOffer, type QuickDraft } from '../lib/quick';
import type { Settings } from '../lib/settings';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER, type ItemType } from '../lib/types';

/** Save a quick draft, then fill link metadata + AI enrichment in the background. */
export async function quickAdd(d: QuickDraft, s: Settings, onErr?: (m: string) => void): Promise<number> {
  const id = await addItem(d);
  (async () => {
    if (d.url) {
      try {
        const m = await fetchLinkMeta(d.url);
        const cur = await db.items.get(id);
        if (cur) {
          const titleIsUrl = !cur.title || cur.title === d.url;
          await db.items.update(id, {
            type: cur.type === 'link' ? m.type : cur.type,
            title: titleIsUrl ? m.title || cur.title : cur.title,
            creator: cur.creator || m.siteName || '',
            year: cur.year || m.year || '',
            content: cur.content || m.description || '',
          });
          // 链接封面：原图进 images 表，后台做缩略图
          if (!itemHasImage(cur) && m.imageData) await updateItem(id, { image: m.imageData });
        }
      } catch {
        /* link kept as is */
      }
    }
    const err = await enrichItem(id, s);
    if (err) onErr?.('AI 整理失败：' + err);
  })();
  return id;
}

function splitWhy(raw: string): { why: string; tags: string[] } {
  const tags: string[] = [];
  const why = raw
    .replace(/(^|\s)#([^\s#]{1,24})(?=\s|$)/g, (_, p: string, t: string) => {
      tags.push(t);
      return p;
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { why, tags };
}

/**
 * 加号 ↔ 光标的形变图标：移植 Rewamp「Morph Search Capsule」里放大镜 ↔ 竖光标的 SVG 形变，
 * 这里起点换成「+」（拾一穗），聚焦且没字时横线收起、竖线变成会闪的光标。
 */
function PlusCaret({ caret }: { caret: boolean }) {
  return (
    <svg className="qc-icon" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <m.line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" animate={caret ? { scaleX: 0, opacity: 0 } : { scaleX: 1, opacity: 1 }} style={{ transformOrigin: '12px 12px' }} transition={{ type: 'spring', stiffness: 420, damping: 28 }} />
      <m.line
        x1="12"
        y1="5"
        x2="12"
        y2="19"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        style={{ transformOrigin: '12px 12px' }}
        animate={caret ? { scaleY: 1.1, opacity: [1, 1, 0, 0, 1] } : { scaleY: 1, opacity: 1 }}
        transition={caret ? { opacity: { repeat: Infinity, duration: 1, delay: 0.3, times: [0, 0.45, 0.5, 0.95, 1] }, scaleY: { type: 'spring', stiffness: 380, damping: 26 } } : { duration: 0.15 }}
      />
    </svg>
  );
}

/**
 * 速记「随手拾一穗」（常驻）。Rewamp「Morph Search Capsule」移植：白色胶囊、内沿高光、聚焦时轻轻放大（弹簧），
 * 点下去有一圈涟漪，左边「+」形变成光标。手机浮在底部导航上方；桌面在顶栏左侧，宽 560px。
 * 回车即存，存完「已拾」淡入 1.2s，可顺手补一句为什么。
 */
export function QuickBar({ where }: { where: 'top' | 'dock' }) {
  const { settings, toast, openCapture } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [done, setDone] = useState(0);
  const [focus, setFocus] = useState(false);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function save() {
    const d = parseQuick(text);
    if (!d || busy) return;
    setBusy(true);
    try {
      const id = await quickAdd(d, settings, (m) => toast(m, 'err'));
      setText('');
      setWhy('');
      setLast(id);
      setDone(Date.now());
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(0), 1200);
    return () => clearTimeout(t);
  }, [done]);

  async function saveWhy() {
    if (!last) return;
    const { why: w, tags } = splitWhy(why);
    const cur = await db.items.get(last);
    if (cur) {
      await db.items.update(last, { why: w || cur.why, tags: normalizeTags([...cur.tags, ...tags]), updatedAt: Date.now(), embedding: undefined, embedModel: undefined });
      enrichItem(last, settings);
    }
    toast('已补上');
    setLast(null);
    setWhy('');
  }

  function ripple(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = e.currentTarget.getBoundingClientRect();
    const id = Date.now() + Math.random();
    setRipples((x) => [...x.slice(-2), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    setTimeout(() => setRipples((x) => x.filter((y) => y.id !== id)), 600);
    if (e.target !== inputRef.current) setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div className={`quick quick-${where}${focus ? ' focus' : ''}`}>
      {last && (
        <m.div className="quick-after" initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
          <span className="quick-after-k">已拾 · 补一句？</span>
          <input
            className="quick-why"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                saveWhy();
              }
              if (e.key === 'Escape') setLast(null);
            }}
            placeholder="（可选）为什么打动你？#标签"
            aria-label="补充为什么"
            maxLength={240}
          />
          {why.trim() ? (
            <button className="btn text strong" onClick={saveWhy}>
              补上
            </button>
          ) : null}
          <button className="btn text faint" onClick={() => setLast(null)} aria-label="不补充">
            不补
          </button>
        </m.div>
      )}
      <m.div className="quick-bar" onPointerDown={ripple} animate={{ scale: focus ? 1.015 : 1 }} transition={{ type: 'spring', stiffness: 420, damping: 28 }}>
        {ripples.map((r) => (
          <m.span key={r.id} className="qc-ripple" style={{ left: r.x - 30, top: r.y - 30 }} initial={{ scale: 0, opacity: 0.7 }} animate={{ scale: 2.8, opacity: 0 }} transition={{ duration: 0.55, ease: 'easeOut' }} aria-hidden />
        ))}
        <PlusCaret caret={focus && !text} />
        <input
          className="quick-input"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
          }}
          placeholder={where === 'top' ? '随手拾一穗：一句话、一个链接，回车就存' : '随手拾一穗'}
          aria-label="速记"
          enterKeyHint="done"
          maxLength={4000}
        />
        {done > 0 && !text && (
          <span className="quick-ok" aria-live="polite">
            已拾
          </span>
        )}
        {text.trim() ? (
          <button className="btn quick-go" onClick={save} disabled={busy} aria-label="拾（回车）">
            拾 <IconEnter size={14} />
          </button>
        ) : (
          <button className="btn quick-more" onClick={openCapture} title="展开速记（N）">
            展开
          </button>
        )}
      </m.div>
    </div>
  );
}

/**
 * 全局速记小窗（d20）：托盘「随手拾一穗」或 Ctrl+Shift+L 唤出。大号输入、自动识别类型（可改），回车即存，Esc 收起。
 */
export function QuickWindow({ onClose }: { onClose: () => void }) {
  const { settings, toast } = useApp();
  const [text, setText] = useState('');
  const [type, setType] = useState<ItemType | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const guess = useMemo(() => parseQuick(text), [text]);
  useEffect(() => {
    ref.current?.focus();
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  async function save() {
    const d = parseQuick(text);
    if (!d || busy) return;
    setBusy(true);
    try {
      await quickAdd(type ? { ...d, type } : d, settings, (m) => toast(m, 'err'));
      toast('已拾进穗仓');
      onClose();
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="qw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="quick-window" role="dialog" aria-modal="true" aria-label="随手拾速记">
        <header className="qw-head">
          <span>
            <b>拾穗 · GLEAN</b> <span className="dim">/ 随手拾速记</span>
          </span>
          <button className="btn text faint" onClick={onClose}>
            Esc 收起
          </button>
        </header>
        <div className="qw-input">
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              }
            }}
            placeholder="此刻戳到你的是什么"
            aria-label="速记小窗"
            maxLength={4000}
          />
          <button className="btn primary" onClick={save} disabled={!guess || busy}>
            拾 ↵
          </button>
        </div>
        <div className="qw-types">
          <span className="qw-chips" role="radiogroup" aria-label="类型">
            {TYPE_ORDER.map((t) => (
              <button key={t} role="radio" aria-checked={(type || guess?.type) === t} className={`chip${(type || guess?.type) === t ? ' on' : ''}`} onClick={() => setType(type === t ? null : t)}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </span>
          {guess && !type && <span className="meta-text">自动识别：{TYPE_LABEL[guess.type]}</span>}
        </div>
        <footer className="qw-foot meta-text">Esc 关闭 · Ctrl+Shift+L 在任何程序里唤出</footer>
      </div>
    </div>
  );
}

/** On launch / when the app regains focus: offer to collect new clipboard text in one tap.（m10：速记栏上方的黑条） */
export function ClipOffer() {
  const { settings, toast } = useApp();
  const [clip, setClip] = useState<string | null>(null);
  const checking = useRef(false);

  useEffect(() => {
    async function check() {
      if (checking.current || document.visibilityState === 'hidden') return;
      checking.current = true;
      try {
        const t = (await readClipboard())?.trim();
        if (!t) return;
        const existing = await db.items.toArray();
        if (shouldOffer(t, clipMemory.get(), existing)) setClip(t);
      } finally {
        checking.current = false;
      }
    }
    const t = setTimeout(check, 400);
    const onVis = () => document.visibilityState === 'visible' && check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  if (!clip) return null;
  const preview = clip.length > 60 ? clip.slice(0, 60) + '…' : clip;
  async function take() {
    const t = clip!;
    clipMemory.set(t);
    setClip(null);
    const d = parseQuick(t);
    if (!d) return;
    await quickAdd(d, settings, (m) => toast(m, 'err'));
    toast('已拾进穗仓');
  }
  function skip() {
    clipMemory.set(clip!);
    setClip(null);
  }
  return (
    <div className="clip-offer" role="dialog" aria-label="剪贴板">
      <div className="clip-text">
        <span className="clip-k">剪贴板里有{/^https?:/i.test(clip) ? '一个链接' : '一穗'}</span> {preview}
      </div>
      <div className="clip-actions">
        <button className="btn text clip-take" onClick={take}>
          拾进来
        </button>
        <button className="btn text faint" onClick={skip}>
          忽略
        </button>
      </div>
    </div>
  );
}
