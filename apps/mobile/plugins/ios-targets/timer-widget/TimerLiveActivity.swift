import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// BUILT ON A MAC, NOT RUN ON A DEVICE.
//
// The timer's Live Activity: the elapsed time, the project and the task, and
// Pause or Resume and Stop. A running timer counts with
// `Text(timerInterval:)`, so the figure moves without an update. A held timer
// shows its frozen figure.

private let stopURL = URL(string: "farmer://stop-timer?source=timer-surface")!
private let openURL = URL(string: "farmer://")!

private extension TimerAttributes.ContentState {
  var isRunning: Bool { state == "running" && runningSinceMs != nil }

  /// The moment the figure was zero: the start of the running segment minus
  /// the seconds before it. `runningSinceMs` is Unix milliseconds.
  var countFrom: Date {
    let since = (runningSinceMs ?? 0) / 1000
    return Date(timeIntervalSince1970: since - accumulatedSeconds)
  }

  var frozen: String {
    let total = Int(accumulatedSeconds)
    return String(format: "%d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60)
  }
}

private extension TimerAttributes {
  /// "Project · Task", or a plain title for an activity that a
  /// push-to-start opened: its labels are sealed, and only the app has them.
  var title: String {
    guard let task else { return "Timer" }
    return [project ?? "No project", task].joined(separator: " · ")
  }
}

private struct Elapsed: View {
  let state: TimerAttributes.ContentState

  var body: some View {
    if state.isRunning {
      Text(timerInterval: state.countFrom...Date.distantFuture, countsDown: false)
        .monospacedDigit()
    } else {
      Text(state.frozen).monospacedDigit()
    }
  }
}

private struct Controls: View {
  let state: TimerAttributes.ContentState

  var body: some View {
    HStack(spacing: 8) {
      Button(
        intent: TimerActionIntent(
          action: state.isRunning ? "pause" : "resume",
          workspace: state.workspace ?? ""
        )
      ) {
        Label(
          state.isRunning ? "Pause" : "Resume",
          systemImage: state.isRunning ? "pause.fill" : "play.fill"
        )
      }
      .disabled(state.workspace == nil)
      Link(destination: stopURL) {
        Label("Stop", systemImage: "stop.fill")
      }
    }
    .font(.subheadline.weight(.semibold))
  }
}

struct TimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TimerAttributes.self) { context in
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Image(systemName: context.state.isRunning ? "timer" : "pause.circle")
          Text(context.state.isRunning ? "Running" : "Paused")
            .font(.caption.weight(.semibold))
          Spacer()
          if let workspace = context.attributes.workspaceName ?? context.state.workspace {
            Text(workspace).font(.caption).foregroundStyle(.secondary)
          }
        }
        Elapsed(state: context.state).font(.system(size: 34, weight: .semibold))
        Text(context.attributes.title).font(.subheadline).lineLimit(1)
        Controls(state: context.state)
      }
      .padding()
      .widgetURL(openURL)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: context.state.isRunning ? "timer" : "pause.circle")
        }
        DynamicIslandExpandedRegion(.trailing) {
          Elapsed(state: context.state).font(.title3.weight(.semibold))
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading) {
            Text(context.attributes.title).lineLimit(1)
            Controls(state: context.state)
          }
        }
      } compactLeading: {
        Image(systemName: context.state.isRunning ? "timer" : "pause.circle")
      } compactTrailing: {
        Elapsed(state: context.state).frame(maxWidth: 64)
      } minimal: {
        Image(systemName: "timer")
      }
      .widgetURL(openURL)
    }
  }
}
