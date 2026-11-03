// patch the generated Android project: INTERNET permission + share target (text/image) bridged into the WebView + launcher name
import fs from 'node:fs';
import path from 'node:path';
const f = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(f, 'utf8');
if (!m.includes('android.permission.INTERNET')) {
  m = m.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application');
}
if (!m.includes('android.intent.action.SEND')) {
  const filter = `<intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
            </activity>`;
  m = m.replace('</activity>', filter);
}
// v0.15 导出 ZIP 走 FileProvider 分享：Tauri 模板自带 ${applicationId}.fileprovider（含 cache-path）；没有就补上
if (!m.includes('androidx.core.content.FileProvider')) {
  m = m.replace('</application>', `    <provider
          android:name="androidx.core.content.FileProvider"
          android:authorities="\${applicationId}.fileprovider"
          android:exported="false"
          android:grantUriPermissions="true">
          <meta-data
            android:name="android.support.FILE_PROVIDER_PATHS"
            android:resource="@xml/file_paths" />
        </provider>
    </application>`);
}
const xmlDir = 'src-tauri/gen/android/app/src/main/res/xml';
const pathsFile = path.join(xmlDir, 'file_paths.xml');
fs.mkdirSync(xmlDir, { recursive: true });
let paths = fs.existsSync(pathsFile) ? fs.readFileSync(pathsFile, 'utf8') : '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n</paths>\n';
if (!paths.includes('glean_export')) paths = paths.replace('</paths>', '  <cache-path name="glean_export" path="export/" />\n</paths>');
fs.writeFileSync(pathsFile, paths);
console.log(paths);
fs.writeFileSync(f, m);
console.log(m);

// launcher name: 拾穗 (productName stays ASCII "Glean" for file names)
const strings = 'src-tauri/gen/android/app/src/main/res/values/strings.xml';
if (fs.existsSync(strings)) {
  let x = fs.readFileSync(strings, 'utf8');
  x = x.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">拾穗</string>');
  x = x.replace(/<string name="main_activity_title">[^<]*<\/string>/, '<string name="main_activity_title">拾穗</string>');
  fs.writeFileSync(strings, x);
  console.log(x);
}

// find MainActivity.kt and replace it with a share-aware one
const root = 'src-tauri/gen/android/app/src/main/java';
function find(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { const r = find(p); if (r) return r; }
    else if (e.name === 'MainActivity.kt') return p;
  }
}
const kt = find(root);
const src = fs.readFileSync(kt, 'utf8');
const pkg = src.match(/^package\s+([\w.]+)/m)[1];
fs.writeFileSync(kt, `package ${pkg}

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

class MainActivity : TauriActivity() {
  @Volatile private var pending: String = ""

  private fun grab(intent: Intent?) {
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
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    grab(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun take(): String {
        val p = pending
        pending = ""
        return p
      }
    }, "LinganShare")
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
        } catch (e: Exception) { "\\u0000" }
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
  }
}
`);
console.log('patched', kt);
