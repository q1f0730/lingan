package __PKG__

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * v0.26 0606 / 0508 自动备份：JS 分块（base64）把 .glean 写进「下载/Glean」。
 * Android 10+ 走 MediaStore（写的时候 IS_PENDING=1，写完才可见；卸载 App 文件也还在；只列 / 删自己建的文件，不需要存储权限）。
 * Android 9 退回 App 专属目录 Android/data/<包名>/files/Glean。
 */
class BackupBridge(private val a: Activity) {
  private val rel = Environment.DIRECTORY_DOWNLOADS + "/Glean/"
  private var out: OutputStream? = null
  private var pendingUri: Uri? = null
  private var pendingFile: File? = null

  private fun ok(name: String) = name.startsWith("glean-") && name.endsWith(".glean") && name.length < 120 && name.none { it == '/' || it == '\\' || it.code < 32 }
  private fun legacyDir(): File? = a.getExternalFilesDir("Glean")?.apply { mkdirs() }

  private fun find(name: String): Uri? {
    if (Build.VERSION.SDK_INT < 29) return null
    val c = a.contentResolver.query(
      MediaStore.Downloads.EXTERNAL_CONTENT_URI,
      arrayOf(MediaStore.MediaColumns._ID),
      "${MediaStore.MediaColumns.RELATIVE_PATH}=? AND ${MediaStore.MediaColumns.DISPLAY_NAME}=?",
      arrayOf(rel, name),
      null,
    ) ?: return null
    c.use { if (it.moveToFirst()) return ContentUris.withAppendedId(MediaStore.Downloads.EXTERNAL_CONTENT_URI, it.getLong(0)) }
    return null
  }

  @JavascriptInterface
  fun where(): String = if (Build.VERSION.SDK_INT >= 29) "下载/Glean" else (legacyDir()?.absolutePath ?: "")

  @JavascriptInterface
  fun begin(name: String): Boolean {
    if (!ok(name)) return false
    abort()
    return try {
      if (Build.VERSION.SDK_INT >= 29) {
        val v = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, name)
          put(MediaStore.MediaColumns.MIME_TYPE, "application/zip")
          put(MediaStore.MediaColumns.RELATIVE_PATH, rel)
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = a.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: return false
        pendingUri = uri
        out = a.contentResolver.openOutputStream(uri, "w")
      } else {
        val f = File(legacyDir() ?: return false, name)
        pendingFile = f
        out = FileOutputStream(f)
      }
      out != null
    } catch (e: Exception) {
      abort()
      false
    }
  }

  @JavascriptInterface
  fun append(b64: String): Boolean = try {
    out!!.write(Base64.decode(b64, Base64.NO_WRAP))
    true
  } catch (e: Exception) { false }

  @JavascriptInterface
  fun commit(): String {
    return try {
      out?.flush(); out?.close(); out = null
      val uri = pendingUri
      if (uri != null) {
        val v = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
        a.contentResolver.update(uri, v, null, null)
        pendingUri = null
        "下载/Glean"
      } else {
        val f = pendingFile ?: return ""
        pendingFile = null
        f.absolutePath
      }
    } catch (e: Exception) { "" }
  }

  @JavascriptInterface
  fun abort() {
    try { out?.close() } catch (e: Exception) {}
    out = null
    pendingUri?.let { try { a.contentResolver.delete(it, null, null) } catch (e: Exception) {} }
    pendingUri = null
    pendingFile?.delete()
    pendingFile = null
  }

  @JavascriptInterface
  fun list(): String {
    val arr = JSONArray()
    try {
      if (Build.VERSION.SDK_INT >= 29) {
        val c = a.contentResolver.query(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI,
          arrayOf(MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE),
          "${MediaStore.MediaColumns.RELATIVE_PATH}=? AND ${MediaStore.MediaColumns.IS_PENDING}=0",
          arrayOf(rel),
          null,
        )
        c?.use { while (it.moveToNext()) { val n = it.getString(0) ?: continue; if (ok(n)) arr.put(JSONObject().put("name", n).put("bytes", it.getLong(1))) } }
      } else {
        legacyDir()?.listFiles()?.forEach { f -> if (ok(f.name)) arr.put(JSONObject().put("name", f.name).put("bytes", f.length())) }
      }
    } catch (e: Exception) {}
    return arr.toString()
  }

  @JavascriptInterface
  fun remove(name: String): Boolean {
    if (!ok(name)) return false
    return try {
      if (Build.VERSION.SDK_INT >= 29) { val u = find(name) ?: return false; a.contentResolver.delete(u, null, null) > 0 }
      else File(legacyDir() ?: return false, name).delete()
    } catch (e: Exception) { false }
  }

  /** 回读校验 / 恢复：从 off 起读 len 字节（base64；读到末尾返回更短的） */
  @JavascriptInterface
  fun readAt(name: String, off: Double, len: Int): String {
    if (!ok(name) || len <= 0 || len > 4 * 1024 * 1024) return ""
    return try {
      val ins = if (Build.VERSION.SDK_INT >= 29) a.contentResolver.openInputStream(find(name) ?: return "") else File(legacyDir() ?: return "", name).inputStream()
      ins?.use { s ->
        var skip = off.toLong()
        while (skip > 0) { val n = s.skip(skip); if (n <= 0) break; skip -= n }
        val buf = ByteArray(len)
        var p = 0
        while (p < len) { val n = s.read(buf, p, len - p); if (n < 0) break; p += n }
        Base64.encodeToString(buf, 0, p, Base64.NO_WRAP)
      } ?: ""
    } catch (e: Exception) { "" }
  }
}

/**
 * v0.26 0512 / 0732 安卓应用内更新：只从本仓库 Release 下载 APK 到 cache/update/，边下边算 SHA-256（必须等于 SHA256SUMS.txt
 * 里的值），再核对 APK 的签名证书和当前装着的拾穗一致（含轮换历史），然后用 FileProvider 交给系统安装器。
 * 需要「安装未知应用」授权（REQUEST_INSTALL_PACKAGES）；没授权时带去系统设置页。
 */
class UpdateBridge(private val a: Activity) {
  @Volatile private var state = "idle"
  @Volatile private var done = 0L
  @Volatile private var total = 0L
  @Volatile private var err = ""
  @Volatile private var file: File? = null

  private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
  private fun certs(pi: PackageInfo?): List<String> {
    val si = pi?.signingInfo ?: return emptyList()
    val sigs = if (si.hasMultipleSigners()) si.apkContentsSigners else si.signingCertificateHistory
    return sigs.map { hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }
  }
  private fun sameSigner(f: File): Boolean {
    val pm = a.packageManager
    val mine = certs(pm.getPackageInfo(a.packageName, PackageManager.GET_SIGNING_CERTIFICATES))
    val apk = pm.getPackageArchiveInfo(f.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: return false
    if (apk.packageName != a.packageName) return false
    val theirs = certs(apk)
    // 新包的签名历史里要有我现在用的证书（密钥轮换后也成立）
    return mine.isNotEmpty() && theirs.isNotEmpty() && theirs.contains(mine.last())
  }

  @JavascriptInterface
  fun download(url: String, sha256: String, version: String): Boolean {
    if (!url.startsWith("https://github.com/q1f0730/lingan/releases/download/")) return false
    if (!Regex("^[0-9a-fA-F]{64}$").matches(sha256)) return false
    if (state == "downloading") return true
    state = "downloading"; done = 0; total = 0; err = ""; file = null
    Thread {
      try {
        val dir = File(a.cacheDir, "update").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val f = File(dir, "Glean_" + version.replace(Regex("[^0-9.]"), "") + ".apk")
        var u = URL(url)
        var hops = 0
        var conn: HttpURLConnection
        while (true) {
          conn = u.openConnection() as HttpURLConnection
          conn.instanceFollowRedirects = false
          conn.connectTimeout = 15000
          conn.readTimeout = 30000
          conn.setRequestProperty("User-Agent", "Glean-Android-Updater")
          val code = conn.responseCode
          if (code in 300..399) {
            val loc = conn.getHeaderField("Location") ?: throw Exception("跳转没有地址")
            conn.disconnect()
            u = URL(u, loc)
            if (u.protocol != "https" || ++hops > 6) throw Exception("下载地址跳转异常")
            continue
          }
          if (code != 200) throw Exception("HTTP $code")
          break
        }
        total = conn.contentLengthLong
        val md = MessageDigest.getInstance("SHA-256")
        conn.inputStream.use { ins ->
          FileOutputStream(f).use { o ->
            val buf = ByteArray(64 * 1024)
            while (true) {
              val n = ins.read(buf)
              if (n < 0) break
              o.write(buf, 0, n)
              md.update(buf, 0, n)
              done += n
            }
          }
        }
        if (!hex(md.digest()).equals(sha256, ignoreCase = true)) { f.delete(); throw Exception("安装包 SHA-256 和发布页的不一致，已删掉") }
        if (!sameSigner(f)) { f.delete(); throw Exception("安装包的签名证书和当前拾穗不一致，已删掉") }
        file = f
        state = "ready"
      } catch (e: Exception) {
        err = e.message ?: e.toString()
        state = "error"
      }
    }.start()
    return true
  }

  @JavascriptInterface
  fun progress(): String = JSONObject().put("state", state).put("done", done).put("total", total).put("error", err).toString()

  @JavascriptInterface
  fun canInstall(): Boolean = Build.VERSION.SDK_INT < 26 || a.packageManager.canRequestPackageInstalls()

  @JavascriptInterface
  fun install(): String {
    val f = file ?: return "no-file"
    if (!f.exists()) return "no-file"
    return try {
      if (Build.VERSION.SDK_INT >= 26 && !a.packageManager.canRequestPackageInstalls()) {
        val i = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        a.runOnUiThread { a.startActivity(i) }
        return "need-permission"
      }
      val uri = FileProvider.getUriForFile(a, a.packageName + ".fileprovider", f)
      val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      a.runOnUiThread { a.startActivity(i) }
      "ok"
    } catch (e: Exception) { e.message ?: "error" }
  }
}
