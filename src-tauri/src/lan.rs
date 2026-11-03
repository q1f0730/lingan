//! v0.32 局域网直连（只在桌面版）：HTTP 外壳见 lancore.rs。
//! 文件存在 应用数据目录/lan-sync/（全是密文）；手机放进来 / 删掉文件时发 `glean:lan-changed` 事件，前端跟着合并一次。
//! 钥匙由前端在开启时交进来（数据钥派生的局域网钥，十六进制），只在内存里。

use crate::lancore::{self, LanState, Notify};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub const DEFAULT_PORT: u16 = 47322;

struct Emit(AppHandle);
impl Notify for Emit {
  fn changed(&self, path: &str) {
    let _ = self.0.emit("glean:lan-changed", path.to_string());
  }
}

#[derive(Default)]
pub struct Lan {
  server: Mutex<Option<(Arc<tiny_http::Server>, u16)>>,
  state: Mutex<Option<Arc<LanState>>>,
}

#[derive(serde::Serialize)]
pub struct LanInfo {
  port: u16,
  addrs: Vec<String>,
}

fn state(app: &AppHandle) -> Result<Arc<LanState>, String> {
  let lan = app.state::<Lan>();
  let mut g = lan.state.lock().unwrap();
  if let Some(s) = g.as_ref() {
    return Ok(s.clone());
  }
  let dir = app.path().app_data_dir().map_err(|_| "no app data dir".to_string())?.join("lan-sync");
  std::fs::create_dir_all(&dir).map_err(|_| "cannot create lan-sync dir".to_string())?;
  let s = LanState::new(dir);
  *g = Some(s.clone());
  Ok(s)
}

#[tauri::command]
pub fn lan_start(app: AppHandle, key_hex: String, port: Option<u16>) -> Result<LanInfo, String> {
  let key = lancore::from_hex32(&key_hex).ok_or("bad key")?;
  let st = state(&app)?;
  st.set_auth(Some(key));
  let lan = app.state::<Lan>();
  let mut g = lan.server.lock().unwrap();
  let real = match g.as_ref() {
    Some((_, p)) => *p,
    None => {
      let (srv, p) = lancore::serve(port.unwrap_or(DEFAULT_PORT), st, Arc::new(Emit(app.clone())))?;
      *g = Some((srv, p));
      p
    }
  };
  Ok(LanInfo { port: real, addrs: lancore::local_addrs() })
}

#[tauri::command]
pub fn lan_stop(app: AppHandle) -> Result<(), String> {
  let lan = app.state::<Lan>();
  if let Some((srv, _)) = lan.server.lock().unwrap().take() {
    srv.unblock();
  }
  if let Some(st) = lan.state.lock().unwrap().as_ref() {
    st.set_auth(None);
    st.clear_offer();
  }
  Ok(())
}

#[tauri::command]
pub fn lan_offer(app: AppHandle, auth_hex: String, bundle: Vec<u8>, ttl_secs: u64) -> Result<(), String> {
  let auth = lancore::from_hex32(&auth_hex).ok_or("bad key")?;
  if bundle.len() > 64 * 1024 {
    return Err("bundle too large".into());
  }
  state(&app)?.set_offer(auth, bundle, ttl_secs.saturating_mul(1000));
  Ok(())
}

#[tauri::command]
pub fn lan_addrs() -> Vec<String> {
  lancore::local_addrs()
}
