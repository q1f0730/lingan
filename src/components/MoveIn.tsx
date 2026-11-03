// v0.35 设置 · 备份与导入 →「从别处搬进来」（ROADMAP v0.28 + 0014 0802 0049 0065）：选文件 → 本机解析 → 预览（新 / 已有 / 读不出）→ 先拍快照再导入。
import { useRef, useState } from 'react';
import { db } from '../lib/db';
import type { Draft } from '../lib/importers';
import { withSnapshot } from '../lib/snapshots';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER } from '../lib/types';
import '../styles/v039.css';

interface Plan {
  name: string;
  kind: string;
  fresh: Draft[];
  dup: number;
  bad: number;
}

export function MoveIn() {
  const { toast } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      const im = await import('../lib/importers');
      const p = await im.parseFile(f.name, new Uint8Array(await f.arrayBuffer()));
      const { fresh, dup } = await im.planMoveIn(p);
      setPlan({ name: f.name, kind: p.kind, fresh, dup, bad: p.bad });
    } catch (e) {
      toast('读不出这个文件：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  }

  async function go() {
    if (!plan || busy) return;
    setBusy(true);
    const d = new Date();
    const bundle = `导入 · ${plan.kind} ${d.getMonth() + 1}/${d.getDate()}`;
    try {
      const { runMoveIn } = await import('../lib/importers');
      const { result: n } = await withSnapshot(`搬进来（${plan.kind}）前`, db, () => runMoveIn(plan.fresh, bundle), { required: false });
      toast(`搬进来 ${n} 穗 · 放在穗束「${bundle}」${plan.dup ? ` · 已有的 ${plan.dup} 穗跳过` : ''}${plan.bad ? ` · ${plan.bad} 行读不出` : ''}`);
      setPlan(null);
    } catch (e) {
      toast('没导完：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy(false);
    }
  }

  const by = plan ? TYPE_ORDER.map((t) => [t, plan.fresh.filter((x) => x.type === t).length] as const).filter(([, n]) => n) : [];
  return (
    <>
      <div className="table action-table">
        <button className="trow movein-pick" onClick={() => ref.current?.click()}>
          <span className="tc tc-title">从别处搬进来</span>
          <span className="tc tc-src">豆瓣（豆伴导出）、flomo、浏览器书签、Kindle 标注、微信读书笔记、纯文本；先看条数，重复的不再收</span>
          <span className="tc tc-date">.csv 等</span>
        </button>
        <PlaylistIn />
      </div>
      <input ref={ref} className="movein-file" type="file" accept=".csv,.tsv,.xlsx,.html,.htm,.txt,.md,text/*" hidden onChange={(e) => {
          void pick(e.target.files?.[0]);
          e.target.value = '';
        }} />
      {plan && (
        <div className="import-preview movein-preview" data-new={plan.fresh.length} data-dup={plan.dup} data-bad={plan.bad}>
          <p className="meta-text">
            {plan.name} · 认作「{plan.kind}」 · 新的 {plan.fresh.length} 穗 · 已经有的 {plan.dup} 穗（跳过）{plan.bad ? ` · ${plan.bad} 行读不出` : ''}
          </p>
          {by.length > 0 && <p className="meta-text">{by.map(([t, n]) => `${TYPE_LABEL[t]} ${n}`).join(' · ')}</p>}
          <ol className="movein-list meta-text">
            {plan.fresh.slice(0, 5).map((x, i) => (
              <li key={i}>{x.title}</li>
            ))}
          </ol>
          <div className="actions">
            <button className="btn primary movein-go" onClick={go} disabled={busy || !plan.fresh.length}>
              {busy ? '导入中…' : `导入 ${plan.fresh.length} 穗`}
            </button>
            <button className="btn text" onClick={() => setPlan(null)} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// v0.39 0015 / 0801 网易云歌单整单拾进：粘贴链接 → 读公开歌单 → 勾选 → 每首一穗 / 整单一穗（先拍快照再导）
type PL = import('../lib/netease').Playlist;
function PlaylistIn() {
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [pl, setPl] = useState<PL | null>(null);
  const [have, setHave] = useState<Set<number>>(new Set());
  const [pick, setPick] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<'each' | 'one'>('each');
  const [covers, setCovers] = useState(true);
  const web = typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);

  async function read() {
    if (!url.trim() || busy) return;
    setBusy('读取中…');
    try {
      const N = await import('../lib/netease');
      const p = await N.fetchPlaylist(url, (x) => setBusy(`读取中… ${x}%`));
      if (!p.songs.length) throw new Error('这个歌单是空的');
      const { planMoveIn } = await import('../lib/importers');
      const drafts = N.playlistDrafts(p, new Set(p.songs.map((s) => s.id)), 'each');
      const { fresh } = await planMoveIn({ kind: '网易云歌单', items: drafts.map((x) => x.d), bad: 0 });
      const freshUrls = new Set(fresh.map((d) => d.url));
      const old = new Set(p.songs.filter((s) => !freshUrls.has(N.songUrl(s.id))).map((s) => s.id));
      setPl(p);
      setHave(old);
      setPick(new Set(p.songs.filter((s) => !old.has(s.id)).map((s) => s.id)));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      toast((web && /fetch|network|Failed/i.test(m) ? '网页版浏览器读不了网易云（跨域），请在 App 里用。' : '') + '没读到歌单：' + m, 'err');
    } finally {
      setBusy('');
    }
  }

  async function go() {
    if (!pl || busy || !pick.size) return;
    setBusy('导入中…');
    try {
      const N = await import('../lib/netease');
      const { runMoveIn } = await import('../lib/importers');
      const list = N.playlistDrafts(pl, pick, mode);
      const bundle = `歌单 · ${pl.name}`.slice(0, 80);
      const ids: number[] = [];
      const { result: n } = await withSnapshot(`网易云歌单（${pl.name}）前`, db, () => runMoveIn(list.map((x) => x.d), bundle, ids), { required: false });
      toast(`拾进 ${n} ${mode === 'one' ? '穗（整单）' : '首'} · 放在穗束「${bundle}」${have.size && mode === 'each' ? ` · 已有的 ${have.size} 首跳过` : ''}`);
      setPl(null);
      setUrl('');
      if (covers) void fetchCovers(ids.map((id, i) => [id, list[i]?.cover] as const));
    } catch (e) {
      toast('没导完：' + (e instanceof Error ? e.message : String(e)), 'err');
    } finally {
      setBusy('');
    }
  }

  const toggle = (id: number) => setPick((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <>
      <button className="trow pl-open" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <span className="tc tc-title">网易云歌单</span>
        <span className="tc tc-src">粘贴歌单链接，整单拾进来：每首一穗（标签带歌单名）或整单一穗，先勾选再导</span>
        <span className="tc tc-date">链接</span>
      </button>
      {open && (
        <div className="import-preview pl-box">
          <label className="field">
            <span className="label">歌单链接</span>
            <div className="inline">
              <input className="pl-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://music.163.com/playlist?id=…" inputMode="url" onKeyDown={(e) => e.key === 'Enter' && void read()} />
              <button type="button" className="btn text pl-read" onClick={read} disabled={!url.trim() || !!busy}>
                {busy && !pl ? busy : '读取'}
              </button>
            </div>
          </label>
          <p className="meta-text">只读公开歌单，不登录；「我喜欢的音乐」要先在网易云里设成公开。{web ? '网页版浏览器读不了网易云（跨域），请在 App 里用。' : ''}</p>
          {pl && (
            <>
              <p className="meta-text pl-head" data-n={pl.songs.length} data-have={have.size}>
                《{pl.name}》{pl.creator ? ` · ${pl.creator}` : ''} · {pl.songs.length} 首{have.size ? ` · 已经有的 ${have.size} 首` : ''}
              </p>
              <div className="seg pl-mode" role="radiogroup" aria-label="怎么收">
                <button role="radio" aria-checked={mode === 'each'} className={mode === 'each' ? 'on' : ''} onClick={() => setMode('each')}>
                  每首一穗
                </button>
                <button role="radio" aria-checked={mode === 'one'} className={mode === 'one' ? 'on' : ''} onClick={() => setMode('one')}>
                  整单一穗
                </button>
              </div>
              <label className="check">
                <input type="checkbox" className="pl-covers" checked={covers} onChange={(e) => setCovers(e.target.checked)} /> 带封面（{mode === 'each' ? '每首多下载一张专辑图' : '歌单封面'}，导完在后台补）
              </label>
              <div className="actions">
                <button className="btn text pl-all" onClick={() => setPick(new Set(pl.songs.filter((s) => !have.has(s.id)).map((s) => s.id)))}>
                  全选
                </button>
                <button className="btn text pl-none" onClick={() => setPick(new Set())}>
                  全不选
                </button>
              </div>
              <ol className="pl-list">
                {pl.songs.map((s) => (
                  <li key={s.id} className={have.has(s.id) ? 'dim' : ''}>
                    <label className="check pl-song">
                      <input type="checkbox" checked={pick.has(s.id)} disabled={have.has(s.id) && mode === 'each'} onChange={() => toggle(s.id)} />
                      <span>
                        {s.name}
                        <span className="meta-text">{s.artists.length ? ` — ${s.artists.join(' / ')}` : ''}{have.has(s.id) ? ' · 已有' : ''}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ol>
              <div className="actions">
                <button className="btn primary pl-go" onClick={go} disabled={!!busy || !pick.size}>
                  {busy || (mode === 'one' ? `整单收成一穗（${pick.size} 首）` : `导入 ${pick.size} 首`)}
                </button>
                <button className="btn text" onClick={() => setPl(null)} disabled={!!busy}>
                  取消
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** 导完在后台补封面：3 个一起下，失败的跳过 */
async function fetchCovers(list: ReadonlyArray<readonly [number, string | undefined]>) {
  const { fetchImageData } = await import('../lib/linkmeta');
  const { updateItem } = await import('../lib/repo');
  const todo = list.filter((x): x is readonly [number, string] => !!x[1]);
  let k = 0;
  const worker = async () => {
    while (k < todo.length) {
      const [id, cover] = todo[k++];
      try {
        await updateItem(id, { image: await fetchImageData(cover + (cover.includes('?') ? '' : '?param=400y400'), 'netease') });
      } catch {
        /* 这张没下来就算了 */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}
