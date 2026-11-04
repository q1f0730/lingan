// v0.17 秒搜（m18 / d8）：超大查询行 + 真实计数 → 类型 / 标签 / 日期 三行文字筛选 → 「穗 (n)」无线表格 + 「新枝 (n)」→ 最近搜过。
// 全部在本地：内存倒排索引（lib/ftsync）+ 原文核对，断网照常。
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useUnlocked } from '../lib/lock';
import { HoverPreview, safeHost } from '../components/ItemCard';
import { VirtualList } from '../components/Virtual';
import { db } from '../lib/db';
import { ftShared } from '../lib/ftsync';
import { itemHasImage } from '../lib/imagestore';
import { useThumbSrc } from '../lib/useImage';
import { DATE_LABEL, FIELD_LABEL, FOCUS_BRANCH_KEY, dateBounds, parseQuery, pushRecent, searchDocs, snippet, splitByTerms, toDoc, type DateRange, type SearchHit, type Term } from '../lib/search';
import { displayTitle, shortDate } from '../lib/studio';
import { useApp } from '../lib/store';
import { TYPE_LABEL, TYPE_ORDER, type Development, type Item, type ItemType } from '../lib/types';
import { completeSyntax, matchFilters, parseSyntax, SYNTAX_HELP } from '../lib/qsyntax';
import { AskPanel } from '../components/AskPanel';
import { embed } from '../lib/ai';
import { embedConfig } from '../lib/settings';
import { isLocalBaseUrl, MINI } from '../lib/privacy';
import { cosine } from '../lib/similarity';
import { addSmart, agoText, commandText, dropSmart, filterCmds, forgotten, isCommand, loadSmart, loosenOptions, saveSmart, smartQuery, type Cmd } from '../lib/searchplus';
import { parseQuick } from '../lib/quick';
import { quickAdd } from '../components/QuickBar';
import { NAV } from '../components/rw/NavBar';
import { BASKET_MAX, BASKET_MIN } from '../lib/basket';
import '../styles/v041.css';

const RECENT_KEY = 'glean.recentq';
const RANGES: DateRange[] = ['all', '7d', '30d', 'year', 'custom'];
type TypeSel = 'all' | ItemType | 'branch';

declare global {
  interface Window {
    __gleanSearchPaint?: { q: string; ms: number; at: number };
  }
}

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}

/** 命中字黑底白字 */
export function TermHits({ text, terms }: { text: string; terms: Term[] }): ReactNode {
  if (!terms.length || !text) return text;
  return splitByTerms(text, terms).map((p, i) => (p.hit ? <mark key={i} className="hit">{p.t}</mark> : <span key={i}>{p.t}</span>));
}

/** 「命中」列：除标题以外命中的字段，标签「冬天 · 夜」备注「…雪夜木屋亮着的窗」；只中标题就写「标题」 */
function hitWhere(h: SearchHit, terms: Term[]): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  for (const fh of h.fields) {
    const f = h.doc.fields[fh.i];
    if (f.f === 'title' || (f.f === 'content' && (h.doc.obj as Item).type === 'text' && h.doc.kind === 'i')) continue;
    out.push({ label: FIELD_LABEL[f.f], text: snippet(f.f === 'url' ? safeHost(f.text) + f.text.replace(/^https?:\/\/[^/]+/, '') : f.text, terms, 26).text });
    if (out.length >= 2) break;
  }
  return out;
}

export function SearchView({ items, devs, onClose }: { items: Item[]; devs: Development[]; onClose: () => void }) {
  const { openItem, go, desktop, settings, toast, openCapture, developFrom } = useApp();
  const ft = ftShared(db);
  const rev = useSyncExternalStore(ft.subscribe, ft.getRev);
  const [q, setQ] = useState('');
  // v0.30 0211 问穗仓
  const [asking, setAsking] = useState(false);
  const [type, setType] = useState<TypeSel>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const remember = useCallback(
    (s: string = q) => {
      setRecent((r) => {
        const n = pushRecent(r, s);
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(n));
        } catch {
          /* 隐私模式 */
        }
        return n;
      });
    },
    [q],
  );

  // v0.39 0907 没解锁时上锁的穗搜不到
  const unl = useUnlocked();
  const itemDocs = useMemo(() => items.filter((i) => i.id != null && !i.sealUntil && (unl || !i.locked)).map((i) => toDoc('i', i)), [items, unl]);
  const devDocs = useMemo(() => devs.filter((d) => d.id != null && d.idea).map((d) => toDoc('b', d)), [devs]);
  // v0.23 0111 搜索语法：type: tag: year: from: why: before: after: inbox: 先拆出来当筛选，剩下的字照常全文搜
  // v0.41 0137 以 > 开头 = 命令面板，不当查询
  const cmd = isCommand(q);
  const parsed = useMemo(() => parseSyntax(cmd ? '' : q), [q, cmd]);
  const filters = parsed.filters;
  const terms = useMemo(() => parseQuery(parsed.text), [parsed.text]);
  // 拼音字表约 22KB：第一次打纯字母时才加载
  const [py, setPy] = useState<typeof import('../lib/pinyin') | null>(null);
  const wantPy = /^[A-Za-z][A-Za-z ]+$/.test(parsed.text.trim());
  useEffect(() => {
    if (wantPy && !py) void import('../lib/pinyin').then((m) => m.ready.then(() => setPy(m))).catch(() => {});
  }, [wantPy, py]);
  // v0.41 0134 繁简互搜：查询里第一次出现汉字才加载字表（约 10KB）
  const [zh, setZh] = useState<typeof import('../lib/zhvar') | null>(null);
  const wantZh = /[\u3400-\u9fff]/.test(parsed.text);
  useEffect(() => {
    if (wantZh && !zh) void import('../lib/zhvar').then((m) => m.ready.then(() => setZh(m))).catch(() => {});
  }, [wantZh, zh]);
  const varTerms = useMemo(() => (zh && wantZh ? zh.zhVariants(parsed.text.trim()).map(parseQuery).filter((t) => t.length) : []), [zh, wantZh, parsed.text]);
  // 高亮：原词 + 繁 / 简写法
  const hlTerms = useMemo(() => {
    if (!varTerms.length) return terms;
    const seen = new Set(terms.map((t) => t.kind + t.s));
    const out = [...terms];
    for (const vt of varTerms)
      for (const t of vt)
        if (!seen.has(t.kind + t.s)) {
          seen.add(t.kind + t.s);
          out.push(t);
        }
    return out;
  }, [terms, varTerms]);
  const complete = useMemo(() => {
    if (!/[:：][^\s]*$/.test(q)) return [];
    const tags = new Map<string, number>();
    const srcs = new Set<string>();
    const bundles = new Set<string>();
    for (const it of items) {
      for (const b of it.bundles || []) bundles.add(b);
      for (const t of it.tags) tags.set(t, (tags.get(t) || 0) + 1);
      if (it.source) srcs.add(it.source);
    }
    return completeSyntax(q, { tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t), sources: [...srcs], bundles: [...bundles] });
  }, [q, items]);

  // v0.38 0109 意思相近：查询也算向量，和同一个模型算过的穗比余弦。本机小模型 / 本地模型打字停下就算；云端要点一下（免得每停一次就发一次）
  const [sem, setSem] = useState<{ q: string; hits: Item[] } | null>(null);
  const [semGo, setSemGo] = useState('');
  const semText = parsed.text.trim();
  const ec = embedConfig(settings);
  const semModel = ec?.model || '';
  const semUrl = ec?.baseUrl || '';
  const semHas = !!semModel && items.some((i) => i.embedModel === semModel && !!i.embedding);
  const semAuto = semUrl === MINI || isLocalBaseUrl(semUrl);
  useEffect(() => {
    if (semText.length < 2 || !semHas || (!semAuto && semGo !== semText)) return;
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const [v] = await embed(settings, [semText]);
        const min = semUrl === MINI ? 0.16 : 0.35;
        const hits = items.filter((i) => i.embedModel === semModel && !!i.embedding && !i.sealUntil && (unl || !i.locked)).map((it) => ({ it, c: cosine(v, it.embedding!) })).filter((x) => x.c >= min).sort((a, b) => b.c - a.c).slice(0, 12).map((x) => x.it);
        if (!dead) setSem({ q: semText, hits });
      } catch {
        /* 向量接口不可用：只给字面命中 */
      }
    }, semAuto ? 150 : 0);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [semText, semHas, semAuto, semGo, settings, semUrl, semModel, items, unl]);
  // 搜索本身（索引候选 + 原文核对），记下计算耗时
  const base = useMemo(() => {
    void rev;
    if (!terms.length) return null;
    const t0 = performance.now();
    const ih = searchDocs(ft.index, itemDocs, terms);
    const bh = searchDocs(ft.index, devDocs, terms);
    // v0.41 0134 繁 / 简写法各搜一遍，原文没命中的接在后面
    if (varTerms.length) {
      const si = new Set(ih.map((h) => h.doc.key));
      const sb = new Set(bh.map((h) => h.doc.key));
      for (const vt of varTerms) {
        for (const h of searchDocs(ft.index, itemDocs, vt))
          if (!si.has(h.doc.key)) {
            si.add(h.doc.key);
            ih.push(h);
          }
        for (const h of searchDocs(ft.index, devDocs, vt))
          if (!sb.has(h.doc.key)) {
            sb.add(h.doc.key);
            bh.push(h);
          }
      }
    }
    // v0.28 0112 拼音 / 首字母：打的是纯字母时，补上标题 / 作者 / 标签拼音对得上的穗（排在原文命中后面）
    if (py && py.isPinyinQuery(parsed.text)) {
      const seen = new Set(ih.map((h) => h.doc.key));
      for (const doc of itemDocs) if (!seen.has(doc.key) && py.pinyinMatch(doc.obj, parsed.text)) ih.push({ doc, score: 0.5, fields: [] });
    }
    ft.status.lastMs = +(performance.now() - t0).toFixed(2);
    ft.status.lastQuery = q;
    ft.status.lastHits = ih.length + bh.length;
    return { ih, bh };
  }, [terms, itemDocs, devDocs, rev, ft, q, py, parsed.text, varTerms]);

  const [lo, hi] = useMemo(() => dateBounds(range, Date.now(), from, to), [range, from, to]);
  const inRange = useCallback((t: number) => t >= lo && t < hi, [lo, hi]);
  const allI = useMemo<Array<SearchHit<Item>>>(
    () => (base ? (base.ih as Array<SearchHit<Item>>) : itemDocs.map((doc) => ({ doc, score: 0, fields: [] }))).filter((h) => inRange(h.doc.createdAt) && (!filters.length || matchFilters(h.doc.obj, filters))),
    [base, itemDocs, inRange, filters],
  );
  // 语法筛选都是穗的属性：用了语法就不列新枝
  const allB = useMemo<Array<SearchHit<Development>>>(() => (filters.length ? [] : (base ? (base.bh as Array<SearchHit<Development>>) : devDocs.map((doc) => ({ doc, score: 0, fields: [] }))).filter((h) => inRange(h.doc.createdAt))), [base, devDocs, inRange, filters]);

  const typeN = useMemo(() => {
    const m = new Map<ItemType, number>();
    for (const h of allI) if (!tag || h.doc.obj.tags.includes(tag)) m.set(h.doc.obj.type, (m.get(h.doc.obj.type) || 0) + 1);
    return m;
  }, [allI, tag]);
  const tagN = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of allI) if (type === 'all' || h.doc.obj.type === type) for (const t of h.doc.obj.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12);
  }, [allI, type]);
  const iHits = useMemo(() => (type === 'branch' ? [] : allI.filter((h) => (type === 'all' || h.doc.obj.type === type) && (!tag || h.doc.obj.tags.includes(tag)))), [allI, type, tag]);
  const bHits = type === 'all' || type === 'branch' ? (tag ? [] : allB) : [];
  const nBranchFacet = tag ? 0 : allB.length;
  const active = terms.length > 0 || filters.length > 0 || type !== 'all' || !!tag || range !== 'all';
  const semHits = useMemo(() => {
    if (!sem || sem.q !== semText || type === 'branch') return null;
    const lit = new Set(iHits.map((h) => h.doc.obj.id));
    return sem.hits.filter((it) => !lit.has(it.id) && (type === 'all' || it.type === type) && (!tag || it.tags.includes(tag)));
  }, [sem, semText, iHits, type, tag]);
  const total = iHits.length + bHits.length + (semHits?.length || 0);

  // 输入 → 结果画到屏幕上的耗时（e2e 读它，也读自己量的）
  useLayoutEffect(() => {
    if (!inputAt.current) return;
    const t = inputAt.current;
    inputAt.current = 0;
    const qq = q;
    requestAnimationFrame(() => {
      window.__gleanSearchPaint = { q: qq, ms: +(performance.now() - t).toFixed(1), at: performance.now() };
    });
  });

  // 搜过的词：停下来 1.5 秒且有结果就记进「最近搜过」
  useEffect(() => {
    if ((!terms.length && !filters.length) || !total) return;
    const t = setTimeout(() => remember(q), 1500);
    return () => clearTimeout(t);
  }, [q, terms.length, filters.length, total, remember]);

  // 已选的标签不在结果里了就放掉
  useEffect(() => {
    if (tag && !tagN.some(([t]) => t === tag) && !allI.some((h) => h.doc.obj.tags.includes(tag))) setTag(null);
  }, [tag, tagN, allI]);

  const openHit = (it: Item) => {
    if (terms.length || filters.length) remember();
    openItem(it, iHits.map((h) => h.doc.obj.id!));
  };
  const openBranch = (d: Development) => {
    if (terms.length) remember();
    try {
      sessionStorage.setItem(FOCUS_BRANCH_KEY, String(d.id));
    } catch {
      /* ignore */
    }
    go('branches');
  };
  const setQuery = (v: string) => {
    inputAt.current = performance.now();
    setQ(v);
  };

  // 没找到时的提示：长词拆成单字（有结果的），再加两个常用标签
  const tips = useMemo(() => {
    if (!terms.length || total) return [];
    const out: string[] = [];
    for (const t of terms)
      if (t.kind === 'cjk' && t.s.length > 1)
        for (const ch of t.s) if (!out.includes(ch) && searchDocs(ft.index, itemDocs, [{ kind: 'cjk', s: ch }]).length) out.push(ch);
    const tc = new Map<string, number>();
    for (const d of itemDocs) for (const tg of d.obj.tags) tc.set(tg, (tc.get(tg) || 0) + 1);
    for (const [tg] of [...tc.entries()].sort((a, b) => b[1] - a[1])) if (out.length < 4 && !out.includes(tg) && tg !== q.trim()) out.push(tg);
    return out.slice(0, 4);
  }, [terms, total, ft, itemDocs, q]);

  // v0.41 0128 智能穗束：存查询（含当前类型 / 标签），打开时按当下的穗仓重新算
  const [smart, setSmart] = useState(loadSmart);
  const smartQ = smartQuery(q, type, tag);
  const smartSaved = smart.some((x) => x.q === smartQ.replace(/\s+/g, ' '));
  const keepSmart = () => {
    const n = addSmart(smart, smartQ);
    setSmart(n);
    saveSmart(n);
    toast('存成智能穗束了：以后收的穗对得上也会算进来');
  };
  const unSmart = (sq: string) => {
    const n = dropSmart(smart, sq);
    setSmart(n);
    saveSmart(n);
  };
  const smartN = useMemo(() => {
    void rev;
    if (active) return [];
    return smart.map((sm) => {
      const ps = parseSyntax(sm.q);
      const ts = parseQuery(ps.text);
      const pool = ts.length ? searchDocs(ft.index, itemDocs, ts) : itemDocs.map((doc) => ({ doc }));
      return ps.filters.length ? pool.filter((h) => matchFilters(h.doc.obj, ps.filters)).length : pool.length;
    });
  }, [smart, active, itemDocs, ft, rev]);
  // v0.41 0136 搜索结果里挑几穗直接去嫁接
  const [pick, setPick] = useState<number[] | null>(null);
  const pickSet = useMemo(() => (pick ? new Set(pick) : null), [pick]);
  const onRow = (it: Item) => {
    if (!pick) return openHit(it);
    const id = it.id!;
    if (pick.includes(id)) setPick(pick.filter((x) => x !== id));
    else if (pick.length >= BASKET_MAX) toast(`一次最多嫁接 ${BASKET_MAX} 穗`, 'err');
    else setPick([...pick, id]);
  };
  // v0.41 0133 你忘了你收过：命中里有很久以前收的，轻轻提一句
  const fg = useMemo(() => (terms.length && iHits.length ? forgotten(iHits.map((h) => h.doc.obj)) : null), [terms.length, iHits]);
  // v0.41 0428 没结果：能放宽哪一个筛选 + 把这句拾进来
  const loosen = total === 0 && active ? loosenOptions({ type, typeLabel: type === 'branch' ? '新枝' : type !== 'all' ? TYPE_LABEL[type] : '', tag, range, rangeLabel: DATE_LABEL[range], filters: filters.length }) : [];
  const loosenBy = (id: string) => {
    if (id === 'type') setType('all');
    else if (id === 'tag') setTag(null);
    else if (id === 'range') setRange('all');
    else setQuery(parsed.text.trim());
  };
  const gleanText = parsed.text.trim();
  const gleanQ = async () => {
    const d = parseQuick(gleanText);
    if (!d) return;
    try {
      await quickAdd(d, settings, (m) => toast(m, 'err'));
      toast(`拾进来了：「${gleanText.slice(0, 20)}」`);
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)), 'err');
    }
  };
  // v0.41 0137 命令面板：> 开头，跳页面 / 执行动作，↑↓ 选、回车执行
  const [ci, setCi] = useState(0);
  const cmds = useMemo(() => {
    if (!cmd) return [];
    const list: Array<Cmd & { run: () => void }> = [
      ...NAV.map((n) => ({ id: 'go-' + n.v, label: '去' + n.label, keys: n.v + ' go', run: () => (onClose(), go(n.v)) })),
      { id: 'capture', label: '拾一穗（完整表单）', keys: 'new add capture 新建 记', run: () => (onClose(), openCapture()) },
      { id: 'ask', label: '问穗仓', keys: 'ask 问', run: () => (setQ(''), setAsking(true)) },
      { id: 'random', label: '随便翻一穗', keys: 'random 随机', run: () => void (itemDocs.length && openItem(itemDocs[Math.floor(Math.random() * itemDocs.length)].obj)) },
      { id: 'nowhy', label: '找还没写为什么的穗', keys: 'why 空', run: () => setQ('why:空 ') },
      ...smart.map((sm) => ({ id: 'smart-' + sm.q, label: `打开智能穗束「${sm.q}」`, keys: 'smart 束', run: () => setQ(sm.q) })),
    ];
    return filterCmds(list, commandText(q));
  }, [cmd, q, smart, itemDocs, onClose, go, openCapture, openItem]);
  const runCmd = (c: { run: () => void } | undefined) => {
    if (!c) return;
    setCi(0);
    c.run();
  };

  const countText = active ? `在 ${items.length} 穗和 ${devs.length} 根新枝里找到 ${total} 处` : `在 ${items.length} 穗和 ${devs.length} 根新枝里找`;

  return (
    <section className="view library search-view" aria-label="搜索">
      <header className="sq-head">
        <div className="sq-line">
          <label className="sq-grow" data-v={q || '搜点什么'}>
            <input
              ref={inputRef}
              className="sq-input"
              value={q}
              onChange={(e) => (setQuery(e.target.value), setCi(0))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (cmd) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCi((i) => (cmds.length ? (i + (e.key === 'ArrowDown' ? 1 : cmds.length - 1)) % cmds.length : 0));
                  }
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    runCmd(cmds[Math.min(ci, cmds.length - 1)]);
                  }
                  return;
                }
                if (e.key === 'Enter' && (terms.length || filters.length)) {
                  remember();
                  if (!desktop) inputRef.current?.blur();
                }
              }}
              placeholder="搜点什么"
              aria-label="搜索"
              autoFocus
              size={1}
              enterKeyHint="search"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          {active && (
            <span className="sq-total num" aria-hidden>
              ({total})
            </span>
          )}
          <span className="sq-acts">
            {q && (
              <button className="btn text faint sq-clear" onClick={() => (setQuery(''), inputRef.current?.focus())}>
                清除
              </button>
            )}
            <button className={`btn text sq-ask${asking ? ' on' : ''}`} aria-pressed={asking} onClick={() => setAsking((x) => !x)}>
              问穗仓
            </button>
            <button className="btn text sq-cancel" onClick={onClose}>
              取消
            </button>
          </span>
        </div>
        <p className="sq-count meta-text" data-q={q} data-n={total} aria-live="polite">
          {countText}
          {filters.length > 0 && (
            <span className="sq-syntax-on">
              {' · '}
              {filters.map((f) => `${f.neg ? '不是 ' : ''}${f.key}:${f.value}`).join(' · ')}
            </span>
          )}
        </p>
        {active && !cmd && smartQ && (
          <button className="linklike sq-keep" disabled={smartSaved} onClick={keepSmart} title="把这组筛选存成一个会自己长的穗束">
            {smartSaved ? '已存成智能穗束' : '存成智能穗束'}
          </button>
        )}
        {complete.length > 0 && (
          <div className="sq-complete" role="listbox" aria-label="补全">
            {complete.map((c) => (
              <button key={c.label} className="chip sq-comp" onClick={() => (setQuery(c.insert), inputRef.current?.focus())}>
                {c.label}
              </button>
            ))}
          </div>
        )}
      </header>
      {asking && <AskPanel items={items} initial={q} onOpen={openItem} />}

      {cmd ? (
        <div className="sq-cmds" role="listbox" aria-label="命令">
          <div className="label">命令（↑↓ 选，回车执行）</div>
          {cmds.length ? (
            cmds.map((c, i) => (
              <button key={c.id} role="option" aria-selected={i === Math.min(ci, cmds.length - 1)} className={`sq-cmd${i === Math.min(ci, cmds.length - 1) ? ' on' : ''}`} data-cmd={c.id} onMouseEnter={() => setCi(i)} onClick={() => runCmd(c)}>
                {c.label}
              </button>
            ))
          ) : (
            <p className="meta-text">没有这个命令。去掉开头的 &gt; 就是普通搜索。</p>
          )}
        </div>
      ) : (
      <>
      <div className="sq-filters">
        <div className="sq-frow" role="toolbar" aria-label="类型">
          <span className="sq-fl label">类型</span>
          <span className="sq-opts">
            <button className={`chip${type === 'all' ? ' on' : ''}`} onClick={() => setType('all')}>
              全部 <span className="n">({allI.filter((h) => !tag || h.doc.obj.tags.includes(tag)).length + nBranchFacet})</span>
            </button>
            {TYPE_ORDER.filter((t) => typeN.get(t) || type === t).map((t) => (
              <button key={t} className={`chip sq-type${type === t ? ' on' : ''}`} data-type={t} onClick={() => setType(type === t ? 'all' : t)}>
                {TYPE_LABEL[t]} <span className="n">({typeN.get(t) || 0})</span>
              </button>
            ))}
            {(nBranchFacet > 0 || type === 'branch') && (
              <button className={`chip sq-type${type === 'branch' ? ' on' : ''}`} data-type="branch" onClick={() => setType(type === 'branch' ? 'all' : 'branch')}>
                新枝 <span className="n">({nBranchFacet})</span>
              </button>
            )}
          </span>
        </div>
        {(tagN.length > 0 || tag) && type !== 'branch' && (
          <div className="sq-frow" role="toolbar" aria-label="标签">
            <span className="sq-fl label">标签</span>
            <span className="sq-opts">
              <button className={`chip${!tag ? ' on' : ''}`} onClick={() => setTag(null)}>
                不限
              </button>
              {tagN.map(([t, n]) => (
                <button key={t} className={`chip sq-tag${tag === t ? ' on' : ''}`} data-tag={t} onClick={() => setTag(tag === t ? null : t)}>
                  #{t} <span className="n">({n})</span>
                </button>
              ))}
            </span>
          </div>
        )}
        <div className="sq-frow" role="toolbar" aria-label="日期">
          <span className="sq-fl label">日期</span>
          <span className="sq-opts">
            {RANGES.map((r) => (
              <button key={r} className={`chip sq-range${range === r ? ' on' : ''}`} data-range={r} onClick={() => setRange(r)}>
                {DATE_LABEL[r]}
              </button>
            ))}
            {range === 'custom' && (
              <span className="sq-dates">
                <input type="date" className="sq-date sq-from" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="从" />
                <span className="dim">—</span>
                <input type="date" className="sq-date sq-to" value={to} onChange={(e) => setTo(e.target.value)} aria-label="到" />
              </span>
            )}
          </span>
        </div>
      </div>

      {!active ? (
        <div className="sq-idle">
          <p className="meta-text">输入就出结果：标题、作者、句子、为什么、标签，连新枝一起找。中文连着的字要连着出现，英文按词首；繁体简体互相找得到。打 &gt; 开头是命令面板。</p>
          {smart.length > 0 && (
            <section className="sq-smart">
              <div className="label">智能穗束（存下的筛选，新收的穗会自动算进来）</div>
              <div className="sq-recent-row">
                {smart.map((sm, i) => (
                  <span key={sm.q} className="sq-smart-item">
                    <button className="linklike sq-smart-q" onClick={() => setQuery(sm.q)}>
                      {sm.q} <span className="n num">({smartN[i] ?? 0})</span>
                    </button>
                    <button className="btn text faint sq-smart-x" aria-label={`删掉智能穗束 ${sm.q}`} onClick={() => unSmart(sm.q)}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}
          <section className="sq-syntax">
            <div className="label">还可以这样筛（能叠加，前面加 - 是排除）</div>
            <div className="sq-recent-row">
              {SYNTAX_HELP.map(([k, v]) => (
                <button key={k} className="chip sq-syn" onClick={() => (setQuery((q ? q.trimEnd() + ' ' : '') + k + ' '), inputRef.current?.focus())}>
                  <b>{k}</b> <span className="n">{v}</span>
                </button>
              ))}
            </div>
          </section>
          {recent.length > 0 && (
            <section className="sq-recent">
              <div className="label">最近搜过</div>
              <div className="sq-recent-row">
                {recent.map((r) => (
                  <button key={r} className="linklike sq-recent-q" onClick={() => setQuery(r)}>
                    {r}
                  </button>
                ))}
                <button
                  className="btn text faint sq-recent-clear"
                  onClick={() => {
                    setRecent([]);
                    localStorage.removeItem(RECENT_KEY);
                  }}
                >
                  清空
                </button>
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="sq-results">
          {type !== 'branch' && (
            <section className="sq-sec sq-items">
              {fg && (
                <p className="sq-forgot meta-text">
                  你 {agoText(fg)}收过
                  <button className="linklike sq-forgot-open" onClick={() => openHit(fg.it)}>
                    「{displayTitle(fg.it)}」
                  </button>
                  ，还记得吗？
                </p>
              )}
              <div className="sq-sec-head label">
                {semHits ? '字面命中' : '穗'} ({iHits.length})
                {iHits.length >= 2 && (
                  <button className={`btn text sq-pick${pick ? ' on' : ''}`} aria-pressed={!!pick} onClick={() => setPick(pick ? null : [])}>
                    {pick ? '不挑了' : '挑几穗去嫁接'}
                  </button>
                )}
              </div>
              {pick && (
                <div className="sq-pickbar">
                  <span className="meta-text">点结果挑 {BASKET_MIN}–{BASKET_MAX} 穗 · 已挑 <span className="num">{pick.length}</span></span>
                  <button className="btn primary sq-pick-go" disabled={pick.length < BASKET_MIN} onClick={() => developFrom(pick)}>
                    {pick.length < BASKET_MIN ? `差 ${BASKET_MIN - pick.length} 穗` : `嫁接这 ${pick.length} 穗`}
                  </button>
                </div>
              )}
              {iHits.length > 0 && <ItemResults hits={iHits} terms={hlTerms} desktop={desktop} onOpen={onRow} picked={pickSet} />}
            </section>
          )}
          {semHits ? (
            <section className="sq-sec sq-sem">
              <div className="sq-sec-head label">意思相近 ({semHits.length})</div>
              {semHits.length ? (
                semHits.map((it) => (
                  <button key={it.id} className="sq-branch" data-item-id={it.id} onClick={() => openItem(it, semHits.map((x) => x.id!))}>
                    <span className="sq-btitle">{displayTitle(it)}</span>
                    {it.why && <span className="sq-bbody">{it.why.slice(0, 60)}</span>}
                    <span className="sq-meta">
                      {TYPE_LABEL[it.type]} · <span className="num">{shortDate(it.createdAt)}</span>
                    </span>
                  </button>
                ))
              ) : (
                <p className="meta-text">没有意思相近的穗。</p>
              )}
            </section>
          ) : semHas && !semAuto && semText.length > 1 && type !== 'branch' ? (
            <button className="linklike sq-semgo" onClick={() => setSemGo(semText)}>
              按意思再找找（向量接口）
            </button>
          ) : null}
          {(type === 'branch' || (type === 'all' && !tag && (bHits.length > 0 || iHits.length === 0))) && (
            <section className="sq-sec sq-branches">
              <div className="sq-sec-head label">新枝 ({bHits.length})</div>
              {bHits.slice(0, 60).map((h) => (
                <BranchRow key={h.doc.key} h={h} terms={hlTerms} onOpen={openBranch} />
              ))}
              {bHits.length > 60 && <p className="meta-text sq-more">还有 {bHits.length - 60} 根，换个更具体的词试试</p>}
            </section>
          )}
          {total === 0 && (
            <div className="sq-none">
              <p className="meta-text">没找到这一穗。</p>
              {loosen.length > 0 && (
                <p className="meta-text sq-loosens">
                  {loosen.map((l) => (
                    <button key={l.id} className="linklike sq-loosen" data-loosen={l.id} onClick={() => loosenBy(l.id)}>
                      {l.label}
                    </button>
                  ))}
                </p>
              )}
              {gleanText && !filters.length && (
                <button className="btn text sq-glean" onClick={() => void gleanQ()}>
                  把「{gleanText.slice(0, 24)}」拾进来
                </button>
              )}
              {tips.length > 0 && (
                <p className="meta-text sq-tips">
                  没找到？试试
                  {tips.map((t) => (
                    <button key={t} className="linklike sq-tip" onClick={() => setQuery(t)}>
                      「{t}」
                    </button>
                  ))}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </section>
  );
}

function ItemResults({ hits, terms, desktop, onOpen, picked }: { hits: Array<SearchHit<Item>>; terms: Term[]; desktop: boolean; onOpen: (i: Item) => void; picked?: Set<number> | null }) {
  const [hov, setHov] = useState<{ it: Item; x: number; y: number } | null>(null);
  const onHover = useCallback((it: Item | null, e?: React.PointerEvent) => setHov(it && e && itemHasImage(it) ? { it, x: e.clientX, y: e.clientY } : null), []);
  return (
    <div className={`sq-table${desktop ? ' wide' : ''}`}>
      {desktop && (
        <div className="sq-thead" aria-hidden>
          <span className="tc">穗</span>
          <span className="tc">类型</span>
          <span className="tc">命中</span>
          <span className="tc tc-date">日期</span>
        </div>
      )}
      <VirtualList
        className="sq-tbody"
        rowClassName="sq-rowwrap"
        gap={0}
        items={hits}
        keyOf={(h) => h.doc.key}
        estimate={() => (desktop ? 56 : 92)}
        threshold={40}
        render={(h) => <ResultRow h={h} terms={terms} desktop={desktop} onOpen={onOpen} onHover={desktop ? onHover : undefined} on={picked ? picked.has(h.doc.obj.id!) : undefined} />}
      />
      {hov && <HoverPreview item={hov.it} x={hov.x} y={hov.y} />}
    </div>
  );
}

function RowThumb({ it }: { it: Item }) {
  const src = useThumbSrc(it);
  return <span className="sq-thumb">{src ? <img src={src} alt="" decoding="async" /> : null}</span>;
}

const ResultRow = memo(function ResultRow({ h, terms, desktop, onOpen, onHover, on }: { h: SearchHit<Item>; terms: Term[]; desktop: boolean; onOpen: (i: Item) => void; onHover?: (i: Item | null, e?: React.PointerEvent) => void; on?: boolean }) {
  const it = h.doc.obj;
  const where = hitWhere(h, terms);
  const titleHit = h.fields.some((f) => h.doc.fields[f.i].f === 'title' || (it.type === 'text' && h.doc.fields[f.i].f === 'content'));
  const whereNode = where.length ? (
    where.map((w, i) => (
      <span key={i} className="sq-where">
        {w.label}「<TermHits text={w.text} terms={terms} />」
      </span>
    ))
  ) : (
    <span className="sq-where dim">{terms.length ? (titleHit ? '标题' : '') : it.creator || ''}</span>
  );
  const common = {
    className: on ? 'sq-row picked' : 'sq-row',
    role: 'button',
    'aria-pressed': on,
    tabIndex: 0,
    'data-item-id': it.id,
    onClick: () => onOpen(it),
    onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(it)),
  } as const;
  if (desktop)
    return (
      <div
        {...common}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHover?.(it, e)}
        onPointerMove={(e) => e.pointerType === 'mouse' && onHover?.(it, e)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && onHover?.(null)}
      >
        <span className="tc sq-title">
          <TermHits text={displayTitle(it)} terms={terms} />
        </span>
        <span className="tc sq-type-c">{TYPE_LABEL[it.type]}</span>
        <span className="tc sq-hit">{whereNode}</span>
        <span className="tc tc-date num">{shortDate(it.createdAt)}</span>
      </div>
    );
  const img = itemHasImage(it);
  return (
    <div {...common} data-img={img ? '1' : undefined}>
      {img && <RowThumb it={it} />}
      <span className="sq-main">
        <span className="sq-title">
          <TermHits text={displayTitle(it)} terms={terms} />
        </span>
        {where.length > 0 && <span className="sq-hit">{whereNode}</span>}
        <span className="sq-meta">
          {TYPE_LABEL[it.type]} · <span className="num">{shortDate(it.createdAt)}</span>
          {terms.length && titleHit ? ' · 标题' : ''}
        </span>
      </span>
    </div>
  );
});

function BranchRow({ h, terms, onOpen }: { h: SearchHit<Development>; terms: Term[]; onOpen: (d: Development) => void }) {
  const d = h.doc.obj;
  // 正文片段：优先正文里命中的那一段，否则正文开头
  const body = h.doc.fields.find((f) => f.f === 'idea');
  const best = h.fields.find((f) => h.doc.fields[f.i].f !== 'title');
  const src = best ? h.doc.fields[best.i] : body;
  const snip = src ? snippet(src.text, terms, 40).text : '';
  return (
    <button className="sq-branch" data-dev-id={d.id} onClick={() => onOpen(d)}>
      <span className="sq-btitle">
        <TermHits text={(d.idea.title || '').replace(/^《|》$/g, '')} terms={terms} />
      </span>
      {snip && (
        <span className="sq-bbody">
          {best && src && src.f !== 'idea' ? `${FIELD_LABEL[src.f]}「` : ''}
          <TermHits text={snip} terms={terms} />
          {best && src && src.f !== 'idea' ? '」' : ''}
        </span>
      )}
      <span className="sq-meta">
        新枝 · <span className="num">{shortDate(d.createdAt)}</span>
      </span>
    </button>
  );
}
