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

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebView
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
  }
}
`);
console.log('patched', kt);
