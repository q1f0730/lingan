import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { startThumbJob } from './lib/thumbjob';
import { db } from './lib/db';
import { ftShared, startSearchIndex } from './lib/ftsync';

// v0.17 秒搜：先挂上增删改钩子（任何写入都会增量更新索引），再渲染
ftShared(db);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// v0.13：首屏之后在空闲时补缩略图（旧图迁移、新图入库）
startThumbJob();
// v0.17：首屏之后读入全文索引，空闲时给旧数据补索引
startSearchIndex(db);
