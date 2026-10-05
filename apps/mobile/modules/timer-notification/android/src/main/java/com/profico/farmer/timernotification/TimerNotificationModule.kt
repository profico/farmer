package com.profico.farmer.timernotification

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/** What JavaScript gives to `show`. See `TimerSnapshot`. */
class TimerNotificationState : Record {
  @Field val title: String = ""
  @Field val text: String = ""
  @Field val paused: Boolean = false
  @Field val elapsedSeconds: Double = 0.0
  @Field val anchorMs: Double = 0.0
  @Field val workspace: String = ""
  @Field val stopUrl: String = ""
  @Field val openUrl: String = ""
}

/**
 * The ongoing timer notification on Android. iOS uses a Live Activity
 * instead (`modules/live-activity`).
 */
class TimerNotificationModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TimerNotification")

    Function("canPost") {
      TimerNotifier.canPost(context)
    }

    Function("show") { state: TimerNotificationState ->
      TimerNotifier.post(
        context,
        TimerSnapshot(
          title = state.title,
          text = state.text,
          paused = state.paused,
          elapsedSeconds = state.elapsedSeconds,
          anchorMs = state.anchorMs,
          workspace = state.workspace,
          stopUrl = state.stopUrl,
          openUrl = state.openUrl
        )
      )
    }

    Function("hide") {
      TimerNotifier.cancel(context)
    }

    Function("setCredential") { origin: String, token: String, userAgent: String ->
      CredentialStore.save(context, Credential(origin, token, userAgent))
    }

    Function("clearCredential") {
      CredentialStore.clear(context)
    }
  }
}
