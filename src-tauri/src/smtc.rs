//! v0.22 Windows「正在播放一键拾」：经系统媒体传输控件（SMTC）读当前播放的歌。
//! 只读标题 / 歌手 / 专辑 / 来源 App / 封面缩略图，不控制播放，不需要任何权限。

#[derive(serde::Serialize, Clone, Debug, Default)]
pub struct NowPlaying {
  pub title: String,
  pub artist: String,
  pub album: String,
  /// SourceAppUserModelId，例如 Spotify.exe / cloudmusic.exe；前端映射成中文名
  pub app: String,
  /// 封面（data URL），拿不到就是 None
  pub image: Option<String>,
}

#[allow(dead_code)]
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

#[allow(dead_code)]
pub fn b64(data: &[u8]) -> String {
  let mut s = String::with_capacity((data.len() + 2) / 3 * 4);
  for c in data.chunks(3) {
    let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
    s.push(B64[(n >> 18) as usize & 63] as char);
    s.push(B64[(n >> 12) as usize & 63] as char);
    s.push(if c.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
    s.push(if c.len() > 2 { B64[n as usize & 63] as char } else { '=' });
  }
  s
}

#[cfg(windows)]
mod imp {
  use super::{b64, NowPlaying};
  use windows::Media::Control::{GlobalSystemMediaTransportControlsSessionManager as Manager, GlobalSystemMediaTransportControlsSessionMediaProperties as Props};
  use windows::Storage::Streams::{DataReader, IInputStream};
  use windows::core::Interface;

  fn thumb(props: &Props) -> windows::core::Result<Option<String>> {
    let r = props.Thumbnail()?;
    let s = r.OpenReadAsync()?.get()?;
    let size = s.Size()?;
    if size == 0 || size > 4 * 1024 * 1024 {
      return Ok(None);
    }
    let input: IInputStream = s.cast()?;
    let reader = DataReader::CreateDataReader(&input)?;
    let got = reader.LoadAsync(size as u32)?.get()?;
    let mut buf = vec![0u8; got as usize];
    reader.ReadBytes(&mut buf)?;
    let ct = s.ContentType().map(|h| h.to_string()).unwrap_or_default();
    let mime = if ct.starts_with("image/") { ct } else { "image/png".to_string() };
    Ok(Some(format!("data:{};base64,{}", mime, b64(&buf))))
  }

  pub fn read() -> Result<Option<NowPlaying>, String> {
    let mgr = Manager::RequestAsync().and_then(|op| op.get()).map_err(|_| "媒体控件不可用".to_string())?;
    let session = match mgr.GetCurrentSession() {
      Ok(s) => s,
      Err(_) => return Ok(None),
    };
    let props = session.TryGetMediaPropertiesAsync().and_then(|op| op.get()).map_err(|_| "读不到正在播放的信息".to_string())?;
    let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
    if title.trim().is_empty() {
      return Ok(None);
    }
    let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
    let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
    let app = session.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
    let image = thumb(&props).ok().flatten();
    Ok(Some(NowPlaying { title, artist, album, app, image }))
  }
}

#[cfg(windows)]
pub use imp::read;

#[cfg(not(windows))]
pub fn read() -> Result<Option<NowPlaying>, String> {
  Err("unsupported".into())
}

#[cfg(test)]
mod tests {
  #[test]
  fn base64() {
    assert_eq!(super::b64(b""), "");
    assert_eq!(super::b64(b"f"), "Zg==");
    assert_eq!(super::b64(b"fo"), "Zm8=");
    assert_eq!(super::b64(b"foo"), "Zm9v");
    assert_eq!(super::b64(b"foobar"), "Zm9vYmFy");
  }
}
