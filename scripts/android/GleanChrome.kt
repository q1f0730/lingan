package __PKG__

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * v0.27 系统外框（0410 全面屏 / 0416 状态栏跟主题 / 0401 键盘）。只用平台 API，不依赖 androidx。
 * - Android 11+：内容画到状态栏和手势条下面（边到边），状态栏 / 刘海 / 手势条的尺寸（dp）写进 CSS 变量 --safe-t/-b/-l/-r；
 *   键盘弹出时把 WebView 底边抬到键盘上沿（效果等同 adjustResize），网页里的速记条自然贴住键盘。
 * - Android 9–10：保持系统默认布局，只把状态栏底色和图标深浅换成当前主题。
 * JS 桥 LinganChrome：insets() 读当前安全区，setTheme(dark, bg) 换状态栏 / 导航栏图标深浅。
 */
class ChromeBridge(private val act: Activity) {
  @Volatile private var last: String = ""
  @Volatile private var dark: Boolean = false
  private var web: java.lang.ref.WeakReference<WebView>? = null

  fun attach(webView: WebView) {
    web = java.lang.ref.WeakReference(webView)
    if (Build.VERSION.SDK_INT < 30) return
    try {
      act.window.setDecorFitsSystemWindows(false)
      @Suppress("DEPRECATION")
      act.window.statusBarColor = Color.TRANSPARENT
      @Suppress("DEPRECATION")
      act.window.navigationBarColor = Color.TRANSPARENT
      if (Build.VERSION.SDK_INT >= 29) act.window.isNavigationBarContrastEnforced = false
    } catch (e: Exception) {
      return
    }
    val density = act.resources.displayMetrics.density
    webView.setOnApplyWindowInsetsListener { v, ins ->
      val bars = ins.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
      val ime = ins.getInsets(WindowInsets.Type.ime())
      val imeOn = ime.bottom > bars.bottom
      // 键盘：抬高 WebView 底边（布局视口跟着缩，和以前 adjustResize 一样）
      (v.layoutParams as? ViewGroup.MarginLayoutParams)?.let { lp ->
        val want = if (imeOn) ime.bottom else 0
        if (lp.bottomMargin != want) {
          lp.bottomMargin = want
          v.layoutParams = lp
        }
      }
      val o = JSONObject()
      o.put("t", (bars.top / density).toDouble())
      o.put("b", if (imeOn) 0.0 else (bars.bottom / density).toDouble())
      o.put("l", (bars.left / density).toDouble())
      o.put("r", (bars.right / density).toDouble())
      val js = o.toString()
      if (js != last) {
        last = js
        push(js)
      }
      ins
    }
    webView.requestApplyInsets()
  }

  private fun push(js: String) {
    val w = web?.get() ?: return
    w.post {
      try {
        w.evaluateJavascript("window.dispatchEvent(new CustomEvent('glean:insets',{detail:$js}))", null)
      } catch (e: Exception) {}
    }
  }

  @JavascriptInterface
  fun insets(): String = last

  /** v0.44 0567：最近任务里不显示画面（也不能截屏）。前端按设置 / 有没有上锁 PIN 调 */
  @JavascriptInterface
  fun secure(on: Boolean) {
    act.runOnUiThread {
      try {
        if (on) act.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else act.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      } catch (e: Exception) {}
    }
  }

  @JavascriptInterface
  fun setTheme(isDark: Boolean, bg: String) {
    dark = isDark
    act.runOnUiThread {
      try {
        val w = act.window
        if (Build.VERSION.SDK_INT >= 30) {
          val mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
          w.insetsController?.setSystemBarsAppearance(if (isDark) 0 else mask, mask)
        } else {
          val c = try { Color.parseColor(bg) } catch (e: Exception) { if (isDark) Color.BLACK else Color.WHITE }
          @Suppress("DEPRECATION")
          w.statusBarColor = c
          @Suppress("DEPRECATION")
          w.navigationBarColor = c
          @Suppress("DEPRECATION")
          val f = w.decorView.systemUiVisibility
          @Suppress("DEPRECATION")
          val light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or (if (Build.VERSION.SDK_INT >= 26) View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR else 0)
          @Suppress("DEPRECATION")
          w.decorView.systemUiVisibility = if (isDark) f and light.inv() else f or light
        }
      } catch (e: Exception) {}
    }
  }
}
