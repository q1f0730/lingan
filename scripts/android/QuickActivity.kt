package __PKG__

// v0.22「极速拾」半屏面板：透明主题的原生 Activity，不启动 WebView。
// 入口：系统分享（文字 / 图片）、长按选字菜单「拾穗」（PROCESS_TEXT）、磁贴、小部件、长按图标、常驻通知。
// 预览 + 一行为什么 + 最近 3 个标签 + 存；存完写进收件箱、finish() 回到原来的 App。

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject

class QuickActivity : Activity() {
  private var mode = "note" // share | quote | paste | music | note
  private var text = ""
  private var subject = ""
  private var img: ByteArray? = null
  private var imgMime = "image/jpeg"
  private var pkg = ""
  private var source = ""
  private var song: Glean.Song? = null
  private var musicChecked = false
  private var pasteChecked = false
  private var done = false
  private var resumedOnce = false
  private val picked = LinkedHashSet<String>()

  private lateinit var sheet: LinearLayout
  private lateinit var body: LinearLayout
  private lateinit var srcView: TextView
  private var whyView: EditText? = null
  private var noteView: EditText? = null
  private var saveBtn: TextView? = null

  // Studio / Rewamp 同一套颜色（src/index.css 的 --surface / --fg / --fg-2 / --surface-2 / --accent）
  private var cSurface = 0
  private var cFg = 0
  private var cFg2 = 0
  private var cChip = 0
  private var cChipOn = 0
  private var cChipOnFg = 0
  private var cPrimary = 0
  private var cOnPrimary = 0

  private fun dp(v: Int): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val dark = Glean.isDark(this)
    cSurface = if (dark) 0xFF211F25.toInt() else 0xFFFFFFFF.toInt()
    cFg = if (dark) 0xFFF3F0EA.toInt() else 0xFF1D1B18.toInt()
    cFg2 = if (dark) 0xFFA6A198.toInt() else 0xFF6B665E.toInt()
    cChip = if (dark) 0xFF2A2830.toInt() else 0xFFF0EDE7.toInt()
    cChipOn = 0xFFD4CBE5.toInt()
    cChipOnFg = 0xFF4A3F66.toInt()
    cPrimary = cFg
    cOnPrimary = if (dark) 0xFF17161A.toInt() else 0xFFF7F5F1.toInt()
    parse(intent)
    window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or if (mode == "note") WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE else WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN)
    build()
  }

  override fun onResume() {
    super.onResume()
    // 从系统「通知使用权」页回来时重新读一次正在播放
    if (mode == "music" && resumedOnce) {
      musicChecked = false
      fill()
    }
    resumedOnce = true
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    // 安卓 10+ 只有拿到焦点的前台界面能读剪贴板
    if (hasFocus && mode == "paste" && !pasteChecked) {
      pasteChecked = true
      try {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = cm.primaryClip
        if (clip != null && clip.itemCount > 0) text = clip.getItemAt(0).coerceToText(this)?.toString()?.trim() ?: ""
      } catch (e: Exception) {
      }
      fill()
    }
  }

  private fun parse(i: Intent?) {
    if (i == null) return
    when (i.action) {
      Intent.ACTION_SEND -> {
        mode = "share"
        text = i.getStringExtra(Intent.EXTRA_TEXT)?.trim() ?: ""
        subject = i.getStringExtra(Intent.EXTRA_SUBJECT)?.trim() ?: ""
        val type = i.type ?: ""
        if (type.startsWith("image/")) {
          try {
            val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_STREAM)
            if (uri != null) {
              val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
              if (bytes != null && bytes.size < 12 * 1024 * 1024) {
                img = bytes
                imgMime = type
              }
            }
          } catch (e: Exception) {
          }
        }
      }
      Intent.ACTION_PROCESS_TEXT -> {
        mode = "quote"
        text = i.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)?.toString()?.trim() ?: ""
      }
      else -> mode = i.getStringExtra("glean_mode")?.takeIf { it in setOf("note", "paste", "music") } ?: "note"
    }
    // 来源 App：选字菜单是 startActivityForResult 调起来的，callingPackage 最准；分享看 referrer
    val ref = referrer
    val fromRef = if (ref != null && ref.scheme == "android-app") ref.host else null
    pkg = Glean.cleanPkg(this, callingPackage ?: fromRef)
    source = Glean.appLabel(this, pkg)
  }

  private fun round(color: Int, r: Float, top: Boolean = false): GradientDrawable =
    GradientDrawable().apply {
      setColor(color)
      if (top) cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f) else cornerRadius = r
    }

  private fun tv(s: String, size: Float, color: Int, bold: Boolean = false): TextView =
    TextView(this).apply {
      text = s
      setTextColor(color)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
      if (bold) typeface = Typeface.DEFAULT_BOLD
    }

  private fun build() {
    val root = FrameLayout(this)
    root.setBackgroundColor(0x5C000000)
    root.setOnClickListener { cancel() }

    sheet = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(20), dp(18), dp(20), dp(14))
      background = round(cSurface, dp(24).toFloat(), top = true)
      isClickable = true // 点面板本身不关
    }
    val head = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val title = tv(
      when (mode) {
        "quote" -> "拾这句"
        "music" -> "拾这首歌"
        else -> "拾一穗"
      }, 17f, cFg, true,
    )
    head.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    srcView = tv(if (source.isNotEmpty()) "来自 $source" else "", 13f, cFg2)
    srcView.maxLines = 1
    srcView.ellipsize = TextUtils.TruncateAt.END
    head.addView(srcView)
    sheet.addView(head)

    body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    sheet.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })

    if (mode != "note") {
      val why = EditText(this).apply {
        hint = "（可选）为什么打动你？"
        setHintTextColor(cFg2)
        setTextColor(cFg)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        isSingleLine = true
        imeOptions = EditorInfo.IME_ACTION_DONE
        background = round(cChip, dp(14).toFloat())
        setPadding(dp(14), dp(10), dp(14), dp(10))
        setOnEditorActionListener { _, id, ev ->
          if (id == EditorInfo.IME_ACTION_DONE || (ev != null && ev.keyCode == KeyEvent.KEYCODE_ENTER && ev.action == KeyEvent.ACTION_DOWN)) {
            save()
            true
          } else false
        }
      }
      whyView = why
      sheet.addView(why, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
    }

    // 最近用过的 3 个标签（0056）：点一下就打上，再点取消
    val tags = Glean.recentTags(this)
    if (tags.isNotEmpty()) {
      val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
      for (t in tags) {
        val chip = tv("#$t", 13f, cFg)
        chip.setPadding(dp(12), dp(6), dp(12), dp(6))
        chip.background = round(cChip, dp(999).toFloat())
        chip.setOnClickListener {
          if (picked.contains(t)) picked.remove(t) else picked.add(t)
          val on = picked.contains(t)
          chip.background = round(if (on) cChipOn else cChip, dp(999).toFloat())
          chip.setTextColor(if (on) cChipOnFg else cFg)
          chip.typeface = if (on) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        }
        row.addView(chip, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { rightMargin = dp(8) })
      }
      sheet.addView(row, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
    }

    val actions = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL or Gravity.END
    }
    val cancel = tv("取消", 15f, cFg2)
    cancel.setPadding(dp(16), dp(12), dp(16), dp(12))
    cancel.setOnClickListener { cancel() }
    actions.addView(cancel)
    val save = tv("存", 16f, cOnPrimary, true)
    save.gravity = Gravity.CENTER
    save.minWidth = dp(96)
    save.setPadding(dp(24), dp(12), dp(24), dp(12))
    save.background = round(cPrimary, dp(999).toFloat())
    save.setOnClickListener { save() }
    saveBtn = save
    actions.addView(save)
    sheet.addView(actions, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(14) })

    root.addView(sheet, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    // 底部导航条 / 输入法让出来（targetSdk 35 起系统强制全面屏）
    val basePad = dp(14)
    root.setOnApplyWindowInsetsListener { _, insets ->
      val bottom = if (Build.VERSION.SDK_INT >= 30) {
        insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime()).bottom
      } else {
        @Suppress("DEPRECATION") insets.systemWindowInsetBottom
      }
      sheet.setPadding(sheet.paddingLeft, sheet.paddingTop, sheet.paddingRight, basePad + bottom)
      insets
    }
    setContentView(root)
    fill()
    // 轻轻滑上来（系统关了动画时 ValueAnimator 自动变成瞬时）
    sheet.translationY = dp(240).toFloat()
    sheet.alpha = 0f
    sheet.animate().translationY(0f).alpha(1f).setDuration(180).start()
  }

  private fun typeLabel(): String {
    val t = if (text.isNotEmpty()) text else subject
    return when {
      mode == "music" -> "音乐"
      mode == "quote" -> "摘抄 · 作者之后可以补"
      img != null -> "图片"
      Regex("https?://", RegexOption.IGNORE_CASE).containsMatchIn(t) -> "链接 · 打开拾穗后自动认出标题和封面"
      t.length > 60 || Regex("^[「“\"『].+[」”\"』]$", RegexOption.DOT_MATCHES_ALL).matches(t) -> "文案"
      else -> "想法"
    }
  }

  /** 按模式填预览区（正在播放 / 剪贴板会在拿到数据后再填一次） */
  private fun fill() {
    if (!::body.isInitialized) return
    body.removeAllViews()
    val full = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    when (mode) {
      "note" -> {
        val e = noteView ?: EditText(this).apply {
          hint = "此刻戳到你的是什么"
          setHintTextColor(cFg2)
          setTextColor(cFg)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
          minLines = 2
          maxLines = 6
          gravity = Gravity.TOP or Gravity.START
          inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
          background = round(cChip, dp(14).toFloat())
          setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        noteView = e
        (e.parent as? ViewGroup)?.removeView(e)
        body.addView(e, full)
        e.requestFocus()
        e.post { (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(e, InputMethodManager.SHOW_IMPLICIT) }
      }
      "music" -> fillMusic(full)
      else -> {
        if (mode == "paste" && text.isEmpty()) {
          body.addView(tv(if (pasteChecked) "剪贴板是空的" else "正在读剪贴板…", 15f, cFg2), full)
          saveBtn?.alpha = 0.4f
          return
        }
        saveBtn?.alpha = 1f
        body.addView(tv(typeLabel(), 12f, cFg2), full)
        val bytes = img
        if (bytes != null) {
          try {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            var s = 1
            while (o.outWidth / (s * 2) >= 720 || o.outHeight / (s * 2) >= 720) s *= 2
            val bm = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = s })
            if (bm != null) {
              val iv = ImageView(this)
              iv.setImageBitmap(bm)
              iv.scaleType = ImageView.ScaleType.CENTER_CROP
              iv.clipToOutline = true
              iv.background = round(cChip, dp(16).toFloat())
              body.addView(iv, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(180)).apply { topMargin = dp(8) })
            }
          } catch (e: Exception) {
          }
        }
        val shown = when {
          mode == "quote" -> "「$text」"
          subject.isNotEmpty() && text.isNotEmpty() && subject != text -> "$subject\n$text"
          text.isNotEmpty() -> text
          else -> subject
        }
        if (shown.isNotEmpty()) {
          val t = tv(shown, if (mode == "quote") 17f else 15f, cFg)
          t.maxLines = if (mode == "quote") 6 else 4
          t.ellipsize = TextUtils.TruncateAt.END
          t.setLineSpacing(0f, 1.15f)
          body.addView(t, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        }
      }
    }
  }

  private fun fillMusic(full: LinearLayout.LayoutParams) {
    if (!Glean.hasMediaAccess(this)) {
      // 0556：第一次用时先说清楚为什么要这个权限，再让用户自己去打开
      saveBtn?.alpha = 0.4f
      val t = tv("要读到正在播放的歌，需要在系统里给拾穗打开「通知使用权」。拾穗只读歌名、歌手、专辑和封面，不读、不存任何通知内容。", 15f, cFg)
      t.setLineSpacing(0f, 1.2f)
      body.addView(t, full)
      val go = tv("去打开", 15f, cOnPrimary, true)
      go.gravity = Gravity.CENTER
      go.setPadding(dp(18), dp(10), dp(18), dp(10))
      go.background = round(cPrimary, dp(999).toFloat())
      go.setOnClickListener {
        try {
          startActivity(Glean.accessIntent(this))
        } catch (e: Exception) {
          Toast.makeText(this, "打不开系统设置，请在 设置 → 通知 → 通知使用权 里打开拾穗", Toast.LENGTH_LONG).show()
        }
      }
      body.addView(go, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
      return
    }
    if (!musicChecked) {
      musicChecked = true
      song = try { Glean.nowPlaying(this) } catch (e: Exception) { null }
      song?.let { s ->
        if (s.app.isNotEmpty()) {
          source = s.app
          srcView.text = "来自 ${s.app}"
        }
        pkg = s.pkg
      }
    }
    val s = song
    if (s == null) {
      saveBtn?.alpha = 0.4f
      body.addView(tv("现在没有在放的歌。先在网易云 / QQ 音乐里放起来，再点一次。", 15f, cFg2), full)
      return
    }
    saveBtn?.alpha = 1f
    val row = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    val art = s.art
    if (art != null) {
      val bm = BitmapFactory.decodeByteArray(art, 0, art.size)
      if (bm != null) {
        val iv = ImageView(this)
        iv.setImageBitmap(bm)
        iv.scaleType = ImageView.ScaleType.CENTER_CROP
        iv.clipToOutline = true
        iv.background = round(cChip, dp(12).toFloat())
        row.addView(iv, LinearLayout.LayoutParams(dp(64), dp(64)).apply { rightMargin = dp(14) })
      }
    }
    val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    col.addView(tv("音乐", 12f, cFg2))
    val tt = tv(s.title, 17f, cFg, true)
    tt.maxLines = 2
    tt.ellipsize = TextUtils.TruncateAt.END
    col.addView(tt)
    val sub = listOf(s.artist, s.album).filter { it.isNotEmpty() }.joinToString(" · ")
    if (sub.isNotEmpty()) {
      val st = tv(sub, 14f, cFg2)
      st.maxLines = 1
      st.ellipsize = TextUtils.TruncateAt.END
      col.addView(st)
    }
    row.addView(col, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    body.addView(row, full)
  }

  private fun save() {
    if (done) return
    val why = whyView?.text?.toString()?.trim() ?: ""
    val o = JSONObject()
    var image: ByteArray? = null
    var mime = "image/jpeg"
    when (mode) {
      "music" -> {
        val s = song ?: return
        done = true
        Glean.saveSong(this, s, why, picked.toList())
        Toast.makeText(this, "已拾 ♪ ${s.title}", Toast.LENGTH_SHORT).show()
        finishQuiet()
        return
      }
      "note" -> {
        val t = noteView?.text?.toString()?.trim() ?: ""
        if (t.isEmpty()) {
          Toast.makeText(this, "先写一句", Toast.LENGTH_SHORT).show()
          return
        }
        o.put("kind", "note")
        o.put("text", t)
      }
      "quote" -> {
        if (text.isEmpty()) return
        o.put("kind", "quote")
        o.put("text", text)
      }
      "paste" -> {
        if (text.isEmpty()) return
        o.put("kind", "paste")
        o.put("text", text)
      }
      else -> {
        if (text.isEmpty() && subject.isEmpty() && img == null) return
        o.put("kind", "share")
        if (text.isNotEmpty()) o.put("text", text)
        if (subject.isNotEmpty()) o.put("subject", subject)
        image = img
        mime = imgMime
      }
    }
    if (why.isNotEmpty()) o.put("why", why)
    if (picked.isNotEmpty()) o.put("tags", JSONArray(picked.toList()))
    if (source.isNotEmpty()) o.put("source", source)
    if (pkg.isNotEmpty()) o.put("sourcePkg", pkg)
    done = true
    try {
      Glean.put(this, o, image, mime)
      Toast.makeText(this, "已拾进拾穗", Toast.LENGTH_SHORT).show()
    } catch (e: Exception) {
      done = false
      Toast.makeText(this, "没存上：" + (e.message ?: "存储不可用"), Toast.LENGTH_LONG).show()
      return
    }
    finishQuiet()
  }

  private fun cancel() {
    done = true
    finishQuiet()
  }

  private fun finishQuiet() {
    // 选字菜单：不回写文字（只读来源也安全），直接结束
    setResult(RESULT_CANCELED)
    whyView?.let { (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(it.windowToken, 0) }
    finish()
    @Suppress("DEPRECATION") overridePendingTransition(0, android.R.anim.fade_out)
  }

  @Deprecated("Deprecated in Java")
  override fun onBackPressed() {
    cancel()
  }
}
