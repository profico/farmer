/** The smallest touch target of Material 3, in dp. */
export const MIN_TARGET = 48;

/** The smallest touch target of the Apple HIG, in points. */
export const IOS_MIN_TARGET = 44;

/** The smallest touch target of a platform: 48 dp on Android (Material 3),
 *  44 pt on iOS (Apple HIG). The two are not mixed. */
export const minTargetFor = (os: string) =>
	os === "ios" ? IOS_MIN_TARGET : MIN_TARGET;

/**
 * The `hitSlop` that grows a control `size` dp high to the minimum touch
 * target, without a change of what it draws. React Native tests a touch
 * against the bounds of each parent too, so a parent that is not as high as
 * the target needs the same `hitSlop`.
 */
export const verticalSlop = (size: number, target = MIN_TARGET) => {
	const extra = Math.max(0, (target - size) / 2);
	return { top: extra, bottom: extra };
};
