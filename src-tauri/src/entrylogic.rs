//! v0.33 系统入口的纯逻辑（不依赖 tauri / windows），本地 cargo test 能跑。

pub const MAX_FILES: usize = 20;
pub const MAX_BYTES: u64 = 12 * 1024 * 1024;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Hotkeys {
  /// 唤出速记小窗（空 = 关）
  pub quick: String,
  /// 0507 选中文字直接存成摘抄（默认关：Ctrl+Shift+C 也是浏览器开发者工具的键）
  pub excerpt: String,
  /// 0004 唤出小窗时带上选中的文字
  pub grab: bool,
}

impl Default for Hotkeys {
  fn default() -> Self {
    Hotkeys { quick: "ctrl+shift+l".into(), excerpt: String::new(), grab: true }
  }
}

/// 热键必须带 Ctrl / Alt / Win 之一 + 一个普通键；系统常用键（复制粘贴、Alt+Tab、Win+L…）不让占
pub fn check_accel(acc: &str) -> Result<(), &'static str> {
  let parts: Vec<String> = acc.split('+').map(|x| x.trim().to_lowercase()).filter(|x| !x.is_empty()).collect();
  if parts.is_empty() {
    return Err("空的");
  }
  let is_mod = |x: &str| matches!(x, "ctrl" | "control" | "alt" | "shift" | "super" | "win" | "cmd" | "commandorcontrol" | "cmdorctrl");
  let mods: Vec<&String> = parts.iter().filter(|x| is_mod(x)).collect();
  let keys: Vec<&String> = parts.iter().filter(|x| !is_mod(x)).collect();
  if keys.len() != 1 {
    return Err("要一个普通键");
  }
  if !mods.iter().any(|m| m.as_str() != "shift") {
    return Err("要带 Ctrl / Alt / Win");
  }
  let k = keys[0].as_str();
  let only = |m: &str| mods.len() == 1 && mods[0] == m;
  let ctrl = only("ctrl") || only("control") || only("commandorcontrol") || only("cmdorctrl");
  if ctrl && matches!(k, "c" | "v" | "x" | "z" | "y" | "a" | "s" | "f" | "w" | "n" | "t" | "p") {
    return Err("这是系统常用键");
  }
  if only("alt") && matches!(k, "tab" | "f4" | "space" | "esc" | "escape") {
    return Err("这是系统常用键");
  }
  if (only("super") || only("win")) && matches!(k, "l" | "d" | "e" | "r" | "tab") {
    return Err("这是系统常用键");
  }
  Ok(())
}

#[derive(Default, Debug, PartialEq)]
pub struct Args {
  pub hidden: bool,
  pub send: Vec<String>,
  pub links: Vec<String>,
}

/// 命令行：Glean.exe [--hidden] [--send 文件…] [glean://…]（第一个是程序自己，跳过）
pub fn parse_args(args: &[String]) -> Args {
  let mut a = Args::default();
  let mut send = false;
  for x in args.iter().skip(1) {
    if x == "--hidden" {
      a.hidden = true;
    } else if x == "--send" {
      send = true;
    } else if is_glean_link(x) {
      a.links.push(x.clone());
    } else if send && !x.starts_with("--") {
      a.send.push(x.clone());
    }
  }
  a
}

pub fn is_glean_link(s: &str) -> bool {
  s.len() <= 8192 && s.get(..8).is_some_and(|p| p.eq_ignore_ascii_case("glean://"))
}

pub fn is_web_url(s: &str) -> bool {
  let l = s.trim_start().to_ascii_lowercase();
  (l.starts_with("https://") || l.starts_with("http://")) && s.len() <= 8192 && !s.chars().any(|c| c.is_control())
}

/// 「发送到」只收图片和纯文字文件
pub fn guess_mime(name: &str) -> Option<&'static str> {
  let ext = name.rsplit('.').next()?.to_ascii_lowercase();
  Some(match ext.as_str() {
    "png" => "image/png",
    "jpg" | "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "webp" => "image/webp",
    "bmp" => "image/bmp",
    "txt" => "text/plain",
    "md" | "markdown" => "text/markdown",
    _ => return None,
  })
}

/// 抓到的选中文字：去首尾空白、统一换行、最多 4000 字
pub fn clip_text(s: &str) -> String {
  let t = s.replace("\r\n", "\n");
  t.trim().chars().take(4000).collect()
}

/// RGBA → PNG（快速压缩；图太大不给，免得 IPC 拖住）
pub fn encode_png(rgba: &[u8], w: u32, h: u32) -> Option<Vec<u8>> {
  if w == 0 || h == 0 || (w as u64) * (h as u64) > 40_000_000 || rgba.len() != (w as usize) * (h as usize) * 4 {
    return None;
  }
  let mut out = Vec::new();
  {
    let mut enc = png::Encoder::new(&mut out, w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    let mut wr = enc.write_header().ok()?;
    wr.write_image_data(rgba).ok()?;
  }
  Some(out)
}

#[cfg(test)]
mod tests {
  use super::*;
  fn v(a: &[&str]) -> Vec<String> {
    a.iter().map(|x| x.to_string()).collect()
  }
  #[test]
  fn accel() {
    assert!(check_accel("ctrl+shift+l").is_ok());
    assert!(check_accel("Alt+Shift+K").is_ok());
    assert!(check_accel("ctrl+c").is_err());
    assert!(check_accel("shift+l").is_err());
    assert!(check_accel("ctrl+shift").is_err());
    assert!(check_accel("alt+tab").is_err());
    assert!(check_accel("super+l").is_err());
    assert!(check_accel("ctrl+shift+c").is_ok());
  }
  #[test]
  fn args() {
    let a = parse_args(&v(&["Glean.exe", "--send", "C:\\a.png", "D:\\b.txt"]));
    assert_eq!(a.send, v(&["C:\\a.png", "D:\\b.txt"]));
    assert!(!a.hidden);
    let b = parse_args(&v(&["Glean.exe", "--hidden"]));
    assert!(b.hidden && b.send.is_empty());
    let c = parse_args(&v(&["Glean.exe", "glean://item/01ABC", "C:\\x.png"]));
    assert_eq!(c.links, v(&["glean://item/01ABC"]));
    assert!(c.send.is_empty());
  }
  #[test]
  fn mime_and_links() {
    assert_eq!(guess_mime("截图.PNG"), Some("image/png"));
    assert_eq!(guess_mime("a.exe"), None);
    assert!(is_glean_link("GLEAN://capture?text=x"));
    assert!(!is_glean_link("https://x"));
    assert!(is_web_url("https://music.163.com/song?id=1"));
    assert!(!is_web_url("file:///C:/x"));
    assert!(!is_web_url("javascript:alert(1)"));
  }
  #[test]
  fn png_roundtrip() {
    let p = encode_png(&[255, 0, 0, 255, 0, 255, 0, 255], 2, 1).unwrap();
    assert_eq!(&p[1..4], b"PNG");
    assert!(encode_png(&[0; 3], 1, 1).is_none());
  }
  #[test]
  fn text() {
    assert_eq!(clip_text("  a\r\nb  "), "a\nb");
  }
}
