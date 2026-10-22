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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_clipboard_manager::init());

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
        use tauri::menu::{Menu, MenuItem};
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
        let quick = MenuItem::with_id(app, "quick", "速记  Ctrl+Shift+L", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&quick, &quit])?;
        let mut tray = TrayIconBuilder::new()
          .tooltip("拾穗 Glean")
          .menu(&menu)
          .show_menu_on_left_click(false)
          .on_menu_event(|app, e| match e.id().as_ref() {
            "quick" => show_quick(app),
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
