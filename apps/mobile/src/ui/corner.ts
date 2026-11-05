// The corner radii of the app, in dp. The Material 3 corner scale and the
// radius of each component on Android. iOS keeps its own numbers.

/** The Material 3 Expressive corner scale (its shape scale). */
export const CORNER = {
	extraSmall: 4,
	small: 8,
	medium: 12,
	large: 16,
	extraLarge: 28,
	full: 9999,
} as const;

/** The radius of each component on Android, from the scale above. */
export const RADIUS = {
	card: CORNER.medium,
	field: CORNER.extraSmall,
	chip: CORNER.small,
	dialog: CORNER.extraLarge,
	fab: CORNER.large,
	/** The outer corners of a grouped list (the Expressive segmented list). */
	listGroup: CORNER.large,
	/** The corners that two rows of a grouped list share. */
	listInner: CORNER.extraSmall,
	snackbar: CORNER.extraSmall,
	button: CORNER.full,
} as const;

export type CornerRole = keyof typeof RADIUS;

/** The radii that the screens use on iOS, for the roles that a component
 *  reads from this module. A role that is missing here has no iOS value in
 *  this module: the component keeps its own number. */
export const IOS_RADIUS = {
	card: 12,
	field: 10,
	listGroup: 10,
} as const satisfies { [role in CornerRole]?: number };

type IosRole = keyof typeof IOS_RADIUS;

const hasIosRadius = (role: CornerRole): role is IosRole => role in IOS_RADIUS;

/**
 * The radius of a component for a platform: the Material 3 value on Android,
 * the iOS value on iOS where this module has one. A role with no iOS value
 * gives the Android radius, so a caller guards it with `Platform.OS`.
 */
export const cornerFor = (role: CornerRole, os: string): number =>
	os === "ios" && hasIosRadius(role) ? IOS_RADIUS[role] : RADIUS[role];

/**
 * The corner radii of one row in a grouped list. The outer corners of the
 * group are large, and the corners between two rows are small, as in the
 * Material 3 Expressive segmented list. A group of one row has four large
 * corners.
 */
export const groupedCorners = (index: number, count: number) => {
	const first = index === 0;
	const last = index === count - 1;
	const top = first ? RADIUS.listGroup : RADIUS.listInner;
	const bottom = last ? RADIUS.listGroup : RADIUS.listInner;
	return {
		borderTopLeftRadius: top,
		borderTopRightRadius: top,
		borderBottomLeftRadius: bottom,
		borderBottomRightRadius: bottom,
	} as const;
};
