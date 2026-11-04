//! v0.44 外壳的纯逻辑（不依赖 tauri，可以单独 cargo test）

/// crash.txt 的一行：时间（Unix 秒）| 版本 | 原因 @ 位置。原因压成一行、最多 600 字
pub fn crash_line(secs: u64, ver: &str, why: &str, at: &str) -> String {
  let one: String = why.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(600).collect();
  if at.is_empty() { format!("{secs} | {ver} | {one}") } else { format!("{secs} | {ver} | {one} @ {at}") }
}

#[allow(dead_code)]
/// 暂停是不是还有效（过了 limit 秒自动恢复）
pub fn still_paused(elapsed: u64, limit: u64) -> bool {
  elapsed < limit
}

#[allow(dead_code)]
/// 窗口放进屏幕正中（窗口比屏幕大就贴左上角）
pub fn center_in(pos: (i32, i32), screen: (u32, u32), win: (u32, u32)) -> (i32, i32) {
  let dx = (screen.0 as i64 - win.0 as i64).max(0) / 2;
  let dy = (screen.1 as i64 - win.1 as i64).max(0) / 2;
  (pos.0 + dx as i32, pos.1 + dy as i32)
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn crash_line_is_one_line_and_capped() {
    let l = crash_line(1700000000, "0.44.0", "boom\n  at  here", "src/lib.rs:12");
    assert_eq!(l, "1700000000 | 0.44.0 | boom at here @ src/lib.rs:12");
    let long = "字".repeat(2000);
    assert_eq!(crash_line(1, "v", &long, "").chars().count(), "1 | v | ".chars().count() + 600);
    assert!(!crash_line(1, "v", "a\nb", "x:1").contains('\n'));
  }
  #[test]
  fn pause_expires_after_an_hour() {
    assert!(still_paused(0, 3600));
    assert!(still_paused(3599, 3600));
    assert!(!still_paused(3600, 3600));
  }
  #[test]
  fn centers_on_second_monitor() {
    assert_eq!(center_in((1920, 0), (2560, 1440), (1100, 760)), (1920 + 730, 340));
    assert_eq!(center_in((-1280, 0), (1280, 720), (1400, 900)), (-1280, 0));
  }
}
