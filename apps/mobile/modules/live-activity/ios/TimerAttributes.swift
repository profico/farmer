import ActivityKit
import Foundation

// The attributes of the timer's Live Activity. The Server's push-to-start
// names this type ("TimerAttributes") and sends `{ "version": 1 }`, so every
// label is optional. The widget target has a copy of this file
// (`plugins/ios-targets/timer-widget/TimerAttributes.swift`): keep the two the
// same, field for field.
//
// The content state holds numbers and the workspace slug only. The relay
// cannot encrypt it, because iOS reads it directly. `runningSinceMs` is Unix
// milliseconds as a plain number, never a Swift `Date`: ActivityKit decodes a
// `Date` as seconds since 2001.
public struct TimerAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "running" or "held".
    public var state: String
    /// Unix milliseconds of the start of the running segment, or nil while
    /// held.
    public var runningSinceMs: Double?
    /// The figure at `runningSinceMs`, or the whole figure while held.
    public var accumulatedSeconds: Double
    /// The workspace slug of the timer.
    public var workspace: String?

    public init(state: String, runningSinceMs: Double?, accumulatedSeconds: Double, workspace: String?) {
      self.state = state
      self.runningSinceMs = runningSinceMs
      self.accumulatedSeconds = accumulatedSeconds
      self.workspace = workspace
    }
  }

  public var version: Int
  /// The labels exist only on an activity that the app started.
  public var workspaceName: String?
  public var project: String?
  public var task: String?

  public init(version: Int, workspaceName: String?, project: String?, task: String?) {
    self.version = version
    self.workspaceName = workspaceName
    self.project = project
    self.task = task
  }
}
