package __PKG__

import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONObject
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.app.NotificationManager

class MainActivity : TauriActivity() {
  @Volatile private var pending: String = ""
  @Volatile private var pendingGo: String = ""

  private fun grab(intent: Intent?) {
    // v0.22 长按图标「今日一穗」等快捷方式：带 glean_go 打开主界面某一页
    intent?.getStringExtra("glean_go")?.let { if (it == "daily" || it == "library" || it == "settings") pendingGo = it }
    if (intent == null || intent.action != Intent.ACTION_SEND) return
    try {
      val o = JSONObject()
      intent.getStringExtra(Intent.EXTRA_TEXT)?.let { o.put("text", it) }
      intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { o.put("subject", it) }
      val type = intent.type ?: ""
      if (type.startsWith("image/")) {
        val uri: Uri? = if (android.os.Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(Intent.EXTRA_STREAM)
        if (uri != null) {
          val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
          if (bytes != null && bytes.size < 12 * 1024 * 1024) {
            o.put("image", "data:" + type + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
          }
        }
      }
      pending = o.toString()
    } catch (e: Exception) {
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    grab(intent)
    shortcuts()
  }

  override fun onResume() {
    super.onResume()
    // 常驻通知里的「拾这首歌」按钮要跟着通知使用权变（有权限 = 后台直接收）
    if (Glean.notifyOn(this)) Glean.postQuick(this, null)
  }

  /** v0.22 长按桌面图标：拾一穗 / 粘贴拾 / 拾这首歌 / 今日一穗 */
  private fun shortcuts() {
    try {
      val sm = getSystemService(ShortcutManager::class.java) ?: return
      val icon = Icon.createWithResource(this, R.drawable.glean_stat)
      fun quick(id: String, short: String, long: String, mode: String, rank: Int) =
        ShortcutInfo.Builder(this, id).setShortLabel(short).setLongLabel(long).setIcon(icon).setRank(rank)
          .setIntent(Glean.quickIntent(this, mode)).build()
      val daily = ShortcutInfo.Builder(this, "daily").setShortLabel("今日一穗").setLongLabel("打开今日一穗").setIcon(icon).setRank(3)
        .setIntent(Intent(this, MainActivity::class.java).setAction(Intent.ACTION_VIEW).putExtra("glean_go", "daily")).build()
      sm.dynamicShortcuts = listOf(
        quick("note", "拾一穗", "随手拾一穗", "note", 0),
        quick("paste", "粘贴拾", "拾剪贴板里的内容", "paste", 1),
        quick("music", "拾这首歌", "拾正在播放的歌", "music", 2),
        daily,
      )
    } catch (e: Exception) {
    }
  }

  override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == 4242) {
      val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
      getSharedPreferences(Glean.PREFS, MODE_PRIVATE).edit().putBoolean("perm_asked", true).putString("perm_last", if (ok) "granted" else "denied").apply()
      if (ok && Glean.notifyOn(this)) Glean.postQuick(this, null)
    }
  }

  /** granted / ask（还能弹系统框）/ blocked（被拒且不再询问，或系统设置里关了，只能去设置） */
  private fun notifyPerm(): String {
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT < 33) return if (nm.areNotificationsEnabled()) "granted" else "blocked"
    if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) return if (nm.areNotificationsEnabled()) "granted" else "blocked"
    val asked = getSharedPreferences(Glean.PREFS, MODE_PRIVATE).getBoolean("perm_asked", false)
    return if (asked && !shouldShowRequestPermissionRationale("android.permission.POST_NOTIFICATIONS")) "blocked" else "ask"
  }

  private var myPut: (() -> Unit)? = null

  override fun onDestroy() {
    if (Glean.onPut === myPut) Glean.onPut = null
    super.onDestroy()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    grab(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    // v0.23 后台同步：半屏面板 / 磁贴 / 通知写进收件箱时，若这个 WebView 还在就让 JS 马上收（弱引用，不拖住 Activity）
    val ref = java.lang.ref.WeakReference(webView)
    val put: () -> Unit = {
      ref.get()?.let { w -> w.post { try { w.evaluateJavascript("window.dispatchEvent(new Event('glean:inbox'))", null) } catch (e: Exception) {} } }
    }
    myPut = put
    Glean.onPut = put
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun take(): String {
        val p = pending
        pending = ""
        return p
      }

      @JavascriptInterface
      fun go(): String {
        val g = pendingGo
        pendingGo = ""
        return g
      }

      // v0.25 应用内检查新版：用系统浏览器下载新 APK（只放行本仓库的 Release 地址）
      @JavascriptInterface
      fun openUrl(url: String): Boolean {
        if (!url.startsWith("https://github.com/q1f0730/lingan/releases/")) return false
        return try {
          val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          runOnUiThread { startActivity(i) }
          true
        } catch (e: Exception) {
          false
        }
      }
    }, "LinganShare")
    // v0.22 极速拾收件箱：半屏面板 / 磁贴 / 通知 / 小部件写进来的穗，JS 收进 IndexedDB 后逐条 ack
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun list(): String = Glean.list(this@MainActivity)

      @JavascriptInterface
      fun image(uid: String): String = Glean.image(this@MainActivity, uid)

      @JavascriptInterface
      fun ack(uid: String): Boolean = Glean.ack(this@MainActivity, uid)

      @JavascriptInterface
      fun setHints(json: String) = Glean.setHints(this@MainActivity, json)
    }, "LinganInbox")
    // v0.22 正在播放一键拾：通知使用权 + MediaSession
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun status(): String = if (Glean.hasMediaAccess(this@MainActivity)) "ok" else "no-access"

      @JavascriptInterface
      fun read(): String {
        return try {
          val s = Glean.nowPlaying(this@MainActivity) ?: return ""
          Glean.songJson(s, true).toString()
        } catch (e: SecurityException) {
          "{\"error\":\"no-access\"}"
        } catch (e: Exception) {
          "{\"error\":\"failed\"}"
        }
      }

      @JavascriptInterface
      fun openAccess(): Boolean {
        return try {
          runOnUiThread { startActivity(Glean.accessIntent(this@MainActivity)) }
          true
        } catch (e: Exception) { false }
      }
    }, "LinganNowPlaying")
    // v0.22 常驻通知「随手拾一穗」：权限在第一次打开开关时才请求（JS 先说明理由）
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun status(): String {
        val o = JSONObject()
        o.put("perm", notifyPerm())
        o.put("on", Glean.notifyOn(this@MainActivity))
        o.put("last", getSharedPreferences(Glean.PREFS, MODE_PRIVATE).getString("perm_last", "") ?: "")
        return o.toString()
      }

      @JavascriptInterface
      fun request(): Boolean {
        if (Build.VERSION.SDK_INT < 33) return false
        getSharedPreferences(Glean.PREFS, MODE_PRIVATE).edit().putString("perm_last", "").commit()
        runOnUiThread { requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 4242) }
        return true
      }

      @JavascriptInterface
      fun setOn(on: Boolean): Boolean {
        Glean.setNotifyOn(this@MainActivity, on)
        return if (on) notifyPerm() == "granted" else true
      }

      @JavascriptInterface
      fun openSettings(): Boolean {
        return try {
          val i = Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName)
          runOnUiThread { startActivity(i) }
          true
        } catch (e: Exception) { false }
      }
    }, "LinganNotify")
    // v0.15 导出到 Obsidian：JS 分块把 ZIP（base64）写进 cache/export/，再走系统分享或存进「下载」
    webView.addJavascriptInterface(object {
      private var file: File? = null
      private var out: FileOutputStream? = null

      private fun close() {
        try { out?.flush(); out?.close() } catch (e: Exception) {}
        out = null
      }

      @JavascriptInterface
      fun begin(name: String): Boolean {
        return try {
          close()
          val dir = File(cacheDir, "export")
          dir.mkdirs()
          dir.listFiles()?.forEach { it.delete() }
          val safe = name.map { c -> if (c.code < 32 || c.code == 92 || c.code == 34 || "/:*?<>|".indexOf(c) >= 0) '_' else c }.joinToString("")
          val f = File(dir, safe)
          file = f
          out = FileOutputStream(f)
          true
        } catch (e: Exception) { false }
      }

      @JavascriptInterface
      fun append(b64: String): Boolean {
        return try {
          out!!.write(Base64.decode(b64, Base64.NO_WRAP))
          true
        } catch (e: Exception) { false }
      }

      @JavascriptInterface
      fun share(mime: String, title: String): Boolean {
        close()
        val f = file ?: return false
        return try {
          val uri = FileProvider.getUriForFile(this@MainActivity, packageName + ".fileprovider", f)
          val send = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, f.name)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
          val chooser = Intent.createChooser(send, title).apply { addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }
          runOnUiThread { startActivity(chooser) }
          true
        } catch (e: Exception) { false }
      }

      @JavascriptInterface
      fun saveDownloads(mime: String): String {
        close()
        val f = file ?: return ""
        return try {
          if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
              put(MediaStore.MediaColumns.DISPLAY_NAME, f.name)
              put(MediaStore.MediaColumns.MIME_TYPE, mime)
              put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return ""
            contentResolver.openOutputStream(uri)?.use { o -> f.inputStream().use { it.copyTo(o) } } ?: return ""
            "下载/" + f.name
          } else {
            val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: return ""
            dir.mkdirs()
            val dest = File(dir, f.name)
            f.copyTo(dest, overwrite = true)
            dest.absolutePath
          }
        } catch (e: Exception) { "" }
      }
    }, "LinganFiles")
    // v0.20 AI 密钥进 Android Keystore：AES-256-GCM 密钥只在系统密钥库里（不可导出），SharedPreferences 只存密文
    webView.addJavascriptInterface(object {
      private val alias = "glean_vault_v1"
      private val prefs by lazy { getSharedPreferences("glean_vault", android.content.Context.MODE_PRIVATE) }
      private fun ok(name: String) = name == "chat.apiKey" || name == "embed.apiKey"
      private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        kg.init(
          KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        )
        return kg.generateKey()
      }

      @JavascriptInterface
      fun get(name: String): String {
        if (!ok(name)) return ""
        val v = prefs.getString(name, null) ?: return ""
        return try {
          val raw = Base64.decode(v, Base64.NO_WRAP)
          val c = Cipher.getInstance("AES/GCM/NoPadding")
          c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
          String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
        } catch (e: Exception) { "\u0000" }
      }

      @JavascriptInterface
      fun set(name: String, value: String): Boolean {
        if (!ok(name)) return false
        return try {
          if (value.isEmpty()) {
            prefs.edit().remove(name).commit()
          } else {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            val out = c.iv + c.doFinal(value.toByteArray(Charsets.UTF_8))
            prefs.edit().putString(name, Base64.encodeToString(out, Base64.NO_WRAP)).commit()
          }
        } catch (e: Exception) { false }
      }
    }, "LinganVault")
    // v0.26 自动备份写进「下载/Glean」+ 应用内下载安装新版（见 GleanSafety.kt）
    webView.addJavascriptInterface(BackupBridge(this), "LinganBackup")
    webView.addJavascriptInterface(UpdateBridge(this), "LinganUpdate")
    // v0.27 全面屏安全区 + 状态栏跟主题 + 键盘（见 GleanChrome.kt）
    val chrome = ChromeBridge(this)
    chrome.attach(webView)
    webView.addJavascriptInterface(chrome, "LinganChrome")
  }
}
