// v0.34 分享出去：一穗 / 一根新枝（懒加载，App 收到 glean:share 事件才拉这个块）。
// 0899 逐项勾选（默认只带标题和正文），预览 = 实际发出去的字；0909 发出去前扫个人信息；0916 新枝溯源穗三档；
// 0900 「递一穗」链接（对方装了拾穗就进他的 待理 · 递来的）；ROADMAP 新枝明信片（1080 宽 PNG）。
import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/db';
import { deliverFile, androidFiles } from '../lib/files';
import { sourceIds } from '../lib/provenance';
import { branchShareText, DEFAULT_FIELDS, FIELD_LABEL, FIELD_ORDER, handLink, itemShareText, maskHit, readSharePrefs, scanPersonal, SPRIG_LABEL, type ShareField, type SprigMode } from '../lib/sharekit';
import { useApp } from '../lib/store';
import type { Development, Item } from '../lib/types';
import { copyText } from './ErrorBoundary';
import { Sheet } from './Sheet';
import '../styles/share.css';

export type ShareReq = { item: number } | { dev: number };

export default function SharePanel({ req, onClose }: { req: ShareReq; onClose: () => void }) {
  const { toast, confirm } = useApp();
  const prefs = useMemo(() => readSharePrefs(), []);
  const [it, setIt] = useState<Item | null>(null);
  const [dev, setDev] = useState<Development | null>(null);
  const [src, setSrc] = useState<Item[]>([]);
  const [fields, setFields] = useState<ShareField[]>(DEFAULT_FIELDS);
  const [mode, setMode] = useState<SprigMode>('plain');
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    void (async () => {
      if ('item' in req) {
        const row = await db.items.get(req.item);
        if (!dead) setIt(row && !row.deletedAt ? row : null);
      } else {
        const d = await db.developments.get(req.dev);
        if (!d || dead) return;
        const rows = (await db.items.bulkGet(sourceIds(d, d.idea))).filter((x): x is Item => !!x && !x.deletedAt);
        if (dead) return;
        setDev(d);
        setSrc(rows);
      }
    })();
    return () => {
      dead = true;
    };
  }, [req]);
  useEffect(() => () => void (card && URL.revokeObjectURL(card.url)), [card]);

  const text = it ? itemShareText(it, fields) : dev ? branchShareText(dev.idea, src, mode, prefs.name) : '';
  const isPrivate = !!it?.private;

  /** 0909：发出去前本地扫一遍；私密穗再确认一次。返回 true = 可以发 */
  async function guard(extra = ''): Promise<boolean> {
    const hits = scanPersonal(text + '\n' + extra, prefs.words);
    if (isPrivate && !(await confirm({ title: '这是一穗私密的', body: '它不会发给云端模型，平时也只在你自己的设备上。确定要分享出去？', ok: '仍然分享', cancel: '不分享' }))) return false;
    if (!hits.length) return true;
    return confirm({ title: '这段字里像有个人信息', body: hits.map((h) => `${h.kind}：${maskHit(h)}`).join('\n') + '\n\n分享出去就收不回来了。', ok: '仍然分享', cancel: '回去改', danger: true });
  }
  async function copy(withLink: boolean) {
    if (!text.trim()) return toast('一项都没勾', 'err');
    const link = withLink && it ? handLink(it, fields, prefs.name) : '';
    if (!(await guard(link))) return;
    const ok = await copyText(link ? `${text}\n\n—— ${prefs.name} 用拾穗递来一穗，装了拾穗的点开或粘进速记条：\n${link}` : text);
    toast(ok ? (link ? '已复制，发给对方就行' : '已复制') : '复制失败', ok ? 'ok' : 'err');
  }
  async function makeCard() {
    if (!dev || busy) return;
    if (!(await guard())) return;
    setBusy(true);
    try {
      const { renderPostcard } = await import('../lib/postcard');
      const blob = await renderPostcard({ title: dev.idea.title, body: dev.idea.idea, form: dev.idea.form, sprigs: src.map((s) => ({ item: s, thumb: s.thumb })), mode, name: prefs.name, date: dev.createdAt });
      setCard({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      toast('明信片没画出来：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }
  async function deliver(target: 'share' | 'downloads' | 'save') {
    if (!card || !dev) return;
    try {
      const name = `新枝-${dev.idea.title.replace(/^《|》$/g, '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 20) || 'glean'}.png`;
      const where = await deliverFile(name, new Uint8Array(await card.blob.arrayBuffer()), target, 'image/png', '图片', '分享新枝明信片');
      if (where) toast(target === 'share' ? '已打开分享' : `存好了：${where}`);
    } catch (e) {
      toast('没存成：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  }
  const onAndroid = !!androidFiles();
  const toggle = (f: ShareField) => setFields((x) => (x.includes(f) ? x.filter((y) => y !== f) : FIELD_ORDER.filter((y) => y === f || x.includes(y))));

  return (
    <Sheet open onClose={onClose} title={it ? '分享这一穗' : '分享这根新枝'} variant="capture">
      <div className="share-panel">
        {it && (
          <div className="share-fields" role="group" aria-label="要带的字段">
            <span className="label">带上</span>
            <div className="chips">
              {FIELD_ORDER.filter((f) => f === 'title' || f === 'time' || (f === 'content' ? it.content && it.content !== it.title : f === 'tags' ? it.tags.length : it[f])).map((f) => (
                <button key={f} className={`chip share-f-${f}${fields.includes(f) ? ' on' : ''}`} aria-pressed={fields.includes(f)} onClick={() => toggle(f)}>
                  {FIELD_LABEL[f]}
                </button>
              ))}
            </div>
            {isPrivate && <p className="meta-text share-private">这是私密穗：分享前会再问你一次。</p>}
          </div>
        )}
        {dev && (
          <div className="share-fields" role="radiogroup" aria-label="因为这几穗">
            <span className="label">因为这几穗</span>
            <div className="chips">
              {(Object.keys(SPRIG_LABEL) as SprigMode[]).map((k) => (
                <button key={k} role="radio" aria-checked={mode === k} className={`chip share-m-${k}${mode === k ? ' on' : ''}`} onClick={() => (setMode(k), setCard(null))}>
                  {SPRIG_LABEL[k]}
                </button>
              ))}
            </div>
          </div>
        )}
        <span className="label">会发出去的就是这段</span>
        <pre className="share-preview">{text || '（一项都没勾）'}</pre>
        <p className="meta-text share-sign">署名 {prefs.name}{prefs.words.length ? ` · 会拦下 ${prefs.words.length} 个敏感词` : ''} · 设置 → 分享与花园 里改</p>
        <div className="actions text-actions share-acts">
          <button className="btn text strong share-copy" onClick={() => void copy(false)}>
            复制文字
          </button>
          {it && (
            <button className="btn text share-hand" onClick={() => void copy(true)}>
              复制递穗链接
            </button>
          )}
          {dev && (
            <button className="btn text share-card" onClick={() => void makeCard()} disabled={busy}>
              {busy ? '画明信片…' : card ? '重画明信片' : '生成明信片'}
            </button>
          )}
        </div>
        {card && (
          <figure className="share-cardview">
            <img src={card.url} alt="新枝明信片预览" />
            <div className="actions text-actions">
              {onAndroid ? (
                <>
                  <button className="btn text strong card-share" onClick={() => void deliver('share')}>
                    分享图片…
                  </button>
                  <button className="btn text card-save" onClick={() => void deliver('downloads')}>
                    存到相册
                  </button>
                </>
              ) : (
                <button className="btn text strong card-save" onClick={() => void deliver('save')}>
                  保存图片
                </button>
              )}
            </div>
          </figure>
        )}
      </div>
    </Sheet>
  );
}
