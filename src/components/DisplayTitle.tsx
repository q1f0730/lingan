import type { ReactNode } from 'react';

/** 超大标题 + 真实计数：「穗仓 (10)」。计数与标题同字号同字重、不变灰。aside 放网格 | 列表这类文字切换 */
export function DisplayTitle({ title, count, aside, extra, sub }: { title: string; count?: number; aside?: ReactNode; extra?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-main">
        <h1 className="page-title">
          {title}
          {typeof count === 'number' && (
            <>
              {' '}
              <span className="count num">({count})</span>
            </>
          )}
        </h1>
        {sub && <p className="page-sub">{sub}</p>}
        {extra}
      </div>
      {aside && <div className="page-aside">{aside}</div>}
    </header>
  );
}

/** 读库时的占位：只有一行小字，不闪骨架 */
export function Loading({ text = '读取中' }: { text?: string }) {
  return (
    <div className="loading label" role="status">
      {text}
    </div>
  );
}
