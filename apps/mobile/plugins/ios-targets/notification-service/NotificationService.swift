import CryptoKit
import UserNotifications

// WRITTEN, NOT COMPILED: written on Linux, where Xcode does not run.
//
// The relay sends an alert with a placeholder text ("Farmer", "New
// notification") and the sealed payload in `e` (`apps/push-relay/README.md`).
// This extension opens `e` with the device key and puts the real title and
// body in the notification before iOS shows it. The relay never sees them.
//
// The suite is HPKE base mode, P256_SHA256_AES_GCM_256, with the info
// "farmer push v1": the same as `@farmer/push-crypto`. The sealed value is
// base64url(enc || ct), and `enc` is the 65-byte uncompressed point.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  private static let info = Data("farmer push v1".utf8)
  private static let encLength = 65

  private struct Alert: Decodable {
    let title: String
    let body: String
    let url: String?
  }

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttempt = content
    if let sealed = content.userInfo["e"] as? String, let alert = Self.open(sealed) {
      content.title = alert.title
      content.body = alert.body
      if let url = alert.url {
        // The app reads this on a tap (`src/push/push-bridge.tsx`).
        content.userInfo["farmerUrl"] = url
      }
    }
    contentHandler(content)
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let bestAttempt {
      contentHandler(bestAttempt)
    }
  }

  private static func open(_ sealed: String) -> Alert? {
    guard
      let keyText = SharedKeychain.read("farmer.push.device-key"),
      let keyBytes = SharedKeychain.base64UrlDecode(keyText),
      let bytes = SharedKeychain.base64UrlDecode(sealed),
      bytes.count > encLength + 16,
      let privateKey = try? P256.KeyAgreement.PrivateKey(rawRepresentation: keyBytes)
    else { return nil }
    let enc = bytes.prefix(encLength)
    let ciphertext = bytes.dropFirst(encLength)
    do {
      var recipient = try HPKE.Recipient(
        privateKey: privateKey,
        ciphersuite: .P256_SHA256_AES_GCM_256,
        info: info,
        encapsulatedKey: Data(enc)
      )
      let plaintext = try recipient.open(Data(ciphertext))
      return try JSONDecoder().decode(Alert.self, from: plaintext)
    } catch {
      return nil
    }
  }
}
