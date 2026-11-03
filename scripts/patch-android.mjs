// patch the generated Android project: INTERNET permission + share target (text/image) bridged into the WebView + launcher name
import fs from 'node:fs';
import path from 'node:path';
const f = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(f, 'utf8');
if (!m.includes('android.permission.INTERNET')) {
  m = m.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application');
}
// v0.22 极速采集：分享 / 选字菜单改由透明的半屏 QuickActivity 接（不拉起整个 App）；磁贴、通知使用权、常驻通知、小部件
const perms = ['android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED'];
for (const p of perms) if (!m.includes(p)) m = m.replace('<application', `<uses-permission android:name="${p}" />\n    <application`);
// 让桌面上的 App 对 PackageManager 可见：把来源包名翻成「网易云音乐」这样的名字（只查桌面 App，不要 QUERY_ALL_PACKAGES）
if (!m.includes('<queries>')) {
  m = m.replace('<application', `<queries>
        <intent>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent>
    </queries>
    <application`);
}
if (!m.includes('.QuickActivity')) {
  m = m.replace('</application>', `    <activity
            android:name=".QuickActivity"
            android:exported="true"
            android:label="拾穗"
            android:theme="@android:style/Theme.Translucent.NoTitleBar"
            android:taskAffinity=""
            android:excludeFromRecents="true"
            android:launchMode="standard"
            android:windowSoftInputMode="adjustResize|stateHidden"
            android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden|uiMode">
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="image/*" />
            </intent-filter>
            <intent-filter android:label="拾穗">
                <action android:name="android.intent.action.PROCESS_TEXT" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
        </activity>
        <service
            android:name=".GleanMediaListener"
            android:exported="true"
            android:label="拾穗 · 正在播放"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
        <service
            android:name=".QuickTile"
            android:exported="true"
            android:label="拾一穗"
            android:icon="@drawable/glean_stat"
            android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter>
                <action android:name="android.service.quicksettings.action.QS_TILE" />
            </intent-filter>
        </service>
        <service
            android:name=".MusicTile"
            android:exported="true"
            android:label="拾这首歌"
            android:icon="@drawable/glean_stat"
            android:permission="android.permission.BIND_QUICK_SETTINGS_TILE">
            <intent-filter>
                <action android:name="android.service.quicksettings.action.QS_TILE" />
            </intent-filter>
        </service>
        <receiver android:name=".GleanReceiver" android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
        <receiver android:name=".GleanWidget" android:exported="true" android:label="拾穗">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/glean_widget_info" />
        </receiver>
    </application>`);
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

// v0.22 资源：状态栏 / 磁贴图标（矢量麦穗）、小部件布局与配色（跟随深浅色）
const res = 'src-tauri/gen/android/app/src/main/res';
const put = (p, x) => {
  fs.mkdirSync(path.dirname(path.join(res, p)), { recursive: true });
  fs.writeFileSync(path.join(res, p), x);
};
for (const [p, x] of Object.entries(androidRes())) put(p, x);

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
// v0.22 原生代码放在 scripts/android/*.kt（可单独编译检查），这里换上包名拷进去
const dir = path.dirname(kt);
for (const f of fs.readdirSync('scripts/android').filter((x) => x.endsWith('.kt'))) {
  fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join('scripts/android', f), 'utf8').replaceAll('__PKG__', pkg));
  console.log('wrote', path.join(dir, f));
}
console.log('patched', kt);

function androidRes() {
  const color = (bg, fg, fg2) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="glean_widget_bg">${bg}</color>
    <color name="glean_widget_fg">${fg}</color>
    <color name="glean_widget_fg2">${fg2}</color>
</resources>
`;
  const btn = (id, text, bold) => `    <TextView
        android:id="@+id/${id}"
        android:layout_width="0dp"
        android:layout_height="match_parent"
        android:layout_weight="1"
        android:gravity="center"
        android:maxLines="1"
        android:text="${text}"
        android:textColor="@color/${bold ? 'glean_widget_fg' : 'glean_widget_fg2'}"
        android:textSize="14sp"${bold ? '\n        android:textStyle="bold"' : ''} />
`;
  return {
    'drawable/glean_stat.xml': `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M11.25,4h1.5v17h-1.5z" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,3c1.2,1.2 1.2,3 0,4.2c-1.2,-1.2 -1.2,-3 0,-4.2z" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,9.5c-0.4,-1.9 -2.1,-3.1 -4.4,-3c0.4,1.9 2.1,3.1 4.4,3z" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,9.5c0.4,-1.9 2.1,-3.1 4.4,-3c-0.4,1.9 -2.1,3.1 -4.4,3z" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,13.5c-0.4,-1.9 -2.1,-3.1 -4.4,-3c0.4,1.9 2.1,3.1 4.4,3z" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,13.5c0.4,-1.9 2.1,-3.1 4.4,-3c-0.4,1.9 -2.1,3.1 -4.4,3z" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,17.5c-0.4,-1.9 -2.1,-3.1 -4.4,-3c0.4,1.9 2.1,3.1 4.4,3z" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,17.5c0.4,-1.9 2.1,-3.1 4.4,-3c-0.4,1.9 -2.1,3.1 -4.4,3z" />
</vector>
`,
    'drawable/glean_widget_bg.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/glean_widget_bg" />
    <corners android:radius="22dp" />
</shape>
`,
    'values/glean_colors.xml': color('#F2FFFFFF', '#FF1D1B18', '#FF6B665E'),
    'values-night/glean_colors.xml': color('#F2211F25', '#FFF3F0EA', '#FFA6A198'),
    'values/glean_strings.xml': `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="glean_widget_desc">一键拾：文字 / 粘贴 / 正在播放的歌</string>
</resources>
`,
    'layout/glean_widget.xml': `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/gw_root"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@drawable/glean_widget_bg"
    android:gravity="center_vertical"
    android:orientation="horizontal"
    android:padding="4dp">
${btn('gw_note', '拾一穗', true)}${btn('gw_paste', '粘贴', false)}${btn('gw_music', '♪ 这首歌', false)}${btn('gw_open', '穗仓', false)}</LinearLayout>
`,
    'xml/glean_widget_info.xml': `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp"
    android:minHeight="40dp"
    android:targetCellWidth="4"
    android:targetCellHeight="1"
    android:minResizeWidth="180dp"
    android:resizeMode="horizontal"
    android:updatePeriodMillis="0"
    android:initialLayout="@layout/glean_widget"
    android:description="@string/glean_widget_desc"
    android:widgetCategory="home_screen" />
`,
  };
}
