package __PKG__

// v0.22 极速采集的系统入口：通知使用权占位服务、两个快捷设置磁贴、通知按钮 / 开机的广播、桌面小部件。

import android.app.PendingIntent
import android.app.RemoteInput
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.RemoteViews
import android.widget.Toast

/** 只为拿到 MediaSessionManager.getActiveSessions 的资格；不读、不存任何通知 */
class GleanMediaListener : NotificationListenerService()

private fun collapseTo(ts: TileService, i: Intent) {
  i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  if (Build.VERSION.SDK_INT >= 34) {
    ts.startActivityAndCollapse(PendingIntent.getActivity(ts, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
  } else {
    @Suppress("DEPRECATION") ts.startActivityAndCollapse(i)
  }
}

/** 下拉快捷设置「拾一穗」：弹出半屏速记 */
class QuickTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.let {
      it.label = "拾一穗"
      it.state = Tile.STATE_INACTIVE
      it.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    collapseTo(this, Glean.quickIntent(this, "note"))
  }
}

/** 下拉快捷设置「拾这首歌」：有通知使用权时一点就收，没有时打开面板先说明 */
class MusicTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    qsTile?.let {
      it.label = "拾这首歌"
      it.state = Tile.STATE_INACTIVE
      if (Build.VERSION.SDK_INT >= 29) it.subtitle = if (Glean.hasMediaAccess(this)) "一点就收" else "需先授权"
      it.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    if (!Glean.hasMediaAccess(this)) {
      collapseTo(this, Glean.quickIntent(this, "music"))
      return
    }
    val s = try { Glean.nowPlaying(this) } catch (e: Exception) { null }
    if (s == null) {
      Toast.makeText(this, "现在没有在放的歌", Toast.LENGTH_SHORT).show()
    } else {
      Glean.saveSong(this, s)
      Toast.makeText(this, "已拾 ♪ ${s.title}", Toast.LENGTH_SHORT).show()
    }
  }
}

/** 常驻通知的「拾一穗」回复框、「♪ 拾这首歌」按钮；开机 / 升级后把常驻通知补回来 */
class GleanReceiver : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) {
    when (i.action) {
      Glean.ACTION_REPLY -> {
        val t = RemoteInput.getResultsFromIntent(i)?.getCharSequence(Glean.KEY_REPLY)?.toString()?.trim() ?: ""
        if (t.isNotEmpty()) {
          Glean.saveNote(c, t)
          Glean.postQuick(c, "已拾：" + if (t.length > 24) t.take(24) + "…" else t)
        } else {
          Glean.postQuick(c, null)
        }
      }
      Glean.ACTION_MUSIC -> {
        val s = try { Glean.nowPlaying(c) } catch (e: Exception) { null }
        if (s == null) {
          Glean.postQuick(c, "现在没有在放的歌")
        } else {
          Glean.saveSong(c, s)
          Glean.postQuick(c, "已拾 ♪ " + s.title + if (s.artist.isNotEmpty()) " — " + s.artist else "")
        }
      }
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
        if (Glean.notifyOn(c)) Glean.postQuick(c, null)
      }
    }
  }
}

/** 桌面 4×1 小部件：拾一穗 / 粘贴 / ♪ 这首歌 / 穗仓（纯文字按钮，跟随系统深浅色） */
class GleanWidget : AppWidgetProvider() {
  override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
    for (id in ids) m.updateAppWidget(id, views(c))
  }

  companion object {
    fun views(c: Context): RemoteViews {
      val v = RemoteViews(c.packageName, R.layout.glean_widget)
      fun quick(mode: String, code: Int) =
        PendingIntent.getActivity(c, code, Glean.quickIntent(c, mode).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      v.setOnClickPendingIntent(R.id.gw_note, quick("note", 20))
      v.setOnClickPendingIntent(R.id.gw_paste, quick("paste", 21))
      v.setOnClickPendingIntent(R.id.gw_music, quick("music", 22))
      val open = c.packageManager.getLaunchIntentForPackage(c.packageName) ?: Intent(c, MainActivity::class.java)
      v.setOnClickPendingIntent(R.id.gw_open, PendingIntent.getActivity(c, 23, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      return v
    }
  }
}

/** v0.36 0505：桌面 1×1 小组件「拾」——点一下就是半屏速记卡（和磁贴「拾一穗」同一个入口，写进 glean_inbox 收件队列） */
class GleanWidgetOne : AppWidgetProvider() {
  override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
    val v = RemoteViews(c.packageName, R.layout.glean_widget_one)
    val pi = PendingIntent.getActivity(c, 30, Glean.quickIntent(c, "note").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    v.setOnClickPendingIntent(R.id.gw1_root, pi)
    for (id in ids) m.updateAppWidget(id, v)
  }
}
