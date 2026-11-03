import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/rewamp.css';
import App, { prefetchViews } from './App';
import { startThumbJob } from './lib/thumbjob';
import { db, ensureUids, purgeExpired } from './lib/db';
import { ftShared, startSearchIndex } from './lib/ftsync';
import { afterFirstPaint } from './lib/motion';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installGlobalErrorHandlers, isSafeMode, logError, setSecretProvider } from './lib/errlog';
import { initSecrets, loadSettings } from './lib/settings';
import { collectDiagnostics } from './lib/diagcollect';

// v0.20：全局错误先挂上（之后任何未捕获的错误 / Promise 拒绝都进本地日志），日志脱敏认得当前密钥
installGlobalErrorHandlers();
setSecretProvider(() => {
  const s = loadSettings();
  return [s.chat.apiKey, s.embed.apiKey].filter(Boolean);
});
const safe = isSafeMode();
if (safe) document.documentElement.dataset.safe = '1';

// v0.17 秒搜：先挂上增删改钩子（任何写入都会增量更新索引），再渲染
ftShared(db);

const root = createRoot(document.getElementById('root')!);

function start() {
  root.render(
    <StrictMode>
      <ErrorBoundary scope="app" name="app" copyDiag={collectDiagnostics}>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  // v0.20 数据库打不开（迁移失败等）：不白屏，换成能导出原始数据的兜底页
  db.open().catch(async (e) => {
    logError(e, 'error', { view: 'db.open' });
    const { renderDbFailure } = await import('./views/DbFailure');
    renderDbFailure(root, e);
  });
  if (safe) return; // 安全模式：不跑后台任务，不预取
  // v0.13：首屏之后在空闲时补缩略图（旧图迁移、新图入库）
  startThumbJob();
  // v0.17：首屏之后读入全文索引，空闲时给旧数据补索引
  startSearchIndex(db);
  // v0.21：空闲时给没有 uid 的行补上（直接写库的、极旧备份），回收站里超过 30 天的彻底清掉
  void afterFirstPaint(3000).then(async () => {
    await ensureUids(db).catch((e) => logError(e, 'error', { view: 'ensureUids' }));
    await purgeExpired(db).catch((e) => logError(e, 'error', { view: 'purgeExpired' }));
  });
  // v0.20：其余四页的包在穗仓首屏画完之后预取
  void afterFirstPaint(2500).then(prefetchViews);
  // v0.20：申请持久存储（浏览器 / WebView 在空间紧张时不清本库）
  void afterFirstPaint(4000).then(() => navigator.storage?.persist?.().catch(() => false));
}

// v0.20：AI 密钥从系统钥匙串读进内存（旧版 localStorage 里的 key 首次启动时搬过去并清掉），再渲染
initSecrets()
  .catch((e) => logError(e, 'error', { view: 'vault' }))
  .finally(start);
