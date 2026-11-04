//! v0.33 系统入口（只在桌面版）：
//! - 0515 全局热键可自定义 + 冲突检测（存在 应用配置目录/hotkeys.json）
//! - 0004 唤出速记小窗时带上选中的文字；0507 摘抄热键（默认关）选中即存
//! - 0018 剪贴板守望跳过密码管理器标记的内容；0003 剪贴板里是图片时给小窗一张图
//! - 0510 glean:// 深链接 / 0517 单实例 / 0518 「发送到 → 拾穗」 / 0516 开机静默启动 / 0520 外链交给系统
//! v0.36：0005 框选截图热键（调系统截图 ms-screenclip:，截完小窗带图）、0509 冷启动链接 / 发送到先落盘、Win+H 系统听写
//! 纯逻辑（解析参数、猜类型、校验热键、收件队列）在 entrylogic.rs，不依赖 tauri，能单测。

use crate::entrylogic::{self, Hotkeys};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Default)]
pub struct Entry {
  keys: Mutex<Hotkeys>,
  /// 已注册的 (动作, 热键)
  live: Mutex<Vec<(&'static str, Shortcut)>>,
  /// 前端还没来取的 glean:// 链接（冷启动时 JS 还没监听）
  links: Mutex<Vec<String>>,
  ready: Mutex<bool>,
  /// 「发送到」带进来的文件：(名字, 类型, 内容)
  files: Mutex<Vec<(String, String, Vec<u8>)>>,
  /// 正在抓选中文字（连按热键不叠）
  busy: Mutex<bool>,
  /// v0.36 0509 落盘的收件队列（和 links / files 同步）
  inbox: Mutex<entrylogic::Inbox>,
  /// v0.36 0005 正在等截图（连按不叠）
  shooting: Mutex<bool>,
}

fn inbox_path(app: &AppHandle) -> Option<std::path::PathBuf> {
  app.path().app_local_data_dir().ok().map(|d| d.join("glean_inbox.json"))
}

fn inbox_save(app: &AppHandle) {
  let Some(p) = inbox_path(app) else { return };
  let b = app.state::<Entry>().inbox.lock().unwrap().clone();
  if b.is_empty() {
    let _ = std::fs::remove_file(p);
    return;
  }
  if let Some(d) = p.parent() {
    let _ = std::fs::create_dir_all(d);
  }
  let _ = std::fs::write(p, serde_json::to_string(&b).unwrap_or_default());
}

/// 读一个「发送到」的文件进内存（图片 / 纯文字，≤12MB）
fn read_send(p: &str) -> Option<(String, String, Vec<u8>)> {
  let meta = std::fs::metadata(p).ok()?;
  if !meta.is_file() || meta.len() > entrylogic::MAX_BYTES {
    return None;
  }
  let name = std::path::Path::new(p).file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
  let mime = entrylogic::guess_mime(&name)?;
  std::fs::read(p).ok().map(|b| (name, mime.to_string(), b))
}

fn cfg_path(app: &AppHandle) -> Option<std::path::PathBuf> {
  app.path().app_config_dir().ok().map(|d| d.join("hotkeys.json"))
}

pub fn show_main(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

/// 启动时：读热键配置并注册；读冷启动参数（发送到的文件）
pub fn init(app: &AppHandle) {
  let e = app.state::<Entry>();
  let keys = cfg_path(app)
    .and_then(|p| std::fs::read_to_string(p).ok())
    .and_then(|s| serde_json::from_str::<Hotkeys>(&s).ok())
    .unwrap_or_default();
  *e.keys.lock().unwrap() = keys.clone();
  let _ = apply(app, &keys);
  // 0509：上次没被前端取走的链接 / 发送到的文件
  let left = inbox_path(app).and_then(|p| std::fs::read_to_string(p).ok()).map(|s| entrylogic::Inbox::parse(&s)).unwrap_or_default();
  if !left.is_empty() {
    e.links.lock().unwrap().extend(left.links.iter().cloned());
    let mut files = e.files.lock().unwrap();
    for p in &left.send {
      if let Some(f) = read_send(p) {
        files.push(f);
      }
    }
    *e.inbox.lock().unwrap() = left;
  }
  let args: Vec<String> = std::env::args().collect();
  take_args(app, &args, false);
}

/// 注册热键；返回每个动作的错误（空 = 都好）
fn apply(app: &AppHandle, keys: &Hotkeys) -> Vec<(String, String)> {
  let e = app.state::<Entry>();
  let gs = app.global_shortcut();
  let mut live = e.live.lock().unwrap();
  for (_, s) in live.drain(..) {
    let _ = gs.unregister(s);
  }
  let mut errs = Vec::new();
  for (act, acc) in [("quick", &keys.quick), ("excerpt", &keys.excerpt), ("shot", &keys.shot)] {
    if acc.is_empty() {
      continue;
    }
    if let Err(m) = entrylogic::check_accel(acc) {
      errs.push((act.to_string(), m.to_string()));
      continue;
    }
    let s: Shortcut = match acc.parse() {
      Ok(s) => s,
      Err(_) => {
        errs.push((act.to_string(), "认不出这个组合".into()));
        continue;
      }
    };
    if live.iter().any(|(_, x)| *x == s) {
      errs.push((act.to_string(), "和另一个热键重复".into()));
      continue;
    }
    match gs.register(s) {
      Ok(()) => live.push((act, s)),
      // RegisterHotKey 失败 = 被别的程序占了
      Err(_) => errs.push((act.to_string(), "被别的程序占用了".into())),
    }
  }
  errs
}

/// 全局热键回调（lib.rs 的 with_handler 转过来）
pub fn on_shortcut(app: &AppHandle, s: &Shortcut, state: ShortcutState) {
  if state != ShortcutState::Pressed {
    return;
  }
  let e = app.state::<Entry>();
  let act = e.live.lock().unwrap().iter().find(|(_, x)| x == s).map(|(a, _)| *a);
  let grab = e.keys.lock().unwrap().grab;
  match act {
    Some("quick") => {
      // v0.44 0562：窗口原本藏着就挪到鼠标所在的屏幕
      crate::shell::to_cursor_monitor(app);
      if !grab {
        show_main(app);
        let _ = app.emit("quick-focus", "");
        return;
      }
      let app = app.clone();
      std::thread::spawn(move || {
        let text = grab_selection(&app).unwrap_or_default();
        show_main(&app);
        let _ = app.emit("quick-focus", text);
      });
    }
    Some("excerpt") => {
      let app = app.clone();
      std::thread::spawn(move || {
        if let Some(t) = grab_selection(&app) {
          let _ = app.emit("glean-excerpt", t);
        }
      });
    }
    Some("shot") => {
      let app = app.clone();
      std::thread::spawn(move || shoot(&app));
    }
    _ => {}
  }
}

/// 0004 / 0507：等用户松开 Shift / Alt / Win，模拟 Ctrl+C，读到新内容就拿走，再把原来的文字放回剪贴板。
/// 只在 Windows 有；剪贴板序号没变（什么都没选中）返回 None。
#[cfg(windows)]
fn grab_selection(app: &AppHandle) -> Option<String> {
  use tauri_plugin_clipboard_manager::ClipboardExt;
  use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
  use windows::Win32::UI::Input::KeyboardAndMouse::*;
  let e = app.state::<Entry>();
  {
    let mut b = e.busy.lock().unwrap();
    if *b {
      return None;
    }
    *b = true;
  }
  let held = |k: VIRTUAL_KEY| unsafe { (GetAsyncKeyState(k.0 as i32) as u16 & 0x8000) != 0 };
  let mods = [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN];
  for _ in 0..40 {
    if !mods.iter().any(|k| held(*k)) {
      break;
    }
    std::thread::sleep(std::time::Duration::from_millis(10));
  }
  let key = |k: VIRTUAL_KEY, up: bool| INPUT {
    r#type: INPUT_KEYBOARD,
    Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: k, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 } },
  };
  let old = app.clipboard().read_text().ok();
  let before = unsafe { GetClipboardSequenceNumber() };
  let mut seq: Vec<INPUT> = mods.iter().filter(|k| held(**k)).map(|k| key(*k, true)).collect();
  let ctrl = held(VK_CONTROL);
  if !ctrl {
    seq.push(key(VK_CONTROL, false));
  }
  seq.push(key(VIRTUAL_KEY(0x43), false));
  seq.push(key(VIRTUAL_KEY(0x43), true));
  if !ctrl {
    seq.push(key(VK_CONTROL, true));
  }
  unsafe { SendInput(&seq, std::mem::size_of::<INPUT>() as i32) };
  let mut got = None;
  for _ in 0..30 {
    std::thread::sleep(std::time::Duration::from_millis(10));
    if unsafe { GetClipboardSequenceNumber() } != before {
      std::thread::sleep(std::time::Duration::from_millis(30));
      got = app.clipboard().read_text().ok();
      break;
    }
  }
  if got.is_some() {
    if let Some(o) = old {
      let _ = app.clipboard().write_text(o);
    }
  }
  *e.busy.lock().unwrap() = false;
  got.map(|t| entrylogic::clip_text(&t)).filter(|t| !t.is_empty())
}

/// 0005：调系统自带的框选截图（ms-screenclip:，Win10 1809+ / Win11），等剪贴板出现新图（最多 90 秒），
/// 再唤出速记小窗：payload 以 \u{1}shot 开头 = 小窗直接带上这张图（前端再交给 OCR）。取消截图 = 什么都不发生。
#[cfg(windows)]
fn shoot(app: &AppHandle) {
  use tauri_plugin_opener::OpenerExt;
  use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
  let e = app.state::<Entry>();
  {
    let mut b = e.shooting.lock().unwrap();
    if *b {
      return;
    }
    *b = true;
  }
  let before = unsafe { GetClipboardSequenceNumber() };
  if app.opener().open_url("ms-screenclip:", None::<&str>).is_ok() {
    for _ in 0..450 {
      std::thread::sleep(std::time::Duration::from_millis(200));
      let now = unsafe { GetClipboardSequenceNumber() };
      if now != before {
        // 截图工具会连写几种格式，稍等它写完
        std::thread::sleep(std::time::Duration::from_millis(250));
        if clip_peek_os().image {
          show_main(app);
          let _ = app.emit("quick-focus", format!("\u{1}shot:{now}"));
        }
        break;
      }
    }
  }
  *e.shooting.lock().unwrap() = false;
}

#[cfg(not(windows))]
fn shoot(_app: &AppHandle) {}

/// 托盘「框选截图拾」/ 设置里试一下
#[tauri::command]
pub fn shot_now(app: AppHandle) {
  std::thread::spawn(move || shoot(&app));
}

/// Win+H：唤出 Windows 自带的语音输入（听写），字会打进当前有焦点的输入框（前端先把焦点放进速记框）
#[tauri::command]
pub fn dictate() -> bool {
  #[cfg(windows)]
  {
    use windows::Win32::UI::Input::KeyboardAndMouse::*;
    let key = |k: VIRTUAL_KEY, up: bool| INPUT {
      r#type: INPUT_KEYBOARD,
      Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: k, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 } },
    };
    let h = VIRTUAL_KEY(0x48);
    let seq = [key(VK_LWIN, false), key(h, false), key(h, true), key(VK_LWIN, true)];
    return unsafe { SendInput(&seq, std::mem::size_of::<INPUT>() as i32) } == 4;
  }
  #[allow(unreachable_code)]
  false
}

#[cfg(not(windows))]
fn grab_selection(_app: &AppHandle) -> Option<String> {
  None
}

/// 冷启动参数 / 第二个实例的参数：--send 文件… → 存起来通知前端；--hidden 不弹窗；其余 = 把已在运行的窗口叫出来
pub fn take_args(app: &AppHandle, args: &[String], second: bool) {
  let a = entrylogic::parse_args(args);
  if !a.send.is_empty() {
    let e = app.state::<Entry>();
    let mut files = e.files.lock().unwrap();
    let mut inbox = e.inbox.lock().unwrap();
    for p in a.send.iter().take(entrylogic::MAX_FILES) {
      if let Some(f) = read_send(p) {
        files.push(f);
        inbox.add_send(p);
      }
    }
    drop(files);
    drop(inbox);
    inbox_save(app);
    show_main(app);
    let _ = app.emit("glean-send", ());
  } else if second && a.links.is_empty() && !a.hidden {
    show_main(app);
  }
}

/// 深链接：前端已经在听就直接发事件，否则先存着等它来取
pub fn on_link(app: &AppHandle, url: String) {
  if !entrylogic::is_glean_link(&url) {
    return;
  }
  let e = app.state::<Entry>();
  show_main(app);
  if *e.ready.lock().unwrap() {
    let _ = app.emit("glean-go", url);
  } else {
    e.inbox.lock().unwrap().add_link(&url);
    e.links.lock().unwrap().push(url);
    inbox_save(app);
  }
}

#[derive(serde::Serialize)]
pub struct EntryState {
  keys: Hotkeys,
  errors: Vec<(String, String)>,
  autostart: bool,
}

fn autostart_on(app: &AppHandle) -> bool {
  use tauri_plugin_autostart::ManagerExt;
  app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn entry_get(app: AppHandle) -> EntryState {
  let e = app.state::<Entry>();
  let keys = e.keys.lock().unwrap().clone();
  let live: Vec<&str> = e.live.lock().unwrap().iter().map(|(a, _)| *a).collect();
  let mut errors = Vec::new();
  if !keys.quick.is_empty() && !live.contains(&"quick") {
    errors.push(("quick".into(), "没注册上".into()));
  }
  if !keys.excerpt.is_empty() && !live.contains(&"excerpt") {
    errors.push(("excerpt".into(), "没注册上".into()));
  }
  if !keys.shot.is_empty() && !live.contains(&"shot") {
    errors.push(("shot".into(), "没注册上".into()));
  }
  EntryState { keys, errors, autostart: autostart_on(&app) }
}

/// 改热键：先试注册，有冲突就退回原来的并把原因交给前端
#[tauri::command]
pub fn entry_set_keys(app: AppHandle, keys: Hotkeys) -> EntryState {
  let e = app.state::<Entry>();
  let old = e.keys.lock().unwrap().clone();
  let errs = apply(&app, &keys);
  if errs.is_empty() {
    *e.keys.lock().unwrap() = keys.clone();
    if let Some(p) = cfg_path(&app) {
      if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
      }
      let _ = std::fs::write(p, serde_json::to_string(&keys).unwrap_or_default());
    }
  } else {
    let _ = apply(&app, &old);
  }
  let mut st = entry_get(app);
  st.errors = errs;
  st
}

#[tauri::command]
pub fn entry_autostart(app: AppHandle, on: bool) -> Result<bool, String> {
  use tauri_plugin_autostart::ManagerExt;
  let m = app.autolaunch();
  let r = if on { m.enable() } else { m.disable() };
  r.map_err(|_| "系统没让改开机启动".to_string())?;
  Ok(autostart_on(&app))
}

/// 前端开始监听后来取冷启动时攒下的链接
#[tauri::command]
pub fn link_take(app: AppHandle) -> Vec<String> {
  let e = app.state::<Entry>();
  *e.ready.lock().unwrap() = true;
  let out = std::mem::take(&mut *e.links.lock().unwrap());
  e.inbox.lock().unwrap().links.clear();
  inbox_save(&app);
  out
}

#[derive(serde::Serialize)]
pub struct SendFile {
  name: String,
  mime: String,
  size: usize,
}

#[tauri::command]
pub fn send_list(app: AppHandle) -> Vec<SendFile> {
  let e = app.state::<Entry>();
  e.files.lock().unwrap().iter().map(|(n, m, b)| SendFile { name: n.clone(), mime: m.clone(), size: b.len() }).collect()
}

#[tauri::command]
pub fn send_read(app: AppHandle, index: usize) -> tauri::ipc::Response {
  let e = app.state::<Entry>();
  let b = e.files.lock().unwrap().get(index).map(|x| x.2.clone()).unwrap_or_default();
  tauri::ipc::Response::new(b)
}

#[tauri::command]
pub fn send_clear(app: AppHandle) {
  let e = app.state::<Entry>();
  e.files.lock().unwrap().clear();
  e.inbox.lock().unwrap().send.clear();
  inbox_save(&app);
}

/// 0520：外链交给系统默认程序（网易云 / B 站等装了 App 的会被它们接走）。只放行 http / https。
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
  use tauri_plugin_opener::OpenerExt;
  if !entrylogic::is_web_url(&url) {
    return Err("只打开网页链接".into());
  }
  app.opener().open_url(url, None::<&str>).map_err(|_| "打不开".to_string())
}

#[derive(serde::Serialize, Default)]
pub struct ClipPeek {
  seq: u32,
  /// 0018：密码管理器 / 系统标了「别记录」的内容
  #[serde(rename = "private")]
  private_: bool,
  image: bool,
}

/// 剪贴板现在是什么（不读内容）
#[tauri::command]
pub fn clip_peek(app: AppHandle) -> ClipPeek {
  let mut p = clip_peek_os();
  // v0.44 0538：托盘里暂停了剪贴板提示 → 当成「别记录」，速记条和小窗都不提示
  if crate::shell::clip_paused(&app) {
    p.private_ = true;
  }
  p
}

#[cfg(windows)]
fn clip_peek_os() -> ClipPeek {
  use windows::Win32::Foundation::HGLOBAL;
  use windows::Win32::System::DataExchange::*;
  use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
  use windows::core::w;
  unsafe {
    let seq = GetClipboardSequenceNumber();
    let ex = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
    let hist = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
    let cloud = RegisterClipboardFormatW(w!("CanUploadToCloudClipboard"));
    let png = RegisterClipboardFormatW(w!("PNG"));
    let mut private_ = IsClipboardFormatAvailable(ex).is_ok();
    // CF_DIB = 8, CF_DIBV5 = 17, CF_BITMAP = 2
    let image = IsClipboardFormatAvailable(8).is_ok() || IsClipboardFormatAvailable(17).is_ok() || IsClipboardFormatAvailable(2).is_ok() || IsClipboardFormatAvailable(png).is_ok();
    if !private_ && OpenClipboard(None).is_ok() {
      for f in [hist, cloud] {
        if IsClipboardFormatAvailable(f).is_err() {
          continue;
        }
        if let Ok(h) = GetClipboardData(f) {
          let g = HGLOBAL(h.0);
          let p = GlobalLock(g) as *const u32;
          if !p.is_null() {
            if *p == 0 {
              private_ = true;
            }
            let _ = GlobalUnlock(g);
          }
        }
      }
      let _ = CloseClipboard();
    }
    ClipPeek { seq, private_, image }
  }
}

#[cfg(not(windows))]
fn clip_peek_os() -> ClipPeek {
  ClipPeek::default()
}

/// 0003：剪贴板里的图转成 PNG 交给前端（前端再压缩成穗图）；没图返回空
#[tauri::command]
pub fn clip_image(app: AppHandle) -> tauri::ipc::Response {
  use tauri_plugin_clipboard_manager::ClipboardExt;
  let out = app
    .clipboard()
    .read_image()
    .ok()
    .and_then(|img| entrylogic::encode_png(img.rgba(), img.width(), img.height()))
    .unwrap_or_default();
  tauri::ipc::Response::new(out)
}
