package __PKG__

// v0.45 ROADMAP v0.33 到点递一穗（安卓原生部分）：
// - JS（src/lib/ping.ts）每次打开 App 把 { on, at: "HH:MM", msgs: { "yyyy-mm-dd": { title, body } } } 交给 LinganDaily.set；
//   这里存进 SharedPreferences，用 AlarmManager.setWindow 排一个不精确的闹钟（窗口 10 分钟，不用 SCHEDULE_EXACT_ALARM 权限）。
// - 到点 GleanReceiver 收到 ACTION_DAILY → 发「今日一穗」通知（单独的通知渠道，0555 的一部分），点开 = glean://go/daily，再排明天的。
//   msgs 里没有那天的（一周没开 App）就发通用的一句；锁屏上只显示「拾穗 · 今日一穗」（VISIBILITY_PRIVATE + 公开版）。
// - 开机 / 更新后 GleanReceiver 已有的 BOOT_COMPLETED / MY_PACKAGE_REPLACED 分支里重排。
// - 0528 vivo 后台保活引导：guide() 依次试 vivo 的自启动 / 后台耗电管理页，都打不开就去系统电池优化列表，再不行去应用详情。

import android.app.Activity
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.Calendar

object GleanDaily {
  const val ACTION_DAILY = "com.q1f730.lingan.DAILY"
  const val CHANNEL = "glean_daily"
  const val NOTE_ID = 7302
  private const val PREFS = "glean_daily"

  fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun pending(c: Context): PendingIntent =
    PendingIntent.getBroadcast(c, 40, Intent(c, GleanReceiver::class.java).setAction(ACTION_DAILY), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

  /** 下一次的时间：今天这个点还没过就今天，否则明天 */
  fun next(at: String, now: Long = System.currentTimeMillis()): Long {
    val p = at.split(":")
    val h = p.getOrNull(0)?.toIntOrNull()?.coerceIn(0, 23) ?: 21
    val m = p.getOrNull(1)?.toIntOrNull()?.coerceIn(0, 59) ?: 30
    val cal = Calendar.getInstance()
    cal.timeInMillis = now
    cal.set(Calendar.HOUR_OF_DAY, h)
    cal.set(Calendar.MINUTE, m)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    if (cal.timeInMillis <= now + 30_000) cal.add(Calendar.DAY_OF_YEAR, 1)
    return cal.timeInMillis
  }

  fun schedule(c: Context) {
    val am = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pending(c)
    am.cancel(pi)
    val p = prefs(c)
    if (!p.getBoolean("on", false)) return
    am.setWindow(AlarmManager.RTC_WAKEUP, next(p.getString("at", "21:30") ?: "21:30"), 10 * 60_000L, pi)
  }

  fun dayKey(t: Long): String {
    val cal = Calendar.getInstance()
    cal.timeInMillis = t
    return String.format("%04d-%02d-%02d", cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, cal.get(Calendar.DAY_OF_MONTH))
  }

  /** 到点：发通知（没权限 / 关了就不发），再排明天的 */
  fun fire(c: Context) {
    try {
      val p = prefs(c)
      if (!p.getBoolean("on", false)) return
      val day = dayKey(System.currentTimeMillis())
      if (p.getString("last", "") == day) return
      val msgs = try { JSONObject(p.getString("msgs", "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
      val m = msgs.optJSONObject(day)
      val title = m?.optString("title")?.takeIf { it.isNotBlank() } ?: "今日一穗"
      val body = m?.optString("body")?.takeIf { it.isNotBlank() } ?: "今天的几穗在等你"
      if (post(c, title.take(60), body.take(200))) p.edit().putString("last", day).apply()
    } finally {
      schedule(c)
    }
  }

  fun post(c: Context, title: String, body: String): Boolean {
    val nm = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!nm.areNotificationsEnabled()) return false
    val ch = NotificationChannel(CHANNEL, "今日一穗（到点递一穗）", NotificationManager.IMPORTANCE_DEFAULT)
    ch.description = "每天你设定的时间递一穗；在拾穗 设置 → 到点递一穗 里改时间或关掉"
    nm.createNotificationChannel(ch)
    if (nm.getNotificationChannel(CHANNEL)?.importance == NotificationManager.IMPORTANCE_NONE) return false
    val open = Intent(c, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("glean://go/daily")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val pi = PendingIntent.getActivity(c, 41, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val pub = Notification.Builder(c, CHANNEL).setSmallIcon(R.drawable.glean_stat).setContentTitle("拾穗").setContentText("今日一穗").build()
    val n = Notification.Builder(c, CHANNEL)
      .setSmallIcon(R.drawable.glean_stat)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(Notification.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setPublicVersion(pub)
      .setContentIntent(pi)
      .build()
    nm.notify(NOTE_ID, n)
    return true
  }

  /** 0528：vivo / iQOO 的自启动与后台耗电设置页（OriginOS 各版本类名不同，逐个试），都不行就退到系统页 */
  fun guide(a: Activity): Boolean {
    val tries = mutableListOf<Intent>()
    if (Build.MANUFACTURER.lowercase().let { it.contains("vivo") || it.contains("iqoo") }) {
      tries += Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"))
      tries += Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"))
      tries += Intent().setComponent(ComponentName("com.vivo.abe", "com.vivo.applicationbehaviorengine.ui.ExcessivePowerManagerActivity"))
      tries += Intent().setComponent(ComponentName("com.iqoo.powersaving", "com.iqoo.powersaving.PowerSavingManagerActivity"))
    }
    tries += Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
    tries += Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).setData(Uri.parse("package:" + a.packageName))
    for (i in tries) {
      try {
        a.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
      } catch (e: Exception) {
      }
    }
    return false
  }
}

/** JS 桥 LinganDaily：set(json) 排闹钟 / 取消；guide() 打开后台保活设置；brand() 给设置页决定要不要显示 vivo 那一行 */
class DailyBridge(private val a: Activity) {
  @JavascriptInterface
  fun set(json: String): Boolean {
    return try {
      val o = JSONObject(json)
      val on = o.optBoolean("on", false)
      val at = o.optString("at", "21:30").takeIf { Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(it) } ?: "21:30"
      val msgs = o.optJSONObject("msgs")?.toString() ?: "{}"
      GleanDaily.prefs(a).edit().putBoolean("on", on).putString("at", at).putString("msgs", if (msgs.length > 20000) "{}" else msgs).apply()
      GleanDaily.schedule(a)
      true
    } catch (e: Exception) {
      false
    }
  }

  @JavascriptInterface
  fun guide(): Boolean = GleanDaily.guide(a)

  @JavascriptInterface
  fun brand(): String = Build.MANUFACTURER ?: ""
}
