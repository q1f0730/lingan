import { useState } from 'react';
import { db } from '../lib/db';
import { PRESETS, withPreset } from '../lib/settings';
import { useApp } from '../lib/store';

const KEY = 'glean.onboarded';

/** 只有第一次打开、穗仓还是空的时候才走引导；老用户升级、已有穗的直接进穗仓 */
export async function needsOnboarding(): Promise<boolean> {
  try {
    if (localStorage.getItem(KEY)) return false;
    const n = await db.items.count();
    if (n > 0 || localStorage.getItem('lingan.settings.v1')) {
      localStorage.setItem(KEY, '1');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

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
  const finish = (useAI: boolean) => {
    if (useAI && preset) {
      const s = withPreset(settings, preset);
      setSettings({ ...s, chat: { ...s.chat, apiKey: key.trim() } });
    }
    localStorage.setItem(KEY, '1');
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
          <span className="logo">拾穗 · GLEAN</span>
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
                  {preset === p.id && p.id !== 'custom' && (
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
            {step === 0 ? '开始' : '知道了'}
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
