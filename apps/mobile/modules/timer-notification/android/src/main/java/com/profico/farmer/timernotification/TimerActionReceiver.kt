package com.profico.farmer.timernotification

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Pause and Resume from the ongoing notification.
 *
 * The receiver calls the server itself, on a background thread, so the
 * button works when the app is not running and does not open the app. This
 * is the robust option: a headless JavaScript task is not reliable under the
 * new architecture, and a receiver must not start an activity on Android 12
 * and later.
 *
 * The answer of the server is the new timer state, and the notification
 * shows it at once. The server also sends a data push for the change, which
 * the app then shows again with the same figure.
 */
class TimerActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val path = when (action) {
      TimerNotifier.ACTION_PAUSE -> "pause"
      TimerNotifier.ACTION_RESUME -> "resume"
      else -> return
    }
    val appContext = context.applicationContext
    val pending = goAsync()
    // The system gives `goAsync()` about 10 seconds. The Keystore decrypt and
    // the request together stop at DEADLINE_MS, so `finish()` always runs
    // before the system ends the broadcast.
    val worker = Executors.newSingleThreadExecutor()
    val job = worker.submit { run(appContext, path) }
    Thread {
      try {
        job.get(DEADLINE_MS, TimeUnit.MILLISECONDS)
      } catch (_: TimeoutException) {
        job.cancel(true)
        notifyFailure(appContext, path)
      } catch (_: Exception) {
        // `run` handles its own failures.
      } finally {
        worker.shutdownNow()
        pending.finish()
      }
    }.start()
  }

  private fun notifyFailure(context: Context, path: String) {
    val snapshot = TimerNotifier.lastSnapshot(context) ?: return
    TimerNotifier.post(
      context,
      snapshot.copy(notice = "Could not $path the timer. Open Farmer and try again.")
    )
  }

  private companion object {
    const val DEADLINE_MS = 8_000L
  }

  private fun run(context: Context, path: String) {
    val snapshot = TimerNotifier.lastSnapshot(context) ?: return
    val credential = CredentialStore.read(context)
    if (credential == null) {
      TimerNotifier.post(context, snapshot.copy(notice = "Open Farmer to $path the timer."))
      return
    }
    val result = try {
      call(credential, snapshot.workspace, path)
    } catch (_: Exception) {
      null
    }
    when (result) {
      null -> TimerNotifier.post(
        context,
        snapshot.copy(notice = "Could not $path the timer. Open Farmer and try again.")
      )
      is Outcome.Gone -> TimerNotifier.cancel(context)
      is Outcome.State -> TimerNotifier.post(
        context,
        snapshot.copy(
          paused = result.paused,
          elapsedSeconds = result.elapsedSeconds,
          anchorMs = System.currentTimeMillis().toDouble(),
          notice = null
        )
      )
    }
  }

  private sealed class Outcome {
    object Gone : Outcome()
    data class State(val paused: Boolean, val elapsedSeconds: Double) : Outcome()
  }

  /** `POST /api/v1/orgs/{slug}/timer/{pause|resume}`. Null on a failure. */
  private fun call(credential: Credential, workspace: String, path: String): Outcome? {
    val url = URL(
      "${credential.origin}/api/v1/orgs/${Uri.encode(workspace)}/timer/$path"
    )
    val connection = url.openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 4_000
      connection.readTimeout = 5_000
      connection.doOutput = true
      connection.setRequestProperty("authorization", "Bearer ${credential.token}")
      connection.setRequestProperty("accept", "application/json")
      connection.setRequestProperty("content-type", "application/json")
      connection.setRequestProperty("user-agent", credential.userAgent)
      connection.outputStream.use { it.write("{}".toByteArray()) }
      val status = connection.responseCode
      if (status !in 200..299) return null
      val body = connection.inputStream.bufferedReader().use { it.readText() }
      val json = JSONObject(body)
      if (json.isNull("timer")) return Outcome.Gone
      val timer = json.getJSONObject("timer")
      if (!timer.isNull("droppedAt")) return Outcome.Gone
      return Outcome.State(
        paused = timer.getBoolean("paused"),
        elapsedSeconds = timer.getDouble("elapsedSeconds")
      )
    } finally {
      connection.disconnect()
    }
  }
}
