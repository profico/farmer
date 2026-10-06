import ActivityKit
import ExpoModulesCore

// WRITTEN, NOT COMPILED: this file was written on Linux, where Xcode does not
// run. Build it on a Mac before a release.

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

/// The timer's Live Activity, for the app (`modules/live-activity/index.ts`).
///
/// The app keeps at most one activity. `show` updates the activity whose
/// labels match, and ends every other one, also an activity that a
/// push-to-start opened without labels. The tokens of each activity go to
/// JavaScript, which gives them to the Server.
public class FarmerLiveActivityModule: Module {
  private var tokenTasks: [String: Task<Void, Never>] = [:]
  private var activityTask: Task<Void, Never>?
  private var startTokenTask: Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("FarmerLiveActivity")

    Events("onActivityPushToken", "onPushToStartToken")

    OnCreate {
      self.observe()
    }

    OnDestroy {
      self.activityTask?.cancel()
      self.startTokenTask?.cancel()
      self.tokenTasks.values.forEach { $0.cancel() }
      self.tokenTasks.removeAll()
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
    activityTask = Task { [weak self] in
      // An activity that a push-to-start opened while the app runs.
      for await activity in Activity<TimerAttributes>.activityUpdates {
        self?.watchToken(of: activity)
      }
    }
    startTokenTask = Task { [weak self] in
      for await data in Activity<TimerAttributes>.pushToStartTokenUpdates {
        self?.sendEvent("onPushToStartToken", ["token": hex(data)])
      }
    }
  }

  private func watchToken(of activity: Activity<TimerAttributes>) {
    guard tokenTasks[activity.id] == nil else { return }
    tokenTasks[activity.id] = Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        self?.sendEvent("onActivityPushToken", [
          "activityId": activity.id,
          "token": hex(data),
        ])
      }
    }
  }
}
