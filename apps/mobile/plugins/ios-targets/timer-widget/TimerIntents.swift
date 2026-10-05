import AppIntents
import Foundation

// WRITTEN, NOT COMPILED.
//
// Pause and Resume on the Live Activity. The intent runs in the widget
// extension and calls the Server itself, with the session that the app keeps
// in the app group's Keychain (`farmer.push.credential`). The Server then
// sends a Live Activity update with the new state.
//
// Stop is not an intent: it opens the app on the stop sheet, where the person
// confirms the figure (ADR 0003). Nothing confirms an entry from here.
struct TimerActionIntent: AppIntent {
  static var title: LocalizedStringResource = "Pause or resume the timer"
  static var isDiscoverable = false

  @Parameter(title: "Action")
  var action: String

  @Parameter(title: "Workspace")
  var workspace: String

  init() {}

  init(action: String, workspace: String) {
    self.action = action
    self.workspace = workspace
  }

  private struct Credential: Decodable {
    let origin: String
    let token: String
  }

  func perform() async throws -> some IntentResult {
    guard action == "pause" || action == "resume",
          let raw = SharedKeychain.read("farmer.push.credential"),
          let credential = try? JSONDecoder().decode(Credential.self, from: Data(raw.utf8)),
          let slug = workspace.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
          let url = URL(string: "\(credential.origin)/api/v1/orgs/\(slug)/timer/\(action)")
    else { return .result() }

    var request = URLRequest(url: url, timeoutInterval: 10)
    request.httpMethod = "POST"
    request.setValue("Bearer \(credential.token)", forHTTPHeaderField: "authorization")
    request.setValue("application/json", forHTTPHeaderField: "accept")
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = Data("{}".utf8)
    _ = try? await URLSession.shared.data(for: request)
    return .result()
  }
}
