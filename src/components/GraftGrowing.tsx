import type { GraftStage, RetryInfo } from '../lib/graft';

const STEPS = [
  { name: '找张力', sub: '看这几穗哪里互相拉扯' },
  { name: '撒种子', sub: '八种变形，各撒一粒' },
  { name: '换掉相像的', sub: '长得太像的，换到别处' },
  { name: '留三根', sub: '留下三根最不一样的' },
];

/** 嫁接中（m24 / d12）：四步纯文字，细体序号；完成的标「完成」，进行中的标「进行中」，没有进度条、没有百分比 */
export function GraftGrowing({ stage, retry, recheck, onCancel }: { stage: GraftStage; retry?: RetryInfo | null; recheck?: boolean; onCancel?: () => void }) {
  const still = (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset.motion === 'off';
  const active = stage === 'map' ? [0, 1] : stage === 'defix' ? [2, 3] : [];
  const doneUpTo = stage === 'map' ? -1 : stage === 'defix' ? 1 : 3;
  const line = retry
    ? `${retry.reason}，${Math.max(1, Math.ceil(retry.waitMs / 1000))} 秒后再试一次`
    : recheck
      ? '有一根说不清从哪几穗长出来，让它重长一次'
      : stage === 'map'
        ? '这几穗正在互相认识'
        : stage === 'defix'
          ? '三根新枝正在长'
          : '长好了';
  return (
    <section className="growing" role="status" aria-live="polite" data-stage={stage} data-still={still ? '1' : '0'} data-recheck={recheck ? '1' : undefined}>
      <ol className="grow-steps">
        {STEPS.map((s, i) => {
          const st = i <= doneUpTo ? 'done' : active.includes(i) ? 'on' : '';
          return (
            <li key={s.name} className={st}>
              <span className="numeral">{String(i + 1).padStart(2, '0')}</span>
              <span className="grow-step-text">
                <span className="grow-step-name">{s.name}</span>
                <span className="grow-step-sub">{s.sub}</span>
              </span>
              <span className="grow-step-state label">{st === 'done' ? '完成' : st === 'on' ? '进行中' : ''}</span>
            </li>
          );
        })}
      </ol>
      <div className="grow-line meta-text">{line}</div>
      {onCancel && stage !== 'done' && (
        <button className="btn text faint grow-cancel" onClick={onCancel}>
          先不等了
        </button>
      )}
    </section>
  );
}
