import type { ReactNode } from 'react';

/** 页面标题 + 真实计数：「穗仓 (10)」，计数用浅一档的颜色。aside 放 网格 / 列表 这类分段切换 */
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

/** 读库时的占位：Rewamp「Skeleton」移植——几块圆角浅底，上面一道很淡的流光（减少动态效果时不扫） */
export function Loading({ text = '读取中' }: { text?: string }) {
  return (
    <div className="loading" role="status" aria-label={text}>
      <span className="sk sk-title" />
      <span className="sk sk-line" />
      <span className="sk-grid" aria-hidden>
        <span className="sk sk-card" />
        <span className="sk sk-card" />
        <span className="sk sk-card" />
      </span>
    </div>
  );
}
