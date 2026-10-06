/** The smallest touch target of Material 3, in dp. */
export const MIN_TARGET = 48;

/**
 * The `hitSlop` that grows a control `size` dp high to the minimum touch
 * target, without a change of what it draws. React Native tests a touch
 * against the bounds of each parent too, so a parent that is not as high as
 * the target needs the same `hitSlop`.
 */
export const verticalSlop = (size: number) => {
	const extra = Math.max(0, (MIN_TARGET - size) / 2);
	return { top: extra, bottom: extra };
};
