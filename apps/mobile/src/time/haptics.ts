import * as Haptics from "expo-haptics";

/** A short tap of success after a write that the person asked for: a save,
 *  a copy, a filing. Not on a stepper step, which happens too often. */
export const committed = () => {
	void Haptics.notificationAsync(
		Haptics.NotificationFeedbackType.Success,
	).catch(() => undefined);
};

/** A light tap when the person holds or resumes the timer. */
export const toggled = () => {
	void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
		() => undefined,
	);
};

/** A firm tap when the person throws away a timer or an entry. */
export const removed = () => {
	void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
		() => undefined,
	);
};
