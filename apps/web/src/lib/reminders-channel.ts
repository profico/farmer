import type { AppReach } from "@farmer/core/services";

/** The one sentence under "Send reminders to" that says where the next
 *  reminder goes. The words follow the mobile app (`you/preferences.tsx`). */
export const APP_CHANNEL_NOTE =
	"The month-end reminders and the nudges go to the app only when a phone allows notifications from Farmer. If none does, they go to Slack.";

/** What the person's phones change about the choice. Null when no note is
 *  needed: a phone allows notifications, so "The app" works. */
export const appChannelStatus = (reach: AppReach): string | null => {
	if (reach.allowing > 0) return null;
	if (reach.phones > 0) {
		return "Your phone does not allow notifications from Farmer, so reminders go to Slack for now.";
	}
	return "You have not signed in to the Farmer app on a phone, so reminders go to Slack for now.";
};
