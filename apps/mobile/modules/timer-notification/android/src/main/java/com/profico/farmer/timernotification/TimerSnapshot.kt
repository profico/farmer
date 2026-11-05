package com.profico.farmer.timernotification

import org.json.JSONObject

/**
 * What the ongoing notification shows. The figure is `elapsedSeconds` at
 * `anchorMs` (the phone's clock): a running timer counts on from there, and a
 * paused one stands still.
 */
data class TimerSnapshot(
  val title: String,
  val text: String,
  val paused: Boolean,
  val elapsedSeconds: Double,
  val anchorMs: Double,
  val workspace: String,
  val stopUrl: String,
  val openUrl: String,
  /** A line that replaces `text`, for example after a failed pause. */
  val notice: String? = null
) {
  /** The start of the chronometer: the anchor minus the figure. */
  val chronometerBaseMs: Long
    get() = (anchorMs - elapsedSeconds * 1000.0).toLong()

  fun toJson(): String = JSONObject()
    .put("title", title)
    .put("text", text)
    .put("paused", paused)
    .put("elapsedSeconds", elapsedSeconds)
    .put("anchorMs", anchorMs)
    .put("workspace", workspace)
    .put("stopUrl", stopUrl)
    .put("openUrl", openUrl)
    .put("notice", notice ?: JSONObject.NULL)
    .toString()

  companion object {
    fun fromJson(raw: String): TimerSnapshot? = try {
      val json = JSONObject(raw)
      TimerSnapshot(
        title = json.getString("title"),
        text = json.getString("text"),
        paused = json.getBoolean("paused"),
        elapsedSeconds = json.getDouble("elapsedSeconds"),
        anchorMs = json.getDouble("anchorMs"),
        workspace = json.getString("workspace"),
        stopUrl = json.getString("stopUrl"),
        openUrl = json.getString("openUrl"),
        notice = if (json.isNull("notice")) null else json.getString("notice")
      )
    } catch (_: Exception) {
      null
    }
  }
}
