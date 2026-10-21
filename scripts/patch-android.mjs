// make sure INTERNET permission and file chooser friendly settings exist in generated Android project
import fs from 'node:fs';
const f = 'src-tauri/gen/android/app/src/main/AndroidManifest.xml';
let m = fs.readFileSync(f, 'utf8');
if (!m.includes('android.permission.INTERNET')) {
  m = m.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application');
}
fs.writeFileSync(f, m);
console.log(m);
