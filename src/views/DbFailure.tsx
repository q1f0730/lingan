// v0.20 数据库打不开（升级迁移失败、存储损坏等）时的兜底页：不白屏，能导出原始数据、复制诊断信息。
// 原始导出直接用 IndexedDB 原生接口按现有版本打开（不触发升级），产出能被「导入备份」认的 JSON。
import type { Root } from 'react-dom/client';
import { useState } from 'react';
import { copyText } from '../components/ErrorBoundary';
import { collectDiagnostics } from '../lib/diagcollect';
import { saveTextFile } from '../lib/files';
import { scrub } from '../lib/errlog';

function readAll(idb: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((res, rej) => {
    if (!idb.objectStoreNames.contains(store)) return res([]);
    const q = idb.transaction(store).objectStore(store).getAll();
    q.onsuccess = () => res(q.result as unknown[]);
    q.onerror = () => rej(q.error);
  });
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

export async function rawExport(name = 'lingan'): Promise<{ app: string; version: number; exportedAt: number; raw: true; items: unknown[]; developments: unknown[]; cliches: unknown[] }> {
  const idb = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('数据库被占用'));
  });
  try {
    const items = (await readAll(idb, 'items')) as Array<Record<string, unknown>>;
    const images = (await readAll(idb, 'images')) as Array<{ id: number; blob?: Blob }>;
    const imgById = new Map(images.map((x) => [x.id, x.blob]));
    const out: unknown[] = [];
    for (const it of items) {
      const { thumb: _t, thumbW: _w, thumbH: _h, thumbTodo: _td, thumbFail: _f, hasImage: _hi, ...rest } = it;
      void _t, void _w, void _h, void _td, void _f, void _hi;
      const b = imgById.get(it.id as number);
      if (b && !(typeof rest.image === 'string' && rest.image.startsWith('data:'))) rest.image = await blobToDataUrl(b).catch(() => undefined);
      out.push(rest);
    }
    const developments = await readAll(idb, 'developments');
    const cliches = ((await readAll(idb, 'cliches')) as Array<Record<string, unknown>>).map(({ id: _id, ...c }) => (void _id, c));
    return { app: 'lingan', version: 1, exportedAt: Date.now(), raw: true, items: out, developments, cliches };
  } finally {
    idb.close();
  }
}

function DbFailure({ err }: { err: unknown }) {
  const [msg, setMsg] = useState('');
  const summary = scrub(err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 240);
  return (
    <section className="crash crash-app db-failure" role="alert">
      <p className="crash-k meta-text">数据库打不开</p>
      <h2 className="crash-title">本机穗仓读不出来</h2>
      <p className="crash-msg meta-text">先别卸载、别清数据。导出一份原始数据，再把诊断信息发给作者。</p>
      <pre className="crash-code">{summary}</pre>
      <div className="crash-actions">
        <button
          className="btn primary db-raw-export"
          onClick={async () => {
            try {
              const b = await rawExport();
              const where = await saveTextFile(`glean-raw-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b));
              if (where) setMsg(`已导出 ${b.items.length} 穗`);
            } catch (e) {
              setMsg('导出失败：' + scrub(e instanceof Error ? e.message : String(e)));
            }
          }}
        >
          导出原始数据
        </button>
        <button className="btn text crash-copy" onClick={async () => setMsg((await copyText(await collectDiagnostics())) ? '诊断信息已复制' : '复制失败')}>
          复制诊断信息
        </button>
        <button className="btn text crash-reload" onClick={() => location.reload()}>
          重新载入
        </button>
      </div>
      {msg && <p className="crash-hint meta-text">{msg}</p>}
    </section>
  );
}

export function renderDbFailure(root: Root, err: unknown) {
  root.render(<DbFailure err={err} />);
}
