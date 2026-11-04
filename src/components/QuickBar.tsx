import { m } from './rw/lite';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconEnter } from './rw/icons';
import { addItem, db, normalizeTags, updateItem } from '../lib/db';
import { amendItem, fillItem } from '../lib/repo';
import { itemHasImage } from '../lib/imagestore';
import { enrichItem } from '../lib/enrich';
import { fetchLinkMeta, snapOn } from '../lib/linkmeta';
import { clipMemory, nextType, parseQuick, readClipboard, shouldOffer, type QuickDraft } from '../lib/quick';
import type { Settings } from '../lib/settings';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER, type Item, type ItemType } from '../lib/types';
import { clearDraft, draftWriter, loadDraft } from '../lib/drafts';
import { NowPlayingButton } from './NowPlaying';
import { notifyDupe, savedMsg } from '../lib/dupnotice';
import { useTagSuggest } from './TagSuggest';
import { compressImage } from '../lib/image';
import { isTauriEnv } from '../lib/desktop';


/** v0.22 速记草稿：输入防抖写本地，App 被杀后下次打开接着写；存了或清空就删。
 * v0.44：草稿在首次渲染里读（useState 初始化，只读不删），不再先画一帧空输入框再 effect 补上（同 v0.43 CaptureForm）。 */
function useDraft(key: string): [string, React.Dispatch<React.SetStateAction<string>>, boolean, () => void] {
  const [text, setText] = useState(() => loadDraft(key));
  const [restored, setRestored] = useState(() => !!text);
  const w = useMemo(() => draftWriter(key), [key]);
  useEffect(() => () => w.flush(), [w]);
  useEffect(() => {
    w.write(text);
  }, [text, w]);
  useEffect(() => {
    const f = () => w.flush();
    window.addEventListener('pagehide', f);
    document.addEventListener('visibilitychange', f);
    return () => {
      window.removeEventListener('pagehide', f);
      document.removeEventListener('visibilitychange', f);
    };
  }, [w]);
  const done = useCallback(() => {
    w.cancel();
    clearDraft(key);
    setRestored(false);
  }, [key, w]);
  return [text, setText, restored, done];
}

const isPending = (e: unknown) => (e as { name?: string } | null)?.name === 'PendingWriteError';

/** v0.34 0900 文字里带 glean://capture?…&from= 的递穗链接 → 交给深链接路由；返回 true = 已处理 */
function handOff(t: string): boolean {
  const m = /glean:\/\/capture\?\S*from=\S+/i.exec(t);
  if (m) window.dispatchEvent(new CustomEvent('glean:link', { detail: m[0] }));
  return !!m;
}

/** Save a quick draft, then fill link metadata + AI enrichment in the background. */
export async function quickAdd(d: QuickDraft, s: Settings, onErr?: (m: string) => void): Promise<number> {
  // v0.23 速记 / 剪贴板 / 速记小窗收进来的先进待理
  const id = await addItem(d, db, { inbox: true });
  afterAdd(id, d, s, onErr);
  return id;
}

/** 新穗入库后的后台活：链接补标题封面、AI 整理（极速拾收件箱、正在播放也走这里） */
export function afterAdd(id: number, d: QuickDraft, s: Settings, onErr?: (m: string) => void) {
  void (async () => {
    if (d.url) {
      try {
        const m = await fetchLinkMeta(d.url, { snap: snapOn() });
        const cur = await db.items.get(id);
        if (cur) {
          const titleIsUrl = !cur.title || cur.title === d.url;
          await fillItem(id, {
            type: cur.type === 'link' ? m.type : cur.type,
            title: titleIsUrl ? m.title || cur.title : cur.title,
            // v0.35 0012 短链换成展开后的真实地址
            ...(m.url !== d.url && cur.url === d.url ? { url: m.url } : {}),
            creator: cur.creator || m.creator || m.siteName || '',
            year: cur.year || m.year || '',
            content: cur.content || m.description || '',
            // v0.39 0017 正文快照（同一份网页里抽，不多发请求）
            ...(m.snap && !cur.snap ? { snap: m.snap, snapAt: Date.now() } : {}),
            ...(cur.metaTodo ? { metaTodo: undefined } : {}),
          });
          // 链接封面：原图进 images 表，后台做缩略图
          if (!itemHasImage(cur) && m.imageData) await updateItem(id, { image: m.imageData });
        }
      } catch (e) {
        // v0.39 0054 没读到（断网 / 超时）：打「待补」，联网后自动再试；网页本身说不行的（404、删了）就不再试
        if (!/网页返回 4|已被删除|无法查看/.test(e instanceof Error ? e.message : '')) await import('../lib/linkretry').then((m) => m.markMetaTodo(id));
      }
    }
    // v0.36 0020 桌面版：图里的字交给系统 OCR（懒加载），进秒搜
    if (d.image && isTauriEnv() && !('LinganShare' in window)) void import('../lib/ocr').then((m) => m.ocrAfterAdd(id, onErr));
    const err = await enrichItem(id, s);
    if (err) onErr?.('AI 整理失败：' + err);
  })();
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
  const [text, setText, restored, dropDraft] = useDraft('quick');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<number | null>(null);
  const [why, setWhy] = useState('');
  const [done, setDone] = useState(0);
  const [focus, setFocus] = useState(false);
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const whyRef = useRef<HTMLInputElement>(null);
  const [typeOv, setTypeOv] = useState<ItemType | null>(null);
  const guess = useMemo(() => (text.trim() ? parseQuick(text) : null), [text]);
  useEffect(() => {
    if (!text.trim()) setTypeOv(null);
  }, [text]);
  const ts = useTagSuggest(text, setText, inputRef, { className: 'tag-suggest-quick' });
  const tsWhy = useTagSuggest(why, setWhy, whyRef, { className: 'tag-suggest-quick' });
  // v0.36「说一句就收」：安卓按住说话松手成穗（系统语音识别），Windows 点一下 Win+H 听写（lib/voice.ts 懒加载）
  const [talk, setTalk] = useState(false);
  const voiceOK = useMemo(() => 'LinganVoice' in window || (isTauriEnv() && !('LinganShare' in window)), []);
  const voice = (down: boolean) => {
    setTalk(down);
    void import('../lib/voice').then((v) => {
      if (!down) return v.letGo();
      return v.hold(inputRef.current, async (t) => {
        const d = parseQuick(t);
        if (!d) return;
        const id = await quickAdd(d, settings, (m) => toast(m, 'err'));
        setLast(id);
        setDone(Date.now());
      }, (m) => toast(m, 'err'));
    });
  };

  async function save() {
    // v0.34 0900：粘进来的是别人「递一穗」的整段话，按 glean:// 链接收（进 待理 · 递来的）
    if (handOff(text)) {
      dropDraft();
      setText('');
      return;
    }
    const d0 = parseQuick(text);
    if (!d0 || busy) return;
    const d = typeOv ? { ...d0, type: typeOv } : d0;
    setBusy(true);
    try {
      const id = await quickAdd(d, settings, (m) => toast(m, 'err'));
      void notifyDupe(id, toast);
      dropDraft();
      setText('');
      setWhy('');
      setLast(id);
      setDone(Date.now());
    } catch (e) {
      // v0.26 0605：写不进库但已暂存 = 算收下了（清掉输入，免得再按一次存成两份）
      if (isPending(e)) {
        dropDraft();
        setText('');
        setWhy('');
        toast((e as Error).message, 'err');
      } else toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
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
      await amendItem(last, { why: w || cur.why, tags: normalizeTags([...cur.tags, ...tags]) });
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
            ref={whyRef}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onKeyDown={(e) => {
              if (tsWhy.onKey(e)) return;
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
          {tsWhy.box}
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
      {restored && text && !last && (
        <div className="quick-draft" role="status">
          <span className="quick-after-k">接着写 · 上次没存的草稿</span>
          <button
            className="btn text faint quick-draft-clear"
            onClick={() => {
              dropDraft();
              setText('');
            }}
          >
            清掉
          </button>
        </div>
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
            if (ts.onKey(e)) return;
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
        {guess && (
          <button
            type="button"
            className={`quick-type${typeOv ? ' set' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTypeOv(nextType(typeOv || guess.type))}
            aria-label={`类型：${TYPE_LABEL[typeOv || guess.type]}${typeOv ? '' : '（自动识别）'}，点一下换`}
            title="点一下换类型"
          >
            {TYPE_LABEL[typeOv || guess.type]}
          </button>
        )}
        {text.trim() ? (
          <button className="btn quick-go" onClick={save} disabled={busy} aria-label="拾（回车）">
            拾 <IconEnter size={14} />
          </button>
        ) : (
          <>
            {voiceOK && (
              <button
                className={`btn quick-more quick-mic${talk ? ' on' : ''}`}
                aria-label="按住说话，松手成一穗"
                onPointerDown={(e) => (e.preventDefault(), voice(true))}
                onPointerUp={() => voice(false)}
                onPointerCancel={() => talk && voice(false)}
                onContextMenu={(e) => e.preventDefault()}
              >
                {talk ? '松手' : '说'}
              </button>
            )}
            <button className="btn quick-more" onClick={openCapture} title="展开速记（N）">
              展开
            </button>
          </>
        )}
      </m.div>
      {ts.box}
    </div>
  );
}

/**
 * 全局速记小窗（d20）：托盘「随手拾一穗」或 Ctrl+Shift+L 唤出。大号输入、自动识别类型（可改），回车即存，Esc 收起。
 */
// v0.41 0138 小窗里 ? 开头秒搜：懒加载
const QuickFind = lazy(() => import('./QuickFind'));
export function QuickWindow({ onClose, initial = '' }: { onClose: () => void; initial?: string }) {
  const { settings, toast, openItem } = useApp();
  const [text, setText, , dropDraft] = useDraft('qw');
  const [type, setType] = useState<ItemType | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const finding = /^[?？]/.test(text);
  const guess = useMemo(() => (finding ? null : parseQuick(text)), [text, finding]);
  const [found, setFound] = useState<Item[]>([]);
  const [fsel, setFsel] = useState(0);
  const onFound = useCallback((h: Item[]) => (setFound(h), setFsel(0)), []);
  const pickFound = (it: Item | undefined) => {
    if (!it) return;
    dropDraft();
    onClose();
    openItem(it, found.map((x) => x.id!));
  };
  const ts = useTagSuggest(text, setText, ref);
  // v0.27 0405：粘贴 / 拖进来的图片先放在小窗里预览，回车连同文字一起存成图片穗
  const [img, setImg] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // v0.33 0004 热键唤出时带上选中的文字；0003 剪贴板里有图 → 给一张缩略图「拾这张图」
  const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    // v0.36 0005 截图热键：payload 以 \u0001shot 开头 = 刚框选的截图，直接带上
    const shot = initial.startsWith('\u0001shot');
    if (initial && !shot) setText(initial.replace(/\s+/g, ' ').slice(0, 4000));
    if (isTauriEnv())
      void import('../lib/entry')
        .then((m) => m.clipImageOffer())
        .then((c) => (shot && c ? void takeImage(c.file) : setClip(c)), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function takeImage(f: File) {
    try {
      setImg(await compressImage(f));
    } catch {
      toast('这张图读不出来', 'err');
    }
  }
  async function onDropQw(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    // 拖放结束后 DataTransfer 就读不到了：先同步拍一份，再懒加载处理代码
    const src = e.dataTransfer;
    const snap = { files: Array.from(src?.files || []), uri: src?.getData('text/uri-list') || '', text: src?.getData('text/plain') || '' };
    const dt = { files: snap.files, getData: (k: string) => (k === 'text/uri-list' ? snap.uri : k === 'text/plain' ? snap.text : '') } as unknown as DataTransfer;
    const [{ readTransfer }, { takeTransfer }] = await Promise.all([import('../lib/dropin'), import('./DropIn')]);
    const { t, files } = readTransfer(dt);
    const firstImg = files.find((f) => f.type.startsWith('image/'));
    if (firstImg && files.length === 1) return void takeImage(firstImg);
    if (!t.files.length && (t.text || t.uris.length)) {
      setText((x) => (x ? x + ' ' : '') + (t.uris[0] || t.text).trim());
      return;
    }
    const r = await takeTransfer(dt, (d) => quickAdd(d, settings, (m) => toast(m, 'err')), text);
    if (r) {
      toast(r.msg, r.ids.length ? 'ok' : 'err');
      if (r.ids.length) {
        dropDraft();
        onClose();
      }
    }
  }
  useEffect(() => {
    ref.current?.focus();
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  async function save() {
    const base = parseQuick(text);
    const d: QuickDraft | null = img ? { type: 'image', title: (base?.title || '粘贴的图片').slice(0, 60), image: img, content: '', creator: '', year: '', url: base?.url || '', why: '', tags: base?.tags || [] } : base;
    if (!d || busy) return;
    setBusy(true);
    try {
      const id = await quickAdd(type && !img ? { ...d, type } : d, settings, (m) => toast(m, 'err'));
      dropDraft();
      setImg(null);
      toast(savedMsg());
      void notifyDupe(id, toast);
      onClose();
    } catch (e) {
      if (isPending(e)) {
        dropDraft();
        toast((e as Error).message, 'err');
        onClose();
      } else toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="qw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`quick-window${over ? ' drag-over' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="随手拾速记"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => void onDropQw(e)}
      >
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
              if (finding) {
                if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && found.length) {
                  e.preventDefault();
                  setFsel((i) => (i + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length);
                }
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  pickFound(found[fsel]);
                }
                return;
              }
              if (ts.onKey(e)) return;
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                save();
              }
            }}
            onPaste={(e) => {
              const f = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith('image/'));
              if (f) {
                e.preventDefault();
                void takeImage(f);
              }
            }}
            placeholder={img ? '给这张图说一句（可选），回车存' : '此刻戳到你的是什么 · 可以直接粘贴图片 · ? 开头是搜'}
            aria-label="速记小窗"
            maxLength={4000}
          />
          {finding ? (
            <button className="btn primary qw-find" onClick={() => pickFound(found[fsel])} disabled={!found.length}>
              打开 ↵
            </button>
          ) : (
            <button className="btn primary" onClick={save} disabled={(!guess && !img) || busy}>
              拾 ↵
            </button>
          )}
        </div>
        {finding ? (
          <Suspense fallback={null}>
            <QuickFind q={text.slice(1)} sel={fsel} onHits={onFound} onPick={pickFound} />
          </Suspense>
        ) : (
          ts.box
        )}
        {clip && !img && (
          <div className="qw-img">
            <img src={clip.url} alt="剪贴板里的图" />
            <button className="btn text qw-clip" onClick={() => void takeImage(clip.file)}>
              拾这张图
            </button>
          </div>
        )}
        {img && (
          <div className="qw-img">
            <img src={img} alt="要拾的图片" />
            <span className="meta-text">回车存成图片穗</span>
            <button className="btn text faint qw-img-drop" onClick={() => setImg(null)}>
              不要这张
            </button>
          </div>
        )}
        <div className="qw-types">
          <span className="qw-chips" role="radiogroup" aria-label="类型">
            {TYPE_ORDER.map((t) => (
              <button key={t} role="radio" aria-checked={(type || guess?.type) === t} className={`chip${(type || guess?.type) === t ? ' on' : ''}`} onClick={() => setType(type === t ? null : t)}>
                {TYPE_LABEL[t]}
              </button>
            ))}
          </span>
          {guess && !type && <span className="meta-text">自动识别：{TYPE_LABEL[guess.type]}</span>}
          <NowPlayingButton onDone={onClose} />
        </div>
        <footer className="qw-foot meta-text">Esc 关闭 · 可粘贴图片、拖文件进来 · Ctrl+Shift+L 在任何程序里唤出 · 托盘菜单「拾正在播放的歌」一键收歌</footer>
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
        // v0.33 0018：密码管理器标了「别记录」的不提示
        if (isTauriEnv() && (await import('../lib/entry').then((m) => m.clipPrivate()))) return;
        const existing = (await db.items.toArray()).filter((x) => !x.deletedAt);
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
    if (handOff(t)) return;
    const d = parseQuick(t);
    if (!d) return;
    const id = await quickAdd(d, settings, (m) => toast(m, 'err'));
    toast(savedMsg());
    void notifyDupe(id, toast);
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
