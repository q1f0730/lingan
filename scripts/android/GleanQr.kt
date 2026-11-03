package __PKG__

import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.JavascriptInterface
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

// v0.32 局域网直连扫码：WebView 里 getUserMedia 拿相机画面，每隔一会儿把一帧 JPEG（base64）交给这里，
// 用 ZXing（Apache-2.0，纯 Java，不依赖 Google 服务——国内安卓也能用）认二维码，认不出返回空串。
class QrBridge {
  private val hints = mapOf(DecodeHintType.TRY_HARDER to true, DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))

  @JavascriptInterface
  fun decode(jpegB64: String): String {
    return try {
      val bytes = Base64.decode(jpegB64, Base64.DEFAULT)
      if (bytes.size > 6 * 1024 * 1024) return ""
      val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return ""
      val w = bmp.width
      val h = bmp.height
      val px = IntArray(w * h)
      bmp.getPixels(px, 0, w, 0, 0, w, h)
      bmp.recycle()
      val src = RGBLuminanceSource(w, h, px)
      val reader = QRCodeReader()
      try {
        reader.decode(BinaryBitmap(HybridBinarizer(src)), hints).text ?: ""
      } catch (e: Exception) {
        // 深色主题截图（白块黑底）：反色再试一次
        reader.decode(BinaryBitmap(HybridBinarizer(src.invert())), hints).text ?: ""
      }
    } catch (e: Throwable) {
      ""
    }
  }
}
