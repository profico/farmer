package com.profico.farmer.timernotification

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The Server address and the session token that Pause and Resume use when the
 * app is not running. The JavaScript side sets them while a person is signed
 * in, and clears them on sign-out.
 *
 * The token is encrypted with an AES key that stays in the Android Keystore,
 * as expo-secure-store keeps the session. Only the ciphertext is in the
 * preferences file.
 */
data class Credential(val origin: String, val token: String, val userAgent: String)

object CredentialStore {
  private const val PREFS = "farmer.timer_credential"
  private const val KEY_ALIAS = "farmer.timer_credential"
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  fun save(context: Context, credential: Credential) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val sealed = cipher.doFinal(credential.token.toByteArray(Charsets.UTF_8))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString("origin", credential.origin)
      .putString("userAgent", credential.userAgent)
      .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("token", Base64.encodeToString(sealed, Base64.NO_WRAP))
      .apply()
  }

  fun read(context: Context): Credential? {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val origin = prefs.getString("origin", null) ?: return null
    val userAgent = prefs.getString("userAgent", null) ?: "farmer-mobile"
    val iv = prefs.getString("iv", null) ?: return null
    val sealed = prefs.getString("token", null) ?: return null
    return try {
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(
        Cipher.DECRYPT_MODE,
        key(),
        GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP))
      )
      val token = String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)), Charsets.UTF_8)
      Credential(origin, token, userAgent)
    } catch (_: Exception) {
      null
    }
  }

  fun clear(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }
}
