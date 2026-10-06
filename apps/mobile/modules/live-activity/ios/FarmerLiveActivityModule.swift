import ActivityKit
import ExpoModulesCore

// BUILT ON A MAC, NOT RUN ON A DEVICE: the iOS app built on a Mac on
// 6 Oct 2026. Run it on a device before a release.

struct LabelsRecord: Record {
  @Field var workspaceName: String = ""
  @Field var project: String? = nil
  @Field var task: String = ""
}

struct ContentStateRecord: Record {
  @Field var state: String = "held"
  @Field var runningSinceMs: Double? = nil
  @Field var accumulatedSeconds: Double = 0
  @Field var workspace: String = ""
}

private func hex(_ data: Data) -> String {
  data.map { String(format: "%02x", $0) }.joined()
}

/// The tasks that watch the activities. JavaScript, `OnCreate`,
/// `OnDestroy` and the watch tasks reach them from different threads, so
/// each access holds the lock.
private final class WatchTasks: @unchecked Sendable {
  private let lock = NSLock()
  private var tokens: [String: Task<Void, Never>] = [:]
  private var others: [Task<Void, Never>] = []

  /// Starts a task for the activity id, unless one runs already.
  func watch(_ id: String, _ make: () -> Task<Void, Never>) {
    lock.lock()
    defer { lock.unlock() }
    guard tokens[id] == nil else { return }
    tokens[id] = make()
  }

  func keep(_ task: Task<Void, Never>) {
    lock.lock()
    defer { lock.unlock() }
    others.append(task)
  }

  func cancelAll() {
    lock.lock()
    defer { lock.unlock() }
    others.forEach { $0.cancel() }
    tokens.values.forEach { $0.cancel() }
    others.removeAll()
    tokens.removeAll()
  }
}

/// The timer's Live Activity, for the app (`modules/live-activity/index.ts`).
///
/// The app keeps at most one activity. `show` updates the activity whose
/// labels match, and ends every other one, also an activity that a
/// push-to-start opened without labels. The tokens of each activity go to
/// JavaScript, which gives them to the Server.
public class FarmerLiveActivityModule: Module {
  private let tasks = WatchTasks()

  public func definition() -> ModuleDefinition {
    Name("FarmerLiveActivity")

    Events("onActivityPushToken", "onPushToStartToken", "onActivityEnded")

    OnCreate {
      self.observe()
    }

    OnDestroy {
      self.tasks.cancelAll()
    }

    Function("areActivitiesEnabled") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    Function("pushToStartToken") { () -> String? in
      Activity<TimerAttributes>.pushToStartToken.map(hex)
    }

    Function("show") { (labels: LabelsRecord, record: ContentStateRecord) -> String? in
      self.show(labels: labels, record: record)
    }

    // The token of the activity that runs now. JavaScript reads it after a
    // restart, because the event of `watchToken` fires in `OnCreate`, before
    // JavaScript has a listener.
    Function("activityPushToken") { () -> String? in
      Activity<TimerAttributes>.activities
        .first { $0.activityState == .active || $0.activityState == .stale }?
        .pushToken.map(hex)
    }

    Function("endAll") {
      let activities = Activity<TimerAttributes>.activities
      Task {
        for activity in activities {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
    }
  }

  private func show(labels: LabelsRecord, record: ContentStateRecord) -> String? {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
    let state = TimerAttributes.ContentState(
      state: record.state == "running" ? "running" : "held",
      runningSinceMs: record.state == "running" ? record.runningSinceMs : nil,
      accumulatedSeconds: record.accumulatedSeconds,
      workspace: record.workspace
    )
    let content = ActivityContent(state: state, staleDate: nil)
    let activities = Activity<TimerAttributes>.activities.filter {
      $0.activityState == .active || $0.activityState == .stale
    }
    let match = activities.first {
      $0.attributes.project == labels.project
        && $0.attributes.task == labels.task
        && $0.attributes.workspaceName == labels.workspaceName
    }
    let others = activities.filter { $0.id != match?.id }
    Task {
      for other in others {
        await other.end(nil, dismissalPolicy: .immediate)
      }
      if let match {
        await match.update(content)
      }
    }
    if let match { return match.id }

    let attributes = TimerAttributes(
      version: 1,
      workspaceName: labels.workspaceName,
      project: labels.project,
      task: labels.task
    )
    do {
      let activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
      watchToken(of: activity)
      return activity.id
    } catch {
      // Without the push entitlement a request for a token fails. The
      // activity still counts on the phone without remote updates.
      let activity = try? Activity.request(attributes: attributes, content: content, pushType: nil)
      return activity?.id
    }
  }

  private func observe() {
    for activity in Activity<TimerAttributes>.activities {
      watchToken(of: activity)
    }
    tasks.keep(Task { [weak self] in
      // An activity that a push-to-start opened while the app runs.
      for await activity in Activity<TimerAttributes>.activityUpdates {
        self?.watchToken(of: activity)
      }
    })
    tasks.keep(Task { [weak self] in
      for await data in Activity<TimerAttributes>.pushToStartTokenUpdates {
        self?.sendEvent("onPushToStartToken", ["token": hex(data)])
      }
    })
  }

  /// Tells JavaScript that an activity ended, with the number of activities
  /// that are still active. JavaScript unbinds the token at the relay when
  /// that number is zero.
  private func watchEnd(of activity: Activity<TimerAttributes>) {
    tasks.watch("\(activity.id)#state") {
      Task { [weak self] in
        for await state in activity.activityStateUpdates {
          guard state == .ended || state == .dismissed else { continue }
          let remaining = Activity<TimerAttributes>.activities.filter {
            $0.id != activity.id
              && ($0.activityState == .active || $0.activityState == .stale)
          }.count
          self?.sendEvent("onActivityEnded", [
            "activityId": activity.id,
            "remaining": remaining,
          ])
          break
        }
      }
    }
  }

  private func watchToken(of activity: Activity<TimerAttributes>) {
    watchEnd(of: activity)
    tasks.watch(activity.id) {
      Task { [weak self] in
        for await data in activity.pushTokenUpdates {
          self?.sendEvent("onActivityPushToken", [
            "activityId": activity.id,
            "token": hex(data),
          ])
        }
      }
    }
  }
}
