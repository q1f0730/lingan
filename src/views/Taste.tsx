import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { chat } from '../lib/ai';
import { db } from '../lib/db';
import { HeatmapPanel } from '../components/Heatmap';
import { aiReady } from '../lib/settings';
import { useApp } from '../lib/store';
import { computeTaste, tastePrompt } from '../lib/taste';
import { TYPE_LABEL, TYPE_ORDER } from '../lib/types';

const TASTE_KEY = 'lingan.taste.ai';
const TASTE_AT = 'lingan.taste.at';

export function Taste() {
  const { settings, toast, go } = useApp();
  const items = useLiveQuery(() => db.items.toArray(), []);
  const stats = useMemo(() => (items ? computeTaste(items) : null), [items]);
  const [portrait, setPortrait] = useState<string>(() => localStorage.getItem(TASTE_KEY) || '');
  const [at, setAt] = useState<string>(() => localStorage.getItem(TASTE_AT) || '');
  const [busy, setBusy] = useState(false);

  if (!items || !stats) return <div className="loading mono">冲洗中…</div>;
  const maxType = Math.max(1, ...Object.values(stats.byType));
  const maxTag = Math.max(1, ...stats.topTags.map(([, n]) => n));
  const max7 = Math.max(1, ...stats.last7);

  async function genPortrait() {
    if (!items || items.length < 3) {
      toast('至少收集 3 件素材再画像', 'err');
      return;
    }
    setBusy(true);
    try {
      const out = await chat(
        settings,
        [
          {
            role: 'system',
            content:
              '你是一个毒舌但精准的审美侧写师。根据用户的私人收藏，写出他的口味画像。不要恭维，不要泛泛而谈，不要用"独特""多元"这类空词。用中文，分四段，每段以【】小标题开头：【反复出现的母题】【你被什么击中】【你在回避什么】【盲区与下一步】。每段 2-3 句，总共不超过 320 字。',
          },
          { role: 'user', content: tastePrompt(items) },
        ],
        { temperature: 0.8, maxTokens: 900 },
      );
      const now = new Date().toLocaleString('zh-CN');
      localStorage.setItem(TASTE_KEY, out);
      localStorage.setItem(TASTE_AT, now);
      setPortrait(out);
      setAt(now);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="view">
      <header className="view-head">
        <div>
          <div className="kicker mono">PROOF SHEET · 口味画像</div>
          <h1>口味画像</h1>
        </div>
      </header>
      <div className="stat-row">
        <div className="stat">
          <div className="stat-n">{stats.total}</div>
          <div className="label mono">件素材</div>
        </div>
        <div className="stat">
          <div className="stat-n">{stats.streakDays}</div>
          <div className="label mono">天连续收集</div>
        </div>
        <div className="stat">
          <div className="stat-n">{stats.topTags.length}</div>
          <div className="label mono">个常用标签</div>
        </div>
      </div>

      <div className="panel">
        <div className="label mono">最近 7 天</div>
        <div className="bars7">
          {stats.last7.map((n, i) => (
            <div key={i} className="bar7" title={`${n} 件`}>
              <div className="bar7-fill" style={{ height: `${(n / max7) * 100}%` }} />
            </div>
          ))}
        </div>
      </div>

      <HeatmapPanel items={items} />

      <div className="panel">
        <div className="label mono">素材构成</div>
        {TYPE_ORDER.map((t) => (
          <div key={t} className="hbar">
            <span className="hbar-k">{TYPE_LABEL[t]}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${(stats.byType[t] / maxType) * 100}%` }} />
            </span>
            <span className="mono">{stats.byType[t]}</span>
          </div>
        ))}
      </div>

      {stats.topTags.length > 0 && (
        <div className="panel">
          <div className="label mono">母题（标签）</div>
          <div className="tag-weights">
            {stats.topTags.map(([t, n]) => (
              <span key={t} style={{ fontSize: `${0.85 + (n / maxTag) * 1.1}rem` }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {(stats.topCreators.length > 0 || stats.decades.length > 0 || stats.whyWords.length > 0) && (
        <div className="panel grid2">
          {stats.topCreators.length > 0 && (
            <div>
              <div className="label mono">常客</div>
              <ol className="plain">
                {stats.topCreators.map(([c, n]) => (
                  <li key={c}>
                    {c} <span className="mono dim">×{n}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {stats.decades.length > 0 && (
            <div>
              <div className="label mono">年代</div>
              <ol className="plain">
                {stats.decades.map(([d, n]) => (
                  <li key={d}>
                    {d} <span className="mono dim">×{n}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {stats.whyWords.length > 0 && (
            <div>
              <div className="label mono">「为什么」里的高频词</div>
              <div className="tags">
                {stats.whyWords.map(([w, n]) => (
                  <span key={w} className="tag">
                    {w} <span className="dim mono">{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="panel portrait">
        <div className="label mono">AI 侧写 {at && <span className="dim">· {at}</span>}</div>
        {portrait ? <div className="portrait-text">{portrait}</div> : <p className="dim">让 AI 读一遍你的收藏，说说你到底喜欢什么。显影时也会参考这份画像。</p>}
        <div className="actions">
          {aiReady(settings) ? (
            <button className="btn primary" onClick={genPortrait} disabled={busy}>
              {busy ? '侧写中…' : portrait ? '重新侧写' : '生成侧写'}
            </button>
          ) : (
            <button className="btn" onClick={() => go('settings')}>
              先配置 AI
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
