// 拾穗 · Glean 浏览器扩展（Chrome / Edge，MV3）。右键菜单 → 拼好 glean://capture 链接 → 交给本机拾穗 App。
// 0008 拾这一句（带 #:~:text= 跳回原句）· 0042 拾这张图 · 拾这个链接 / 页面 · 0009 B 站 / YouTube 当前时间点 + 这一帧
import { isVideoPage, menuToLink } from './lib.js';

const VIDEO = ['*://*.bilibili.com/*', '*://*.youtube.com/*', '*://youtu.be/*'];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'sel', title: '拾这一句「%s」', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'img', title: '拾这张图', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'link', title: '拾这个链接', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'time', title: '拾当前时间点（带这一帧）', contexts: ['page', 'video'], documentUrlPatterns: VIDEO });
    chrome.contextMenus.create({ id: 'page', title: '拾这个页面', contexts: ['page'] });
  });
});

/** 在页面里跑：读正在看的视频的时间点，试着把当前帧放进剪贴板（跨域 / 没焦点时只给时间码） */
async function grabVideo() {
  const vs = Array.from(document.querySelectorAll('video')).filter((v) => v.videoWidth > 0);
  const v = vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  if (!v) return null;
  let frame = false;
  try {
    const c = document.createElement('canvas');
    const k = Math.min(1, 1600 / v.videoWidth);
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (blob) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      frame = true;
    }
  } catch {
    frame = false;
  }
  return { t: v.currentTime, url: location.href, frame };
}

async function readVideo(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: grabVideo });
    return r && r.result;
  } catch {
    return null;
  }
}

/** 交给 App：让这个标签页「打开」glean:// 链接（浏览器会问一次是否打开拾穗，页面不会离开） */
function hand(tab, url) {
  if (tab && tab.id != null) chrome.tabs.update(tab.id, { url });
  else chrome.tabs.create({ url });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const id = String(info.menuItemId);
  const video = id === 'time' && tab ? await readVideo(tab.id) : null;
  hand(tab, menuToLink(id === 'time' && !video ? 'page' : id, info, tab, video));
});

chrome.action.onClicked.addListener(async (tab) => {
  const isVid = isVideoPage(tab.url);
  const video = isVid ? await readVideo(tab.id) : null;
  hand(tab, menuToLink(video ? 'time' : 'page', { pageUrl: tab.url }, tab, video));
});
