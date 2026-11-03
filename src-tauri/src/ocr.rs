//! v0.36 0020：图片里的字 —— Windows 自带的 Windows.Media.Ocr（离线、免模型、免 key）。
//! 前端把图（PNG / JPEG 原始字节，边长已缩到引擎上限内）直接作为请求体发过来，回一段文字。
//! 优先简体中文；没装中文 OCR 语言包就退回系统语言；都没有 → Err("nolang")，前端提示去系统设置装语言包。

#[tauri::command]
pub async fn ocr_image(request: tauri::ipc::Request<'_>) -> Result<String, String> {
  let bytes = match request.body() {
    tauri::ipc::InvokeBody::Raw(b) => b.clone(),
    _ => return Err("要原始图片字节".into()),
  };
  if bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 {
    return Err("图片太大或是空的".into());
  }
  imp::run(&bytes)
}

#[cfg(windows)]
mod imp {
  use crate::entrylogic::{join_lines, join_words};
  use windows::Globalization::Language;
  use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
  use windows::Media::Ocr::OcrEngine;
  use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
  use windows::core::HSTRING;

  fn engine() -> Option<OcrEngine> {
    for tag in ["zh-Hans-CN", "zh-Hans", "zh-CN"] {
      if let Ok(lang) = Language::CreateLanguage(&HSTRING::from(tag)) {
        if OcrEngine::IsLanguageSupported(&lang).unwrap_or(false) {
          if let Ok(e) = OcrEngine::TryCreateFromLanguage(&lang) {
            return Some(e);
          }
        }
      }
    }
    OcrEngine::TryCreateFromUserProfileLanguages().ok()
  }

  fn recognize(bytes: &[u8]) -> windows::core::Result<Option<String>> {
    let Some(eng) = engine() else { return Ok(None) };
    let stream = InMemoryRandomAccessStream::new()?;
    let w = DataWriter::CreateDataWriter(&stream)?;
    w.WriteBytes(bytes)?;
    w.StoreAsync()?.get()?;
    w.FlushAsync()?.get()?;
    w.DetachStream()?;
    stream.Seek(0)?;
    let dec = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let mut bmp: SoftwareBitmap = dec.GetSoftwareBitmapAsync()?.get()?;
    if bmp.BitmapPixelFormat()? != BitmapPixelFormat::Bgra8 && bmp.BitmapPixelFormat()? != BitmapPixelFormat::Gray8 {
      bmp = SoftwareBitmap::Convert(&bmp, BitmapPixelFormat::Bgra8)?;
    }
    let res = eng.RecognizeAsync(&bmp)?.get()?;
    let mut lines = Vec::new();
    for l in res.Lines()? {
      let words: Vec<String> = l.Words()?.into_iter().filter_map(|w| w.Text().ok().map(|t| t.to_string())).collect();
      lines.push(join_words(&words));
    }
    Ok(Some(join_lines(&lines)))
  }

  pub fn run(bytes: &[u8]) -> Result<String, String> {
    match recognize(bytes) {
      Ok(Some(t)) => Ok(t),
      Ok(None) => Err("nolang".into()),
      Err(e) => Err(format!("识别失败：{}", e.message())),
    }
  }
}

#[cfg(not(windows))]
mod imp {
  pub fn run(_bytes: &[u8]) -> Result<String, String> {
    Err("unsupported".into())
  }
}
