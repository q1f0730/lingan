import { useEffect, useRef, useState } from 'react';
import { compressImage } from '../lib/image';
import { normalizeTags } from '../lib/db';
import { extractUrl, fetchLinkMeta } from '../lib/linkmeta';
import { TYPE_LABEL, TYPE_ORDER, type Item, type ItemType } from '../lib/types';

export type Draft = Omit<Item, 'id' | 'createdAt' | 'updatedAt'>;

const PH: Record<ItemType, { title: string; creator: string; content: string }> = {
  music: { title: '歌名', creator: '歌手 / 乐队', content: '一句歌词，或者哪一秒戳到你' },
  film: { title: '片名', creator: '导演', content: '一个镜头、一句台词' },
  image: { title: '给这张图起个名字', creator: '作者 / 出处', content: '补充说明' },
  text: { title: '出处 / 标题', creator: '作者', content: '摘抄的原文' },
  link: { title: '标题', creator: '网站 / 作者', content: '摘要' },
  idea: { title: '一句话概括', creator: '', content: '展开写写' },
};

export function emptyDraft(type: ItemType = 'idea'): Draft {
  return { type, title: '', creator: '', year: '', content: '', url: '', image: undefined, why: '', tags: [] };
}

export function CaptureForm({ initial, onSave, onCancel, saving, editing, onDelete }: { initial: Draft; onSave: (d: Draft) => void; onCancel: () => void; saving?: boolean; editing?: boolean; onDelete?: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [tagText, setTagText] = useState(initial.tags.join(' '));
  const [err, setErr] = useState('');
  const [imgBusy, setImgBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sniff, setSniff] = useState<'' | 'busy' | 'ok' | 'fail'>('');
  const [more, setMore] = useState(!!(initial.why || initial.tags.length));

  async function recognize(raw: string) {
    const url = extractUrl(raw);
    if (!url) return;
    setSniff('busy');
    try {
      const m = await fetchLinkMeta(url);
      setD((x) => ({
        ...x,
        url,
        type: x.type === 'idea' || x.type === 'link' ? m.type : x.type,
        title: !x.title || extractUrl(x.title) ? m.title || x.title.replace(url, '').trim() || '' : x.title,
        year: x.year || m.year || '',
        creator: x.creator || m.siteName || '',
        content: x.content || m.description || '',
        image: x.image || m.imageData,
      }));
      setSniff('ok');
    } catch {
      setD((x) => ({ ...x, url, type: x.type === 'idea' ? 'link' : x.type, title: extractUrl(x.title) ? x.title.replace(url, '').trim() : x.title }));
      setSniff('fail');
    }
  }
  useEffect(() => {
    setD(initial);
    setTagText(initial.tags.join(' '));
    setMore(!!(initial.why || initial.tags.length));
  }, [initial]);
  const ph = PH[d.type];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function pick(f?: File | null) {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      setErr('请选择图片文件');
      return;
    }
    setImgBusy(true);
    setErr('');
    try {
      const url = await compressImage(f);
      setD((x) => ({ ...x, image: url, type: x.type === 'idea' && !x.title ? 'image' : x.type }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : '图片处理失败');
    } finally {
      setImgBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    let title = (d.title || '').trim().slice(0, 120);
    if (!title) {
      // derive a title so quick capture never blocks
      const src = (d.content || d.why || d.url || '').trim();
      title = src ? src.slice(0, 18) : d.image ? '无题图片' : '';
    }
    if (!title) {
      setErr('写点什么吧：标题、内容或者为什么打动你，至少一项');
      return;
    }
    const url = d.url?.trim() ? (/^https?:\/\//i.test(d.url.trim()) ? d.url.trim() : 'https://' + d.url.trim()) : '';
    onSave({ ...d, title, url, tags: normalizeTags(tagText), creator: d.creator?.trim(), year: d.year?.trim(), why: d.why?.trim(), content: d.content?.trim() });
  }

  return (
    <form className={`capture${editing ? ' editing' : ''}`} onSubmit={submit}>
      <div className="field-label label">类型</div>
      <div className="chips type-chips" role="radiogroup" aria-label="类型">
        {TYPE_ORDER.map((t) => (
          <button type="button" key={t} role="radio" aria-checked={d.type === t} className={`chip${d.type === t ? ' on' : ''}`} onClick={() => set('type', t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <label className="field big">
        <span className="label">{editing ? '标题' : '此刻戳到你的是什么'}</span>
        <input
          autoFocus
          value={d.title}
          onChange={(e) => set('title', e.target.value)}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (extractUrl(t)) setTimeout(() => recognize(t), 0);
          }}
          placeholder={`${ph.title}（也可以直接粘贴链接）`}
          maxLength={400}
        />
      </label>
      {sniff && (
        <div className={`sniff${sniff === "fail" ? " warn" : ""}`}>
          {sniff === 'busy' ? '正在读取链接…' : sniff === 'ok' ? '已从链接读取标题和封面' : '读不到这个网页的信息，已保存链接，其余请手填'}
        </div>
      )}
      <div className="row2">
        {ph.creator && (
          <label className="field">
            <span className="label">{ph.creator}</span>
            <input value={d.creator || ''} onChange={(e) => set('creator', e.target.value)} maxLength={80} />
          </label>
        )}
        {(d.type === 'music' || d.type === 'film' || d.type === 'text') && (
          <label className="field narrow">
            <span className="label">年份</span>
            <input value={d.year || ''} onChange={(e) => set('year', e.target.value.replace(/[^\d]/g, '').slice(0, 4))} inputMode="numeric" placeholder="2000" />
          </label>
        )}
      </div>
      {(d.type === 'link' || d.type === 'music' || d.type === 'film') && (
        <label className="field">
          <span className="label">链接</span>
          <div className="inline">
            <input value={d.url || ''} onChange={(e) => set('url', e.target.value)} placeholder="https://" inputMode="url" />
            <button type="button" className="btn text" disabled={!d.url || sniff === 'busy'} onClick={() => recognize(/^https?:/i.test(d.url || '') ? d.url! : 'https://' + d.url)}>
              识别
            </button>
          </div>
        </label>
      )}
      <label className="field">
        <span className="label">{ph.content}</span>
        <textarea value={d.content || ''} onChange={(e) => set('content', e.target.value)} rows={d.type === 'text' || d.type === 'idea' ? 4 : 2} maxLength={4000} />
      </label>
      <div className="field">
        <span className="label">图片</span>
        <div className="img-pick">
          {d.image ? (
            <div className="img-preview">
              <img src={d.image} alt="预览" />
              <span className="img-acts">
                <button type="button" className="btn text" onClick={() => fileRef.current?.click()} disabled={imgBusy}>
                  换一张
                </button>
                <button type="button" className="btn text faint" onClick={() => set('image', undefined)}>
                  移除
                </button>
              </span>
            </div>
          ) : (
            <button type="button" className="btn text" onClick={() => fileRef.current?.click()} disabled={imgBusy}>
              {imgBusy ? '处理中…' : '选一张图'}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </div>
      {!more && (
        <button type="button" className="btn text faint more-toggle" onClick={() => setMore(true)}>
          为什么收 / 标签（可选）
        </button>
      )}
      {more && (<>
      <label className="field why">
        <span className="label">为什么收 · 最重要的一句</span>
        <input value={d.why || ''} onChange={(e) => set('why', e.target.value)} placeholder="AI 靠这句话认识你的口味" maxLength={200} />
      </label>
      <label className="field">
        <span className="label">标签（空格分隔）</span>
        <input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="雨 克制 慢镜头" />
      </label>
      </>)}
      {err && <div className="error">{err}</div>}
      <div className="actions form-actions">
        <button type="submit" className="btn primary" disabled={saving || imgBusy}>
          {saving ? '保存中…' : editing ? '保存' : '拾'}
        </button>
        <button type="button" className="btn text faint" onClick={onCancel}>
          取消
        </button>
      </div>
      {editing && onDelete && (
        <button type="button" className="btn text faint danger delete-ear" onClick={onDelete}>
          删除这一穗
        </button>
      )}
    </form>
  );
}
