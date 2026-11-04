//! v0.44 外壳：窗口什么时候亮出来、崩溃记录、（桌面）托盘提示 / 剪贴板暂停 / 跟着鼠标换屏。
//! - 0741 首屏画完再亮窗口：配置里窗口默认不显示，前端首帧画完调 main_ready 才 show；5 秒兜底
//! - 0563 开机自启（--hidden）只进托盘：main_ready 告诉前端「这次是静默启动」，后台活整体再晚一些
//! - 0746 Rust panic 写 应用日志目录/crash.txt，下次启动前端 crash_take 取走、记进本地错误日志并提示一次
//! - 0561 第一次关窗口：系统通知说一声「还在托盘里」，只说一次（应用配置目录/tray-hint）
//! - 0538 托盘「暂停剪贴板提示 1 小时」：暂停期间 clip_peek 报 private，速记条和小窗都不再提示剪贴板
//! - 0562 热键 / 托盘唤出时窗口原本藏着：挪到鼠标所在的那块屏幕正中
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(desktop)]
use std::sync::atomic::AtomicU64;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct Shell {
  pub ready: AtomicBool,
  pub hidden: AtomicBool,
  #[cfg(desktop)]
  /// v0.45：暂停到哪一刻（Unix 秒，墙钟——睡眠 / 休眠期间也算时间），None = 没暂停
  pub pause: std::sync::Mutex<Option<u64>>,
  /// v0.45：每点一次托盘「暂停 / 恢复」+1；到点改回菜单文字的后台线程发现代数变了就退出（不会改错）
  #[cfg(desktop)]
  pub pause_gen: AtomicU64,
}

pub const PAUSE_SECS: u64 = 3600;
const CRASH: &str = "crash.txt";

/// 前端首帧画完：静默启动不亮窗口，否则亮出来。返回是不是静默启动
#[tauri::command]
pub fn main_ready(app: AppHandle) -> bool {
  let s = app.state::<Shell>();
  let hidden = s.hidden.load(Ordering::SeqCst);
  if !s.ready.swap(true, Ordering::SeqCst) && !hidden {
    #[cfg(desktop)]
    crate::entry::show_main(&app);
  }
  hidden
}

/// 上次崩溃留下的记录（取走即删）
#[tauri::command]
pub fn crash_take(app: AppHandle) -> Option<String> {
  let p = app.path().app_log_dir().ok()?.join(CRASH);
  let s = std::fs::read_to_string(&p).ok()?;
  let _ = std::fs::remove_file(&p);
  let s = s.trim().to_string();
  if s.is_empty() { None } else { Some(s) }
}

/// panic 时把「时间 | 版本 | 原因 @ 位置」写进 crash.txt，再交给原来的处理
pub fn panic_hook(dir: std::path::PathBuf) {
  let prev = std::panic::take_hook();
  std::panic::set_hook(Box::new(move |info| {
    let why = info
      .payload()
      .downcast_ref::<&str>()
      .map(|s| s.to_string())
      .or_else(|| info.payload().downcast_ref::<String>().cloned())
      .unwrap_or_else(|| "panic".into());
    let at = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(dir.join(CRASH), crate::shelllogic::crash_line(secs, env!("CARGO_PKG_VERSION"), &why, &at));
    prev(info);
  }));
}

/// 0561 第一次把窗口关进托盘时说一声
#[cfg(desktop)]
pub fn first_close(app: &AppHandle) {
  let Ok(dir) = app.path().app_config_dir() else { return };
  let f = dir.join("tray-hint");
  if f.exists() {
    return;
  }
  let _ = std::fs::create_dir_all(&dir);
  let _ = std::fs::write(&f, "1");
  use tauri_plugin_notification::NotificationExt;
  let _ = app.notification().builder().title("拾穗还在托盘里").body("关掉窗口不会退出：按热键或点托盘图标随手拾一穗，右键托盘图标可以退出。").show();
}

/// 0538 剪贴板提示是不是暂停中
#[cfg(desktop)]
pub fn clip_paused(app: &AppHandle) -> bool {
  let s = app.state::<Shell>();
  let g = *s.pause.lock().unwrap();
  crate::shelllogic::paused_at(now_secs(), g)
}

#[cfg(desktop)]
fn now_secs() -> u64 {
  std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// 0538 托盘点一下：没暂停 → 暂停 1 小时；暂停中 → 恢复。返回（现在是不是暂停中, 这一次的代数）
#[cfg(desktop)]
pub fn toggle_pause(app: &AppHandle) -> (bool, u64) {
  let s = app.state::<Shell>();
  let mut g = s.pause.lock().unwrap();
  let paused = crate::shelllogic::paused_at(now_secs(), *g);
  *g = if paused { None } else { Some(now_secs() + PAUSE_SECS) };
  let ticket = s.pause_gen.fetch_add(1, Ordering::SeqCst) + 1;
  (!paused, ticket)
}

/// v0.45 0550 现在是不是全屏游戏 / 演示 / 专注助手：剪贴板 / 截图提示和到点递一穗都先憋着
#[tauri::command]
pub fn quiet_now() -> bool {
  os_quiet()
}
#[cfg(windows)]
pub fn os_quiet() -> bool {
  unsafe { windows::Win32::UI::Shell::SHQueryUserNotificationState() }.map(|s| crate::shelllogic::quiet_state(s.0)).unwrap_or(false)
}
#[cfg(not(windows))]
pub fn os_quiet() -> bool {
  false
}

/// v0.45 到点自动恢复后菜单文字改回来用：期间又点过（代数变了）就返回 None 让线程退出
#[cfg(desktop)]
pub fn pause_settled(app: &AppHandle, ticket: u64) -> Option<bool> {
  let s = app.state::<Shell>();
  if s.pause_gen.load(Ordering::SeqCst) != ticket {
    return None;
  }
  Some(!clip_paused(app))
}

/// 0562 窗口原本藏着 / 最小化：挪到鼠标所在那块屏幕的正中（已经在那块屏上就不动）
#[cfg(desktop)]
pub fn to_cursor_monitor(app: &AppHandle) {
  let Some(w) = app.get_webview_window("main") else { return };
  if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
    return;
  }
  let Ok(p) = app.cursor_position() else { return };
  let Ok(Some(m)) = app.monitor_from_point(p.x, p.y) else { return };
  if let Ok(Some(cur)) = w.current_monitor() {
    if cur.position() == m.position() && cur.size() == m.size() {
      return;
    }
  }
  let Ok(size) = w.outer_size() else { return };
  let (x, y) = crate::shelllogic::center_in((m.position().x, m.position().y), (m.size().width, m.size().height), (size.width, size.height));
  let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
}
