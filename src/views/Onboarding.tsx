import { useState } from 'react';
import { addItem } from '../lib/db';
import { ONBOARD_KEY } from '../lib/onboard';
import { parseQuick } from '../lib/quick';
import { TYPE_LABEL, type ItemType } from '../lib/types';
import { PRESETS, withPreset } from '../lib/settings';
import { useApp } from '../lib/store';

/** 0404 试试这样写：顺便教 v0.28 的行内语法（《片名》 @作者 > 为什么） */
const EXAMPLES = ['《重庆森林》 @王家卫 > 雨夜里的霓虹', '想做一个只在下雨天更新的网站 #点子'];

const PROMISES: Array<[string, string]> = [
  ['只读你拾的穗', '不联网搜、不拿别人的收藏凑数。'],
  ['每根新枝都写明出处', '下面列「因为这几穗」，点一下回到原穗。'],
  ['证据不够就直说', '说不清从哪几穗长出来的，标「证据不足」。'],
  ['素材留在本机', '只有嫁接那一刻，选中的几穗会发给你选的 AI 服务。'],
];

/** 引导（m05–m07）：三屏，三段线进度；第三屏选 AI 服务（实心 / 空心方块）、内联填 key，也可以先不用 AI */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const { settings, setSettings } = useApp();
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<string | null>(null);
  const [key, setKey] = useState('');
  // v0.28 0404 第一屏就真的拾第一穗（可不拾，直接「开始」）
  const [first, setFirst] = useState('');
  const [got, setGot] = useState<{ type: ItemType; title: string; creator?: string; why?: string; tags: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const guess = first.trim() ? parseQuick(first) : null;
  async function pickFirst() {
    const d = parseQuick(first);
    if (!d || busy) return;
    setBusy(true);
    try {
      await addItem(d);
      setGot({ type: d.type, title: d.title, creator: d.creator, why: d.why, tags: d.tags });
      setFirst('');
    } catch {
      /* 写不进也不拦着引导：进穗仓后照常能拾 */
    } finally {
      setBusy(false);
    }
  }
  const finish = (useAI: boolean) => {
    if (useAI && preset) {
      const s = withPreset(settings, preset);
      setSettings({ ...s, chat: { ...s.chat, apiKey: key.trim() } });
    }
    localStorage.setItem(ONBOARD_KEY, '1');
    onDone();
  };
  return (
    <div className="onboard" data-step={step}>
      <header className="onboard-top">
        {step > 0 ? (
          <button className="btn text" onClick={() => setStep(step - 1)}>
            返回
          </button>
        ) : (
          <span className="logo"><span className="logo-mark" aria-hidden>拾</span><span className="logo-text">拾穗 <span className="logo-en">GLEAN</span></span></span>
        )}
        <button className="btn text faint onboard-skip" onClick={() => finish(false)}>
          跳过
        </button>
      </header>
      <main className="onboard-main">
        <div className="label">0{step + 1} / 03</div>
        {step === 0 && (
          <>
            <h1 className="page-title">拾穗</h1>
            <p className="lead">把零碎的喜欢拾起来，让它们自己长出新东西。</p>
            <p className="meta-text">照片、电影、歌、摘抄、链接、一闪而过的想法，都可以一穗一穗拾进来。拾够了，让它们嫁接出新枝。</p>
            {got ? (
              <div className="onboard-first-card" role="status">
                <div className="label">第 1 穗 · 已拾进穗仓</div>
                <p className="onboard-first-title">
                  <span className="chip on">{TYPE_LABEL[got.type]}</span> {got.title}
                  {got.creator ? <span className="dim"> — {got.creator}</span> : null}
                </p>
                {got.why ? <p className="meta-text">为什么：{got.why}</p> : null}
                {got.tags.length ? <p className="meta-text">{got.tags.map((x) => '#' + x).join(' ')}</p> : null}
                <p className="meta-text">就这么简单：打一句，回车。以后在底栏 / 顶栏的速记条里随手拾。</p>
              </div>
            ) : (
              <div className="onboard-first">
                <div className="label">现在就拾第一穗</div>
                <form
                  className="onboard-first-row"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void pickFirst();
                  }}
                >
                  <input className="line-input onboard-first-input" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="一句话、片名、链接都行，回车就存" aria-label="拾第一穗" enterKeyHint="done" maxLength={500} />
                  <button className="btn primary onboard-first-save" disabled={!guess || busy}>
                    拾
                  </button>
                </form>
                {guess ? (
                  <p className="meta-text onboard-first-guess">
                    会存成「{TYPE_LABEL[guess.type]}」{guess.creator ? ` · 作者 ${guess.creator}` : ''}
                    {guess.why ? ' · 带一句为什么' : ''}
                  </p>
                ) : (
                  <div className="chips onboard-first-eg">
                    {EXAMPLES.map((x) => (
                      <button key={x} className="chip" onClick={() => setFirst(x)}>
                        {x}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <h1 className="page-title">AI 只用你的素材</h1>
            <ol className="promise-list">
              {PROMISES.map(([t, d], i) => (
                <li key={t}>
                  <span className="numeral">0{i + 1}</span>
                  <span>
                    <b>{t}</b>
                    <span className="meta-text">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="page-title">选一个 AI 服务</h1>
            <p className="meta-text">嫁接时用。key 只存在这台手机 / 电脑上，随时能在设置里换。</p>
            <div className="radio-list" role="radiogroup" aria-label="AI 服务">
              {PRESETS.map((p) => (
                <div key={p.id} className="radio-item">
                  <button role="radio" aria-checked={preset === p.id} className={`radio chip${preset === p.id ? ' on' : ''}`} onClick={() => setPreset(p.id)}>
                    <i className="sq" aria-hidden />
                    <span className="radio-name">{p.name}</span>
                  </button>
                  <p className="meta-text radio-note">{p.note}</p>
                  {preset === p.id && p.id !== 'custom' && p.id !== 'local' && (
                    <input className="line-input" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="粘贴 API key" aria-label="API key" autoComplete="off" />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
      <footer className="onboard-foot">
        {step < 2 ? (
          <button className="btn primary block onboard-next" onClick={() => setStep(step + 1)}>
            {step === 0 ? (got ? '下一步' : '开始') : '知道了'}
          </button>
        ) : (
          <>
            <button className="btn primary block onboard-done" onClick={() => finish(true)}>
              进入穗仓
            </button>
            <button className="btn text faint onboard-noai" onClick={() => finish(false)}>
              先不用 AI，只收集
            </button>
          </>
        )}
        <div className="onboard-dots" aria-hidden>
          {[0, 1, 2].map((i) => (
            <i key={i} className={i === step ? 'on' : ''} />
          ))}
        </div>
        <div className="colophon">© 2026 Q1f730</div>
      </footer>
    </div>
  );
}
