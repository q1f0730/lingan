import { useEffect, useMemo, useRef, useState } from 'react';
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
 * 速记「随手拾一穗」（常驻）。手机：底部导航上方整宽，上方 1px 黑线，右侧黑字「拾」；
 * 桌面：顶栏右侧 320px，只有一条下划线。回车即存，存完淡入「已拾」1.2s，可顺手补一句为什么。
 */
export function QuickBar({ where }: { where: 'top' | 'dock' }) {
  const { settings, toast, openCapture } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [done, setDone] = useState(0);
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

  return (
    <div className={`quick quick-${where}`}>
      {last && (
        <div className="quick-after">
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
        </div>
      )}
      <div className="quick-bar">
        <input
          className="quick-input"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
          }}
          placeholder={where === 'top' ? '随手拾一穗 →' : '随手拾一穗'}
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
          <button className="btn text strong quick-go" onClick={save} disabled={busy}>
            拾
          </button>
        ) : (
          <button className="btn text faint quick-more" onClick={openCapture} title="展开速记（N）">
            展开
          </button>
        )}
      </div>
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
