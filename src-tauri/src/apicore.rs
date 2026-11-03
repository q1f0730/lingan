//! v0.25 本地 API 的 HTTP 外壳（不依赖 tauri，方便单独编译测试）。
//! 只听 127.0.0.1；每个请求先过三道关：Host 必须是本机（防 DNS 重绑定）、不能带浏览器 Origin（网页不能偷调）、
//! Bearer 令牌常数时间比对。过关的请求交给 `Forward`（桌面版里 = 转给前端 JS 查 IndexedDB 再回答）。
//! 不记录请求体和令牌。

use std::io::Read;
use std::sync::Arc;
use std::thread;

pub const MAX_BODY: usize = 1 << 20;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ApiRequest {
  pub method: String,
  pub path: String,
  pub query: String,
  pub body: String,
  /// 调用方自报的名字（X-Glean-Client，没有就用 User-Agent 的第一段）
  pub client: String,
  /// MCP Streamable HTTP 的会话 id（Mcp-Session-Id）
  pub session: String,
}

pub struct ApiResponse {
  pub status: u16,
  pub body: String,
  pub headers: Vec<(String, String)>,
}

pub trait Forward: Send + Sync + 'static {
  fn forward(&self, req: ApiRequest) -> ApiResponse;
}

/// 常数时间比较（长度不同直接 false，长度本身不是秘密）
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
  if a.len() != b.len() {
    return false;
  }
  let mut d = 0u8;
  for (x, y) in a.iter().zip(b.iter()) {
    d |= x ^ y;
  }
  d == 0
}

/// Host 头必须是 127.0.0.1:<port> / localhost:<port> / [::1]:<port>
pub fn host_ok(host: Option<&str>, port: u16) -> bool {
  let Some(h) = host else { return false };
  let h = h.trim().to_ascii_lowercase();
  let p = format!(":{port}");
  ["127.0.0.1", "localhost", "[::1]"].iter().any(|n| h == format!("{n}{p}"))
}

/// 浏览器发出的跨源请求一定带 Origin；本地脚本 / Agent 客户端不带（或带 "null" 以外的值时一律拒）
pub fn origin_ok(origin: Option<&str>) -> bool {
  match origin {
    None => true,
    Some(o) => o.trim().is_empty(),
  }
}

pub fn bearer(auth: Option<&str>) -> Option<&str> {
  let a = auth?.trim();
  let rest = a.strip_prefix("Bearer ").or_else(|| a.strip_prefix("bearer "))?;
  Some(rest.trim())
}

pub fn client_name(x_client: Option<&str>, ua: Option<&str>) -> String {
  // 自报名字整段保留（「Claude Code」）；User-Agent 只取第一段（「curl/8.14.1」）
  let raw = match x_client.map(str::trim).filter(|s| !s.is_empty()) {
    Some(x) => x,
    None => ua.and_then(|u| u.split_whitespace().next()).unwrap_or(""),
  };
  raw.chars().filter(|c| !c.is_control()).take(60).collect()
}

fn header<'a>(r: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
  r.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn reply(r: tiny_http::Request, status: u16, body: String, extra: &[(String, String)]) {
  let mut resp = tiny_http::Response::from_string(body).with_status_code(status);
  let mut hs: Vec<(String, String)> = vec![
    ("Content-Type".into(), "application/json; charset=utf-8".into()),
    ("Cache-Control".into(), "no-store".into()),
    ("X-Content-Type-Options".into(), "nosniff".into()),
  ];
  for (k, v) in extra {
    if k.eq_ignore_ascii_case("content-type") {
      hs.retain(|(a, _)| !a.eq_ignore_ascii_case("content-type"));
    }
    hs.push((k.clone(), v.clone()));
  }
  for (k, v) in hs {
    if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
      resp.add_header(h);
    }
  }
  let _ = r.respond(resp);
}

fn err(r: tiny_http::Request, status: u16, msg: &str) {
  reply(r, status, format!("{{\"error\":\"{msg}\"}}"), &[]);
}

/// 处理一个请求（在自己的线程里跑，写入确认可能要等用户点）
pub fn handle(mut r: tiny_http::Request, port: u16, token: &str, fwd: &dyn Forward) {
  if !host_ok(header(&r, "Host"), port) {
    return err(r, 403, "bad host");
  }
  if !origin_ok(header(&r, "Origin")) {
    return err(r, 403, "browser origin not allowed");
  }
  let method = r.method().as_str().to_ascii_uppercase();
  let url = r.url().to_string();
  let (path, query) = match url.split_once('?') {
    Some((p, q)) => (p.to_string(), q.to_string()),
    None => (url.clone(), String::new()),
  };
  if method == "GET" && path == "/health" {
    return reply(r, 200, "{\"ok\":true,\"app\":\"glean\"}".into(), &[]);
  }
  let tok_ok = bearer(header(&r, "Authorization")).map(|t| ct_eq(t.as_bytes(), token.as_bytes())).unwrap_or(false);
  if !tok_ok {
    return reply(r, 401, "{\"error\":\"unauthorized\"}".into(), &[("WWW-Authenticate".into(), "Bearer".into())]);
  }
  if !matches!(method.as_str(), "GET" | "POST" | "DELETE") {
    return err(r, 405, "method not allowed");
  }
  let mut body = String::new();
  if method == "POST" {
    let len = r.body_length().unwrap_or(0);
    if len > MAX_BODY {
      return err(r, 413, "body too large");
    }
    let mut buf = Vec::new();
    if r.as_reader().take(MAX_BODY as u64 + 1).read_to_end(&mut buf).is_err() || buf.len() > MAX_BODY {
      return err(r, 413, "body too large");
    }
    match String::from_utf8(buf) {
      Ok(s) => body = s,
      Err(_) => return err(r, 400, "body must be utf-8"),
    }
  }
  let req = ApiRequest {
    method,
    path,
    query,
    body,
    client: client_name(header(&r, "X-Glean-Client"), header(&r, "User-Agent")),
    session: header(&r, "Mcp-Session-Id").unwrap_or("").chars().take(80).collect(),
  };
  let res = fwd.forward(req);
  reply(r, res.status, res.body, &res.headers);
}

/// 起服务：返回 server 句柄（drop / unblock 即停）
pub fn serve(port: u16, token: String, fwd: Arc<dyn Forward>) -> Result<Arc<tiny_http::Server>, String> {
  let server = tiny_http::Server::http(("127.0.0.1", port)).map_err(|_| format!("port {port} unavailable"))?;
  let server = Arc::new(server);
  let s2 = server.clone();
  let token = Arc::new(token);
  thread::spawn(move || {
    for req in s2.incoming_requests() {
      let fwd = fwd.clone();
      let token = token.clone();
      thread::spawn(move || handle(req, port, &token, fwd.as_ref()));
    }
  });
  Ok(server)
}

pub fn new_token() -> Result<String, String> {
  let mut b = [0u8; 24];
  getrandom::fill(&mut b).map_err(|_| "no randomness".to_string())?;
  Ok(format!("glean_{}", b.iter().map(|x| format!("{x:02x}")).collect::<String>()))
}
