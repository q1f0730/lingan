// v0.34 设置 · 分享与花园：公开名（默认 Q1f730，0901）、敏感词（0909，只存本机）、生成公开花园页（0902 只放标了花园的穗 + 清单确认，0903 清洗图片和链接）。
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../lib/db';
import { androidFiles, deliverFile } from '../lib/files';
import { getOriginalBlob } from '../lib/imagestore';
import { maskHit, PUBLIC_NAME, readSharePrefs, scanPersonal, writeSharePrefs } from '../lib/sharekit';
import { useApp } from '../lib/store';
import '../styles/share.css';

export function GardenPanel() {
  const { toast, confirm } = useApp();
  const [p, setP] = useState(readSharePrefs);
  const [words, setWords] = useState(() => p.words.join('\n'));
  const [busy, setBusy] = useState(false);
  const n = useLiveQuery(() => db.items.filter((x) => !!x.garden && !x.deletedAt && !x.private && !x.locked && !x.sample).count(), []);
  const save = (next: typeof p) => (setP(next), writeSharePrefs(next));

  async function build(target: 'save' | 'share' | 'downloads') {
    if (busy) return;
    const { buildGarden, gardenItems, gardenText, scrubImage } = await import('../lib/garden');
    const list = gardenItems(await db.items.toArray());
    if (!list.length) return toast('花园里还没有穗：长按 / 右键一穗 →「放进花园」', 'err');
    const names = list.slice(0, 30).map((x, i) => `${i + 1}. ${x.title.slice(0, 28)}`);
    if (!(await confirm({ title: `这 ${list.length} 穗会公开`, body: names.join('\n') + (list.length > 30 ? `\n…还有 ${list.length - 30} 穗` : '') + `\n\n作者写「${p.name}」。图片会去掉拍摄信息，链接去掉追踪参数。`, ok: '生成网页', cancel: '再想想' }))) return;
    const hits = scanPersonal(list.map((x) => gardenText(x, !!p.gardenWhy)).join('\n') + '\n' + p.name, p.words);
    if (hits.length && !(await confirm({ title: '花园里像有个人信息', body: hits.map((h) => `${h.kind}：${maskHit(h)}`).join('\n') + '\n\n公开出去就收不回来了。', ok: '仍然生成', cancel: '回去改', danger: true }))) return;
    setBusy(true);
    try {
      const html = await buildGarden(list, {
        name: p.name,
        withWhy: !!p.gardenWhy,
        image: async (it) => {
          if (!it.hasImage && !it.thumb) return null;
          const b = (it.id != null ? await getOriginalBlob(db, it.id) : null) || it.thumb || null;
          return b ? scrubImage(b) : null;
        },
      });
      const where = await deliverFile('garden.html', new TextEncoder().encode(html), target, 'text/html', '网页', '拾穗花园');
      if (where) toast(target === 'share' ? '已打开分享' : `花园页存好了：${where}`);
    } catch (e) {
      toast('没生成成：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="set-sec garden-panel" id="set-share">
      <h2 className="sec-title">分享与花园</h2>
      <p className="meta-text">分享一穗 / 一根新枝时默认只带标题和正文；发出去前会扫一遍手机号、身份证号、邮箱和下面的敏感词。这里的设置只存在这台设备，不同步、不进备份。</p>
      <label className="field">
        <span className="label">公开名（分享署名、花园作者、明信片落款）</span>
        <input className="share-name" value={p.name} placeholder={PUBLIC_NAME} onChange={(e) => save({ ...p, name: e.target.value })} onBlur={() => setP(readSharePrefs())} />
      </label>
      <label className="field">
        <span className="label">敏感词：真名、学校、宿舍地址……一行一个，命中就先拦下问你</span>
        <textarea className="garden-words share-words" value={words} onChange={(e) => setWords(e.target.value)} onBlur={() => save({ ...p, words: words.split(/\n+/) })} />
      </label>
      <div className="field">
        <span className="label">
          公开花园 · 标了花园的 <span className="num">{n ?? '…'}</span> 穗
        </span>
        <p className="meta-text">长按 / 右键一穗（或多选）→「放进花园」。生成一个单文件网页，可以放到 GitHub Pages 之类的地方。私密穗、示例穗永远不放；不带具体日期、来源 App。</p>
        <label className="check">
          <input className="garden-why" type="checkbox" checked={!!p.gardenWhy} onChange={(e) => save({ ...p, gardenWhy: e.target.checked })} /> 带上「为什么」
        </label>
        <div className="garden-acts">
          {androidFiles() ? (
            <>
              <button className="btn primary garden-build" onClick={() => void build('share')} disabled={busy}>
                {busy ? '生成中…' : '生成并分享'}
              </button>
              <button className="btn text garden-dl" onClick={() => void build('downloads')} disabled={busy}>
                存到「下载」
              </button>
            </>
          ) : (
            <button className="btn primary garden-build" onClick={() => void build('save')} disabled={busy}>
              {busy ? '生成中…' : '生成花园页'}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
