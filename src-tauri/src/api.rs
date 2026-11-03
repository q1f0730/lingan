//! v0.25 本地 API / MCP（只在桌面版）：HTTP 外壳见 apicore.rs。
//! 数据在 WebView 的 IndexedDB 里，所以每个请求转成 `glean-api` 事件交给前端，前端查完调 `api_respond` 回答。
//! 令牌存系统钥匙串（Windows 凭据管理器，条目 api.token）；钥匙串不可用时只在内存里，重启换新。

use crate::apicore::{self, ApiRequest, ApiResponse, Forward};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const SERVICE: &str = "com.q1f730.lingan";
const TOKEN_NAME: &str = "api.token";
pub const DEFAULT_PORT: u16 = 47321;

#[derive(Clone, serde::Serialize)]
struct Payload {
  id: u64,
  #[serde(flatten)]
  req: ApiRequest,
}

type Reply = (u16, String, Vec<(String, String)>);

struct Bridge {
  app: AppHandle,
  next: AtomicU64,
  pending: Mutex<HashMap<u64, mpsc::Sender<Reply>>>,
}

impl Forward for Bridge {
  fn forward(&self, req: ApiRequest) -> ApiResponse {
    let id = self.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    self.pending.lock().unwrap().insert(id, tx);
    // 写入要等本人在 App 里点「允许」，给 3 分钟；读 20 秒
    let wait = if req.method == "GET" { 20 } else { 180 };
    let sent = self.app.emit_to("main", "glean-api", Payload { id, req }).is_ok();
    let got = if sent { rx.recv_timeout(Duration::from_secs(wait)).ok() } else { None };
    self.pending.lock().unwrap().remove(&id);
    match got {
      Some((status, body, headers)) => ApiResponse { status, body, headers },
      None => ApiResponse { status: 503, body: "{\"error\":\"glean ui not responding\"}".into(), headers: vec![] },
    }
  }
}

#[derive(Default)]
pub struct ApiState {
  inner: Mutex<Inner>,
}
#[derive(Default)]
struct Inner {
  server: Option<Arc<tiny_http::Server>>,
  bridge: Option<Arc<Bridge>>,
  port: u16,
  token: Option<String>,
  stored: &'static str,
}

#[derive(serde::Serialize)]
pub struct ApiStatus {
  running: bool,
  port: u16,
  /// keychain | memory
  stored: &'static str,
}

fn entry() -> Option<keyring::Entry> {
  keyring::Entry::new(SERVICE, TOKEN_NAME).ok()
}

/// 读钥匙串里的令牌；没有就生成一个存进去
fn load_token(inner: &mut Inner, rotate: bool) -> Result<String, String> {
  if !rotate {
    if let Some(t) = &inner.token {
      return Ok(t.clone());
    }
    if let Some(Ok(t)) = entry().map(|e| e.get_password()) {
      if t.starts_with("glean_") && t.len() >= 30 {
        inner.token = Some(t.clone());
        inner.stored = "keychain";
        return Ok(t);
      }
    }
  }
  let t = apicore::new_token()?;
  inner.stored = match entry().map(|e| e.set_password(&t)) {
    Some(Ok(())) => "keychain",
    _ => "memory",
  };
  inner.token = Some(t.clone());
  Ok(t)
}

fn stop_inner(inner: &mut Inner) {
  if let Some(s) = inner.server.take() {
    s.unblock();
  }
  if let Some(b) = inner.bridge.take() {
    b.pending.lock().unwrap().clear();
  }
}

fn status(inner: &Inner) -> ApiStatus {
  ApiStatus { running: inner.server.is_some(), port: inner.port, stored: if inner.stored.is_empty() { "keychain" } else { inner.stored } }
}

#[tauri::command]
pub fn api_start(app: AppHandle, state: tauri::State<'_, ApiState>, port: Option<u16>) -> Result<ApiStatus, String> {
  let port = port.filter(|p| *p >= 1024).unwrap_or(DEFAULT_PORT);
  let mut inner = state.inner.lock().unwrap();
  if inner.server.is_some() && inner.port == port {
    return Ok(status(&inner));
  }
  stop_inner(&mut inner);
  let token = load_token(&mut inner, false)?;
  let bridge = Arc::new(Bridge { app: app.clone(), next: AtomicU64::new(1), pending: Mutex::new(HashMap::new()) });
  let server = apicore::serve(port, token, bridge.clone())?;
  inner.server = Some(server);
  inner.bridge = Some(bridge);
  inner.port = port;
  Ok(status(&inner))
}

#[tauri::command]
pub fn api_stop(state: tauri::State<'_, ApiState>) -> ApiStatus {
  let mut inner = state.inner.lock().unwrap();
  stop_inner(&mut inner);
  status(&inner)
}

#[tauri::command]
pub fn api_status(state: tauri::State<'_, ApiState>) -> ApiStatus {
  status(&state.inner.lock().unwrap())
}

/// 给设置页「复制令牌」用：只在本人点按钮时才取
#[tauri::command]
pub fn api_token(state: tauri::State<'_, ApiState>) -> Result<String, String> {
  let mut inner = state.inner.lock().unwrap();
  load_token(&mut inner, false)
}

/// 换一个令牌：旧令牌立即失效（服务在跑就用新令牌重启）
#[tauri::command]
pub fn api_rotate(app: AppHandle, state: tauri::State<'_, ApiState>) -> Result<ApiStatus, String> {
  let mut inner = state.inner.lock().unwrap();
  let running = inner.server.is_some();
  let port = inner.port;
  stop_inner(&mut inner);
  let token = load_token(&mut inner, true)?;
  if running {
    let bridge = Arc::new(Bridge { app: app.clone(), next: AtomicU64::new(1), pending: Mutex::new(HashMap::new()) });
    inner.server = Some(apicore::serve(port, token, bridge.clone())?);
    inner.bridge = Some(bridge);
  }
  Ok(status(&inner))
}

#[tauri::command]
pub fn api_respond(state: tauri::State<'_, ApiState>, id: u64, status: u16, body: String, headers: Option<Vec<(String, String)>>) {
  let inner = state.inner.lock().unwrap();
  if let Some(b) = &inner.bridge {
    if let Some(tx) = b.pending.lock().unwrap().remove(&id) {
      let hs = headers.unwrap_or_default().into_iter().filter(|(k, _)| k.eq_ignore_ascii_case("Mcp-Session-Id") || k.eq_ignore_ascii_case("Content-Type")).collect();
      let _ = tx.send((status.clamp(100, 599), body, hs));
    }
  }
}

/// 写入确认弹窗前把主窗口叫到前面（窗口可能缩在托盘里）
#[tauri::command]
pub fn api_focus(app: AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

pub fn init(app: &AppHandle) {
  app.manage(ApiState::default());
}
