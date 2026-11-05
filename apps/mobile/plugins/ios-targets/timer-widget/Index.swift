import SwiftUI
import WidgetKit

// BUILT ON A MAC, NOT RUN ON A DEVICE. The widget extension has one widget: the timer's
// Live Activity.
@main
struct FarmerWidgets: WidgetBundle {
  var body: some Widget {
    TimerLiveActivity()
  }
}
