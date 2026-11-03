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
import { guardUpgrade, markSchema } from './lib/upgradeguard';
import { PENDING_KEY } from './lib/safewrite';
import { isTauriEnv } from './lib/desktop';
import { primeLibraryItems } from './lib/libitems';

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
  // v0.30：穗仓的全部穗在渲染之前就开查（读库和画外壳并行，Library 接同一个订阅）。安全模式也一样（首屏就是穗仓）。
  // 试过「结果 300ms 内到就等它再画、第一帧直接带卡片」：同会话交替测按「带卡片那一帧真正画完」算，卡片普通快 ~17ms、
  // 4× 降速不快，但首次绘制普通晚 ~60ms、4× 晚 ~190ms（白屏更久），所以不等，外壳照常先画
  primeLibraryItems();
  boot();
}

function boot() {
  root.render(
    <StrictMode>
      <ErrorBoundary scope="app" name="app" copyDiag={collectDiagnostics}>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  // v0.20 数据库打不开（迁移失败等）：不白屏，换成能导出原始数据的兜底页
  db.open().then(() => markSchema(db.verno), async (e) => {
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
  // v0.26 0605：上次有写不进库的穗暂存着 → 空闲时补进去（没有暂存就不加载、不碰库）
  if (localStorage.getItem(PENDING_KEY))
    void afterFirstPaint(3500).then(async () => {
      const { replayPendingWrites } = await import('./lib/db');
      const r = await replayPendingWrites(db).catch((e) => (logError(e, 'error', { view: 'replayPending' }), null));
      if (r?.done) window.dispatchEvent(new CustomEvent('glean:replayed', { detail: r }));
    });
  // v0.26 0606 / 0508：桌面与安卓每天一次自动备份（库没变就跳过），启动 20 秒后空闲时才加载
  if (isTauriEnv())
    void afterFirstPaint(3000)
      .then(() => new Promise((r) => setTimeout(r, 20000)))
      .then(() => import('./lib/autobackup').then((m) => m.autoBackupTick(__APP_VERSION__)).catch((e) => logError(e, 'error', { view: 'autobackup' })));
  // v0.31：开着同步才加载同步引擎（启动 6 秒后、空闲时），否则首屏和后台都不碰它
  // v0.32：局域网直连（glean.lan.v1）同理：电脑开柜子、手机定时找电脑
  if (localStorage.getItem('glean.sync.v1') || localStorage.getItem('glean.lan.v1'))
    void afterFirstPaint(3000)
      .then(() => new Promise((r) => setTimeout(r, 6000)))
      .then(() =>
        import('./lib/sync').then((m) => {
          if (localStorage.getItem('glean.sync.v1')) m.startAutoSync(__APP_VERSION__);
          m.startLanAuto(__APP_VERSION__);
        }),
      )
      .catch((e) => logError(e, 'error', { view: 'sync' }));
  // v0.20：其余四页的包在穗仓首屏画完之后预取
  void afterFirstPaint(2500).then(prefetchViews);
  // v0.20：申请持久存储（浏览器 / WebView 在空间紧张时不清本库）
  void afterFirstPaint(4000).then(() => navigator.storage?.persist?.().catch(() => false));
}

// v0.20：AI 密钥从系统钥匙串读进内存（旧版 localStorage 里的 key 首次启动时搬过去并清掉），再渲染
initSecrets()
  .catch((e) => logError(e, 'error', { view: 'vault' }))
  // v0.26 0624：库要升级时先存一份原始库（平常启动直接跳过，不碰 IndexedDB）
  .finally(() => guardUpgrade('lingan', db.verno, __APP_VERSION__).finally(start));
