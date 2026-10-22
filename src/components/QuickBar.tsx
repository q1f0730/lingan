import { useEffect, useRef, useState } from 'react';
import { addItem, db, normalizeTags, updateItem } from '../lib/db';
import { itemHasImage } from '../lib/imagestore';
import { enrichItem } from '../lib/enrich';
import { fetchLinkMeta } from '../lib/linkmeta';
import { clipMemory, parseQuick, readClipboard, shouldOffer, type QuickDraft } from '../lib/quick';
import type { Settings } from '../lib/settings';
import { useApp } from '../lib/store';
import { onQuickFocus } from '../lib/desktop';

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

export function QuickBar() {
  const { settings, toast } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let off = () => {};
    let dead = false;
    onQuickFocus(() => inputRef.current?.focus()).then((f) => {
      if (dead) f();
      else off = f;
    });
    return () => {
      dead = true;
      off();
    };
  }, []);

  async function save() {
    const d = parseQuick(text);
    if (!d || busy) return;
    setBusy(true);
    try {
      const id = await quickAdd(d, settings, (m) => toast(m, 'err'));
      setText('');
      setWhy('');
      setLast(id);
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }

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
    <div className="quick paper">
      <div className="quick-bar">
        <span className="quick-ic" aria-hidden>
          ✎
        </span>
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
          placeholder="随手拾一穗：一句话、链接、#标签，回车即存"
          aria-label="速记"
          enterKeyHint="done"
          maxLength={4000}
        />
        {text.trim() && (
          <button className="btn primary small" onClick={save} disabled={busy}>
            存
          </button>
        )}
      </div>
      {last && (
        <div className="quick-after">
          <span className="quick-ok">✓ 已拾进穗仓</span>
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
          {why.trim() && (
            <button className="btn ghost small" onClick={saveWhy}>
              补上
            </button>
          )}
          <button className="icon-btn" onClick={() => setLast(null)} aria-label="不补充">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

/** On launch / when the app regains focus: offer to collect new clipboard text in one tap. */
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
    <div className="clip-offer paper" role="dialog" aria-label="剪贴板">
      <div className="clip-k">剪贴板里有一穗</div>
      <div className="clip-text">{preview}</div>
      <div className="clip-actions">
        <button className="btn ghost small" onClick={skip}>
          忽略
        </button>
        <button className="btn primary small" onClick={take}>
          拾进穗仓
        </button>
      </div>
    </div>
  );
}
