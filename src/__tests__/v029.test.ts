// v0.29 B2 创作产出：作品工坊（0301–0309、0314、0322、0339、0340）
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { LinganDB } from '../lib/db';
import { applyImport, BlobSink, exportGlean, planImport, readBackupFile } from '../lib/backup';
import { restoreSnapshot, snapDb, takeSnapshot } from '../lib/snapshots';
import type { Development, Item, Work } from '../lib/types';
import { ulid } from '../lib/ulid';
import { addMaterial, createWork, itemsByUids, removeMaterial, trashWork } from '../lib/workstore';
import {
  boardFrom,
  buildPlaylist,
  curveTarget,
  draftWork,
  energyOf,
  FORMS,
  FORM_ORDER,
  insertRef,
  mdBlocks,
  parseRefs,
  pendingRef,
  playlistText,
  refToken,
  refUids,
  reviewCheck,
  reviewEvidence,
  shotCheck,
  shotsFrom,
  sizeGlyph,
  skeleton,
  wordCount,
  workMarkdown,
  zoomAt,
} from '../lib/works';

const uniq = (p: string) => p + '-' + Math.random().toString(36).slice(2);
let t0 = 1730000000000;
function item(p: Partial<Item>): Item {
  t0 += 1000;
  return { type: 'text', title: '无题', tags: [], createdAt: t0, updatedAt: t0, uid: ulid(t0), ...p } as Item;
}
function dev(p: Partial<Development> & { itemIds: number[] }): Development {
  return { jump: 0, source: 'offline', createdAt: Date.now(), idea: { title: '《雨里的钢琴》', bridge: '桥', idea: '把雨声和钢琴叠在一起。', cliches: [] }, ...p } as Development;
}

describe('0303 引用：[[标题|uid]]', () => {
  const it1 = item({ title: '重庆森林 [导演剪辑|版]' });
  it('引用标题去掉 [ ] |，解析回来 uid 不变', () => {
    const tok = refToken(it1);
    expect(tok).toBe(`[[重庆森林 导演剪辑 版|${it1.uid}]]`);
    const md = `开头 ${tok} 中间 ${tok} 结尾`;
    expect(parseRefs(md).map((r) => r.uid)).toEqual([it1.uid, it1.uid]);
    expect(refUids(md)).toEqual([it1.uid]);
  });
  it('打 [[ 之后弹选择器；插入时替换掉正在打的字', () => {
    const t = '第一句。[[重庆';
    expect(pendingRef(t, t.length)).toEqual({ from: 4, q: '重庆' });
    expect(pendingRef('没有引用', 4)).toBeNull();
    expect(pendingRef('[[a]] 之后', 8)).toBeNull();
    const r = insertRef(t, t.length, refToken(it1));
    expect(r.text).toBe(`第一句。${refToken(it1)}`);
    expect(r.caret).toBe(r.text.length);
    // 没在打 [[ 时就插在光标处
    const r2 = insertRef('ab', 1, 'X');
    expect(r2).toEqual({ text: 'aXb', caret: 2 });
  });
  it('Markdown 小渲染：标题 / 引用 / 列表 / 待办 / 粗体 / 穗引用，不吐 HTML', () => {
    const b = mdBlocks(`# 标题\n\n> 引一句\n- 列表 ${refToken(it1)}\n- [x] 做完了\n\n**粗** <script>x</script>`);
    expect(b.map((x) => x.kind)).toEqual(['h1', 'quote', 'li', 'todo', 'p']);
    expect(b[2].inline.some((x) => 'ref' in x && x.ref.uid === it1.uid)).toBe(true);
    expect(b[3].done).toBe(true);
    expect(b[4].inline[0]).toEqual({ b: '粗' });
    expect(b[4].inline.map((x) => ('t' in x ? x.t : '')).join('')).toContain('<script>');
  });
  it('字数：中文按字、拉丁按词，不算标记和 uid', () => {
    expect(wordCount(`# 雨夜\n${refToken(item({ title: '晴天' }))} hello world`)).toBe(6);
  });
});

describe('0302 / 0340 / 0314 / 0307 形态与离线骨架', () => {
  const film = item({ type: 'film', title: '花样年华', creator: '王家卫', why: '旗袍和楼梯', tags: ['香港'] });
  const shot = item({ type: 'image', title: '楼梯截图', tags: ['香港'], hasImage: 1 });
  const song = item({ type: 'music', title: '梦二', creator: '梅林茂', why: '一直重复的大提琴' });
  const ctx = { title: '《楼梯上的人》', ideas: [dev({ itemIds: [] }).idea], items: [film, shot, song] };
  it('六种形态都有骨架，没有 key 也能出，提示里直接引用素材', () => {
    expect(FORM_ORDER).toHaveLength(6);
    for (const f of FORM_ORDER) {
      const md = skeleton(f, ctx);
      expect(md.length).toBeGreaterThan(40);
      expect(md).toMatch(/^# /);
      expect(FORMS[f].panels.length).toBeGreaterThan(0);
      expect(FORMS[f].todos.length).toBe(3);
      if (f !== 'playlist') expect(refUids(md).length).toBeGreaterThan(0);
    }
  });
  it('0314 短篇五格：人物 / 欲望 / 阻碍 / 转折 / 结尾意象', () => {
    const md = skeleton('story', ctx);
    expect([...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])).toEqual(['人物', '欲望', '阻碍', '转折', '结尾意象']);
    expect(md).toContain(shot.uid!); // 结尾意象取图穗
  });
  it('0307 影评：立场 / 三个论点各引一穗 / 反驳 / 结尾；骨架本身就过检查', () => {
    const md = skeleton('review', ctx);
    expect(md).toMatch(/^# 《花样年华》/);
    expect(md).toContain('旗袍和楼梯');
    const c = reviewCheck(md);
    expect(c.points).toBe(3);
    expect(c.bare).toEqual([]);
    expect(c.target).toBe(800);
    // 删掉论点二里的引用 → 被点名
    const bad = md.replace(/(## 论点二[\s\S]*?)\[\[[^\]]+\]\]/, '$1（空）');
    expect(reviewCheck(bad).bare).toEqual(['论点二']);
    expect(reviewCheck('随便写写').points).toBe(0);
  });
  it('0307 证据优先：电影本身 → 同导演 / 同标签 → 图穗', () => {
    const other = item({ type: 'text', title: '无关', tags: ['别的'] });
    const ev = reviewEvidence([other, shot, film, song], film);
    expect(ev[0]).toBe(film);
    expect(ev[1]).toBe(shot);
    expect(ev).toHaveLength(3);
  });
});

describe('0304 / 0305 分镜', () => {
  it('每穗一个镜头，图穗当参考帧、音乐穗当声音；合计 / 超出', () => {
    const a = item({ type: 'image', title: '海边', hasImage: 1 });
    const b = item({ type: 'text', title: '一句台词', why: '想哭' });
    const m = item({ type: 'music', title: '晴天', creator: '周杰伦' });
    const s = shotsFrom([a, m, b]);
    expect(s).toHaveLength(2);
    expect(s[0].frameUid).toBe(a.uid);
    expect(s[0].sound).toContain('晴天');
    expect(s[1].visual).toContain('想哭');
    expect(shotCheck(s, 60)).toEqual({ total: 10, target: 60, over: 0 });
    expect(shotCheck([...s, { ...s[0], id: 'x', sec: 55.5 }], 60).over).toBe(5.5);
    expect(sizeGlyph('特写')).toBe('特');
    expect(shotsFrom([])).toHaveLength(1);
  });
});

describe('0306 / 0322 灵感歌单', () => {
  const songs = [
    item({ type: 'music', title: '雨夜钢琴', why: '一个人安静听', tags: ['夜'] }),
    item({ type: 'music', title: '夏日摇滚', why: '跑步时燃', tags: ['夏'] }),
    item({ type: 'music', title: '中间的歌', creator: '某人' }),
    item({ type: 'music', title: '派对电子', why: '跳舞', tags: ['夏'] }),
    item({ type: 'music', title: '凌晨的海', why: '想念', tags: ['夜'] }),
    item({ type: 'music', title: '讨厌的歌', polarity: -1 }),
    item({ type: 'film', title: '不是歌' }),
  ];
  it('只用库里的音乐穗（不要反口味、不要别的类型），排成起-落-起', () => {
    const t = buildPlaylist(songs);
    expect(t).toHaveLength(5);
    const byUid = new Map(songs.map((s) => [s.uid!, s]));
    const e = t.map((x) => energyOf(byUid.get(x.uid)!));
    const low = e.indexOf(Math.min(...e));
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(e.length - 1);
    expect(e[e.length - 1]).toBe(Math.max(...e));
    expect(t[0].why).toMatch(/^开场：/);
    expect(t[t.length - 1].why).toMatch(/^收尾：/);
    expect(t.some((x) => x.why.includes('（你没写为什么收它'))).toBe(true);
    expect(curveTarget(0, 5)).toBeGreaterThan(curveTarget(2, 5));
    expect(curveTarget(4, 5)).toBeGreaterThan(curveTarget(0, 5));
  });
  it('和素材同标签 / 同歌手的先进', () => {
    const t = buildPlaylist(songs, [item({ title: '素材', tags: ['夜'] })], 2);
    expect(t.map((x) => songs.find((s) => s.uid === x.uid)!.title).sort()).toEqual(['雨夜钢琴', '凌晨的海'].sort());
  });
  it('导出文本：每行「歌名 - 歌手」，没歌手只写歌名', () => {
    const byUid = new Map(songs.map((s) => [s.uid!, s]));
    const txt = playlistText([{ uid: songs[2].uid!, why: '' }, { uid: songs[0].uid!, why: '' }, { uid: 'gone', why: '' }], byUid);
    expect(txt).toBe('中间的歌 - 某人\n雨夜钢琴');
    expect(buildPlaylist([])).toEqual([]);
  });
});

describe('0308 情绪板', () => {
  it('立项时摆一版：每穗一块、不出界；缩放围绕指针点', () => {
    const its = Array.from({ length: 9 }, (_, i) => item({ type: i % 2 ? 'image' : 'text', title: `穗${i}`, hasImage: i % 2 ? 1 : undefined }));
    const n = boardFrom(its);
    expect(n).toHaveLength(9);
    expect(n.every((x) => x.x >= 0 && x.x + x.w <= 1600 && x.kind === 'item')).toBe(true);
    const v = zoomAt({ x: 0, y: 0, k: 1 }, 100, 100, 2);
    expect(v).toEqual({ x: -100, y: -100, k: 2 });
    expect(zoomAt(v, 0, 0, 99).k).toBe(3);
  });
});

describe('0301 / 0309 立项与素材（works 表）', () => {
  it('从新枝立项：素材 = 新枝来源穗（存 uid）、骨架 / 待办 / 分镜 / 情绪板按形态生成；新枝 uid 记下', async () => {
    const d = new LinganDB(uniq('works'));
    const a = await d.items.add(item({ type: 'image', title: '雨窗', hasImage: 1 }));
    const b = await d.items.add(item({ type: 'music', title: '雨夜钢琴', why: '安静' }));
    const c = await d.items.add(item({ type: 'text', title: '一句话', why: '想起谁' }));
    const did = await d.developments.add(dev({ itemIds: [a, b, c] }));
    const id = await createWork('film', [did], d);
    const w = (await d.works.get(id))!;
    const its = (await d.items.bulkGet([a, b, c])) as Item[];
    expect(w.title).toBe('雨里的钢琴');
    expect(w.form).toBe('film');
    expect(w.stage).toBe('idea');
    expect(w.itemUids).toEqual(its.map((x) => x.uid));
    expect(w.devUids).toEqual([(await d.developments.get(did))!.uid]);
    expect(w.shots!.length).toBe(2);
    expect(w.shots![0].frameUid).toBe(its[0].uid);
    expect(w.board!.nodes).toHaveLength(3);
    expect(w.todos).toHaveLength(3);
    expect(w.uid).toMatch(/^[0-9A-Z]{26}$/);
    expect(w.deviceId).toBeTruthy();
    // 0309 加 / 删素材，不重复
    const extra = await d.items.add(item({ title: '后来加的' }));
    const eu = (await d.items.get(extra))!.uid!;
    expect(await addMaterial(id, eu, d)).toBe(true);
    expect(await addMaterial(id, eu, d)).toBe(false);
    expect((await d.works.get(id))!.itemUids).toHaveLength(4);
    await removeMaterial(id, its[1].uid!, d);
    expect((await d.works.get(id))!.itemUids).not.toContain(its[1].uid);
    // 素材穗进回收站后不再出现在素材里
    await d.items.update(c, { deletedAt: Date.now() });
    expect((await itemsByUids((await d.works.get(id))!.itemUids, d)).map((x) => x.title)).toEqual(['雨窗', '后来加的']);
    // 歌单形态：只排库里的音乐穗
    const pid = await createWork('playlist', [did], d);
    expect((await d.works.get(pid))!.tracks!.map((t) => t.uid)).toEqual([its[1].uid]);
    // 空白作品
    const bid = await createWork('review', [], d);
    expect((await d.works.get(bid))!.itemUids).toEqual([]);
    await trashWork(bid, d);
    expect((await d.works.get(bid))!.deletedAt).toBeGreaterThan(0);
  });

  it('0339 Markdown：引用变《标题》[n]，文末溯源；分镜表、歌单、待办都在', () => {
    const film = item({ type: 'film', title: '花样年华', creator: '王家卫', year: '2000', url: 'https://movie.douban.com/subject/1291557/' });
    const song = item({ type: 'music', title: '梦二', creator: '梅林茂' });
    const w = draftWork('film', [dev({ itemIds: [] })], [film, song]);
    w.draft = `# 楼梯\n\n他走下 ${refToken(film)}，又是 ${refToken(film)}。`;
    w.tracks = [{ uid: song.uid!, why: '开场：大提琴' }];
    const md = workMarkdown(w, new Map([film, song].map((x) => [x.uid!, x])), ['《雨里的钢琴》']);
    expect(md).toContain('他走下 《花样年华》[1]，又是 《花样年华》[1]。');
    expect(md).toContain('## 分镜');
    expect(md).toContain('| 1 |');
    expect(md).toContain('1. 《梦二》 - 梅林茂 —— 开场：大提琴');
    expect(md).toContain('- [ ] 定下目标时长');
    expect(md).toMatch(/## 溯源\n\n1\. 《花样年华》 · 电影 · 王家卫 · 2000 · https:\/\/movie\.douban\.com/);
    expect(md).toContain('来自新枝：《雨里的钢琴》');
    expect(md).toContain('Q1f730');
    expect(md).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/); // 不把 uid 漏进去
  });
});

describe('作品进备份 / 快照', () => {
  it('.glean 导出再导入：作品原样回来（uid 引用不断），旧版读到不认识的行只是跳过', async () => {
    const d = new LinganDB(uniq('wbk'));
    const a = await d.items.add(item({ type: 'film', title: '一一', why: '小孩拍后脑勺' }));
    const did = await d.developments.add(dev({ itemIds: [a] }));
    const id = await createWork('review', [did], d);
    await d.works.update(id, { stage: 'doing' });
    const sink = new BlobSink();
    const st = await exportGlean(sink, d);
    expect(st.items).toBe(1);
    const inc = await readBackupFile(sink.blob());
    expect(inc.works).toHaveLength(1);
    const d2 = new LinganDB(uniq('wbk2'));
    await applyImport(inc, await planImport(inc, d2, 'merge'), d2);
    const [w2] = await d2.works.toArray();
    const w1 = (await d.works.get(id))!;
    expect(w2.uid).toBe(w1.uid);
    expect(w2.stage).toBe('doing');
    expect(w2.draft).toBe(w1.draft);
    expect((await itemsByUids(w2.itemUids, d2)).map((x) => x.title)).toEqual(['一一']);
    // 再导一次不重复；本机改得更新的不被旧备份覆盖
    await d2.works.update(w2.id!, { title: '本机改过', updatedAt: Date.now() + 10000 });
    await applyImport(inc, await planImport(inc, d2, 'merge'), d2);
    expect(await d2.works.count()).toBe(1);
    expect((await d2.works.toArray())[0].title).toBe('本机改过');
    // 替换：备份为准
    await applyImport(inc, await planImport(inc, d2, 'replace'), d2);
    expect((await d2.works.toArray())[0].title).toBe(w1.title);
  });

  it('操作前快照带上作品，恢复时作品也回到那一刻；旧快照（没有作品）恢复时不动作品', async () => {
    const d = new LinganDB(uniq('wsnap'));
    const s = snapDb(uniq('wsnap-s'));
    const id = await createWork('story', [], d, { title: '快照前' });
    const snap = await takeSnapshot('测试', d, { s });
    await d.works.update(id, { title: '快照后' });
    await d.works.add({ ...(await d.works.get(id))!, id: undefined, uid: undefined, title: '新的' } as Work);
    await restoreSnapshot(snap, d, { s });
    expect((await d.works.toArray()).map((w) => w.title)).toEqual(['快照前']);
    // 模拟 v0.28 拍的旧快照：没有 works 字段
    const old = await s.snaps.get(snap);
    delete old!.works;
    const oldId = await s.snaps.add({ ...old!, id: undefined });
    await d.works.update(id, { title: '现在' });
    await restoreSnapshot(oldId, d, { s });
    expect((await d.works.get(id))!.title).toBe('现在');
  });
});
