import { caption, embed } from './ai';
import { db, normalizeTags } from './db';
import { itemText } from './similarity';
import { aiReady, embedConfig, type Settings } from './settings';

/** Background AI enrichment for one item. Returns a human-readable error or null. */
export async function enrichItem(id: number, s: Settings, force = false): Promise<string | null> {
  const it = await db.items.get(id);
  if (!it) return null;
  const errs: string[] = [];
  if (it.image && s.autoCaption && aiReady(s) && s.chat.visionModel && (force || !it.caption)) {
    try {
      const cap = await caption(s, it.image);
      const m = cap.match(/标签[:：]\s*(.+)$/m);
      const extraTags = m ? normalizeTags(m[1]) : [];
      const capText = cap.replace(/标签[:：].*$/m, '').trim();
      await db.items.update(id, { caption: capText, tags: normalizeTags([...it.tags, ...extraTags]) });
    } catch (e) {
      errs.push('看图：' + (e instanceof Error ? e.message : String(e)));
    }
  }
  const ec = embedConfig(s);
  if (ec && s.autoEmbed) {
    const fresh = await db.items.get(id);
    if (fresh && (force || !fresh.embedding || fresh.embedModel !== ec.model)) {
      try {
        const [v] = await embed(s, [itemText(fresh).slice(0, 2000) || fresh.title]);
        await db.items.update(id, { embedding: v, embedModel: ec.model });
      } catch (e) {
        errs.push('向量：' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }
  return errs.length ? errs.join('；') : null;
}

export async function embedAllMissing(s: Settings, onProgress?: (done: number, total: number) => void): Promise<{ done: number; failed: number; error?: string }> {
  const ec = embedConfig(s);
  if (!ec) return { done: 0, failed: 0, error: '没有配置向量模型' };
  const all = await db.items.toArray();
  const todo = all.filter((i) => !i.embedding || i.embedModel !== ec.model);
  let done = 0, failed = 0, error: string | undefined;
  for (let k = 0; k < todo.length; k += 16) {
    const batch = todo.slice(k, k + 16);
    try {
      const vecs = await embed(s, batch.map((b) => itemText(b).slice(0, 2000) || b.title));
      await db.transaction('rw', db.items, async () => {
        for (let j = 0; j < batch.length; j++) await db.items.update(batch[j].id!, { embedding: vecs[j], embedModel: ec.model });
      });
      done += batch.length;
    } catch (e) {
      failed += batch.length;
      error = e instanceof Error ? e.message : String(e);
      break;
    }
    onProgress?.(done, todo.length);
  }
  return { done, failed, error };
}
