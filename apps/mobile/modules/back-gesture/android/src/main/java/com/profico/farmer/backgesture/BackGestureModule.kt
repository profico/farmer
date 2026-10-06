package com.profico.farmer.backgesture

import android.os.Build
import android.util.Log
import androidx.activity.OnBackPressedCallback
import com.facebook.react.ReactActivity
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference

/**
 * Lets JavaScript hand the back gesture to Android.
 *
 * With `enableOnBackInvokedCallback` on, Android plays the back-to-home
 * preview only when the activity has no enabled back callback. Two things in
 * React Native 0.86 (`ReactActivity`) get in the way:
 *
 * - From Android 16 (API 36) with target SDK 36, it adds one
 *   `OnBackPressedCallback` that is always enabled, so the app takes every
 *   back gesture. The callback is a private field with no accessor and no
 *   setting, so the only way to switch it off is reflection. The lookup is
 *   by type, not by name, and it fails safe: when the field is not there
 *   (another React Native version), nothing changes and Back works as
 *   before. Check this file again on each React Native upgrade.
 * - Before that, it adds no callback at all, and with the flag on Android no
 *   longer calls `onBackPressed()`, so the Back event would never reach
 *   JavaScript. Then this module adds a callback of its own that does what
 *   the React Native one does.
 */
class BackGestureModule : Module() {
  // The last value from JavaScript. A new activity, or a return from the
  // background, gets a callback that is enabled again, so the value is
  // applied again at those times.
  private var systemOwnsBack = false
  private var ownCallback: OnBackPressedCallback? = null
  private var ownCallbackActivity = WeakReference<ReactActivity>(null)

  override fun definition() = ModuleDefinition {
    Name("BackGesture")

    /** True when the app has nothing to go back to: Android handles Back. */
    Function("setSystemOwnsBack") { owns: Boolean ->
      systemOwnsBack = owns
      apply()
    }

    OnActivityEntersForeground { apply() }
  }

  private fun apply() {
    val activity = appContext.currentActivity as? ReactActivity ?: return
    activity.runOnUiThread { setCallbackEnabled(activity, !systemOwnsBack) }
  }

  private fun reactAddsCallback(activity: ReactActivity): Boolean =
    Build.VERSION.SDK_INT >= 36 && activity.applicationInfo.targetSdkVersion >= 36

  private fun setCallbackEnabled(activity: ReactActivity, enabled: Boolean) {
    if (!reactAddsCallback(activity)) {
      ownCallbackFor(activity).isEnabled = enabled
      return
    }
    try {
      val field = ReactActivity::class.java.declaredFields
        .firstOrNull { OnBackPressedCallback::class.java.isAssignableFrom(it.type) }
      if (field == null) {
        Log.w(TAG, "ReactActivity has no OnBackPressedCallback field; Back is unchanged")
        return
      }
      field.isAccessible = true
      (field.get(activity) as? OnBackPressedCallback)?.isEnabled = enabled
    } catch (error: ReflectiveOperationException) {
      Log.w(TAG, "Cannot reach the back callback; Back is unchanged", error)
    } catch (error: SecurityException) {
      Log.w(TAG, "Cannot reach the back callback; Back is unchanged", error)
    }
  }

  /** The callback of this module, for an activity that React Native adds none to. */
  @Suppress("DEPRECATION")
  private fun ownCallbackFor(activity: ReactActivity): OnBackPressedCallback {
    val existing = ownCallback
    if (existing != null && ownCallbackActivity.get() === activity) return existing
    val callback = object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        // `onBackPressed` asks JavaScript first. When JavaScript lets the
        // event go, it ends in `super.onBackPressed`, which runs the enabled
        // callbacks again, so this one is off while it runs.
        isEnabled = false
        activity.onBackPressed()
        isEnabled = true
      }
    }
    activity.onBackPressedDispatcher.addCallback(activity, callback)
    ownCallback = callback
    ownCallbackActivity = WeakReference(activity)
    return callback
  }

  private companion object {
    const val TAG = "BackGesture"
  }
}
