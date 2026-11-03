package __PKG__

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import org.json.JSONObject

// v0.36「说一句就收」：只用系统自带的语音识别，不往安装包里塞模型。
// 1) 系统有识别服务（SpeechRecognizer.isRecognitionAvailable）：按住「说」开始收音，松手 stop，结果由 poll() 交给 JS；
//    要 RECORD_AUDIO，第一次按时才弹系统权限框（start 返回 perm，允许后再按）。
// 2) 没有服务但有系统语音输入框（RecognizerIntent）：打开它，结果在 onActivityResult 里收（不需要麦克风权限）。
// 3) 都没有：返回 none，JS 明说「这台手机没有系统语音识别」。断网等错误把 SpeechRecognizer 的错误码交给 JS 翻成人话。
class VoiceBridge(private val act: Activity) {
  companion object {
    const val REQ_PERM = 4343
    const val REQ_DIALOG = 4344
  }

  private var rec: SpeechRecognizer? = null
  @Volatile private var state = "idle"
  @Volatile private var text = ""
  @Volatile private var err = 0

  private fun intent(): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
    .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)

  private fun best(b: Bundle?): String = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""

  @JavascriptInterface
  fun start(): String {
    text = ""
    err = 0
    if (SpeechRecognizer.isRecognitionAvailable(act)) {
      if (act.checkSelfPermission("android.permission.RECORD_AUDIO") != PackageManager.PERMISSION_GRANTED) {
        act.runOnUiThread { act.requestPermissions(arrayOf("android.permission.RECORD_AUDIO"), REQ_PERM) }
        return "perm"
      }
      state = "listening"
      act.runOnUiThread { listen() }
      return "listening"
    }
    val i = intent()
    if (i.resolveActivity(act.packageManager) != null) {
      state = "listening"
      act.runOnUiThread {
        try {
          @Suppress("DEPRECATION")
          act.startActivityForResult(i, REQ_DIALOG)
        } catch (e: Exception) {
          state = "error"
          err = 5
        }
      }
      return "dialog"
    }
    return "none"
  }

  private fun listen() {
    try {
      rec?.destroy()
      val r = SpeechRecognizer.createSpeechRecognizer(act)
      rec = r
      r.setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
        override fun onPartialResults(partialResults: Bundle?) {
          val t = best(partialResults)
          if (t.isNotEmpty()) text = t
        }
        override fun onResults(results: Bundle?) {
          val t = best(results)
          if (t.isNotEmpty()) text = t
          state = "done"
        }
        override fun onError(error: Int) {
          // 松手太快没说话：有部分结果就当结果
          if (text.isNotEmpty() && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) state = "done"
          else {
            err = error
            state = "error"
          }
        }
      })
      r.startListening(intent())
    } catch (e: Exception) {
      err = 5
      state = "error"
    }
  }

  @JavascriptInterface
  fun stop() {
    act.runOnUiThread {
      try {
        rec?.stopListening()
      } catch (e: Exception) {
      }
    }
  }

  @JavascriptInterface
  fun poll(): String {
    val o = JSONObject().put("state", state).put("text", text).put("err", err)
    if (state == "done" || state == "error") state = "idle"
    return o.toString()
  }

  /** MainActivity.onActivityResult 转过来（系统语音输入框的结果） */
  fun onResult(requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQ_DIALOG) return
    val t = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
    if (resultCode == Activity.RESULT_OK && t.isNotEmpty()) {
      text = t
      state = "done"
    } else {
      err = 7
      state = "error"
    }
  }

  fun destroy() {
    try {
      rec?.destroy()
    } catch (e: Exception) {
    }
    rec = null
  }
}
