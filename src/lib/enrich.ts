import { caption, embed } from './ai';
import { db, normalizeTags } from './db';
import { getOriginalDataUrl, itemHasImage } from './imagestore';
import { itemText } from './similarity';
import { aiReady, embedConfig, type Settings } from './settings';
import { aiVisible } from './privacy';

/** Background AI enrichment for one item. Returns a human-readable error or null. */
export async function enrichItem(id: number, s: Settings, force = false): Promise<string | null> {
  const it = await db.items.get(id);
  if (!it) return null;
  // v0.24 0242 私密穗：不发给云端的看图 / 向量（本地模型且设置里允许时才发）
  const seeChat = aiVisible(it, s);
  const ecv = embedConfig(s);
  const seeEmbed = !!ecv && aiVisible(it, s, ecv.baseUrl);
  const errs: string[] = [];
  if (seeChat && itemHasImage(it) && s.autoCaption && aiReady(s) && s.chat.visionModel && (force || !it.caption)) {
    try {
      const img = await getOriginalDataUrl(db, id);
      if (!img) throw new Error('原图不见了');
      // v0.23 0110：只从你已有的标签词汇里选；新词放进 tagSugg，要你点头才加
      const vocab = (await db.items.orderBy('tags').uniqueKeys()) as string[];
      const wallKeys = (await db.cliches.toArray()).filter((c) => !c.struck).map((c) => c.key);
      const cap = await caption(s, img, vocab);
      const m = cap.match(/标签[:：]\s*(.+)$/m);
      const extraTags = m ? normalizeTags(m[1]) : [];
      const { known, fresh } = (await import('./organize')).splitSuggested(extraTags, vocab, wallKeys);
      const capText = cap.replace(/标签[:：].*$/m, '').trim();
      const sugg = fresh.filter((t) => !it.tags.includes(t));
      await db.items.update(id, { caption: capText, tags: normalizeTags([...it.tags, ...known]), ...(sugg.length ? { tagSugg: sugg } : {}) });
    } catch (e) {
      errs.push('看图：' + (e instanceof Error ? e.message : String(e)));
    }
  }
  const ec = embedConfig(s);
  if (ec && s.autoEmbed && seeEmbed) {
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
  const all = (await db.items.toArray()).filter((x) => !x.deletedAt && aiVisible(x, s, ec.baseUrl));
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
