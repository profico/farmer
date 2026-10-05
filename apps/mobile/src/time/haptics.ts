import * as Haptics from "expo-haptics";

/** A short tap of success after a write that the person asked for: a save,
 *  a copy, a filing. Not on a stepper step, which happens too often. */
export const committed = () => {
	void Haptics.notificationAsync(
		Haptics.NotificationFeedbackType.Success,
	).catch(() => undefined);
};
