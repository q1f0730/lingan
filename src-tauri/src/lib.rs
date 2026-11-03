mod smtc;
#[cfg(desktop)]
mod apicore;
#[cfg(desktop)]
mod api;

/// v0.22 正在播放一键拾（Windows SMTC）；其它平台返回 unsupported，安卓走 MainActivity 的 LinganNowPlaying 桥
#[tauri::command]
async fn now_playing() -> Result<Option<smtc::NowPlaying>, String> {
  smtc::read()
}

#[cfg(desktop)]
fn show_quick(app: &tauri::AppHandle) {
  use tauri::{Emitter, Manager};
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
  let _ = app.emit("quick-focus", ());
}

/// v0.16 tray: open the main window on a given view (穗仓 / 今日一穗 / 设置)
#[cfg(desktop)]
fn show_view(app: &tauri::AppHandle, view: &str) {
  use tauri::{Emitter, Manager};
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
  let _ = app.emit("glean-go", view.to_string());
}

/// v0.20 系统钥匙串：只认两个固定名字，错误信息不带平台细节和值
#[cfg(desktop)]
mod vault {
  const SERVICE: &str = "com.q1f730.lingan";
  fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !matches!(name, "chat.apiKey" | "embed.apiKey") {
      return Err("bad secret name".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|_| "keychain unavailable".to_string())
  }
  #[tauri::command]
  pub fn secret_get(name: String) -> Result<Option<String>, String> {
    match entry(&name)?.get_password() {
      Ok(v) => Ok(Some(v)),
      Err(keyring::Error::NoEntry) => Ok(None),
      Err(_) => Err("keychain read failed".into()),
    }
  }
  #[tauri::command]
  pub fn secret_set(name: String, value: String) -> Result<(), String> {
    entry(&name)?.set_password(&value).map_err(|_| "keychain write failed".to_string())
  }
  #[tauri::command]
  pub fn secret_delete(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
      Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
      Err(_) => Err("keychain delete failed".into()),
    }
  }
}

/// 移动端：钥匙串走 Android Keystore 的 JS 桥（LinganVault），这里只占位
#[cfg(mobile)]
mod vault {
  #[tauri::command]
  pub fn secret_get(_name: String) -> Result<Option<String>, String> {
    Err("unsupported".into())
  }
  #[tauri::command]
  pub fn secret_set(_name: String, _value: String) -> Result<(), String> {
    Err("unsupported".into())
  }
  #[tauri::command]
  pub fn secret_delete(_name: String) -> Result<(), String> {
    Err("unsupported".into())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    ;

  #[cfg(mobile)]
  let builder = builder.invoke_handler(tauri::generate_handler![vault::secret_get, vault::secret_set, vault::secret_delete, now_playing]);

  // v0.25 本地 API / MCP（api_*）+ 自动更新（updater / process 插件）只在桌面版
  #[cfg(desktop)]
  let builder = builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![
      vault::secret_get,
      vault::secret_set,
      vault::secret_delete,
      now_playing,
      api::api_start,
      api::api_stop,
      api::api_status,
      api::api_token,
      api::api_rotate,
      api::api_respond,
      api::api_focus
    ]);

  #[cfg(desktop)]
  let builder = builder
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_shortcuts(["ctrl+shift+l"])
        .expect("shortcut")
        .with_handler(|app, _shortcut, event| {
          if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            show_quick(app);
          }
        })
        .build(),
    )
    .on_window_event(|window, event| {
      // closing the window keeps Glean in the tray
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    });

  builder
    .setup(|app| {
      #[cfg(desktop)]
      {
        api::init(app.handle());
        use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        let quick = MenuItem::with_id(app, "quick", "随手拾一穗\tCtrl+Shift+L", true, None::<&str>)?;
        let song = MenuItem::with_id(app, "nowplaying", "拾正在播放的歌", true, None::<&str>)?;
        let library = MenuItem::with_id(app, "library", "打开穗仓", true, None::<&str>)?;
        let daily = MenuItem::with_id(app, "daily", "今日一穗", true, None::<&str>)?;
        let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "退出拾穗", true, None::<&str>)?;
        let sep1 = PredefinedMenuItem::separator(app)?;
        let sep2 = PredefinedMenuItem::separator(app)?;
        let menu = Menu::with_items(app, &[&quick, &song, &sep1, &library, &daily, &sep2, &settings, &quit])?;
        let mut tray = TrayIconBuilder::new()
          .tooltip("拾穗 Glean")
          .menu(&menu)
          .show_menu_on_left_click(false)
          .on_menu_event(|app, e| match e.id().as_ref() {
            "quick" => show_quick(app),
            "nowplaying" => {
              use tauri::{Emitter, Manager};
              if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
              }
              let _ = app.emit("glean-nowplaying", ());
            }
            "library" => show_view(app, "library"),
            "daily" => show_view(app, "daily"),
            "settings" => show_view(app, "settings"),
            "quit" => app.exit(0),
            _ => {}
          })
          .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
              show_quick(tray.app_handle());
            }
          });
        if let Some(icon) = app.default_window_icon() {
          tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
