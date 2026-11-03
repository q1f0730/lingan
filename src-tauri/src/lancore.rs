//! v0.32 局域网直连同步的 HTTP 外壳（不依赖 tauri，方便单独编译测试）。
//!
//! 电脑开一个只存密文的小文件柜，手机在同一个 Wi-Fi 下经它和电脑交换 v0.31 的改动包 / 全库快照 / 原图：
//! - 文件全是数据钥加密过的（AES-256-GCM，在前端做），这里不认识内容，只按路径存取；
//! - 每个请求带 `X-Glean-Lan: <毫秒>.<随机串>.<HMAC-SHA256 十六进制>`，签的是「方法\n路径?查询\n毫秒\n随机串」，
//!   钥匙 = 数据钥派生的局域网钥（只在两台设备里），所以同一个 Wi-Fi 里的别人看到请求也伪造不了、重放不了（随机串记 10 分钟）；
//! - 配对：电脑生成一次性配对码（二维码里），这里只拿到「配对码派生的验证钥 + 已经用配对码加密好的配对包」，
//!   手机第一次用配对码签名来取，取一次就作废，10 分钟过期。
//! 不记录请求体和钥匙。

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

pub const MAX_FILE: usize = 96 << 20;
const SKEW_MS: u64 = 5 * 60_000;
const NONCE_TTL_MS: u64 = 10 * 60_000;

pub fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
  let mut k = [0u8; 64];
  if key.len() > 64 {
    k[..32].copy_from_slice(&Sha256::digest(key));
  } else {
    k[..key.len()].copy_from_slice(key);
  }
  let mut ipad = [0x36u8; 64];
  let mut opad = [0x5cu8; 64];
  for i in 0..64 {
    ipad[i] ^= k[i];
    opad[i] ^= k[i];
  }
  let mut h = Sha256::new();
  h.update(ipad);
  h.update(msg);
  let inner = h.finalize();
  let mut h = Sha256::new();
  h.update(opad);
  h.update(inner);
  h.finalize().into()
}

pub fn to_hex(b: &[u8]) -> String {
  b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn from_hex32(s: &str) -> Option<[u8; 32]> {
  let s = s.trim();
  if s.len() != 64 {
    return None;
  }
  let mut out = [0u8; 32];
  for i in 0..32 {
    out[i] = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
  }
  Some(out)
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
  if a.len() != b.len() {
    return false;
  }
  let mut d = 0u8;
  for (x, y) in a.iter().zip(b.iter()) {
    d |= x ^ y;
  }
  d == 0
}

/// 同步目录里的相对路径：1–3 段，每段 1–80 个 [A-Za-z0-9._-]，不以点开头
pub fn path_ok(p: &str, max_segs: usize, allow_empty: bool) -> bool {
  if p.is_empty() {
    return allow_empty;
  }
  let segs: Vec<&str> = p.split('/').collect();
  if segs.len() > max_segs {
    return false;
  }
  segs.iter().all(|s| !s.is_empty() && s.len() <= 80 && !s.starts_with('.') && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-'))
}

struct Offer {
  auth: [u8; 32],
  bundle: Vec<u8>,
  expires: u64,
}

pub struct LanState {
  root: PathBuf,
  auth: Mutex<Option<[u8; 32]>>,
  offer: Mutex<Option<Offer>>,
  nonces: Mutex<HashMap<String, u64>>,
  write: Mutex<()>,
}

impl LanState {
  pub fn new(root: PathBuf) -> Arc<Self> {
    Arc::new(Self { root, auth: Mutex::new(None), offer: Mutex::new(None), nonces: Mutex::new(HashMap::new()), write: Mutex::new(()) })
  }
  pub fn set_auth(&self, k: Option<[u8; 32]>) {
    *self.auth.lock().unwrap() = k;
  }
  pub fn set_offer(&self, auth: [u8; 32], bundle: Vec<u8>, ttl_ms: u64) {
    *self.offer.lock().unwrap() = Some(Offer { auth, bundle, expires: now_ms() + ttl_ms.min(30 * 60_000) });
  }
  pub fn clear_offer(&self) {
    *self.offer.lock().unwrap() = None;
  }
  fn file(&self, rel: &str) -> PathBuf {
    let mut p = self.root.clone();
    for s in rel.split('/') {
      p.push(s);
    }
    p
  }
}

pub trait Notify: Send + Sync + 'static {
  fn changed(&self, path: &str);
}

/// 核签名：头 = 毫秒.随机串.签名
pub fn verify(key: &[u8; 32], header: Option<&str>, method: &str, url: &str, nonces: &Mutex<HashMap<String, u64>>, now: u64) -> Result<(), &'static str> {
  let h = header.ok_or("unsigned")?;
  let mut it = h.trim().splitn(3, '.');
  let (ts, nonce, sig) = (it.next().unwrap_or(""), it.next().unwrap_or(""), it.next().unwrap_or(""));
  let ts: u64 = ts.parse().map_err(|_| "bad signature")?;
  if nonce.len() < 8 || nonce.len() > 64 || !nonce.bytes().all(|c| c.is_ascii_alphanumeric()) {
    return Err("bad signature");
  }
  if ts + SKEW_MS < now || ts > now + SKEW_MS {
    return Err("clock skew");
  }
  let want = to_hex(&hmac_sha256(key, format!("{method}\n{url}\n{ts}\n{nonce}").as_bytes()));
  if !ct_eq(want.as_bytes(), sig.as_bytes()) {
    return Err("bad signature");
  }
  let mut ns = nonces.lock().unwrap();
  ns.retain(|_, t| *t + NONCE_TTL_MS > now);
  if ns.contains_key(nonce) {
    return Err("replay");
  }
  ns.insert(nonce.to_string(), now);
  Ok(())
}

fn header<'a>(r: &'a tiny_http::Request, name: &str) -> Option<&'a str> {
  r.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
}

fn respond(r: tiny_http::Request, status: u16, body: Vec<u8>, ctype: &str) {
  let mut resp = tiny_http::Response::from_data(body).with_status_code(status);
  for (k, v) in [("Content-Type", ctype), ("Cache-Control", "no-store"), ("X-Content-Type-Options", "nosniff")] {
    if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
      resp.add_header(h);
    }
  }
  let _ = r.respond(resp);
}

fn json(r: tiny_http::Request, status: u16, body: String) {
  respond(r, status, body.into_bytes(), "application/json; charset=utf-8");
}

fn err(r: tiny_http::Request, status: u16, msg: &str) {
  json(r, status, format!("{{\"error\":\"{msg}\"}}"));
}

fn esc(s: &str) -> String {
  s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn list(st: &LanState, dir: &str) -> String {
  let base = if dir.is_empty() { st.root.clone() } else { st.file(dir) };
  let mut out: Vec<(String, u64, String, bool)> = Vec::new();
  if let Ok(rd) = fs::read_dir(&base) {
    for e in rd.flatten() {
      let name = e.file_name().to_string_lossy().to_string();
      if name.starts_with('.') || !path_ok(&name, 1, false) {
        continue;
      }
      let Ok(md) = e.metadata() else { continue };
      let rel = if dir.is_empty() { name.clone() } else { format!("{dir}/{name}") };
      let mt = md.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
      out.push((rel, if md.is_dir() { 0 } else { md.len() }, format!("{mt:x}-{:x}", md.len()), md.is_dir()));
    }
  }
  out.sort_by(|a, b| a.0.cmp(&b.0));
  let items: Vec<String> = out.iter().map(|(p, s, e, d)| format!("{{\"path\":\"{}\",\"size\":{s},\"etag\":\"{e}\",\"dir\":{d}}}", esc(p))).collect();
  format!("[{}]", items.join(","))
}

fn write_file(st: &LanState, rel: &str, data: &[u8], if_none: bool) -> Result<bool, String> {
  let _g = st.write.lock().unwrap();
  let target = st.file(rel);
  if if_none && target.exists() {
    return Ok(false);
  }
  let dir = target.parent().map(Path::to_path_buf).unwrap_or_else(|| st.root.clone());
  fs::create_dir_all(&dir).map_err(|_| "mkdir failed".to_string())?;
  let mut rnd = [0u8; 6];
  let _ = getrandom::fill(&mut rnd);
  let tmp = dir.join(format!(".tmp-{}", to_hex(&rnd)));
  fs::write(&tmp, data).map_err(|_| "write failed".to_string())?;
  if let Err(_) = fs::rename(&tmp, &target) {
    let _ = fs::remove_file(&tmp);
    return Err("rename failed".into());
  }
  Ok(true)
}

/// 处理一个请求
pub fn handle(mut r: tiny_http::Request, st: &LanState, notify: &dyn Notify) {
  let method = r.method().as_str().to_ascii_uppercase();
  let url = r.url().to_string();
  let (path, query) = match url.split_once('?') {
    Some((p, q)) => (p.to_string(), q.to_string()),
    None => (url.clone(), String::new()),
  };
  if method == "GET" && path == "/lan/hello" {
    return json(r, 200, format!("{{\"app\":\"glean\",\"v\":1,\"now\":{}}}", now_ms()));
  }
  let sig = header(&r, "X-Glean-Lan").map(str::to_string);
  let now = now_ms();
  if method == "GET" && path == "/lan/v1/pair" {
    let mut g = st.offer.lock().unwrap();
    let Some(o) = g.as_ref() else { drop(g); return err(r, 404, "no pairing") };
    if o.expires < now {
      *g = None;
      drop(g);
      return err(r, 410, "pairing expired");
    }
    if verify(&o.auth, sig.as_deref(), &method, &url, &st.nonces, now).is_err() {
      drop(g);
      return err(r, 401, "unauthorized");
    }
    let bundle = g.take().map(|o| o.bundle).unwrap_or_default();
    drop(g);
    notify.changed("pair");
    return respond(r, 200, bundle, "application/octet-stream");
  }
  let Some(key) = *st.auth.lock().unwrap() else { return err(r, 503, "not ready") };
  if let Err(e) = verify(&key, sig.as_deref(), &method, &url, &st.nonces, now) {
    return err(r, 401, e);
  }
  if method == "GET" && path == "/lan/v1/list" {
    let dir = query.split('&').find_map(|kv| kv.strip_prefix("dir=")).unwrap_or("").replace("%2F", "/").replace("%2f", "/");
    let dir = dir.trim_matches('/').to_string();
    if !path_ok(&dir, 2, true) {
      return err(r, 400, "bad dir");
    }
    return json(r, 200, list(st, &dir));
  }
  let Some(rel) = path.strip_prefix("/lan/v1/f/") else { return err(r, 404, "not found") };
  let rel = rel.to_string();
  if !path_ok(&rel, 3, false) {
    return err(r, 400, "bad path");
  }
  match method.as_str() {
    "GET" => match fs::read(st.file(&rel)) {
      Ok(b) => respond(r, 200, b, "application/octet-stream"),
      Err(_) => err(r, 404, "not found"),
    },
    "PUT" => {
      let if_none = header(&r, "If-None-Match").map(|v| v.trim() == "*").unwrap_or(false);
      if r.body_length().unwrap_or(0) > MAX_FILE {
        return err(r, 413, "too large");
      }
      let mut buf = Vec::new();
      if r.as_reader().take(MAX_FILE as u64 + 1).read_to_end(&mut buf).is_err() || buf.len() > MAX_FILE {
        return err(r, 413, "too large");
      }
      match write_file(st, &rel, &buf, if_none) {
        Ok(true) => {
          notify.changed(&rel);
          json(r, 201, "{\"ok\":true}".into())
        }
        Ok(false) => err(r, 412, "exists"),
        Err(e) => err(r, 500, &e),
      }
    }
    "DELETE" => {
      let _g = st.write.lock().unwrap();
      let _ = fs::remove_file(st.file(&rel));
      drop(_g);
      notify.changed(&rel);
      respond(r, 204, Vec::new(), "text/plain")
    }
    _ => err(r, 405, "method not allowed"),
  }
}

/// 起服务（0.0.0.0）：先试 port，被占了换随机端口。返回 (句柄, 实际端口)
pub fn serve(port: u16, st: Arc<LanState>, notify: Arc<dyn Notify>) -> Result<(Arc<tiny_http::Server>, u16), String> {
  let server = tiny_http::Server::http(("0.0.0.0", port)).or_else(|_| tiny_http::Server::http(("0.0.0.0", 0))).map_err(|_| "no port available".to_string())?;
  let real = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
  let server = Arc::new(server);
  let s2 = server.clone();
  thread::spawn(move || {
    for req in s2.incoming_requests() {
      let st = st.clone();
      let notify = notify.clone();
      thread::spawn(move || handle(req, &st, notify.as_ref()));
    }
  });
  Ok((server, real))
}

/// 本机在局域网里的 IPv4（不发包：UDP connect 只选路由）
pub fn local_addrs() -> Vec<String> {
  let mut out = Vec::new();
  for probe in ["192.168.1.1:9", "10.255.255.255:9", "172.16.0.1:9", "8.8.8.8:9"] {
    if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") {
      if s.connect(probe).is_ok() {
        if let Ok(a) = s.local_addr() {
          let ip = a.ip();
          if let std::net::IpAddr::V4(v4) = ip {
            if !v4.is_loopback() && !v4.is_unspecified() && (v4.is_private() || v4.is_link_local()) {
              let s = v4.to_string();
              if !out.contains(&s) {
                out.push(s);
              }
            }
          }
        }
      }
    }
  }
  out
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn hmac_rfc4231_case2() {
    let m = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
    assert_eq!(to_hex(&m), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  }
  #[test]
  fn paths() {
    assert!(path_ok("ops/01J/00000001.op", 3, false));
    assert!(!path_ok("../x", 3, false));
    assert!(!path_ok("ops/.x", 3, false));
    assert!(!path_ok("a/b/c/d", 3, false));
    assert!(path_ok("", 2, true));
  }
}
