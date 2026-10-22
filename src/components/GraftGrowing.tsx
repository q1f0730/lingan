import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../lib/ascii';
import type { GraftStage, RetryInfo } from '../lib/graft';
import { growFrame, stageProgress } from '../lib/growing';

const STEPS = [
  { name: '找张力', sub: '看这几穗哪里互相拉扯' },
  { name: '撒八粒种子', sub: '八种变形，各撒一粒' },
  { name: '换掉相像的', sub: '长得太像的三粒，换到别处' },
  { name: '留三根', sub: '留下三根最不一样的' },
];

/** 嫁接时：三根麦子慢慢长高，四步依次亮起。减少动态效果时只给一帧静图。 */
export function GraftGrowing({ stage, retry, onCancel }: { stage: GraftStage; retry?: RetryInfo | null; onCancel?: () => void }) {
  const still = prefersReducedMotion() || document.documentElement.dataset.motion === 'off';
  const t0 = useRef({ stage, at: performance.now() });
  const [tick, setTick] = useState(0);
  if (t0.current.stage !== stage) t0.current = { stage, at: performance.now() };

  useEffect(() => {
    if (still) return;
    const lite = document.documentElement.dataset.motion === 'lite';
    const t = setInterval(() => setTick((n) => n + 1), lite ? 520 : 300);
    return () => clearInterval(t);
  }, [still]);

  const p = still ? (stage === 'map' ? 0.45 : stage === 'defix' ? 0.85 : 1) : stageProgress(stage, performance.now() - t0.current.at);
  const active = stage === 'map' ? [0, 1] : stage === 'defix' ? [2, 3] : [];
  const doneUpTo = stage === 'map' ? -1 : stage === 'defix' ? 1 : 3;
  const line = retry
    ? `${retry.reason}，${Math.max(1, Math.ceil(retry.waitMs / 1000))} 秒后再试一次`
    : stage === 'map'
      ? '这几穗正在互相认识'
      : stage === 'defix'
        ? '三根麦子在抽穗'
        : '长好了';

  return (
    <div className="paper growing" role="status" aria-live="polite" data-stage={stage} data-still={still ? '1' : '0'}>
      <pre className="grow-wheat" aria-hidden>
        {growFrame(p, tick, still)}
      </pre>
      <div className="grow-line">
        {line}
        {!still && stage !== 'done' && <span className="grow-dots" aria-hidden>{'·'.repeat((tick % 3) + 1)}</span>}
      </div>
      <ol className="grow-steps">
        {STEPS.map((s, i) => (
          <li key={s.name} className={i <= doneUpTo ? 'done' : active.includes(i) ? 'on' : ''}>
            <span className="grow-step-n">{i <= doneUpTo ? '✓' : i + 1}</span>
            <span className="grow-step-name">{s.name}</span>
            <span className="grow-step-sub">{s.sub}</span>
          </li>
        ))}
      </ol>
      {onCancel && stage !== 'done' && (
        <button className="link grow-cancel" onClick={onCancel}>
          先不等了
        </button>
      )}
    </div>
  );
}
