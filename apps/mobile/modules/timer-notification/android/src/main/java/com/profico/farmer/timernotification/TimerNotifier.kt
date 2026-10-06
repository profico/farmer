package com.profico.farmer.timernotification

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri

/**
 * Builds and posts the ongoing timer notification (ADR 0003, ADR 0005).
 *
 * The notification shows the elapsed time only. Stop opens the app on the
 * stop sheet, where the person confirms the figure: nothing confirms an entry
 * from the notification. Pause and Resume go to `TimerActionReceiver`, which
 * calls the server without the app.
 */
object TimerNotifier {
  const val CHANNEL_ID = "timer"
  const val NOTIFICATION_ID = 4711

  const val ACTION_PAUSE = "com.profico.farmer.timer.PAUSE"
  const val ACTION_RESUME = "com.profico.farmer.timer.RESUME"

  private const val PREFS = "farmer.timer_notification"
  private const val SNAPSHOT_KEY = "snapshot"

  private fun manager(context: Context) =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  /** The channel "Timer": low importance, so it makes no sound and does not
   *  pop up. Creating it again changes nothing. */
  fun ensureChannel(context: Context) {
    val channel = NotificationChannel(CHANNEL_ID, "Timer", NotificationManager.IMPORTANCE_LOW).apply {
      description = "The timer while it runs or is paused."
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    manager(context).createNotificationChannel(channel)
  }

  fun canPost(context: Context): Boolean = manager(context).areNotificationsEnabled()

  /** The brand small icon when the app has one, else the stopwatch of this
   *  module. `notification_icon` is the name that the expo-notifications
   *  config plugin gives the brand icon. */
  private fun smallIcon(context: Context): Int {
    val brand = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    return if (brand != 0) brand else R.drawable.farmer_timer_notification
  }

  private fun viewIntent(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    // A direct activity intent: Android 12 and later block a notification
    // "trampoline" (a receiver that starts an activity).
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  private fun broadcastIntent(context: Context, action: String, requestCode: Int): PendingIntent {
    val intent = Intent(context, TimerActionReceiver::class.java).setAction(action)
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  fun formatElapsed(seconds: Double): String {
    val total = seconds.toLong().coerceAtLeast(0)
    val hours = total / 3600
    val minutes = (total % 3600) / 60
    val secs = total % 60
    return "%d:%02d:%02d".format(hours, minutes, secs)
  }

  fun post(context: Context, snapshot: TimerSnapshot) {
    ensureChannel(context)
    save(context, snapshot)
    val icon = smallIcon(context)
    val stateLine = if (snapshot.paused) {
      "Paused at ${formatElapsed(snapshot.elapsedSeconds)}"
    } else {
      "Running"
    }
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(icon)
      .setContentTitle(snapshot.title)
      .setContentText(snapshot.notice ?: "$stateLine · ${snapshot.text}")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_STOPWATCH)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(viewIntent(context, snapshot.openUrl, 1))

    if (snapshot.paused) {
      // A paused timer shows its frozen figure, and no clock.
      builder.setUsesChronometer(false).setShowWhen(false)
      builder.addAction(
        Notification.Action.Builder(
          Icon.createWithResource(context, icon),
          "Resume",
          broadcastIntent(context, ACTION_RESUME, 3)
        ).build()
      )
    } else {
      builder
        .setUsesChronometer(true)
        .setShowWhen(true)
        .setWhen(snapshot.chronometerBaseMs)
      builder.addAction(
        Notification.Action.Builder(
          Icon.createWithResource(context, icon),
          "Pause",
          broadcastIntent(context, ACTION_PAUSE, 2)
        ).build()
      )
    }
    builder.addAction(
      Notification.Action.Builder(
        Icon.createWithResource(context, icon),
        "Stop",
        viewIntent(context, snapshot.stopUrl, 4)
      ).build()
    )
    manager(context).notify(NOTIFICATION_ID, builder.build())
  }

  fun cancel(context: Context) {
    manager(context).cancel(NOTIFICATION_ID)
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(SNAPSHOT_KEY).apply()
  }

  fun lastSnapshot(context: Context): TimerSnapshot? =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(SNAPSHOT_KEY, null)
      ?.let { TimerSnapshot.fromJson(it) }

  private fun save(context: Context, snapshot: TimerSnapshot) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(SNAPSHOT_KEY, snapshot.toJson())
      .apply()
  }
}
