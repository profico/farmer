import Foundation

// WRITTEN, NOT COMPILED. A COPY of
// `plugins/ios-targets/notification-service/SharedKeychain.swift`.
//
// Reads an item that the app wrote with expo-secure-store into the app
// group's Keychain (`apps/mobile/src/push/storage.ts`). expo-secure-store
// writes a generic password with:
//   - service: the `keychainService` option and ":no-auth", so
//     "farmer.push:no-auth"
//   - account: the key, as UTF-8 data
//   - access group: "group.com.profico.farmer"
//   - accessible: after the first unlock, so a push on a locked phone opens
enum SharedKeychain {
  static let service = "farmer.push:no-auth"
  static let accessGroup = "group.com.profico.farmer"

  static func read(_ key: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: Data(key.utf8),
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  /// Base64url without padding, as the app writes it.
  static func base64UrlDecode(_ value: String) -> Data? {
    var base64 = value.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64.append("=") }
    return Data(base64Encoded: base64)
  }
}
