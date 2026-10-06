package com.profico.farmer.timernotification

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.net.InetAddress
import java.net.URI
import java.net.URISyntaxException
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

  /**
   * Keeps the credential. Refuses (and clears what was stored) an origin that
   * is not https, unless the host is on this machine or a local network. This
   * is the rule of `normalizeOrigin` in `@farmer/api-client`: the token would
   * cross the network in clear text. Gives false when it refuses.
   */
  fun save(context: Context, credential: Credential): Boolean {
    if (!isAllowedOrigin(credential.origin)) {
      clear(context)
      return false
    }
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
    return true
  }

  internal fun isAllowedOrigin(origin: String): Boolean {
    val uri = try {
      URI(origin)
    } catch (_: URISyntaxException) {
      return false
    }
    val host = uri.host ?: return false
    return when (uri.scheme?.lowercase()) {
      "https" -> true
      "http" -> isLocalHost(host)
      else -> false
    }
  }

  /** The same hosts as `isLocalHost` in `@farmer/api-client`. */
  internal fun isLocalHost(host: String): Boolean {
    val name = host.lowercase().removePrefix("[").removeSuffix("]")
    if (name == "localhost" || name.endsWith(".local")) return true
    val parts = name.split(".")
    if (parts.size == 4 && parts.all { it.length in 1..3 && it.all(Char::isDigit) }) {
      val octets = parts.map { it.toInt() }
      if (octets.any { it > 255 }) return false
      val (a, b) = octets
      return a == 127 || a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168)
    }
    // A literal IPv6 address. The hex check keeps a host name out of
    // `InetAddress`, which would ask the network.
    if (!name.contains(':') || !name.all { it.isDigit() || it in 'a'..'f' || it == ':' }) {
      return false
    }
    return try {
      val bytes = InetAddress.getByName(name).address
      bytes.size == 16 && (
        InetAddress.getByAddress(bytes).isLoopbackAddress ||
          (bytes[0].toInt() and 0xfe) == 0xfc
        )
    } catch (_: Exception) {
      false
    }
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
