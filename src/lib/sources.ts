// v0.22 来源 App：安卓包名 / Windows 媒体会话的 AppUserModelId → 中文显示名。认不出就留空，不猜。

const ANDROID: Record<string, string> = {
  'com.tencent.weread': '微信读书',
  'com.tencent.mm': '微信',
  'com.tencent.mobileqq': 'QQ',
  'com.netease.cloudmusic': '网易云音乐',
  'com.tencent.qqmusic': 'QQ 音乐',
  'com.luna.music': '汽水音乐',
  'com.kugou.android': '酷狗音乐',
  'cn.kuwo.player': '酷我音乐',
  'com.spotify.music': 'Spotify',
  'com.apple.android.music': 'Apple Music',
  'com.google.android.apps.youtube.music': 'YouTube Music',
  'com.google.android.youtube': 'YouTube',
  'com.xingin.xhs': '小红书',
  'tv.danmaku.bili': '哔哩哔哩',
  'com.bilibili.app.in': '哔哩哔哩',
  'com.ss.android.ugc.aweme': '抖音',
  'com.smile.gifmaker': '快手',
  'com.kuaishou.nebula': '快手极速版',
  'com.zhihu.android': '知乎',
  'com.douban.frodo': '豆瓣',
  'com.sina.weibo': '微博',
  'com.ximalaya.ting.android': '喜马拉雅',
  'app.podcast.cosmos': '小宇宙',
  'com.amazon.kindlefc': 'Kindle',
  'com.duokan.reader': '多看阅读',
  'com.android.chrome': 'Chrome',
  'com.UCMobile': 'UC 浏览器',
  'com.quark.browser': '夸克',
  'com.vivo.browser': 'vivo 浏览器',
  'com.microsoft.emmx': 'Edge',
  'org.mozilla.firefox': 'Firefox',
  'com.taobao.taobao': '淘宝',
};

// Windows：SourceAppUserModelId 形如 Spotify.exe / SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify / cloudmusic.exe
const WINDOWS: Array<[RegExp, string]> = [
  [/cloudmusic/i, '网易云音乐'],
  [/qqmusic/i, 'QQ 音乐'],
  [/spotify/i, 'Spotify'],
  [/kugou/i, '酷狗音乐'],
  [/kuwo/i, '酷我音乐'],
  [/luna|soda/i, '汽水音乐'],
  [/AppleMusic|AppleInc\.AppleMusic/i, 'Apple Music'],
  [/ZuneMusic|Microsoft\.Media\.Player/i, '媒体播放器'],
  [/foobar2000/i, 'foobar2000'],
  [/potplayer/i, 'PotPlayer'],
  [/vlc/i, 'VLC'],
  [/MSEdge|MicrosoftEdge/i, 'Edge'],
  [/chrome/i, 'Chrome'],
  [/firefox/i, 'Firefox'],
];

/** 包名 / AUMID → 显示名；认不出返回 '' */
export function sourceName(id: string | null | undefined): string {
  const s = (id || '').trim();
  if (!s) return '';
  if (ANDROID[s]) return ANDROID[s];
  if (/\.exe$|!|_[a-z0-9]{13}/i.test(s) || /^[A-Za-z0-9]+$/.test(s)) {
    for (const [re, name] of WINDOWS) if (re.test(s)) return name;
  }
  return '';
}

/** 来源字段清洗：去控制字符、限长 */
export function cleanSource(s: string | null | undefined): string {
  return (s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
}
