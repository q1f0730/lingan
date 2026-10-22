import type { ReactNode } from 'react';

/** 页面大标题：Noto Serif SC Black，站在天上（带光晕），下面一句 Cormorant 斜体的低语 */
export function PageTitle({ title, whisper, aside }: { title: string; whisper: string; aside?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="whisper">{whisper}</p>
      </div>
      {aside && <div className="page-aside">{aside}</div>}
    </header>
  );
}
