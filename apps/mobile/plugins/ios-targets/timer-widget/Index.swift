import SwiftUI
import WidgetKit

// WRITTEN, NOT COMPILED. The widget extension has one widget: the timer's
// Live Activity.
@main
struct FarmerWidgets: WidgetBundle {
  var body: some Widget {
    TimerLiveActivity()
  }
}
