package __PKG__

// v0.22 极速采集的原生公共部分：收件箱（文件队列）、ULID、来源 App、正在播放、常驻通知。
// 收件箱是 filesDir/glean_inbox/<uid>.json（+ <uid>.img）。半屏面板 / 磁贴 / 通知 / 小部件只往这里写，
// 不启动 WebView；主界面下次回到前台时由 JS（src/lib/capture.ts）逐条收进 IndexedDB 再 ack 删除。

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.SecureRandom
import org.json.JSONArray
import org.json.JSONObject

object Glean {
  /**
   * v0.23 后台同步：主界面的 WebView 还活着（App 在后台、没被系统杀）时，收件箱一有新条目就叫 JS 立刻收进 IndexedDB，
   * 不用等下次回到前台。WebView 已经没了（进程被杀 / 从没打开过）就什么也不做，仍按 v0.22 的方式下次打开时收。
   */
  @Volatile var onPut: (() -> Unit)? = null

  const val PREFS = "glean_capture"
  const val ACTION_QUICK = "com.q1f730.lingan.QUICK"
  const val ACTION_REPLY = "com.q1f730.lingan.NOTE_REPLY"
  const val ACTION_MUSIC = "com.q1f730.lingan.NOTE_MUSIC"
  const val KEY_REPLY = "glean_reply"
  const val CHANNEL = "glean_quick"
  const val NOTE_ID = 7301

  private const val A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  private val rnd = SecureRandom()
  private val UID_RE = Regex("^[0-7][0-9A-HJKMNP-TV-Z]{25}$")

  /** 与 src/lib/ulid.ts 同一格式：10 位毫秒时间 + 16 位随机（Crockford Base32） */
  fun ulid(t: Long = System.currentTimeMillis()): String {
    val time = CharArray(10)
    var x = if (t < 0) 0L else t
    for (i in 9 downTo 0) {
      time[i] = A[(x % 32).toInt()]
      x /= 32
    }
    val sb = StringBuilder(26).append(time)
    repeat(16) { sb.append(A[rnd.nextInt(32)]) }
    return sb.toString()
  }

  private fun dir(c: Context): File = File(c.filesDir, "glean_inbox").apply { mkdirs() }

  /** 写一条进收件箱（先写临时文件再改名，进程被杀也不会留下半条） */
  fun put(c: Context, o: JSONObject, image: ByteArray? = null, mime: String = "image/jpeg"): String {
    val now = System.currentTimeMillis()
    if (!o.has("createdAt")) o.put("createdAt", now)
    val uid = ulid(o.optLong("createdAt", now))
    o.put("uid", uid)
    o.put("v", 1)
    val d = dir(c)
    if (image != null && image.isNotEmpty()) {
      val tmp = File(d, "$uid.img.tmp")
      tmp.writeBytes(image)
      tmp.renameTo(File(d, "$uid.img"))
      o.put("image", true)
      o.put("mime", mime)
    }
    val tmp = File(d, "$uid.json.tmp")
    tmp.writeText(o.toString(), Charsets.UTF_8)
    tmp.renameTo(File(d, "$uid.json"))
    try {
      onPut?.invoke()
    } catch (e: Exception) {
    }
    return uid
  }

  /** 全部待收条目（按 uid = 时间顺序），JSON 数组字符串；坏文件跳过 */
  fun list(c: Context): String {
    val arr = JSONArray()
    val files = dir(c).listFiles { f -> f.name.endsWith(".json") }?.sortedBy { it.name } ?: emptyList()
    for (f in files) {
      try {
        arr.put(JSONObject(f.readText(Charsets.UTF_8)))
      } catch (e: Exception) {
      }
    }
    return arr.toString()
  }

  fun count(c: Context): Int = dir(c).listFiles { f -> f.name.endsWith(".json") }?.size ?: 0

  fun image(c: Context, uid: String): String {
    if (!UID_RE.matches(uid)) return ""
    val d = dir(c)
    val f = File(d, "$uid.img")
    if (!f.exists()) return ""
    val mime = try {
      JSONObject(File(d, "$uid.json").readText(Charsets.UTF_8)).optString("mime", "image/jpeg")
    } catch (e: Exception) { "image/jpeg" }
    return "data:" + mime + ";base64," + Base64.encodeToString(f.readBytes(), Base64.NO_WRAP)
  }

  fun ack(c: Context, uid: String): Boolean {
    if (!UID_RE.matches(uid)) return false
    val d = dir(c)
    File(d, "$uid.img").delete()
    return File(d, "$uid.json").delete()
  }

  // —— 面板上的「最近用过的标签」：主界面每次收完都写一份 ——
  fun setHints(c: Context, json: String) {
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("hints", json).apply()
  }

  fun recentTags(c: Context): List<String> {
    return try {
      val o = JSONObject(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("hints", "{}") ?: "{}")
      val a = o.optJSONArray("tags") ?: return emptyList()
      (0 until a.length()).map { a.optString(it) }.filter { it.isNotBlank() }.take(3)
    } catch (e: Exception) { emptyList() }
  }

  // —— 来源 App ——
  private val KNOWN = mapOf(
    "com.tencent.weread" to "微信读书",
    "com.tencent.mm" to "微信",
    "com.netease.cloudmusic" to "网易云音乐",
    "com.tencent.qqmusic" to "QQ 音乐",
    "com.luna.music" to "汽水音乐",
    "com.xingin.xhs" to "小红书",
    "tv.danmaku.bili" to "哔哩哔哩",
    "com.zhihu.android" to "知乎",
    "com.douban.frodo" to "豆瓣",
    "com.ss.android.ugc.aweme" to "抖音",
  )
  private val IGNORE = setOf("android", "com.android.intentresolver", "com.android.systemui", "com.google.android.intentresolver")

  fun cleanPkg(c: Context, pkg: String?): String {
    val p = pkg?.trim() ?: return ""
    if (p.isEmpty() || p == c.packageName || p in IGNORE) return ""
    return p
  }

  /** 包名 → 显示名：先问系统（manifest 里 <queries> 让桌面 App 可见），再查内置表；都没有就留空不猜 */
  fun appLabel(c: Context, pkg: String): String {
    if (pkg.isEmpty()) return ""
    try {
      val pm = c.packageManager
      val ai = pm.getApplicationInfo(pkg, 0)
      val l = pm.getApplicationLabel(ai).toString().trim()
      if (l.isNotEmpty() && l != pkg) return l
    } catch (e: Exception) {
    }
    return KNOWN[pkg] ?: ""
  }

  fun isDark(c: Context): Boolean =
    (c.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

  /** 打开半屏面板的 Intent；data 区分模式，PendingIntent 才不会互相覆盖 */
  fun quickIntent(c: Context, mode: String): Intent =
    Intent(c, QuickActivity::class.java)
      .setAction(ACTION_QUICK)
      .setData(Uri.parse("glean://quick/$mode"))
      .putExtra("glean_mode", mode)

  // —— 正在播放 ——
  class Song(val title: String, val artist: String, val album: String, val pkg: String, val app: String, val art: ByteArray?)

  /** 用户是否已给「通知使用权」（读媒体会话需要它） */
  fun hasMediaAccess(c: Context): Boolean {
    val s = Settings.Secure.getString(c.contentResolver, "enabled_notification_listeners") ?: return false
    val me = ComponentName(c, GleanMediaListener::class.java)
    return s.split(":").any { it == me.flattenToString() || it == me.flattenToShortString() || it.startsWith(c.packageName + "/") }
  }

  fun accessIntent(c: Context): Intent {
    val me = ComponentName(c, GleanMediaListener::class.java)
    return if (Build.VERSION.SDK_INT >= 30) {
      Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
        .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, me.flattenToString())
    } else {
      Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    }
  }

  private fun art(b: Bitmap?): ByteArray? {
    if (b == null || b.width <= 0 || b.height <= 0) return null
    return try {
      val max = 640
      val s = minOf(1f, max.toFloat() / maxOf(b.width, b.height))
      val bm = if (s < 1f) Bitmap.createScaledBitmap(b, (b.width * s).toInt().coerceAtLeast(1), (b.height * s).toInt().coerceAtLeast(1), true) else b
      val out = ByteArrayOutputStream()
      bm.compress(Bitmap.CompressFormat.JPEG, 88, out)
      out.toByteArray()
    } catch (e: Exception) { null }
  }

  /** 读当前播放：优先正在播放的会话，否则第一个有标题的；没权限抛 SecurityException，没有歌返回 null */
  fun nowPlaying(c: Context): Song? {
    if (!hasMediaAccess(c)) throw SecurityException("no-access")
    val msm = c.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    val list: List<MediaController> = msm.getActiveSessions(ComponentName(c, GleanMediaListener::class.java))
    val withMeta = list.filter { !(it.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: it.metadata?.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE)).isNullOrBlank() }
    val mc = withMeta.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING } ?: withMeta.firstOrNull() ?: return null
    val m = mc.metadata ?: return null
    val title = (m.getString(MediaMetadata.METADATA_KEY_TITLE) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: "").trim()
    val artist = (m.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: m.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST) ?: m.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: "").trim()
    val album = (m.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: "").trim()
    val bmp = m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) ?: m.getBitmap(MediaMetadata.METADATA_KEY_ART) ?: m.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
    val pkg = mc.packageName ?: ""
    return Song(title, artist, album, pkg, appLabel(c, pkg), art(bmp))
  }

  fun songJson(s: Song, withArt: Boolean): JSONObject {
    val o = JSONObject()
    o.put("title", s.title)
    o.put("artist", s.artist)
    o.put("album", s.album)
    o.put("pkg", s.pkg)
    o.put("app", s.app)
    if (withArt && s.art != null) o.put("image", "data:image/jpeg;base64," + Base64.encodeToString(s.art, Base64.NO_WRAP))
    return o
  }

  /** 一键把这首歌收进收件箱（磁贴 / 通知按钮用） */
  fun saveSong(c: Context, s: Song, why: String = "", tags: List<String> = emptyList()): String {
    val o = JSONObject()
    o.put("kind", "music")
    o.put("title", s.title)
    o.put("artist", s.artist)
    o.put("album", s.album)
    o.put("source", s.app)
    o.put("sourcePkg", s.pkg)
    if (why.isNotBlank()) o.put("why", why.trim())
    if (tags.isNotEmpty()) o.put("tags", JSONArray(tags))
    return put(c, o, s.art)
  }

  fun saveNote(c: Context, text: String, kind: String = "note") : String {
    val o = JSONObject()
    o.put("kind", kind)
    o.put("text", text)
    return put(c, o)
  }

  // —— 常驻通知「随手拾一穗」 ——
  fun notifyOn(c: Context): Boolean = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("note_on", false)

  fun setNotifyOn(c: Context, on: Boolean) {
    c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("note_on", on).apply()
    if (on) postQuick(c, null) else cancelQuick(c)
  }

  fun cancelQuick(c: Context) {
    (c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTE_ID)
  }

  /** 发 / 刷新常驻通知；没有通知权限就什么都不做（返回 false） */
  fun postQuick(c: Context, line: String?): Boolean {
    val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!nm.areNotificationsEnabled()) return false
    val ch = NotificationChannel(CHANNEL, "随手拾一穗（常驻）", NotificationManager.IMPORTANCE_LOW)
    ch.description = "在通知栏里打字就存一穗，或一键拾正在播放的歌"
    ch.setShowBadge(false)
    nm.createNotificationChannel(ch)
    val mutable = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
    val icon = Icon.createWithResource(c, R.drawable.glean_stat)
    val input = RemoteInput.Builder(KEY_REPLY).setLabel("此刻戳到你的是什么").build()
    val replyPi = PendingIntent.getBroadcast(c, 1, Intent(c, GleanReceiver::class.java).setAction(ACTION_REPLY), PendingIntent.FLAG_UPDATE_CURRENT or mutable)
    val reply = Notification.Action.Builder(icon, "拾一穗", replyPi).addRemoteInput(input).build()
    // 有通知使用权：按钮直接在后台收歌；没有：打开半屏面板先说明再去授权（通知按钮不能从广播里再拉起界面）
    val musicPi = if (hasMediaAccess(c)) {
      PendingIntent.getBroadcast(c, 2, Intent(c, GleanReceiver::class.java).setAction(ACTION_MUSIC), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    } else {
      PendingIntent.getActivity(c, 2, quickIntent(c, "music").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val music = Notification.Action.Builder(icon, "♪ 拾这首歌", musicPi).build()
    val open = PendingIntent.getActivity(c, 3, quickIntent(c, "note").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val n = Notification.Builder(c, CHANNEL)
      .setSmallIcon(R.drawable.glean_stat)
      .setContentTitle("随手拾一穗")
      .setContentText(line ?: "在这里打字就存，或拾正在播放的歌")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setContentIntent(open)
      .addAction(reply)
      .addAction(music)
      .build()
    nm.notify(NOTE_ID, n)
    return true
  }
}
