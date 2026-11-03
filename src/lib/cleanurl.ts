/**
 * v0.28 0023 规范链接：剥掉分享 / 追踪参数（utm_*、spm_id_from、share_source、xsec_token、si …），
 * 同一篇东西换个人分享也是同一条链接（去重、显示都干净）。只删认得的参数，内容参数（id、t、p、songmid…）不碰；
 * 有歧义的参数（from、key、lang…）只在对应的站上删。
 * 0019 各平台「口令」文案（抖音复制口令、淘宝口令、小红书分享文案…）：抽出真实链接和标题，扔掉套话。
 */

/** 到处都是追踪用的（加上所有 utm_*） */
const DROP = new Set([
  'spm', 'spm_id_from', 'from_spmid', 'share_source', 'share_medium', 'share_plat', 'share_session_id', 'share_from', 'share_tag', 'share_times', 'share_token',
  'vd_source', 'unique_k', 'xsec_token', 'xsec_source', 'xhsshare', 'appuid', 'apptime',
  'igshid', 'igsh', 'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok', 'ref_src',
]);
/** 只在这些站上删的（换个站可能是内容参数，所以不全局删） */
const DROP_ON: Array<[RegExp, string[]]> = [
  [/(^|\.)bilibili\.com$|^b23\.tv$/, ['bbid', 'ts', 'buvid', 'is_story_h5', 'mid', 'plat_id', 'up_id', 'timestamp', 'share_id', 'seid', 'from_source', 'msource', 'from']],
  [/(^|\.)xiaohongshu\.com$/, ['author_share', 'share_red_id', 'exSource', 'shareRedId', 'share_id', 'type']],
  [/(^|\.)youtube\.com$|^youtu\.be$|(^|\.)spotify\.com$/, ['si', 'feature', 'pp']],
  [/(^|\.)163\.com$|^163cn\.tv$/, ['userid', 'app_version', 'dlt', 'uct', 'uct2', 'sc_tm']],
  [/(^|\.)douyin\.com$|(^|\.)iesdouyin\.com$/, ['u_code', 'did', 'iid', 'with_sec_did', 'sec_uid', 'timestamp', 'region', 'share_sign', 'share_version', 'tt_from', 'ts', 'from_ssr', 'previous_page', 'enter_from']],
  [/^mp\.weixin\.qq\.com$/, ['chksm', 'scene', 'sharer_shareinfo', 'sharer_shareinfo_first', 'sharer_sharetime', 'sharer_shareid', 'clicktime', 'enterid', 'subscene', 'sessionid', 'ascene', 'devicetype', 'version', 'nettype', 'lang', 'pass_ticket', 'wx_header', 'exportkey', 'key', 'abtest_cookie', 'poc_token', 'from', 'isappinstalled']],
  [/(^|\.)taobao\.com$|(^|\.)tmall\.com$|^m\.tb\.cn$/, ['sourceType', 'suid', 'ut_sk', 'un', 'share_crt_v', 'sp_tk', 'cpp', 'shareurl', 'short_name', 'bxsign', 'tbSocialPopKey', 'app', 'tk', 'price', 'bc_fl_src', 'ttid']],
  [/(^|\.)zhihu\.com$/, ['share_code', 'utm_psn', 'utm_oi']],
  [/(^|\.)weibo\.(com|cn)$/, ['from', 'wm', 'sourcetype']],
  [/(^|\.)douban\.com$/, ['_dtcc', '_i', 'dt_dapp', 'dt_platform', 'from']],
];

export function cleanUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (!/^https?:$/.test(u.protocol)) return raw;
  const host = u.host.toLowerCase().replace(/^www\./, '');
  const extra = new Set(DROP_ON.filter(([re]) => re.test(host)).flatMap(([, v]) => v));
  const names = [...new Set([...u.searchParams.keys()])];
  let changed = false;
  for (const n of names) {
    if (/^utm_/i.test(n) || DROP.has(n) || extra.has(n)) {
      u.searchParams.delete(n);
      changed = true;
    }
  }
  // 微信文章：#rd / #wechat_redirect 之类的锚点没用
  if (/^#(rd|wechat_redirect)$/.test(u.hash)) {
    u.hash = '';
    changed = true;
  }
  if (!changed) return raw;
  let out = u.toString();
  if (!u.search) out = out.replace(/\?(?=#|$)/, '');
  return out;
}

export interface ShareCode {
  url: string;
  title: string;
  source?: string;
}

const APP_OF: Array<[RegExp, string]> = [
  [/douyin\.com|iesdouyin\.com/, '抖音'],
  [/xhslink\.com|xiaohongshu\.com/, '小红书'],
  [/m\.tb\.cn|taobao\.com|tmall\.com/, '淘宝'],
  [/b23\.tv|bilibili\.com/, '哔哩哔哩'],
  [/163cn\.tv|music\.163\.com/, '网易云音乐'],
  [/kuaishou\.com|v\.kuaishou/, '快手'],
  [/weibo\.(com|cn)/, '微博'],
  [/zhihu\.com/, '知乎'],
  [/douban\.com/, '豆瓣'],
];

/** 口令套话：这些字整段扔掉 */
const BOILER = [
  /复制打开抖音[，,]?\s*看看/g,
  /复制此链接[，,]?\s*打开(?:Dou音|抖音)搜索[，,]?\s*直接观看视频！?/g,
  /复制本条信息[，,]?\s*打开【?小红书】?\s*App\s*查看精彩内容！?/gi,
  /复制后打开【?淘宝】?\s*(?:App)?|点击链接直接打开|打开【?手机淘宝】?|手机淘宝|淘宝App/gi,
  /【淘宝】|【天猫】|【小红书】|【抖音】/g,
  /\d+\s*%?\s*\$?[A-Za-z0-9]{8,}\$?\s*(?=$|\s)/g, // 淘宝口令码 / 抖音码
  /[￥€$][A-Za-z0-9]{6,}[￥€$]/g,
  /[A-Za-z]{2,5}:\/\s*\d{1,2}\/\d{1,2}/g, // 抖音结尾的 xyz:/ 01/12
  /(?:^|\s)[\d.]{2,6}\s+(?=\S)/g, // 开头的 7.94
  /\b(?:CZ|MF|HU|ZH)\d{3,5}\b/g, // 淘宝的 CZ0001
  /\b[A-Za-z]{2,4}@[A-Za-z]{1,3}\.[A-Za-z]{1,3}\b/g, // 抖音的 vSm@g.Oh
  /[\[【]?(?:分享|来自)(?:自)?(?:哔哩哔哩|bilibili|网易云音乐)[\]】]?/gi,
  /发布了一篇小红书笔记[，,]?\s*快来看吧！?/g,
  /😆\s*\S+\s*😆/g,
];

/**
 * 认得出是平台分享口令时返回 { url, title, source }，否则 null。
 * 只在文本里有链接、且带了口令特征（【】、复制打开、口令码…）时才算，普通「一句话 + 链接」不动。
 */
export function parseShareCode(text: string, url: string): ShareCode | null {
  const app = APP_OF.find(([re]) => re.test(url))?.[1];
  const looks = /复制|打开|口令|【|￥|\$[A-Za-z0-9]{6,}|App|分享/.test(text);
  if (!app || !looks) return null;
  let rest = text.replace(url, ' ');
  // 抖音：「【某某的作品】标题 # 话题」→ 标题；小红书：「标题 - 作者 | 小红书」
  for (const re of BOILER) rest = rest.replace(re, ' ');
  rest = rest
    .replace(/【([^】]{1,40})的作品】/g, ' ')
    .replace(/【([^】]{1,60})】/g, '$1')
    .replace(/[「」]/g, ' ')
    .replace(/\s*[|｜]\s*(?:小红书|抖音|淘宝|bilibili|哔哩哔哩)\s*$/i, '')
    .replace(/[，,。！!？?、\s]+$/g, '')
    .replace(/^[，,。！!？?、:：\s]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { url, title: rest.slice(0, 120), source: app };
}
